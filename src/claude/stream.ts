function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contentBlocks(message: unknown): Record<string, unknown>[] {
  const rec = asRecord(message);
  const inner = asRecord(rec?.message) ?? rec;
  const content = inner?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.map((block) => asRecord(block)).filter((block): block is Record<string, unknown> => Boolean(block));
}

/** Map a Claude Agent SDK stream message onto the Cursor-shaped events our log/watch expect. */
export function claudeMessageToWatchEvents(message: unknown): unknown[] {
  const rec = asRecord(message);
  if (!rec || typeof rec.type !== "string") {
    return [];
  }
  if (rec.type === "system") {
    const subtype = asString(rec.subtype);
    if (subtype === "init") {
      return [{ type: "status", status: "init" }];
    }
    return [{ type: "status", status: subtype || "system" }];
  }
  if (rec.type === "result") {
    return [{ type: "status", status: asString(rec.subtype) || "result" }];
  }
  if (rec.type === "assistant") {
    const events: unknown[] = [];
    for (const block of contentBlocks(rec)) {
      const kind = asString(block.type);
      if (kind === "text") {
        const text = asString(block.text);
        if (text !== "") {
          events.push({ type: "assistant", message: { text } });
        }
      } else if (kind === "thinking") {
        const text = asString(block.thinking) || asString(block.text);
        if (text !== "") {
          events.push({ type: "thinking", text });
        }
      } else if (kind === "tool_use") {
        events.push({
          type: "tool_call",
          name: asString(block.name) || "tool",
          call_id: asString(block.id) || undefined,
          status: "running",
          args: block.input,
        });
      }
    }
    return events;
  }
  if (rec.type === "user") {
    const events: unknown[] = [];
    for (const block of contentBlocks(rec)) {
      if (asString(block.type) !== "tool_result") {
        continue;
      }
      events.push({
        type: "tool_call",
        name: asString(block.name) || "tool",
        call_id: asString(block.tool_use_id) || undefined,
        status: "completed",
        result: block.content ?? block,
      });
    }
    return events;
  }
  if (rec.type === "stream_event") {
    return [{ type: "thinking", text: " " }];
  }
  return [{ type: rec.type }];
}

export function claudeSessionId(message: unknown): string | undefined {
  const rec = asRecord(message);
  const id = rec && typeof rec.session_id === "string" ? rec.session_id : "";
  return id !== "" ? id : undefined;
}

export function claudeAssistantError(message: unknown): string | undefined {
  const rec = asRecord(message);
  return rec && rec.type === "assistant" && typeof rec.error === "string" ? rec.error : undefined;
}

export function claudeResultText(message: unknown): string | undefined {
  const rec = asRecord(message);
  if (!rec || rec.type !== "result") {
    return undefined;
  }
  return typeof rec.result === "string" ? rec.result : undefined;
}

export function claudeResultCostUsd(message: unknown): number | undefined {
  const rec = asRecord(message);
  if (!rec || rec.type !== "result") {
    return undefined;
  }
  const n = rec.total_cost_usd;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function claudeResultIsError(message: unknown): boolean {
  const rec = asRecord(message);
  if (!rec || rec.type !== "result") {
    return false;
  }
  if (rec.is_error === true) {
    return true;
  }
  const subtype = asString(rec.subtype);
  return subtype.startsWith("error");
}
