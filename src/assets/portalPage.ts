import { escapeHtml } from "../catalog/markdown.js";
import { BACK_ARROW } from "../catalog/page.js";
import { ACCEPTED_EXTENSIONS, acceptedListText } from "./allowlist.js";
import { measuredSummary } from "./manifest.js";
import { promotedAssetPath, type AssetMeta } from "./store.js";

/**
 * The human half of the asset library. Humans upload and *describe* assets here; the bot
 * measures format and proportions programmatically. There is no agent and no vision call
 * anywhere in this path — a human writes the description because a human knows the intent
 * ("boss vehicle for level 3", "must tile with `grass-plain`"), which is what drives
 * placement decisions, and a vision model would only produce an appearance caption.
 *
 * Its own module by design: `src/catalog/page.ts` is already the size it should be, and
 * this UI is larger than anything in it.
 */

export type PortalAsset = AssetMeta & { measuredText: string; promotedPath: string };

export function portalAsset(meta: AssetMeta): PortalAsset {
  return { ...meta, measuredText: measuredSummary(meta), promotedPath: promotedAssetPath(meta) };
}

const MODEL_VIEWER_SRC = "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js";

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
header, main { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem; }
header { padding-bottom: 0; }
.kicker {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 { font-size: 2.4rem; font-weight: 600; margin: 0.35rem 0 0.5rem; color: var(--header); }
h2 { color: var(--header); font-size: 1.15rem; margin: 0; }
.lede { color: var(--muted); margin: 0 0 0.85rem; max-width: 40rem; }
.links {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
}
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
.links a { text-decoration: none; }
.links a:hover { text-decoration: underline; }
.back {
  display: none;
  color: var(--header);
  text-decoration: none;
}
.back svg {
  width: 2.15rem;
  height: 2.15rem;
  display: block;
}
.back:hover { color: var(--accent-hover); }
@media (min-width: 768px) {
  .back {
    display: flex;
    grid-column: 1;
    grid-row: 2;
    align-self: center;
    justify-self: end;
  }
  body:has(> header .back) > header,
  body:has(> header .back) > main {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1080px);
    column-gap: 0.85rem;
    justify-content: center;
    max-width: none;
    width: 100%;
    margin: 0;
    padding: 2rem 1.25rem 0;
  }
  body:has(> header .back) > header { padding-bottom: 0; }
  body:has(> header .back) > header > :not(.back),
  body:has(> header .back) > main > * {
    grid-column: 2;
  }
  body:has(> header .back) > header h1 { grid-row: 2; }
}
button {
  font: inherit; color: var(--header); background: var(--elevated);
  border: 1px solid var(--line); border-radius: 6px; padding: 0.4rem 0.8rem; cursor: pointer;
}
button:hover { border-color: var(--accent-hover); }
button.primary { background: var(--accent); border-color: var(--accent); }
button.primary:hover { background: var(--accent-hover); }
button.danger { color: var(--danger); }
button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
button:disabled { opacity: 0.45; cursor: not-allowed; }
button:disabled:hover { border-color: var(--line); }
input, textarea {
  font: inherit; width: 100%; color: var(--ink); background: var(--elevated);
  border: 1px solid var(--line); border-radius: 6px; padding: 0.45rem 0.6rem;
}
input:focus, textarea:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
textarea { resize: vertical; min-height: 5.5rem; }
label { display: block; margin: 0.9rem 0 0.25rem; color: var(--header); font-weight: 600; font-size: 0.9rem; }
.hint { color: var(--muted); font-size: 0.83rem; margin: 0.2rem 0 0; }

