export class ClaudeUsageLimitError extends Error {
  readonly started: boolean;

  constructor(message: string, started: boolean) {
    super(message);
    this.name = "ClaudeUsageLimitError";
    this.started = started;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function collectText(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    into.push(String(value));
    return;
  }
  const rec = asRecord(value);
  if (!rec) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectText(item, into);
      }
    }
    return;
  }
  for (const [key, nested] of Object.entries(rec)) {
    if (key === "retry-after" || key === "retryAfter" || key === "retry_after") {
      continue;
    }
    collectText(nested, into);
  }
}

const SPEND_LIMIT = /enforced_spend_limit_reached|you have reached your (specified )?(api |workspace )?usage limits|monthly api usage threshold|credit balance is too low|insufficient[_\s-]?credits/i;

export function looksLikeClaudeUsageLimit(error: unknown): boolean {
  const rec = asRecord(error);
  const assistantError =
    rec && typeof rec.assistantError === "string"
      ? rec.assistantError
      : rec && typeof rec.error === "string"
        ? rec.error
        : undefined;
  if (assistantError === "billing_error") {
    return true;
  }
  if (assistantError === "overloaded" || assistantError === "authentication_failed") {
    return false;
  }
  const rateLimitStatus =
    rec && typeof rec.rateLimitStatus === "string"
      ? rec.rateLimitStatus
      : asRecord(rec?.rate_limit_info) && typeof asRecord(rec?.rate_limit_info)?.status === "string"
        ? String(asRecord(rec?.rate_limit_info)?.status)
        : undefined;
  if (rateLimitStatus === "rejected") {
    return true;
  }

  const status =
    rec && typeof rec.status === "number"
      ? rec.status
      : rec && typeof rec.statusCode === "number"
        ? rec.statusCode
        : rec && typeof rec.api_error_status === "number"
          ? rec.api_error_status
          : undefined;
  const type =
    rec && typeof rec.type === "string"
      ? rec.type
      : asRecord(rec?.error) && typeof asRecord(rec?.error)?.type === "string"
        ? String(asRecord(rec?.error)?.type)
        : undefined;

  const blobs: string[] = [];
  if (error instanceof Error) {
    blobs.push(error.message, error.name);
  }
  collectText(error, blobs);
  const text = blobs.join("\n");

  if (status === 402 || type === "billing_error" || assistantError === "billing_error") {
    return true;
  }
  if (SPEND_LIMIT.test(text)) {
    return true;
  }
  if (status === 429 || type === "rate_limit_error" || /API Error:\s*429/i.test(text)) {
    return SPEND_LIMIT.test(text);
  }
  return false;
}

export function isClaudeUsageLimitError(error: unknown): error is ClaudeUsageLimitError {
  return error instanceof ClaudeUsageLimitError;
}

export function shouldFallbackToCursorPlanner(input: {
  plannerBackend: "claude" | "cursor" | null;
  usageLimit: boolean;
  startedThisQuery: boolean;
}): boolean {
  if (!input.usageLimit) {
    return false;
  }
  if (input.plannerBackend === "cursor") {
    return false;
  }
  return !input.startedThisQuery;
}
