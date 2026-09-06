import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "discord.js";
import type { Config } from "../config.js";
import { runImplementer } from "../cursor/implementer.js";
import { featurePaths, type TestReport } from "../cursor/testReport.js";
import { runTester } from "../cursor/tester.js";
import { postFiles } from "../discord/channel.js";
import { discordLink } from "../discord/preview.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { PHASE_EMOJI } from "../format.js";
import { EXPORT_DIR } from "../godot/headers.js";
import { exportDebugWeb } from "../godot/export.js";
import { serveExportDir } from "../godot/serve.js";
import { shouldHaltPipeline } from "./halt.js";

export const MAX_TEST_CYCLES = 3;

async function notifyReadyForReview(
  ctx: {
    notify: (content: string) => Promise<void>;
    extraLinks: (feature: Feature) => string[];
  },
  feature: Feature,
  outcome: string,
  nextStep: string,
): Promise<void> {
  await ctx.notify(
    [
      `${PHASE_EMOJI.review} PR ready for review: **${feature.name}**.`,
      outcome,
      ...ctx.extraLinks(feature),
      nextStep,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

export async function runExportTestLoop(ctx: {
  client: Client;
  store: FeatureStore;
  config: Config;
  notify: (content: string) => Promise<void>;
  extraLinks: (feature: Feature) => string[];
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
          "The tester failed. Fix the issues in this report. Do not commit or push.",
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
      await ctx.notify(
        `${PHASE_EMOJI.testing} Testing started for **${feature.name}** at ${discordLink(`http://127.0.0.1:${String(ctx.config.webServePort)}/`)}`,
      );
      announcedTesting = true;
    }
    const latest = ctx.store.getFeatureById(feature.id) ?? feature;
    const report = await runTester({ config: ctx.config, feature: latest });
    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }
    await postTesterArtifacts(ctx, latest.id, latest.discordThreadId, report);

    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }

    if (report.overallPass) {
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        `**${feature.name}** passed every acceptance criterion.`,
        "Merge on GitHub, or /egon-pivot to steer the implementer.",
      );
      return;
    }

    if (attempt === MAX_TEST_CYCLES) {
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        `**${feature.name}** still failing after ${String(MAX_TEST_CYCLES)} test cycles.`,
        "Merge on GitHub, or /egon-pivot to continue.",
      );
      return;
    }

    ctx.store.transition(feature.id, "fixing");
  }
}

async function postTesterArtifacts(
  ctx: { client: Client; config: Config; notify: (content: string) => Promise<void> },
  featureId: number,
  threadId: string | null,
  report: TestReport,
): Promise<void> {
  const paths = featurePaths(ctx.config.dataDir, featureId);
  const files = existsSync(paths.screenshotsDir)
    ? readdirSync(paths.screenshotsDir)
        .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
        .map((name) => join(paths.screenshotsDir, name))
    : [];
  const summary = [
    report.overallPass ? "TEST_REPORT: OVERALL PASS" : "TEST_REPORT: OVERALL FAIL",
    ...report.criteria.map(
      (item) => `${String(item.index)}. [${item.status}] ${item.text}`.slice(0, 180),
    ),
  ].join("\n");
  const target = threadId ?? ctx.config.discordChannelId;
  try {
    await postFiles(ctx.client, target, files, summary.slice(0, 2000));
  } catch (error) {
    console.error("failed to post tester artifacts", error);
    await ctx.notify(summary.slice(0, 2000));
  }
}
