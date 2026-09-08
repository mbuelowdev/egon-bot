import { createHash } from "node:crypto";
import type { EventEntry, EventGroup, EventLevel, FeatureEvents } from "../events/log.js";
import { escapeHtml } from "./markdown.js";
import { BACK_ARROW, layout } from "./page.js";

/**
 * GitHub-Actions-shaped pipeline log: one section per feature, one collapsible group per
 * phase, timestamped steps inside. The agent log on the feature page answers what an
 * agent said; this answers what the pipeline did, which is a different question once a
 * single feature runs plan → implement → export → suite → fix → export → suite.
 */

const CARET = `<svg class="caret" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l8 7-8 7z"/></svg>`;

/** Poll interval while the tab is visible. Nobody needs sub-second pipeline news. */
export const EVENTS_POLL_MS = 4_000;
/** Backoff after a failed poll, so a restarting server is not hammered. */
export const EVENTS_POLL_BACKOFF_MS = 15_000;

const EVENTS_SCRIPT = `<script>
(function () {
  var groups = function () { return document.querySelectorAll("details.event-group"); };
  var setAll = function (open) {
    groups().forEach(function (el) { el.open = open; });
  };
  var expand = document.querySelector("[data-events-expand]");
  var collapse = document.querySelector("[data-events-collapse]");
  if (expand) { expand.addEventListener("click", function () { setAll(true); }); }
  if (collapse) { collapse.addEventListener("click", function () { setAll(false); }); }

  var openHash = function () {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) { return; }
    var target = document.getElementById(hash.slice(1));
    if (!target) { return; }
    target.querySelectorAll("details.event-group").forEach(function (el) { el.open = true; });
    target.scrollIntoView();
  };
  openHash();

  var list = document.getElementById("event-list");
  var status = document.querySelector("[data-live-status]");
  if (!list || !window.fetch) { return; }

  var etag = list.getAttribute("data-etag");
  var timer = null;
  var stopped = false;

  var setStatus = function (text, level) {
    if (!status) { return; }
    status.innerHTML = '<span class="dot ' + level + '"></span>' + text;
  };

  // Phase groups and per-step evidence disclosures both survive a swap. Anything the
  // reader had not seen yet keeps whatever the server sent.
  var disclosureKey = function (el) {
    var group = el.getAttribute("data-group-key");
    if (group) { return "g:" + group; }
    var detail = el.getAttribute("data-detail-key");
    if (detail) { return "d:" + detail; }
    return null;
  };
  var disclosures = function () {
    return document.querySelectorAll("details[data-group-key], details[data-detail-key]");
  };
  var snapshot = function () {
    var open = {};
    var seen = {};
    disclosures().forEach(function (el) {
      var key = disclosureKey(el);
      if (!key) { return; }
      seen[key] = true;
      if (el.open) { open[key] = true; }
    });
    return { open: open, seen: seen };
  };
  var restore = function (state) {
    disclosures().forEach(function (el) {
      var key = disclosureKey(el);
      if (!key || !state.seen[key]) { return; }
      el.open = Boolean(state.open[key]);
    });
  };

  var schedule = function (delay) {
    if (stopped) { return; }
    if (timer) { window.clearTimeout(timer); }
    timer = window.setTimeout(poll, delay);
  };

  var poll = function () {
    if (document.hidden) {
      setStatus("Paused", "info");
      schedule(${String(EVENTS_POLL_MS)});
      return;
    }
    var headers = etag ? { "If-None-Match": etag } : {};
    window
      .fetch("/events/fragment", { headers: headers, cache: "no-store" })
      .then(function (res) {
        if (res.status === 304) {
          setStatus("Live", "info");
          schedule(${String(EVENTS_POLL_MS)});
          return null;
        }
        if (!res.ok) { throw new Error("status " + res.status); }
        etag = res.headers.get("ETag");
        return res.text();
      })
      .then(function (html) {
        if (html === null || html === undefined) { return; }
        var state = snapshot();
        var top = window.scrollY;
        list.innerHTML = html;
        restore(state);
        window.scrollTo(0, top);
        setStatus("Live", "info");
        schedule(${String(EVENTS_POLL_MS)});
      })
      .catch(function () {
        setStatus("Reconnecting", "warning");
        schedule(${String(EVENTS_POLL_BACKOFF_MS)});
      });
  };

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { schedule(0); }
  });
  window.addEventListener("beforeunload", function () { stopped = true; });
  schedule(${String(EVENTS_POLL_MS)});
})();
</script>`;

export function formatEventClock(at: string): string {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) {
    return "--:--:--";
  }
  return new Date(parsed).toISOString().slice(11, 19);
}

