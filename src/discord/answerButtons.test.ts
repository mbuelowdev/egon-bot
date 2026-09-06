import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonStyle, ComponentType } from "discord.js";
import {
  answerButtonRow,
  answerOtherModal,
  formatChoiceAnswer,
  formatQuestionBody,
  normalizeChoices,
  parseAnswerButtonCustomId,
  parseAnswerModalCustomId,
  parseNumberedChoices,
} from "./answerButtons.js";

test("parseNumberedChoices reads consecutive 1. 2. 3. lines", () => {
  assert.deepEqual(
    parseNumberedChoices("Pick one:\n1. Jump\n2. Dash\n3. Fly\nor Other"),
    ["Jump", "Dash", "Fly"],
  );
  assert.deepEqual(parseNumberedChoices("1) red\n2) blue"), ["red", "blue"]);
  assert.deepEqual(parseNumberedChoices("No options here"), []);
  assert.deepEqual(parseNumberedChoices("1. only"), ["only"]);
  assert.deepEqual(parseNumberedChoices("2. skipped one"), []);
});

test("formatQuestionBody appends choices when the question has none", () => {
  assert.equal(formatQuestionBody("Height?", ["low", "high"]), "Height?\n1. low\n2. high");
  assert.equal(formatQuestionBody("1. already\n2. listed", ["x"]), "1. already\n2. listed");
  assert.equal(formatQuestionBody("open question", []), "open question");
});

test("normalizeChoices keeps up to three non-empty strings", () => {
  assert.deepEqual(normalizeChoices([" a ", "", "b", 3, "c", "d"]), ["a", "b", "c"]);
  assert.deepEqual(normalizeChoices("1, 2, 3"), []);
});

test("numbered buttons plus Answer other round-trip custom ids", () => {
  const row = answerButtonRow(7, 3).toJSON();
  const buttons = row.components ?? [];
  assert.equal(buttons.length, 4);
  const labels = buttons.map((button) =>
    button.type === ComponentType.Button ? button.label : undefined,
  );
  assert.deepEqual(labels, ["1.", "2.", "3.", "Answer other"]);
  assert.equal(buttons[0] && "style" in buttons[0] ? buttons[0].style : undefined, ButtonStyle.Primary);
  assert.deepEqual(
    parseAnswerButtonCustomId(buttons[0] && "custom_id" in buttons[0] ? (buttons[0].custom_id ?? "") : ""),
    { featureId: 7, choice: 1 },
  );
  assert.deepEqual(
    parseAnswerButtonCustomId(buttons[3] && "custom_id" in buttons[3] ? (buttons[3].custom_id ?? "") : ""),
    { featureId: 7, choice: "other" },
  );
  assert.equal(parseAnswerButtonCustomId("egon-qa-modal:7"), undefined);
});

test("no numbered choices yields a single Answer button", () => {
  const button = answerButtonRow(4, 0).toJSON().components?.[0];
  assert.ok(button && button.type === ComponentType.Button);
  assert.equal(button.label, "Answer");
  assert.equal(button.style, ButtonStyle.Primary);
  assert.deepEqual(parseAnswerButtonCustomId(button.custom_id ?? ""), { featureId: 4, choice: "other" });
});

test("formatChoiceAnswer uses the matching numbered line", () => {
  const question = "Pick:\n1. Jump high\n2. Stay low";
  assert.equal(formatChoiceAnswer(question, 1), "1. Jump high");
  assert.equal(formatChoiceAnswer(question, 2), "2. Stay low");
  assert.equal(formatChoiceAnswer("no list", 1), "1");
});

test("answer modal custom id and title round-trip", () => {
  const modal = answerOtherModal(7, "Jump").toJSON();
  assert.equal(parseAnswerModalCustomId(modal.custom_id ?? ""), 7);
  assert.equal(modal.title, "Answer: Jump");
  const long = answerOtherModal(1, "x".repeat(80)).toJSON().title ?? "";
  assert.ok(long.length <= 45);
  assert.equal(long.startsWith("Answer: "), true);
  assert.equal(long.endsWith("…"), true);
});
