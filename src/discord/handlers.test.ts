import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client, Interaction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import type { Config } from "../config.js";
import { FeatureStore, UserFacingError } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { beginAgentWatch } from "../cursor/agentWatch.js";
import { PHASE_EMOJI } from "../format.js";
import { COMMAND_BY_NAME } from "./commands.js";
import { handleInteraction } from "./handlers.js";
import { parseAddNoteCustomId } from "./noteButton.js";
import { parseMergeCustomId } from "./mergeButton.js";
import { SUPPRESS_LINK_PREVIEW } from "./preview.js";
import { waitForQuestionAnswer } from "./qaWaiters.js";

const config = { discordChannelId: "chan" } as Config;
const ctx = {
  store: {} as FeatureStore,
  config,
  client: {} as Client,
  pipeline: {} as Pipeline,
};

type ReplyPayload =
  | string
  | {
      content?: string;
      ephemeral?: boolean;
      flags?: number;
      components?: Array<{ toJSON: () => { components?: Array<{ custom_id?: string }> } }>;
    };

type FakeAttachment = {
  name: string;
  url: string;
  contentType: string | null;
};

type FakeMessage = {
  id: string;
  deleted: boolean;
  edits: unknown[];
  delete: () => Promise<void>;
  edit: (payload: unknown) => Promise<void>;
};

type FakeModal = {
  toJSON: () => { custom_id?: string; title?: string };
};

type FakeInteraction = {
  isChatInputCommand: () => boolean;
  isButton: () => boolean;
  isModalSubmit: () => boolean;
  isRepliable: () => boolean;
  id: string;
  channelId: string;
  channel: { parentId: string | null };
  commandName: string;
  customId: string;
  user: { id: string; displayName: string; username: string };
  member: { displayName: string };
  options: {
    data: { name: string; value: string }[];
    attachments: Record<string, FakeAttachment | undefined>;
    getString: (name: string, required?: boolean) => string | null;
    getAttachment: (name: string) => FakeAttachment | null;
  };
  fieldValues: Record<string, string>;
  fields: { getTextInputValue: (name: string) => string };
  replied: boolean;
  deferred: boolean;
  replies: ReplyPayload[];
  followUps: ReplyPayload[];
  modals: FakeModal[];
  message: FakeMessage;
  reply: (payload: ReplyPayload) => Promise<void>;
  followUp: (payload: ReplyPayload) => Promise<void>;
  deferReply: () => Promise<void>;
  deferUpdate: () => Promise<void>;
  editReply: (payload: ReplyPayload) => Promise<void>;
  showModal: (modal: FakeModal) => Promise<void>;
  fetchReply: () => Promise<{ id: string }>;
};

function contentOf(payload: ReplyPayload | undefined): string {
  if (typeof payload === "string") {
    return payload;
  }
  return payload?.content ?? "";
}

function deleteCustomId(payload: ReplyPayload | undefined): string | undefined {
  if (payload === undefined || typeof payload === "string") {
    return undefined;
  }
  return payload.components?.[0]?.toJSON().components?.[0]?.custom_id;
}

function fakeCommand(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  const message: FakeMessage = {
    id: "m1",
    deleted: false,
    edits: [],
    async delete() {
      message.deleted = true;
    },
    async edit(payload: unknown) {
      message.edits.push(payload);
    },
  };
  const interaction: FakeInteraction = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    id: "i1",
    channelId: "chan",
    channel: { parentId: null },
    commandName: "egon-list",
    customId: "",
    user: { id: "42", displayName: "Michael", username: "michael" },
    member: { displayName: "Michael" },
    options: {
      data: [],
      attachments: {},
      getString(name: string) {
        return interaction.options.data.find((option) => option.name === name)?.value ?? null;
      },
      getAttachment(name: string) {
        return interaction.options.attachments[name] ?? null;
      },
    },
    fieldValues: {},
    fields: {
      getTextInputValue(name: string) {
        return interaction.fieldValues[name] ?? "";
      },
    },
    replied: false,
    deferred: false,
    replies: [],
    followUps: [],
    modals: [],
    message,
    async reply(payload: ReplyPayload) {
      interaction.replied = true;
      interaction.replies.push(payload);
    },
    async followUp(payload: ReplyPayload) {
      interaction.followUps.push(payload);
    },
    async deferReply() {
      interaction.deferred = true;
    },
    async deferUpdate() {
      interaction.deferred = true;
    },
    async editReply(payload: ReplyPayload) {
      interaction.replied = true;
      interaction.replies.push(payload);
    },
    async showModal(modal: FakeModal) {
      interaction.modals.push(modal);
    },
    async fetchReply() {
      return { id: message.id };
    },
    ...overrides,
  };
  return interaction;
}

function fakeButton(customId: string, overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  return fakeCommand({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId,
    ...overrides,
  });
}

