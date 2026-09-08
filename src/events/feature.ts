import { featureSlug } from "../features/slug.js";
import { recordEvent, type EventLevel, type EventPhase } from "./log.js";

/**
 * Thin binding from a feature to the event log, so callers do not repeat the slug and
 * identity plumbing. Keeps `log.ts` free of Config/Feature types.
 */
export function recordFeatureEvent(options: {
  dataDir: string;
  feature: { id: number; name: string };
  phase: EventPhase;
  step: string;
  level?: EventLevel;
  detail?: string;
  durationMs?: number;
}): void {
  recordEvent(options.dataDir, {
    featureId: options.feature.id,
    feature: options.feature.name,
    slug: featureSlug(options.feature.name),
    phase: options.phase,
    step: options.step,
    level: options.level ?? "info",
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
  });
}
