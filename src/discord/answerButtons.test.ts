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
  parseProposedDefault,
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
  assert.deepEqual(
    parseNumberedChoices("Pick:\n1. 1. Bright cyan\n2. 2. Hot magenta\n3. 3. Lime green"),
    ["Bright cyan", "Hot magenta", "Lime green"],
  );
});

test("formatQuestionBody appends choices when the question has none", () => {
  assert.equal(formatQuestionBody("Height?", ["low", "high"]), "Height?\n1. low\n2. high");
  assert.equal(formatQuestionBody("1. already\n2. listed", ["x"]), "1. already\n2. listed");
  assert.equal(formatQuestionBody("open question", []), "open question");
  assert.equal(
    formatQuestionBody("Spawn bounding box color?", ["1. Bright cyan", "2. Hot magenta", "3. Lime green"]),
    "Spawn bounding box color?\n1. Bright cyan\n2. Hot magenta\n3. Lime green",
  );
  assert.equal(
    formatQuestionBody("Pick:\n1. 1. Bright cyan\n2. 2. Hot magenta", []),
    "Pick:\n1. Bright cyan\n2. Hot magenta",
  );
});

test("normalizeChoices keeps up to three non-empty strings", () => {
  assert.deepEqual(normalizeChoices([" a ", "", "b", 3, "c", "d"]), ["a", "b", "c"]);
  assert.deepEqual(normalizeChoices("1, 2, 3"), []);
  assert.deepEqual(normalizeChoices(["1. Bright cyan", "2) Hot magenta"]), ["Bright cyan", "Hot magenta"]);
});

test("numbered buttons plus Default and Answer other round-trip custom ids", () => {
  const row = answerButtonRow(7, 3).toJSON();
  const buttons = row.components ?? [];
  assert.equal(buttons.length, 5);
  const labels = buttons.map((button) =>
    button.type === ComponentType.Button ? button.label : undefined,
  );
  assert.deepEqual(labels, ["1.", "2.", "3.", "Default", "Answer other"]);
  assert.equal(buttons[0] && "style" in buttons[0] ? buttons[0].style : undefined, ButtonStyle.Primary);
  assert.equal(buttons[3] && "style" in buttons[3] ? buttons[3].style : undefined, ButtonStyle.Secondary);
  assert.deepEqual(
    parseAnswerButtonCustomId(buttons[0] && "custom_id" in buttons[0] ? (buttons[0].custom_id ?? "") : ""),
    { featureId: 7, choice: 1 },
  );
  assert.deepEqual(
    parseAnswerButtonCustomId(buttons[3] && "custom_id" in buttons[3] ? (buttons[3].custom_id ?? "") : ""),
    { featureId: 7, choice: "default" },
  );
  assert.deepEqual(
    parseAnswerButtonCustomId(buttons[4] && "custom_id" in buttons[4] ? (buttons[4].custom_id ?? "") : ""),
    { featureId: 7, choice: "other" },
  );
  assert.equal(parseAnswerButtonCustomId("egon-qa-modal:7"), undefined);
});

test("no numbered choices yields Default then Answer", () => {
  const buttons = answerButtonRow(4, 0).toJSON().components ?? [];
  assert.equal(buttons.length, 2);
  const first = buttons[0];
  const second = buttons[1];
  assert.ok(first && first.type === ComponentType.Button);
  assert.ok(second && second.type === ComponentType.Button);
  assert.equal(first.label, "Default");
  assert.equal(first.style, ButtonStyle.Primary);
  assert.equal(second.label, "Answer");
  assert.equal(second.style, ButtonStyle.Secondary);
  assert.deepEqual(parseAnswerButtonCustomId(first.custom_id ?? ""), { featureId: 4, choice: "default" });
  assert.deepEqual(parseAnswerButtonCustomId(second.custom_id ?? ""), { featureId: 4, choice: "other" });
});

test("parseProposedDefault reads the unanswered-default line", () => {
  assert.equal(
    parseProposedDefault("Pick:\n1. Jump high\n2. Stay low\nDefault if unanswered: High"),
    "High",
  );
  assert.equal(parseProposedDefault("1. Jump high\n2. Stay low"), "Jump high");
  assert.equal(parseProposedDefault("open question"), "");
});

test("formatChoiceAnswer uses the matching numbered line", () => {
  const question = "Pick:\n1. Jump high\n2. Stay low";
  assert.equal(formatChoiceAnswer(question, 1), "1. Jump high");
  assert.equal(formatChoiceAnswer(question, 2), "2. Stay low");
  assert.equal(formatChoiceAnswer("no list", 1), "1");
  assert.equal(
    formatChoiceAnswer("Pick:\n1. 1. Bright cyan\n2. 2. Hot magenta\n3. 3. Lime green", 3),
    "3. Lime green",
  );
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
