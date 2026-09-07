import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const GAME_DECISIONS_REPO_PATH = "docs/GAME_DECISIONS.md";

export const GAME_DECISION_TOPICS = ["art-style", "camera", "control-scheme", "palette"] as const;

export type GameDecisionTopic = (typeof GAME_DECISION_TOPICS)[number];

export const GAME_DECISION_HEADINGS: Record<GameDecisionTopic, string> = {
  "art-style": "Art style",
  camera: "Camera",
  "control-scheme": "Control scheme",
  palette: "Palette",
};

const HEADING_TO_TOPIC: Record<string, GameDecisionTopic> = {
  "art style": "art-style",
  "art-style": "art-style",
  camera: "camera",
  "control scheme": "control-scheme",
  "control-scheme": "control-scheme",
  palette: "palette",
};

const TOPIC_SET = new Set<string>(GAME_DECISION_TOPICS);

const TITLE = "# Game decisions";
const INTRO = "Settled global choices. Do not re-ask Discord unless this feature must change one.";

const DEFAULT_ANSWER_RE = /^\(no Discord answer; using default: (.*)\)$/;
const EMPTY_DEFAULT_ANSWER = "(no Discord answer; no default was provided)";

type GameDecisionsDoc = {
  topics: Partial<Record<GameDecisionTopic, string>>;
  extra: Array<{ heading: string; body: string }>;
};

export function gameDecisionsRepoPath(gameRepoDir: string): string {
  return join(gameRepoDir, GAME_DECISIONS_REPO_PATH);
}

export function parseGameDecisionTopic(value: unknown): GameDecisionTopic | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (TOPIC_SET.has(trimmed)) {
    return trimmed as GameDecisionTopic;
  }
  return HEADING_TO_TOPIC[trimmed.replaceAll("_", " ").replaceAll("-", " ")];
}

export function unwrapPlannerAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed === "" || trimmed === EMPTY_DEFAULT_ANSWER) {
    return "";
  }
  const matched = DEFAULT_ANSWER_RE.exec(trimmed);
  if (matched && matched[1] !== undefined) {
    return matched[1].trim();
  }
  return trimmed;
}

export function classifyDecisionTopic(question: string, explicit?: string): GameDecisionTopic | undefined {
  const fromExplicit = parseGameDecisionTopic(explicit);
  if (fromExplicit) {
    return fromExplicit;
  }
  const q = question.toLowerCase();
  if (/\bart\s*style\b/.test(q) || /\bvisual\s*style\b/.test(q) || /\bpixel\s*art\b/.test(q) || /\baesthetic\b/.test(q)) {
    return "art-style";
  }
  if (
    /\bcamera\b/.test(q) ||
    /\btop-?down\b/.test(q) ||
    /\bside-?scroll/.test(q) ||
    /\bisometric\b/.test(q) ||
    /\bfirst-?person\b/.test(q) ||
    /\bthird-?person\b/.test(q)
  ) {
    return "camera";
  }
  if (
    /\bcontrol\s*scheme\b/.test(q) ||
    /\binput\s*scheme\b/.test(q) ||
    /\bplayer\s+controls\b/.test(q) ||
    /\bkeybind/.test(q) ||
    /\bwasd\b/.test(q) ||
    /\bhow (?:do|does|should) (?:you|the player|they) (?:move|control)\b/.test(q)
  ) {
    return "control-scheme";
  }
  if (/\bpalette\b/.test(q) || /\bcolou?r\s*scheme\b/.test(q)) {
    return "palette";
  }
  return undefined;
}

export function gameDecisionsPromptSection(markdown: string): string[] {
  const trimmed = markdown.trim();
  if (trimmed === "") {
    return [
      "No settled GAME_DECISIONS yet. If this feature depends on art style, camera, control scheme, or palette, ask Discord once and set `topic` on those questions so they persist.",
      "",
    ];
  }
  return [
    "Settled global game decisions. Do not re-ask Discord about a heading that already has an answer unless this feature must change it. If a heading is missing and this feature depends on it, ask and set `topic`.",
    "",
    trimmed,
    "",
  ];
}

export function loadGameDecisionsMarkdown(config: { gameRepoDir: string }): string {
  const path = gameDecisionsRepoPath(config.gameRepoDir);
  if (!existsSync(path)) {
    return "";
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function parseGameDecisions(markdown: string): GameDecisionsDoc {
  const topics: Partial<Record<GameDecisionTopic, string>> = {};
  const extra: Array<{ heading: string; body: string }> = [];
  const trimmed = markdown.trim();
  if (trimmed === "") {
    return { topics, extra };
  }
  const parts = trimmed.split(/^## /m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const body = (newline === -1 ? "" : part.slice(newline + 1)).trim();
    if (heading === "") {
      continue;
    }
    const topic = HEADING_TO_TOPIC[heading.toLowerCase()];
    if (topic) {
      if (body !== "") {
        topics[topic] = body;
      }
      continue;
    }
    extra.push({ heading, body });
  }
  return { topics, extra };
}

export function renderGameDecisions(doc: GameDecisionsDoc): string {
  const lines = [TITLE, "", INTRO, ""];
  for (const topic of GAME_DECISION_TOPICS) {
    const body = doc.topics[topic]?.trim() ?? "";
    if (body === "") {
      continue;
    }
    lines.push(`## ${GAME_DECISION_HEADINGS[topic]}`, "", body, "");
  }
  for (const section of doc.extra) {
    const body = section.body.trim();
    lines.push(`## ${section.heading}`, "");
    if (body !== "") {
      lines.push(body, "");
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function mergeGameDecisions(
  existing: string,
  updates: Array<{ topic: GameDecisionTopic; answer: string }>,
): string {
  const doc = parseGameDecisions(existing);
  for (const update of updates) {
    const answer = update.answer.trim();
    if (answer === "") {
      continue;
    }
    doc.topics[update.topic] = answer;
  }
  return renderGameDecisions(doc);
}

export function accumulateGameDecisions(
  config: { gameRepoDir: string },
  pairs: Array<{ question: string; answer: string; topic?: string }>,
): boolean {
  const updates: Array<{ topic: GameDecisionTopic; answer: string }> = [];
  for (const pair of pairs) {
    const answer = unwrapPlannerAnswer(pair.answer);
    if (answer === "") {
      continue;
    }
    const topic = classifyDecisionTopic(pair.question, pair.topic);
    if (!topic) {
      continue;
    }
    updates.push({ topic, answer });
  }
  if (updates.length === 0) {
    return false;
  }
  const path = gameDecisionsRepoPath(config.gameRepoDir);
  const previous = loadGameDecisionsMarkdown(config);
  const next = mergeGameDecisions(previous, updates);
  if (next === previous || next.trim() === "") {
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  return true;
}
