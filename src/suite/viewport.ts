/**
 * Runner viewport. Check `click` coordinates live in this space.
 * 960×540 ≈ 0.9k tokens/screenshot vs Playwright's 1280×720 default ≈ 1.6k.
 *
 * Kept in its own leaf module: both the check schema and the planner-facing capability
 * text need these, and importing them from each other is a cycle.
 */
export const TESTER_VIEWPORT_WIDTH = 960;
export const TESTER_VIEWPORT_HEIGHT = 540;
export const TESTER_VIEWPORT_SIZE = `${TESTER_VIEWPORT_WIDTH}x${TESTER_VIEWPORT_HEIGHT}`;
