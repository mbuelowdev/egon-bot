import { createHmac, timingSafeEqual } from "node:crypto";

export type GithubWebhookEvent =
  | { kind: "merged"; number: number }
  | { kind: "closed"; number: number }
  | {
      kind: "deployed";
      runId: number;
      headBranch: string;
      commitMessage: string;
      htmlUrl: string;
      durationMinutes: number;
    }
  | {
      kind: "deploy_failed";
      runId: number;
      headBranch: string;
      commitMessage: string;
      htmlUrl: string;
      durationMinutes: number;
    }
  | { kind: "ignore" };

/** @deprecated Use GithubWebhookEvent. */
export type GithubPrEvent = GithubWebhookEvent;

const DEPLOY_WORKFLOW_NAME = "Build and deploy";

export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith("sha256=")) {
    return false;
  }
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`, "utf8");
  const actual = Buffer.from(header, "utf8");
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export function parseGithubWebhookEvent(
  githubEvent: string | undefined,
  payload: unknown,
): GithubWebhookEvent {
  if (githubEvent === "workflow_run") {
    return parseWorkflowRunEvent(payload);
  }
  return parseGithubPullRequestEvent(githubEvent, payload);
}

export function parseGithubPullRequestEvent(
  githubEvent: string | undefined,
  payload: unknown,
): GithubWebhookEvent {
  if (githubEvent !== "pull_request") {
    return { kind: "ignore" };
  }
  if (!payload || typeof payload !== "object") {
    return { kind: "ignore" };
  }
  const body = payload as {
    action?: unknown;
    pull_request?: { number?: unknown; merged?: unknown };
  };
  if (body.action !== "closed" || !body.pull_request || typeof body.pull_request !== "object") {
    return { kind: "ignore" };
  }
  const number = body.pull_request.number;
  if (typeof number !== "number") {
    return { kind: "ignore" };
  }
  if (body.pull_request.merged === true) {
    return { kind: "merged", number };
  }
  return { kind: "closed", number };
}

function durationMinutes(startedAt: string | undefined, endedAt: string | undefined): number {
  if (!startedAt || !endedAt) {
    return 1;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 1;
  }
  return Math.max(1, Math.round((end - start) / 60_000));
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function isDeployWorkflow(name: string, ...paths: string[]): boolean {
  if (name.toLowerCase() === DEPLOY_WORKFLOW_NAME.toLowerCase()) {
    return true;
  }
  return paths.some((path) => path.toLowerCase().endsWith("build-and-deploy.yml"));
}

function parseWorkflowRunEvent(payload: unknown): GithubWebhookEvent {
  if (!payload || typeof payload !== "object") {
    return { kind: "ignore" };
  }
  const body = payload as {
    action?: unknown;
    workflow?: { path?: unknown; name?: unknown };
    workflow_run?: {
      id?: unknown;
      name?: unknown;
      path?: unknown;
      conclusion?: unknown;
      head_branch?: unknown;
      html_url?: unknown;
      display_title?: unknown;
      run_started_at?: unknown;
      updated_at?: unknown;
      head_commit?: { message?: unknown };
    };
  };
  if (body.action !== "completed" || !body.workflow_run || typeof body.workflow_run !== "object") {
    return { kind: "ignore" };
  }
  const run = body.workflow_run;
  const workflowPath = typeof body.workflow?.path === "string" ? body.workflow.path : "";
  const workflowName =
    (typeof run.name === "string" && run.name) ||
    (typeof body.workflow?.name === "string" ? body.workflow.name : "");
  const runPath = typeof run.path === "string" ? run.path : "";
  if (!isDeployWorkflow(workflowName, workflowPath, runPath)) {
    return { kind: "ignore" };
  }
  const runId = parsePositiveInt(run.id);
  if (runId === undefined || typeof run.html_url !== "string") {
    console.log("ignoring Build and deploy workflow_run with missing id or html_url");
    return { kind: "ignore" };
  }
  const headBranch = typeof run.head_branch === "string" ? run.head_branch : "";
  const commitMessage =
    (typeof run.head_commit?.message === "string" && run.head_commit.message) ||
    (typeof run.display_title === "string" ? run.display_title : "");
  const duration = durationMinutes(
    typeof run.run_started_at === "string" ? run.run_started_at : undefined,
    typeof run.updated_at === "string" ? run.updated_at : undefined,
  );
  if (run.conclusion === "success") {
    return {
      kind: "deployed",
      runId,
      headBranch,
      commitMessage,
      htmlUrl: run.html_url,
      durationMinutes: duration,
    };
  }
  if (run.conclusion === "failure") {
    return {
      kind: "deploy_failed",
      runId,
      headBranch,
      commitMessage,
      htmlUrl: run.html_url,
      durationMinutes: duration,
    };
  }
  return { kind: "ignore" };
}
