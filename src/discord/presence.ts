import { ActivityType, type Client } from "discord.js";
import type { Config } from "../config.js";
import { fetchRemainingUsagePercent } from "../cursor/usage.js";

let boundClient: Client | undefined;
let boundConfig: Config | undefined;
let inFlight: Promise<void> | undefined;

export function bindPresence(client: Client, config: Config): void {
  boundClient = client;
  boundConfig = config;
}

function activityName(snapshot: Awaited<ReturnType<typeof fetchRemainingUsagePercent>>): string {
  if (snapshot.kind === "percent") {
    return `${String(snapshot.remainingPercent)}% left`;
  }
  return "usage n/a";
}

async function refreshOnce(): Promise<void> {
  const client = boundClient;
  const config = boundConfig;
  if (!client?.user || !config) {
    return;
  }
  try {
    const snapshot = await fetchRemainingUsagePercent({
      cursorApiKey: config.cursorApiKey,
      cursorAdminApiKey: config.cursorAdminApiKey,
      cursorOrganizationId: config.cursorOrganizationId,
    });
    await client.user.setPresence({
      activities: [{ name: activityName(snapshot), type: ActivityType.Watching }],
      status: "online",
    });
  } catch (error) {
    console.error("presence refresh failed", error);
    try {
      await client.user.setPresence({
        activities: [{ name: "usage n/a", type: ActivityType.Watching }],
        status: "online",
      });
    } catch (inner) {
      console.error("presence fallback failed", inner);
    }
  }
}

/** Single-flight: overlapping agent completions share one usage fetch. */
export function refreshPresence(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = refreshOnce().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
