import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonStyle, ComponentType } from "discord.js";
import {
  addNoteButtonRow,
  addNoteModal,
  parseAddNoteCustomId,
  parseAddNoteModalCustomId,
} from "./noteButton.js";

test("add note button and modal custom ids round-trip", () => {
  const button = addNoteButtonRow(7).toJSON().components[0];
  assert.ok(button && button.type === ComponentType.Button);
  assert.equal(button.style, ButtonStyle.Primary);
  assert.equal(button.label, "Add note");
  assert.equal(parseAddNoteCustomId(button.custom_id ?? ""), 7);
  assert.equal(parseAddNoteCustomId("egon-add-note-modal:7"), undefined);

  const modal = addNoteModal(7, "Jump").toJSON();
  assert.equal(parseAddNoteModalCustomId(modal.custom_id ?? ""), 7);
  assert.equal(modal.title, "Note: Jump");
});

test("add note modal title stays within Discord's limit", () => {
  const title = addNoteModal(1, "x".repeat(80)).toJSON().title ?? "";
  assert.ok(title.length <= 45);
  assert.equal(title.startsWith("Note: "), true);
  assert.equal(title.endsWith("…"), true);
});
