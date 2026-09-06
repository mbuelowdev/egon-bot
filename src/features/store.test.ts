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
  assert.equal(store.countAcceptedFeatures(), 1);
  store.close();
});

test("agent run tokens sum uniquely by run id", () => {
  const store = openStore();
  store.recordAgentRunTokens("run-1", "agent-a", 1500, 1_000);
  store.recordAgentRunTokens("run-2", "agent-a", 500, 2_500);
  store.recordAgentRunTokens("run-1", "agent-a", 1600, 1_200);
  store.recordAgentRunTokens("run-3", "agent-b", undefined);
  assert.equal(store.totalAgentTokens(), 2100);
  assert.equal(store.totalAgentDurationMs(), 3_700);
  assert.equal(store.countAcceptedFeatures(), 0);
  store.close();
});

test("stopPipelineWork during planning returns to collecting and releases the lock", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  store.startPlanning(feature.id);
  store.setPlannerAgentId(feature.id, "planner-1");
  store.setPendingQuestion(feature.id, "Which font?");
  const result = store.stopPipelineWork();
  assert.equal(result.feature.state, "collecting");
  assert.equal(result.releasedLock, true);
  assert.equal(result.feature.plannerAgentId, null);
  assert.equal(result.feature.pendingQuestion, null);
  assert.equal(store.getPipelineLock(), undefined);
  store.close();
});

test("stopPipelineWork after a PR parks the feature in awaiting_review", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/dash",
    number: 3,
    url: "https://example.com/3",
  });
  store.transition(feature.id, "implementing");
  const result = store.stopPipelineWork();
  assert.equal(result.feature.state, "awaiting_review");
  assert.equal(result.releasedLock, false);
  assert.equal(store.getPipelineLock()?.feature.id, feature.id);
  store.close();
});

test("deleteCollectingFeature removes notes and channel latest", () => {
  const store = openStore();
  const keep = store.createFeature("keep me", "channel-1");
  const gone = store.createFeature("drop me", "channel-1");
  store.addNote(gone.id, "scratch idea");
  assert.equal(store.getLatestFeatureForChannel("channel-1")?.id, gone.id);
  const deleted = store.deleteCollectingFeature(gone.id);
  assert.equal(deleted.name, "drop me");
  assert.equal(store.getFeatureById(gone.id), undefined);
  assert.equal(store.listNotes(gone.id).length, 0);
  assert.equal(store.getLatestFeatureForChannel("channel-1"), undefined);
  assert.equal(store.getFeatureById(keep.id)?.name, "keep me");
  store.close();
});

test("deleteCollectingFeature rejects planned features", () => {
  const store = openStore();
  const feature = store.createFeature("hud", "channel-1");
  store.startPlanning(feature.id);
  assert.throws(() => store.deleteCollectingFeature(feature.id), /Only collecting features/);
  assert.equal(store.getFeatureById(feature.id)?.state, "planning");
  store.close();
});

test("stopPipelineWork rejects when idle or awaiting review", () => {
  const store = openStore();
  store.createFeature("dash", "channel-1");
  assert.throws(() => store.stopPipelineWork(), /Nothing to stop/);
  const planned = store.createFeature("hud", "channel-1");
  store.startPlanning(planned.id);
  store.setGithubPr(planned.id, {
    branch: "egon/hud",
    number: 4,
    url: "https://example.com/4",
  });
  store.transition(planned.id, "implementing");
  store.transition(planned.id, "exporting");
  store.transition(planned.id, "testing");
  store.transition(planned.id, "awaiting_review");
  assert.throws(() => store.stopPipelineWork(), /awaiting_review/);
  store.close();
});
