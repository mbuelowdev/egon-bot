import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetKind } from "./allowlist.js";
import { describedAssets, formatCellGroupCoords, formatCellGroups, promotedAssetPath, type AssetMeta } from "./store.js";

/**
 * `ASSETS.md` is generated from the sidecars, mirroring `GAME_MAP.md`: deterministic,
 * regenerated on every portal write and at pipeline start, and never allowed to throw —
 * a stale manifest beats a failed run.
 *
 * The two agents get different slices of it, because they need opposite things. The
 * planner gets a compact index of the whole library, because "this feature needs no
 * assets" is a conclusion it can only reach after seeing what exists. The implementer
 * gets only the assets SPEC §4 declared, with their measurements — handing it the whole
 * library invites it to reach for one the spec never declared, which promotion never
 * copied into the repo, producing a broken `res://` reference.
 */

export const ASSET_MANIFEST_FILENAME = "ASSETS.md";
/** Rows in the manifest and in the planner's index. Follows MAX_BRIDGE_FIELDS. */
export const MAX_MANIFEST_ASSETS = 120;

const KIND_ORDER: readonly AssetKind[] = ["model", "image", "audio", "font"];
const KIND_HEADINGS: Record<AssetKind, string> = {
  model: "Models",
  image: "Images",
  audio: "Audio",
  font: "Fonts",
};

export function assetManifestPath(dataDir: string): string {
  return join(dataDir, ASSET_MANIFEST_FILENAME);
}

function trimNumber(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function formatTriangles(count: number): string {
  if (count >= 1000) {
    return `${trimNumber(count / 1000, 1)}k tris`;
  }
  return `${String(count)} tris`;
}

function formatNames(label: string, names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) {
    return undefined;
  }
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${label}: ${shown}, +${String(names.length - 3)}` : `${label}: ${shown}`;
}

function formatChannels(channels: number): string {
  if (channels === 1) {
    return "mono";
  }
  if (channels === 2) {
    return "stereo";
  }
  return `${String(channels)}ch`;
}

/** The measured column: what the bot read off the file, never what a model guessed. */
export function measuredSummary(meta: AssetMeta): string {
  const measured = meta.measured;
  if (measured === undefined) {
    return "";
  }
  const parts: string[] = [];
  if (measured.bboxMeters) {
    const [x, y, z] = measured.bboxMeters;
    parts.push(`${trimNumber(x, 2)} × ${trimNumber(y, 2)} × ${trimNumber(z, 2)} m`);
  }
  if (typeof measured.triangles === "number") {
    parts.push(formatTriangles(measured.triangles));
  }
  const anims = formatNames("anims", measured.animations);
  if (anims !== undefined) {
    parts.push(anims);
  }
  if (typeof measured.width === "number" && typeof measured.height === "number") {
    const color = measured.colorType ? ` ${measured.colorType}` : "";
    parts.push(`${String(measured.width)} × ${String(measured.height)}${color}`);
  }
  if (measured.grid) {
    const { cellWidth, cellHeight, columns, rows, frames } = measured.grid;
    parts.push(
      `grid ${String(cellWidth)} × ${String(cellHeight)} (${String(columns)} × ${String(rows)} = ${String(frames)} frames)`,
    );
  }
  if (typeof measured.durationSeconds === "number") {
    parts.push(`${trimNumber(measured.durationSeconds, 2)} s`);
  }
  const rate =
    typeof measured.sampleRate === "number" ? `${trimNumber(measured.sampleRate / 1000, 1)} kHz` : undefined;
  const channels = typeof measured.channels === "number" ? formatChannels(measured.channels) : undefined;
  const audio = [rate, channels].filter((part): part is string => part !== undefined).join(" ");
  if (audio !== "") {
    parts.push(audio);
  }
  return parts.join(", ");
}

/** Companion filenames, for the column that only appears when something has them. */
export function shipsWith(meta: AssetMeta): string {
  return meta.parts.map((part) => `\`${part.filename}\``).join(", ");
}