.dropzone {
  border: 2px dashed var(--line); border-radius: 12px; background: var(--panel);
  padding: 2.6rem 1.25rem; text-align: center; cursor: pointer; transition: border-color 0.12s ease, background 0.12s ease;
}
.dropzone:hover, .dropzone.is-over { border-color: var(--accent-hover); background: #34363c; }
.dropzone strong { display: block; color: var(--header); font-size: 1.1rem; }
.dropzone span { color: var(--muted); font-size: 0.88rem; }
.dropzone .formats { display: block; margin-top: 0.5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }

.bar { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; margin: 1.5rem 0 0.8rem; }
.bar .spacer { flex: 1; }
.badge {
  border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.82rem;
  border: 1px solid var(--line); color: var(--muted);
}
.badge.warn { color: var(--danger); border-color: var(--danger); }
.badge[hidden] { display: none; }

.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 0.85rem; }
.tile {
  border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
  overflow: hidden; cursor: pointer; text-align: left; padding: 0; color: inherit;
  display: flex; flex-direction: column;
}
.tile:hover { border-color: var(--accent-hover); }
.tile.undescribed { border-color: var(--danger); }
.tile .thumb {
  aspect-ratio: 1 / 1; width: 100%; background: var(--elevated);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.tile .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile .glyph { font-size: 2.2rem; color: var(--muted); }
.tile .name {
  padding: 0.45rem 0.55rem; font-size: 0.8rem; color: var(--header);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
}
.tile .sub { padding: 0 0.55rem 0.5rem; font-size: 0.75rem; color: var(--muted); }
.tile.undescribed .sub { color: var(--danger); }

.rows { display: none; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
body.view-list .gallery { display: none; }
body.view-list .rows { display: block; }
.row {
  display: grid; grid-template-columns: 3rem minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0.8rem; align-items: center; width: 100%; text-align: left;
  padding: 0.55rem 0.7rem; background: var(--panel); border: 0; border-bottom: 1px solid var(--line);
  color: inherit; cursor: pointer;
}
.row:last-child { border-bottom: 0; }
.row:hover { background: #34363c; }
.row.undescribed .row-id { color: var(--danger); }
.row .row-thumb { width: 2.6rem; height: 2.6rem; border-radius: 6px; overflow: hidden; background: var(--elevated); display: flex; align-items: center; justify-content: center; }
.row .row-thumb img { width: 100%; height: 100%; object-fit: cover; }
.row-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; color: var(--header); word-break: break-all; }
.row-measured, .row-desc { color: var(--muted); font-size: 0.85rem; min-width: 0; }
.empty { color: var(--muted); }

dialog {
  width: min(720px, 94vw); border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); color: var(--ink); padding: 0;
}
dialog::backdrop { background: #000000aa; }
.dialog-head { display: flex; align-items: baseline; gap: 0.6rem; padding: 1rem 1.1rem 0; }
.dialog-head h2 { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1rem; word-break: break-all; }
.dialog-head .queue { margin-left: auto; color: var(--muted); font-size: 0.85rem; }
.dialog-body { padding: 0.6rem 1.1rem 1.1rem; }
.preview {
  margin: 0.8rem 0 0; border: 1px solid var(--line); border-radius: 10px; background: var(--elevated);
  min-height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.preview img { max-width: 100%; max-height: 340px; object-fit: contain; display: block; }
.preview model-viewer { width: 100%; height: 340px; --poster-color: transparent; }
.preview audio { width: 90%; }
.preview .specimen { padding: 1rem; color: var(--header); }
.preview .specimen .big { font-size: 2rem; line-height: 1.3; }
.preview .none { color: var(--muted); font-size: 0.88rem; padding: 1rem; text-align: center; }
.facts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.7rem 0 0; padding: 0; list-style: none; }
.facts li {
  border: 1px solid var(--line); border-radius: 6px; padding: 0.15rem 0.5rem;
  font-size: 0.8rem; color: var(--muted); background: var(--elevated);
}
.facts li b { color: var(--header); font-weight: 600; }
.preview.is-over { border-color: var(--accent-hover); background: #34363c; }
.filename-row { display: flex; align-items: center; gap: 0.4rem; }
.filename-row input { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.filename-row .ext {
  color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; flex: none;
}
.parts { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.parts li {
  display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;
  border: 1px solid var(--line); border-radius: 6px; padding: 0.3rem 0.5rem; background: var(--elevated);
}
.parts a { color: var(--accent-hover); text-decoration: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.parts a:hover { text-decoration: underline; }
.parts .size { color: var(--muted); margin-left: auto; flex: none; }
.parts .detach { padding: 0.1rem 0.45rem; font-size: 0.8rem; flex: none; }
.parts .none { color: var(--muted); border: 0; background: none; padding: 0.2rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--header); word-break: break-all; }
.grid-fields { display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; }
.grid-fields > div { flex: 1; min-width: 6rem; }
.grid-fields > button { flex: none; white-space: nowrap; }
.cell-groups { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.cell-groups li {
  font-size: 0.85rem; color: var(--muted);
  border: 1px solid var(--line); border-radius: 6px; padding: 0.3rem 0.5rem; background: var(--elevated);
  display: flex; align-items: center; gap: 0.5rem; text-align: left; width: 100%;
}
.cell-groups button.group {
  display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; text-align: left;
  padding: 0.15rem 0.4rem; background: transparent; color: inherit; border-color: transparent;
}
.cell-groups button.group.active { border-color: var(--accent-hover); color: var(--header); }
.cell-groups .count { margin-left: auto; flex: none; color: var(--muted); }
.cell-groups .none { border: 0; background: none; padding: 0.2rem 0; color: var(--muted); }
.cell-groups[hidden] { display: none; }
#sheet-picker { width: min(960px, 96vw); }
.sheet-wrap {
  display: flex; justify-content: center; align-items: center;
  margin: 0.8rem 0 0; border: 1px solid var(--line); border-radius: 10px;
  background: var(--elevated); padding: 1rem; min-height: 200px;
}
.sheet-stage { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.sheet-stage img {
  max-width: 100%; max-height: min(70vh, 640px); height: auto; width: auto;
  display: block; image-rendering: pixelated;
}
.sheet-grid { position: absolute; inset: 0; display: grid; }
.sheet-cell {
  padding: 0; margin: 0; min-width: 0; min-height: 0; border-radius: 0;
  border: 1px solid #5ec8ff; background: transparent;
}
.sheet-cell:hover { border-color: #8ed8ff; background: rgba(94, 200, 255, 0.16); }
.sheet-cell.selected { background: rgba(94, 200, 255, 0.4); }
.sheet-toolbar { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.6rem; flex-wrap: wrap; }
.dialog-actions { display: flex; gap: 0.6rem; align-items: center; margin-top: 1.2rem; }
.dialog-actions .spacer { flex: 1; }
.error { color: var(--danger); font-size: 0.86rem; margin: 0.6rem 0 0; min-height: 1.2rem; }
.status { color: var(--muted); font-size: 0.86rem; margin: 0.7rem 0 0; min-height: 1.2rem; }
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("asset-data").textContent);
const ACCEPTED = JSON.parse(document.getElementById("accepted-data").textContent);
const KIND_GLYPH = { image: "\\u{1F5BC}", model: "\\u{1F9CA}", audio: "\\u{1F50A}", font: "\\u{1F524}" };
const state = { assets: DATA, queue: [], current: null, cellGroupsDraft: [] };
const REPLACE_HINT = "Drop a file here to replace these bytes. The filename, description, tags, grid, and labeled sprites all stay.";

const $ = (id) => document.getElementById(id);
const gallery = $("gallery");
const rows = $("rows");
const dialog = $("detail");

function password(force) {
  let saved = force ? null : window.sessionStorage.getItem("egon-asset-password");
  if (!saved) {
    saved = window.prompt("Password");
    if (saved === null) { return null; }
    window.sessionStorage.setItem("egon-asset-password", saved);
  }
  return saved;
}

// Replacing an asset keeps its id, so every preview URL carries a content stamp: without
// one the browser shows the bytes it cached before the replace.
function stamp(asset) { return encodeURIComponent((asset.sha256 || "").slice(0, 12) + asset.uploadedAt); }
function fileUrl(asset) { return "/assets/file/" + encodeURIComponent(asset.id) + "?v=" + stamp(asset); }
function thumbUrl(asset) { return "/assets/thumb/" + encodeURIComponent(asset.id) + "?v=" + stamp(asset); }
function partUrl(asset, filename) {
  return "/assets/part/" + encodeURIComponent(asset.id) + "/" + encodeURIComponent(filename);
}
function stemOf(id) {
  const dot = id.lastIndexOf(".");
  return dot > 0 ? id.slice(0, dot) : id;
}
function formatBytes(n) {
  if (n < 1024) { return n + " B"; }
  if (n < 1024 * 1024) { return Math.round(n / 1024) + " KB"; }
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
function isDescribed(asset) { return (asset.description || "").trim() !== ""; }
function isViewable(asset) { return asset.kind === "model" && /\\.(glb|gltf)$/i.test(asset.id); }

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}
function acceptedLocally(name) {
  const ext = extOf(name);
  return Object.keys(ACCEPTED).some((kind) => ACCEPTED[kind].indexOf(ext) >= 0);
}
function suggestDescription(name) {
  const ext = extOf(name);
  const stem = ext === "" ? name : name.slice(0, -ext.length);
  return stem.replace(/[_-]+/g, " ").replace(/\\s+/g, " ").trim();
}

function sortAssets() {
  state.assets.sort((a, b) => a.id.localeCompare(b.id));
}

function thumbNode(asset) {
  if (asset.kind === "image") {
    const img = document.createElement("img");
    img.src = fileUrl(asset);
    img.alt = asset.id;
    img.loading = "lazy";
    return img;
  }
  if (isViewable(asset)) {
    const img = document.createElement("img");
    img.src = thumbUrl(asset);
    img.alt = asset.id;
    img.loading = "lazy";
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "glyph";
      span.textContent = KIND_GLYPH[asset.kind] || "?";
      img.replaceWith(span);
    });
    return img;
  }
  const span = document.createElement("span");
  span.className = "glyph";
  span.textContent = KIND_GLYPH[asset.kind] || "?";
  return span;
}

function render() {
  sortAssets();
  gallery.replaceChildren();
  rows.replaceChildren();
  const undescribed = state.assets.filter((asset) => !isDescribed(asset)).length;
  $("count").textContent = state.assets.length === 1 ? "1 asset" : state.assets.length + " assets";
  const badge = $("undescribed");
  badge.hidden = undescribed === 0;
  badge.textContent = undescribed + " undescribed";
  if (state.assets.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing uploaded yet. Drop files above to start the library.";
    gallery.appendChild(p);
    return;
  }
  for (const asset of state.assets) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile" + (isDescribed(asset) ? "" : " undescribed");
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.appendChild(thumbNode(asset));
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = asset.id;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = isDescribed(asset) ? asset.description : "No description — agents cannot see this";
    tile.append(thumb, name, sub);
    tile.addEventListener("click", () => openDetail(asset));
    gallery.appendChild(tile);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "row" + (isDescribed(asset) ? "" : " undescribed");
    const rowThumb = document.createElement("div");
    rowThumb.className = "row-thumb";
    rowThumb.appendChild(thumbNode(asset));
    const rowId = document.createElement("div");
    rowId.className = "row-id";
    rowId.textContent = asset.id;
    const rowMeasured = document.createElement("div");
    rowMeasured.className = "row-measured";
    rowMeasured.textContent = asset.measuredText || asset.format;
    const rowDesc = document.createElement("div");
    rowDesc.className = "row-desc";
    rowDesc.textContent = isDescribed(asset) ? asset.description : "No description";
    row.append(rowThumb, rowId, rowMeasured, rowDesc);
    row.addEventListener("click", () => openDetail(asset));
    rows.appendChild(row);
  }
}

function factList(asset) {
  const out = [["Format", asset.format], ["Size", Math.round(asset.bytes / 1024) + " KB"]];
  const m = asset.measured || {};
  if (m.width && m.height) { out.push(["Pixels", m.width + " x " + m.height + (m.colorType ? " " + m.colorType : "")]); }
  if (m.bboxMeters) { out.push(["Bounding box", m.bboxMeters.join(" x ") + " m"]); }
  if (typeof m.triangles === "number") { out.push(["Triangles", String(m.triangles)]); }
  if (typeof m.meshes === "number") { out.push(["Meshes", String(m.meshes)]); }
  if (m.materials && m.materials.length) { out.push(["Materials", m.materials.join(", ")]); }
  if (m.animations && m.animations.length) { out.push(["Animations", m.animations.join(", ")]); }
  if (typeof m.durationSeconds === "number") { out.push(["Duration", m.durationSeconds + " s"]); }
  if (typeof m.sampleRate === "number") { out.push(["Sample rate", m.sampleRate + " Hz"]); }
  if (typeof m.channels === "number") { out.push(["Channels", String(m.channels)]); }
  if (m.grid) { out.push(["Grid", m.grid.cellWidth + " x " + m.grid.cellHeight]); out.push(["Frames", m.grid.columns + " x " + m.grid.rows + " = " + m.grid.frames]); }
  out.push(["Repo path", asset.promotedPath]);
  out.push(["Original", asset.originalFilename]);
  return out;
}

function renderPreview(asset) {
  const box = $("preview");
  box.replaceChildren();
  if (asset.kind === "image") {
    const img = document.createElement("img");
    img.src = fileUrl(asset);
    img.alt = asset.id;
    box.appendChild(img);
    return;
  }
  if (isViewable(asset)) {
    const viewer = document.createElement("model-viewer");
    viewer.id = "viewer";
    viewer.setAttribute("src", fileUrl(asset));
    viewer.setAttribute("camera-controls", "");
    viewer.setAttribute("auto-rotate", "");
    viewer.setAttribute("shadow-intensity", "1");
    viewer.setAttribute("environment-image", "neutral");
    box.appendChild(viewer);
    return;
  }
  if (asset.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = fileUrl(asset);
    box.appendChild(audio);
    return;
  }
  if (asset.kind === "font") {
    const specimen = document.createElement("div");
    specimen.className = "specimen";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = "The quick brown fox";
    const small = document.createElement("div");
    small.textContent = "0123456789 SCORE 42 x1.5";
    specimen.append(big, small);
    box.appendChild(specimen);
    const family = "egon-" + asset.id.replace(/[^a-zA-Z0-9]/g, "-");
    const face = new FontFace(family, "url(" + fileUrl(asset) + ")");
    face.load().then((loaded) => {
      document.fonts.add(loaded);
      specimen.style.fontFamily = "'" + family + "'";
    }).catch(() => { specimen.style.opacity = "0.6"; });
    return;
  }
  const none = document.createElement("div");
  none.className = "none";
  none.textContent = "No in-browser preview for this format. The measured facts below are what the agents read.";
  box.appendChild(none);
}

function openDetail(asset, queueLabel) {
  state.current = asset;
  $("detail-id").textContent = asset.id;
  $("queue-label").textContent = queueLabel || "";
  renderPreview(asset);
  const facts = $("facts");
  facts.replaceChildren();
  for (const [label, value] of factList(asset)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = label + " ";
    li.append(b, document.createTextNode(value));
    facts.appendChild(li);
  }
  $("filename").value = stemOf(asset.id);
  $("filename-ext").textContent = asset.id.slice(stemOf(asset.id).length);
  $("filename-path").textContent = asset.promotedPath;
  renderParts(asset);
  $("description").value = isDescribed(asset) ? asset.description : suggestDescription(asset.originalFilename);
  $("tags").value = (asset.tags || []).join(", ");
  $("grid-block").hidden = asset.kind !== "image";
  $("cell-width").value = asset.grid ? asset.grid.cellWidth : "";
  $("cell-height").value = asset.grid ? asset.grid.cellHeight : "";
  state.cellGroupsDraft = copyGroups(asset.cellGroups);
  updateGridHint();
  renderGroupSummary();
  $("delete").hidden = state.queue.length > 0;
  $("next").hidden = state.queue.length === 0;
  $("save").hidden = state.queue.length > 0;
  $("error").textContent = "";
  if (!dialog.open) { dialog.showModal(); }
  $("description").focus();
}

function renderParts(asset) {
  const list = $("parts");
  list.replaceChildren();
  const parts = asset.parts || [];
  if (parts.length === 0) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "Nothing attached.";
    list.appendChild(li);
    return;
  }
  for (const part of parts) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = partUrl(asset, part.filename);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = part.filename;
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = formatBytes(part.bytes);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger detach";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void detach(part.filename));
    li.append(link, size, remove);
    list.appendChild(li);
  }
}

function copyGroups(groups) {
  return (groups || []).map((group) => ({
    description: group.description,
    cells: (group.cells || []).map((cell) => ({ col: cell.col, row: cell.row })),
  }));
}

function renderGroupSummary() {
  const list = $("cell-groups");
  const groups = state.cellGroupsDraft || [];
  list.replaceChildren();
  if (groups.length === 0) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  for (const group of groups) {
    const li = document.createElement("li");
    const n = group.cells.length;
    li.textContent = group.description + " — " + n + (n === 1 ? " cell" : " cells");
    list.appendChild(li);
  }
}

function updateGridHint() {
  const asset = state.current;
  const hint = $("grid-hint");
  const button = $("label-sprites");
  if (!asset || asset.kind !== "image") {
    hint.textContent = "";
    button.disabled = true;
    return;
  }
  const w = parseInt($("cell-width").value, 10);
  const h = parseInt($("cell-height").value, 10);
  const m = asset.measured || {};
  button.disabled = !(w > 0 && h > 0 && m.width && m.height && Math.floor(m.width / w) >= 1 && Math.floor(m.height / h) >= 1);
  if (!w || !h || !m.width || !m.height) {
    hint.textContent = "Leave blank unless this is a uniform sprite sheet. Row labels go in the description as prose.";
    return;
  }
  const columns = Math.floor(m.width / w);
  const rows = Math.floor(m.height / h);
  hint.textContent = columns + " x " + rows + " = " + columns * rows + " frames";
}

const GROUP_FILL = [
  "rgba(255, 180, 80, 0.28)",
  "rgba(140, 220, 120, 0.28)",
  "rgba(200, 140, 255, 0.28)",
  "rgba(255, 120, 160, 0.28)",
  "rgba(80, 220, 220, 0.28)",
  "rgba(255, 220, 80, 0.28)",
];
const sheet = { groups: [], selection: new Set(), anchor: null, editingIndex: -1, columns: 0, rows: 0 };

function cellKey(col, row) { return col + "," + row; }
function parseCellKey(key) {
  const parts = key.split(",");
  return { col: parseInt(parts[0], 10), row: parseInt(parts[1], 10) };
}

function groupFillAt(col, row) {
  for (let i = 0; i < sheet.groups.length; i += 1) {
    const cells = sheet.groups[i].cells;
    for (let n = 0; n < cells.length; n += 1) {
      if (cells[n].col === col && cells[n].row === row) {
        return GROUP_FILL[i % GROUP_FILL.length];
      }
    }
  }
  return "";
}

function paintCells() {
  const nodes = $("sheet-grid").children;
  for (let i = 0; i < nodes.length; i += 1) {
    const btn = nodes[i];
    const col = parseInt(btn.dataset.col, 10);
    const row = parseInt(btn.dataset.row, 10);
    const selected = sheet.selection.has(cellKey(col, row));
    btn.classList.toggle("selected", selected);
    btn.style.background = selected ? "" : groupFillAt(col, row);
  }
  const n = sheet.selection.size;
  $("sheet-selected").textContent = n === 0 ? "" : n === 1 ? "1 cell selected" : n + " cells selected";
}

function onCellClick(event, col, row) {
  event.preventDefault();
  if (event.shiftKey && sheet.anchor) {
    const c0 = Math.min(sheet.anchor.col, col);
    const c1 = Math.max(sheet.anchor.col, col);
    const r0 = Math.min(sheet.anchor.row, row);
    const r1 = Math.max(sheet.anchor.row, row);
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        sheet.selection.add(cellKey(c, r));
      }
    }
  } else if (event.ctrlKey || event.metaKey) {
    const key = cellKey(col, row);
    if (sheet.selection.has(key)) { sheet.selection.delete(key); } else { sheet.selection.add(key); }
    sheet.anchor = { col: col, row: row };
  } else {
    sheet.selection = new Set([cellKey(col, row)]);
    sheet.anchor = { col: col, row: row };
  }
  paintCells();
}

