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

export const STOPPABLE_PIPELINE_STATES = [
  "planning",
  "implementing",
  "exporting",
  "testing",
  "fixing",
  "pivoting",
] as const satisfies readonly FeatureState[];

const TRANSITIONS: Record<FeatureState, readonly FeatureState[]> = {
  collecting: ["planning"],
  planning: ["implementing", "accepted", "rejected", "collecting", "awaiting_review"],
  implementing: ["exporting", "accepted", "rejected", "awaiting_review", "collecting"],
  exporting: ["testing", "fixing", "accepted", "rejected", "awaiting_review", "collecting"],
  testing: ["fixing", "awaiting_review", "accepted", "rejected", "collecting"],
  fixing: ["exporting", "accepted", "rejected", "awaiting_review", "collecting"],
  awaiting_review: ["accepted", "rejected", "pivoting"],
  rejected: ["pivoting", "accepted"],
  pivoting: ["implementing", "accepted", "rejected", "awaiting_review", "collecting"],
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

export function isStoppablePipelineState(state: FeatureState): boolean {
  return (STOPPABLE_PIPELINE_STATES as readonly FeatureState[]).includes(state);
}
