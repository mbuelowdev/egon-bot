import type { TestReport } from "./cursor/testReport.js";
import { discordLink } from "./discord/preview.js";

const DISCORD_MESSAGE_LIMIT = 2000;

/** Discord prefix for pipeline phase logs. */
export const PHASE_EMOJI = {
  planning: "📋",
  implementing: "🛠️",
  testing: "🔍",
  review: "👀",
  stop: "🛑",
} as const;

function trimDecimal(value: string): string {
  return value.replace(/\.0$/, "");
}

/** Escape Discord markdown so user text cannot change surrounding formatting. */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([\\*_`~|])/g, "\\$1");
}

function flattenDiscordLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatNoteBullet(note: string): string {
  const escaped = escapeDiscordMarkdown(flattenDiscordLine(note));
  const body = escaped.replace(/^([-*] )/, "\\$1").replace(/^(\d+)([.)] )/, "$1\\$2");
  return `- ${body}`;
}

function clipDiscordMessage(text: string): string {
  if (text.length <= DISCORD_MESSAGE_LIMIT) {
    return text;
  }
  return `${text.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

function escapedFeatureName(name: string): string {
  return escapeDiscordMarkdown(flattenDiscordLine(name)).replace(/]/g, "\\]");
}

/** Bold feature name, linked to the catalog page when a URL is available. */
export function formatFeatureName(name: string, pageUrl?: string): string {
  const label = `**${escapedFeatureName(name)}**`;
  if (pageUrl === undefined || pageUrl === "") {
    return label;
  }
  return `[${label}](${discordLink(pageUrl)})`;
}

/** Channel line when implementation starts. */
export function formatImplementationStart(name: string, pageUrl?: string): string {
  return `${PHASE_EMOJI.implementing} Implementation started for ${formatFeatureName(name, pageUrl)}.`;
}

/** Channel line when testing starts. */
export function formatTestingStart(name: string, pageUrl?: string): string {
  return `${PHASE_EMOJI.testing} Testing started for ${formatFeatureName(name, pageUrl)}`;
}

function sanitizeCodeCell(text: string): string {
  return flattenDiscordLine(text).replaceAll("```", "'''");
}

function formatMonospaceTable(rows: string[][]): string {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, col) =>
    Math.max(0, ...rows.map((row) => row[col]?.length ?? 0)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, col) => (col === columnCount - 1 ? cell : cell.padEnd(widths[col] ?? 0)))
        .join("  "),
    )
    .join("\n");
}

/** Tester summary. Discord has no markdown tables, so this uses a monospace grid. */
export function formatTestReport(report: TestReport): string {
  const overall = report.overallPass ? "PASS" : "FAIL";
  const table = formatMonospaceTable([
    ["#", "Result", "Criterion"],
    ...report.criteria.map((item) => [
      String(item.index),
      item.status,
      sanitizeCodeCell(item.text),
    ]),
  ]);
  return clipDiscordMessage(`${PHASE_EMOJI.testing} **${overall}**\n\`\`\`\n${table}\n\`\`\``);
}

/** Channel line when a PR is ready for review. */
export function formatReviewReady(name: string, pageUrl?: string, prUrl?: string): string {
  const pr = prUrl !== undefined && prUrl !== "" ? `[PR](${discordLink(prUrl)})` : "PR";
  return `${PHASE_EMOJI.review} ${pr} ready for review: ${formatFeatureName(name, pageUrl)}.`;
}

/** Confirmation after /egon-plan. */
export function formatPlanStarted(name: string, pageUrl?: string): string {
  return `${PHASE_EMOJI.planning} Started planning ${formatFeatureName(name, pageUrl)}. Progress will be posted in this channel.`;
}

/** Channel line when a plan run starts, with collected notes listed below. */
export function formatPlanningStart(name: string, notes: string[], pageUrl?: string): string {
  const title = `${PHASE_EMOJI.planning} Planning ${formatFeatureName(name, pageUrl)}.`;
  return clipDiscordMessage([title, ...notes.map(formatNoteBullet)].join("\n"));
}

function italicDiscord(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `*${line}*`))
    .join("\n");
}

function formatQuotedUserText(title: string, text: string, assetPath?: string): string {
  const lines = [title, italicDiscord(escapeDiscordMarkdown(text.trim()))];
  if (assetPath !== undefined && assetPath !== "") {
    lines.push(escapeDiscordMarkdown(assetPath));
  }
  return clipDiscordMessage(lines.join("\n"));
}

/** Confirmation after /egon-add or /egon-add-to-feature. */
export function formatNoteAdded(name: string, text: string, assetPath?: string, pageUrl?: string): string {
  return formatQuotedUserText(`Added a note to ${formatFeatureName(name, pageUrl)}.`, text, assetPath);
}

/** Confirmation after /egon-pivot. */
export function formatPivoting(name: string, text: string, assetPath?: string, pageUrl?: string): string {
  return formatQuotedUserText(
    `Pivoting ${formatFeatureName(name, pageUrl)}. Re-entering implement and test.`,
    text,
    assetPath,
  );
}

/** Compact count: 1500 → 1.5k, 1_200_000 → 1.2M. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "0";
  }
  const n = Math.round(tokens);
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    const value = n / 1000;
    return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}k`;
  }
  if (n < 1_000_000_000) {
    const value = n / 1_000_000;
    return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}M`;
  }
  const value = n / 1_000_000_000;
  return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}B`;
}

/** Compact wall-clock: 125000 → 2m 5s, 3750000 → 1h 2m. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0s";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${String(totalMinutes)}m` : `${String(totalMinutes)}m ${String(seconds)}s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0 ? `${String(totalHours)}h` : `${String(totalHours)}h ${String(minutes)}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours)}h`;
}
