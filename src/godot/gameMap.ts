import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

export const GAME_MAP_FILENAME = "GAME_MAP.md";

const SKIP_DIRS = new Set([".git", ".godot", "addons", "build", "node_modules"]);

const GODOT_KEYS: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  27: "Escape",
  32: "Space",
  4194305: "Escape",
  4194306: "Tab",
  4194308: "Backspace",
  4194309: "Enter",
  4194310: "KpEnter",
  4194311: "Insert",
  4194312: "Delete",
  4194317: "Home",
  4194318: "End",
  4194319: "Left",
  4194320: "Up",
  4194321: "Right",
  4194322: "Down",
  4194323: "PageUp",
  4194324: "PageDown",
  4194325: "Shift",
  4194326: "Ctrl",
  4194327: "Meta",
  4194328: "Alt",
  4194332: "F1",
  4194333: "F2",
  4194334: "F3",
  4194335: "F4",
  4194336: "F5",
  4194337: "F6",
  4194338: "F7",
  4194339: "F8",
  4194340: "F9",
  4194341: "F10",
  4194342: "F11",
  4194343: "F12",
};

const MOUSE_BUTTONS: Record<number, string> = {
  1: "Mouse Left",
  2: "Mouse Right",
  3: "Mouse Middle",
  4: "Wheel Up",
  5: "Wheel Down",
  8: "Mouse Extra 1",
  9: "Mouse Extra 2",
};

export function gameMapPath(dataDir: string): string {
  return join(dataDir, GAME_MAP_FILENAME);
}

export function gameMapPromptSection(markdown: string): string[] {
  const trimmed = markdown.trim();
  if (trimmed === "") {
    return [];
  }
  return [
    "Game map of the last merged tree. Prefer this over Glob/Grep/Read for orientation.",
    "",
    trimmed,
    "",
  ];
}

export function loadGameMapMarkdown(config: { gameRepoDir: string; dataDir: string }): string {
  const cached = gameMapPath(config.dataDir);
  if (existsSync(cached)) {
    try {
      return readFileSync(cached, "utf8");
    } catch {
      return "";
    }
  }
  try {
    return generateGameMap(config.gameRepoDir);
  } catch {
    return "";
  }
}

