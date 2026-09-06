import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import type { AgentLogEntry, AgentLogStep, AgentRole } from "../cursor/agentLog.js";
import { hangingToolName, logEntryStuckKind } from "../cursor/agentWatch.js";
import { featurePaths } from "../cursor/testReport.js";
import { formatDuration, formatTokenCount } from "../format.js";
import { featureSlug } from "../features/slug.js";
import type { Feature, FeatureAttachment } from "../features/store.js";
import { decorateHexColors, escapeHtml, renderMarkdown } from "./markdown.js";

export type CatalogLifetimeStats = {
  tokens: number;
  implemented: number;
  durationMs: number;
};

const STYLES = `
:root {
  --ink: #dbdee1;
  --header: #f2f3f5;
  --paper: #313338;
  --panel: #2b2d31;
  --elevated: #1e1f22;
  --line: #3f4147;
  --accent: #5865f2;
  --accent-hover: #7983f5;
  --muted: #949ba4;
  --pass: #23a559;
  --danger: #ed4245;
}
* { box-sizing: border-box; }
html { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(1200px 500px at 10% -10%, #5865f220 0%, transparent 55%),
    var(--paper);
  color: var(--ink);
  font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
header, main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem; }
header { padding-bottom: 0; }
.feature header,
.feature main {
  display: grid;
  grid-template-columns: 3rem minmax(0, 920px);
  column-gap: 0.85rem;
  justify-content: center;
  max-width: none;
  width: 100%;
  margin: 0;
  padding: 2rem 1.25rem 0;
}
.feature header { padding-bottom: 0; }
.feature header > :not(.back),
.feature main > * {
  grid-column: 2;
}
.back {
  grid-column: 1;
  grid-row: 2;
  align-self: center;
  justify-self: end;
  display: flex;
  color: var(--header);
  text-decoration: none;
}
.back svg {
  width: 2.15rem;
  height: 2.15rem;
  display: block;
}
.back:hover { color: var(--accent-hover); }
.feature h1 { grid-row: 2; }
.kicker {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 { font-size: 2.4rem; font-weight: 600; margin: 0.35rem 0 0.5rem; color: var(--header); }
.lede { color: var(--muted); margin: 0 0 0.85rem; max-width: 40rem; }
.links {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
}
.links a { text-decoration: none; }
.links a:hover { text-decoration: underline; }
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin: 0 0 2rem;
  padding: 0;
  list-style: none;
}
.stats li {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.85rem 1rem;
}
.stats strong {
  display: block;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--header);
  letter-spacing: 0.02em;
}
.stats span {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
h2 {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.4rem;
}
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
.grid { display: grid; gap: 0.85rem; }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem 1.1rem;
}
.card:hover { background: #35373c; border-color: var(--accent); }
.card h3 { margin: 0 0 0.25rem; font-size: 1.25rem; color: var(--header); }
.card h3 a { color: inherit; text-decoration: none; }
.card h3 a:hover { color: var(--accent-hover); }
.meta {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty { color: var(--muted); font-style: italic; }
.spec h1, .spec h2, .spec h3 { color: var(--header); border: 0; letter-spacing: 0; text-transform: none; font-family: inherit; }
.spec h2 { font-size: 1.2rem; margin-top: 1.6rem; }
.spec ol, .notes { padding-left: 1.25rem; }
.spec code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.9em;
  background: var(--elevated);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.color-dot {
  display: inline-block;
  width: 0.72em;
  height: 0.72em;
  margin: 0 0.1em 0 0.28em;
  border-radius: 50%;
  vertical-align: -0.08em;
  border: 1px solid rgb(255 255 255 / 0.35);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45);
}
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}
.shots figure { margin: 0; background: var(--elevated); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.shots img { display: block; width: 100%; height: auto; cursor: zoom-in; }
.shots figcaption { padding: 0.4rem 0.6rem; font-size: 0.8rem; color: var(--muted); }
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #000000b8;
  cursor: zoom-out;
}
.lightbox.is-open { display: flex; }
.lightbox img {
  max-width: min(96vw, 1400px);
  max-height: 92vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 48px #00000080;
  cursor: default;
}
.card-actions { margin-top: 0.65rem; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.card-actions a, .card-actions button, .log-jump, .github-pr {
  display: inline-block;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.2rem 0.55rem;
  color: var(--accent);
  background: transparent;
  cursor: pointer;
}
.card-actions a:hover, .card-actions button:hover, .log-jump:hover, .github-pr:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.feature-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.15rem 0 0.85rem;
  justify-self: start;
}
.github-pr {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding-left: 0.45rem;
}
.github-pr svg {
  width: 0.95rem;
  height: 0.95rem;
  flex-shrink: 0;
}
.github-pr.closed {
  color: var(--muted);
}
.github-pr.closed:hover {
  border-color: var(--muted);
  color: var(--header);
}
[data-delete-slug] { color: var(--danger); }
[data-delete-slug]:hover { border-color: var(--danger); color: var(--danger); }
.log-run {
  border: 1px solid var(--line);
  background: var(--elevated);
  margin: 0 0 0.85rem;
  border-radius: 8px;
}
.log-run > summary {
  cursor: pointer;
  list-style: none;
  padding: 0.75rem 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.85rem;
  align-items: baseline;
}
.log-run > summary::-webkit-details-marker { display: none; }
.log-role {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}
.log-msg { padding: 0.85rem 1rem; border-top: 1px solid var(--line); }
.log-msg.user { background: #5865f214; }
.log-label {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 0.4rem;
}
.log-msg pre, .tool-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.82rem;
  margin: 0.35rem 0 0;
  max-height: 28rem;
  overflow: auto;
}
.log-msg.thinking, .log-msg.tool { padding: 0; }
.log-msg.thinking > summary, .log-msg.tool > summary {
  cursor: pointer;
  padding: 0.7rem 1rem;
  color: var(--muted);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.8rem;
}
.log-msg.thinking > summary { font-style: italic; }
.log-msg.thinking .thinking-body, .log-msg.tool .tool-body { padding: 0 1rem 0.85rem; margin: 0; }
.log-msg.thinking .thinking-body {
  color: var(--muted);
  font-style: italic;
  max-height: 28rem;
  overflow: auto;
  margin: 0 1rem 0.75rem 1.85rem;
  padding: 0 0 0.35rem 1.15rem;
  border-left: 2px solid var(--line);
}
.log-msg.thinking .thinking-body > :first-child { margin-top: 0; }
.log-msg.thinking .thinking-body > :last-child { margin-bottom: 0; }
.log-status-error { color: var(--danger); }
.log-status-running { color: var(--accent); }
.log-status-stuck { color: var(--danger); }
`;

