export const FEATURE_STATES = [
  "collecting",
  "planning",
  "implementing",
  "exporting",
  "testing",
  "fixing",
  "awaiting_review",
  "accepted",
  "rejected",
  "pivoting",
] as const;

export type FeatureState = (typeof FEATURE_STATES)[number];

const TRANSITIONS: Record<FeatureState, readonly FeatureState[]> = {
  collecting: ["planning"],
  planning: ["implementing", "accepted", "rejected"],
  implementing: ["exporting", "accepted", "rejected"],
  exporting: ["testing", "accepted", "rejected"],
  testing: ["fixing", "awaiting_review", "accepted", "rejected"],
  fixing: ["exporting", "accepted", "rejected"],
  awaiting_review: ["accepted", "rejected", "pivoting"],
  rejected: ["pivoting", "accepted"],
  pivoting: ["implementing", "accepted", "rejected"],
  accepted: [],
};

export function isFeatureState(value: string): value is FeatureState {
  return (FEATURE_STATES as readonly string[]).includes(value);
}

export function canTransition(from: FeatureState, to: FeatureState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: FeatureState, to: FeatureState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid feature state transition: ${from} -> ${to}`);
  }
}

export function isOpenState(state: FeatureState): boolean {
  return state !== "accepted";
}
