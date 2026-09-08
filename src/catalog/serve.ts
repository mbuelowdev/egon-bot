import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubRepoWebUrl, type Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "../features/slug.js";
import { UserFacingError, type Feature, type FeatureStore } from "../features/store.js";
import { closePullRequest } from "../git/github.js";
import { mimeFor } from "../godot/headers.js";
import { loadFeatureAgentLog } from "../cursor/agentLog.js";
import { groupEvents, readEvents } from "../events/log.js";
import { eventsPage, renderEventFeatures } from "./events.js";
import { featurePage, indexPage } from "./page.js";
import { parseGithubWebhookEvent, verifyGithubSignature, type GithubWebhookEvent } from "./webhook.js";
import { handleAssetRequest } from "../assets/routes.js";

/** Shared catalog password for deleting features from the catalog. */
export const CATALOG_DELETE_PASSWORD = "ente123";

const catalogDir = dirname(fileURLToPath(import.meta.url));
const FAVICON_PATHS: Record<string, string> = {
  "/favicon.ico": "favicon.ico",
  "/favicon.png": "favicon.png",
  "/apple-touch-icon.png": "apple-touch-icon.png",
};

export type CatalogServerOptions = {
  store: FeatureStore;
  config: Config;
  onGithubEvent: (event: GithubWebhookEvent) => Promise<void>;
  /** Sync merged/closed PRs from GitHub before rendering catalog pages. */
  syncGithub?: () => Promise<void>;
  beforeDelete?: (feature: Feature) => Promise<void>;
  closePullRequest?: (prNumber: number) => Promise<void>;
  retry?: () => Promise<string>;
};

let server: Server | undefined;

