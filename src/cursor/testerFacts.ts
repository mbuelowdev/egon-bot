import { GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS, GODOT_BOOT_WAIT_MS } from "./godotBootWait.js";
import { TESTER_VIEWPORT_SIZE } from "./testerCapabilities.js";

/** Cap so a busy UI scene cannot blow the tester prompt. */
export const MAX_TESTER_HUD_FACTS = 12;

const HUD_TYPES = new Set([
  "AcceptDialog",
  "Button",
  "CanvasLayer",
  "CenterContainer",
  "CheckBox",
  "CheckButton",
  "ColorRect",
  "ConfirmationDialog",
  "Control",
  "GridContainer",
  "HBoxContainer",
  "HSlider",
  "ItemList",
  "Label",
  "LineEdit",
  "LinkButton",
  "MarginContainer",
  "MenuButton",
  "NinePatchRect",
  "OptionButton",
  "Panel",
  "PanelContainer",
  "Popup",
  "PopupMenu",
  "ProgressBar",
  "RichTextLabel",
  "ScrollContainer",
  "SpinBox",
  "TabBar",
  "TabContainer",
  "TextureButton",
  "TextureProgressBar",
  "TextureRect",
  "VBoxContainer",
  "VSlider",
  "Window",
]);

const HUD_NAME =
  /(^|[^A-Za-z])(hud|ui|gui)([^A-Za-z]|$)|overlay|crosshair|minimap|healthbar|hp_?bar|\bscore\b|\bammo\b|pause.?menu|main.?menu/i;

export type TesterHudFact = {
  scene: string;
  node: string;
  type: string;
};

export type TesterGameFacts = {
  viewport: string;
  controls: Array<{ action: string; bindings: string }>;
  hud: TesterHudFact[];
};

export function parseTesterFactsFromGameMap(markdown: string): TesterGameFacts {
  const project = gameMapSection(markdown, "Project");
  const viewport = /^- Viewport:\s+(\S+)/m.exec(project)?.[1]?.trim() ?? "";
  return {
    viewport,
    controls: parseInputControls(gameMapSection(markdown, "Input")),
    hud: parseHudElements(gameMapSection(markdown, "Scenes")),
  };
}

/** Compact orientation for the tester. Criteria are already listed; do not Read the SPEC. */
export function testerFactsPromptSection(gameMap: string): string[] {
  const facts = parseTesterFactsFromGameMap(gameMap);
  const canvas =
    facts.viewport === ""
      ? `Playwright ${TESTER_VIEWPORT_SIZE} (click coordinates are Playwright space)`
      : `Godot ${facts.viewport}; Playwright ${TESTER_VIEWPORT_SIZE} (click coordinates are Playwright space)`;
  const bootSeconds = String(GODOT_BOOT_WAIT_MS / 1000);
  const controls =
    facts.controls.length === 0
      ? "(none)"
      : facts.controls.map((item) => `${item.action}=${item.bindings}`).join("; ");
  const shown = facts.hud.slice(0, MAX_TESTER_HUD_FACTS);
  const hud =
    facts.hud.length === 0
      ? "(none)"
      : `${shown.map((item) => `${item.node} (${item.type}, ${item.scene})`).join("; ")}${
          facts.hud.length > MAX_TESTER_HUD_FACTS ? "; …" : ""
        }`;
  return [
    "Game facts (compiled from GAME_MAP; do not Read the SPEC — criteria below are complete):",
    `- Canvas: ${canvas}`,
    `- Expected boot: up to ${bootSeconds}s per evaluate, at most ${String(GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS)} calls`,
    `- Controls: ${controls}`,
    `- HUD: ${hud}`,
    "",
  ];
}

function gameMapSection(markdown: string, heading: string): string {
  const match = markdown.match(new RegExp(`^## ${heading}\\s*$`, "m"));
  if (!match || match.index === undefined) {
    return "";
  }
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseInputControls(section: string): Array<{ action: string; bindings: string }> {
  if (section === "" || section === "(none)") {
    return [];
  }
  const controls: Array<{ action: string; bindings: string }> = [];
  for (const line of section.split(/\r?\n/)) {
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (!row || row[1] === undefined || row[2] === undefined) {
      continue;
    }
    const action = row[1].trim();
    const bindings = row[2].trim();
    if (action === "Action" || /^-+$/.test(action.replaceAll(" ", ""))) {
      continue;
    }
    controls.push({ action, bindings });
  }
  return controls;
}

function parseHudElements(section: string): TesterHudFact[] {
  const hud: TesterHudFact[] = [];
  let scene = "";
  for (const line of section.split(/\r?\n/)) {
    const header = /^###\s+(.+)$/.exec(line);
    if (header && header[1] !== undefined) {
      scene = header[1].trim();
      continue;
    }
    const node = /^\s*-\s+(\S+)\s+\(([^)]+)\)/.exec(line);
    if (!node || scene === "" || node[1] === undefined || node[2] === undefined) {
      continue;
    }
    const name = node[1];
    const type = node[2];
    if (HUD_TYPES.has(type) || HUD_NAME.test(name)) {
      hud.push({ scene, node: name, type });
    }
  }
  return hud;
}
