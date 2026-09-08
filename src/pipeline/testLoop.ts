import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Client } from "discord.js";
import { featurePageUrl, type Config } from "../config.js";
import { criterionScreenshotAttachments } from "../cursor/images.js";
import { runImplementer } from "../cursor/implementer.js";
import { persistImplementerSummary } from "../cursor/implementerSummary.js";
import {
  featurePaths,
  listDiscordProofPaths,
  parseTestReport,
  type TestReport,
} from "../cursor/testReport.js";
import { runScenarioSuite } from "../suite/runner.js";
import { regressionFailures, renderSuiteReport, type SuiteResult } from "../suite/report.js";
import { postFiles, postToChannel, removeMergeButton } from "../discord/channel.js";
import { mergeButtonRow } from "../discord/mergeButton.js";
import { recordFeatureEvent } from "../events/feature.js";
import { featureSlug } from "../features/slug.js";
import type { Feature, FeatureStore } from "../features/store.js";
import {
  formatFeatureName,
  formatReviewReady,
  formatSuitePassOutcome,
  formatTestReport,
  formatTestingStart,
} from "../format.js";
import { EXPORT_DIR } from "../godot/headers.js";
import { exportDebugWeb, GodotExportError } from "../godot/export.js";
import { refreshGameMap } from "../godot/gameMap.js";
import { serveExportDir } from "../godot/serve.js";
import { isPipelineStopError, shouldHaltPipeline } from "./halt.js";

export const MAX_TEST_CYCLES = 3;

/** Resume the same implementer through this many test cycles; later fixes start a fresh agent. */
export const FRESH_IMPLEMENTER_AFTER_CYCLE = 2;

export const EXPORT_FAILURE_HEADING = "# Godot web export failed";

export function formatExportFailureReport(detail: string): string {
  const body = detail.trim() === "" ? "(no Godot output)" : detail.trim();
  return `${EXPORT_FAILURE_HEADING}\n\n${body}\n`;
}

export function isExportFailureReport(text: string): boolean {
  return text.startsWith(EXPORT_FAILURE_HEADING);
}

function exportFailureDetail(error: unknown): string {
  if (error instanceof GodotExportError) {
    return error.output;
  }
  return error instanceof Error ? error.message : String(error);
}

