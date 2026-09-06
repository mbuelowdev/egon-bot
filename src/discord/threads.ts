export type ThreadMessage = {
  id: string;
  authorId: string;
  mentionedUserIds: readonly string[];
};

/**
 * First human message in order that mentions the bot is the answer.
 * Bot-authored messages never win. Later mentions are ignored.
 */
export function firstMentionAnswer(
  messages: readonly ThreadMessage[],
  botUserId: string,
): ThreadMessage | null {
  for (const message of messages) {
    if (isWinningMention(message, botUserId, false)) {
      return message;
    }
  }
  return null;
}

export function isWinningMention(
  message: ThreadMessage,
  botUserId: string,
  alreadyAnswered: boolean,
): boolean {
  if (alreadyAnswered) {
    return false;
  }
  if (message.authorId === botUserId) {
    return false;
  }
  return message.mentionedUserIds.includes(botUserId);
}

export function isInConfiguredChannel(
  channelId: string,
  parentId: string | null | undefined,
  configuredChannelId: string,
): boolean {
  return channelId === configuredChannelId || parentId === configuredChannelId;
}
