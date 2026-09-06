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
