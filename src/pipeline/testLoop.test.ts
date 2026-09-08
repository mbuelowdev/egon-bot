import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client } from "discord.js";
import type { Config } from "../config.js";
import type { CursorImageFile } from "../cursor/images.js";
import { featurePaths } from "../cursor/testReport.js";
import { readEvents } from "../events/log.js";
import { FeatureStore } from "../features/store.js";
import { GodotExportError } from "../godot/export.js";
import type { SuiteCheckResult, SuiteResult } from "../suite/report.js";
import {
  formatExportFailureReport,
  isExportFailureReport,
  MAX_TEST_CYCLES,
  runExportTestLoop,
} from "./testLoop.js";

function testConfig(dataDir: string): Config {
  return {
    dataDir,
    gameRepoDir: "/tmp/game",
    webServePort: 8080,
    discordChannelId: "channel",
    featuresPublicUrl: "https://egon.example",
  } as Config;
}

function featureExporting(store: FeatureStore) {
  const feature = store.createFeature("Dash", "chan");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/dash",
    number: 1,
    url: "https://github.com/org/game/pull/1",
  });
  store.transition(feature.id, "implementing");
  store.transition(feature.id, "exporting");
  return store.getFeatureById(feature.id) ?? feature;
}

function check(overrides: Partial<SuiteCheckResult> = {}): SuiteCheckResult {
  return {
    name: "dash moves the player right",
    scenario: "default",
    owner: "dash",
    inherited: false,
    ok: true,
    screenshots: [],
    ...overrides,
  };
}

function suiteResult(results: SuiteCheckResult[], scriptErrors: string[] = []): SuiteResult {
  return { results, scriptErrors, consoleErrors: scriptErrors };
}

const suitePasses = async () => suiteResult([check()]);

test("formatExportFailureReport is detectable as an export failure", () => {
  const text = formatExportFailureReport("SCRIPT ERROR: bad scene");
  assert.equal(isExportFailureReport(text), true);
  assert.match(text, /SCRIPT ERROR: bad scene/);
  assert.equal(isExportFailureReport("1. [FAIL] jump is broken"), false);
});

test("export failure routes Godot stderr into a fix round instead of aborting", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-export-fail-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: string[] = [];
  let exports = 0;
  const notices: string[] = [];

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async (content) => {
      notices.push(content);
    },
    featureId: feature.id,
    exportWeb: async () => {
      exports += 1;
      if (exports === 1) {
        throw new GodotExportError("SCRIPT ERROR: Parse error at res://player.gd:12");
      }
      return "/tmp/egon-web/index.html";
    },
    serve: async () => {},
    implementer: async (options) => {
      followUps.push(options.followUp ?? "");
      return { status: "finished", agentId: "impl-1" };
    },
    suite: suitePasses,
  });

  assert.equal(exports, 2);
  assert.equal(followUps.length, 1);
  assert.match(followUps[0] ?? "", /Godot web export failed/);
  assert.match(followUps[0] ?? "", /SCRIPT ERROR: Parse error at res:\/\/player\.gd:12/);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  assert.match(notices.join("\n"), /Testing started/);
  store.close();
});

test("repeated export failures exhaust the retry cap without throwing", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-export-cap-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: string[] = [];
  const freshFlags: Array<boolean | undefined> = [];
  let exports = 0;
  const notices: string[] = [];

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async (content) => {
      notices.push(content);
    },
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => {
      exports += 1;
      throw new GodotExportError("ERROR: Failed to export project");
    },
    serve: async () => {
      throw new Error("should not serve after export failure");
    },
    implementer: async (options) => {
      followUps.push(options.followUp ?? "");
      freshFlags.push(options.fresh);
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      throw new Error("should not run the suite after export failure");
    },
  });

  assert.equal(exports, MAX_TEST_CYCLES);
  assert.equal(followUps.length, MAX_TEST_CYCLES - 1);
  assert.match(followUps[0] ?? "", /ERROR: Failed to export project/);
  assert.deepEqual(freshFlags, [false, true]);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  assert.match(notices.join("\n"), /web export still failing/);
  const report = readFileSync(featurePaths(dataDir, feature.id).reportPath, "utf8");
  assert.equal(isExportFailureReport(report), true);
  store.close();
});

