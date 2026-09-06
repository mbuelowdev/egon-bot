import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { coopHeaders, mimeFor } from "./headers.js";

let server: Server | undefined;

export async function stopWebServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) {
    return;
  }
  await new Promise<void>((resolveClose) => {
    current.close(() => resolveClose());
  });
}

export async function serveExportDir(dir: string, port: number): Promise<void> {
  await stopWebServer();
  const root = resolve(dir);
  const httpServer = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    const filePath = resolve(join(root, relative));
    if (filePath !== root && !filePath.startsWith(`${root}/`)) {
      res.writeHead(403, coopHeaders());
      res.end("Forbidden");
      return;
    }
    const headers = {
      ...coopHeaders(),
      "Content-Type": mimeFor(filePath),
    };
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404, headers);
      res.end("Not found");
      return;
    }
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolveListen());
  });
  server = httpServer;
  console.log(`Serving Godot web export on http://127.0.0.1:${String(port)}`);
}

export function isWebServerRunning(): boolean {
  return server !== undefined;
}
