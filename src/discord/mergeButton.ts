import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export const MERGE_CUSTOM_ID_PREFIX = "egon-merge:";

function parsePositiveInt(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    return undefined;
  }
  return id;
}

export function mergeButtonRow(featureId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MERGE_CUSTOM_ID_PREFIX}${String(featureId)}`)
      .setLabel("Merge the feature")
      .setStyle(ButtonStyle.Success),
  );
}

export function parseMergeCustomId(customId: string): number | undefined {
  if (!customId.startsWith(MERGE_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  return parsePositiveInt(customId.slice(MERGE_CUSTOM_ID_PREFIX.length));
}
