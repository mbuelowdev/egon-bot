import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Pipeline event log. The agent log answers "what did this agent say"; this answers
 * "what did the pipeline do", which is a different question once one feature runs
 * plan → implement → export → suite → fix → export → suite again.
 *
 * Append-only JSONL in one global file so `/events` is a single read. Writing must never
 * break a pipeline run, so every failure here is swallowed and logged.
 */

export const EVENTS_FILENAME = "events.jsonl";
/** Newest events kept when rendering. Older lines stay on disk. */
export const MAX_EVENTS_READ = 2_000;
/** Detail bodies are evidence, not transcripts. */
export const MAX_EVENT_DETAIL_CHARS = 4_000;

export type EventLevel = "info" | "success" | "failure" | "warning";

export type EventPhase =
  | "plan"
  | "implement"
  | "export"
  | "suite"
  | "fix"
  | "review"
  | "merge"
  | "deploy";

export const PHASE_ORDER: EventPhase[] = [
  "plan",
  "implement",
  "export",
  "suite",
  "fix",
  "review",
  "merge",
  "deploy",
];

export type EventEntry = {
  at: string;
  featureId: number;
  feature: string;
  slug: string;
  phase: EventPhase;
  step: string;
  level: EventLevel;
  /** Shown when the step is expanded: stderr, a failing check, a report excerpt. */
  detail?: string;
  durationMs?: number;
};

export type EventInput = Omit<EventEntry, "at"> & { at?: string };

export function eventsPath(dataDir: string): string {
  return join(dataDir, EVENTS_FILENAME);
}

function clipDetail(detail: string): string {
  const trimmed = detail.trim();
  if (trimmed.length <= MAX_EVENT_DETAIL_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_EVENT_DETAIL_CHARS)}\n… (truncated)`;
}

/** Append one event. Never throws — a broken log must not fail a pipeline run. */
export function recordEvent(dataDir: string, input: EventInput): void {
  const { detail: rawDetail, at, ...rest } = input;
  const detail = rawDetail === undefined ? undefined : clipDetail(rawDetail);
  const entry: EventEntry = {
    ...rest,
    at: at ?? new Date().toISOString(),
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  };
  try {
    const path = eventsPath(dataDir);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("failed to record pipeline event", error);
  }
}

function isEventEntry(value: unknown): value is EventEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.at === "string" &&
    typeof rec.featureId === "number" &&
    typeof rec.feature === "string" &&
    typeof rec.phase === "string" &&
    typeof rec.step === "string"
  );
}

/** Oldest first. A malformed line is skipped, not fatal. */
export function readEvents(dataDir: string, limit = MAX_EVENTS_READ): EventEntry[] {
  const path = eventsPath(dataDir);
  if (!existsSync(path)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    console.error("failed to read pipeline events", error);
    return [];
  }
  const entries: EventEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEventEntry(parsed)) {
        entries.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return entries.slice(-limit);
}

function rewriteEvents(dataDir: string, keepLine: (line: string) => boolean): { kept: number; removed: number } {
  const path = eventsPath(dataDir);
  if (!existsSync(path)) {
    return { kept: 0, removed: 0 };
  }
  const kept: string[] = [];
  let removed = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    if (keepLine(line)) {
      kept.push(line);
    } else {
      removed += 1;
    }
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, "utf8");
  renameSync(tmp, path);
  return { kept: kept.length, removed };
}

function lineFeatureId(line: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (isEventEntry(parsed)) {
      return parsed.featureId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Drop every event for one feature. Malformed lines stay. Returns whether any were removed. */
export function deleteEventsForFeature(dataDir: string, featureId: number): boolean {
  return rewriteEvents(dataDir, (line) => lineFeatureId(line) !== featureId).removed > 0;
}

/** Empty the log. Malformed lines go too — this is an explicit wipe. */
export function clearEvents(dataDir: string): void {
  rewriteEvents(dataDir, () => false);
}

export type EventGroup = {
  phase: EventPhase;
  events: EventEntry[];
  level: EventLevel;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type FeatureEvents = {
  featureId: number;
  feature: string;
  slug: string;
  groups: EventGroup[];
  level: EventLevel;
  lastAt: string;
};

function worstLevel(levels: EventLevel[]): EventLevel {
  if (levels.includes("failure")) {
    return "failure";
  }
  if (levels.includes("warning")) {
    return "warning";
  }
  if (levels.includes("success")) {
    return "success";
  }
  return "info";
}

function elapsed(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return end - start;
}

/**
 * Consecutive same-phase events become one collapsible group, so a feature that went
 * through the loop twice shows two Export groups and two Suite groups rather than one
 * merged blur. Ordering is chronological within a feature; features are newest-first.
 */
export function groupEvents(entries: EventEntry[]): FeatureEvents[] {
  const byFeature = new Map<number, FeatureEvents>();
  for (const entry of entries) {
    let feature = byFeature.get(entry.featureId);
    if (!feature) {
      feature = {
        featureId: entry.featureId,
        feature: entry.feature,
        slug: entry.slug,
        groups: [],
        level: "info",
        lastAt: entry.at,
      };
      byFeature.set(entry.featureId, feature);
    }
    // Keep the latest name/slug: a feature can be renamed between runs.
    feature.feature = entry.feature;
    feature.slug = entry.slug;
    feature.lastAt = entry.at;
    const last = feature.groups.at(-1);
    if (last && last.phase === entry.phase) {
      last.events.push(entry);
      continue;
    }
    feature.groups.push({
      phase: entry.phase,
      events: [entry],
      level: "info",
      startedAt: entry.at,
      endedAt: entry.at,
      durationMs: 0,
    });
  }
  const features = [...byFeature.values()];
  for (const feature of features) {
    for (const group of feature.groups) {
      group.level = worstLevel(group.events.map((event) => event.level));
      group.startedAt = group.events[0]?.at ?? group.startedAt;
      group.endedAt = group.events.at(-1)?.at ?? group.endedAt;
      group.durationMs = elapsed(group.startedAt, group.endedAt);
    }
    feature.level = worstLevel(feature.groups.map((group) => group.level));
  }
  features.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return features;
}
