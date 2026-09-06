import { createHmac, timingSafeEqual } from "node:crypto";

export type GithubPrEvent =
  | { kind: "merged"; number: number }
  | { kind: "closed"; number: number }
  | { kind: "ignore" };

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

export function parseGithubPullRequestEvent(
  githubEvent: string | undefined,
  payload: unknown,
): GithubPrEvent {
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