export function formatEventDuration(ms: number): string {
  if (ms < 1000) {
    return `${String(Math.max(0, Math.round(ms)))}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${String(minutes)}m ${String(rest)}s`;
}

function dot(level: EventLevel): string {
  return `<span class="dot ${escapeHtml(level)}" aria-hidden="true"></span>`;
}

/** Weak-free content ETag so an unchanged poll costs a 304 and no body. */
export function eventsFragmentEtag(html: string): string {
  return `"${createHash("sha1").update(html).digest("hex")}"`;
}

function detailKey(event: EventEntry): string {
  return `${String(event.featureId)}:${event.at}:${event.phase}:${event.step}`;
}

function renderStep(event: EventEntry): string {
  const detail =
    event.detail === undefined || event.detail === ""
      ? ""
      : `<details class="event-detail" data-detail-key="${escapeHtml(detailKey(event))}"><summary>details</summary><pre>${escapeHtml(event.detail)}</pre></details>`;
  const duration =
    event.durationMs === undefined
      ? ""
      : ` <span class="event-count">(${escapeHtml(formatEventDuration(event.durationMs))})</span>`;
  return `<li class="event-step">
          ${dot(event.level)}
          <span class="event-time">${escapeHtml(formatEventClock(event.at))}</span>
          <span class="event-text">${escapeHtml(event.step)}${duration}${detail}</span>
        </li>`;
}

function groupKey(featureId: number, group: EventGroup): string {
  return `${String(featureId)}:${group.phase}:${group.startedAt}`;
}

function renderGroup(featureId: number, group: EventGroup, open: boolean): string {
  const count = group.events.length;
  const noun = count === 1 ? "step" : "steps";
  // A single-event group spans no time; showing "0ms" is noise, not information.
  const duration =
    group.durationMs > 0
      ? `<span class="event-dur">${escapeHtml(formatEventDuration(group.durationMs))}</span>`
      : "";
  return `<details class="event-group" data-group-key="${escapeHtml(groupKey(featureId, group))}"${open ? " open" : ""}>
        <summary>
          ${CARET}${dot(group.level)}
          <span class="event-phase">${escapeHtml(group.phase)}</span>
          <span class="event-count">${String(count)} ${noun}</span>
          ${duration}
        </summary>
        <ul class="event-steps">
          ${group.events.map(renderStep).join("\n          ")}
        </ul>
      </details>`;
}

function renderFeature(feature: FeatureEvents, openGroups: boolean): string {
  // The newest group is the interesting one, so it opens even on a collapsed page.
  const lastIndex = feature.groups.length - 1;
  return `<section class="event-feature" id="feature-${escapeHtml(feature.slug)}">
      <header>
        ${dot(feature.level)}
        <h3><a href="/features/${encodeURIComponent(feature.slug)}">${escapeHtml(feature.feature)}</a></h3>
        <span class="event-dur">${escapeHtml(formatEventClock(feature.lastAt))}</span>
      </header>
      <div class="event-groups">
        ${feature.groups
          .map((group, index) => renderGroup(feature.featureId, group, openGroups || index === lastIndex))
          .join("\n        ")}
      </div>
    </section>`;
}

/** Just the feature sections. The poll swaps this into the page; the shell stays put. */
export function renderEventFeatures(features: FeatureEvents[]): string {
  if (features.length === 0) {
    return `<p class="event-empty">No pipeline events yet. They appear here as features are planned, implemented, exported, and tested.</p>`;
  }
  return features.map((feature) => renderFeature(feature, false)).join("\n    ");
}

export function eventsPage(features: FeatureEvents[]): string {
  const body = renderEventFeatures(features);
  const etag = eventsFragmentEtag(body);
  return layout(
    "Egon pipeline events",
    `<header>
      <div class="kicker">Egon</div>
      <a class="back" href="/" aria-label="Back to feature log">${BACK_ARROW}</a>
      <h1>Pipeline events</h1>
      <p class="lede">What the pipeline did, newest feature first.</p>
      <p class="links">
        <a href="/">Feature log</a>
        ·
        <a href="/assets">Upload assets</a>
      </p>
    </header>
    <main>
      <div class="events-actions">
        <button type="button" class="log-jump" data-events-expand>Expand all</button>
        <button type="button" class="log-jump" data-events-collapse>Collapse all</button>
        <span class="live" data-live-status aria-live="polite"><span class="dot info"></span>Live</span>
      </div>
      <div id="event-list" data-etag="${escapeHtml(etag)}">${body}</div>
    </main>
    ${EVENTS_SCRIPT}`,
  );
}
