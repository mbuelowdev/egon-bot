import type { Client } from "discord.js";
import { featurePageUrl, type Config } from "../config.js";
import { cancelActiveAgentRun, clearAgentCancel } from "../cursor/activeRun.js";
import { StuckAgentError } from "../cursor/agentWatch.js";
import { postPlannerQuestion } from "../cursor/askUsersTool.js";
import { runImplementer } from "../cursor/implementer.js";
import { runPlanner } from "../cursor/planner.js";
import { postToChannel } from "../discord/channel.js";
import { discordLink } from "../discord/preview.js";
import { cancelAllQuestionWaiters, waitForQuestionAnswer } from "../discord/qaWaiters.js";
import {
  copyFeatureAssets,
  copyFeatureSpec,
  featureBranchName,
  newFeatureBranchName,
  plannedAssetPath,
} from "../features/artifacts.js";
import { saveFeatureImage, type IncomingImage } from "../features/saveImage.js";
import { featureSlug } from "../features/slug.js";
import { UserFacingError, type Feature, type FeatureAttachment, type FeatureStore } from "../features/store.js";
import { isStoppablePipelineState } from "../features/state.js";
import { formatFeatureName, formatImplementationStart, formatPlanningStart, formatPivoting, PHASE_EMOJI } from "../format.js";
import { cleanupAfterMerge, ensureDeploymentBump } from "../git/accept.js";
import {
  createDraftPr,
  isClosedUnmergedView,
  isMergedView,
  markPrReady,
  viewPullRequest,
} from "../git/github.js";
import {
  checkoutDefaultBranch,
  commitAndPush,
  createFeatureBranch,
  discardUncommittedWork,
} from "../git/workingTree.js";
import { stopWebServer } from "../godot/serve.js";
import type { GithubPrEvent } from "../catalog/webhook.js";
import { isPipelineStopError, shouldHaltPipeline } from "./halt.js";
import { runExportTestLoop } from "./testLoop.js";

export type Pipeline = {
  startPlan: (featureId: number) => Promise<void>;
  resumeIfNeeded: () => Promise<void>;
  pivot: (text: string, image?: IncomingImage) => Promise<string>;
  retry: () => Promise<string>;
  stop: () => Promise<string>;
  handleGithubEvent: (event: GithubPrEvent) => Promise<void>;
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
        if (!options.resume) {
          const branch = newFeatureBranchName(featureSlug(feature.name));
          await createFeatureBranch(ctx.config, branch);
          feature = ctx.store.setGithubBranch(feature.id, branch);
        }
        copyFeatureAssets(ctx.config, feature, ctx.store.listAttachments(feature.id));
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
        let followUp: string | undefined;
        if (options.resume && feature.pendingQuestion) {
          if (feature.pendingAnswer) {
            followUp = `The humans answered:\n${feature.pendingAnswer}`;
            ctx.store.clearPendingQuestion(feature.id);
          } else {
            await postPlannerQuestion(deps, feature, feature.pendingQuestion);
            const answer = await waitForQuestionAnswer(feature.id);
            ctx.store.clearPendingQuestion(feature.id);
            followUp = `The humans answered:\n${answer}`;
          }
        } else if (options.resume && feature.plannerAgentId) {
          followUp =
            "Continue the plan. If the spec is done, end with PLAN_COMPLETE or PLAN_BLOCKED.";
        }

        if (haltIfNeeded()) {
          return;
        }
        const latest = ctx.store.getFeatureById(feature.id) ?? feature;
        const planned = await runPlanner({
          config: ctx.config,
          store: ctx.store,
          feature: latest,
          deps,
          followUp,
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
        copyFeatureAssets(ctx.config, feature, ctx.store.listAttachments(feature.id));
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
          await notify(
            `${PHASE_EMOJI.implementing} Implementer failed for ${formatFeatureName(feature.name, featureCatalogUrl(feature))}: ${result.errorMessage ?? result.status}`,
          );
          return;
        }
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

  const handleGithubEvent = async (event: GithubPrEvent): Promise<void> => {
    if (event.kind === "ignore") {
      return;
    }
    const feature = ctx.store.getFeatureByPrNumber(event.number);
    if (!feature) {
      console.log(`github webhook for unknown PR #${String(event.number)}`);
      return;
    }
    if (event.kind === "merged") {
      if (feature.state === "accepted") {
        return;
      }
      await checkoutDefaultBranch(ctx.config);
      await cleanupAfterMerge(ctx.config, ctx.store, feature.id);
      await notify(`Feature ${formatFeatureName(feature.name, featureCatalogUrl(feature))} merged to master.`);
      return;
    }
    if (feature.state === "accepted" || feature.state === "rejected") {
      return;
    }
    ctx.store.transition(feature.id, "rejected");
    await notify(
      `PR for ${formatFeatureName(feature.name, featureCatalogUrl(feature))} was closed without merging. Use /egon-retry or /egon-pivot to continue.`,
    );
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
      let assetPath: string | undefined;
      let newAttachment: FeatureAttachment | undefined;
      if (image) {
        newAttachment = await saveFeatureImage({
          dataDir: ctx.config.dataDir,
          store: ctx.store,
          featureId: lock.feature.id,
          image,
        });
        assetPath = plannedAssetPath(
          lock.feature.name,
          ctx.store.listAttachments(lock.feature.id),
          newAttachment.id,
        );
      }
      ctx.store.addNote(lock.feature.id, text);
      ctx.store.transition(lock.feature.id, "pivoting");
      const featureId = lock.feature.id;
      const name = lock.feature.name;
      const followUp = [
        "The humans requested a pivot.",
        "Re-implement the SPEC with this change. Do not commit or push.",
        text,
        assetPath
          ? `New reference image is already in the working tree at ${assetPath}. Import it from there (do not re-download).`
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
      return formatPivoting(name, text, assetPath, featurePageUrl(ctx.config, name));
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
    handleGithubEvent,
    catchUpOpenPrs: async () => {
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
