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
  specPath: string,
  toolName: string,
  input: Record<string, unknown>,
): PlannerToolDecision {
  const bare = toolName.includes("__") ? (toolName.split("__").at(-1) ?? toolName) : toolName;
  if (READ_TOOLS.has(toolName) || READ_TOOLS.has(bare) || toolName === "mcp__egon__ask_discord_users") {
    return { behavior: "allow" };
  }
  if (WRITE_TOOLS.has(toolName) || WRITE_TOOLS.has(bare)) {
    const path = toolFilePath(input);
    if (path !== "" && isPlannerSpecPath(specPath, path)) {
      return { behavior: "allow" };
    }
    return {
      behavior: "deny",
      message: `Planner may only write ${specPath}`,
    };
  }
  return {
    behavior: "deny",
    message: `Planner cannot use ${toolName}`,
  };
}
