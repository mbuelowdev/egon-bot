import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client } from "discord.js";
import { ClaudeUsageLimitError } from "../claude/usageLimit.js";
import type { Config } from "../config.js";
import type { AskUsersDeps } from "../cursor/askQuestions.js";
import { FeatureStore } from "../features/store.js";
import { requiredSpecHeadings, type SpecValidation } from "../features/specValidate.js";
import { runFeaturePlanner } from "./runPlanner.js";

function emptyDeps(store: FeatureStore, featureId: number): AskUsersDeps {
  return {
    client: {} as Client,
    store,
    config: {} as Config,
    featureId,
  };
}

const acceptSpec = (): SpecValidation => ({ ok: true });

test("existing Cursor plannerBackend never calls Claude", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "cursor");
  store.setPlannerAgentId(feature.id, "cursor-agent");
  let claudeCalls = 0;
  let cursorCalls = 0;
  const result = await runFeaturePlanner({
    config: {} as Config,
    store,
    feature: store.getFeatureById(feature.id) ?? feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async () => {
      throw new Error("should not notify");
    },
    inspectSpec: acceptSpec,
    runners: {
      claude: async () => {
        claudeCalls += 1;
        throw new Error("Claude should not run");
      },
      cursor: async () => {
        cursorCalls += 1;
        return { marker: "PLAN_COMPLETE", agentId: "cursor-agent" };
      },
    },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(cursorCalls, 1);
  assert.equal(result.marker, "PLAN_COMPLETE");
  store.close();
});

test("Claude startup usage error runs Cursor and notifies Discord", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const notes: string[] = [];
  let cursorGotAppendix: string | undefined;
  const result = await runFeaturePlanner({
    config: {} as Config,
    store,
    feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async (content) => {
      notes.push(content);
    },
    catalogUrl: "https://egon.example/features/dash",
    inspectSpec: acceptSpec,
    runners: {
      claude: async () => {
        throw new ClaudeUsageLimitError("You have reached your specified API usage limits", false);
      },
      cursor: async (options) => {
        cursorGotAppendix = options.answersAppendix;
        assert.equal(options.feature.plannerAgentId, null);
        return { marker: "PLAN_COMPLETE", agentId: "cursor-1" };
      },
    },
  });
  assert.equal(result.agentId, "cursor-1");
  assert.equal(notes.length, 1);
  assert.match(notes[0] ?? "", /Falling back to the Cursor planner/);
  assert.equal(store.getFeatureById(feature.id)?.plannerBackend, "cursor");
  assert.equal(cursorGotAppendix, undefined);
  store.close();
});

test("usage limit after Claude already started does not fall back", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "claude");
  store.setPlannerAgentId(feature.id, "claude-session");
  let cursorCalls = 0;
  await assert.rejects(
    () =>
      runFeaturePlanner({
        config: {} as Config,
        store,
        feature: store.getFeatureById(feature.id) ?? feature,
        deps: emptyDeps(store, feature.id),
        resume: true,
        notify: async () => {
          throw new Error("should not notify");
        },
        inspectSpec: acceptSpec,
        runners: {
          claude: async () => {
            throw new ClaudeUsageLimitError("spend cap", true);
          },
          cursor: async () => {
            cursorCalls += 1;
            return { marker: "PLAN_COMPLETE", agentId: "cursor-1" };
          },
        },
      }),
    (error: unknown) => error instanceof ClaudeUsageLimitError,
  );
  assert.equal(cursorCalls, 0);
  store.close();
});

test("invalid SPEC after PLAN_COMPLETE sends one targeted follow-up", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "cursor");
  store.setPlannerAgentId(feature.id, "cursor-agent");
  const followUps: Array<string | undefined> = [];
  let inspectCalls = 0;
  const result = await runFeaturePlanner({
    config: {} as Config,
    store,
    feature: store.getFeatureById(feature.id) ?? feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async () => {
      throw new Error("should not notify");
    },
    inspectSpec: () => {
      inspectCalls += 1;
      if (inspectCalls === 1) {
        return {
          ok: false,
          problems: [
            "Missing heading: ## 4. Interface / Contract",
            "Acceptance criteria has 4 numbered items; at most 3 are allowed",
            "Leftover template placeholder: {Feature name}",
          ],
        };
      }
      return { ok: true };
    },
    runners: {
      claude: async () => {
        throw new Error("Claude should not run");
      },
      cursor: async (options) => {
        followUps.push(options.followUp);
        return { marker: "PLAN_COMPLETE", agentId: "cursor-agent" };
      },
    },
  });
  assert.equal(result.marker, "PLAN_COMPLETE");
  assert.equal(followUps.length, 2);
  assert.equal(followUps[0], undefined);
  assert.match(followUps[1] ?? "", /Missing heading: ## 4\. Interface \/ Contract/);
  assert.match(followUps[1] ?? "", /4 numbered items/);
  assert.match(followUps[1] ?? "", /Leftover template placeholder: \{Feature name\}/);
  assert.equal(inspectCalls, 2);
  store.close();
});

