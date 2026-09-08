/**
 * Godot 4 web pitfalls compiled into the implementer prompt.
 * Never loaded from disk and never feature-specific. Each bullet is a
 * repeat failure class — do not drop or paraphrase away the names.
 */
export const GODOT_WEB_GOTCHAS_PROMPT = [
  "Godot 4 web gotchas. Each is a repeat failure class. Do not reintroduce them.",
  "- thread_support=true means SharedArrayBuffer and COOP/COEP. The orchestrator already serves those headers. Do not disable threads to paper over a blank canvas.",
  "- Expose Verification hooks state with `EgonBridge.register_field(name, callable)`. The autoload already guards `OS.has_feature(\"web\")`, so registering is safe under headless `--quit-after`, and `EgonBridge.snapshot()` reads the same values without a browser. Hand-rolled JavaScriptBridge calls are not guarded and crash the headless smoke run.",
  "- Do not edit, move, or delete `egon/egon_bridge.gd` or its `[autoload]` entry. `ensureEgonBridge` owns both and overwrites them every run.",
  "- Never hand-edit `.uid` files. Let `--import` assign them.",
  "- `class_name` must be globally unique. Reusing a name fails parse or export.",
  "- No addons. Do not add, enable, or depend on `addons/`.",
  "- Do not touch `export_presets.cfg`. `ensureWebExportPreset` owns the Web preset.",
].join("\n");