export function writeGameMap(config: { gameRepoDir: string; dataDir: string }): string {
  const markdown = generateGameMap(config.gameRepoDir);
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(gameMapPath(config.dataDir), markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return markdown;
}

export function generateGameMap(repoDir: string): string {
  const projectPath = join(repoDir, "project.godot");
  const project = existsSync(projectPath) ? parseProjectGodot(readFileSync(projectPath, "utf8")) : null;
  const scenes = listRepoFiles(repoDir, ".tscn");
  const scripts = listRepoFiles(repoDir, ".gd");
  const features = listFeatureSummaries(repoDir);
  const lines: string[] = [
    "# Game map",
    "",
    "Deterministic index of the last merged Godot tree. Not an LLM summary.",
    "",
    "## Project",
    "",
  ];
  if (project === null) {
    lines.push("No project.godot found.", "");
  } else {
    lines.push(`- Godot: ${project.godotVersion}`);
    lines.push(`- Renderer: ${project.renderer}`);
    lines.push(`- Main scene: ${project.mainScene}`);
    lines.push(`- Viewport: ${project.viewport}`);
    lines.push(`- Autoload: ${formatAutoloads(project.autoloads)}`);
    lines.push(`- Physics layers (2D): ${formatLayerNames(project.physics2d)}`);
    lines.push(`- Physics layers (3D): ${formatLayerNames(project.physics3d)}`);
    lines.push("");
    lines.push("## Input");
    lines.push("");
    if (project.input.length === 0) {
      lines.push("(none)");
    } else {
      lines.push("| Action | Bindings |");
      lines.push("| --- | --- |");
      for (const action of project.input) {
        lines.push(`| ${action.name} | ${action.bindings} |`);
      }
    }
    lines.push("");
  }
  lines.push("## Features");
  lines.push("");
  if (features.length === 0) {
    lines.push("(none)");
  } else {
    for (const feature of features) {
      lines.push(`- \`${feature.slug}\` — ${feature.summary}`);
    }
  }
  lines.push("");
  lines.push("## Scenes");
  lines.push("");
  if (scenes.length === 0) {
    lines.push("(none)");
  } else {
    for (const scene of scenes) {
      lines.push(`### ${scene}`);
      lines.push(...parseTscnTree(readFileSafe(join(repoDir, scene))));
      lines.push("");
    }
  }
  lines.push("## Scripts");
  lines.push("");
  if (scripts.length === 0) {
    lines.push("(none)", "");
  } else {
    for (const script of scripts) {
      lines.push(`### ${script}`);
      const items = parseGdSummary(readFileSafe(join(repoDir, script)));
      if (items.length === 0) {
        lines.push("(no class_name, extends, signals, exports, or public funcs)");
      } else {
        lines.push(...items);
      }
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

type Autoload = { name: string; path: string; singleton: boolean };
type NamedLayer = { index: number; name: string };
type InputAction = { name: string; bindings: string };

type ProjectMap = {
  godotVersion: string;
  renderer: string;
  mainScene: string;
  viewport: string;
  autoloads: Autoload[];
  physics2d: NamedLayer[];
  physics3d: NamedLayer[];
  input: InputAction[];
};

function parseProjectGodot(raw: string): ProjectMap {
  const ini = parseGodotIni(raw);
  const application = ini.get("application") ?? new Map();
  const display = ini.get("display") ?? new Map();
  const rendering = ini.get("rendering") ?? new Map();
  const autoload = ini.get("autoload") ?? new Map();
  const input = ini.get("input") ?? new Map();
  const layers = ini.get("layer_names") ?? new Map();
  const features = packedStrings(application.get("config/features") ?? "");
  const godotVersion = features.find((item) => /^\d+\.\d+/.test(item)) ?? "unknown";
  const renderer =
    unquote(rendering.get("renderer/rendering_method") ?? "") || rendererFromFeatures(features) || "unknown";
  const width = unquote(display.get("window/size/viewport_width") ?? "") || "1152";
  const height = unquote(display.get("window/size/viewport_height") ?? "") || "648";
  const autoloads: Autoload[] = [];
  for (const [name, value] of [...autoload.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const rawPath = unquote(value);
    const singleton = rawPath.startsWith("*");
    autoloads.push({ name, path: singleton ? rawPath.slice(1) : rawPath, singleton });
  }
  const actions: InputAction[] = [];
  for (const [name, value] of [...input.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    actions.push({ name, bindings: parseInputBindings(value) });
  }
  return {
    godotVersion,
    renderer,
    mainScene: unquote(application.get("run/main_scene") ?? "") || "(unset)",
    viewport: `${width}x${height}`,
    autoloads,
    physics2d: parseLayerNames(layers, "2d_physics"),
    physics3d: parseLayerNames(layers, "3d_physics"),
    input: actions,
  };
}

function rendererFromFeatures(features: string[]): string {
  for (const feature of features) {
    const lower = feature.toLowerCase();
    if (lower === "forward plus") {
      return "forward_plus";
    }
    if (lower === "mobile") {
      return "mobile";
    }
    if (lower === "gl compatibility") {
      return "gl_compatibility";
    }
  }
  return "";
}

function parseLayerNames(section: Map<string, string>, prefix: string): NamedLayer[] {
  const layers: NamedLayer[] = [];
  for (const [key, value] of section) {
    const match = key.match(new RegExp(`^${prefix}/layer_(\\d+)$`));
    if (!match || match[1] === undefined) {
      continue;
    }
    const name = unquote(value);
    if (name === "") {
      continue;
    }
    layers.push({ index: Number(match[1]), name });
  }
  layers.sort((a, b) => a.index - b.index);
  return layers;
}

function parseInputBindings(value: string): string {
  const objects = extractGodotObjects(value);
  if (objects.length === 0) {
    return "(none)";
  }
  const names = objects.map((item) => describeInputEvent(item.type, item.body));
  return names.length > 0 ? names.join(", ") : "(none)";
}

function extractGodotObjects(value: string): Array<{ type: string; body: string }> {
  const out: Array<{ type: string; body: string }> = [];
  let from = 0;
  while (from < value.length) {
    const start = value.indexOf("Object(", from);
    if (start === -1) {
      break;
    }
    let depth = 0;
    let end = -1;
    for (let i = start + "Object".length; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      break;
    }
    const inner = value.slice(start + "Object(".length, end);
    const comma = inner.indexOf(",");
    if (comma !== -1) {
      out.push({ type: inner.slice(0, comma).trim(), body: inner.slice(comma + 1) });
    }
    from = end + 1;
  }
  return out;
}

function describeInputEvent(type: string, body: string): string {
  if (type === "InputEventKey") {
    const code = Number(objectProp(body, "physical_keycode") || objectProp(body, "keycode") || 0);
    const key = godotKeyName(code);
    const mods: string[] = [];
    if (objectProp(body, "ctrl_pressed") === "true") {
      mods.push("Ctrl");
    }
    if (objectProp(body, "alt_pressed") === "true") {
      mods.push("Alt");
    }
    if (objectProp(body, "shift_pressed") === "true") {
      mods.push("Shift");
    }
    if (objectProp(body, "meta_pressed") === "true") {
      mods.push("Meta");
    }
    return mods.length > 0 ? `${mods.join("+")}+${key}` : key;
  }
  if (type === "InputEventMouseButton") {
    const index = Number(objectProp(body, "button_index") || 0);
    return MOUSE_BUTTONS[index] ?? `Mouse ${String(index)}`;
  }
  if (type === "InputEventJoypadButton") {
    return `Joypad button ${objectProp(body, "button_index") || "?"}`;
  }
  if (type === "InputEventJoypadMotion") {
    return `Joypad axis ${objectProp(body, "axis") || "?"}`;
  }
  return type;
}

function objectProp(body: string, name: string): string {
  return new RegExp(`"${name}":\\s*([^,\\n]+)`).exec(body)?.[1]?.trim() ?? "";
}

function godotKeyName(code: number): string {
  if (GODOT_KEYS[code]) {
    return GODOT_KEYS[code];
  }
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(code);
  }
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 32);
  }
  if (code >= 48 && code <= 57) {
    return String.fromCharCode(code);
  }
  return `Key(${String(code)})`;
}

export function parseTscnTree(raw: string): string[] {
  const resources = new Map<string, string>();
  const lines: string[] = [];
  for (const section of splitGodotSections(raw)) {
    if (section.tag === "ext_resource") {
      const id = attr(section.header, "id");
      const path = attr(section.header, "path");
      if (id !== "") {
        resources.set(id, path);
      }
      continue;
    }
    if (section.tag !== "node") {
      continue;
    }
    const name = attr(section.header, "name") || "?";
    const instanced = /\binstance=/.test(section.header);
    const type = attr(section.header, "type") || (instanced ? "Instance" : "Node");
    const parent = attr(section.header, "parent");
    const depth = parent === "" ? 0 : parent.split("/").filter((part) => part !== ".").length + 1;
    const script = nodeScript(section.body, resources);
    const suffix = script === "" ? "" : ` → ${script}`;
    lines.push(`${"  ".repeat(depth)}- ${name} (${type})${suffix}`);
  }
  return lines.length > 0 ? lines : ["(no nodes)"];
}

function splitGodotSections(raw: string): Array<{ tag: string; header: string; body: string }> {
  const sections: Array<{ tag: string; header: string; body: string[] }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const open = line.match(/^\[(\w+)(?:\s+(.*))?\]\s*$/);
    if (open && open[1] !== undefined) {
      sections.push({ tag: open[1], header: open[2] ?? "", body: [] });
      continue;
    }
    const current = sections.at(-1);
    if (current) {
      current.body.push(line);
    }
  }
  return sections.map((section) => ({ tag: section.tag, header: section.header, body: section.body.join("\n") }));
}

function nodeScript(body: string, resources: Map<string, string>): string {
  const ext = body.match(/^\s*script\s*=\s*ExtResource\(\s*"?([^")\s]+)"?\s*\)/m);
  if (ext && ext[1] !== undefined) {
    return resources.get(ext[1]) || `ExtResource(${ext[1]})`;
  }
  if (/^\s*script\s*=\s*SubResource\(/m.test(body)) {
    return "(built-in)";
  }
  return "";
}

export function parseGdSummary(raw: string): string[] {
  const items: string[] = [];
  let pendingExport = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripGdComment(rawLine);
    if (line === "" || /^\s/.test(rawLine)) {
      if (pendingExport && line.startsWith("var ")) {
        items.push(`@export ${line}`);
        pendingExport = false;
      }
      continue;
    }
    if (pendingExport) {
      pendingExport = false;
      if (line.startsWith("var ")) {
        items.push(`@export ${line}`);
        continue;
      }
    }
    const className = line.match(/^class_name\s+(\S+)/);
    if (className && className[1] !== undefined) {
      items.push(`class_name ${className[1]}`);
      continue;
    }
    const extendsMatch = line.match(/^extends\s+(.+)$/);
    if (extendsMatch && extendsMatch[1] !== undefined) {
      items.push(`extends ${extendsMatch[1].trim()}`);
      continue;
    }
    const signal = line.match(/^signal\s+(\S.*)$/);
    if (signal && signal[1] !== undefined) {
      items.push(`signal ${signal[1].replace(/:$/, "").trim()}`);
      continue;
    }
    if (/^@export_(?:group|subgroup|category)\b/.test(line)) {
      continue;
    }
    if (/^@export(?:_\w+)?(?:\([^)]*\))?\s*$/.test(line)) {
      pendingExport = true;
      continue;
    }
    const exported = line.match(/^@export(?:_\w+)?(?:\([^)]*\))?\s+var\s+.+/);
    if (exported) {
      items.push(exported[0]);
      continue;
    }
    const fn = line.match(/^(static\s+)?func\s+(\w+)\s*\(.*\)(?:\s*->\s*[^:]+)?\s*:?\s*$/);
    if (fn && fn[2] !== undefined && !fn[2].startsWith("_")) {
      const staticPrefix = fn[1] ? "static " : "";
      items.push(`${staticPrefix}func ${fn[2]}${signatureTail(line)}`);
    }
  }
  return items;
}

