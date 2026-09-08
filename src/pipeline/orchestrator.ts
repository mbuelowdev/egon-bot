import { readFileSync } from "node:fs";
import type { Client } from "discord.js";
import { featurePageUrl, githubRepoSlug, githubRepoWebUrl, type Config } from "../config.js";
import { cancelActiveAgentRun, clearAgentCancel } from "../cursor/activeRun.js";
import { StuckAgentError } from "../cursor/agentWatch.js";
import { runImplementer } from "../cursor/implementer.js";
import { persistImplementerSummary } from "../cursor/implementerSummary.js";
import { postToChannel, removeAddNoteButton, removeMergeButton } from "../discord/channel.js";
import { discordLink } from "../discord/preview.js";
import { cancelAllQuestionWaiters } from "../discord/qaWaiters.js";
import {
  copyFeatureSpec,
  featureBranchName,
  gameSpecPath,
  newFeatureBranchName,
} from "../features/artifacts.js";
import { saveFeatureImage, type IncomingImage } from "../features/saveImage.js";
import { featureSlug } from "../features/slug.js";
import { UserFacingError, type Feature, type FeatureAttachment, type FeatureStore } from "../features/store.js";
import { isStoppablePipelineState } from "../features/state.js";
import { formatDeployFailure, formatDeploySuccess, formatFeatureName, formatImplementationStart, formatPlanningStart, formatPivoting, PHASE_EMOJI } from "../format.js";
import { recordFeatureEvent } from "../events/feature.js";
import { cleanupAfterMerge, ensureDeploymentBump } from "../git/accept.js";
import {
  createDraftPr,
  deployRunDurationMinutes,
  isClosedUnmergedView,
  isMergedView,
  markPrReady,
  mergePullRequest,
  viewPullRequest,
  waitForDeployWorkflow,
} from "../git/github.js";
import {
  checkoutDefaultBranch,
  commitAndPush,
  createFeatureBranch,
  discardUncommittedWork,
} from "../git/workingTree.js";
import { ensureEgonBridge } from "../godot/egonBridge.js";
import { refreshGameMap } from "../godot/gameMap.js";
import { refreshAssetManifest } from "../assets/manifest.js";
import { promoteAssets } from "../assets/promote.js";
import { declaredAssetIds } from "../features/specSections.js";
import { stopWebServer } from "../godot/serve.js";
import type { GithubWebhookEvent } from "../catalog/webhook.js";
import { isPipelineStopError, shouldHaltPipeline } from "./halt.js";
import { runFeaturePlanner } from "./runPlanner.js";
import { runExportTestLoop } from "./testLoop.js";

export type Pipeline = {
  startPlan: (featureId: number) => Promise<void>;
  resumeIfNeeded: () => Promise<void>;
  pivot: (text: string, image?: IncomingImage) => Promise<string>;
  retry: () => Promise<string>;
  stop: () => Promise<string>;
  merge: (featureId: number) => Promise<void>;
  handleGithubEvent: (event: GithubWebhookEvent) => Promise<void>;
  catchUpOpenPrs: () => Promise<void>;
  interruptIfLocked: (featureId: number) => Promise<void>;
};