function renderSheetGrid() {
  const asset = state.current;
  if (!asset) { return; }
  const w = parseInt($("cell-width").value, 10);
  const h = parseInt($("cell-height").value, 10);
  const m = asset.measured || {};
  const columns = Math.floor(m.width / w);
  const rows = Math.floor(m.height / h);
  sheet.columns = columns;
  sheet.rows = rows;
  const grid = $("sheet-grid");
  grid.style.gridTemplateColumns = "repeat(" + columns + ", 1fr)";
  grid.style.gridTemplateRows = "repeat(" + rows + ", 1fr)";
  grid.replaceChildren();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-cell";
      btn.dataset.col = String(col);
      btn.dataset.row = String(row);
      btn.addEventListener("mousedown", (event) => { if (event.shiftKey) { event.preventDefault(); } });
      btn.addEventListener("click", (event) => onCellClick(event, col, row));
      grid.appendChild(btn);
    }
  }
  paintCells();
}

function renderPickerGroups() {
  const list = $("sheet-groups");
  list.replaceChildren();
  if (sheet.groups.length === 0) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "No groups yet.";
    list.appendChild(li);
    return;
  }
  sheet.groups.forEach((group, index) => {
    const li = document.createElement("li");
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "group" + (sheet.editingIndex === index ? " active" : "");
    const label = document.createElement("span");
    label.textContent = group.description;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(group.cells.length);
    choose.append(label, count);
    choose.addEventListener("click", () => editPickerGroup(index));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger detach";
    remove.textContent = "Remove";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      sheet.groups.splice(index, 1);
      if (sheet.editingIndex === index) { sheet.editingIndex = -1; $("sheet-group-desc").value = ""; $("sheet-add").textContent = "Add group"; }
      else if (sheet.editingIndex > index) { sheet.editingIndex -= 1; }
      renderPickerGroups();
      paintCells();
    });
    li.append(choose, remove);
    list.appendChild(li);
  });
}

