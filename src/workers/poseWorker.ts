/* ─────────────────────────────────────────────
   Pose detection worker (§6.4).
   The main thread posts an ImageBitmap (or
   ImageData-transferable) and a request id; this
   worker runs MoveNet (or BlazePose) and posts back
   the keypoints plus a confidence score.
───────────────────────────────────────────── */

/// <reference lib="webworker" />

import type { PoseKeypoint } from "../utils/poseModel";

// Loaded scripts from the main thread (TFJS + pose-detection).
declare const self: DedicatedWorkerGlobalScope;

interface DetectRequest {
  type: "detect";
  id: number;
  bitmap: ImageBitmap;
}

interface DetectResponse {
  type: "detect";
  id: number;
  keypoints: PoseKeypoint[];
  averageScore: number;
  error?: string;
}

interface InitRequest {
  type: "init";
  model: "movenet-thunder" | "movenet-lightning" | "blazepose";
}

interface InitResponse {
  type: "init";
  ok: boolean;
  error?: string;
}

type Req = DetectRequest | InitRequest;

let detector: { estimatePoses(img: HTMLCanvasElement): Promise<{ keypoints: PoseKeypoint[] }[]> } | null = null;
let modelKind: string = "";

self.addEventListener("message", async (e: MessageEvent<Req>) => {
  if (e.data.type === "init") {
    try {
      await loadModel(e.data.model);
      modelKind = e.data.model;
      const res: InitResponse = { type: "init", ok: true };
      self.postMessage(res);
    } catch (err) {
      const res: InitResponse = { type: "init", ok: false, error: String(err) };
      self.postMessage(res);
    }
    return;
  }
  if (e.data.type === "detect") {
    const { id, bitmap } = e.data;
    try {
      if (!detector) {
        await loadModel("movenet-thunder");
      }
      // Draw the bitmap to an OffscreenCanvas at a capped size.
      const maxSide = 640;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const cnv = new OffscreenCanvas(
        Math.round(bitmap.width * ratio),
        Math.round(bitmap.height * ratio)
      );
      const ctx = cnv.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, cnv.width, cnv.height);
      // Run detection
      const det = detector!;
      const poses = await det.estimatePoses(cnv as unknown as HTMLCanvasElement);
      bitmap.close();
      const keypoints: PoseKeypoint[] = poses[0]?.keypoints ?? [];
      const averageScore = keypoints.length === 0
        ? 0
        : (keypoints.reduce((s, k) => s + (k.score ?? 0), 0) / keypoints.length) * 100;
      const res: DetectResponse = { type: "detect", id, keypoints, averageScore };
      self.postMessage(res);
    } catch (err) {
      bitmap.close();
      const res: DetectResponse = {
        type: "detect", id, keypoints: [], averageScore: 0,
        error: String(err),
      };
      self.postMessage(res);
    }
    return;
  }
});

async function loadModel(model: string): Promise<void> {
  // Inject TFJS + pose-detection if not present.
  if (!(self as unknown as { tf?: unknown }).tf) {
    await injectScript("https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.20.0/tf.min.js");
  }
  if (!(self as unknown as { poseDetection?: unknown }).poseDetection) {
    await injectScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection");
  }
  const pd = (self as unknown as {
    poseDetection: {
      createDetector(model: string, cfg: object): Promise<{ estimatePoses(img: HTMLCanvasElement): Promise<{ keypoints: PoseKeypoint[] }[]> }>;
      SupportedModels: { MoveNet: string };
      movenet: { modelType: { SINGLEPOSE_THUNDER: string; SINGLEPOSE_LIGHTNING: string } };
    };
  }).poseDetection;

  const variant = model === "movenet-thunder"
    ? pd.movenet.modelType.SINGLEPOSE_THUNDER
    : pd.movenet.modelType.SINGLEPOSE_LIGHTNING;
  detector = await pd.createDetector(pd.SupportedModels.MoveNet, { modelType: variant });
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((self as unknown as { __injected?: Set<string> }).__injected?.has(src)) {
      resolve();
      return;
    }
    importScripts(src);
    if (!(self as unknown as { __injected?: Set<string> }).__injected) {
      (self as unknown as { __injected: Set<string> }).__injected = new Set();
    }
    (self as unknown as { __injected: Set<string> }).__injected!.add(src);
    resolve();
  });
}

export {};
