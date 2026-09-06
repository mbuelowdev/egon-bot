import assert from "node:assert/strict";
import { test } from "node:test";
import { firstMentionAnswer, isInConfiguredChannel, isWinningMention } from "./threads.js";

const BOT = "bot-1";
const HUMAN = "human-1";
const OTHER = "human-2";

test("first message that mentions the bot wins", () => {
  const winner = firstMentionAnswer(
    [
      { id: "1", authorId: BOT, mentionedUserIds: [] },
      { id: "2", authorId: HUMAN, mentionedUserIds: [] },
      { id: "3", authorId: OTHER, mentionedUserIds: [BOT] },
      { id: "4", authorId: HUMAN, mentionedUserIds: [BOT] },
    ],
    BOT,
  );
  assert.equal(winner?.id, "3");
});

test("bot-authored mention does not count as an answer", () => {
  const winner = firstMentionAnswer(
    [{ id: "1", authorId: BOT, mentionedUserIds: [BOT, HUMAN] }],
    BOT,
  );
  assert.equal(winner, null);
});

test("later mentions lose once an answer exists", () => {
  const first = { id: "1", authorId: HUMAN, mentionedUserIds: [BOT] };
  const second = { id: "2", authorId: OTHER, mentionedUserIds: [BOT] };
  assert.equal(isWinningMention(first, BOT, false), true);
  assert.equal(isWinningMention(second, BOT, true), false);
});

test("commands in the configured channel or its threads are allowed", () => {
  assert.equal(isInConfiguredChannel("chan", null, "chan"), true);
  assert.equal(isInConfiguredChannel("thread", "chan", "chan"), true);
  assert.equal(isInConfiguredChannel("other", null, "chan"), false);
  assert.equal(isInConfiguredChannel("thread", "other", "chan"), false);
});