function editPickerGroup(index) {
  const group = sheet.groups[index];
  if (!group) { return; }
  sheet.editingIndex = index;
  sheet.selection = new Set(group.cells.map((cell) => cellKey(cell.col, cell.row)));
  sheet.anchor = group.cells[0] ? { col: group.cells[0].col, row: group.cells[0].row } : null;
  $("sheet-group-desc").value = group.description;
  $("sheet-add").textContent = "Update group";
  $("sheet-error").textContent = "";
  renderPickerGroups();
  paintCells();
}

function selectedCells() {
  return [...sheet.selection].map(parseCellKey).sort((a, b) => a.row - b.row || a.col - b.col);
}

function addPickerGroup() {
  const description = $("sheet-group-desc").value.trim();
  const cells = selectedCells();
  if (description === "" || cells.length === 0) {
    $("sheet-error").textContent = "Select cells and add a description.";
    return;
  }
  const group = { description: description, cells: cells };
  if (sheet.editingIndex >= 0) {
    sheet.groups[sheet.editingIndex] = group;
    sheet.editingIndex = -1;
  } else {
    sheet.groups.push(group);
  }
  sheet.selection = new Set();
  $("sheet-group-desc").value = "";
  $("sheet-add").textContent = "Add group";
  $("sheet-error").textContent = "";
  renderPickerGroups();
  paintCells();
}

