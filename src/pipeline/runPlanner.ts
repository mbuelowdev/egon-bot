import { formatPlannerFallback } from "../format.js";
import type { Config } from "../config.js";
import { inspectFeatureSpec } from "../features/artifacts.js";
import {
  specFixFollowUp,
  specGateFailureMessage,
  type SpecValidation,
} from "../features/specValidate.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { runClaudePlanner } from "../claude/planner.js";
import { ClaudeUsageLimitError, shouldFallbackToCursorPlanner } from "../claude/usageLimit.js";
import { continueDiscordQuestionRound, type AskUsersDeps } from "../cursor/askQuestions.js";
import { runCursorPlanner } from "../cursor/planner.js";
import type { PlanMarker } from "../cursor/planMarker.js";

export type PlannerRunResult = {
  marker: PlanMarker | null;
  text?: string;
  agentId: string;
};

async function resolveFollowUp(
  deps: AskUsersDeps,
  resume: boolean,
  feature: Feature,
): Promise<string | undefined> {
  if (!resume) {
    return undefined;
  }
  const fromBatch = await continueDiscordQuestionRound(deps);
  if (fromBatch !== undefined) {
    return fromBatch;
  }
  if (feature.plannerAgentId) {
    return "Continue the plan. If the spec is done, end with PLAN_COMPLETE or PLAN_BLOCKED.";
  }
  return undefined;
}

export type PlannerRunners = {
  claude: typeof runClaudePlanner;
  cursor: typeof runCursorPlanner;
};

type PlannerAttempt = {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  deps: AskUsersDeps;
  notify: (content: string) => Promise<void>;
  catalogUrl?: string;
  runners?: PlannerRunners;
  followUp?: string;
};

async function invokePlanner(options: PlannerAttempt): Promise<PlannerRunResult> {
  const runClaude = options.runners?.claude ?? runClaudePlanner;
  const runCursor = options.runners?.cursor ?? runCursorPlanner;
  const latest = options.store.getFeatureById(options.feature.id) ?? options.feature;

  if (latest.plannerBackend === "cursor") {
    return runCursor({
      config: options.config,
      store: options.store,
      feature: latest,
      deps: options.deps,
      followUp: options.followUp,
    });
  }

  try {
    return await runClaude({
      config: options.config,
      store: options.store,
      feature: latest,
      deps: options.deps,
      followUp: options.followUp,
    });
  } catch (error) {
    const usage = error instanceof ClaudeUsageLimitError;
    const started = error instanceof ClaudeUsageLimitError ? error.started : false;
    if (
      !shouldFallbackToCursorPlanner({
        plannerBackend: latest.plannerBackend,
        usageLimit: usage,
        startedThisQuery: started,
      })
    ) {
      throw error;
    }
    await options.notify(formatPlannerFallback(latest.name, options.catalogUrl));
    options.store.setPlannerAgentId(latest.id, null);
    options.store.setPlannerBackend(latest.id, "cursor");
    const fresh = options.store.getFeatureById(latest.id) ?? latest;
    return runCursor({
      config: options.config,
      store: options.store,
      feature: { ...fresh, plannerAgentId: null },
      deps: options.deps,
      answersAppendix: options.followUp,
    });
  }
}

export async function runFeaturePlanner(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  deps: AskUsersDeps;
  resume: boolean;
  notify: (content: string) => Promise<void>;
  catalogUrl?: string;
  runners?: PlannerRunners;
  inspectSpec?: (config: Config, feature: Feature) => SpecValidation;
}): Promise<PlannerRunResult> {
  const inspect = options.inspectSpec ?? inspectFeatureSpec;
  const followUp = await resolveFollowUp(options.deps, options.resume, options.feature);
  const result = await invokePlanner({ ...options, followUp });
  if (result.marker !== "PLAN_COMPLETE") {
    return result;
  }
  const latest = options.store.getFeatureById(options.feature.id) ?? options.feature;
  const firstCheck = inspect(options.config, latest);
  if (firstCheck.ok) {
    return result;
  }
  if (!latest.plannerAgentId) {
    return {
      marker: "PLAN_BLOCKED",
      text: specGateFailureMessage(firstCheck.problems),
      agentId: result.agentId,
    };
  }
  const repaired = await invokePlanner({
    ...options,
    feature: latest,
    followUp: specFixFollowUp(firstCheck.problems),
  });
  if (repaired.marker !== "PLAN_COMPLETE") {
    return repaired;
  }
  const after = options.store.getFeatureById(options.feature.id) ?? latest;
  const secondCheck = inspect(options.config, after);
  if (secondCheck.ok) {
    return repaired;
  }
  return {
    marker: "PLAN_BLOCKED",
    text: specGateFailureMessage(secondCheck.problems),
    agentId: repaired.agentId,
  };
}
