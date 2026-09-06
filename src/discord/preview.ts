import { MessageFlags, type MessageCreateOptions } from "discord.js";

/** Discord flag that stops the client from unfurling URLs into link-preview embeds. */
export const SUPPRESS_LINK_PREVIEW = MessageFlags.SuppressEmbeds;

/**
 * Discord markdown: wrapping a URL in `<>` posts it as a clickable link without a preview.
 * Already-wrapped values are left unchanged.
 */
export function discordLink(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return url;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed;
  }
  return `<${trimmed}>`;
}

export type NoLinkPreviewOptions = {
  content?: string;
  ephemeral?: boolean;
  files?: MessageCreateOptions["files"];
};

export function noLinkPreview(options: NoLinkPreviewOptions): {
  content?: string;
  flags: typeof SUPPRESS_LINK_PREVIEW;
  ephemeral?: boolean;
  files?: MessageCreateOptions["files"];
} {
  return {
    flags: SUPPRESS_LINK_PREVIEW,
    ...(options.content !== undefined ? { content: options.content } : {}),
    ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
    ...(options.files !== undefined ? { files: options.files } : {}),
  };
}