function openPicker() {
  const asset = state.current;
  if (!asset || $("label-sprites").disabled) { return; }
  sheet.groups = copyGroups(state.cellGroupsDraft);
  sheet.selection = new Set();
  sheet.anchor = null;
  sheet.editingIndex = -1;
  $("sheet-group-desc").value = "";
  $("sheet-add").textContent = "Add group";
  $("sheet-error").textContent = "";
  const img = $("sheet-image");
  img.alt = asset.id;
  img.onload = () => renderSheetGrid();
  img.src = fileUrl(asset);
  if (img.complete) { renderSheetGrid(); }
  renderPickerGroups();
  paintCells();
  $("sheet-picker").showModal();
}

function closePicker(commit) {
  if (commit) {
    state.cellGroupsDraft = copyGroups(sheet.groups);
    renderGroupSummary();
  }
  $("sheet-picker").close();
}

async function post(url, body, isJson) {
  const pass = password(false);
  if (pass === null) { return { aborted: true }; }
  let payload = body;
  const init = { method: "POST" };
  if (isJson) {
    init.headers = { "Content-Type": "application/json" };
    payload = JSON.stringify(Object.assign({ password: pass }, body));
  } else {
    payload.set("password", pass);
  }
  init.body = payload;
  let response = await fetch(url, init);
  if (response.status === 403) {
    const retry = password(true);
    if (retry === null) { return { aborted: true }; }
    if (isJson) {
      init.body = JSON.stringify(Object.assign({ password: retry }, body));
    } else {
      payload.set("password", retry);
      init.body = payload;
    }
    response = await fetch(url, init);
  }
  return { response };
}

