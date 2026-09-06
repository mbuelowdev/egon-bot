export function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => {
      const value = Number(part);
      return Number.isFinite(value) ? value : 0;
    });
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) {
      return 1;
    }
    if (l < r) {
      return -1;
    }
  }
  return 0;
}

export function versionIncreased(local: string, origin: string): boolean {
  return compareVersions(local, origin) > 0;
}

export function bumpVersion(current: string | undefined): string {
  if (!current || current.trim() === "") {
    return "0.0.1";
  }
  const trimmed = current.trim();
  if (/^\d+$/.test(trimmed)) {
    return String(Number(trimmed) + 1);
  }
  const parts = trimmed.split(".");
  const last = parts[parts.length - 1] ?? "0";
  const prefix = last.match(/^(\d+)/);
  if (!prefix) {
    return `${trimmed}.1`;
  }
  const bumped = String(Number(prefix[1]) + 1);
  parts[parts.length - 1] = last.replace(/^\d+/, bumped);
  return parts.join(".");
}

export function readDeploymentVersion(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" || typeof parsed.version === "number") {
      return String(parsed.version);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeDeploymentVersion(raw: string, version: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw === "" ? "{}" : raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  parsed.version = version;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
