import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { AgentLogEntry, AgentLogStep, AgentRole } from "../cursor/agentLog.js";
import { hangingToolName, logEntryStuckKind } from "../cursor/agentWatch.js";
import { featurePaths } from "../cursor/testReport.js";
import { formatDuration, formatTokenCount } from "../format.js";
import { featureSlug } from "../features/slug.js";
import type { Feature } from "../features/store.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";

export type CatalogLifetimeStats = {
  tokens: number;
  implemented: number;
  durationMs: number;
};

const STYLES = `
:root {
  --ink: #f4efe4;
  --paper: #161410;
  --panel: #211c16;
  --line: #3a3228;
  --amber: #e2a136;
  --muted: #a89880;
  --pass: #8fbf7a;
}
* { box-sizing: border-box; }
html { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(1200px 500px at 10% -10%, #2a2118 0%, transparent 55%),
    var(--paper);
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif;
  line-height: 1.5;
}
header, main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem; }
header { padding-bottom: 0; }
.kicker {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--amber);
}
h1 { font-size: 2.4rem; font-weight: 600; margin: 0.35rem 0 0.5rem; }
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
  padding: 0.85rem 1rem;
}
.stats strong {
  display: block;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--amber);
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
  color: var(--amber);
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.4rem;
}
a { color: var(--amber); }
.grid { display: grid; gap: 0.85rem; }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 2px;
  padding: 1rem 1.1rem;
}
.card:hover { border-color: var(--amber); }
.card h3 { margin: 0 0 0.25rem; font-size: 1.25rem; }
.card h3 a { color: inherit; text-decoration: none; }
.card h3 a:hover { color: var(--amber); }
.meta {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty { color: var(--muted); font-style: italic; }
.spec h1, .spec h2, .spec h3 { color: var(--ink); border: 0; letter-spacing: 0; text-transform: none; font-family: inherit; }
.spec h2 { font-size: 1.2rem; margin-top: 1.6rem; }
.spec ol, .notes { padding-left: 1.25rem; }
.spec code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.9em;
  background: #00000040;
  padding: 0.1em 0.35em;
}
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}
.shots figure { margin: 0; background: #000; border: 1px solid var(--line); }
.shots img { display: block; width: 100%; height: auto; }
.shots figcaption { padding: 0.4rem 0.6rem; font-size: 0.8rem; color: var(--muted); }
.back { display: inline-block; margin-bottom: 1.25rem; }
.card-actions { margin-top: 0.65rem; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.card-actions a, .card-actions button, .log-jump {
  display: inline-block;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  border: 1px solid var(--line);
  padding: 0.2rem 0.55rem;
  color: var(--amber);
  background: transparent;
  cursor: pointer;
}
.card-actions a:hover, .card-actions button:hover, .log-jump:hover { border-color: var(--amber); }
[data-delete-slug] { color: #e07a6a; }
.log-run {
  border: 1px solid var(--line);
  background: #00000028;
  margin: 0 0 0.85rem;
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
  color: var(--amber);
}
.log-msg { padding: 0.85rem 1rem; border-top: 1px solid var(--line); }
.log-msg.user { background: #e2a13614; }
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
.log-msg.tool .tool-body { padding: 0 1rem 0.85rem; margin: 0; }
.log-status-error { color: #e07a6a; }
.log-status-running { color: var(--amber); }
.log-status-stuck { color: #e07a6a; }
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

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
${body}
${DELETE_SCRIPT}
</body>
</html>`;
}

function deleteButton(slug: string): string {
  return `<button type="button" class="log-jump" data-delete-slug="${escapeHtml(slug)}">Delete</button>`;
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
      <pre class="tool-body">${escapeHtml(truncate(step.text, 20_000))}</pre>
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
    .map((entry) => {
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
      return `<details class="log-run" open>
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
    const pr =
      feature.githubPrUrl && feature.githubPrNumber !== null
        ? ` · <a href="${escapeHtml(feature.githubPrUrl)}" target="_blank" rel="noopener noreferrer">PR #${String(feature.githubPrNumber)}</a>`
        : feature.githubPrUrl
          ? ` · <a href="${escapeHtml(feature.githubPrUrl)}" target="_blank" rel="noopener noreferrer">PR</a>`
          : "";
    const del = feature.state === "collecting" ? deleteButton(slug) : "";
    return `<article class="card">
      <h3><a href="/features/${encodeURIComponent(slug)}">${escapeHtml(feature.name)}</a></h3>
      <div class="meta">${escapeHtml(feature.state)}${pr}</div>
      <div class="card-actions"><a href="/features/${encodeURIComponent(slug)}#agent-log">Agent log</a>${del}</div>
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
      <p class="lede">Ideas still being collected, specs the planner wrote, and proof screenshots the tester took. Implementation lands through GitHub pull requests.</p>
      <p class="links">
        <a href="${escapeHtml(links.gamePublicUrl)}" target="_blank" rel="noopener noreferrer">Play the game</a>
        ·
        <a href="${escapeHtml(links.gameRepoUrl)}" target="_blank" rel="noopener noreferrer">Game repo</a>
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
  const pr = feature.githubPrUrl
    ? `<p class="meta"><a href="${escapeHtml(feature.githubPrUrl)}" target="_blank" rel="noopener noreferrer">${feature.githubPrNumber !== null ? `PR #${String(feature.githubPrNumber)}` : "GitHub pull request"}</a></p>`
    : "";
  const notesSection =
    notes.length === 0
      ? ""
      : `<section>
        <h2>Notes</h2>
        <ul class="notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      </section>`;
  return layout(
    feature.name,
    `<header>
      <a class="back" href="/">← Feature log</a>
      <div class="kicker">${escapeHtml(feature.state)}</div>
      <h1>${escapeHtml(feature.name)}</h1>
      ${pr}
      <p class="links"><a class="log-jump" href="#agent-log">Agent log</a>${feature.state === "collecting" ? ` ${deleteButton(slug)}` : ""}</p>
    </header>
    <main>
      ${notesSection}
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
    </main>`,
  );
}