async function uploadFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    if (acceptedLocally(file.name)) { accepted.push(file); } else { rejected.push(file.name + " (" + (extOf(file.name) || "no extension") + ")"); }
  }
  const status = $("status");
  const uploaded = [];
  for (let i = 0; i < accepted.length; i += 1) {
    const file = accepted[i];
    status.textContent = "Uploading " + file.name + " (" + (i + 1) + "/" + accepted.length + ")...";
    const form = new FormData();
    form.set("file", file, file.name);
    const result = await post("/assets", form, false);
    if (result.aborted) { status.textContent = "Upload cancelled."; return; }
    const response = result.response;
    if (!response.ok) {
      rejected.push(file.name + " — " + ((await response.text()) || response.status));
      continue;
    }
    const payload = await response.json();
    const existing = state.assets.findIndex((asset) => asset.id === payload.asset.id);
    if (existing >= 0) { state.assets[existing] = payload.asset; } else { state.assets.push(payload.asset); }
    if (!payload.duplicate) { uploaded.push(payload.asset); }
  }
  render();
  status.textContent = rejected.length > 0 ? "Rejected: " + rejected.join("; ") : "";
  if (uploaded.length > 0) {
    state.queue = uploaded.slice(1);
    openDetail(uploaded[0], uploaded.length > 1 ? "1 of " + uploaded.length : "");
  }
}

function parseTags(raw) {
  return raw.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
}

async function captureThumb() {
  const viewer = document.getElementById("viewer");
  if (!viewer || typeof viewer.toBlob !== "function") { return null; }
  try {
    await viewer.updateComplete;
    return await viewer.toBlob({ idealAspect: true, mimeType: "image/png" });
  } catch { return null; }
}

/** A write response can carry a new id (a rename), so replace by the id we asked about. */
function applyWrite(previousId, asset) {
  const index = state.assets.findIndex((item) => item.id === previousId);
  if (index >= 0) { state.assets[index] = asset; } else { state.assets.push(asset); }
  state.current = asset;
  render();
}

async function replaceBytes(file) {
  const asset = state.current;
  if (!asset) { return; }
  $("error").textContent = "";
  $("replace-hint").textContent = "Replacing with " + file.name + "...";
  const form = new FormData();
  form.set("file", file, file.name);
  const result = await post("/assets/" + encodeURIComponent(asset.id) + "/replace", form, false);
  $("replace-hint").textContent = REPLACE_HINT;
  if (result.aborted) { return; }
  if (!result.response.ok) {
    $("error").textContent = (await result.response.text()) || "Replace failed.";
    return;
  }
  const payload = await result.response.json();
  applyWrite(asset.id, payload.asset);
  openDetail(payload.asset, $("queue-label").textContent);
}

async function attach(file) {
  const asset = state.current;
  if (!asset) { return; }
  $("error").textContent = "";
  const form = new FormData();
  form.set("file", file, file.name);
  const result = await post("/assets/" + encodeURIComponent(asset.id) + "/attach", form, false);
  if (result.aborted) { return; }
  if (!result.response.ok) {
    $("error").textContent = (await result.response.text()) || "Could not attach that file.";
    return;
  }
  const payload = await result.response.json();
  applyWrite(asset.id, payload.asset);
  renderParts(payload.asset);
}

