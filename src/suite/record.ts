import { writeFileSync } from "node:fs";

/**
 * Human-proof video. Chromium's MediaRecorder on the Godot canvas, started after the
 * scene warmup so the clip is gameplay rather than the HTML shell or a hitchy first
 * second. Not a pass condition.
 *
 * `page.evaluate(string)` is an expression (`isFunction: false`); these are IIFEs.
 */

/** First-frame hitch: shaders and physics after the HTML shell reports ready. */
export const SCENE_WARMUP_MS = 1_000;
/** Video proof only: keep a press down so WASD/camera motion is visible. Still one press. */
export const PROOF_PRESS_HOLD_MS = 750;
/** Linger after each video-proof input so the camera and a step of motion make the clip. */
export const PROOF_ACTION_GAP_MS = 400;

export type ProofRecordStart = { ok: boolean; error?: string };
export type ProofRecordStop = { ok: boolean; base64?: string; error?: string };

export const START_PROOF_VIDEO_SOURCE = `(() => {
  if (window.__egonProofRecorder) {
    return { ok: true };
  }
  const canvases = Array.from(document.querySelectorAll("canvas")).filter(
    (node) => node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0,
  );
  canvases.sort((a, b) => b.width * b.height - a.width * a.height);
  const canvas = canvases[0];
  if (!(canvas instanceof HTMLCanvasElement)) {
    return { ok: false, error: "no game canvas to record" };
  }
  const stream = canvas.captureStream(30);
  if (stream.getVideoTracks().length === 0) {
    return { ok: false, error: "canvas.captureStream produced no video track" };
  }
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
    ? "video/webm;codecs=vp8"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";
  if (mime === "") {
    return { ok: false, error: "MediaRecorder does not support webm" };
  }
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800000 });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  window.__egonProofRecorder = { recorder, chunks };
  recorder.start(200);
  return { ok: true };
})()`;

export const STOP_PROOF_VIDEO_SOURCE = `(async () => {
  const handle = window.__egonProofRecorder;
  window.__egonProofRecorder = undefined;
  if (!handle || !handle.recorder) {
    return { ok: false, error: "not recording" };
  }
  const recorder = handle.recorder;
  const chunks = handle.chunks;
  if (recorder.state !== "inactive") {
    await new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(undefined), { once: true });
      recorder.stop();
    });
  }
  const blob = new Blob(chunks, { type: "video/webm" });
  if (blob.size < 64) {
    return { ok: false, error: "recording was empty" };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return { ok: true, base64: btoa(binary) };
})()`;

export async function startProofVideo(
  evaluate: <T>(source: string) => Promise<T>,
): Promise<boolean> {
  try {
    const result = await evaluate<ProofRecordStart>(START_PROOF_VIDEO_SOURCE);
    if (!result?.ok) {
      console.error("proof video did not start", result?.error ?? "unknown error");
      return false;
    }
    return true;
  } catch (error) {
    console.error("proof video did not start", error);
    return false;
  }
}

export async function stopProofVideo(
  evaluate: <T>(source: string) => Promise<T>,
  destPath: string,
): Promise<boolean> {
  try {
    const result = await evaluate<ProofRecordStop>(STOP_PROOF_VIDEO_SOURCE);
    if (!result?.ok || typeof result.base64 !== "string" || result.base64 === "") {
      console.error("proof video did not stop", result?.error ?? "unknown error");
      return false;
    }
    const bytes = Buffer.from(result.base64, "base64");
    if (bytes.length < 64) {
      console.error("proof video was empty");
      return false;
    }
    writeFileSync(destPath, bytes);
    return true;
  } catch (error) {
    console.error("proof video did not stop", error);
    return false;
  }
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