const DELETE_SCRIPT = `<script>
(() => {
  for (const button of document.querySelectorAll("[data-delete-slug]")) {
    button.addEventListener("click", async () => {
      const slug = button.getAttribute("data-delete-slug");
      if (!slug) {
        return;
      }
      const password = window.prompt("Password");
      if (password === null) {
        return;
      }
      try {
        const response = await fetch("/features/" + encodeURIComponent(slug) + "/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (response.ok) {
          window.location.assign("/");
          return;
        }
        window.alert((await response.text()) || "Could not delete this feature.");
      } catch {
        window.alert("Could not delete this feature.");
      }
    });
  }
})();
</script>`;

const LIGHTBOX_SCRIPT = `<script>
(() => {
  const shots = document.querySelectorAll(".shots img");
  if (shots.length === 0) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const img = document.createElement("img");
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  const close = () => {
    overlay.classList.remove("is-open");
    img.removeAttribute("src");
    img.removeAttribute("alt");
  };
  overlay.addEventListener("click", (event) => {
    if (event.target !== img) {
      close();
    }
  });
  for (const shot of shots) {
    shot.addEventListener("click", () => {
      img.src = shot.currentSrc || shot.src;
      img.alt = shot.alt;
      overlay.classList.add("is-open");
    });
  }
})();
</script>`;