function fakeModal(customId: string, text: string, overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  return fakeCommand({
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId,
    fieldValues: { text },
    ...overrides,
  });
}

function fakeClientWithMessage(message: FakeMessage): Client {
  return {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        isDMBased: () => false,
        messages: {
          fetch: async (id: string) => {
            if (id !== message.id) {
              throw new Error(`unknown message ${id}`);
            }
            return message;
          },
        },
      }),
    },
  } as unknown as Client;
}

test("egon-new-feature includes an Add note button", async () => {
  const store = new FeatureStore(":memory:");
  const interaction = fakeCommand({ commandName: "egon-new-feature" });
  interaction.options.data.push({ name: "name", value: "Jump" });
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  const feature = store.getLatestFeatureForChannel("chan");
  assert.ok(feature);
  assert.equal(
    contentOf(interaction.replies[0]),
    "Created **Jump** (collecting). It is now the latest feature in this channel.",
  );
  assert.equal(parseAddNoteCustomId(deleteCustomId(interaction.replies[0]) ?? ""), feature.id);
  assert.equal(feature.addNoteMessageId, "m1");
  store.close();
});

test("command result is the public reply", async () => {
  const interaction = fakeCommand({ commandName: "egon-add" });
  interaction.options.data.push({ name: "text", value: "jump has to be higher" });
  const store = {
    getLatestFeatureForChannel: () => ({ id: 1, name: "Jump", state: "collecting" }),
    addNote: () => ({ id: 11 }),
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store: store as unknown as FeatureStore,
  });
  assert.deepEqual(interaction.replies, [
    {
      content: "Added a note to **Jump**.\n*jump has to be higher*",
      ephemeral: false,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  assert.equal(interaction.followUps.length, 0);
});

test("egon-add with an image downloads it for Cursor", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-add-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const interaction = fakeCommand({ commandName: "egon-add" });
  interaction.options.data.push({ name: "text", value: "jump has to be higher" });
  interaction.options.attachments.image = {
    name: "hud.png",
    url: "https://cdn.example/hud.png",
    contentType: "image/png",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(Buffer.from("png-bytes"), { status: 200 })) as typeof fetch;
  try {
    await handleInteraction(interaction as unknown as Interaction, {
      ...ctx,
      config: { ...config, dataDir },
      store,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(interaction.deferred, true);
  assert.equal(
    contentOf(interaction.followUps[0]),
    "Added a note to **Jump**.\n*jump has to be higher*",
  );
  assert.equal(store.listNotes(feature.id)[0], "jump has to be higher");
  const attachments = store.listAttachments(feature.id);
  assert.equal(attachments.length, 1);
  const stored = attachments[0];
  assert.ok(stored);
  const files = readdirSync(join(dataDir, "features", String(feature.id), "attachments"));
  assert.equal(files.length, 1);
  assert.equal(
    readFileSync(join(dataDir, "features", String(feature.id), "attachments", stored.storedName), "utf8"),
    "png-bytes",
  );
  store.close();
});

test("egon-add rejects a non-image attachment", async () => {
  const store = {
    getLatestFeatureForChannel: () => ({ id: 1, name: "Jump" }),
    addNote: () => {
      throw new Error("should not add a note");
    },
  };
  const interaction = fakeCommand({ commandName: "egon-add" });
  interaction.options.data.push({ name: "text", value: "jump has to be higher" });
  interaction.options.attachments.image = {
    name: "notes.pdf",
    url: "https://cdn.example/notes.pdf",
    contentType: "application/pdf",
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store: store as unknown as FeatureStore,
  });
  assert.equal(interaction.deferred, false);
  assert.match(contentOf(interaction.replies[0]), /Only PNG, JPEG, GIF, or WebP/);
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
  assert.equal(
    contentOf(interaction.replies[0]),
    `${PHASE_EMOJI.planning} Started planning **Dash**. Progress will be posted in this channel.`,
  );
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
  assert.equal(
    contentOf(interaction.replies[0]),
    `${PHASE_EMOJI.planning} Started planning **Wall run**. Progress will be posted in this channel.`,
  );
  assert.equal(interaction.followUps.length, 0);
});

test("egon-plan links the feature name to the catalog page", async () => {
  const interaction = fakeCommand({ commandName: "egon-plan" });
  const store = {
    getLatestFeatureForChannel: () => ({ id: 7, name: "Dash HUD" }),
    startPlanning: () => ({ id: 7, name: "Dash HUD" }),
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    config: { ...config, featuresPublicUrl: "https://egon.example" },
    store: store as unknown as FeatureStore,
    pipeline: { startPlan: async () => undefined } as unknown as Pipeline,
  });
  assert.equal(
    contentOf(interaction.replies[0]),
    `${PHASE_EMOJI.planning} Started planning [**Dash HUD**](<https://egon.example/features/dash-hud>). Progress will be posted in this channel.`,
  );
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

test("egon-pivot passes text to the pipeline", async () => {
  const interaction = fakeCommand({ commandName: "egon-pivot" });
  interaction.options.data.push({ name: "text", value: "make the HUD smaller" });
  let received: { text: string; image?: unknown } | undefined;
  const pipeline = {
    pivot: async (text: string, image?: unknown) => {
      received = { text, image };
      return "Pivoting **Jump**. Re-entering implement and test.\n*make the HUD smaller*";
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.deepEqual(received, { text: "make the HUD smaller", image: undefined });
  assert.equal(interaction.deferred, false);
  assert.equal(
    contentOf(interaction.replies[0]),
    "Pivoting **Jump**. Re-entering implement and test.\n*make the HUD smaller*",
  );
  assert.equal(interaction.followUps.length, 0);
});

test("egon-pivot with an image defers and passes it to the pipeline", async () => {
  const interaction = fakeCommand({ commandName: "egon-pivot" });
  interaction.options.data.push({ name: "text", value: "match this HUD" });
  interaction.options.attachments.image = {
    name: "hud.png",
    url: "https://cdn.example/hud.png",
    contentType: "image/png",
  };
  let received: { text: string; image?: unknown } | undefined;
  const pipeline = {
    pivot: async (text: string, image?: unknown) => {
      received = { text, image };
      return "Pivoting **Jump**. Re-entering implement and test.\n*match this HUD*";
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(interaction.deferred, true);
  assert.deepEqual(received, {
    text: "match this HUD",
    image: { name: "hud.png", url: "https://cdn.example/hud.png", contentType: "image/png" },
  });
  assert.equal(
    contentOf(interaction.followUps[0]),
    "Pivoting **Jump**. Re-entering implement and test.\n*match this HUD*",
  );
});

test("egon-pivot rejects a non-image attachment", async () => {
  const interaction = fakeCommand({ commandName: "egon-pivot" });
  interaction.options.data.push({ name: "text", value: "match this HUD" });
  interaction.options.attachments.image = {
    name: "notes.pdf",
    url: "https://cdn.example/notes.pdf",
    contentType: "application/pdf",
  };
  let pivoted = false;
  const pipeline = {
    pivot: async () => {
      pivoted = true;
      return "should not pivot";
    },
  };
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(pivoted, false);
  assert.equal(interaction.deferred, false);
  assert.match(contentOf(interaction.replies[0]), /Only PNG, JPEG, GIF, or WebP/);
});

test("egon-pivot slash command includes an optional image", () => {
  const json = COMMAND_BY_NAME.get("egon-pivot")?.data.toJSON();
  const image = json?.options?.find((option) => option.name === "image");
  assert.equal(image?.type, ApplicationCommandOptionType.Attachment);
  assert.equal(image?.required, false);
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

test("egon-plan removes the Add note button", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash", "chan");
  store.setAddNoteMessageId(feature.id, "m-created");
  const created: FakeMessage = {
    id: "m-created",
    deleted: false,
    edits: [],
    async delete() {
      created.deleted = true;
    },
    async edit(payload: unknown) {
      created.edits.push(payload);
    },
  };
  const interaction = fakeCommand({ commandName: "egon-plan" });
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store,
    client: fakeClientWithMessage(created),
    pipeline: { startPlan: async () => undefined } as unknown as Pipeline,
  });
  assert.deepEqual(created.edits, [{ components: [] }]);
  assert.equal(store.getFeatureById(feature.id)?.state, "planning");
  store.close();
});

test("Add note button opens a modal for that feature", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const interaction = fakeButton(`egon-add-note:${String(feature.id)}`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.modals.length, 1);
  const modal = interaction.modals[0]?.toJSON();
  assert.equal(modal?.custom_id, `egon-add-note-modal:${String(feature.id)}`);
  assert.equal(modal?.title, "Specifics: Jump");
  assert.equal(interaction.replies.length, 0);
  store.close();
});

test("Add note modal stores the note and posts a public reply", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const interaction = fakeModal(`egon-add-note-modal:${String(feature.id)}`, "jump has to be higher");
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.deepEqual(store.listNotes(feature.id), ["jump has to be higher"]);
  assert.deepEqual(interaction.replies, [
    {
      content: "Added a note to **Jump**.\n*jump has to be higher*",
      ephemeral: false,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  store.close();
});

test("Add note button is rejected after planning starts", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.startPlanning(feature.id);
  const interaction = fakeButton(`egon-add-note:${String(feature.id)}`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.modals.length, 0);
  assert.deepEqual(interaction.replies, [
    {
      content: "Cannot add a note after planning has started. **Jump** is planning.",
      ephemeral: true,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  store.close();
});

test("Add note modal is rejected after planning starts", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.startPlanning(feature.id);
  const interaction = fakeModal(`egon-add-note-modal:${String(feature.id)}`, "too late");
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.deepEqual(store.listNotes(feature.id), []);
  assert.deepEqual(interaction.replies, [
    {
      content: "Cannot add a note after planning has started. **Jump** is planning.",
      ephemeral: true,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  store.close();
});

test("numbered answer button submits that choice immediately", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.setPendingQuestion(feature.id, "Pick:\n1. Jump high\n2. Dash\n3. Fly");
  store.setDiscordIds(feature.id, { messageId: "m1" });
  const pending = waitForQuestionAnswer(feature.id, 1000);
  const interaction = fakeButton(`egon-qa:${String(feature.id)}:1`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(await pending, "1. Jump high");
  assert.equal(store.getFeatureById(feature.id)?.pendingAnswer, "1. Jump high");
  assert.deepEqual(store.listNotes(feature.id), ["1. Jump high"]);
  assert.equal(contentOf(interaction.replies[0]), "Michael answered: 1. Jump high");
  assert.deepEqual(interaction.message.edits, [{ components: [] }]);
  assert.equal(interaction.modals.length, 0);
  store.close();
});

test("Answer other opens a modal instead of submitting", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.setPendingQuestion(feature.id, "Pick:\n1. Jump high\n2. Dash");
  store.setDiscordIds(feature.id, { messageId: "m1" });
  const interaction = fakeButton(`egon-qa:${String(feature.id)}:other`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.modals.length, 1);
  const modal = interaction.modals[0]?.toJSON();
  assert.equal(modal?.custom_id, `egon-qa-modal:${String(feature.id)}`);
  assert.equal(modal?.title, "Answer: Jump");
  assert.equal(interaction.replies.length, 0);
  assert.equal(store.getFeatureById(feature.id)?.pendingAnswer, null);
  store.close();
});

test("answer modal submits the typed text", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.setPendingQuestion(feature.id, "How high?");
  store.setDiscordIds(feature.id, { messageId: "m1" });
  const pending = waitForQuestionAnswer(feature.id, 1000);
  const interaction = fakeModal(`egon-qa-modal:${String(feature.id)}`, "about 3 tiles", {
    fieldValues: { answer: "about 3 tiles" },
  });
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(await pending, "about 3 tiles");
  assert.equal(contentOf(interaction.replies[0]), "Michael answered: about 3 tiles");
  store.close();
});

test("stale question buttons are rejected", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.setPendingQuestion(feature.id, "Pick:\n1. Jump");
  store.setDiscordIds(feature.id, { messageId: "m-new" });
  const interaction = fakeButton(`egon-qa:${String(feature.id)}:1`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.match(contentOf(interaction.replies[0]), /no longer open/);
  assert.equal(store.getFeatureById(feature.id)?.pendingAnswer, null);
  store.close();
});

function featureAwaitingReview(store: FeatureStore, name: string): ReturnType<FeatureStore["createFeature"]> {
  const feature = store.createFeature(name, "chan");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/dash",
    number: 4,
    url: "https://github.com/org/game/pull/4",
  });
  store.transition(feature.id, "implementing");
  store.transition(feature.id, "exporting");
  store.transition(feature.id, "testing");
  store.transition(feature.id, "awaiting_review");
  return store.getFeatureById(feature.id) ?? feature;
}

test("merge button asks the pipeline to merge", async () => {
  const store = new FeatureStore(":memory:");
  const feature = featureAwaitingReview(store, "Dash");
  let mergedId: number | undefined;
  const pipeline = {
    merge: async (id: number) => {
      mergedId = id;
    },
  };
  const interaction = fakeButton(`egon-merge:${String(feature.id)}`);
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(parseMergeCustomId(interaction.customId), feature.id);
  assert.equal(mergedId, feature.id);
  assert.equal(interaction.deferred, true);
  assert.equal(interaction.replies.length, 0);
  assert.equal(interaction.followUps.length, 0);
  store.close();
});

test("merge button reports a pipeline error without replacing the review message", async () => {
  const store = new FeatureStore(":memory:");
  const feature = featureAwaitingReview(store, "Dash");
  const pipeline = {
    merge: async () => {
      throw new UserFacingError("This feature has no pull request.");
    },
  };
  const interaction = fakeButton(`egon-merge:${String(feature.id)}`);
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    store,
    pipeline: pipeline as unknown as Pipeline,
  });
  assert.equal(interaction.deferred, true);
  assert.deepEqual(interaction.followUps, [
    {
      content: "This feature has no pull request.",
      ephemeral: true,
      flags: SUPPRESS_LINK_PREVIEW,
    },
  ]);
  store.close();
});
