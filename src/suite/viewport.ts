/**
 * Runner and Godot design viewport. Check `click` coordinates live in this space.
 * Matches `project.godot` `window/size/viewport_*`. Integer-scales to 1280×720 (×2)
 * and 1920×1080 (×3).
 *
 * Kept in its own leaf module: both the check schema and the planner-facing capability
 * text need these, and importing them from each other is a cycle.
 */
export const TESTER_VIEWPORT_WIDTH = 640;
export const TESTER_VIEWPORT_HEIGHT = 360;
export const TESTER_VIEWPORT_SIZE = `${TESTER_VIEWPORT_WIDTH}x${TESTER_VIEWPORT_HEIGHT}`;
