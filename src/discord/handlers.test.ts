import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client, Interaction } from "discord.js";
import type { Config } from "../config.js";
import type { FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { handleInteraction } from "./handlers.js";

const config = { discordChannelId: "chan" } as Config;
const ctx = {
  store: {} as FeatureStore,
  config,
  client: {} as Client,
  pipeline: {} as Pipeline,
};

type ReplyPayload = string | { content: string; ephemeral?: boolean };

type FakeInteraction = {
  isChatInputCommand: () => boolean;
  isRepliable: () => boolean;
  channelId: string;
  channel: { parentId: string | null };
  commandName: string;
  user: { id: string; displayName: string; username: string };
  member: { displayName: string };
  options: {
    data: { name: string; value: string }[];
    getString: (name: string, required?: boolean) => string | null;
  };
  replied: boolean;
  deferred: boolean;
  replies: ReplyPayload[];
  followUps: { content: string; ephemeral?: boolean }[];
  reply: (payload: ReplyPayload) => Promise<void>;
  followUp: (payload: { content: string; ephemeral?: boolean }) => Promise<void>;
};

function fakeCommand(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  const interaction: FakeInteraction = {
    isChatInputCommand: () => true,
    isRepliable: () => true,
    channelId: "chan",
    channel: { parentId: null },
    commandName: "egon-list",
    user: { id: "42", displayName: "Michael", username: "michael" },
    member: { displayName: "Michael" },
    options: {
      data: [],
      getString(name: string) {
        return interaction.options.data.find((option) => option.name === name)?.value ?? null;
      },
    },
    replied: false,
    deferred: false,
    replies: [],
    followUps: [],
    async reply(payload: ReplyPayload) {
      interaction.replied = true;
      interaction.replies.push(payload);
    },
    async followUp(payload: { content: string; ephemeral?: boolean }) {
      interaction.followUps.push(payload);
    },
    ...overrides,
  };
  return interaction;
}

test("posts Name ran: command input in the channel", async () => {
  const interaction = fakeCommand({ commandName: "egon-add" });
  interaction.options.data.push({ name: "text", value: "jump has to be higher" });
  const store = {
    getLatestFeatureForChannel: () => ({ id: "feat-1", name: "Jump" }),
    addNote: () => undefined,
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store: store as unknown as FeatureStore,
  });
  assert.deepEqual(interaction.replies, ['Michael ran: egon-add "jump has to be higher"']);
  assert.equal(interaction.followUps.length, 1);
  assert.match(interaction.followUps[0]?.content ?? "", /Added a note to \*\*Jump\*\*/);
});

test("wrong-channel commands stay ephemeral and are not announced", async () => {
  const interaction = fakeCommand({ channelId: "other" });
  await handleInteraction(interaction as unknown as Interaction, ctx);
  assert.deepEqual(interaction.replies, [
    { content: "This bot only accepts commands in the configured channel.", ephemeral: true },
  ]);
  assert.equal(interaction.followUps.length, 0);
});