function fixFollowUp(reportText: string, screenshotNames: string[] = []): string {
  if (isExportFailureReport(reportText)) {
    return [
      "Godot web export failed. Fix the export error below so headless --export-debug Web succeeds. Do not commit or push.",
      "Re-run the Godot CLI checks (import, parse-check, smoke-run, grep the log) after the fix.",
      "",
      reportText,
    ].join("\n");
  }
  const shotLine =
    screenshotNames.length > 0
      ? `Check screenshots are attached as vision (${screenshotNames.join(", ")}). Use them as evidence of the failure.`
      : undefined;
  return [
    "The scenario suite found failures. Fix only [FAIL] checks. Do not commit or push.",
    "Each failure names the scenario, the failing step, and expected vs. actual. A check marked `inherited from {slug}` belongs to an already-merged feature: your change broke it, so repair the game or that scenario rather than the check.",
    shotLine,
    "Re-run the Godot CLI checks (import, parse-check, smoke-run, run affected scenarios, grep the log) after the fix.",
    "",
    reportText,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/** Persist the suite's report in the shape the fix loop, Discord, and the catalog parse. */
function recordSuiteResult(config: Config, feature: Feature, result: SuiteResult): TestReport {
  const paths = featurePaths(config.dataDir, feature.id);
  mkdirSync(paths.root, { recursive: true });
  const raw = renderSuiteReport(result);
  writeFileSync(paths.reportPath, raw, "utf8");
  const broken = regressionFailures(result);
  if (broken.length > 0) {
    console.log(
      `feature ${String(feature.id)} broke ${String(broken.length)} inherited check(s): ${broken
        .map((entry) => `${entry.owner}/${entry.name}`)
        .join(", ")}`,
    );
  }
  return parseTestReport(raw);
}

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

type EventArgs = {
  phase: Parameters<typeof recordFeatureEvent>[0]["phase"];
  step: string;
  level?: Parameters<typeof recordFeatureEvent>[0]["level"];
  detail?: string;
  durationMs?: number;
};

export async function runExportTestLoop(ctx: {
  client: Client;
  store: FeatureStore;
  config: Config;
  notify: (content: string) => Promise<void>;
  featureId: number;
  signal?: AbortSignal;
  onFixCommit?: (feature: Feature) => Promise<void>;
  exportWeb?: (gameRepoDir: string, signal?: AbortSignal) => Promise<string>;
  serve?: (dir: string, port: number) => Promise<void>;
  implementer?: typeof runImplementer;
  suite?: typeof runScenarioSuite;
}): Promise<void> {
  const exportWeb = ctx.exportWeb ?? exportDebugWeb;
  const serve = ctx.serve ?? serveExportDir;
  const implementer = ctx.implementer ?? runImplementer;
  const suite = ctx.suite ?? runScenarioSuite;
  const haltIfNeeded = (feature: Feature): boolean =>
    Boolean(ctx.signal?.aborted) || shouldHaltPipeline(feature);
  const event = (feature: Feature, args: EventArgs): void => {
    recordFeatureEvent({ dataDir: ctx.config.dataDir, feature, ...args });
  };

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
      const followUpAttachments = isExportFailureReport(reportText)
        ? []
        : criterionScreenshotAttachments(ctx.config.dataDir, feature.id);
      const fresh = attempt > FRESH_IMPLEMENTER_AFTER_CYCLE;
      event(feature, {
        phase: "fix",
        step: `Fix round ${String(attempt - 1)} — ${fresh ? "fresh implementer" : "same implementer"}`,
        detail: reportText,
      });
      const fixStartedAt = Date.now();
      const result = await implementer({
        config: ctx.config,
        store: ctx.store,
        feature,
        followUp: fixFollowUp(
          reportText,
          followUpAttachments.map((shot) => shot.storedName),
        ),
        followUpAttachments,
        fresh,
      });
      feature = ctx.store.getFeatureById(feature.id) ?? feature;
      if (haltIfNeeded(feature)) {
        return;
      }
      if (result.status !== "finished") {
        event(feature, {
          phase: "fix",
          step: `Implementer ${result.status}`,
          level: "failure",
          detail: result.errorMessage,
          durationMs: Date.now() - fixStartedAt,
        });
        throw new Error(result.errorMessage ?? "Implementer failed during fix loop");
      }
      event(feature, {
        phase: "fix",
        step: "Implementer finished",
        level: "success",
        durationMs: Date.now() - fixStartedAt,
      });
      persistImplementerSummary(ctx.config.dataDir, feature.id, result.result);
      refreshGameMap(ctx.config);
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

    const exportStartedAt = Date.now();
    event(feature, { phase: "export", step: `Debug web export (cycle ${String(attempt)})` });
    try {
      await exportWeb(ctx.config.gameRepoDir, ctx.signal);
      event(feature, {
        phase: "export",
        step: "Export succeeded",
        level: "success",
        durationMs: Date.now() - exportStartedAt,
      });
    } catch (error) {
      if (isPipelineStopError(error)) {
        throw error;
      }
      const paths = featurePaths(ctx.config.dataDir, feature.id);
      mkdirSync(paths.root, { recursive: true });
      const detail = exportFailureDetail(error);
      writeFileSync(paths.reportPath, formatExportFailureReport(detail));
      event(feature, {
        phase: "export",
        step: "Export failed",
        level: "failure",
        detail,
        durationMs: Date.now() - exportStartedAt,
      });
      if (attempt === MAX_TEST_CYCLES) {
        event(feature, {
          phase: "review",
          step: `Web export still failing after ${String(MAX_TEST_CYCLES)} cycles — handing to humans`,
          level: "warning",
        });
        ctx.store.transition(feature.id, "awaiting_review");
        await notifyReadyForReview(
          ctx,
          feature,
          `${formatFeatureName(feature.name, featurePageUrl(ctx.config, feature.name))} web export still failing after ${String(MAX_TEST_CYCLES)} test cycles.`,
          "Or /egon-pivot to continue.",
        );
        return;
      }
      ctx.store.transition(feature.id, "fixing");
      continue;
    }

    await serve(EXPORT_DIR, ctx.config.webServePort);
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
    const suiteStartedAt = Date.now();
    event(latest, { phase: "suite", step: `Scenario suite (cycle ${String(attempt)})` });
    const suiteResult = await suite({
      gameRepoDir: ctx.config.gameRepoDir,
      port: ctx.config.webServePort,
      slug: featureSlug(latest.name),
      screenshotsDir: featurePaths(ctx.config.dataDir, latest.id).screenshotsDir,
    });
    for (const entry of suiteResult.results) {
      const scope = entry.inherited ? ` — regression from ${entry.owner}` : "";
      const step = entry.failedStep === undefined ? "" : ` (step ${String(entry.failedStep)})`;
      event(latest, {
        phase: "suite",
        step: `${entry.ok ? "PASS" : "FAIL"} ${entry.name} [${entry.scenario}]${scope}${step}`,
        level: entry.ok ? "success" : "failure",
        ...(entry.failure !== undefined ? { detail: entry.failure } : {}),
      });
    }
    if (suiteResult.scriptErrors.length > 0) {
      event(latest, {
        phase: "suite",
        step: "SCRIPT ERROR in the browser console",
        level: "failure",
        detail: suiteResult.scriptErrors.join("\n"),
      });
    }
    if (suiteResult.fatal !== undefined) {
      event(latest, {
        phase: "suite",
        step: "Suite could not run",
        level: "failure",
        detail: suiteResult.fatal,
      });
    }
    const report = recordSuiteResult(ctx.config, latest, suiteResult);
    event(latest, {
      phase: "suite",
      step: `Suite ${report.overallPass ? "PASS" : "FAIL"} — ${String(suiteResult.results.length)} checks`,
      level: report.overallPass ? "success" : "failure",
      durationMs: Date.now() - suiteStartedAt,
    });
    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }
    await postSuiteArtifacts(ctx, latest.id, report);

    feature = ctx.store.getFeatureById(feature.id) ?? feature;
    if (haltIfNeeded(feature)) {
      return;
    }

    if (report.overallPass) {
      event(feature, { phase: "review", step: "Ready for review", level: "success" });
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        formatSuitePassOutcome(
          feature.name,
          suiteResult.results.length,
          featurePageUrl(ctx.config, feature.name),
        ),
      );
      return;
    }

    if (attempt === MAX_TEST_CYCLES) {
      event(feature, {
        phase: "review",
        step: `Still failing after ${String(MAX_TEST_CYCLES)} suite cycles — handing to humans`,
        level: "warning",
      });
      ctx.store.transition(feature.id, "awaiting_review");
      await notifyReadyForReview(
        ctx,
        feature,
        `${formatFeatureName(feature.name, featurePageUrl(ctx.config, feature.name))} still failing after ${String(MAX_TEST_CYCLES)} suite cycles.`,
        "Or /egon-pivot to continue.",
      );
      return;
    }

    ctx.store.transition(feature.id, "fixing");
  }
}

async function postSuiteArtifacts(
  ctx: { client: Client; config: Config; notify: (content: string) => Promise<void> },
  featureId: number,
  report: TestReport,
): Promise<void> {
  const paths = featurePaths(ctx.config.dataDir, featureId);
  const files = listDiscordProofPaths(paths.screenshotsDir);
  const summary = formatTestReport(report);
  try {
    await postFiles(ctx.client, ctx.config.discordChannelId, files, summary);
  } catch (error) {
    console.error("failed to post suite artifacts", error);
    await ctx.notify(summary);
  }
}
