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

test("first question answer is persisted once", () => {
  const store = openStore();
  const feature = store.createFeature("qa", "channel-1");
  store.setDiscordIds(feature.id, { messageId: "m1" });
  store.setPendingQuestion(feature.id, "What size?");
  const first = store.recordFirstAnswer(feature.id, "a1", "yes, do that");
  assert.equal(first?.answerMessageId, "a1");
  assert.equal(first?.pendingAnswer, "yes, do that");
  const second = store.recordFirstAnswer(feature.id, "a2", "another");
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
  store.setGithubBranch(feature.id, "egon/dash-20260906T173633Z");
  assert.equal(store.getFeatureById(feature.id)?.githubBranch, "egon/dash-20260906T173633Z");
  store.setGithubPr(feature.id, {
    branch: "egon/dash-20260906T173633Z",
    number: 12,
    url: "https://github.com/org/game/pull/12",
  });
  const loaded = store.getFeatureById(feature.id);
  assert.equal(loaded?.githubBranch, "egon/dash-20260906T173633Z");
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

test("deleteFeature removes notes, attachments, and channel latest", () => {
  const store = openStore();
  const keep = store.createFeature("keep me", "channel-1");
  const gone = store.createFeature("drop me", "channel-1");
  store.addNote(gone.id, "scratch idea");
  store.addAttachment(gone.id, {
    filename: "mock.png",
    mimeType: "image/png",
    storedName: "abc.png",
  });
  assert.equal(store.getLatestFeatureForChannel("channel-1")?.id, gone.id);
  const deleted = store.deleteFeature(gone.id);
  assert.equal(deleted.name, "drop me");
  assert.equal(store.getFeatureById(gone.id), undefined);
  assert.equal(store.listNotes(gone.id).length, 0);
  assert.equal(store.listAttachments(gone.id).length, 0);
  assert.equal(store.getLatestFeatureForChannel("channel-1"), undefined);
  assert.equal(store.getFeatureById(keep.id)?.name, "keep me");
  store.close();
});

test("add and list attachments", () => {
  const store = openStore();
  const feature = store.createFeature("dash", "channel-1");
  const first = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  store.addAttachment(feature.id, {
    filename: "map.jpg",
    mimeType: "image/jpeg",
    storedName: "222.jpg",
  });
  const listed = store.listAttachments(feature.id);
  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.id, first.id);
  assert.equal(listed[0]?.filename, "hud.png");
  assert.equal(listed[0]?.mimeType, "image/png");
  assert.equal(listed[0]?.storedName, "111.png");
  assert.equal(listed[1]?.filename, "map.jpg");
  assert.throws(
    () => store.addAttachment(feature.id, { filename: "x.png", mimeType: "image/png", storedName: "../x.png" }),
    /Invalid attachment name/,
  );
  store.close();
});

test("deleteFeature removes planned features and releases the lock", () => {
  const store = openStore();
  const feature = store.createFeature("hud", "channel-1");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/hud",
    number: 4,
    url: "https://example.com/4",
  });
  store.deleteFeature(feature.id);
  assert.equal(store.getFeatureById(feature.id), undefined);
  assert.equal(store.getPipelineLock(), undefined);
  store.close();
});

test("deleteFeature removes accepted features from the catalog", () => {
  const store = openStore();
  const feature = store.createFeature("hud", "channel-1");
  store.startPlanning(feature.id);
  store.transition(feature.id, "implementing");
  store.transition(feature.id, "accepted");
  store.deleteFeature(feature.id);
  assert.equal(store.getFeatureById(feature.id), undefined);
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