const AGENT_LOG_SCRIPT = `<script>
(() => {
  const runs = document.querySelectorAll("details.log-run[data-run-id]");
  if (runs.length === 0) {
    return;
  }
  const key = "egon-agent-log:" + window.location.pathname;
  let saved = {};
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        saved = parsed;
      }
    }
  } catch {
    saved = {};
  }
  for (const el of runs) {
    const id = el.getAttribute("data-run-id");
    if (id && Object.prototype.hasOwnProperty.call(saved, id)) {
      el.open = Boolean(saved[id]);
    }
  }
  const persist = () => {
    const next = {};
    for (const el of runs) {
      const id = el.getAttribute("data-run-id");
      if (id) {
        next[id] = el.open;
      }
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore quota / private mode */
    }
  };
  for (const el of runs) {
    el.addEventListener("toggle", persist);
  }
})();
</script>`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" href="/favicon.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
${body}
${DELETE_SCRIPT}
${LIGHTBOX_SCRIPT}
${AGENT_LOG_SCRIPT}
</body>
</html>`;
}

function deleteButton(slug: string): string {
  return `<button type="button" class="log-jump" data-delete-slug="${escapeHtml(slug)}">Delete</button>`;
}

const BACK_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
const GITHUB_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

function githubPrCaption(feature: Feature, untitled: string): string {
  const base =
    feature.githubPrNumber !== null ? `PR #${String(feature.githubPrNumber)}` : untitled;
  return feature.state === "rejected" ? `${base} (closed)` : base;
}

function githubPrButton(feature: Feature): string {
  if (!feature.githubPrUrl) {
    return "";
  }
  const closed = feature.state === "rejected";
  const cls = closed ? "github-pr closed" : "github-pr";
  return `<a class="${cls}" href="${escapeHtml(feature.githubPrUrl)}" target="_blank" rel="noopener noreferrer">${GITHUB_MARK}${escapeHtml(githubPrCaption(feature, "GitHub pull request"))}</a>`;
}

