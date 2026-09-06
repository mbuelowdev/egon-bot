import { type Client, type Message, type MessageCreateOptions } from "discord.js";
import { noLinkPreview } from "./preview.js";

const DISCORD_LIMIT = 2000;

export async function clearMessageComponents(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Configured Discord channel is not a guild text channel");
  }
  const message = await channel.messages.fetch(messageId);
  await message.edit({ components: [] });
}

async function removeComponentsQuietly(
  client: Client,
  channelId: string,
  messageId: string | null | undefined,
  label: string,
): Promise<void> {
  if (!messageId) {
    return;
  }
  try {
    await clearMessageComponents(client, channelId, messageId);
  } catch (error) {
    console.error(`failed to remove ${label}`, error);
  }
}

/** Strip the Add specifics button from the /egon-new-feature reply. Missing or deleted messages are ignored. */
export async function removeAddNoteButton(
  client: Client,
  channelId: string,
  messageId: string | null | undefined,
): Promise<void> {
  await removeComponentsQuietly(client, channelId, messageId, "Add specifics button");
}

/** Strip Merge the feature from the review-ready message. Missing or deleted messages are ignored. */
export async function removeMergeButton(
  client: Client,
  channelId: string,
  messageId: string | null | undefined,
): Promise<void> {
  await removeComponentsQuietly(client, channelId, messageId, "Merge the feature button");
}

export async function postToChannel(
  client: Client,
  channelId: string,
  content: string,
  options?: { components?: MessageCreateOptions["components"] },
): Promise<Message> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Configured Discord channel is not a guild text channel");
  }
  const chunks = splitContent(content);
  let last: Message | undefined;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) {
      continue;
    }
    const isLast = i === chunks.length - 1;
    last = await channel.send(
      noLinkPreview({
        content: chunk,
        ...(isLast && options?.components !== undefined ? { components: options.components } : {}),
      }),
    );
  }
  if (!last) {
    throw new Error("Failed to post Discord message");
  }
  return last;
}

export async function postFiles(
  client: Client,
  targetId: string,
  files: string[],
  content: string,
): Promise<void> {
  const channel = await client.channels.fetch(targetId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Cannot post files to that channel");
  }
  if (files.length === 0) {
    await channel.send(noLinkPreview({ content }));
    return;
  }
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const slice = files.slice(i, i + batchSize);
    await channel.send(
      i === 0 ? noLinkPreview({ content, files: slice }) : noLinkPreview({ files: slice }),
    );
  }
}

function splitContent(content: string): string[] {
  if (content.length <= DISCORD_LIMIT) {
    return [content];
  }
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > DISCORD_LIMIT) {
    chunks.push(remaining.slice(0, DISCORD_LIMIT));
    remaining = remaining.slice(DISCORD_LIMIT);
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}
