import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCommandAnnouncement, formatOptionValue } from "./announce.js";

test("formatOptionValue quotes strings", () => {
  assert.equal(formatOptionValue("jump has to be higher"), '"jump has to be higher"');
  assert.equal(formatOptionValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(formatOptionValue(3), "3");
  assert.equal(formatOptionValue(true), "true");
});

test("formatCommandAnnouncement matches Name ran: command input", () => {
  assert.equal(
    formatCommandAnnouncement({
      runnerName: "Michael",
      commandName: "egon-add",
      options: [{ name: "text", value: "jump has to be higher" }],
    }),
    'Michael ran: egon-add "jump has to be higher"',
  );
});

test("formatCommandAnnouncement omits args when there is no input", () => {
  assert.equal(
    formatCommandAnnouncement({
      runnerName: "Ada",
      commandName: "egon-list",
    }),
    "Ada ran: egon-list",
  );
});

test("formatCommandAnnouncement quotes each option value", () => {
  assert.equal(
    formatCommandAnnouncement({
      runnerName: "Michael",
      commandName: "egon-add-to-feature",
      options: [
        { name: "name", value: "Dash" },
        { name: "text", value: "make it faster" },
      ],
    }),
    'Michael ran: egon-add-to-feature "Dash" "make it faster"',
  );
});

test("formatCommandAnnouncement stays within Discord's message limit", () => {
  const text = "x".repeat(2500);
  const line = formatCommandAnnouncement({
    runnerName: "Michael",
    commandName: "egon-add",
    options: [{ name: "text", value: text }],
  });
  assert.ok(line.length <= 2000);
  assert.equal(line.endsWith("…"), true);
});
