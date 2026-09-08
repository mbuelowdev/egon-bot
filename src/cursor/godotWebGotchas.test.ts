import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { GODOT_WEB_GOTCHAS_PROMPT } from "./godotWebGotchas.js";
import { implementerPrompt } from "./implementer.js";

test("Godot 4 web gotchas name each repeat failure class", () => {
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /repeat failure class/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /thread_support=true/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /SharedArrayBuffer/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /COOP\/COEP/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /JavaScriptBridge/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /OS\.has_feature\("web"\)/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /--check-only/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /does not load autoloads/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /get_node\("\/root\/EgonBridge"\)/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /Never hand-edit `\.uid` files/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /`class_name` must be globally unique/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /No addons/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /export_presets\.cfg/);
  assert.match(GODOT_WEB_GOTCHAS_PROMPT, /ensureWebExportPreset/);
});

test("implementer prompt injects the static Godot 4 web gotcha list", () => {
  const prompt = implementerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.ok(prompt.includes(GODOT_WEB_GOTCHAS_PROMPT));
  const gotchasAt = prompt.indexOf(GODOT_WEB_GOTCHAS_PROMPT);
  const nameAt = prompt.indexOf("Feature name: Dash");
  assert.ok(gotchasAt >= 0);
  assert.ok(gotchasAt < nameAt);
});
