import { type Client, type Message } from "discord.js";
import { noLinkPreview } from "./preview.js";

const DISCORD_LIMIT = 2000;

export async function postToChannel(
  client: Client,
  channelId: string,
  content: string,
): Promise<Message> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Configured Discord channel is not a guild text channel");
  }
  const chunks = splitContent(content);
  let last: Message | undefined;
  for (const chunk of chunks) {
    last = await channel.send(noLinkPreview({ content: chunk }));
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
