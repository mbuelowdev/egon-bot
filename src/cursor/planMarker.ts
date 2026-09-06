export type PlanMarker = "PLAN_COMPLETE" | "PLAN_BLOCKED";

export function parsePlanMarker(text: string | undefined): PlanMarker | null {
  if (!text) {
    return null;
  }
  const complete = text.match(/PLAN_COMPLETE\b/);
  const blocked = text.match(/PLAN_BLOCKED\b/);
  if (complete && blocked) {
    return complete.index! > blocked.index! ? "PLAN_COMPLETE" : "PLAN_BLOCKED";
  }
  if (complete) {
    return "PLAN_COMPLETE";
  }
  if (blocked) {
    return "PLAN_BLOCKED";
  }
  return null;
}