const ROLE_LABEL: Record<AgentRole, string> = {
  planner: "Planner",
  implementer: "Implementer",
  tester: "Tester",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n… truncated …`;
}

function prettyJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) {
      return String(value);
    }
    return truncate(text, 20_000);
  } catch {
    return truncate(String(value), 20_000);
  }
}

function toolHint(step: Extract<AgentLogStep, { type: "tool" }>): string {
  const args = asRecord(step.args);
  if (!args) {
    return "";
  }
  if (typeof args.command === "string") {
    return args.command.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  const path = args.path ?? args.filePath ?? args.targetFile ?? args.filename;
  if (typeof path === "string") {
    return path;
  }
  return "";
}

function toolBody(step: Extract<AgentLogStep, { type: "tool" }>): string {
  const args = asRecord(step.args);
  const result = asRecord(step.result);
  const command = typeof args?.command === "string" ? args.command : "";
  const success = asRecord(result?.value) ?? result;
  const stdout = typeof success?.stdout === "string" ? success.stdout : "";
  const stderr = typeof success?.stderr === "string" ? success.stderr : "";
  if (command !== "" || stdout !== "" || stderr !== "") {
    const chunks = [command !== "" ? `$ ${command}` : ""];
    if (stdout !== "") {
      chunks.push(stdout);
    }
    if (stderr !== "") {
      chunks.push(stderr);
    }
    return truncate(chunks.filter((chunk) => chunk !== "").join("\n\n"), 20_000);
  }
  const parts: string[] = [];
  if (step.args !== undefined) {
    parts.push(prettyJson(step.args));
  }
  if (step.result !== undefined) {
    parts.push(prettyJson(step.result));
  }
  return parts.join("\n\n");
}

function formatLogTime(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match || !match[1] || !match[2]) {
    return iso;
  }
  return `${match[1]} ${match[2]} UTC`;
}

function runningStatusLabel(entry: AgentLogEntry, now: number): { text: string; stuck: boolean } {
  const last = Date.parse(entry.updatedAt ?? entry.at);
  const ago = Number.isFinite(last) ? formatDuration(Math.max(0, now - last)) : undefined;
  const kind = logEntryStuckKind(entry, now);
  const hanging = hangingToolName(entry.steps);
  if (kind) {
    const onTool = hanging ? ` on ${hanging}` : "";
    const waited = ago ? `no activity for ${ago}` : "no activity";
    return { text: `running · ${waited} · possibly stuck${onTool}`, stuck: true };
  }
  const activity = ago ? `last activity ${ago} ago` : "in progress";
  const tool = hanging ? ` · ${hanging}` : "";
  return { text: `running · ${activity}${tool}`, stuck: false };
}

function renderLogStep(step: AgentLogStep): string {
  if (step.type === "thinking") {
    return `<details class="log-msg thinking">
      <summary>Thinking</summary>
      <div class="thinking-body spec">${renderMarkdown(truncate(step.text, 20_000))}</div>
    </details>`;
  }
  if (step.type === "tool") {
    const hint = toolHint(step);
    const title = hint === "" ? step.name : `${step.name} · ${hint}`;
    const body = toolBody(step);
    return `<details class="log-msg tool">
      <summary>${escapeHtml(title)}</summary>
      ${body === "" ? "" : `<pre class="tool-body">${escapeHtml(body)}</pre>`}
    </details>`;
  }
  return `<div class="log-msg assistant">
    <div class="log-label">Agent</div>
    <div class="spec">${renderMarkdown(step.text)}</div>
  </div>`;
}

export function renderAgentLog(entries: AgentLogEntry[], now: number = Date.now()): string {
  if (entries.length === 0) {
    return `<p class="empty">No agent log yet. Prompts and replies show up while a run is in progress — refresh to pick up new output.</p>`;
  }
  return entries
    .map((entry, index) => {
      const running = entry.status === "running" ? runningStatusLabel(entry, now) : undefined;
      const statusClass =
        entry.status === "error" || entry.status === "cancelled"
          ? " log-status-error"
          : running?.stuck
            ? " log-status-stuck"
            : entry.status === "running"
              ? " log-status-running"
              : "";
      const statusText = running?.text ?? `${entry.status} · ${formatLogTime(entry.at)}`;
      const steps =
        entry.steps.length > 0
          ? entry.steps.map(renderLogStep).join("")
          : entry.result
            ? renderLogStep({ type: "assistant", text: entry.result })
            : "";
      const error =
        entry.errorMessage && entry.status !== "finished"
          ? `<div class="log-msg assistant"><div class="log-label">Error</div><pre>${escapeHtml(entry.errorMessage)}</pre></div>`
          : "";
      const open = index === entries.length - 1 ? " open" : "";
      return `<details class="log-run" data-run-id="${escapeHtml(entry.runId)}"${open}>
        <summary>
          <span class="log-role">${escapeHtml(ROLE_LABEL[entry.role] ?? entry.role)}</span>
          <span class="meta${statusClass}">${escapeHtml(statusText)}</span>
        </summary>
        <div class="log-msg user">
          <div class="log-label">Prompt</div>
          <pre>${escapeHtml(entry.user || "(empty prompt)")}</pre>
        </div>
        ${steps}
        ${error}
      </details>`;
    })
    .join("");
}

export type CatalogLinks = {
  gamePublicUrl: string;
  gameRepoUrl: string;
};

export function indexPage(
  planned: Feature[],
  implemented: Feature[],
  stats: CatalogLifetimeStats,
  links: CatalogLinks,
  collecting: Feature[] = [],
): string {
  const card = (feature: Feature): string => {
    const slug = featureSlug(feature.name);
    const pr = feature.githubPrUrl
      ? ` · <a href="${escapeHtml(feature.githubPrUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(githubPrCaption(feature, "PR"))}</a>`
      : "";
    const actions = `<div class="card-actions">${deleteButton(slug)}</div>`;
    return `<article class="card">
      <h3><a href="/features/${encodeURIComponent(slug)}">${escapeHtml(feature.name)}</a></h3>
      <div class="meta">${escapeHtml(feature.state)}${pr}</div>
      ${actions}
    </article>`;
  };
  const section = (title: string, features: Feature[]): string => {
    const items =
      features.length === 0
        ? `<p class="empty">None yet.</p>`
        : `<div class="grid">${features.map(card).join("")}</div>`;
    return `<section><h2>${escapeHtml(title)}</h2>${items}</section>`;
  };
  const implementedLabel = stats.implemented === 1 ? "feature implemented" : "features implemented";
  return layout(
    "Egon feature log",
    `<header>
      <div class="kicker">Egon</div>
      <h1>Feature log</h1>
      <p class="lede">Ideas still being collected, specs the planner wrote, and proof screenshots the tester took. Implementation lands through GitHub pull requests. Host sprites, audio, and other files on the sharing service, then paste the URL in a Discord note so the implementer can pull them in.</p>
      <p class="links">
        <a href="${escapeHtml(links.gamePublicUrl)}" target="_blank" rel="noopener noreferrer">Play the game</a>
        ·
        <a href="${escapeHtml(links.gameRepoUrl)}" target="_blank" rel="noopener noreferrer">Game repo</a>
        ·
        <a href="https://discord.mbuelow.dev" target="_blank" rel="noopener noreferrer">Upload assets</a>
      </p>
      <ul class="stats">
        <li><strong>${escapeHtml(formatTokenCount(stats.tokens))}</strong><span>lifetime tokens used</span></li>
        <li><strong>${escapeHtml(String(stats.implemented))}</strong><span>${implementedLabel}</span></li>
        <li><strong>${escapeHtml(formatDuration(stats.durationMs))}</strong><span>lifetime agent time</span></li>
      </ul>
    </header>
    <main>
      ${section("Collecting", collecting)}
      ${section("Planned", planned)}
      ${section("Implemented", implemented)}
    </main>`,
  );
}