async function detach(filename) {
  const asset = state.current;
  if (!asset) { return; }
  const url = "/assets/" + encodeURIComponent(asset.id) + "/attach/" + encodeURIComponent(filename) + "/delete";
  const result = await post(url, {}, true);
  if (result.aborted) { return; }
  if (!result.response.ok) {
    $("error").textContent = (await result.response.text()) || "Could not remove that file.";
    return;
  }
  const payload = await result.response.json();
  applyWrite(asset.id, payload.asset);
  renderParts(payload.asset);
}

async function save() {
  const asset = state.current;
  if (!asset) { return; }
  const description = $("description").value.trim();
  if (description === "") {
    $("error").textContent = "A description is required. Without one this asset is invisible to every agent.";
    return;
  }
  const form = new FormData();
  form.set("filename", $("filename").value.trim());
  form.set("description", description);
  form.set("tags", JSON.stringify(parseTags($("tags").value)));
  const w = parseInt($("cell-width").value, 10);
  const h = parseInt($("cell-height").value, 10);
  form.set("grid", w > 0 && h > 0 ? JSON.stringify({ cellWidth: w, cellHeight: h }) : "");
  form.set("cellGroups", JSON.stringify(state.cellGroupsDraft || []));
  const thumb = await captureThumb();
  if (thumb) { form.set("thumb", thumb, "thumb.png"); }
  const result = await post("/assets/" + encodeURIComponent(asset.id), form, false);
  if (result.aborted) { return; }
  if (!result.response.ok) {
    $("error").textContent = (await result.response.text()) || "Save failed.";
    return;
  }
  const payload = await result.response.json();
  applyWrite(asset.id, payload.asset);
  advance();
}

function advance() {
  if (state.queue.length > 0) {
    const total = state.queue.length;
    const next = state.queue.shift();
    openDetail(next, total > 1 ? "1 of " + total + " left" : "");
    return;
  }
  state.current = null;
  dialog.close();
}

async function remove() {
  const asset = state.current;
  if (!asset || !window.confirm("Delete " + asset.id + " from the library? A copy already promoted into the game repo is not touched.")) { return; }
  const result = await post("/assets/" + encodeURIComponent(asset.id) + "/delete", {}, true);
  if (result.aborted) { return; }
  if (!result.response.ok) {
    $("error").textContent = (await result.response.text()) || "Delete failed.";
    return;
  }
  state.assets = state.assets.filter((item) => item.id !== asset.id);
  render();
  state.current = null;
  dialog.close();
}

const drop = $("drop");
const picker = $("picker");
drop.addEventListener("click", () => picker.click());
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    picker.click();
  }
});
picker.addEventListener("change", () => { void uploadFiles([...picker.files]); picker.value = ""; });
for (const name of ["dragenter", "dragover"]) {
  drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("is-over"); });
}
for (const name of ["dragleave", "drop"]) {
  drop.addEventListener(name, () => drop.classList.remove("is-over"));
}
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  void uploadFiles([...event.dataTransfer.files]);
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

const preview = $("preview");
for (const name of ["dragenter", "dragover"]) {
  preview.addEventListener(name, (event) => { event.preventDefault(); preview.classList.add("is-over"); });
}
for (const name of ["dragleave", "drop"]) {
  preview.addEventListener(name, () => preview.classList.remove("is-over"));
}
preview.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const file = event.dataTransfer.files[0];
  if (file) { void replaceBytes(file); }
});

const attachPicker = $("attach-picker");
$("attach").addEventListener("click", () => attachPicker.click());
attachPicker.addEventListener("change", () => {
  for (const file of attachPicker.files) { void attach(file); }
  attachPicker.value = "";
});

