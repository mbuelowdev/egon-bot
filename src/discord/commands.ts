import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { catalogUrl, type Config } from "../config.js";
import { featureSlug } from "../features/slug.js";
import { UserFacingError, type Feature, type FeatureStore } from "../features/store.js";
import type { Pipeline } from "../pipeline/orchestrator.js";

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

function featureLine(feature: Feature, extra?: { noteCount?: number }): string {
  const notes =
    extra?.noteCount === undefined
      ? undefined
      : extra.noteCount === 1
        ? "1 note"
        : `${String(extra.noteCount)} notes`;
  const bits = [feature.state, notes, feature.githubPrUrl].filter(
    (value): value is string => value !== undefined && value !== null && value !== "",
  );
  return `• **${feature.name}** — ${bits.join(", ")}`;
}

export const COMMANDS: RegisteredCommand[] = [
  command(
    "egon-help",
    "List every command with its short explanation",
    undefined,
    async ({ interaction }) => {
      const lines = COMMANDS.map((entry) => `\`/${entry.name}\` — ${entry.description}`);
      await interaction.reply({
        content: ["**Egon commands**", ...lines].join("\n"),
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
      await interaction.reply(
        `Created **${feature.name}** (${feature.state}). It is now the latest feature in this channel.`,
      );
    },
  ),
  command(
    "egon-add",
    "Append note to latest feature in this channel",
    (builder) =>
      builder.addStringOption((option) =>
        option.setName("text").setDescription("Note to append").setRequired(true).setMaxLength(2000),
      ),
    async ({ interaction, store, config }) => {
      const latest = store.getLatestFeatureForChannel(config.discordChannelId);
      if (!latest) {
        throw new UserFacingError("No latest feature in this channel. Use /egon-new-feature first.");
      }
      const text = interaction.options.getString("text", true);
      store.addNote(latest.id, text);
      await interaction.reply(`Added a note to **${latest.name}**.`);
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
        ),
    async ({ interaction, store }) => {
      const name = interaction.options.getString("name", true);
      const feature = store.getFeatureByName(name);
      if (!feature) {
        throw new UserFacingError(`No feature named "${name.trim()}".`);
      }
      const text = interaction.options.getString("text", true);
      store.addNote(feature.id, text);
      await interaction.reply(`Added a note to **${feature.name}**.`);
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
        await interaction.reply(
          catalog ? `No open features.\n${catalog}` : "No open features.",
        );
        return;
      }
      const lines = open.map((feature) =>
        featureLine(feature, { noteCount: feature.noteCount }),
      );
      await interaction.reply(
        ["**Open features**", ...lines, catalog ? `Catalog: ${catalog}` : ""]
          .filter((line) => line !== "")
          .join("\n"),
      );
    },
  ),
  command(
    "egon-plan",
    "Start planner; fail if another pipeline is active",
    (builder) =>
      builder.addStringOption((option) =>
        option.setName("name").setDescription("Feature name").setRequired(true).setMaxLength(100),
      ),
    async ({ interaction, store, pipeline }) => {
      const name = interaction.options.getString("name", true);
      const feature = store.getFeatureByName(name);
      if (!feature) {
        throw new UserFacingError(`No feature named "${name.trim()}".`);
      }
      const planned = store.startPlanning(feature.id);
      await interaction.reply(
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
      await interaction.reply(message);
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
        await interaction.reply(catalog ? `No active pipeline.\n${catalog}` : "No active pipeline.");
        return;
      }
      const catalog = catalogUrl(config, `/features/${featureSlug(lock.feature.name)}`);
      const lines = [
        `Pipeline: **${lock.feature.name}** (${lock.feature.state}).`,
        lock.feature.githubPrUrl ?? "",
        catalog ?? "",
      ].filter((line) => line !== "");
      await interaction.reply(lines.join("\n"));
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
