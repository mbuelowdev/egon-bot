import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "../features/slug.js";
import type { Feature } from "../features/store.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";

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
.lede { color: var(--muted); margin: 0 0 2rem; max-width: 40rem; }
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
  display: block;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 2px;
  padding: 1rem 1.1rem;
  text-decoration: none;
  color: inherit;
}
.card:hover { border-color: var(--amber); }
.card h3 { margin: 0 0 0.25rem; font-size: 1.25rem; }
.meta {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty { color: var(--muted); font-style: italic; }
.spec h1, .spec h2, .spec h3 { color: var(--ink); border: 0; letter-spacing: 0; text-transform: none; font-family: inherit; }
.spec h2 { font-size: 1.2rem; margin-top: 1.6rem; }
.spec ol { padding-left: 1.25rem; }
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
`;

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
</body>
</html>`;
}

export function indexPage(planned: Feature[], implemented: Feature[]): string {
  const card = (feature: Feature): string => {
    const slug = featureSlug(feature.name);
    return `<a class="card" href="/features/${encodeURIComponent(slug)}">
      <h3>${escapeHtml(feature.name)}</h3>
      <div class="meta">${escapeHtml(feature.state)}${feature.githubPrUrl ? " · PR" : ""}</div>
    </a>`;
  };
  const section = (title: string, features: Feature[]): string => {
    const items =
      features.length === 0
        ? `<p class="empty">None yet.</p>`
        : `<div class="grid">${features.map(card).join("")}</div>`;
    return `<section><h2>${escapeHtml(title)}</h2>${items}</section>`;
  };
  return layout(
    "Egon feature log",
    `<header>
      <div class="kicker">Egon</div>
      <h1>Feature log</h1>
      <p class="lede">Specs the planner wrote, and proof screenshots the tester took. Implementation lands through GitHub pull requests.</p>
    </header>
    <main>
      ${section("Planned", planned)}
      ${section("Implemented", implemented)}
    </main>`,
  );
}

export function featurePage(config: Config, feature: Feature): string {
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
    ? `<p class="meta"><a href="${escapeHtml(feature.githubPrUrl)}">GitHub pull request</a></p>`
    : "";
  return layout(
    feature.name,
    `<header>
      <a class="back" href="/">← Feature log</a>
      <div class="kicker">${escapeHtml(feature.state)}</div>
      <h1>${escapeHtml(feature.name)}</h1>
      ${pr}
    </header>
    <main>
      <section>
        <h2>Spec</h2>
        <div class="spec">${renderMarkdown(spec)}</div>
      </section>
      <section>
        <h2>Proof</h2>
        ${gallery}
      </section>
    </main>`,
  );
}
