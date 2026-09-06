import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client, Interaction } from "discord.js";
import type { Config } from "../config.js";
import type { FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { beginAgentWatch } from "../cursor/agentWatch.js";
import { handleInteraction } from "./handlers.js";
import { SUPPRESS_LINK_PREVIEW } from "./preview.js";

const config = { discordChannelId: "chan" } as Config;
const ctx = {
  store: {} as FeatureStore,
  config,
  client: {} as Client,
  pipeline: {} as Pipeline,
};

type ReplyPayload =
  | string
  | { content?: string; ephemeral?: boolean; flags?: number };

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
  followUps: ReplyPayload[];
  reply: (payload: ReplyPayload) => Promise<void>;
  followUp: (payload: ReplyPayload) => Promise<void>;
};

function contentOf(payload: ReplyPayload | undefined): string {
  if (typeof payload === "string") {
    return payload;
  }
  return payload?.content ?? "";
}

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
    async followUp(payload: ReplyPayload) {
      interaction.followUps.push(payload);
    },
    ...overrides,
  };
  return interaction;
}

test("command result is the public reply", async () => {
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
  assert.deepEqual(interaction.replies, [
    {
      content: "Added a note to **Jump**.",
      ephemeral: false,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  assert.equal(interaction.followUps.length, 0);
});

test("egon-plan without name uses the channel latest feature", async () => {
  const interaction = fakeCommand({ commandName: "egon-plan" });
  let plannedId: number | undefined;
  const store = {
    getLatestFeatureForChannel: () => ({ id: 7, name: "Dash" }),
    startPlanning: (id: number) => {
      assert.equal(id, 7);
      return { id: 7, name: "Dash" };
    },
  };
  const pipeline = {
    startPlan: async (id: number) => {
      plannedId = id;
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store: store as unknown as FeatureStore,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.match(contentOf(interaction.replies[0]), /Started planning \*\*Dash\*\*/);
  assert.equal(interaction.followUps.length, 0);
  assert.equal(plannedId, 7);
});

test("egon-plan with a name still targets that feature", async () => {
  const interaction = fakeCommand({ commandName: "egon-plan" });
  interaction.options.data.push({ name: "name", value: "Wall run" });
  const store = {
    getFeatureByName: (name: string) => {
      assert.equal(name, "Wall run");
      return { id: 9, name: "Wall run" };
    },
    startPlanning: (id: number) => {
      assert.equal(id, 9);
      return { id: 9, name: "Wall run" };
    },
  };
  const pipeline = {
    startPlan: async () => undefined,
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store: store as unknown as FeatureStore,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.match(contentOf(interaction.replies[0]), /Started planning \*\*Wall run\*\*/);
  assert.equal(interaction.followUps.length, 0);
});

test("egon-status includes live agent activity", async () => {
  const interaction = fakeCommand({ commandName: "egon-status" });
  const store = {
    getPipelineLock: () => ({
      feature: { name: "Circle", state: "testing", githubPrUrl: null },
    }),
  };
  const watch = beginAgentWatch({
    role: "tester",
    agentId: "a1",
    runId: "run-9",
    setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => undefined,
    log: () => undefined,
  });
  try {
    await handleInteraction(interaction as unknown as Interaction, {
      ...ctx,
      store: store as unknown as FeatureStore,
    });
    const text = contentOf(interaction.replies[0]);
    assert.match(text, /Pipeline: \*\*Circle\*\* \(testing\)/);
    assert.match(text, /Tester run-9/);
  } finally {
    watch.stop();
  }
});

test("egon-retry asks the pipeline to retry", async () => {
  const interaction = fakeCommand({ commandName: "egon-retry" });
  let retried = false;
  const pipeline = {
    retry: async () => {
      retried = true;
      return "Retrying **Circle** from testing.";
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(retried, true);
  assert.match(contentOf(interaction.replies[0]), /Retrying \*\*Circle\*\*/);
  assert.equal(interaction.followUps.length, 0);
});

test("egon-stop asks the pipeline to stop", async () => {
  const interaction = fakeCommand({ commandName: "egon-stop" });
  let stopped = false;
  const pipeline = {
    stop: async () => {
      stopped = true;
      return "Stopped **Dash**. Feature is back to collecting.";
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(stopped, true);
  assert.match(contentOf(interaction.replies[0]), /Stopped \*\*Dash\*\*/);
  assert.equal(interaction.followUps.length, 0);
});

test("wrong-channel commands stay ephemeral", async () => {
  const interaction = fakeCommand({ channelId: "other" });
  await handleInteraction(interaction as unknown as Interaction, ctx);
  assert.deepEqual(interaction.replies, [
    {
      content: "This bot only accepts commands in the configured channel.",
      ephemeral: true,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  assert.equal(interaction.followUps.length, 0);
});
