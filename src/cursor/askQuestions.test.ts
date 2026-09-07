import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client } from "discord.js";
import type { Config } from "../config.js";
import { deliverQuestionAnswer } from "../discord/qaWaiters.js";
import { FeatureStore } from "../features/store.js";
import {
  ASK_BUDGET_EXHAUSTED,
  MAX_ASK_QUESTIONS,
  askDiscordQuestionRound,
  formatHumansAnswered,
  formatQuestionBodies,
  parsePlannerQuestions,
  remainingAskBudget,
  type AskUsersDeps,
} from "./askQuestions.js";

function depsFor(
  store: FeatureStore,
  featureId: number,
  extras: Partial<AskUsersDeps> = {},
): AskUsersDeps {
  return {
    client: {} as Client,
    store,
    config: {} as Config,
    featureId,
    ...extras,
  };
}

test("parsePlannerQuestions requires a questions array", () => {
  assert.deepEqual(parsePlannerQuestions({ question: "solo" }), {
    error: "questions must be a non-empty array",
  });
  assert.deepEqual(parsePlannerQuestions({ questions: [] }), {
    error: "questions must be a non-empty array",
  });
  const parsed = parsePlannerQuestions({
    questions: [
      { question: "Jump height?", choices: ["1. Low", "High"] },
      { question: "Color?", default: "Red" },
    ],
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0]?.choices, ["Low", "High"]);
  assert.equal(parsed[0]?.default, "Low");
  assert.deepEqual(parsed[1]?.choices, []);
  assert.equal(parsed[1]?.default, "Red");
});

test("parsePlannerQuestions keeps a global topic", () => {
  const parsed = parsePlannerQuestions({
    questions: [{ question: "Art style?", default: "pixel", topic: "art-style" }],
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed[0]?.topic, "art-style");
  const ignored = parsePlannerQuestions({
    questions: [{ question: "Jump?", default: "64", topic: "jump-height" }],
  });
  assert.ok(!("error" in ignored));
  assert.equal(ignored[0]?.topic, undefined);
});

test("parsePlannerQuestions requires a default or a first choice", () => {
  assert.deepEqual(parsePlannerQuestions({ questions: [{ question: "Color?" }] }), {
    error: "each item needs a non-empty default (or a first choice to use as the default)",
  });
});

test("parsePlannerQuestions caps the total question count", () => {
  const questions = Array.from({ length: MAX_ASK_QUESTIONS + 1 }, (_, i) => ({
    question: `Q${String(i + 1)}?`,
    default: "A",
  }));
  assert.deepEqual(parsePlannerQuestions({ questions }), {
    error: `at most ${String(MAX_ASK_QUESTIONS)} questions total; pick the most important and put defaults on the rest`,
  });
});

test("formatHumansAnswered lists every Q and A", () => {
  assert.equal(
    formatHumansAnswered(["Jump height?", "Color?"], ["High", "Red"]),
    ["The humans answered:", "Q1: Jump height?", "A1: High", "Q2: Color?", "A2: Red"].join("\n"),
  );
});

test("formatQuestionBodies appends the stated default", () => {
  const bodies = formatQuestionBodies([
    { question: "Jump height?", choices: ["Low", "High"], default: "High" },
  ]);
  assert.match(bodies[0] ?? "", /Jump height/);
  assert.match(bodies[0] ?? "", /Default if unanswered: High/);
});

test("question batch round-trips on the feature store", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.setQuestionBatch(feature.id, {
    questions: [{ question: "Size?", choices: ["S", "M"], default: "M", topic: "art-style" }],
    answers: [],
    index: 0,
  });
  const loaded = store.getFeatureById(feature.id);
  assert.equal(loaded?.pendingQuestionBatch?.questions[0]?.question, "Size?");
  assert.deepEqual(loaded?.pendingQuestionBatch?.questions[0]?.choices, ["S", "M"]);
  assert.equal(loaded?.pendingQuestionBatch?.questions[0]?.default, "M");
  assert.equal(loaded?.pendingQuestionBatch?.questions[0]?.topic, "art-style");
  store.setQuestionBatch(feature.id, null);
  assert.equal(store.getFeatureById(feature.id)?.pendingQuestionBatch, null);
  store.close();
});

