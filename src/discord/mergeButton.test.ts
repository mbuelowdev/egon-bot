import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonStyle, ComponentType } from "discord.js";
import { mergeButtonRow, parseMergeCustomId } from "./mergeButton.js";

test("merge button custom id round-trips", () => {
  const button = mergeButtonRow(9).toJSON().components[0];
  assert.ok(button && button.type === ComponentType.Button);
  assert.equal(button.style, ButtonStyle.Success);
  assert.equal(button.label, "Merge the feature");
  assert.equal(parseMergeCustomId(button.custom_id ?? ""), 9);
  assert.equal(parseMergeCustomId("egon-add-note:9"), undefined);
  assert.equal(parseMergeCustomId("egon-merge:0"), undefined);
});
