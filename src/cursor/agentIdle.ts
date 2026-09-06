let waitStartedAt: number | undefined;
let accumulatedMs = 0;

export function resetAgentIdle(): void {
  waitStartedAt = undefined;
  accumulatedMs = 0;
}

export function beginAgentIdle(): void {
  if (waitStartedAt === undefined) {
    waitStartedAt = Date.now();
  }
}

export function endAgentIdle(): void {
  if (waitStartedAt === undefined) {
    return;
  }
  accumulatedMs += Math.max(0, Date.now() - waitStartedAt);
  waitStartedAt = undefined;
}

export function isAgentIdle(): boolean {
  return waitStartedAt !== undefined;
}

export function takeAgentIdleMs(): number {
  endAgentIdle();
  const idle = accumulatedMs;
  accumulatedMs = 0;
  return idle;
}

export function activeRunDurationMs(wallMs: number, idleMs: number): number {
  if (!Number.isFinite(wallMs) || wallMs < 0) {
    return 0;
  }
  const idle = Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 0;
  return Math.max(0, Math.round(wallMs - idle));
}
