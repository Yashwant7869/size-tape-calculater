/* ─────────────────────────────────────────────
   Pose detection worker.

   TensorFlow.js and MoveNet are bundled into this worker. The model weights are
   loaded at runtime; callers may supply a self-hosted MoveNet `model.json` URL.
───────────────────────────────────────────── */

/// <reference lib="webworker" />

import type { PoseKeypoint } from "../utils/poseModel";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs";

declare const self: DedicatedWorkerGlobalScope;

type WorkerPoseModel = "movenet-thunder" | "movenet-lightning";

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
  model: WorkerPoseModel;
  modelUrl?: string;
}

interface InitResponse {
  type: "init";
  ok: boolean;
  error?: string;
}

type Request = DetectRequest | InitRequest;

type Detector = {
  estimatePoses(image: OffscreenCanvas): Promise<{ keypoints: PoseKeypoint[] }[]>;
};

let detector: Detector | null = null;

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  if (event.data.type === "init") {
    try {
      await loadModel(event.data.model, event.data.modelUrl);
      const response: InitResponse = { type: "init", ok: true };
      self.postMessage(response);
    } catch (cause) {
      const response: InitResponse = {
        type: "init",
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      };
      self.postMessage(response);
    }
    return;
  }

  if (event.data.type === "detect") {
    const { id, bitmap } = event.data;
    try {
      if (!detector) await loadModel("movenet-thunder");

      const maxSide = 640;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * ratio)),
        Math.max(1, Math.round(bitmap.height * ratio))
      );
      const context = canvas.getContext("2d");
      if (!context) throw new Error("OffscreenCanvas 2D context is unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const poses = await detector!.estimatePoses(canvas);
      const rawKeypoints: PoseKeypoint[] = poses[0]?.keypoints ?? [];
      const scaleBack = canvas.width > 0 ? bitmap.width / canvas.width : 1;
      const keypoints = scaleBack === 1
        ? rawKeypoints
        : rawKeypoints.map((keypoint) => ({
            ...keypoint,
            x: keypoint.x * scaleBack,
            y: keypoint.y * scaleBack,
          }));
      const averageScore = keypoints.length === 0
        ? 0
        : (keypoints.reduce((sum, keypoint) => sum + (keypoint.score ?? 0), 0) / keypoints.length) * 100;
      const response: DetectResponse = { type: "detect", id, keypoints, averageScore };
      self.postMessage(response);
    } catch (cause) {
      const response: DetectResponse = {
        type: "detect",
        id,
        keypoints: [],
        averageScore: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      };
      self.postMessage(response);
    } finally {
      bitmap.close();
    }
  }
});

async function loadModel(model: WorkerPoseModel, modelUrl?: string): Promise<void> {
  // WebGL is generally fastest. If it cannot be initialized in a worker, TFJS
  // falls back to CPU rather than failing the calculator.
  try {
    await tf.setBackend("webgl");
  } catch {
    await tf.setBackend("cpu");
  }
  await tf.ready();

  const modelType = model === "movenet-lightning"
    ? poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
    : poseDetection.movenet.modelType.SINGLEPOSE_THUNDER;
  const config = modelUrl ? { modelType, modelUrl } : { modelType };
  detector = (await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    config
  )) as unknown as Detector;
}

export {};
