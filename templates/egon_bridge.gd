extends Node
## Egon debug bridge. The orchestrator owns this file and its [autoload] entry and
## rewrites both on every run — do not edit either by hand.
##
## Two jobs:
##
## 1. State. Features register fields additively, so a new feature never clobbers the
##    state an earlier feature's checks depend on.
##
##        func _ready() -> void:
##            EgonBridge.register_field("playerX", func(): return global_position.x)
##
##    The suite reads `window.__egon.state()` in the browser, which returns a JSON object
##    of every registered field. Provider return values must be JSON-safe: int, float,
##    bool, String, Array, or Dictionary. Convert Vector2/Color/etc. yourself.
##
## 2. Scenarios. A scenario is a named routine that puts the game into a specific state,
##    so verification is not limited to what a cold boot can reach. Drop a script in
##    res://egon/scenarios/{name}.gd exposing `func apply() -> void:` and it registers
##    itself under its file name. Game code may also call `register_scenario()` directly.
##
##    Selected at startup, once, from either front door:
##      browser  ?egon_scenario={name}
##      headless -- --egon-scenario={name}
##
##    `default` is reserved and means "the game as it normally boots". An unknown name is
##    a hard failure: nothing is applied and `window.__egon.scenario()` stays null, so a
##    typo can never pass against the wrong state.
##
##    Scenarios only run in debug builds. A release export ignores the parameter entirely.
##
## Headless self-check: EgonBridge.snapshot() returns the same Dictionary without touching
## the browser, so `--headless --quit-after` runs can verify field values. Those runs also
## print EGON_SCENARIO_ACTIVE / EGON_SCENARIO_UNKNOWN for grepping.
##
## Implementation note: GDScript pushes a snapshot into JS rather than letting JS call
## back into GDScript. JavaScriptBridge.create_callback return values are not dependable
## across Godot 4 point releases; JavaScriptBridge.eval is.

const SCENARIO_DIR := "res://egon/scenarios"
const DEFAULT_SCENARIO := "default"
const SCENARIO_ARG_PREFIX := "--egon-scenario="

const _BOOTSTRAP := """
window.__egon = window.__egon || {};
window.__egon._state = window.__egon._state || {};
window.__egon._scenario = null;
window.__egon._scenarios = [];
window.__egon.state = function () { return window.__egon._state; };
window.__egon.fields = function () { return Object.keys(window.__egon._state); };
window.__egon.scenario = function () { return window.__egon._scenario; };
window.__egon.scenarios = function () { return window.__egon._scenarios; };
"""

var _providers: Dictionary = {}
var _scenarios: Dictionary = {}
var _scenario_objects: Array = []
var _web: bool = false
var _last_pushed: String = ""
var _requested_scenario: String = ""
var _active_scenario: String = ""
var _scenario_resolved: bool = false


func _ready() -> void:
	_web = OS.has_feature("web")
	# Run after gameplay nodes so the snapshot reflects the frame that just resolved,
	# and keep running while the tree is paused so pause-menu checks stay readable.
	process_priority = 1000
	process_mode = Node.PROCESS_MODE_ALWAYS
	if _web:
		JavaScriptBridge.eval(_BOOTSTRAP, true)
	if OS.is_debug_build():
		_load_scenario_scripts()
		_requested_scenario = _read_requested_scenario()
	else:
		_scenario_resolved = true


## Expose one field under `window.__egon.state()`. Re-registering a name replaces its
## provider. Safe to call on any platform; headless runs simply never push to JS.
func register_field(name: String, provider: Callable) -> void:
	if name.is_empty():
		push_warning("EgonBridge.register_field ignored an empty field name")
		return
	if not provider.is_valid():
		push_warning("EgonBridge.register_field ignored an invalid provider for '%s'" % name)
		return
	_providers[name] = provider


func unregister_field(name: String) -> void:
	_providers.erase(name)
	_last_pushed = ""


func registered_fields() -> PackedStringArray:
	var names := PackedStringArray()
	for key in _providers.keys():
		names.append(String(key))
	names.sort()
	return names


## Register a scenario by name. Scripts in res://egon/scenarios are picked up
## automatically; this is for scenarios built somewhere else.
func register_scenario(name: String, applier: Callable) -> void:
	if name.is_empty():
		push_warning("EgonBridge.register_scenario ignored an empty scenario name")
		return
	if not applier.is_valid():
		push_warning("EgonBridge.register_scenario ignored an invalid applier for '%s'" % name)
		return
	_scenarios[name] = applier


