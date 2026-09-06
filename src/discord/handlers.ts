import {
  type ButtonInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Config } from "../config.js";
import { UserFacingError, type FeatureStore } from "../features/store.js";
import { escapeDiscordMarkdown } from "../format.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { addNoteAndReply, COMMAND_BY_NAME, type CommandContext } from "./commands.js";
import {
  ANSWER_TEXT_INPUT_ID,
  answerOtherModal,
  formatChoiceAnswer,
  parseAnswerButtonCustomId,
  parseAnswerModalCustomId,
  type ParsedAnswerButton,
} from "./answerButtons.js";
import {
  ADD_NOTE_TEXT_INPUT_ID,
  addNoteModal,
  parseAddNoteCustomId,
  parseAddNoteModalCustomId,
} from "./noteButton.js";
import { noLinkPreview } from "./preview.js";
import { deliverQuestionAnswer } from "./qaWaiters.js";
import { isInConfiguredChannel } from "./threads.js";

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
  if (addFeatureId !== undefined) {
    if (!(await ensureConfiguredChannel(interaction, ctx))) {
      return;
    }
    const feature = ctx.store.getFeatureById(addFeatureId);
    if (!feature) {
      await replyError(interaction, "Feature not found.");
      return;
    }
    if (feature.state !== "collecting") {
      await replyError(
        interaction,
        `Cannot add a note after planning has started. **${escapeDiscordMarkdown(feature.name)}** is ${feature.state}.`,
      );
      return;
    }
    await interaction.showModal(addNoteModal(feature.id, feature.name));
    return;
  }

  const answerClick = parseAnswerButtonCustomId(interaction.customId);
  if (answerClick !== undefined) {
    await handleAnswerButton(interaction, ctx, answerClick);
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void> {
  const addFeatureId = parseAddNoteModalCustomId(interaction.customId);
  if (addFeatureId !== undefined) {
    if (!(await ensureConfiguredChannel(interaction, ctx))) {
      return;
    }
    const feature = ctx.store.getFeatureById(addFeatureId);
    if (!feature) {
      await replyError(interaction, "Feature not found.");
      return;
    }
    if (feature.state !== "collecting") {
      await replyError(
        interaction,
        `Cannot add a note after planning has started. **${escapeDiscordMarkdown(feature.name)}** is ${feature.state}.`,
      );
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
    return;
  }

  const answerFeatureId = parseAnswerModalCustomId(interaction.customId);
  if (answerFeatureId !== undefined) {
    await handleAnswerModal(interaction, ctx, answerFeatureId);
  }
}

function questionMessageId(interaction: ButtonInteraction | ModalSubmitInteraction): string | undefined {
  const message = interaction.message;
  if (!message || typeof message !== "object" || !("id" in message)) {
    return undefined;
  }
  const id = message.id;
  return typeof id === "string" ? id : undefined;
}

async function clearQuestionButtons(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<void> {
  const message = interaction.message;
  if (!message || typeof message !== "object" || !("edit" in message)) {
    return;
  }
  const edit = message.edit;
  if (typeof edit !== "function") {
    return;
  }
  try {
    await edit.call(message, { components: [] });
  } catch (error) {
    console.error("failed to clear question buttons", error);
  }
}

function displayName(interaction: Interaction): string {
  const member = interaction.member;
  if (member && typeof member === "object" && "displayName" in member) {
    const name = member.displayName;
    if (typeof name === "string" && name.trim() !== "") {
      return name;
    }
  }
  return interaction.user.displayName;
}

async function submitQuestionAnswer(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  ctx: BotContext,
  featureId: number,
  answer: string,
): Promise<void> {
  const recorded = ctx.store.recordFirstAnswer(featureId, interaction.id, answer);
  if (!recorded?.pendingAnswer) {
    await replyError(interaction, "This question already has an answer.");
    return;
  }
  deliverQuestionAnswer(featureId, recorded.pendingAnswer);
  await clearQuestionButtons(interaction);
  const content = `${escapeDiscordMarkdown(displayName(interaction))} answered: ${escapeDiscordMarkdown(recorded.pendingAnswer)}`;
  await interaction.reply(noLinkPreview({ content, ephemeral: false }));
}

async function requireOpenQuestion(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  ctx: BotContext,
  featureId: number,
): Promise<{ pendingQuestion: string } | undefined> {
  if (!(await ensureConfiguredChannel(interaction, ctx))) {
    return undefined;
  }
  const feature = ctx.store.getFeatureById(featureId);
  if (!feature) {
    await replyError(interaction, "Feature not found.");
    return undefined;
  }
  if (feature.pendingQuestion === null) {
    await replyError(interaction, "No question is waiting.");
    return undefined;
  }
  const messageId = questionMessageId(interaction);
  if (feature.discordMessageId !== null && messageId !== undefined && feature.discordMessageId !== messageId) {
    await replyError(interaction, "This question is no longer open.");
    return undefined;
  }
  if (feature.answerMessageId !== null) {
    await replyError(interaction, "This question already has an answer.");
    return undefined;
  }
  return { pendingQuestion: feature.pendingQuestion };
}

async function handleAnswerButton(
  interaction: ButtonInteraction,
  ctx: BotContext,
  click: ParsedAnswerButton,
): Promise<void> {
  const open = await requireOpenQuestion(interaction, ctx, click.featureId);
  if (!open) {
    return;
  }
  if (click.choice === "other") {
    const feature = ctx.store.getFeatureById(click.featureId);
    await interaction.showModal(answerOtherModal(click.featureId, feature?.name ?? "feature"));
    return;
  }
  await submitQuestionAnswer(
    interaction,
    ctx,
    click.featureId,
    formatChoiceAnswer(open.pendingQuestion, click.choice),
  );
}

async function handleAnswerModal(
  interaction: ModalSubmitInteraction,
  ctx: BotContext,
  featureId: number,
): Promise<void> {
  const open = await requireOpenQuestion(interaction, ctx, featureId);
  if (!open) {
    return;
  }
  await submitQuestionAnswer(
    interaction,
    ctx,
    featureId,
    interaction.fields.getTextInputValue(ANSWER_TEXT_INPUT_ID),
  );
}
