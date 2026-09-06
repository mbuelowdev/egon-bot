export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type UsageSnapshot =
  | { kind: "percent"; remainingPercent: number }
  | { kind: "unavailable" };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function remainingPercent(remaining: number, limit: number): number | undefined {
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return Math.round((Math.max(0, remaining) / limit) * 100);
}

export function parsePooledUsage(body: unknown): number | undefined {
  const pool = asRecord(asRecord(body)?.pool) ?? asRecord(body);
  if (!pool) {
    return undefined;
  }
  const remaining = asNumber(pool.remainingCents);
  const limit = asNumber(pool.limitCents);
  if (remaining === undefined || limit === undefined) {
    return undefined;
  }
  return remainingPercent(remaining, limit);
}

export function parsePlanUsage(body: unknown): number | undefined {
  const planUsage = asRecord(asRecord(body)?.planUsage);
  if (!planUsage) {
    return undefined;
  }
  const limit = asNumber(planUsage.limit);
  if (limit === undefined) {
    return undefined;
  }
  const remaining =
    asNumber(planUsage.remaining) ??
    (asNumber(planUsage.includedSpend) !== undefined
      ? limit - (asNumber(planUsage.includedSpend) ?? 0)
      : asNumber(planUsage.totalSpend) !== undefined
        ? limit - (asNumber(planUsage.totalSpend) ?? 0)
        : undefined);
  if (remaining === undefined) {
    return undefined;
  }
  return remainingPercent(remaining, limit);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as unknown;
}

async function fetchAdminPooledPercent(
  adminApiKey: string,
  organizationId: string | undefined,
  fetchImpl: FetchLike,
): Promise<number> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${adminApiKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
  };
  const body = organizationId ? { organizationId } : {};
  const payload = await readJson(
    await fetchImpl("https://api.cursor.com/organizations/pooled-usage", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const percent = parsePooledUsage(payload);
  if (percent === undefined) {
    throw new Error("Admin pooled-usage response missing remainingCents/limitCents");
  }
  return percent;
}

async function fetchDashboardPlanPercent(
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<number> {
  const payload = await readJson(
    await fetchImpl("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
    }),
  );
  const percent = parsePlanUsage(payload);
  if (percent === undefined) {
    throw new Error("Dashboard usage response missing planUsage remaining/limit");
  }
  return percent;
}

export async function fetchRemainingUsagePercent(
  options: {
    cursorApiKey: string;
    cursorAdminApiKey?: string;
    cursorOrganizationId?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<UsageSnapshot> {
  try {
    if (options.cursorAdminApiKey) {
      try {
        const remaining = await fetchAdminPooledPercent(
          options.cursorAdminApiKey,
          options.cursorOrganizationId,
          fetchImpl,
        );
        return { kind: "percent", remainingPercent: remaining };
      } catch (error) {
        console.error("Admin pooled-usage fetch failed", error);
      }
    }
    const remaining = await fetchDashboardPlanPercent(options.cursorApiKey, fetchImpl);
    return { kind: "percent", remainingPercent: remaining };
  } catch (error) {
    console.error("Cursor usage fetch failed", error);
    return { kind: "unavailable" };
  }
}
