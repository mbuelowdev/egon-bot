import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import { ghEnv } from "./github.js";

const execFileAsync = promisify(execFile);

export async function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8", env });
  return result.stdout.trim();
}

export async function createFeatureBranch(config: Config, branch: string): Promise<string> {
  const env = ghEnv(config);
  await git(config.gameRepoDir, ["fetch", "origin"], env);
  await git(config.gameRepoDir, ["checkout", config.gameRepoBranch], env);
  await git(config.gameRepoDir, ["reset", "--hard", `origin/${config.gameRepoBranch}`], env);
  await git(config.gameRepoDir, ["checkout", "-B", branch], env);
  return branch;
}

export async function commitAndPush(config: Config, message: string): Promise<boolean> {
  const env = ghEnv(config);
  await git(config.gameRepoDir, ["add", "-A"], env);
  const status = await git(config.gameRepoDir, ["status", "--porcelain"], env);
  if (status === "") {
    return false;
  }
  await execFileAsync(
    "git",
    [
      "-C",
      config.gameRepoDir,
      "-c",
      `user.name=${config.gitAuthorName}`,
      "-c",
      `user.email=${config.gitAuthorEmail}`,
      "commit",
      "-m",
      message,
    ],
    { env, encoding: "utf8" },
  );
  await git(config.gameRepoDir, ["push", "-u", "origin", "HEAD"], env);
  return true;
}

export async function checkoutDefaultBranch(config: Config): Promise<void> {
  const env = ghEnv(config);
  await git(config.gameRepoDir, ["fetch", "origin"], env);
  await git(config.gameRepoDir, ["checkout", config.gameRepoBranch], env);
  await git(config.gameRepoDir, ["reset", "--hard", `origin/${config.gameRepoBranch}`], env);
}

export async function discardUncommittedWork(config: Config): Promise<void> {
  const env = ghEnv(config);
  await git(config.gameRepoDir, ["reset", "--hard", "HEAD"], env);
  await git(config.gameRepoDir, ["clean", "-fd"], env);
}

/** Cap for a fresh-implementer seed so a long feature branch cannot blow the prompt. */
export const FEATURE_DIFF_MAX_CHARS = 50_000;

export function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n(truncated; ${String(text.length - maxChars)} more characters)`;
}

/**
 * Feature-branch changes vs the default branch, plus any uncommitted work.
 * Empty or unreadable diffs become a short placeholder so callers can still seed a prompt.
 */
export async function featureBranchDiff(config: Config, maxChars = FEATURE_DIFF_MAX_CHARS): Promise<string> {
  const env = ghEnv(config);
  const range = `origin/${config.gameRepoBranch}...HEAD`;
  let committed = "";
  let uncommitted = "";
  try {
    committed = await git(config.gameRepoDir, ["diff", range], env);
  } catch {
    committed = "";
  }
  try {
    uncommitted = await git(config.gameRepoDir, ["diff", "HEAD"], env);
  } catch {
    uncommitted = "";
  }
  const parts: string[] = [];
  if (committed.trim() !== "") {
    parts.push(committed.trimEnd());
  }
  if (uncommitted.trim() !== "") {
    parts.push(`# Uncommitted\n${uncommitted.trimEnd()}`);
  }
  if (parts.length === 0) {
    return "(no changes vs default branch)";
  }
  return truncateForPrompt(parts.join("\n\n"), maxChars);
}
