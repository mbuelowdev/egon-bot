import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { catalogUrl, type Config } from "../config.js";
import { formatStatusActivity, getActiveAgentActivity } from "../cursor/agentWatch.js";
import { featureSlug } from "../features/slug.js";
import { assertImageContentType, saveFeatureImage } from "../features/saveImage.js";
import { UserFacingError, type Feature, type FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";
import { discordLink, noLinkPreview } from "./preview.js";

export type CommandContext = {
  interaction: ChatInputCommandInteraction;
  store: FeatureStore;
  config: Config;
  client: Client;
  pipeline: Pipeline;
};

export type RegisteredCommand = {
  name: string;
  description: string;
  data: SlashCommandBuilder;
  handle: (ctx: CommandContext) => Promise<void>;
};

function command(
  name: string,
  description: string,
  setup: ((builder: SlashCommandBuilder) => void) | undefined,
  handle: RegisteredCommand["handle"],
): RegisteredCommand {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  setup?.(data);
  return { name, description, data, handle };
}

/** Result of a slash command. Follows up if the interaction was already replied to. */
export async function replyCommand(
  interaction: ChatInputCommandInteraction,
  content: string,
  options?: { ephemeral?: boolean },
): Promise<void> {
  const payload = noLinkPreview({ content, ephemeral: options?.ephemeral ?? false });
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }
  await interaction.reply(payload);
}

async function addNoteWithOptionalImage(
  interaction: ChatInputCommandInteraction,
  store: FeatureStore,
  config: Config,
  feature: Feature,
): Promise<void> {
  const text = interaction.options.getString("text", true);
  const attachment = interaction.options.getAttachment("image");
  if (attachment) {
    assertImageContentType(attachment.contentType);
    await interaction.deferReply();
    await saveFeatureImage({
      dataDir: config.dataDir,
      store,
      featureId: feature.id,
      image: {
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType,
      },
    });
  }
  store.addNote(feature.id, text);
  const extra = attachment ? " Image saved for Cursor." : "";
  await replyCommand(interaction, `Added a note to **${feature.name}**.${extra}`);
}

function featureLine(feature: Feature, extra?: { noteCount?: number }): string {
  const notes =
    extra?.noteCount === undefined
      ? undefined
      : extra.noteCount === 1
        ? "1 note"
        : `${String(extra.noteCount)} notes`;
  const bits = [
    feature.state,
    notes,
    feature.githubPrUrl ? discordLink(feature.githubPrUrl) : undefined,
  ].filter((value): value is string => value !== undefined && value !== null && value !== "");
  return `• **${feature.name}** — ${bits.join(", ")}`;
}

