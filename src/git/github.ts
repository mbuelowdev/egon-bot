import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";

const execFileAsync = promisify(execFile);

export type GhResult = {
  stdout: string;
  stderr: string;
};

export type ExecGh = (cwd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<GhResult>;

export type PullRequestRef = {
  number: number;
  url: string;
};

export type PullRequestView = {
  number: number;
  url: string;
  state: string;
  mergedAt: string | null;
  closedAt: string | null;
  isDraft: boolean;
};

export function ghEnv(config: Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GITHUB_TOKEN: config.githubToken,
    GH_TOKEN: config.githubToken,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export async function defaultExecGh(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<GhResult> {
  try {
    const result = await execFileAsync("gh", args, { cwd, encoding: "utf8", env });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const stdout = (err.stdout ?? "").trim();
    const stderr = (err.stderr ?? err.message ?? "").trim();
    const wrapped = new Error(stderr || stdout || "gh failed");
    (wrapped as Error & { stdout: string; stderr: string }).stdout = stdout;
    (wrapped as Error & { stdout: string; stderr: string }).stderr = stderr;
    throw wrapped;
  }
}

function parsePrUrl(text: string): PullRequestRef | undefined {
  const match = text.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
  if (!match || !match[1] || !match[0]) {
    return undefined;
  }
  return { number: Number(match[1]), url: match[0] };
}

function parseViewJson(raw: string): PullRequestView {
  const parsed = JSON.parse(raw) as {
    number?: unknown;
    url?: unknown;
    state?: unknown;
    mergedAt?: unknown;
    closedAt?: unknown;
    isDraft?: unknown;
  };
  if (typeof parsed.number !== "number" || typeof parsed.url !== "string") {
    throw new Error(`Unexpected gh pr view JSON: ${raw}`);
  }
  return {
    number: parsed.number,
    url: parsed.url,
    state: typeof parsed.state === "string" ? parsed.state : "",
    mergedAt: typeof parsed.mergedAt === "string" ? parsed.mergedAt : null,
    closedAt: typeof parsed.closedAt === "string" ? parsed.closedAt : null,
    isDraft: parsed.isDraft === true,
  };
}

export async function viewPullRequest(
  config: Config,
  selector: number | "current",
  execGh: ExecGh = defaultExecGh,
): Promise<PullRequestView> {
  const target = selector === "current" ? [] : [String(selector)];
  const result = await execGh(
    config.gameRepoDir,
    ["pr", "view", ...target, "--json", "number,url,state,mergedAt,closedAt,isDraft"],
    ghEnv(config),
  );
  return parseViewJson(result.stdout);
}

export async function createDraftPr(
  config: Config,
  options: { title: string; body: string },
  execGh: ExecGh = defaultExecGh,
): Promise<PullRequestRef> {
  try {
    const created = await execGh(
      config.gameRepoDir,
      [
        "pr",
        "create",
        "--draft",
        "--base",
        config.gameRepoBranch,
        "--title",
        options.title,
        "--body",
        options.body,
      ],
      ghEnv(config),
    );
    const fromStdout = parsePrUrl(created.stdout) ?? parsePrUrl(created.stderr);
    if (fromStdout) {
      return fromStdout;
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(text)) {
      throw error;
    }
  }
  const existing = await viewPullRequest(config, "current", execGh);
  return { number: existing.number, url: existing.url };
}

export async function markPrReady(
  config: Config,
  prNumber: number,
  execGh: ExecGh = defaultExecGh,
): Promise<void> {
  try {
    await execGh(config.gameRepoDir, ["pr", "ready", String(prNumber)], ghEnv(config));
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/already marked as ready|not a draft/i.test(text)) {
      return;
    }
    throw error;
  }
}

export function isMergedView(view: PullRequestView): boolean {
  return view.state.toUpperCase() === "MERGED" || view.mergedAt !== null;
}

export function isClosedUnmergedView(view: PullRequestView): boolean {
  return view.state.toUpperCase() === "CLOSED" && !isMergedView(view);
}
