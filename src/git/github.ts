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

export async function closePullRequest(
  config: Config,
  prNumber: number,
  execGh: ExecGh = defaultExecGh,
): Promise<void> {
  try {
    await execGh(config.gameRepoDir, ["pr", "close", String(prNumber)], ghEnv(config));
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/already closed|is closed|not open/i.test(text)) {
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

export const DEPLOY_WORKFLOW_FILE = "build-and-deploy.yml";

export type DeployWorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  headSha: string;
  url: string;
  displayTitle: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string | null;
};

export type WaitForDeployOptions = {
  headSha?: string;
  createdAfterIso?: string;
  appearTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function parseDeployRun(raw: unknown): DeployWorkflowRun | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const row = raw as {
    databaseId?: unknown;
    status?: unknown;
    conclusion?: unknown;
    headSha?: unknown;
    url?: unknown;
    displayTitle?: unknown;
    createdAt?: unknown;
    startedAt?: unknown;
    updatedAt?: unknown;
  };
  if (typeof row.databaseId !== "number" || typeof row.url !== "string") {
    return undefined;
  }
  return {
    id: row.databaseId,
    status: typeof row.status === "string" ? row.status : "",
    conclusion: typeof row.conclusion === "string" ? row.conclusion : null,
    headSha: typeof row.headSha === "string" ? row.headSha : "",
    url: row.url,
    displayTitle: typeof row.displayTitle === "string" ? row.displayTitle : "",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

function parseDeployRunList(stdout: string): DeployWorkflowRun[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((row) => {
      const run = parseDeployRun(row);
      return run ? [run] : [];
    });
  } catch {
    return [];
  }
}

export function deployRunDurationMinutes(run: DeployWorkflowRun, nowMs = Date.now()): number {
  const start = Date.parse(run.startedAt ?? run.createdAt);
  const end = run.status.toLowerCase() === "completed" ? Date.parse(run.updatedAt ?? "") : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 1;
  }
  return Math.max(1, Math.round((end - start) / 60_000));
}

export async function listDeployWorkflowRuns(
  config: Config,
  execGh: ExecGh = defaultExecGh,
): Promise<DeployWorkflowRun[]> {
  const result = await execGh(
    config.gameRepoDir,
    [
      "run",
      "list",
      "--workflow",
      DEPLOY_WORKFLOW_FILE,
      "--branch",
      config.gameRepoBranch,
      "--limit",
      "10",
      "--json",
      "databaseId,status,conclusion,headSha,url,displayTitle,createdAt,updatedAt",
    ],
    ghEnv(config),
  );
  return parseDeployRunList(result.stdout);
}

export async function viewDeployWorkflowRun(
  config: Config,
  runId: number,
  execGh: ExecGh = defaultExecGh,
): Promise<DeployWorkflowRun> {
  const result = await execGh(
    config.gameRepoDir,
    [
      "run",
      "view",
      String(runId),
      "--json",
      "databaseId,status,conclusion,headSha,url,displayTitle,createdAt,startedAt,updatedAt",
    ],
    ghEnv(config),
  );
  const run = parseDeployRun(JSON.parse(result.stdout) as unknown);
  if (!run) {
    throw new Error(`Unexpected gh run view JSON: ${result.stdout}`);
  }
  return run;
}

function runMatchesWait(run: DeployWorkflowRun, options: WaitForDeployOptions): boolean {
  if (options.headSha !== undefined && options.headSha !== "") {
    return run.headSha === options.headSha;
  }
  if (options.createdAfterIso !== undefined && options.createdAfterIso !== "") {
    const created = Date.parse(run.createdAt);
    const after = Date.parse(options.createdAfterIso);
    return Number.isFinite(created) && Number.isFinite(after) && created >= after;
  }
  return true;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait until the game's Build and deploy workflow for this SHA (or newest run) finishes. */
export async function waitForDeployWorkflow(
  config: Config,
  options: WaitForDeployOptions = {},
  execGh: ExecGh = defaultExecGh,
): Promise<DeployWorkflowRun> {
  const appearTimeoutMs = options.appearTimeoutMs ?? 5 * 60_000;
  const pollMs = options.pollMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + appearTimeoutMs;
  let run: DeployWorkflowRun | undefined;
  for (;;) {
    const runs = await listDeployWorkflowRuns(config, execGh);
    run = runs.find((candidate) => runMatchesWait(candidate, options));
    if (run) {
      break;
    }
    if (pollMs <= 0 || Date.now() >= deadline) {
      throw new Error("Timed out waiting for Build and deploy to start");
    }
    await sleep(pollMs);
  }
  if (!run) {
    throw new Error("Timed out waiting for Build and deploy to start");
  }
  if (run.status.toLowerCase() !== "completed") {
    try {
      await execGh(
        config.gameRepoDir,
        ["run", "watch", String(run.id), "--exit-status"],
        ghEnv(config),
      );
    } catch {
      // --exit-status fails when the workflow failed; still read the conclusion.
    }
    run = await viewDeployWorkflowRun(config, run.id, execGh);
  }
  return run;
}
