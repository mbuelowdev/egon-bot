import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client } from "discord.js";
import type { Config } from "../config.js";
import type { CursorImageFile } from "../cursor/images.js";
import { featurePaths } from "../cursor/testReport.js";
import { FeatureStore } from "../features/store.js";
import { GodotExportError } from "../godot/export.js";
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
    tester: async () => ({
      overallPass: true,
      hasFailure: false,
      criteria: [{ index: 1, status: "PASS", text: "ok" }],
      raw: "1. [PASS] ok",
    }),
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
    tester: async () => {
      throw new Error("should not test after export failure");
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
        tester: async () => {
          throw new Error("should not test");
        },
      }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(store.getFeatureById(feature.id)?.state, "exporting");
  store.close();
});

test("fix rounds attach tester screenshots as follow-up vision", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-fix-shots-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const followUps: Array<{ text: string; attachments: CursorImageFile[] | undefined }> = [];
  let tests = 0;

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
    tester: async () => {
      tests += 1;
      const paths = featurePaths(dataDir, feature.id);
      mkdirSync(paths.screenshotsDir, { recursive: true });
      writeFileSync(join(paths.screenshotsDir, "criterion-1.png"), "shot");
      writeFileSync(join(paths.screenshotsDir, "page-viewport.png"), "dump");
      if (tests === 1) {
        writeFileSync(paths.reportPath, "1. [FAIL] sprite at the wrong anchor");
        return {
          overallPass: false,
          hasFailure: true,
          criteria: [{ index: 1, status: "FAIL", text: "sprite at the wrong anchor" }],
          raw: "1. [FAIL] sprite at the wrong anchor",
        };
      }
      writeFileSync(paths.reportPath, "1. [PASS] ok");
      return {
        overallPass: true,
        hasFailure: false,
        criteria: [{ index: 1, status: "PASS", text: "ok" }],
        raw: "1. [PASS] ok",
      };
    },
  });

  assert.equal(followUps.length, 1);
  assert.match(followUps[0]?.text ?? "", /wrong anchor/);
  assert.match(followUps[0]?.text ?? "", /criterion-1\.png/);
  assert.deepEqual(followUps[0]?.attachments, [
    { storedName: "criterion-1.png", mimeType: "image/png" },
  ]);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("export-failure fix rounds do not attach leftover tester screenshots", async () => {
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
    tester: async () => {
      throw new Error("should not test after export failure");
    },
  });

  assert.equal(exports, MAX_TEST_CYCLES);
  assert.equal(attachments.length, MAX_TEST_CYCLES - 1);
  for (const batch of attachments) {
    assert.deepEqual(batch, []);
  }
  store.close();
});

test("fix rounds persist the implementer summary and hand it to the tester", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-summary-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  store.transition(feature.id, "testing");
  store.transition(feature.id, "fixing");
  const summary = [
    "Files changed:",
    "- player.gd",
    "Criteria self-verified:",
    "1. [PASS] dash distance",
    "Deviations:",
    "- none",
  ].join("\n");
  let handed: string | undefined;

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
    tester: async (options) => {
      handed = options.implementerSummary;
      return {
        overallPass: true,
        hasFailure: false,
        criteria: [{ index: 1, status: "PASS", text: "ok" }],
        raw: "1. [PASS] ok",
      };
    },
  });

  assert.equal(handed, summary);
  assert.equal(readFileSync(featurePaths(dataDir, feature.id).implementerSummaryPath, "utf8"), summary);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("the last fix round starts a fresh implementer instead of resuming", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-fresh-impl-"));
  const store = new FeatureStore(":memory:");
  const feature = featureExporting(store);
  const freshFlags: Array<boolean | undefined> = [];
  let tests = 0;

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
    tester: async () => {
      tests += 1;
      const paths = featurePaths(dataDir, feature.id);
      mkdirSync(paths.root, { recursive: true });
      writeFileSync(paths.reportPath, `1. [FAIL] still broken ${String(tests)}`);
      return {
        overallPass: tests >= MAX_TEST_CYCLES,
        hasFailure: tests < MAX_TEST_CYCLES,
        criteria: [
          {
            index: 1,
            status: tests >= MAX_TEST_CYCLES ? "PASS" : "FAIL",
            text: "still broken",
          },
        ],
        raw:
          tests >= MAX_TEST_CYCLES ? "1. [PASS] still broken" : `1. [FAIL] still broken ${String(tests)}`,
      };
    },
  });

  assert.equal(freshFlags.length, MAX_TEST_CYCLES - 1);
  assert.deepEqual(freshFlags, [false, true]);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});

test("overall PASS with unverified criteria does not claim every criterion passed", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-unverified-review-"));
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
    tester: async () => ({
      overallPass: true,
      hasFailure: false,
      criteria: [
        { index: 0, status: "PASS", text: "no SCRIPT ERROR in console" },
        { index: 1, status: "COULD_NOT_VERIFY", text: "projectile too fast" },
      ],
      raw: "0. [PASS] no SCRIPT ERROR in console\n1. [COULD NOT VERIFY] projectile too fast",
    }),
  });

  const posted = notices.join("\n");
  assert.match(posted, /could not verify 1 acceptance criterion/);
  assert.doesNotMatch(posted, /passed every acceptance criterion/);
  assert.match(posted, /COULD NOT VERIFY/);
  assert.equal(store.getFeatureById(feature.id)?.state, "awaiting_review");
  store.close();
});
