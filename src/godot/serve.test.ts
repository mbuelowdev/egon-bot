import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COEP, COOP, coopHeaders } from "./headers.js";
import { ensureWebExportPreset } from "./preset.js";
import { serveExportDir, stopWebServer } from "./serve.js";

test("coopHeaders match SPEC", () => {
  const headers = coopHeaders();
  assert.equal(headers["Cross-Origin-Opener-Policy"], COOP);
  assert.equal(headers["Cross-Origin-Embedder-Policy"], COEP);
});

test("ensureWebExportPreset writes a Web preset", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-preset-"));
  ensureWebExportPreset(dir);
  ensureWebExportPreset(dir);
  const cfg = join(dir, "export_presets.cfg");
  const text = readFileSync(cfg, "utf8");
  assert.match(text, /name="Web"/);
  assert.equal([...text.matchAll(/name="Web"/g)].length, 1);
});

test("static server sends COOP/COEP", async () => {
  const parent = mkdtempSync(join(tmpdir(), "egon-web-"));
  const dir = join(parent, "site");
  mkdirSync(dir);
  writeFileSync(join(dir, "index.html"), "<html>ok</html>");
  writeFileSync(join(parent, "secret.txt"), "nope");
  const probe = createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        throw new Error("no port");
      }
      probe.close();
      resolve(address.port);
    });
  });
  await serveExportDir(dir, port);
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
    assert.equal(await response.text(), "<html>ok</html>");

    const escaped = await new Promise<{ status: number; coop: string | undefined }>(
      (resolve, reject) => {
        const req = httpRequest(
          { hostname: "127.0.0.1", port, path: "/..%2fsecret.txt" },
          (res) => {
            res.resume();
            resolve({
              status: res.statusCode ?? 0,
              coop: res.headers["cross-origin-opener-policy"],
            });
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(escaped.status, 403);
    assert.equal(escaped.coop, "same-origin");
  } finally {
    await stopWebServer();
  }
});
