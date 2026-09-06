import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "discord.js";
import { featurePageUrl, type Config } from "../config.js";
import { runImplementer } from "../cursor/implementer.js";
import { featurePaths, listCriterionScreenshots, type TestReport } from "../cursor/testReport.js";
import { runTester } from "../cursor/tester.js";
import { postFiles, postToChannel, removeMergeButton } from "../discord/channel.js";
import { mergeButtonRow } from "../discord/mergeButton.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { formatFeatureName, formatReviewReady, formatTestReport, formatTestingStart } from "../format.js";
import { EXPORT_DIR } from "../godot/headers.js";
import { exportDebugWeb } from "../godot/export.js";
import { serveExportDir } from "../godot/serve.js";
import { shouldHaltPipeline } from "./halt.js";

export const MAX_TEST_CYCLES = 3;

async function notifyReadyForReview(
  ctx: {
    client: Client;
    store: FeatureStore;
    config: Config;
    notify: (content: string) => Promise<void>;
  },
  feature: Feature,
  outcome: string,
  nextStep?: string,
): Promise<void> {
  const catalog = featurePageUrl(ctx.config, feature.name);
  const content = [
    outcome,
    formatReviewReady(feature.name, catalog, feature.githubPrUrl ?? undefined),
    nextStep,
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");
  await removeMergeButton(ctx.client, ctx.config.discordChannelId, feature.reviewMessageId);
  try {
    const posted = await postToChannel(ctx.client, ctx.config.discordChannelId, content, {
      components: [mergeButtonRow(feature.id)],
    });
    ctx.store.setReviewMessageId(feature.id, posted.id);
  } catch (error) {
    console.error("failed to post review-ready message", error);
    await ctx.notify(content);
  }
}

export async function runExportTestLoop(ctx: {
  client: Client;
  store: FeatureStore;
  config: Config;
  notify: (content: string) => Promise<void>;
  featureId: number;
  signal?: AbortSignal;
  onFixCommit?: (feature: Feature) => Promise<void>;
}): Promise<void> {
  const haltIfNeeded = (feature: Feature): boolean =>
    Boolean(ctx.signal?.aborted) || shouldHaltPipeline(feature);

  let announcedTesting = false;
  for (let attempt = 1; attempt <= MAX_TEST_CYCLES; attempt += 1) {
    let feature = ctx.store.getFeatureById(ctx.featureId);
    if (!feature) {
      throw new Error("Feature not found");
    }
    if (haltIfNeeded(feature)) {
      return;
    }

    if (feature.state === "fixing") {
      const paths = featurePaths(ctx.config.dataDir, feature.id);
      const reportText = existsSync(paths.reportPath)
        ? readFileSync(paths.reportPath, "utf8")
        : "Tester reported FAIL with no TEST_REPORT.md";
      const result = await runImplementer({
        config: ctx.config,
        store: ctx.store,
        feature,
        followUp: [
          "The tester found failures. Fix only [FAIL] items. Do not commit or push.",
          "[COULD NOT VERIFY] means the tester could not complete the check, not that the game is wrong.",
          "Keep or bump the version field in deployment.json.",
          "",
          reportText,
        ].join("\n"),
      });
      feature = ctx.store.getFeatureById(feature.id) ?? feature;
      if (haltIfNeeded(feature)) {
        return;
      }
      if (result.status !== "finished") {
        throw new Error(result.errorMessage ?? "Implementer failed during fix loop");
      }
      if (ctx.onFixCommit) {
        await ctx.onFixCommit(feature);
      }
      feature = ctx.store.getFeatureById(feature.id) ?? feature;
      if (haltIfNeeded(feature)) {
        return;
      }
      ctx.store.transition(feature.id, "exporting");
      feature = ctx.store.getFeatureById(feature.id) ?? feature;
    }

    if (haltIfNeeded(feature)) {
      return;
    }
    if (feature.state !== "exporting" && feature.state !== "testing") {
      throw new Error(`Cannot export/test from state ${feature.state}`);
    }

    await exportDebugWeb(ctx.config.gameRepoDir, ctx.signal);
    await serveExportDir(EXPORT_DIR, ctx.config.webServePort);
    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }
    if (feature.state === "exporting") {
      ctx.store.transition(feature.id, "testing");
    }

    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }

    if (!announcedTesting) {
      const catalog = featurePageUrl(ctx.config, feature.name);
      await ctx.notify(formatTestingStart(feature.name, catalog));
      announcedTesting = true;
    }
    const latest = ctx.store.getFeatureById(feature.id) ?? feature;
    const report = await runTester({ config: ctx.config, feature: latest });
    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }
    await postTesterArtifacts(ctx, latest.id, report);

    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }

    if (report.overallPass) {
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        `${formatFeatureName(feature.name, featurePageUrl(ctx.config, feature.name))} passed every acceptance criterion.`,
      );
      return;
    }

    if (attempt === MAX_TEST_CYCLES) {
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        `${formatFeatureName(feature.name, featurePageUrl(ctx.config, feature.name))} still failing after ${String(MAX_TEST_CYCLES)} test cycles.`,
        "Or /egon-pivot to continue.",
      );
      return;
    }

    ctx.store.transition(feature.id, "fixing");
  }
}

async function postTesterArtifacts(
  ctx: { client: Client; config: Config; notify: (content: string) => Promise<void> },
  featureId: number,
  report: TestReport,
): Promise<void> {
  const paths = featurePaths(ctx.config.dataDir, featureId);
  const files = existsSync(paths.screenshotsDir)
    ? listCriterionScreenshots(paths.screenshotsDir).map((name) => join(paths.screenshotsDir, name))
    : [];
  const summary = formatTestReport(report);
  try {
    await postFiles(ctx.client, ctx.config.discordChannelId, files, summary);
  } catch (error) {
    console.error("failed to post tester artifacts", error);
    await ctx.notify(summary);
  }
}
