import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageFlags } from "discord.js";
import { discordLink, noLinkPreview, SUPPRESS_LINK_PREVIEW } from "./preview.js";

test("discordLink wraps http(s) URLs so Discord does not unfurl them", () => {
  assert.equal(discordLink("https://github.com/org/game/pull/12"), "<https://github.com/org/game/pull/12>");
  assert.equal(discordLink("http://127.0.0.1:8080/"), "<http://127.0.0.1:8080/>");
});

test("discordLink leaves already-wrapped URLs and blank values alone", () => {
  assert.equal(discordLink("<https://egon.example/features/dash>"), "<https://egon.example/features/dash>");
  assert.equal(discordLink(""), "");
  assert.equal(discordLink("   "), "   ");
});

test("noLinkPreview sets SuppressEmbeds so messages never spawn link cards", () => {
  assert.equal(SUPPRESS_LINK_PREVIEW, MessageFlags.SuppressEmbeds);
  assert.deepEqual(noLinkPreview({ content: "see https://example.com" }), {
    content: "see https://example.com",
    flags: MessageFlags.SuppressEmbeds,
  });
  assert.deepEqual(noLinkPreview({ content: "ok", ephemeral: true }), {
    content: "ok",
    flags: MessageFlags.SuppressEmbeds,
    ephemeral: true,
  });
});
