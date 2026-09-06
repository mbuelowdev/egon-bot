import {
  type ButtonInteraction,
  type Client,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Config } from "../config.js";
import { UserFacingError, type FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { addNoteAndReply, COMMAND_BY_NAME, type CommandContext } from "./commands.js";
import {
  ADD_NOTE_TEXT_INPUT_ID,
  addNoteModal,
  parseAddNoteCustomId,
  parseAddNoteModalCustomId,
} from "./noteButton.js";
import { noLinkPreview } from "./preview.js";
import { deliverThreadAnswer } from "./qaWaiters.js";
import { isInConfiguredChannel, isWinningMention } from "./threads.js";

export type BotContext = {
  store: FeatureStore;
  config: Config;
  client: Client;
  pipeline: Pipeline;
};

async function parentChannelId(interaction: Interaction): Promise<string | null> {
  const cached = interaction.channel;
  if (cached && "parentId" in cached) {
    return cached.parentId ?? null;
  }
  if (!interaction.channelId) {
    return null;
  }
  const fetched = await interaction.client.channels.fetch(interaction.channelId);
  if (fetched && "parentId" in fetched) {
    return fetched.parentId ?? null;
  }
  return null;
}

async function replyError(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }
  if (interaction.replied || interaction.deferred) {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(noLinkPreview({ content }));
      return;
    }
    await interaction.followUp(noLinkPreview({ content, ephemeral: false }));
    return;
  }
  await interaction.reply(noLinkPreview({ content, ephemeral: true }));
}

async function ensureConfiguredChannel(interaction: Interaction, ctx: BotContext): Promise<boolean> {
  const parentId = await parentChannelId(interaction);
  if (
    isInConfiguredChannel(
      interaction.channelId ?? "",
      parentId,
      ctx.config.discordChannelId,
    )
  ) {
    return true;
  }
  await replyError(interaction, "This bot only accepts commands in the configured channel.");
  return false;
}

export async function handleInteraction(
  interaction: Interaction,
  ctx: BotContext,
): Promise<void> {
  if (interaction.isButton()) {
    await handleButton(interaction, ctx);
    return;
  }
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, ctx);
    return;
  }
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (!(await ensureConfiguredChannel(interaction, ctx))) {
    return;
  }
  const command = COMMAND_BY_NAME.get(interaction.commandName);
  if (!command) {
    await replyError(interaction, "Unknown command.");
    return;
  }
  const commandCtx: CommandContext = {
    interaction,
    store: ctx.store,
    config: ctx.config,
    client: ctx.client,
    pipeline: ctx.pipeline,
  };
  try {
    await command.handle(commandCtx);
  } catch (error) {
    if (error instanceof UserFacingError) {
      await replyError(interaction, error.message);
      return;
    }
    console.error(error);
    await replyError(interaction, "Something went wrong.");
  }
}

async function handleButton(interaction: ButtonInteraction, ctx: BotContext): Promise<void> {
  const addFeatureId = parseAddNoteCustomId(interaction.customId);
  if (addFeatureId === undefined) {
    return;
  }
  if (!(await ensureConfiguredChannel(interaction, ctx))) {
    return;
  }
  const feature = ctx.store.getFeatureById(addFeatureId);
  if (!feature) {
    await replyError(interaction, "Feature not found.");
    return;
  }
  await interaction.showModal(addNoteModal(feature.id, feature.name));
}

async function handleModalSubmit(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void> {
  const featureId = parseAddNoteModalCustomId(interaction.customId);
  if (featureId === undefined) {
    return;
  }
  if (!(await ensureConfiguredChannel(interaction, ctx))) {
    return;
  }
  const feature = ctx.store.getFeatureById(featureId);
  if (!feature) {
    await replyError(interaction, "Feature not found.");
    return;
  }
  try {
    await addNoteAndReply(
      interaction,
      ctx.store,
      ctx.config,
      feature,
      interaction.fields.getTextInputValue(ADD_NOTE_TEXT_INPUT_ID),
    );
  } catch (error) {
    if (error instanceof UserFacingError) {
      await replyError(interaction, error.message);
      return;
    }
    console.error(error);
    await replyError(interaction, "Something went wrong.");
  }
}

export function handleThreadMessage(message: Message, ctx: BotContext): void {
  const botUser = ctx.client.user;
  if (!botUser) {
    return;
  }
  if (!message.channel.isThread()) {
    return;
  }
  if (
    !isInConfiguredChannel(
      message.channelId,
      message.channel.parentId,
      ctx.config.discordChannelId,
    )
  ) {
    return;
  }
  const mentionedUserIds = [...message.mentions.users.keys()];
  const feature = ctx.store.getFeatureByThreadId(message.channelId);
  if (!feature || feature.pendingQuestion === null) {
    return;
  }
  if (
    !isWinningMention(
      { id: message.id, authorId: message.author.id, mentionedUserIds },
      botUser.id,
      feature.answerMessageId !== null,
    )
  ) {
    return;
  }
  const recorded = ctx.store.recordFirstThreadAnswer(
    message.channelId,
    message.id,
    message.content,
  );
  if (recorded?.pendingAnswer) {
    deliverThreadAnswer(message.channelId, recorded.pendingAnswer);
  }
}