function catalogSections(store: FeatureStore): {
  collecting: Feature[];
  planned: Feature[];
  implemented: Feature[];
} {
  const collecting: Feature[] = [];
  const planned: Feature[] = [];
  const implemented: Feature[] = [];
  for (const feature of store.listAllFeatures()) {
    if (feature.state === "accepted") {
      implemented.push(feature);
      continue;
    }
    if (feature.state === "collecting") {
      collecting.push(feature);
      continue;
    }
    planned.push(feature);
  }
  return { collecting, planned, implemented };
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
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (contentType.startsWith("text/html")) {
    headers["Cache-Control"] = "no-store";
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function catalogPasswordOk(password: string): boolean {
  const expected = Buffer.from(CATALOG_DELETE_PASSWORD);
  const given = Buffer.from(password);
  if (given.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(given, expected);
}

export function parsePassword(raw: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && "password" in parsed) {
      const password = (parsed as { password: unknown }).password;
      return typeof password === "string" ? password : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function syncGithub(options: CatalogServerOptions): Promise<void> {
  if (!options.syncGithub) {
    return;
  }
  try {
    await options.syncGithub();
  } catch (error) {
    console.error("github catch-up before catalog failed", error);
  }
}

/** Weak-free content ETag so an unchanged poll costs a 304 and no body. */
export function eventsFragmentEtag(html: string): string {
  return `"${createHash("sha1").update(html).digest("hex")}"`;
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

export async function serveCatalog(options: CatalogServerOptions): Promise<Server> {
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
  options: CatalogServerOptions,
): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  if (
    await handleAssetRequest(req, res, urlPath, {
      dataDir: options.config.dataDir,
      passwordOk: catalogPasswordOk,
      parseJsonPassword: parsePassword,
    })
  ) {
    return;
  }
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
    const event = parseGithubWebhookEvent(eventName, payload);
    if (event.kind !== "ignore") {
      await options.onGithubEvent(event);
    }
    send(res, 204, "", "text/plain; charset=utf-8");
    return;
  }

  const deleteMatch = urlPath.match(/^\/features\/([^/]+)\/delete\/?$/);
  if (req.method === "POST" && deleteMatch && deleteMatch[1]) {
    const feature = findFeatureBySlug(options.store, deleteMatch[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const password = parsePassword(await readBody(req));
    if (password === undefined || !catalogPasswordOk(password)) {
      send(res, 403, "Wrong password", "text/plain; charset=utf-8");
      return;
    }
    if (options.beforeDelete) {
      await options.beforeDelete(feature);
    }
    const prNumber = feature.githubPrNumber;
    try {
      options.store.deleteFeature(feature.id);
    } catch (error) {
      if (error instanceof UserFacingError) {
        send(res, 409, error.message, "text/plain; charset=utf-8");
        return;
      }
      throw error;
    }
    rmSync(featurePaths(options.config.dataDir, feature.id).root, { recursive: true, force: true });
    if (prNumber !== null && feature.state !== "rejected" && feature.state !== "accepted") {
      const close = options.closePullRequest ?? ((number) => closePullRequest(options.config, number));
      try {
        await close(prNumber);
      } catch (error) {
        console.error(`failed to close PR #${String(prNumber)} after catalog delete`, error);
      }
    }
    send(res, 204, "", "text/plain; charset=utf-8");
    return;
  }

  const retryMatch = urlPath.match(/^\/features\/([^/]+)\/retry\/?$/);
  if (req.method === "POST" && retryMatch && retryMatch[1]) {
    const feature = findFeatureBySlug(options.store, retryMatch[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const password = parsePassword(await readBody(req));
    if (password === undefined || !catalogPasswordOk(password)) {
      send(res, 403, "Wrong password", "text/plain; charset=utf-8");
      return;
    }
    if (!options.retry) {
      send(res, 500, "Retry is not configured", "text/plain; charset=utf-8");
      return;
    }
    const lock = options.store.getPipelineLock();
    if (!lock || lock.feature.id !== feature.id) {
      send(res, 409, "This is not the active pipeline feature.", "text/plain; charset=utf-8");
      return;
    }
    try {
      const message = await options.retry();
      send(res, 200, message, "text/plain; charset=utf-8");
    } catch (error) {
      if (error instanceof UserFacingError) {
        send(res, 409, error.message, "text/plain; charset=utf-8");
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  const faviconName = FAVICON_PATHS[urlPath];
  if (faviconName) {
    sendFile(res, join(catalogDir, faviconName));
    return;
  }

  if (urlPath === "/") {
    await syncGithub(options);
    const { collecting, planned, implemented } = catalogSections(options.store);
    send(
      res,
      200,
      indexPage(
        planned,
        implemented,
        {
          tokens: options.store.totalAgentTokens(),
          implemented: options.store.countAcceptedFeatures(),
          durationMs: options.store.totalAgentDurationMs(),
        },
        {
          gamePublicUrl: options.config.gamePublicUrl,
          gameRepoUrl: githubRepoWebUrl(options.config.gameRepoHttpsUrl),
        },
        collecting,
      ),
      "text/html; charset=utf-8",
    );
    return;
  }

  if (urlPath === "/events/fragment") {
    const html = renderEventFeatures(groupEvents(readEvents(options.config.dataDir)));
    const etag = eventsFragmentEtag(html);
    const requested = req.headers["if-none-match"];
    const given = Array.isArray(requested) ? requested[0] : requested;
    if (given === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ETag: etag,
    });
    res.end(html);
    return;
  }

  if (urlPath === "/events" || urlPath === "/events/") {
    send(
      res,
      200,
      eventsPage(groupEvents(readEvents(options.config.dataDir))),
      "text/html; charset=utf-8",
    );
    return;
  }

  const detail = urlPath.match(/^\/features\/([^/]+)\/?$/);
  if (detail && detail[1]) {
    await syncGithub(options);
    const feature = findFeatureBySlug(options.store, detail[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    send(
      res,
      200,
      featurePage(
        options.config,
        feature,
        options.store.listNotes(feature.id),
        await loadFeatureAgentLog(options.config, feature),
        options.store.listAttachments(feature.id),
      ),
      "text/html; charset=utf-8",
    );
    return;
  }

  const asset = urlPath.match(/^\/features\/([^/]+)\/(screenshots|attachments)\/([^/]+)$/);
  if (asset && asset[1] && asset[2] && asset[3]) {
    const feature = findFeatureBySlug(options.store, asset[1]);
    if (!feature) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const fileName = basename(asset[3]);
    const paths = featurePaths(options.config.dataDir, feature.id);
    const dir = resolve(asset[2] === "attachments" ? paths.attachmentsDir : paths.screenshotsDir);
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