test("export abort still propagates", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-export-abort-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";

  await assert.rejects(
    () =>
      runExportTestLoop({
        client: {} as Client,
        store,
        config: testConfig(dataDir),
        notify: async () => {
          throw new Error("should not notify");
        },
        featureId: feature.id,
        exportWeb: async () => {
          throw abort;
        },
        serve: async () => {
          throw new Error("should not serve");
        },
        implementer: async () => {
          throw new Error("should not implement");
        },
        suite: async () => {
          throw new Error("should not run the suite");
        },
      }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(store.getFeatureById(feature.id)?.state, "exporting");
  store.close();
});

test("fix rounds attach check screenshots as follow-up vision", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-fix-shots-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: Array<{ text: string; attachments: CursorImageFile[] | undefined }> = [];
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async (options) => {
      followUps.push({
        text: options.followUp ?? "",
        attachments: options.followUpAttachments,
      });
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      runs += 1;
      const paths = featurePaths(dataDir, feature.id);
      mkdirSync(paths.screenshotsDir, { recursive: true });
      writeFileSync(join(paths.screenshotsDir, "criterion-1.png"), "shot");
      writeFileSync(join(paths.screenshotsDir, "page-viewport.png"), "dump");
      if (runs === 1) {
        return suiteResult([
          check({
            ok: false,
            failedStep: 2,
            failure: "expect window.__egon.state().anchor equals \"left\" — expected \"left\", actual \"right\"",
            screenshots: ["criterion-1.png"],
          }),
        ]);
      }
      return suiteResult([check()]);
    },
  });

  assert.equal(followUps.length, 1);
  assert.match(followUps[0]?.text ?? "", /anchor/);
  assert.match(followUps[0]?.text ?? "", /criterion-1\.png/);
  assert.deepEqual(followUps[0]?.attachments, [
    { storedName: "criterion-1.png", mimeType: "image/png" },
  ]);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("export-failure fix rounds do not attach leftover screenshots", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-export-stale-shots-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const paths = featurePaths(dataDir, feature.id);
  mkdirSync(paths.screenshotsDir, { recursive: true });
  writeFileSync(join(paths.screenshotsDir, "criterion-1.png"), "stale");
  const attachments: Array<CursorImageFile[] | undefined> = [];
  let exports = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => {
      exports += 1;
      throw new GodotExportError("ERROR: Failed to export project");
    },
    serve: async () => {
      throw new Error("should not serve after export failure");
    },
    implementer: async (options) => {
      attachments.push(options.followUpAttachments);
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      throw new Error("should not run the suite after export failure");
    },
  });

  assert.equal(exports, MAX_TEST_CYCLES);
  assert.equal(attachments.length, MAX_TEST_CYCLES - 1);
  for (const batch of attachments) {
    assert.deepEqual(batch, []);
  }
  store.close();
});

