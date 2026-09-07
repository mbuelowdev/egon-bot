import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipGodotOutput,
  GodotExportError,
  godotCommandOutput,
  MAX_GODOT_EXPORT_LOG,
} from "./export.js";

test("godotCommandOutput prefers stderr then stdout", () => {
  assert.equal(
    godotCommandOutput({ stderr: " SCRIPT ERROR: boom \n", stdout: "importing...\n", message: "Command failed" }),
    "SCRIPT ERROR: boom\nimporting...",
  );
  assert.equal(godotCommandOutput({ stdout: " only stdout ", message: "Command failed" }), "only stdout");
  assert.equal(godotCommandOutput({ stderr: " only stderr " }), "only stderr");
  assert.equal(godotCommandOutput(new Error("godot missing")), "godot missing");
});

test("GodotExportError keeps Godot stderr in the message", () => {
  const error = new GodotExportError("ERROR: Failed to export project");
  assert.equal(error.name, "GodotExportError");
  assert.equal(error.output, "ERROR: Failed to export project");
  assert.match(error.message, /Godot web export failed: ERROR: Failed to export project/);
});

test("clipGodotOutput keeps the tail of a huge log", () => {
  const huge = `${"x".repeat(MAX_GODOT_EXPORT_LOG + 50)}TAIL`;
  const clipped = clipGodotOutput(huge);
  assert.ok(clipped.startsWith("…(truncated)\n"));
  assert.ok(clipped.endsWith("TAIL"));
  assert.ok(clipped.length < huge.length);
});
