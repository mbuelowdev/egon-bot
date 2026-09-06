import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";
import type { Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "../features/slug.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { mimeFor } from "../godot/headers.js";
import { featurePage, indexPage } from "./page.js";
import { parseGithubPullRequestEvent, verifyGithubSignature, type GithubPrEvent } from "./webhook.js";

let server: Server | undefined;

function plannedAndImplemented(
  store: FeatureStore,
  config: Config,
): { planned: Feature[]; implemented: Feature[] } {
  const planned: Feature[] = [];
  const implemented: Feature[] = [];
  for (const feature of store.listAllFeatures()) {
    const specPath = featurePaths(config.dataDir, feature.id).specPath;
    if (feature.state === "accepted") {
      implemented.push(feature);
      continue;
    }
    if (existsSync(specPath)) {
      planned.push(feature);
    }
  }
  return { planned, implemented };
}

export function findFeatureBySlug(store: FeatureStore, slug: string): Feature | undefined {
  return store.listAllFeatures().find((feature) => featureSlug(feature.name) === slug);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendFile(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  res.writeHead(200, { "Content-Type": mimeFor(filePath) });
  createReadStream(filePath).pipe(res);
}

export async function stopCatalogServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) {
    return;
  }
  await new Promise<void>((resolveClose) => {
    current.close(() => resolveClose());
  });
}

export async function serveCatalog(options: {
  store: FeatureStore;
  config: Config;
  onGithubEvent: (event: GithubPrEvent) => Promise<void>;
}): Promise<Server> {
  await stopCatalogServer();
  const httpServer = createServer((req, res) => {
    void handleRequest(req, res, options).catch((error: unknown) => {
      console.error("catalog request failed", error);
      if (!res.headersSent) {
        send(res, 500, "Internal error", "text/plain; charset=utf-8");
      }
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.config.featuresHttpPort, "0.0.0.0", () => resolveListen());
  });
  server = httpServer;
  console.log(`Serving feature catalog on http://0.0.0.0:${String(options.config.featuresHttpPort)}`);
  return httpServer;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: { store: FeatureStore; config: Config; onGithubEvent: (event: GithubPrEvent) => Promise<void> },
): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  if (req.method === "POST" && urlPath === "/github/webhook") {
    const raw = await readBody(req);
    const signature = req.headers["x-hub-signature-256"];
    const header = Array.isArray(signature) ? signature[0] : signature;
    if (!verifyGithubSignature(options.config.githubWebhookSecret, raw, header)) {
      send(res, 401, "Invalid signature", "text/plain; charset=utf-8");
      return;
    }
    const githubEvent = req.headers["x-github-event"];
    const eventName = Array.isArray(githubEvent) ? githubEvent[0] : githubEvent;
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      send(res, 400, "Invalid JSON", "text/plain; charset=utf-8");
      return;
    }
    const event = parseGithubPullRequestEvent(eventName, payload);
    if (event.kind !== "ignore") {
      await options.onGithubEvent(event);
    }
    send(res, 204, "", "text/plain; charset=utf-8");
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  if (urlPath === "/") {
    const { planned, implemented } = plannedAndImplemented(options.store, options.config);
    send(res, 200, indexPage(planned, implemented), "text/html; charset=utf-8");
    return;
  }

  const detail = urlPath.match(/^\/features\/([^/]+)\/?$/);
  if (detail && detail[1]) {
    const feature = findFeatureBySlug(options.store, detail[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, featurePage(options.config, feature), "text/html; charset=utf-8");
    return;
  }

  const shot = urlPath.match(/^\/features\/([^/]+)\/screenshots\/([^/]+)$/);
  if (shot && shot[1] && shot[2]) {
    const feature = findFeatureBySlug(options.store, shot[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const fileName = basename(shot[2]);
    const dir = resolve(featurePaths(options.config.dataDir, feature.id).screenshotsDir);
    const filePath = resolve(join(dir, fileName));
    if (filePath !== dir && !filePath.startsWith(`${dir}/`)) {
      send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }
    sendFile(res, filePath);
    return;
  }

  send(res, 404, "Not found", "text/plain; charset=utf-8");
}
