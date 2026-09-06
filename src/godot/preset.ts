import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEB_PRESET = `[preset.0]

name="Web"
platform="Web"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="build/web/index.html"
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=true
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
`;

export function ensureWebExportPreset(projectDir: string): void {
  const path = join(projectDir, "export_presets.cfg");
  if (!existsSync(path)) {
    writeFileSync(path, WEB_PRESET, "utf8");
    return;
  }
  const existing = readFileSync(path, "utf8");
  if (/^name="Web"$/m.test(existing) || /^name=Web$/m.test(existing)) {
    return;
  }
  const nextIndex = [...existing.matchAll(/\[preset\.(\d+)\]/g)].reduce(
    (max, match) => Math.max(max, Number(match[1])),
    -1,
  ) + 1;
  const extra = WEB_PRESET.replaceAll("preset.0", `preset.${String(nextIndex)}`);
  writeFileSync(path, `${existing.trimEnd()}\n\n${extra}`, "utf8");
}
