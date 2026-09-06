import assert from "node:assert/strict";
import { test } from "node:test";
import { FeatureStore } from "./store.js";

function openStore(): FeatureStore {
  return new FeatureStore(":memory:");
}

test("create feature is collecting and becomes channel latest", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  assert.equal(feature.state, "collecting");
  assert.equal(store.getLatestFeatureForChannel("channel-1")?.id, feature.id);
  store.close();
});

test("add note to latest and list open features with counts", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  store.addNote(feature.id, "need a HUD");
  store.addNote(feature.id, "and a map");
  const listed = store.listOpenFeatures();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.name, "dash");
  assert.equal(listed[0]?.noteCount, 2);
  store.close();
});

test("plan takes the pipeline lock and rejects a second plan", () => {
  const store = openStore();
  const a = store.createFeature("one", "channel-1");
  const b = store.createFeature("two", "channel-1");
  store.startPlanning(a.id);
  assert.equal(store.getPipelineLock()?.feature.name, "one");
  assert.throws(() => store.startPlanning(b.id), /Pipeline is busy/);
  store.releasePipelineLock();
  assert.equal(store.getPipelineLock(), undefined);
  store.close();
});

test("first thread answer is persisted once", () => {
  const store = openStore();
  const feature = store.createFeature("qa", "channel-1");
  store.setDiscordIds(feature.id, { messageId: "m1", threadId: "t1" });
  store.setPendingQuestion(feature.id, "What size?");
  const first = store.recordFirstThreadAnswer("t1", "a1", "yes, do that");
  assert.equal(first?.answerMessageId, "a1");
  assert.equal(first?.pendingAnswer, "yes, do that");
  const second = store.recordFirstThreadAnswer("t1", "a2", "another");
  assert.equal(second, undefined);
  assert.equal(store.listOpenFeatures()[0]?.noteCount, 1);
  store.close();
});

test("agent ids and pending question round-trip", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  store.setPlannerAgentId(feature.id, "planner-1");
  store.setImplementerAgentId(feature.id, "impl-1");
  store.setPendingQuestion(feature.id, "Which font?");
  const loaded = store.getFeatureById(feature.id);
  assert.equal(loaded?.plannerAgentId, "planner-1");
  assert.equal(loaded?.implementerAgentId, "impl-1");
  assert.equal(loaded?.pendingQuestion, "Which font?");
  store.close();
});

test("github PR fields round-trip and lookup", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  store.setGithubPr(feature.id, {
    branch: "egon/dash",
    number: 12,
    url: "https://github.com/org/game/pull/12",
  });
  const loaded = store.getFeatureById(feature.id);
  assert.equal(loaded?.githubBranch, "egon/dash");
  assert.equal(loaded?.githubPrNumber, 12);
  assert.equal(loaded?.githubPrUrl, "https://github.com/org/game/pull/12");
  assert.equal(store.getFeatureByPrNumber(12)?.id, feature.id);
  assert.equal(store.listFeaturesAwaitingGithub().length, 1);
  store.transition(feature.id, "planning");
  store.transition(feature.id, "implementing");
  store.transition(feature.id, "accepted");
  assert.equal(store.listFeaturesAwaitingGithub().length, 0);
  store.close();
});
