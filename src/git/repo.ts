import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import { defaultExecGh, ghEnv, type ExecGh } from "./github.js";

const execFileAsync = promisify(execFile);

export type ExecGit = (args: string[], env: NodeJS.ProcessEnv) => Promise<void>;

export async function defaultExecGit(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync("git", args, { env, encoding: "utf8" });
}

export function applyGithubTokenEnv(config: Config): void {
  process.env.GITHUB_TOKEN = config.githubToken;
  process.env.GH_TOKEN = config.githubToken;
  process.env.GIT_TERMINAL_PROMPT = "0";
}

export async function setupGitHubGitAuth(
  config: Config,
  execGh: ExecGh = defaultExecGh,
): Promise<void> {
  applyGithubTokenEnv(config);
  mkdirSync(config.dataDir, { recursive: true });
  await execGh(config.dataDir, ["auth", "setup-git"], ghEnv(config));
}

export async function syncGameRepo(
  config: Config,
  execGh: ExecGh = defaultExecGh,
  execGit: ExecGit = defaultExecGit,
): Promise<void> {
  const dir = config.gameRepoDir;
  const gitDir = join(dir, ".git");
  const env = ghEnv(config);
  if (!existsSync(gitDir)) {
    if (existsSync(dir) && readdirSync(dir).length > 0) {
      throw new Error(
        `GAME_REPO_DIR ${dir} exists and is not a git checkout; refusing to clone into it`,
      );
    }
    mkdirSync(dirname(dir), { recursive: true });
    console.log(`Cloning game repo into ${dir}`);
    await execGh(
      dirname(dir),
      ["repo", "clone", config.gameRepoHttpsUrl, dir, "--", "--branch", config.gameRepoBranch],
      env,
    );
    return;
  }
  console.log(`Fetching game repo in ${dir}`);
  await execGit(["-C", dir, "remote", "set-url", "origin", config.gameRepoHttpsUrl], env);
  await execGit(["-C", dir, "fetch", "origin"], env);
}