$("save").addEventListener("click", () => void save());
$("next").addEventListener("click", () => void save());
$("delete").addEventListener("click", () => void remove());
$("close").addEventListener("click", () => { state.queue = []; state.current = null; dialog.close(); });
$("cell-width").addEventListener("input", updateGridHint);
$("cell-height").addEventListener("input", updateGridHint);
$("label-sprites").addEventListener("click", () => openPicker());
$("sheet-clear").addEventListener("click", () => { sheet.selection = new Set(); paintCells(); });
$("sheet-add").addEventListener("click", () => addPickerGroup());
$("sheet-done").addEventListener("click", () => closePicker(true));
$("sheet-cancel").addEventListener("click", () => closePicker(false));
for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => {
    const view = button.getAttribute("data-view");
    document.body.classList.toggle("view-list", view === "list");
    for (const other of document.querySelectorAll("[data-view]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    window.localStorage.setItem("egon-asset-view", view);
  });
}
if (window.localStorage.getItem("egon-asset-view") === "list") {
  document.querySelector('[data-view="list"]').click();
}
render();
`;

/**
 * A `<script>` element's content is raw text: the parser does not decode entities inside
 * it, so HTML-escaping the JSON would hand `JSON.parse` a string full of `&quot;`.
 * Escaping `<` is what actually matters — it is the only way to end the element early.
 */
function jsonPayload(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function assetPortalPage(assets: AssetMeta[]): string {
  const data = assets.map(portalAsset);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" href="/favicon.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>Egon asset library</title>
  <style>${STYLES}</style>
  <script type="module" src="${MODEL_VIEWER_SRC}"></script>
</head>
<body>
<header>
  <div class="kicker">Egon</div>
  <a class="back" href="/" aria-label="Back to feature log">${BACK_ARROW}</a>
  <h1>Asset library</h1>
  <p class="lede">Upload the sprites, models, audio, and fonts the game should use, and say what each one is
  for. The bot measures the format and the proportions itself; the description is the part only you can write,
  and an asset without one is invisible to the planner and the implementer.</p>
  <p class="links">
    <a href="/">Feature log</a>
    ·
    <a href="/events">Pipeline events</a>
  </p>
</header>
<main>
  <div id="drop" class="dropzone" role="button" tabindex="0">
    <strong>Drop files here</strong>
    <span>or click to choose. Each one opens for a description before it counts.</span>
    <span class="formats">${escapeHtml(acceptedListText())}</span>
  </div>
  <input id="picker" type="file" multiple hidden>
  <p id="status" class="status"></p>

  <div class="bar">
    <h2>Library</h2>
    <span id="count" class="badge"></span>
    <span id="undescribed" class="badge warn" hidden></span>
    <span class="spacer"></span>
    <button type="button" data-view="grid" aria-pressed="true">Gallery</button>
    <button type="button" data-view="list" aria-pressed="false">Details</button>
  </div>
  <div id="gallery" class="gallery"></div>
  <div id="rows" class="rows"></div>
</main>

<dialog id="detail">
  <div class="dialog-head">
    <h2 id="detail-id"></h2>
    <span id="queue-label" class="queue"></span>
  </div>
  <div class="dialog-body">
    <div id="preview" class="preview"></div>
    <p id="replace-hint" class="hint">Drop a file here to replace these bytes. The filename, description, tags, grid, and labeled sprites all stay.</p>
    <ul id="facts" class="facts"></ul>

    <label for="filename">Filename</label>
    <div class="filename-row">
      <input id="filename" type="text" spellcheck="false" autocapitalize="off" autocorrect="off">
      <span id="filename-ext" class="ext"></span>
    </div>
    <p class="hint">This is the name the game repo gets: <code id="filename-path"></code>. Renaming does not
    touch a copy already committed there, but a spec that named the old id and has not been implemented yet
    will fail its gate — rename before a feature uses the asset, not after.</p>

    <label for="description">Description <span class="hint">required</span></label>
    <textarea id="description" placeholder="What this is and what it is for: &quot;orange municipal garbage truck, low-poly, wheels are separate nodes&quot;, &quot;top-down seamless grass tile, must tile with grass-dirt-edge&quot;."></textarea>
    <p class="hint">Agents read this to decide where the asset goes. Say the intent, not the appearance — the bot already measured the appearance.</p>

    <label for="tags">Tags <span class="hint">optional, comma separated</span></label>
    <input id="tags" type="text" placeholder="vehicle, level-3">

    <div id="grid-block" hidden>
      <label>Sprite sheet grid <span class="hint">optional</span></label>
      <div class="grid-fields">
        <div><input id="cell-width" type="number" min="1" placeholder="cell width"></div>
        <div><input id="cell-height" type="number" min="1" placeholder="cell height"></div>
        <button type="button" id="label-sprites" disabled>Label sprites</button>
      </div>
      <p id="grid-hint" class="hint"></p>
      <ul id="cell-groups" class="cell-groups" hidden></ul>
    </div>

    <label>Companion files <span class="hint">optional</span></label>
    <ul id="parts" class="parts"></ul>
    <button type="button" id="attach">Attach file</button>
    <input id="attach-picker" type="file" multiple hidden>
    <p class="hint">Files this asset needs beside it — a <code>.gltf</code>'s <code>.bin</code> and textures, an
    <code>.obj</code>'s <code>.mtl</code>, an extra animation clip. They are copied into the same directory when a
    feature promotes the asset, so its relative paths still resolve. They never become assets of their own: no
    description, not in the manifest, and no spec can name one.</p>

    <p id="error" class="error"></p>
    <div class="dialog-actions">
      <button type="button" id="save" class="primary">Save</button>
      <button type="button" id="next" class="primary" hidden>Save and next</button>
      <span class="spacer"></span>
      <button type="button" id="delete" class="danger">Delete</button>
      <button type="button" id="close">Close</button>
    </div>
  </div>
</dialog>

<dialog id="sheet-picker">
  <div class="dialog-head">
    <h2>Label sprites</h2>
  </div>
  <div class="dialog-body">
    <div class="sheet-wrap">
      <div class="sheet-stage">
        <img id="sheet-image" alt="">
        <div id="sheet-grid" class="sheet-grid"></div>
      </div>
    </div>
    <p class="hint">Click a cell to select it. Ctrl-click adds or removes. Shift-click fills a rectangle from the last cell.</p>
    <div class="sheet-toolbar">
      <button type="button" id="sheet-clear">Clear selection</button>
      <span id="sheet-selected" class="hint"></span>
    </div>
    <label for="sheet-group-desc">Group description</label>
    <div class="filename-row">
      <input id="sheet-group-desc" type="text" placeholder="flower variants">
      <button type="button" id="sheet-add" class="primary">Add group</button>
    </div>
    <ul id="sheet-groups" class="cell-groups"></ul>
    <p id="sheet-error" class="error"></p>
    <div class="dialog-actions">
      <button type="button" id="sheet-done" class="primary">Done</button>
      <span class="spacer"></span>
      <button type="button" id="sheet-cancel">Cancel</button>
    </div>
  </div>
</dialog>

<script type="application/json" id="asset-data">${jsonPayload(data)}</script>
<script type="application/json" id="accepted-data">${jsonPayload(ACCEPTED_EXTENSIONS)}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}