func registered_scenarios() -> PackedStringArray:
	var names := PackedStringArray()
	for key in _scenarios.keys():
		names.append(String(key))
	names.sort()
	return names


## Name of the scenario that actually loaded, or "" when none did.
func active_scenario() -> String:
	return _active_scenario


## Current value of every registered field. Works headless.
func snapshot() -> Dictionary:
	var out: Dictionary = {}
	for key in _providers.keys():
		var provider: Callable = _providers[key]
		if not provider.is_valid():
			continue
		out[key] = provider.call()
	return out


func _process(_delta: float) -> void:
	# Resolve on the first frame, not in _ready(): autoloads run before the main scene,
	# so anything registering from a gameplay node's _ready() does not exist yet.
	if not _scenario_resolved:
		_scenario_resolved = true
		_apply_requested_scenario()
	if not _web or _providers.is_empty():
		return
	var text := JSON.stringify(snapshot())
	if text == _last_pushed:
		return
	_last_pushed = text
	JavaScriptBridge.eval("window.__egon._state = " + text + ";", true)


func _read_requested_scenario() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(SCENARIO_ARG_PREFIX):
			return arg.substr(SCENARIO_ARG_PREFIX.length()).strip_edges()
	if _web:
		var raw: Variant = JavaScriptBridge.eval(
			"(new URLSearchParams(window.location.search)).get('egon_scenario') || ''", true
		)
		if typeof(raw) == TYPE_STRING:
			return String(raw).strip_edges()
	return ""


func _apply_requested_scenario() -> void:
	var name := _requested_scenario
	if name.is_empty():
		name = DEFAULT_SCENARIO
	if name == DEFAULT_SCENARIO and not _scenarios.has(DEFAULT_SCENARIO):
		# "default" means the game as it normally boots. A default.gd is optional.
		_active_scenario = DEFAULT_SCENARIO
		print("EGON_SCENARIO_ACTIVE: %s" % _active_scenario)
		_push_scenario_meta()
		return
	if not _scenarios.has(name):
		_active_scenario = ""
		push_error(
			"EgonBridge: unknown scenario '%s'. Registered: %s"
			% [name, ", ".join(registered_scenarios())]
		)
		print("EGON_SCENARIO_UNKNOWN: %s" % name)
		_push_scenario_meta()
		return
	var applier: Callable = _scenarios[name]
	_active_scenario = name
	print("EGON_SCENARIO_ACTIVE: %s" % _active_scenario)
	_push_scenario_meta()
	applier.call()


func _push_scenario_meta() -> void:
	if not _web:
		return
	var names: Array = []
	for entry in registered_scenarios():
		names.append(entry)
	var active: Variant = null if _active_scenario.is_empty() else _active_scenario
	JavaScriptBridge.eval(
		(
			"window.__egon._scenario = %s; window.__egon._scenarios = %s;"
			% [JSON.stringify(active), JSON.stringify(names)]
		),
		true
	)


## Load every res://egon/scenarios/*.gd and register it under its file name.
## Convention beats registration order: the file name is the scenario name, so nothing
## depends on which node happened to run _ready() first.
func _load_scenario_scripts() -> void:
	var dir := DirAccess.open(SCENARIO_DIR)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not dir.current_is_dir():
			_register_scenario_file(entry)
		entry = dir.get_next()
	dir.list_dir_end()


func _register_scenario_file(entry: String) -> void:
	# Exported builds may present scripts as foo.gd.remap.
	var file := entry.trim_suffix(".remap")
	if not file.ends_with(".gd"):
		return
	var name := file.get_basename()
	if name.is_empty():
		return
	var script: Variant = load("%s/%s" % [SCENARIO_DIR, file])
	if script == null or not (script is GDScript):
		push_warning("EgonBridge could not load scenario script '%s'" % file)
		return
	var instance: Variant = (script as GDScript).new()
	if instance == null or not instance.has_method("apply"):
		push_warning("EgonBridge scenario '%s' has no apply() method" % name)
		return
	# Hold the instance so a RefCounted scenario is not freed before it runs.
	_scenario_objects.append(instance)
	register_scenario(name, Callable(instance, "apply"))
