const DISCORD_LIMIT = 2000;

export type CommandOptionValue = string | number | boolean;

export type CommandAnnouncementInput = {
  runnerName: string;
  commandName: string;
  options?: ReadonlyArray<{ name: string; value: CommandOptionValue }>;
};

export function formatOptionValue(value: CommandOptionValue): string {
  return JSON.stringify(value);
}

/** Public channel line, e.g. `Michael ran: egon-add "jump has to be higher"`. */
export function formatCommandAnnouncement(input: CommandAnnouncementInput): string {
  const args = (input.options ?? []).map((opt) => formatOptionValue(opt.value)).join(" ");
  const text = args
    ? `${input.runnerName} ran: ${input.commandName} ${args}`
    : `${input.runnerName} ran: ${input.commandName}`;
  if (text.length <= DISCORD_LIMIT) {
    return text;
  }
  return `${text.slice(0, DISCORD_LIMIT - 1)}…`;
}