test("fix rounds persist the implementer summary", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-summary-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  store.transition(feature.id, "testing");
  store.transition(feature.id, "fixing");
  const summary = [
    "Files changed:",
    "- player.gd",
    "Scenarios verified:",
    "- default",
    "Deviations:",
    "- none",
  ].join("\n");

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async () => ({
      status: "finished",
      result: summary,
      agentId: "impl-1",
    }),
    suite: suitePasses,
  });

  assert.equal(readFileSync(featurePaths(dataDir, feature.id).implementerSummaryPath, "utf8"), summary);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("the last fix round starts a fresh implementer instead of resuming", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-fresh-impl-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const freshFlags: Array<boolean | undefined> = [];
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async (options) => {
      freshFlags.push(options.fresh);
      return { status: "finished", agentId: `impl-${String(freshFlags.length)}` };
    },
    suite: async () => {
      runs += 1;
      return runs >= MAX_TEST_CYCLES
        ? suiteResult([check()])
        : suiteResult([check({ ok: false, failedStep: 1, failure: "still broken" })]);
    },
  });

  assert.equal(freshFlags.length, MAX_TEST_CYCLES - 1);
  assert.deepEqual(freshFlags, [false, true]);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("a passing suite names the check count in the review-ready message", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-pass-review-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const notices: string[] = [];

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async (content) => {
      notices.push(content);
    },
    featureId: feature.id,
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async () => {
      throw new Error("should not implement");
    },
    suite: async () =>
      suiteResult([check({ name: "one" }), check({ name: "two" }), check({ name: "three" })]),
  });

  const posted = notices.join("\n");
  assert.match(posted, /passed all 3 checks/);
  // COULD NOT VERIFY is gone: a deterministic step either asserts or fails.
  assert.doesNotMatch(posted, /COULD NOT VERIFY/);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("a build that never boots fails its checks and goes back to the implementer", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-suite-boot-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: string[] = [];
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async (options) => {
      followUps.push(options.followUp ?? "");
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      runs += 1;
      return suiteResult([
        check({
          ok: false,
          failure: "game did not boot (status-notice: Missing features: SharedArrayBuffer)",
        }),
      ]);
    },
  });

  assert.equal(runs, MAX_TEST_CYCLES);
  assert.equal(followUps.length, MAX_TEST_CYCLES - 1);
  assert.match(followUps[0] ?? "", /game did not boot/);
  assert.match(followUps[0] ?? "", /Missing features: SharedArrayBuffer/);
  const report = readFileSync(featurePaths(dataDir, feature.id).reportPath, "utf8");
  assert.match(report, /OVERALL: FAIL/);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("a missing bridge fails the check and names the missing hook", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-suite-bridge-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: string[] = [];
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async (options) => {
      followUps.push(options.followUp ?? "");
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      runs += 1;
      // The implementer wires the bridge up on the first fix round.
      return runs === 1
        ? suiteResult([
            check({
              ok: false,
              failure: "window.__egon.state is missing — the debug bridge was never registered",
            }),
          ])
        : suiteResult([check()]);
    },
  });

  assert.equal(runs, 2);
  assert.equal(followUps.length, 1);
  assert.match(followUps[0] ?? "", /window\.__egon\.state is missing/);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("a broken inherited check is reported as a regression the implementer must repair", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-suite-regression-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: string[] = [];
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async (options) => {
      followUps.push(options.followUp ?? "");
      return { status: "finished", agentId: "impl-1" };
    },
    suite: async () => {
      runs += 1;
      return runs === 1
        ? suiteResult([
            check(),
            check({
              name: "victory screen shows the score",
              scenario: "endgame_victory",
              owner: "endgame-screen",
              inherited: true,
              ok: false,
              failedStep: 3,
              failure: "expect window.__egon.state().score equals 4200 — expected 4200, actual 0",
            }),
          ])
        : suiteResult([check()]);
    },
  });

  assert.equal(runs, 2);
  assert.equal(followUps.length, 1);
  const followUp = followUps[0] ?? "";
  assert.match(followUp, /inherited from endgame-screen/);
  assert.match(followUp, /expected 4200, actual 0/);
  assert.match(followUp, /belongs to an already-merged feature/);
  store.close();
});

test("the loop records pipeline events for export, suite checks, fixes, and review", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-loop-events-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  let runs = 0;

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => "/tmp/egon-web/index.html",
    serve: async () => {},
    implementer: async () => ({ status: "finished", agentId: "impl-1" }),
    suite: async () => {
      runs += 1;
      return runs === 1
        ? suiteResult([
            check({
              ok: false,
              failedStep: 2,
              failure: "expect window.__egon.state().score equals 4200 — expected 4200, actual 0",
            }),
          ])
        : suiteResult([check()]);
    },
  });

  const events = readEvents(dataDir);
  const steps = events.map((entry) => entry.step);
  assert.ok(events.length > 0, "the loop recorded no events");
  assert.ok(steps.some((step) => /Debug web export \(cycle 1\)/.test(step)));
  assert.ok(steps.some((step) => step === "Export succeeded"));
  assert.ok(steps.some((step) => /^FAIL dash moves the player right/.test(step)));
  assert.ok(steps.some((step) => /^Fix round 1/.test(step)));
  assert.ok(steps.some((step) => step === "Ready for review"));
  // Every event carries the identity the /events page groups on.
  for (const entry of events) {
    assert.equal(entry.featureId, feature.id);
    assert.equal(entry.slug, "dash");
  }
  const failing = events.find((entry) => entry.step.startsWith("FAIL "));
  assert.match(failing?.detail ?? "", /expected 4200, actual 0/);
  assert.equal(failing?.level, "failure");
  store.close();
});

test("an export failure is recorded with Godot's stderr as the detail", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-loop-export-events-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);

  await runExportTestLoop({
    client: {} as Client,
    store,
    config: testConfig(dataDir),
    notify: async () => {},
    featureId: feature.id,
    onFixCommit: async () => {},
    exportWeb: async () => {
      throw new GodotExportError("ERROR: Failed to export project");
    },
    serve: async () => {},
    implementer: async () => ({ status: "finished", agentId: "impl-1" }),
    suite: async () => {
      throw new Error("should not run the suite after export failure");
    },
  });

  const events = readEvents(dataDir);
  const failure = events.find((entry) => entry.step === "Export failed");
  assert.equal(failure?.level, "failure");
  assert.match(failure?.detail ?? "", /Failed to export project/);
  assert.ok(events.some((entry) => /handing to humans/.test(entry.step)));
  store.close();
});