test("spec still invalid after one follow-up is PLAN_BLOCKED", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "cursor");
  store.setPlannerAgentId(feature.id, "cursor-agent");
  let cursorCalls = 0;
  const result = await runFeaturePlanner({
    config: {} as Config,
    store,
    feature: store.getFeatureById(feature.id) ?? feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async () => {
      throw new Error("should not notify");
    },
    inspectSpec: () => ({
      ok: false,
      problems: ["Missing heading: ## 1. Context & Goal"],
    }),
    runners: {
      claude: async () => {
        throw new Error("Claude should not run");
      },
      cursor: async () => {
        cursorCalls += 1;
        return { marker: "PLAN_COMPLETE", agentId: "cursor-agent" };
      },
    },
  });
  assert.equal(cursorCalls, 2);
  assert.equal(result.marker, "PLAN_BLOCKED");
  assert.match(result.text ?? "", /Missing heading: ## 1\. Context & Goal/);
  store.close();
});

test("PLAN_BLOCKED skips the spec gate", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "cursor");
  store.setPlannerAgentId(feature.id, "cursor-agent");
  let inspectCalls = 0;
  const result = await runFeaturePlanner({
    config: {} as Config,
    store,
    feature: store.getFeatureById(feature.id) ?? feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async () => {
      throw new Error("should not notify");
    },
    inspectSpec: () => {
      inspectCalls += 1;
      return { ok: false, problems: ["should not inspect"] };
    },
    runners: {
      claude: async () => {
        throw new Error("Claude should not run");
      },
      cursor: async () => ({ marker: "PLAN_BLOCKED", agentId: "cursor-agent" }),
    },
  });
  assert.equal(result.marker, "PLAN_BLOCKED");
  assert.equal(inspectCalls, 0);
  store.close();
});

test("default inspect reads the game-repo SPEC and follow-up rewrites it", async () => {
  const root = mkdtempSync(join(tmpdir(), "egon-plan-spec-"));
  const gameRepoDir = join(root, "game");
  const specDir = join(gameRepoDir, "docs", "features", "dash");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "SPEC.md"), "# Dash\n\n## Goal\n\ncustom headings\n");
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerBackend(feature.id, "cursor");
  store.setPlannerAgentId(feature.id, "cursor-agent");
  const followUps: Array<string | undefined> = [];
  const result = await runFeaturePlanner({
    config: { gameRepoDir, dataDir: join(root, "data") } as Config,
    store,
    feature: store.getFeatureById(feature.id) ?? feature,
    deps: emptyDeps(store, feature.id),
    resume: false,
    notify: async () => {
      throw new Error("should not notify");
    },
    runners: {
      claude: async () => {
        throw new Error("Claude should not run");
      },
      cursor: async (options) => {
        followUps.push(options.followUp);
        if (options.followUp) {
          const chunks = ["# Dash", ""];
          for (const heading of requiredSpecHeadings()) {
            chunks.push(heading, "");
            if (heading.endsWith("Acceptance criteria")) {
              chunks.push("1. The game reports ready once the scene has loaded.", "");
            } else if (heading.endsWith("Test scenarios")) {
              chunks.push("- `default` (existing) — the game as it normally boots.", "");
            } else if (heading.endsWith("Verification hooks")) {
              chunks.push(
                '- Mechanism: `EgonBridge.register_field("ready", func(): return _ready)`.',
                "- Call: `window.__egon.state()` returns JSON.",
                "",
              );
            } else {
              chunks.push("Filled.", "");
            }
          }
          writeFileSync(join(specDir, "SPEC.md"), chunks.join("\n"));
          mkdirSync(join(gameRepoDir, "egon", "checks"), { recursive: true });
          writeFileSync(
            join(gameRepoDir, "egon", "checks", "dash.json"),
            JSON.stringify([
              {
                name: "the game reports ready",
                scenario: "default",
                steps: [{ await: "window.__egon.state().ready", equals: true }],
              },
            ]),
          );
        }
        return { marker: "PLAN_COMPLETE", agentId: "cursor-agent" };
      },
    },
  });
  assert.equal(result.marker, "PLAN_COMPLETE");
  assert.equal(followUps.length, 2);
  assert.match(followUps[1] ?? "", /Missing heading: ## 1\. Context & Goal/);
  store.close();
});