export function featurePage(
  config: Config,
  feature: Feature,
  notes: string[] = [],
  agentLog: AgentLogEntry[] = [],
  attachments: FeatureAttachment[] = [],
): string {
  const slug = featureSlug(feature.name);
  const paths = featurePaths(config.dataDir, feature.id);
  const spec = existsSync(paths.specPath) ? readFileSync(paths.specPath, "utf8") : "_No spec on file yet._";
  const shots = existsSync(paths.screenshotsDir)
    ? readdirSync(paths.screenshotsDir).filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    : [];
  const gallery =
    shots.length === 0
      ? `<p class="empty">No proof screenshots yet.</p>`
      : `<div class="shots">${shots
          .map(
            (name) => `<figure>
              <img src="/features/${encodeURIComponent(slug)}/screenshots/${encodeURIComponent(name)}" alt="${escapeHtml(name)}">
              <figcaption>${escapeHtml(name)}</figcaption>
            </figure>`,
          )
          .join("")}</div>`;
  const refs = attachments.filter((item) => existsSync(join(paths.attachmentsDir, item.storedName)));
  const refsGallery =
    refs.length === 0
      ? ""
      : `<section>
        <h2>Reference images</h2>
        <div class="shots">${refs
          .map(
            (item) => `<figure>
              <img src="/features/${encodeURIComponent(slug)}/attachments/${encodeURIComponent(item.storedName)}" alt="${escapeHtml(item.filename)}">
              <figcaption>${escapeHtml(item.filename)}</figcaption>
            </figure>`,
          )
          .join("")}</div>
      </section>`;
  const pr = githubPrButton(feature);
  const notesSection =
    notes.length === 0
      ? ""
      : `<section>
        <h2>Notes</h2>
        <ul class="notes">${notes.map((note) => `<li>${decorateHexColors(escapeHtml(note))}</li>`).join("")}</ul>
      </section>`;
  return layout(
    feature.name,
    `<div class="feature">
    <header>
      <div class="kicker">${escapeHtml(feature.state)}</div>
      <a class="back" href="/" aria-label="Back to feature log">${BACK_ARROW}</a>
      <h1>${escapeHtml(feature.name)}</h1>
      <div class="feature-actions">${pr}${deleteButton(slug)}</div>
    </header>
    <main>
      ${notesSection}
      ${refsGallery}
      <section>
        <h2>Spec</h2>
        <div class="spec">${renderMarkdown(spec)}</div>
      </section>
      <section>
        <h2>Proof</h2>
        ${gallery}
      </section>
      <section id="agent-log">
        <h2>Agent log</h2>
        ${renderAgentLog(agentLog)}
      </section>
    </main>
    </div>`,
  );
}
