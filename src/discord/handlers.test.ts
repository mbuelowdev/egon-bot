import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Client, Interaction } from "discord.js";
import type { Config } from "../config.js";
import { FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { beginAgentWatch } from "../cursor/agentWatch.js";
import { PHASE_EMOJI } from "../format.js";
import { handleInteraction } from "./handlers.js";
import { parseAddNoteCustomId, parseDeleteNoteCustomId } from "./noteButton.js";
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
  deleted: boolean;
  delete: () => Promise<void>;
};

type FakeModal = {
  toJSON: () => { custom_id?: string; title?: string };
};

type FakeInteraction = {
  isChatInputCommand: () => boolean;
  isButton: () => boolean;
  isModalSubmit: () => boolean;
  isRepliable: () => boolean;
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
    deleted: false,
    async delete() {
      message.deleted = true;
    },
  };
  const interaction: FakeInteraction = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
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
  assert.equal(contentOf(interaction.replies[0]), "Added a note to **Jump**.\n*jump has to be higher*");
  assert.equal(
    typeof interaction.replies[0] === "object" ? interaction.replies[0].ephemeral : undefined,
    false,
  );
  assert.equal(
    typeof interaction.replies[0] === "object" ? interaction.replies[0].flags : undefined,
    SUPPRESS_LINK_PREVIEW,
  );
  assert.deepEqual(parseDeleteNoteCustomId(deleteCustomId(interaction.replies[0]) ?? ""), { noteId: 11 });
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
    "Added a note to **Jump**.\n*jump has to be higher*\nassets/egon/jump/hud.png",
  );
  assert.equal(store.listNotes(feature.id)[0], "jump has to be higher");
  const attachments = store.listAttachments(feature.id);
  assert.equal(attachments.length, 1);
  const stored = attachments[0];
  assert.ok(stored);
  assert.deepEqual(parseDeleteNoteCustomId(deleteCustomId(interaction.followUps[0]) ?? ""), {
    noteId: 1,
    attachmentId: stored.id,
  });
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

test("delete button removes the note and the confirmation message", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  store.addNote(feature.id, "keep this");
  const gone = store.addNote(feature.id, "oops");
  const interaction = fakeButton(`egon-del-note:${String(gone.id)}`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.deferred, true);
  assert.equal(interaction.message.deleted, true);
  assert.deepEqual(store.listNotes(feature.id), ["keep this"]);
  assert.equal(interaction.followUps.length, 0);
  store.close();
});

test("delete button removes an added image file too", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-del-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const note = store.addNote(feature.id, "use this HUD");
  const image = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "hud.png",
  });
  const filePath = join(dataDir, "features", String(feature.id), "attachments", image.storedName);
  mkdirSync(join(dataDir, "features", String(feature.id), "attachments"), { recursive: true });
  writeFileSync(filePath, "png-bytes");
  const interaction = fakeButton(`egon-del-note:${String(note.id)}:${String(image.id)}`);
  await handleInteraction(interaction as unknown as Interaction, {
    ...ctx,
    config: { ...config, dataDir },
    store,
  });
  assert.equal(interaction.message.deleted, true);
  assert.deepEqual(store.listNotes(feature.id), []);
  assert.equal(store.listAttachments(feature.id).length, 0);
  assert.equal(existsSync(filePath), false);
  store.close();
});

test("delete button is refused after planning starts", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const note = store.addNote(feature.id, "oops");
  store.startPlanning(feature.id);
  const interaction = fakeButton(`egon-del-note:${String(note.id)}`);
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.message.deleted, false);
  assert.deepEqual(store.listNotes(feature.id), ["oops"]);
  assert.match(contentOf(interaction.followUps[0]), /while collecting/);
  store.close();
});

test("stale delete button still removes the confirmation message", async () => {
  const store = new FeatureStore(":memory:");
  store.createFeature("Jump", "chan");
  const interaction = fakeButton("egon-del-note:99");
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.equal(interaction.message.deleted, true);
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
  assert.equal(modal?.title, "Note: Jump");
  assert.equal(interaction.replies.length, 0);
  store.close();
});

test("Add note modal stores the note and offers Delete", async () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Jump", "chan");
  const interaction = fakeModal(`egon-add-note-modal:${String(feature.id)}`, "jump has to be higher");
  await handleInteraction(interaction as unknown as Interaction, { ...ctx, store });
  assert.deepEqual(store.listNotes(feature.id), ["jump has to be higher"]);
  assert.equal(
    contentOf(interaction.replies[0]),
    "Added a note to **Jump**.\n*jump has to be higher*",
  );
  assert.deepEqual(parseDeleteNoteCustomId(deleteCustomId(interaction.replies[0]) ?? ""), { noteId: 1 });
  store.close();
});
