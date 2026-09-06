function trimDecimal(value: string): string {
  return value.replace(/\.0$/, "");
}

/** Compact count: 1500 → 1.5k, 1_200_000 → 1.2M. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "0";
  }
  const n = Math.round(tokens);
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    const value = n / 1000;
    return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}k`;
  }
  if (n < 1_000_000_000) {
    const value = n / 1_000_000;
    return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}M`;
  }
  const value = n / 1_000_000_000;
  return `${trimDecimal(value.toFixed(value >= 10 ? 0 : 1))}B`;
}

/** Compact wall-clock: 125000 → 2m 5s, 3750000 → 1h 2m. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0s";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${String(totalMinutes)}m` : `${String(totalMinutes)}m ${String(seconds)}s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0 ? `${String(totalHours)}h` : `${String(totalHours)}h ${String(minutes)}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours)}h`;
}
