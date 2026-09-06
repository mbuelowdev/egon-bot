import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonStyle, ComponentType } from "discord.js";
import {
  addNoteButtonRow,
  addNoteModal,
  deleteNoteButtonRow,
  parseAddNoteCustomId,
  parseAddNoteModalCustomId,
  parseDeleteNoteCustomId,
} from "./noteButton.js";

test("delete note custom ids round-trip", () => {
  const noteOnly = deleteNoteButtonRow(11).toJSON().components[0];
  assert.ok(noteOnly && noteOnly.type === ComponentType.Button);
  assert.equal(noteOnly.style, ButtonStyle.Danger);
  assert.equal(noteOnly.label, "Delete");
  assert.deepEqual(parseDeleteNoteCustomId(noteOnly.custom_id ?? ""), { noteId: 11 });

  const withImage = deleteNoteButtonRow(11, 22).toJSON().components[0];
  assert.ok(withImage && withImage.type === ComponentType.Button);
  assert.deepEqual(parseDeleteNoteCustomId(withImage.custom_id ?? ""), {
    noteId: 11,
    attachmentId: 22,
  });
});

test("parseDeleteNoteCustomId rejects other buttons", () => {
  assert.equal(parseDeleteNoteCustomId("other"), undefined);
  assert.equal(parseDeleteNoteCustomId("egon-del-note:"), undefined);
  assert.equal(parseDeleteNoteCustomId("egon-del-note:nope"), undefined);
});

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
