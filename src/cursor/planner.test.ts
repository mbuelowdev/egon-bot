import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { plannerPrompt } from "./planner.js";

test("planner prompt requires a specific spec and clarifying questions", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Make the spec as specific as possible/);
  assert.match(prompt, /Ask questions until everything material is precise and certain/);
  assert.match(prompt, /Do not invent unspecified details/);
  assert.match(prompt, /ask_discord_users/);
  assert.doesNotMatch(prompt, /If you need a human decision/);
});