test("askDiscordQuestionRound posts one Discord question at a time and returns after all answers", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const posted: string[] = [];
  const text = await askDiscordQuestionRound(
    depsFor(store, feature.id, {
      postQuestion: async (_feature, question) => {
        posted.push(question);
        const n = posted.length;
        setTimeout(() => {
          deliverQuestionAnswer(feature.id, n === 1 ? "High" : "Red");
        }, 5);
      },
    }),
    [
      { question: "Jump height?", choices: ["Low", "High"], default: "High" },
      { question: "Color?", choices: [], default: "Red" },
    ],
  );
  assert.equal(posted.length, 2);
  assert.match(posted[0] ?? "", /Jump height/);
  assert.match(posted[0] ?? "", /Default if unanswered: High/);
  assert.match(posted[1] ?? "", /Color/);
  assert.match(text, /A1: High/);
  assert.match(text, /A2: Red/);
  assert.equal(store.getFeatureById(feature.id)?.pendingQuestion, null);
  assert.equal(store.getFeatureById(feature.id)?.pendingQuestionBatch, null);
  assert.equal(store.getFeatureById(feature.id)?.plannerAskRounds, 1);
  assert.equal(store.getFeatureById(feature.id)?.plannerAskQuestions, 2);
  store.close();
});

test("answered global questions accumulate docs/GAME_DECISIONS.md", async () => {
  const gameRepoDir = mkdtempSync(join(tmpdir(), "egon-ask-decisions-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  await askDiscordQuestionRound(
    depsFor(store, feature.id, {
      config: { gameRepoDir } as Config,
      postQuestion: async () => {
        setTimeout(() => {
          deliverQuestionAnswer(feature.id, "pixel art");
        }, 5);
      },
    }),
    [{ question: "Art style?", choices: [], default: "pixel", topic: "art-style" }],
  );
  const written = readFileSync(join(gameRepoDir, "docs", "GAME_DECISIONS.md"), "utf8");
  assert.match(written, /## Art style\n\npixel art/);
  store.close();
});

test("unanswered questions use the stated default and skip the rest of the round", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const posted: string[] = [];
  const text = await askDiscordQuestionRound(
    depsFor(store, feature.id, {
      questionTimeoutMs: 20,
      postQuestion: async (_feature, question) => {
        posted.push(question);
      },
    }),
    [
      { question: "Jump height?", choices: ["Low", "High"], default: "High" },
      { question: "Color?", choices: [], default: "Red" },
    ],
  );
  assert.equal(posted.length, 1);
  assert.match(text, /using default: High/);
  assert.match(text, /using default: Red/);
  assert.equal(store.getFeatureById(feature.id)?.pendingQuestion, null);
  store.close();
});

test("a third ask round is refused so the planner uses defaults", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const posted: string[] = [];
  const roundDeps = depsFor(store, feature.id, {
    postQuestion: async (_feature, question) => {
      posted.push(question);
      setTimeout(() => {
        deliverQuestionAnswer(feature.id, "ok");
      }, 5);
    },
  });
  await askDiscordQuestionRound(roundDeps, [{ question: "One?", choices: [], default: "a" }]);
  await askDiscordQuestionRound(roundDeps, [{ question: "Two?", choices: [], default: "b" }]);
  const third = await askDiscordQuestionRound(roundDeps, [
    { question: "Three?", choices: [], default: "c" },
  ]);
  assert.equal(posted.length, 2);
  assert.equal(third, ASK_BUDGET_EXHAUSTED);
  assert.equal(store.getFeatureById(feature.id)?.plannerAskRounds, 2);
  store.close();
});

test("remaining question budget slices a round that would exceed 5 total", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.addPlannerAskUsage(feature.id, 4);
  const posted: string[] = [];
  const text = await askDiscordQuestionRound(
    depsFor(store, feature.id, {
      postQuestion: async (_feature, question) => {
        posted.push(question);
        setTimeout(() => {
          deliverQuestionAnswer(feature.id, "kept");
        }, 5);
      },
    }),
    [
      { question: "Keep?", choices: [], default: "yes" },
      { question: "Drop?", choices: [], default: "no" },
    ],
  );
  assert.equal(posted.length, 1);
  assert.match(posted[0] ?? "", /Keep/);
  assert.match(text, /A1: kept/);
  assert.match(text, /1 extra question/);
  assert.equal(store.getFeatureById(feature.id)?.plannerAskQuestions, 5);
  store.close();
});

test("remainingAskBudget clamps at the documented caps", () => {
  assert.deepEqual(remainingAskBudget(0, 0), { rounds: 2, questions: 5 });
  assert.deepEqual(remainingAskBudget(2, 3), { rounds: 0, questions: 2 });
  assert.deepEqual(remainingAskBudget(1, 5), { rounds: 1, questions: 0 });
});
