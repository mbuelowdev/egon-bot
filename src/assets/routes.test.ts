import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { handleAssetRequest, multipartBoundary, parseMultipart } from "./routes.js";
import { assetFilePath, listAssets, saveAsset, thumbFilePath } from "./store.js";
import { assetManifestPath } from "./manifest.js";

const PASSWORD = "ente123";

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function makePng(width: number, height: number, tint: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const raw = Buffer.alloc(height * (1 + width * 4), tint);
  for (let row = 0; row < height; row += 1) {
    raw.writeUInt8(0, row * (1 + width * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

type Harness = { base: string; dataDir: string; close: () => Promise<void> };

async function harness(): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-portal-"));
  const server: Server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    void handleAssetRequest(req, res, urlPath, {
      dataDir,
      passwordOk: (password) => password === PASSWORD,
      parseJsonPassword: (raw) => {
        try {
          const parsed = JSON.parse(raw.toString("utf8")) as { password?: unknown };
          return typeof parsed.password === "string" ? parsed.password : undefined;
        } catch {
          return undefined;
        }
      },
    }).then((handled) => {
      if (!handled) {
        res.writeHead(404).end("not ours");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no port");
  }
  return {
    dataDir,
    base: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

type Part = { name: string; value: string } | { name: string; filename: string; bytes: Buffer };

const BOUNDARY = "----egon-test-boundary";

/** Built by hand rather than through FormData so the exact bytes on the wire are the test. */
function multipart(parts: Part[]): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("value" in part) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`),
      );
      continue;
    }
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    chunks.push(part.bytes, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

async function upload(
  h: Harness,
  filename: string,
  bytes: Buffer,
  password: string | null = PASSWORD,
): Promise<Response> {
  const parts: Part[] = [];
  if (password !== null) {
    parts.push({ name: "password", value: password });
  }
  parts.push({ name: "file", filename, bytes });
  const { body, contentType } = multipart(parts);
  return await fetch(`${h.base}/assets`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

async function save(
  h: Harness,
  id: string,
  fields: Record<string, string>,
  password: string | null = PASSWORD,
): Promise<Response> {
  const parts: Part[] = [];
  if (password !== null) {
    parts.push({ name: "password", value: password });
  }
  for (const [key, value] of Object.entries(fields)) {
    parts.push({ name: key, value });
  }
  const { body, contentType } = multipart(parts);
  return await fetch(`${h.base}/assets/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

test("multipart parsing reads text fields and binary files without corrupting them", () => {
  const boundary = "----egon-test-boundary";
  const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0x2d, 0x2d]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\nente123\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a b.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    binary,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const fields = parseMultipart(body, boundary);
  assert.equal(fields.length, 2);
  assert.equal(fields[0]?.name, "password");
  assert.equal(fields[0]?.data.toString("utf8"), "ente123");
  assert.equal(fields[1]?.filename, "a b.png");
  assert.deepEqual([...(fields[1]?.data ?? [])], [...binary]);
  assert.equal(multipartBoundary(`multipart/form-data; boundary="${boundary}"`), boundary);
  assert.equal(multipartBoundary("application/json"), undefined);
});

test("every write route refuses a missing or wrong password and accepts ente123", async () => {
  const h = await harness();
  try {
    const png = makePng(8, 8, 0x40);
    assert.equal((await upload(h, "grass.png", png, null)).status, 403);
    assert.equal((await upload(h, "grass.png", png, "wrong")).status, 403);
    const created = await upload(h, "grass.png", png);
    assert.equal(created.status, 201);
    const { asset } = (await created.json()) as { asset: { id: string } };

    assert.equal((await save(h, asset.id, { description: "x" }, "wrong")).status, 403);
    assert.equal((await save(h, asset.id, { description: "Grass tile" })).status, 200);

    const badDelete = await fetch(`${h.base}/assets/grass-tile.png/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    assert.equal(badDelete.status, 403);
    const goodDelete = await fetch(`${h.base}/assets/grass-tile.png/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(goodDelete.status, 204);
    assert.deepEqual(listAssets(h.dataDir), []);
  } finally {
    await h.close();
  }
});

test("path traversal in an id is refused on read, write, and delete", async () => {
  const h = await harness();
  try {
    for (const id of ["..%2Fescape.png", "..%2F..%2Fetc%2Fpasswd"]) {
      assert.equal((await fetch(`${h.base}/assets/file/${id}`)).status, 403);
      assert.equal((await fetch(`${h.base}/assets/thumb/${id}`)).status, 403);
      const write = await save(h, decodeURIComponent(id), { description: "nope" });
      assert.equal(write.status, 403);
      const remove = await fetch(`${h.base}/assets/${id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      });
      assert.equal(remove.status, 403);
    }
  } finally {
    await h.close();
  }
});

test("an upload is detected, stored, described, and served back", async () => {
  const h = await harness();
  try {
    const response = await upload(h, "hero_walk.png", makePng(512, 256, 0x20));
    assert.equal(response.status, 201);
    const created = (await response.json()) as {
      asset: { id: string; description: string; measured?: { width?: number } };
      duplicate: boolean;
    };
    assert.equal(created.duplicate, false);
    assert.equal(created.asset.id, "hero-walk.png");
    assert.equal(created.asset.description, "");
    assert.equal(created.asset.measured?.width, 512);

    const saved = await save(h, created.asset.id, {
      description: "Hero walk cycle, rows are down/up/left/right",
      tags: JSON.stringify(["hero"]),
      grid: JSON.stringify({ cellWidth: 32, cellHeight: 32 }),
    });
    assert.equal(saved.status, 200);
    const updated = (await saved.json()) as {
      asset: { id: string; measuredText: string; promotedPath: string };
    };
    assert.equal(updated.asset.id, "hero-walk-cycle.png");
    assert.match(updated.asset.measuredText, /512 × 256 RGBA, grid 32 × 32 \(16 × 8 = 128 frames\)/);
    assert.equal(updated.asset.promotedPath, "assets/library/image/hero-walk-cycle.png");

    const bytes = await fetch(`${h.base}/assets/file/${encodeURIComponent(updated.asset.id)}`);
    assert.equal(bytes.status, 200);
    assert.equal(bytes.headers.get("content-type"), "image/png");
    assert.equal(
      Buffer.from(await bytes.arrayBuffer()).length,
      readFileSync(assetFilePath(h.dataDir, updated.asset.id) as string).length,
    );
    assert.equal((await fetch(`${h.base}/assets/thumb/${encodeURIComponent(updated.asset.id)}`)).status, 404);
    assert.match(readFileSync(assetManifestPath(h.dataDir), "utf8"), /hero-walk-cycle\.png/);
  } finally {
    await h.close();
  }
});

test("a rejected format returns its specific reason and stores nothing", async () => {
  const h = await harness();
  try {
    const fbx = Buffer.concat([Buffer.from("Kaydara FBX Binary  "), Buffer.alloc(64)]);
    const response = await upload(h, "boss.glb", fbx);
    assert.equal(response.status, 415);
    assert.match(await response.text(), /FBX/);
    assert.deepEqual(listAssets(h.dataDir), []);
  } finally {
    await h.close();
  }
});

test("re-uploading identical bytes under a new name resolves to the existing asset", async () => {
  const h = await harness();
  try {
    const png = makePng(16, 16, 0x11);
    const first = (await (await upload(h, "grass_plain.png", png)).json()) as {
      asset: { id: string };
    };
    const again = await upload(h, "COPY OF grass (1).png", png);
    assert.equal(again.status, 200);
    const duplicate = (await again.json()) as { asset: { id: string }; duplicate: boolean };
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.asset.id, first.asset.id);
    assert.equal(listAssets(h.dataDir).length, 1);
  } finally {
    await h.close();
  }
});

test("the portal page renders the library and a saved thumbnail is served", async () => {
  const h = await harness();
  try {
    saveAsset({
      dataDir: h.dataDir,
      buffer: Buffer.from("glb"),
      originalFilename: "truck.glb",
      detected: {
        kind: "model",
        ext: ".glb",
        format: "glTF 2.0 binary",
        fileOutput: "glTF binary model, version 2",
        mimeType: "model/gltf-binary",
      },
      description: "Orange garbage truck",
    });
    const page = await fetch(`${h.base}/assets`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Asset library/);
    assert.match(html, /Drop files here/);
    assert.match(html, /undescribed/);
    assert.match(html, /orange-garbage-truck\.glb/);

    const thumbed = await save(h, "orange-garbage-truck.glb", { description: "Orange garbage truck" });
    assert.equal(thumbed.status, 200);
    assert.equal(existsSync(thumbFilePath(h.dataDir, "orange-garbage-truck.glb") as string), false);
  } finally {
    await h.close();
  }
});

test("a request outside /assets is left for the catalog", async () => {
  const h = await harness();
  try {
    const response = await fetch(`${h.base}/features/dash`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not ours");
  } finally {
    await h.close();
  }
});

test("dropping a new file on an asset replaces its bytes and keeps what a human typed", async () => {
  const h = await harness();
  try {
    const created = (await (await upload(h, "hero.png", makePng(512, 256, 0x10))).json()) as {
      asset: { id: string };
    };
    await save(h, created.asset.id, {
      description: "Hero walk cycle",
      grid: JSON.stringify({ cellWidth: 32, cellHeight: 32 }),
    });

    const { body, contentType } = multipart([
      { name: "password", value: PASSWORD },
      { name: "file", filename: "hero_v2.png", bytes: makePng(256, 256, 0x99) },
    ]);
    const replaced = await fetch(`${h.base}/assets/hero-walk-cycle.png/replace`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    assert.equal(replaced.status, 200);
    const { asset } = (await replaced.json()) as {
      asset: { id: string; description: string; originalFilename: string; measured?: { width?: number } };
    };
    assert.equal(asset.id, "hero-walk-cycle.png");
    assert.equal(asset.description, "Hero walk cycle");
    assert.equal(asset.originalFilename, "hero_v2.png");
    assert.equal(asset.measured?.width, 256);
    assert.equal(listAssets(h.dataDir).length, 1);
  } finally {
    await h.close();
  }
});

test("a replacement of the wrong format or without the password is refused", async () => {
  const h = await harness();
  try {
    const created = (await (await upload(h, "grass.png", makePng(32, 32, 0x10))).json()) as {
      asset: { id: string };
    };
    const noPassword = multipart([{ name: "file", filename: "x.png", bytes: makePng(8, 8, 1) }]);
    assert.equal(
      (
        await fetch(`${h.base}/assets/${created.asset.id}/replace`, {
          method: "POST",
          headers: { "Content-Type": noPassword.contentType },
          body: noPassword.body,
        })
      ).status,
      403,
    );
    const fbx = multipart([
      { name: "password", value: PASSWORD },
      { name: "file", filename: "boss.glb", bytes: Buffer.concat([Buffer.from("Kaydara FBX Binary  "), Buffer.alloc(64)]) },
    ]);
    const rejected = await fetch(`${h.base}/assets/${created.asset.id}/replace`, {
      method: "POST",
      headers: { "Content-Type": fbx.contentType },
      body: fbx.body,
    });
    assert.equal(rejected.status, 415);
    assert.match(await rejected.text(), /FBX/);
  } finally {
    await h.close();
  }
});

test("posting the unchanged filename box still mints the id from the description", async () => {
  const h = await harness();
  try {
    const created = (await (await upload(h, "a3f9c2d1.png", makePng(8, 8, 0x33))).json()) as {
      asset: { id: string };
    };
    assert.equal(created.asset.id, "a3f9c2d1.png");
    const saved = await save(h, created.asset.id, {
      description: "Orange municipal garbage truck",
      filename: "a3f9c2d1",
    });
    assert.equal(saved.status, 200);
    const { asset } = (await saved.json()) as { asset: { id: string } };
    assert.equal(asset.id, "orange-municipal-garbage-truck.png");
  } finally {
    await h.close();
  }
});

test("the filename box renames the asset and refuses a name already taken", async () => {
  const h = await harness();
  try {
    const first = (await (await upload(h, "a.png", makePng(8, 8, 0x11))).json()) as {
      asset: { id: string };
    };
    await save(h, first.asset.id, { description: "Grass tile" });
    const second = (await (await upload(h, "b.png", makePng(8, 8, 0x22))).json()) as {
      asset: { id: string };
    };
    const renamed = await save(h, second.asset.id, {
      description: "Dirt tile",
      filename: "Dirt Tile Rough",
    });
    assert.equal(renamed.status, 200);
    const { asset } = (await renamed.json()) as { asset: { id: string; promotedPath: string } };
    assert.equal(asset.id, "dirt-tile-rough.png");
    assert.equal(asset.promotedPath, "assets/library/image/dirt-tile-rough.png");
    assert.equal((await fetch(`${h.base}/assets/file/dirt-tile-rough.png`)).status, 200);

    const clash = await save(h, "dirt-tile-rough.png", {
      description: "Dirt tile",
      filename: "grass-tile",
    });
    assert.equal(clash.status, 409);
    assert.match(await clash.text(), /already in the library/);
  } finally {
    await h.close();
  }
});

test("companion files attach, serve, and detach through the portal", async () => {
  const h = await harness();
  try {
    const created = (await (await upload(h, "truck.gltf", Buffer.from('{"asset":{"version":"2.0"}}'))).json()) as {
      asset: { id: string };
    };
    await save(h, created.asset.id, { description: "Garbage truck" });

    const attach = multipart([
      { name: "password", value: PASSWORD },
      { name: "file", filename: "Truck Data.bin", bytes: Buffer.from("bin-bytes") },
    ]);
    const attached = await fetch(`${h.base}/assets/garbage-truck.gltf/attach`, {
      method: "POST",
      headers: { "Content-Type": attach.contentType },
      body: attach.body,
    });
    assert.equal(attached.status, 200);
    const { asset } = (await attached.json()) as {
      asset: { parts: Array<{ filename: string; bytes: number }> };
    };
    assert.deepEqual(asset.parts.map((part) => part.filename), ["truck-data.bin"]);

    const served = await fetch(`${h.base}/assets/part/garbage-truck.gltf/truck-data.bin`);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), "bin-bytes");

    const detached = await fetch(`${h.base}/assets/garbage-truck.gltf/attach/truck-data.bin/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(detached.status, 200);
    const after = (await detached.json()) as { asset: { parts: unknown[] } };
    assert.deepEqual(after.asset.parts, []);
    assert.equal((await fetch(`${h.base}/assets/part/garbage-truck.gltf/truck-data.bin`)).status, 404);
  } finally {
    await h.close();
  }
});

test("attaching and detaching need the password, and companion paths cannot traverse", async () => {
  const h = await harness();
  try {
    // The gate runs before the store is touched, so a nonexistent id still answers 403.
    const noPassword = multipart([{ name: "file", filename: "a.bin", bytes: Buffer.from("x") }]);
    assert.equal(
      (
        await fetch(`${h.base}/assets/truck.glb/attach`, {
          method: "POST",
          headers: { "Content-Type": noPassword.contentType },
          body: noPassword.body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${h.base}/assets/truck.glb/attach/a.bin/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        })
      ).status,
      403,
    );
    assert.equal((await fetch(`${h.base}/assets/part/truck.glb/..%2F..%2Fescape.bin`)).status, 403);
    assert.equal((await fetch(`${h.base}/assets/part/..%2Fescape/a.bin`)).status, 403);
  } finally {
    await h.close();
  }
});
