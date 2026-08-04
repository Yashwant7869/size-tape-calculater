/* ─────────────────────────────────────────────
   Pose detection worker (§6.4).
   Bundled with local @tensorflow-models/pose-detection
   so the scanner works without external CDN access.
───────────────────────────────────────────── */

/// <reference lib="webworker" />

import type { PoseKeypoint } from "../utils/poseModel";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs";

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
      const maxSide = 640;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const cnv = new OffscreenCanvas(
        Math.round(bitmap.width * ratio),
        Math.round(bitmap.height * ratio)
      );
      const ctx = cnv.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, cnv.width, cnv.height);
      const det = detector!;
      const poses = await det.estimatePoses(cnv as unknown as HTMLCanvasElement);
      const rawKeypoints: PoseKeypoint[] = poses[0]?.keypoints ?? [];
      const scaleBack = cnv.width > 0 ? bitmap.width / cnv.width : 1;
      bitmap.close();
      const keypoints: PoseKeypoint[] = scaleBack === 1
        ? rawKeypoints
        : rawKeypoints.map(k => ({
            ...k,
            x: k.x * scaleBack,
            y: k.y * scaleBack,
          }));
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
  // Ensure TF backend is ready (WebGL/WASM) before creating detector.
  // Ensure TF backend is ready. Try webgl first, then wasm, then cpu.
  try {
    await tf.setBackend("webgl");
  } catch {
    try {
      await tf.setBackend("wasm");
    } catch {
      await tf.setBackend("cpu");
    }
  }
  await tf.ready();

  const variant = model === "movenet-lightning"
    ? poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
    : poseDetection.movenet.modelType.SINGLEPOSE_THUNDER;
  detector = (await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: variant }
  )) as unknown as { estimatePoses(img: HTMLCanvasElement): Promise<{ keypoints: PoseKeypoint[] }[]> };
}

export {};