export const COMMANDS: RegisteredCommand[] = [
  command(
    "egon-help",
    "List every command with its short explanation",
    undefined,
    async ({ interaction }) => {
      const lines = COMMANDS.map((entry) => `\`/${entry.name}\` — ${entry.description}`);
      await replyCommand(interaction, ["**Egon commands**", ...lines].join("\n"), {
        ephemeral: true,
      });
    },
  ),
  command(
    "egon-new-feature",
    "Create feature; becomes this channel's latest",
    (builder) =>
      builder.addStringOption((option) =>
        option.setName("name").setDescription("Feature name").setRequired(true).setMaxLength(100),
      ),
    async ({ interaction, store, config }) => {
      const name = interaction.options.getString("name", true);
      const feature = store.createFeature(name, config.discordChannelId);
      await replyCommand(
        interaction,
        `Created **${feature.name}** (${feature.state}). It is now the latest feature in this channel.`,
      );
    },
  ),
  command(
    "egon-add",
    "Append note to latest feature in this channel",
    (builder) =>
      builder
        .addStringOption((option) =>
          option.setName("text").setDescription("Note to append").setRequired(true).setMaxLength(2000),
        )
        .addAttachmentOption((option) =>
          option.setName("image").setDescription("Reference image for Cursor").setRequired(false),
        ),
    async ({ interaction, store, config }) => {
      const latest = store.getLatestFeatureForChannel(config.discordChannelId);
      if (!latest) {
        throw new UserFacingError("No latest feature in this channel. Use /egon-new-feature first.");
      }
      await addNoteWithOptionalImage(interaction, store, config, latest);
    },
  ),
  command(
    "egon-add-to-feature",
    "Append to a named feature",
    (builder) =>
      builder
        .addStringOption((option) =>
          option.setName("name").setDescription("Feature name").setRequired(true).setMaxLength(100),
        )
        .addStringOption((option) =>
          option.setName("text").setDescription("Note to append").setRequired(true).setMaxLength(2000),
        )
        .addAttachmentOption((option) =>
          option.setName("image").setDescription("Reference image for Cursor").setRequired(false),
        ),
    async ({ interaction, store, config }) => {
      const name = interaction.options.getString("name", true);
      const feature = store.getFeatureByName(name);
      if (!feature) {
        throw new UserFacingError(`No feature named "${name.trim()}".`);
      }
      await addNoteWithOptionalImage(interaction, store, config, feature);
    },
  ),
  command(
    "egon-list",
    "Open features (not accepted): name, state, note count",
    undefined,
    async ({ interaction, store, config }) => {
      const open = store.listOpenFeatures();
      const catalog = catalogUrl(config);
      if (open.length === 0) {
        await replyCommand(
          interaction,
          catalog ? `No open features.\n${discordLink(catalog)}` : "No open features.",
        );
        return;
      }
      const lines = open.map((feature) =>
        featureLine(feature, { noteCount: feature.noteCount }),
      );
      await replyCommand(
        interaction,
        ["**Open features**", ...lines, catalog ? `Catalog: ${discordLink(catalog)}` : ""]
          .filter((line) => line !== "")
          .join("\n"),
      );
    },
  ),
  command(
    "egon-plan",
    "Start planner for a named feature, or this channel's latest",
    (builder) =>
      builder.addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Feature name; omit to plan the latest in this channel")
          .setRequired(false)
          .setMaxLength(100),
      ),
    async ({ interaction, store, pipeline, config }) => {
      const name = interaction.options.getString("name")?.trim() ?? "";
      const feature =
        name === ""
          ? store.getLatestFeatureForChannel(config.discordChannelId)
          : store.getFeatureByName(name);
      if (name === "" && !feature) {
        throw new UserFacingError("No latest feature in this channel. Use /egon-new-feature first.");
      }
      if (!feature) {
        throw new UserFacingError(`No feature named "${name}".`);
      }
      const planned = store.startPlanning(feature.id);
      await replyCommand(
        interaction,
        `Started planning **${planned.name}**. Progress will be posted in this channel.`,
      );
      void pipeline.startPlan(planned.id).catch((error: unknown) => {
        console.error("plan pipeline failed", error);
      });
    },
  ),
  command(
    "egon-pivot",
    "Change request; re-enter implement + test",
    (builder) =>
      builder.addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Change request")
          .setRequired(true)
          .setMaxLength(2000),
      ),
    async ({ interaction, pipeline }) => {
      const text = interaction.options.getString("text", true);
      const message = await pipeline.pivot(text);
      await replyCommand(interaction, message);
    },
  ),
  command(
    "egon-retry",
    "Cancel a stuck run and continue the pipeline from this phase",
    undefined,
    async ({ interaction, pipeline }) => {
      const message = await pipeline.retry();
      await replyCommand(interaction, message);
    },
  ),
  command(
    "egon-stop",
    "Stop current planning, implementation, or testing",
    undefined,
    async ({ interaction, pipeline }) => {
      const message = await pipeline.stop();
      await replyCommand(interaction, message);
    },
  ),
  command(
    "egon-status",
    "Current pipeline feature + state",
    undefined,
    async ({ interaction, store, config }) => {
      const lock = store.getPipelineLock();
      if (!lock) {
        const catalog = catalogUrl(config);
        await replyCommand(
          interaction,
          catalog ? `No active pipeline.\n${discordLink(catalog)}` : "No active pipeline.",
        );
        return;
      }
      const catalog = catalogUrl(config, `/features/${featureSlug(lock.feature.name)}`);
      const activity = getActiveAgentActivity();
      const lines = [
        `Pipeline: **${lock.feature.name}** (${lock.feature.state}).`,
        activity ? formatStatusActivity(activity) : "",
        lock.feature.githubPrUrl ? discordLink(lock.feature.githubPrUrl) : "",
        catalog ? discordLink(catalog) : "",
      ].filter((line) => line !== "");
      await replyCommand(interaction, lines.join("\n"));
    },
  ),
];

export const COMMAND_BY_NAME = new Map(COMMANDS.map((entry) => [entry.name, entry]));

export async function registerGuildCommands(config: Config): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const body = COMMANDS.map((entry) => entry.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId), {
    body,
  });
  console.log(`Registered ${String(body.length)} guild slash commands`);
}