export function createPipeline(ctx: {
  client: Client;
  store: FeatureStore;
  config: Config;
}): Pipeline {
  let queue: Promise<void> = Promise.resolve();
  let jobAbort: AbortController | undefined;
  let catchUpInFlight: Promise<void> | undefined;
  let lastCatchUpAt = 0;

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const run = queue.then(job, job);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const notify = async (content: string): Promise<void> => {
    try {
      await postToChannel(ctx.client, ctx.config.discordChannelId, content);
    } catch (error) {
      console.error("failed to post pipeline update", error);
    }
  };

  const featureCatalogUrl = (feature: Feature): string | undefined =>
    featurePageUrl(ctx.config, feature.name);

  const extraLinks = (feature: Feature): string[] =>
    feature.githubPrUrl ? [discordLink(feature.githubPrUrl)] : [];

  const clearMergeButton = async (feature: Feature): Promise<void> => {
    await removeMergeButton(ctx.client, ctx.config.discordChannelId, feature.reviewMessageId);
  };

  const pushImplementerWork = async (feature: Feature, message: string): Promise<Feature> => {
    await ensureDeploymentBump(ctx.config);
    const committed = await commitAndPush(ctx.config, message);
    let latest = ctx.store.getFeatureById(feature.id) ?? feature;
    if (committed && latest.githubPrNumber !== null) {
      await markPrReady(ctx.config, latest.githubPrNumber);
      latest = ctx.store.getFeatureById(feature.id) ?? latest;
    }
    return latest;
  };

  /**
   * Copy the assets this SPEC names into the working tree before the implementer edits.
   * Nothing else in the library reaches the repo, and the copy is idempotent by sha256,
   * so a fix round re-running this does not churn the diff. Never fatal: a missing id is
   * the spec gate's problem, and it already refused a SPEC that named one.
   */
  const promoteDeclaredAssets = (config: Config, feature: Feature): void => {
    try {
      const spec = readFileSync(gameSpecPath(config, feature), "utf8");
      const result = promoteAssets({
        dataDir: config.dataDir,
        gameRepoDir: config.gameRepoDir,
        ids: declaredAssetIds(spec),
      });
      if (result.missing.length > 0) {
        console.error(`asset promotion could not find: ${result.missing.join(", ")}`);
      }
    } catch (error) {
      console.error("asset promotion failed", error);
    }
  };

  const runJob = async (
    featureId: number,
    options: {
      resume?: boolean;
      implementerFollowUp?: string;
      implementerFollowUpAttachments?: FeatureAttachment[];
    },
  ): Promise<void> => {
    const abort = new AbortController();
    jobAbort = abort;
    clearAgentCancel();
    refreshAssetManifest(ctx.config.dataDir);
    const haltIfNeeded = (): boolean => {
      if (abort.signal.aborted) {
        return true;
      }
      const current = ctx.store.getFeatureById(featureId);
      return !current || shouldHaltPipeline(current);
    };
    try {
      let feature = ctx.store.getFeatureById(featureId);
      if (!feature) {
        throw new Error(`Feature ${String(featureId)} not found`);
      }
      if (haltIfNeeded()) {
        return;
      }

      if (feature.state === "planning") {
        await removeAddNoteButton(ctx.client, ctx.config.discordChannelId, feature.addNoteMessageId);
        if (!options.resume) {
          const branch = newFeatureBranchName(featureSlug(feature.name));
          await createFeatureBranch(ctx.config, branch);
          feature = ctx.store.setGithubBranch(feature.id, branch);
        }
        ensureEgonBridge(ctx.config.gameRepoDir);
        if (haltIfNeeded()) {
          return;
        }
        await notify(
          options.resume
            ? formatPlanningStart(feature.name, [], featureCatalogUrl(feature))
            : formatPlanningStart(feature.name, ctx.store.listNotes(feature.id), featureCatalogUrl(feature)),
        );
        const deps = {
          client: ctx.client,
          store: ctx.store,
          config: ctx.config,
          featureId: feature.id,
        };
        if (haltIfNeeded()) {
          return;
        }
        const latest = ctx.store.getFeatureById(feature.id) ?? feature;
        const planned = await runFeaturePlanner({
          config: ctx.config,
          store: ctx.store,
          feature: latest,
          deps,
          resume: Boolean(options.resume),
          notify,
          catalogUrl: featureCatalogUrl(latest),
        });
        feature = ctx.store.getFeatureById(featureId) ?? latest;
        if (haltIfNeeded()) {
          return;
        }
        if (planned.marker !== "PLAN_COMPLETE") {
          await notify(
            [
              `${PHASE_EMOJI.planning} Planning ${formatFeatureName(feature.name, featureCatalogUrl(feature))} did not complete (${planned.marker ?? "no marker"}).`,
              planned.text ? planned.text.slice(0, 1500) : "",
            ]
              .filter((line) => line !== "")
              .join("\n"),
          );
          return;
        }
        copyFeatureSpec(ctx.config, feature);
        await commitAndPush(ctx.config, `egon: spec ${feature.name}`);
        if (haltIfNeeded()) {
          return;
        }
        const pr = await createDraftPr(ctx.config, {
          title: feature.name,
          body: [
            `Feature: ${feature.name}`,
            "",
            `Spec: \`docs/features/${featureSlug(feature.name)}/SPEC.md\``,
            "",
            "Draft until the implementer commits code. Merge on GitHub.",
          ].join("\n"),
        });
        feature = ctx.store.setGithubPr(feature.id, {
          branch: featureBranchName(feature),
          number: pr.number,
          url: pr.url,
        });
        if (haltIfNeeded()) {
          return;
        }
        ctx.store.transition(feature.id, "implementing");
      }

      feature = ctx.store.getFeatureById(featureId) ?? feature;
      if (haltIfNeeded()) {
        return;
      }
      if (feature.state === "pivoting") {
        ctx.store.transition(feature.id, "implementing");
        feature = ctx.store.getFeatureById(feature.id) ?? feature;
      }

      if (feature.state === "implementing") {
        promoteDeclaredAssets(ctx.config, feature);
        const implStartedAt = Date.now();
        recordFeatureEvent({
          dataDir: ctx.config.dataDir,
          feature,
          phase: "implement",
          step: options.resume && feature.implementerAgentId ? "Implementer resumed" : "Implementer started",
        });
        await notify(formatImplementationStart(feature.name, featureCatalogUrl(feature)));
        if (haltIfNeeded()) {
          return;
        }
        const implFollowUp =
          options.implementerFollowUp ??
          (options.resume && feature.implementerAgentId
            ? "Continue implementing the SPEC. Do not commit or push."
            : undefined);
        const result = await runImplementer({
          config: ctx.config,
          store: ctx.store,
          feature,
          followUp: implFollowUp,
          followUpAttachments: options.implementerFollowUpAttachments,
        });
        feature = ctx.store.getFeatureById(featureId) ?? feature;
        if (haltIfNeeded()) {
          return;
        }
        if (result.status !== "finished") {
          recordFeatureEvent({
            dataDir: ctx.config.dataDir,
            feature,
            phase: "implement",
            step: `Implementer ${result.status}`,
            level: "failure",
            ...(result.errorMessage !== undefined ? { detail: result.errorMessage } : {}),
            durationMs: Date.now() - implStartedAt,
          });
          await notify(
            `${PHASE_EMOJI.implementing} Implementer failed for ${formatFeatureName(feature.name, featureCatalogUrl(feature))}: ${result.errorMessage ?? result.status}`,
          );
          return;
        }
        recordFeatureEvent({
          dataDir: ctx.config.dataDir,
          feature,
          phase: "implement",
          step: "Implementer finished",
          level: "success",
          ...(result.result !== undefined ? { detail: result.result } : {}),
          durationMs: Date.now() - implStartedAt,
        });
        persistImplementerSummary(ctx.config.dataDir, feature.id, result.result);
        refreshGameMap(ctx.config);
        await pushImplementerWork(feature, `egon: implement ${feature.name}`);
        feature = ctx.store.getFeatureById(featureId) ?? feature;
        if (haltIfNeeded()) {
          return;
        }
        ctx.store.transition(feature.id, "exporting");
      }

      feature = ctx.store.getFeatureById(featureId) ?? feature;
      if (haltIfNeeded()) {
        return;
      }
      if (
        feature.state === "exporting" ||
        feature.state === "testing" ||
        feature.state === "fixing"
      ) {
        await runExportTestLoop({
          client: ctx.client,
          store: ctx.store,
          config: ctx.config,
          notify,
          featureId,
          signal: abort.signal,
          onFixCommit: async (current) => {
            await pushImplementerWork(current, `egon: fix ${current.name}`);
          },
        });
      }
    } catch (error) {
      if (isPipelineStopError(error) || abort.signal.aborted || haltIfNeeded()) {
        return;
      }
      if (error instanceof StuckAgentError) {
        console.error(`pipeline stuck: ${error.message}`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await notify(`Pipeline error: ${message}`);
      throw error;
    }
  };

  const handleGithubEvent = async (event: GithubWebhookEvent): Promise<void> => {
    if (event.kind === "ignore") {
      return;
    }
    if (event.kind === "deployed" || event.kind === "deploy_failed") {
      await announceDeployOutcome(event);
      return;
    }
    const feature = ctx.store.getFeatureByPrNumber(event.number);
    if (!feature) {
      console.log(`github webhook for unknown PR #${String(event.number)}`);
      return;
    }
    if (event.kind === "merged") {
      recordFeatureEvent({
        dataDir: ctx.config.dataDir,
        feature,
        phase: "merge",
        step: `PR #${String(event.number)} merged`,
        level: "success",
      });
      await clearMergeButton(feature);
      if (feature.state !== "accepted") {
        await checkoutDefaultBranch(ctx.config);
        await cleanupAfterMerge(ctx.config, ctx.store, feature.id);
      }
      const latest = ctx.store.getFeatureById(feature.id) ?? feature;
      if (!latest.deployAnnounced) {
        void waitAndAnnounceDeployFromMerge(event.number);
      }
      return;
    }
    await clearMergeButton(feature);
    if (feature.state === "accepted" || feature.state === "rejected") {
      return;
    }
    recordFeatureEvent({
      dataDir: ctx.config.dataDir,
      feature,
      phase: "merge",
      step: `PR #${String(event.number)} closed without merging`,
      level: "warning",
    });
    ctx.store.transition(feature.id, "rejected");
    await notify(
      `PR for ${formatFeatureName(feature.name, featureCatalogUrl(feature))} was closed without merging. Use /egon-retry or /egon-pivot to continue.`,
    );
  };

  const deployTitle = (features: Feature[]): string => {
    if (features.length === 0) {
      return githubRepoSlug(ctx.config.gameRepoHttpsUrl);
    }
    return features.map((item) => formatFeatureName(item.name, featureCatalogUrl(item))).join(", ");
  };

  const announceDeployOutcome = async (
    event: Extract<GithubWebhookEvent, { kind: "deployed" | "deploy_failed" }>,
  ): Promise<void> => {
    const branch = event.headBranch.replace(/^refs\/heads\//, "");
    const expected = ctx.config.gameRepoBranch.replace(/^refs\/heads\//, "");
    if (branch !== "" && branch !== expected) {
      console.log(`ignoring deploy for branch ${branch} (expected ${expected})`);
      return;
    }
    if (!ctx.store.claimDeployRun(event.runId)) {
      return;
    }
    const pending = ctx.store.listPendingDeployFeatures();
    const title = deployTitle(pending);
    for (const item of pending) {
      recordFeatureEvent({
        dataDir: ctx.config.dataDir,
        feature: item,
        phase: "deploy",
        step: event.kind === "deployed" ? "Deployed" : "Deploy failed",
        level: event.kind === "deployed" ? "success" : "failure",
        ...(event.kind === "deploy_failed" ? { detail: event.htmlUrl } : {}),
      });
    }
    const content =
      event.kind === "deployed"
        ? formatDeploySuccess({
            title,
            gameUrl: ctx.config.gamePublicUrl,
          })
        : formatDeployFailure({
            title,
            repoUrl: githubRepoWebUrl(ctx.config.gameRepoHttpsUrl),
            gameUrl: ctx.config.gamePublicUrl,
            durationMinutes: event.durationMinutes,
            commitMessage: event.commitMessage,
            workflowUrl: event.htmlUrl,
          });
    try {
      await postToChannel(ctx.client, ctx.config.discordChannelId, content);
    } catch (error) {
      ctx.store.clearDeployRunClaim(event.runId);
      console.error("failed to post deploy notice", error);
      return;
    }
    if (event.kind === "deployed") {
      ctx.store.markFeaturesDeployAnnounced(pending.map((item) => item.id));
    }
  };

  const waitAndAnnounceDeploy = async (headSha?: string, createdAfterIso?: string): Promise<void> => {
    try {
      const run = await waitForDeployWorkflow(ctx.config, {
        headSha,
        createdAfterIso,
      });
      const kind =
        run.conclusion === "success" ? "deployed" : run.conclusion === "failure" ? "deploy_failed" : undefined;
      if (!kind) {
        return;
      }
      await announceDeployOutcome({
        kind,
        runId: run.id,
        headBranch: ctx.config.gameRepoBranch,
        commitMessage: run.displayTitle,
        htmlUrl: run.url,
        durationMinutes: deployRunDurationMinutes(run),
      });
    } catch (error) {
      console.error("failed to wait for game deploy", error);
    }
  };

  const waitAndAnnounceDeployFromMerge = async (prNumber: number): Promise<void> => {
    const fallbackAfter = new Date(Date.now() - 15_000).toISOString();
    let headSha: string | undefined;
    let createdAfterIso = fallbackAfter;
    try {
      const view = await viewPullRequest(ctx.config, prNumber);
      if (view.mergedAt) {
        createdAfterIso = view.mergedAt;
      }
      if (view.mergeCommit) {
        headSha = view.mergeCommit;
      }
    } catch (error) {
      console.error("failed to read merge commit for deploy wait", error);
    }
    await waitAndAnnounceDeploy(headSha, createdAfterIso);
  };

  return {
    startPlan: (featureId: number) => enqueue(() => runJob(featureId, { resume: false })),
    resumeIfNeeded: () => {
      const lock = ctx.store.getPipelineLock();
      if (!lock) {
        return Promise.resolve();
      }
      const resumable = [
        "planning",
        "implementing",
        "exporting",
        "testing",
        "fixing",
        "pivoting",
      ];
      if (!resumable.includes(lock.feature.state)) {
        return Promise.resolve();
      }
      return enqueue(() => runJob(lock.feature.id, { resume: true }));
    },
    pivot: async (text: string, image?: IncomingImage) => {
      const lock = ctx.store.getPipelineLock();
      if (
        !lock ||
        (lock.feature.state !== "awaiting_review" && lock.feature.state !== "rejected")
      ) {
        throw new UserFacingError("Pivot is only valid when awaiting_review or after the PR was closed.");
      }
      let newAttachment: FeatureAttachment | undefined;
      if (image) {
        newAttachment = await saveFeatureImage({
          dataDir: ctx.config.dataDir,
          store: ctx.store,
          featureId: lock.feature.id,
          image,
        });
      }
      ctx.store.addNote(lock.feature.id, text);
      await clearMergeButton(lock.feature);
      ctx.store.transition(lock.feature.id, "pivoting");
      const featureId = lock.feature.id;
      const name = lock.feature.name;
      const followUp = [
        "The humans requested a pivot.",
        "Re-implement the SPEC with this change. Do not commit or push.",
        text,
        newAttachment
          ? "The new image is attached as vision input. It is reference material only — it is not in the working tree and must not be imported or referenced by any `res://` path."
          : "",
      ]
        .filter((line) => line !== "")
        .join("\n");
      void enqueue(() =>
        runJob(featureId, {
          implementerFollowUp: followUp,
          implementerFollowUpAttachments: newAttachment ? [newAttachment] : undefined,
        }),
      ).catch((error: unknown) => {
        console.error("pivot pipeline failed", error);
      });
      return formatPivoting(name, text, featurePageUrl(ctx.config, name));
    },
    retry: async () => {
      const lock = ctx.store.getPipelineLock();
      if (!lock) {
        throw new UserFacingError("No active pipeline to retry.");
      }
      const canRetry =
        isStoppablePipelineState(lock.feature.state) ||
        lock.feature.state === "awaiting_review" ||
        lock.feature.state === "rejected";
      if (!canRetry) {
        throw new UserFacingError(`Cannot retry from ${lock.feature.state}.`);
      }
      jobAbort?.abort();
      cancelAllQuestionWaiters();
      await cancelActiveAgentRun();
      let state = lock.feature.state;
      if (lock.feature.state === "awaiting_review" || lock.feature.state === "rejected") {
        await clearMergeButton(lock.feature);
        ctx.store.transition(lock.feature.id, "pivoting");
        state = "pivoting";
      }
      const featureId = lock.feature.id;
      const name = lock.feature.name;
      void enqueue(() => runJob(featureId, { resume: true })).catch((error: unknown) => {
        console.error("retry pipeline failed", error);
      });
      return `Retrying ${formatFeatureName(name, featurePageUrl(ctx.config, name))} from ${state}.`;
    },
    stop: async () => {
      jobAbort?.abort();
      cancelAllQuestionWaiters();
      await cancelActiveAgentRun();
      const { feature, releasedLock } = ctx.store.stopPipelineWork();
      try {
        await discardUncommittedWork(ctx.config);
        if (releasedLock) {
          await checkoutDefaultBranch(ctx.config);
        }
      } catch (error) {
        console.error("failed to reset working tree after stop", error);
      }
      try {
        await stopWebServer();
      } catch (error) {
        console.error("failed to stop web server after stop", error);
      }
      if (releasedLock) {
        return `${PHASE_EMOJI.stop} Stopped ${formatFeatureName(feature.name, featureCatalogUrl(feature))}. Feature is back to collecting.`;
      }
      return [
        `${PHASE_EMOJI.stop} Stopped ${formatFeatureName(feature.name, featureCatalogUrl(feature))}.`,
        ...extraLinks(feature),
        "Merge on GitHub, /egon-retry to continue, or /egon-pivot to steer.",
      ]
        .filter((line) => line !== "")
        .join("\n");
    },
    merge: async (featureId: number) => {
      const feature = ctx.store.getFeatureById(featureId);
      if (!feature) {
        throw new UserFacingError("Feature not found.");
      }
      if (feature.githubPrNumber === null) {
        throw new UserFacingError("This feature has no pull request.");
      }
      if (feature.state === "rejected") {
        await clearMergeButton(feature);
        throw new UserFacingError("This PR was closed without merging.");
      }
      try {
        await mergePullRequest(ctx.config, feature.githubPrNumber);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        throw new UserFacingError(`Could not merge the PR: ${text}`);
      }
      await handleGithubEvent({ kind: "merged", number: feature.githubPrNumber });
    },
    handleGithubEvent,
    catchUpOpenPrs: () => {
      if (catchUpInFlight) {
        return catchUpInFlight;
      }
      if (lastCatchUpAt !== 0 && Date.now() - lastCatchUpAt < 10_000) {
        return Promise.resolve();
      }
      catchUpInFlight = (async () => {
        try {
          for (const feature of ctx.store.listFeaturesAwaitingGithub()) {
            if (feature.githubPrNumber === null) {
              continue;
            }
            try {
              const view = await viewPullRequest(ctx.config, feature.githubPrNumber);
              if (isMergedView(view)) {
                await handleGithubEvent({ kind: "merged", number: feature.githubPrNumber });
              } else if (isClosedUnmergedView(view)) {
                await handleGithubEvent({ kind: "closed", number: feature.githubPrNumber });
              }
            } catch (error) {
              console.error(`github catch-up failed for PR #${String(feature.githubPrNumber)}`, error);
            }
          }
          const pending = ctx.store.listPendingDeployFeatures();
          if (pending.length > 0) {
            const oldest = pending[pending.length - 1];
            const updated = oldest ? Date.parse(oldest.updatedAt) : Number.NaN;
            const after = Number.isFinite(updated)
              ? new Date(updated - 15_000).toISOString()
              : undefined;
            void waitAndAnnounceDeploy(undefined, after);
          }
        } finally {
          lastCatchUpAt = Date.now();
          catchUpInFlight = undefined;
        }
      })();
      return catchUpInFlight;
    },
    interruptIfLocked: async (featureId: number) => {
      const lock = ctx.store.getPipelineLock();
      if (lock?.feature.id !== featureId) {
        return;
      }
      jobAbort?.abort();
      cancelAllQuestionWaiters();
      await cancelActiveAgentRun();
      try {
        await discardUncommittedWork(ctx.config);
        await checkoutDefaultBranch(ctx.config);
      } catch (error) {
        console.error("failed to reset working tree after catalog delete", error);
      }
      try {
        await stopWebServer();
      } catch (error) {
        console.error("failed to stop web server after catalog delete", error);
      }
    },
  };
}
