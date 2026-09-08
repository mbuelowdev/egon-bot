import { posix as posixPath } from "node:path";

export type PlannerToolDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "mcp__egon__ask_discord_users"]);
const WRITE_TOOLS = new Set(["Write", "Edit"]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolFilePath(input: Record<string, unknown>): string {
  return asString(input.file_path) || asString(input.path) || asString(input.filePath);
}

export function plannerSpecPath(slug: string): string {
  return `docs/features/${slug}/SPEC.md`;
}

/** Machine-executable checks live beside the scenarios they drive, in the game repo. */
export function plannerChecksPath(slug: string): string {
  return `egon/checks/${slug}.json`;
}

/** The only two files the planner may write. */
export function plannerWritablePaths(slug: string): string[] {
  return [plannerSpecPath(slug), plannerChecksPath(slug)];
}

export function isPlannerSpecPath(allowed: string, candidate: string): boolean {
  const normalizedAllowed = posixPath.normalize(allowed.replaceAll("\\", "/"));
  const normalized = posixPath.normalize(candidate.replaceAll("\\", "/"));
  return (
    normalized === normalizedAllowed ||
    normalized.endsWith(`/${normalizedAllowed}`) ||
    normalized.endsWith(normalizedAllowed)
  );
}

export function plannerCanUseTool(
  allowedPaths: string | string[],
  toolName: string,
  input: Record<string, unknown>,
): PlannerToolDecision {
  const allowed = Array.isArray(allowedPaths) ? allowedPaths : [allowedPaths];
  const bare = toolName.includes("__") ? (toolName.split("__").at(-1) ?? toolName) : toolName;
  if (READ_TOOLS.has(toolName) || READ_TOOLS.has(bare) || toolName === "mcp__egon__ask_discord_users") {
    return { behavior: "allow" };
  }
  if (WRITE_TOOLS.has(toolName) || WRITE_TOOLS.has(bare)) {
    const path = toolFilePath(input);
    if (path !== "" && allowed.some((candidate) => isPlannerSpecPath(candidate, path))) {
      return { behavior: "allow" };
    }
    return {
      behavior: "deny",
      message: `Planner may only write ${allowed.join(" and ")}`,
    };
  }
  return {
    behavior: "deny",
    message: `Planner cannot use ${toolName}`,
  };
}