function anyParts(assets: AssetMeta[]): boolean {
  return assets.some((meta) => meta.parts.length > 0);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function descriptionCell(meta: AssetMeta): string {
  const regions = formatCellGroups(meta.cellGroups);
  const text = regions === "" ? meta.description : `${meta.description} Regions: ${regions}`;
  return oneLine(text);
}

function groupByKind(assets: AssetMeta[]): Array<{ kind: AssetKind; assets: AssetMeta[] }> {
  return KIND_ORDER.map((kind) => ({ kind, assets: assets.filter((meta) => meta.kind === kind) })).filter(
    (group) => group.assets.length > 0,
  );
}

/** Described assets only, kind-ordered, capped. What every slice is cut from. */
function manifestAssets(assets: AssetMeta[]): { rows: AssetMeta[]; omitted: number } {
  const ordered = KIND_ORDER.flatMap((kind) =>
    assets.filter((meta) => meta.kind === kind).sort((a, b) => a.id.localeCompare(b.id)),
  );
  return {
    rows: ordered.slice(0, MAX_MANIFEST_ASSETS),
    omitted: Math.max(0, ordered.length - MAX_MANIFEST_ASSETS),
  };
}

export function renderAssetManifest(assets: AssetMeta[]): string {
  const { rows, omitted } = manifestAssets(assets);
  const lines: string[] = [
    "# Asset library",
    "",
    "Assets available to this game. Facts are measured; descriptions are written by the humans who",
    "uploaded them. Not an LLM summary.",
    "",
    "An asset is only in the game once a feature copies it in. Name the ones you use in the SPEC's",
    "Assets section by exact id; after promotion the path is `assets/library/{kind}/{id}`.",
    "",
  ];
  if (rows.length === 0) {
    lines.push("The library is empty. No feature can name an asset until a human uploads and describes one.");
    lines.push("");
    return lines.join("\n");
  }
  const withParts = anyParts(rows);
  if (withParts) {
    lines.push(
      "Some assets ship with companion files — a `.gltf`'s `.bin` and textures, an `.obj`'s `.mtl`,",
      "extra animation clips. They are copied into the same directory, so relative paths resolve.",
      "",
    );
  }
  const groups = groupByKind(rows);
  groups.forEach((group, index) => {
    lines.push(`## ${KIND_HEADINGS[group.kind]}`);
    lines.push("");
    lines.push(withParts ? "| id | Measured | Ships with | Description |" : "| id | Measured | Description |");
    lines.push(withParts ? "| --- | --- | --- | --- |" : "| --- | --- | --- |");
    for (const meta of group.assets) {
      const cells = [`\`${meta.id}\``, measuredSummary(meta) || "—"];
      if (withParts) {
        cells.push(shipsWith(meta) || "—");
      }
      cells.push(descriptionCell(meta));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    if (omitted > 0 && index === groups.length - 1) {
      lines.push(`| … | ${String(omitted)} more |${withParts ? " |" : ""} |`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

export function generateAssetManifest(dataDir: string): string {
  return renderAssetManifest(describedAssets(dataDir));
}

export function writeAssetManifest(dataDir: string): string {
  const markdown = generateAssetManifest(dataDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(assetManifestPath(dataDir), markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return markdown;
}

/** Regenerate after a portal write and at pipeline start. A stale manifest beats a failed run. */
export function refreshAssetManifest(dataDir: string): void {
  try {
    writeAssetManifest(dataDir);
  } catch (error) {
    console.error(`failed to refresh ${ASSET_MANIFEST_FILENAME}`, error);
  }
}

/**
 * The planner's slice: every described asset, id and one line, no measured column. It has
 * to be in front of the planner rather than behind a pointer — an agent with no idea the
 * library has a garbage truck has no reason to go look for one, and specs a `ColorRect`
 * placeholder instead.
 */
export function assetIndexPromptSection(assets: AssetMeta[]): string[] {
  const { rows, omitted } = manifestAssets(assets);
  const lines = [
    "Asset library index. Name the assets this feature needs in the SPEC's Assets section, by exact id.",
    "Only described assets are listed. An id that is not in this list does not exist — do not invent one,",
    "and if nothing here fits, say so in Implementation notes rather than naming a file you hope exists.",
    "",
  ];
  if (rows.length === 0) {
    lines.push("(the library is empty — write `None.` in the Assets section)", "");
    return lines;
  }
  for (const group of groupByKind(rows)) {
    lines.push(`## ${KIND_HEADINGS[group.kind]}`);
    for (const meta of group.assets) {
      lines.push(`- \`${meta.id}\` — ${descriptionCell(meta)}`);
    }
    lines.push("");
  }
  if (omitted > 0) {
    lines.push(`(… ${String(omitted)} more)`, "");
  }
  return lines;
}

function cellGroupPromptLines(assets: AssetMeta[]): string[] {
  const lined: string[] = [];
  for (const meta of assets) {
    const groups = meta.cellGroups;
    if (groups === undefined || groups.length === 0) {
      continue;
    }
    const cell =
      meta.grid !== null
        ? `cell ${String(meta.grid.cellWidth)}×${String(meta.grid.cellHeight)}`
        : "cell size unknown";
    lined.push(`\`${meta.id}\` regions (0-based col, row; ${cell}):`);
    for (const group of groups) {
      lined.push(`- ${oneLine(group.description)}: ${formatCellGroupCoords(group.cells)}`);
    }
  }
  if (lined.length === 0) {
    return [];
  }
  return [
    "",
    "Sprite sheet regions. Pixel origin of a cell is (col × cell width, row × cell height), which is what `AtlasTexture` / `SpriteFrames` want.",
    ...lined,
  ];
}

function resolveDeclaredAssets(ids: string[], assets: AssetMeta[]): AssetMeta[] {
  const byId = new Map(assets.map((meta) => [meta.id, meta]));
  const out: AssetMeta[] = [];
  for (const id of ids) {
    const meta = byId.get(id);
    if (meta !== undefined && !out.includes(meta)) {
      out.push(meta);
    }
  }
  return out;
}

/**
 * The implementer's slice: only the ids its SPEC declared, with the measurements — the
 * bounding box it scales against and the grid it feeds `AtlasTexture` / `SpriteFrames`.
 * It does not get the catalog; the spec already names its assets by exact id.
 */
export function declaredAssetsPromptSection(ids: string[], assets: AssetMeta[]): string[] {
  const declared = resolveDeclaredAssets(ids, assets);
  if (declared.length === 0) {
    return [];
  }
  const withParts = anyParts(declared);
  const lines = [
    "Assets this SPEC declares. They are already copied into the working tree at the paths below.",
    "Import them from there — do not re-download them, and do not reference any other library asset:",
    "nothing else was copied in, so a `res://` path to one would be broken.",
    "",
  ];
  lines.push(
    withParts
      ? "| id | Measured | Ships with | Path in this repo |"
      : "| id | Measured | Path in this repo |",
  );
  lines.push(withParts ? "| --- | --- | --- | --- |" : "| --- | --- | --- |");
  for (const meta of declared) {
    const cells = [`\`${meta.id}\``, measuredSummary(meta) || "—"];
    if (withParts) {
      cells.push(shipsWith(meta) || "—");
    }
    cells.push(`\`${promotedAssetPath(meta)}\``);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (withParts) {
    lines.push(
      "",
      "The companion files sit in the same directory as the asset they belong to, which is what the",
      "asset references them by. Do not move or rename them.",
    );
  }
  lines.push(...cellGroupPromptLines(declared));
  lines.push("");
  return lines;
}
