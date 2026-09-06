export function isInConfiguredChannel(
  channelId: string,
  parentId: string | null | undefined,
  configuredChannelId: string,
): boolean {
  return channelId === configuredChannelId || parentId === configuredChannelId;
}
