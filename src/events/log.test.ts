import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_EVENT_DETAIL_CHARS,
  eventsPath,
  groupEvents,
  readEvents,
  recordEvent,
  deleteEventsForFeature,
  clearEvents,
  type EventEntry,
} from "./log.js";

function dataDir(): string {
  return mkdtempSync(join(tmpdir(), "egon-events-"));
}

function event(overrides: Partial<EventEntry> = {}): Omit<EventEntry, "at"> & { at?: string } {
  return {
    featureId: 1,
    feature: "Dash",
    slug: "dash",
    phase: "suite",
    step: "PASS dash moves right",
    level: "success",
    ...overrides,
  };
}

test("events round-trip through the JSONL file", () => {
  const dir = dataDir();
  recordEvent(dir, event({ at: "2026-09-08T10:00:00.000Z" }));
  recordEvent(dir, event({ at: "2026-09-08T10:00:05.000Z", step: "second", phase: "export" }));
  const entries = readEvents(dir);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.step, "PASS dash moves right");
  assert.equal(entries[1]?.phase, "export");
  assert.match(readFileSync(eventsPath(dir), "utf8"), /\n$/);
});

test("an absent or malformed log reads as empty rather than throwing", () => {
  assert.deepEqual(readEvents(dataDir()), []);
  const dir = dataDir();
  writeFileSync(eventsPath(dir), 'not json\n{"at":"x"}\n\n');
  assert.deepEqual(readEvents(dir), []);
});

test("a malformed line is skipped without losing the good ones", () => {
  const dir = dataDir();
  recordEvent(dir, event({ at: "2026-09-08T10:00:00.000Z" }));
  writeFileSync(eventsPath(dir), `${readFileSync(eventsPath(dir), "utf8")}garbage\n`);
  recordEvent(dir, event({ at: "2026-09-08T10:00:01.000Z", step: "kept" }));
  const entries = readEvents(dir);
  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.step, "kept");
});

test("recording never throws, even when the path is unusable", () => {
  // A broken log must not take a pipeline run down with it.
  const dir = dataDir();
  writeFileSync(join(dir, "blocked"), "not a directory");
  assert.doesNotThrow(() => {
    recordEvent(join(dir, "blocked"), event());
  });
});

test("long details are clipped so one stderr dump cannot dominate the page", () => {
  const dir = dataDir();
  recordEvent(dir, event({ detail: "x".repeat(MAX_EVENT_DETAIL_CHARS + 500) }));
  const detail = readEvents(dir)[0]?.detail ?? "";
  assert.ok(detail.length <= MAX_EVENT_DETAIL_CHARS + 20);
  assert.match(detail, /truncated/);
});

test("an empty detail is dropped rather than stored as a blank field", () => {
  const dir = dataDir();
  recordEvent(dir, event({ detail: "   " }));
  assert.equal(readEvents(dir)[0]?.detail, undefined);
});

test("a model label round-trips and a blank one is dropped", () => {
  const dir = dataDir();
  recordEvent(dir, event({ model: "grok 4.6 high" }));
  assert.equal(readEvents(dir)[0]?.model, "grok 4.6 high");
  recordEvent(dir, event({ step: "no model", model: "  " }));
  assert.equal(readEvents(dir)[1]?.model, undefined);
});

test("consecutive same-phase events become one group, a repeat becomes another", () => {
  // A feature that went round the loop twice must show two Export groups, not one blur.
  const entries: EventEntry[] = [
    { ...event({ phase: "export", step: "export 1", level: "success" }), at: "2026-09-08T10:00:00.000Z" },
    { ...event({ phase: "suite", step: "FAIL check", level: "failure" }), at: "2026-09-08T10:00:10.000Z" },
    { ...event({ phase: "fix", step: "fix round 1" }), at: "2026-09-08T10:00:20.000Z" },
    { ...event({ phase: "export", step: "export 2", level: "success" }), at: "2026-09-08T10:00:30.000Z" },
    { ...event({ phase: "suite", step: "PASS check", level: "success" }), at: "2026-09-08T10:00:40.000Z" },
  ];
  const [feature] = groupEvents(entries);
  assert.ok(feature);
  assert.deepEqual(
    feature.groups.map((group) => group.phase),
    ["export", "suite", "fix", "export", "suite"],
  );
  assert.equal(feature.groups[1]?.level, "failure");
  assert.equal(feature.groups[4]?.level, "success");
  assert.equal(feature.level, "failure");
});

test("group duration spans its own first and last event", () => {
  const entries: EventEntry[] = [
    { ...event({ phase: "suite", step: "a" }), at: "2026-09-08T10:00:00.000Z" },
    { ...event({ phase: "suite", step: "b" }), at: "2026-09-08T10:00:03.500Z" },
  ];
  const group = groupEvents(entries)[0]?.groups[0];
  assert.equal(group?.durationMs, 3500);
});

test("features are newest-first and keep their latest name", () => {
  const entries: EventEntry[] = [
    { ...event({ featureId: 1, feature: "Old name", slug: "old-name" }), at: "2026-09-08T10:00:00.000Z" },
    { ...event({ featureId: 2, feature: "Second", slug: "second" }), at: "2026-09-08T10:05:00.000Z" },
    { ...event({ featureId: 1, feature: "New name", slug: "new-name" }), at: "2026-09-08T10:10:00.000Z" },
  ];
  const grouped = groupEvents(entries);
  assert.deepEqual(grouped.map((item) => item.featureId), [1, 2]);
  assert.equal(grouped[0]?.feature, "New name");
  assert.equal(grouped[0]?.slug, "new-name");
});

test("a clock skew backwards does not produce a negative duration", () => {
  const entries: EventEntry[] = [
    { ...event({ step: "a" }), at: "2026-09-08T10:00:05.000Z" },
    { ...event({ step: "b" }), at: "2026-09-08T10:00:00.000Z" },
  ];
  assert.equal(groupEvents(entries)[0]?.groups[0]?.durationMs, 0);
});

test("deleteEventsForFeature removes one feature and leaves the rest", () => {
  const dir = dataDir();
  recordEvent(dir, event({ featureId: 1, step: "dash" }));
  recordEvent(dir, event({ featureId: 2, feature: "Jump", slug: "jump", step: "jump" }));
  writeFileSync(eventsPath(dir), `${readFileSync(eventsPath(dir), "utf8")}garbage\n`);
  assert.equal(deleteEventsForFeature(dir, 1), true);
  const entries = readEvents(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.featureId, 2);
  assert.match(readFileSync(eventsPath(dir), "utf8"), /garbage/);
  assert.equal(deleteEventsForFeature(dir, 1), false);
});

test("clearEvents wipes the log including malformed lines", () => {
  const dir = dataDir();
  recordEvent(dir, event());
  writeFileSync(eventsPath(dir), `${readFileSync(eventsPath(dir), "utf8")}garbage\n`);
  clearEvents(dir);
  assert.deepEqual(readEvents(dir), []);
  assert.equal(readFileSync(eventsPath(dir), "utf8"), "");
});
