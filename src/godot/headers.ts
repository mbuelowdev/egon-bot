export const EXPORT_DIR = "/tmp/egon-web";

export const COOP = "same-origin";
export const COEP = "require-corp";
export const CORP = "same-origin";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".gz": "application/gzip",
};

export function mimeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) {
    return "application/octet-stream";
  }
  return MIME[filePath.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

export function coopHeaders(): Record<string, string> {
  return {
    "Cross-Origin-Opener-Policy": COOP,
    "Cross-Origin-Embedder-Policy": COEP,
    "Cross-Origin-Resource-Policy": CORP,
  };
}
