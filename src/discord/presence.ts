import { ActivityType, type Client } from "discord.js";
import { formatTokenCount } from "../format.js";
import type { FeatureStore } from "../features/store.js";

let boundClient: Client | undefined;
let boundStore: FeatureStore | undefined;
let inFlight: Promise<void> | undefined;

export function bindPresence(client: Client, store: FeatureStore): void {
  boundClient = client;
  boundStore = store;
}

export function lifetimeTokensStatus(tokens: number): string {
  return `${formatTokenCount(tokens)} lifetime tokens used`;
}

export function recordRunTokens(
  runId: string,
  agentId: string,
  totalTokens: number | undefined,
  durationMs?: number,
): void {
  boundStore?.recordAgentRunTokens(runId, agentId, totalTokens, durationMs);
}

async function refreshOnce(): Promise<void> {
  const client = boundClient;
  const store = boundStore;
  if (!client?.user || !store) {
    return;
  }
  const status = lifetimeTokensStatus(store.totalAgentTokens());
  try {
    await client.user.setPresence({
      activities: [{ name: status, type: ActivityType.Custom, state: status }],
      status: "online",
    });
  } catch (error) {
    console.error("presence refresh failed", error);
  }
}

/** Single-flight: overlapping agent completions share one presence update. */
export function refreshPresence(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = refreshOnce().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
