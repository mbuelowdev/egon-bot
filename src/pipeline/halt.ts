import { QuestionWaitCancelledError } from "../discord/qaWaiters.js";
import { isStoppablePipelineState } from "../features/state.js";
import type { Feature } from "../features/store.js";

export class PipelineStoppedError extends Error {
  constructor() {
    super("Pipeline stopped");
    this.name = "PipelineStoppedError";
  }
}

export function shouldHaltPipeline(feature: Feature): boolean {
  return !isStoppablePipelineState(feature.state);
}

export function isPipelineStopError(error: unknown): boolean {
  if (error instanceof PipelineStoppedError) {
    return true;
  }
  if (error instanceof QuestionWaitCancelledError) {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}