function signatureTail(line: string): string {
  const match = line.match(/func\s+\w+(\s*\(.*\)(?:\s*->\s*[^:]+)?)/);
  return (match?.[1] ?? "()").replace(/\s*:?\s*$/, "");
}

function stripGdComment(line: string): string {
  let out = "";
  let inString: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : "";
    if (inString) {
      out += ch;
      if (ch === inString && prev !== "\\") {
        inString = null;
      }
      continue;
    }
    if (ch === "#") {
      break;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
    }
    out += ch;
  }
  return out.trim();
}

function listFeatureSummaries(repoDir: string): Array<{ slug: string; summary: string }> {
  const featuresDir = join(repoDir, "docs", "features");
  if (!existsSync(featuresDir)) {
    return [];
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(featuresDir, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && !ent.name.startsWith("."))
      .map((ent) => ent.name);
  } catch {
    return [];
  }
  entries.sort((a, b) => a.localeCompare(b));
  const out: Array<{ slug: string; summary: string }> = [];
  for (const slug of entries) {
    const specPath = join(featuresDir, slug, "SPEC.md");
    if (!existsSync(specPath)) {
      continue;
    }
    out.push({ slug, summary: specSection1Summary(readFileSafe(specPath)) || "(no §1 summary)" });
  }
  return out;
}

