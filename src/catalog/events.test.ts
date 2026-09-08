import assert from "node:assert/strict";
import { test } from "node:test";
import { groupEvents, type EventEntry } from "../events/log.js";
import {
  EVENTS_POLL_BACKOFF_MS,
  EVENTS_POLL_MS,
  eventsPage,
  formatEventClock,
  formatEventDuration,
  renderEventFeatures,
} from "./events.js";

function event(overrides: Partial<EventEntry> = {}): EventEntry {
  return {
    at: "2026-09-08T10:00:00.000Z",
    featureId: 1,
    feature: "Dash HUD",
    slug: "dash-hud",
    phase: "suite",
    step: "PASS dash moves right",
    level: "success",
    ...overrides,
  };
}

test("clock and duration formatting stay compact", () => {
  assert.equal(formatEventClock("2026-09-08T10:03:07.000Z"), "10:03:07");
  assert.equal(formatEventClock("nonsense"), "--:--:--");
  assert.equal(formatEventDuration(320), "320ms");
  assert.equal(formatEventDuration(3500), "3.5s");
  assert.equal(formatEventDuration(125_000), "2m 5s");
});

test("an empty log renders a page that says so instead of a blank list", () => {
  const html = eventsPage([]);
  assert.match(html, /No pipeline events yet/);
  assert.match(html, /<h1>Pipeline events<\/h1>/);
});

test("each phase becomes a collapsible group with a status dot and step count", () => {
  const html = eventsPage(
    groupEvents([
      event({ phase: "export", step: "Export succeeded", at: "2026-09-08T10:00:00.000Z" }),
      event({
        phase: "suite",
        step: "FAIL victory screen",
        level: "failure",
        detail: "expected 4200, actual 0",
        at: "2026-09-08T10:00:04.000Z",
      }),
    ]),
  );
  assert.match(html, /<details class="event-group"/);
  assert.match(html, /<span class="event-phase">export<\/span>/);
  assert.match(html, /<span class="event-phase">suite<\/span>/);
  assert.match(html, /<span class="dot failure"/);
  assert.match(html, /1 step/);
  assert.match(html, /FAIL victory screen/);
  // Detail is behind its own disclosure so a stderr dump does not flood the page.
  assert.match(html, /<details class="event-detail"><summary>details<\/summary><pre>expected 4200, actual 0<\/pre>/);
});

test("the newest group opens so the interesting part is visible without clicking", () => {
  const html = eventsPage(
    groupEvents([
      event({ phase: "plan", at: "2026-09-08T10:00:00.000Z" }),
      event({ phase: "suite", at: "2026-09-08T10:01:00.000Z" }),
    ]),
  );
  const opens = [...html.matchAll(/<details class="event-group"[^>]* open>/g)];
  assert.equal(opens.length, 1);
  // …and it is the last one, not the first.
  assert.ok(/<details class="event-group"[^>]* open>/.exec(html));
  assert.ok((opens[0]?.index ?? 0) > html.indexOf('event-phase">plan'));
});

test("a feature section is anchored and links back to its detail page", () => {
  const html = eventsPage(groupEvents([event()]));
  assert.match(html, /<section class="event-feature" id="feature-dash-hud">/);
  assert.match(html, /<a href="\/features\/dash-hud">Dash HUD<\/a>/);
});

test("event text is escaped, not injected", () => {
  const html = eventsPage(
    groupEvents([
      event({ step: '<img src=x onerror="alert(1)">', detail: "<script>alert(2)</script>" }),
    ]),
  );
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert\(2\)/);
  assert.match(html, /&lt;img src=x/);
});

test("expand and collapse controls are present for a GitHub-Actions-style read", () => {
  const html = eventsPage(groupEvents([event()]));
  assert.match(html, /data-events-expand/);
  assert.match(html, /data-events-collapse/);
});

test("a regression failure names the feature that owns the broken check", () => {
  const html = eventsPage(
    groupEvents([
      event({
        step: "FAIL victory screen [endgame_victory] — regression from endgame-screen (step 3)",
        level: "failure",
      }),
    ]),
  );
  assert.match(html, /regression from endgame-screen/);
});

test("groups carry a stable key so a poll can restore what the reader had open", () => {
  const entries = [
    event({ phase: "export", at: "2026-09-08T10:00:00.000Z" }),
    event({ phase: "suite", at: "2026-09-08T10:00:04.000Z" }),
  ];
  const first = renderEventFeatures(groupEvents(entries));
  const keys = [...first.matchAll(/data-group-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["1:export:2026-09-08T10:00:00.000Z", "1:suite:2026-09-08T10:00:04.000Z"]);
  // A later event in the same phase must not change that phase's key, or the reader's
  // open/closed choice would be lost on every poll.
  const later = renderEventFeatures(
    groupEvents([...entries, event({ phase: "suite", step: "another", at: "2026-09-08T10:00:09.000Z" })]),
  );
  assert.ok(later.includes('data-group-key="1:suite:2026-09-08T10:00:04.000Z"'));
});

test("the fragment is sections only, with none of the page shell", () => {
  const html = renderEventFeatures(groupEvents([event()]));
  assert.match(html, /<section class="event-feature"/);
  assert.doesNotMatch(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /data-events-expand/);
});

test("the page ships the poll loop and a live indicator", () => {
  const html = eventsPage(groupEvents([event()]));
  assert.match(html, /<div id="event-list">/);
  assert.match(html, /data-live-status/);
  assert.match(html, /\/events\/fragment/);
  assert.match(html, /If-None-Match/);
  assert.match(html, new RegExp(`schedule\\(${String(EVENTS_POLL_MS)}\\)`));
  assert.match(html, new RegExp(`schedule\\(${String(EVENTS_POLL_BACKOFF_MS)}\\)`));
  // Placeholders must have been interpolated, not shipped as literal source text.
  assert.doesNotMatch(html, /schedule\(POLL_MS\)|schedule\(BACKOFF_MS\)/);
  assert.doesNotMatch(html, /\$\{/);
});

test("the injected poll script is syntactically valid JavaScript", () => {
  const html = eventsPage(groupEvents([event()]));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
  assert.ok(scripts.length > 0);
  for (const source of scripts) {
    assert.doesNotThrow(() => new Function(source), `script did not parse: ${source.slice(0, 80)}`);
  }
});

test("polling pauses on a hidden tab and backs off after a failure", () => {
  const html = eventsPage(groupEvents([event()]));
  assert.match(html, /if \(document\.hidden\)/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /Reconnecting/);
  assert.match(html, /Paused/);
});