export function specSection1Summary(markdown: string): string {
  const match = markdown.match(/^## 1\.\s+Context\s*&\s*Goal\s*$/m);
  if (!match || match.index === undefined) {
    return "";
  }
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  const para = (body.split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (para.length <= 220) {
    return para;
  }
  return `${para.slice(0, 217).trimEnd()}...`;
}

function parseGodotIni(raw: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let section = "";
  let pendingKey = "";
  let pendingValue = "";
  let depth = 0;
  const flushPending = (): void => {
    if (pendingKey === "") {
      return;
    }
    sectionMap(sections, section).set(pendingKey, pendingValue);
    pendingKey = "";
    pendingValue = "";
    depth = 0;
  };
  for (const rawLine of raw.split(/\r?\n/)) {
    if (depth > 0) {
      pendingValue += `\n${rawLine}`;
      depth += countChar(rawLine, "{") - countChar(rawLine, "}");
      if (depth <= 0) {
        flushPending();
      }
      continue;
    }
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith(";")) {
      continue;
    }
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header && header[1] !== undefined) {
      flushPending();
      section = header[1];
      continue;
    }
    const eq = rawLine.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = rawLine.slice(0, eq).trim();
    const value = rawLine.slice(eq + 1);
    depth = countChar(value, "{") - countChar(value, "}");
    if (depth > 0) {
      pendingKey = key;
      pendingValue = value;
      continue;
    }
    sectionMap(sections, section).set(key, value);
  }
  flushPending();
  return sections;
}

function sectionMap(sections: Map<string, Map<string, string>>, name: string): Map<string, string> {
  const existing = sections.get(name);
  if (existing) {
    return existing;
  }
  const created = new Map<string, string>();
  sections.set(name, created);
  return created;
}

function packedStrings(value: string): string[] {
  const inner = /PackedStringArray\((.*)\)/s.exec(value);
  if (!inner || inner[1] === undefined) {
    return [];
  }
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null = re.exec(inner[1]);
  while (match) {
    out.push(match[1]?.replace(/\\"/g, '"') ?? "");
    match = re.exec(inner[1]);
  }
  return out;
}

function listRepoFiles(root: string, ext: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) {
          visit(full);
        }
        continue;
      }
      if (ent.isFile() && ent.name.toLowerCase().endsWith(ext)) {
        out.push(relative(root, full).replaceAll("\\", "/"));
      }
    }
  };
  if (existsSync(root)) {
    visit(root);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function formatAutoloads(autoloads: Autoload[]): string {
  if (autoloads.length === 0) {
    return "(none)";
  }
  return autoloads
    .map((item) => `${item.name} → ${item.path}${item.singleton ? " (singleton)" : ""}`)
    .join("; ");
}

function formatLayerNames(layers: NamedLayer[]): string {
  if (layers.length === 0) {
    return "(none)";
  }
  return layers.map((layer) => `${String(layer.index)}=${layer.name}`).join(", ");
}

function attr(header: string, name: string): string {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(header)?.[1] ?? "";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const item of text) {
    if (item === ch) {
      n += 1;
    }
  }
  return n;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
