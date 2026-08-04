/* ─────────────────────────────────────────────
   §1.1 — Model selection.
   Default: MoveNet THUNDER (17 keypoints, fast, low-power).
   Optional: MediaPipe Pose via @mediapipe/pose — 33 keypoints,
   better lateral (side) pose handling, 3D depth cues.
   Fallback: MoveNet LIGHTNING.
───────────────────────────────────────────── */

export type PoseModelKind = "movenet-thunder" | "movenet-lightning" | "blazepose";

export interface PoseKeypoint {
  x: number; y: number; score: number; name: string;
}
export interface Pose { keypoints: PoseKeypoint[] }
export interface PoseDetectorLike {
  estimatePoses(img: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): Promise<Pose[]>;
  kind: PoseModelKind;
}

declare global {
  interface Window {
    poseDetection: {
      createDetector(model: string, cfg: object): Promise<{
        estimatePoses(img: HTMLCanvasElement): Promise<Pose[]>;
      }>;
      SupportedModels: { MoveNet: string; BlazePose: string };
      movenet: { modelType: { SINGLEPOSE_THUNDER: string; SINGLEPOSE_LIGHTNING: string } };
    };
    Pose: new (cfg: { locateFile: (f: string) => string }) => {
      setOptions(opts: Record<string, unknown>): void;
      onResults(cb: (r: { poseLandmarks?: Array<{ x: number; y: number; z: number; visibility?: number }> }) => void): void;
      send(inputs: { image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement }): Promise<void>;
      close(): Promise<void>;
    };
  }
}

const MEDIAPIPE_POSE_SCRIPT = "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js";
const MEDIAPIPE_POSE_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/pose";

let activeDetector: PoseDetectorLike | null = null;
let activeKind: PoseModelKind | null = null;

/* BlazePose landmark index → semantic name. We only expose the
   ones MoveNet already exposes, plus a few extras. */
const BLAZEPOSE_MAP: Record<number, string> = {
  0:  "nose",
  11: "left_shoulder",
  12: "right_shoulder",
  13: "left_elbow",
  14: "right_elbow",
  15: "left_wrist",
  16: "right_wrist",
  23: "left_hip",
  24: "right_hip",
  25: "left_knee",
  26: "right_knee",
  27: "left_ankle",
  28: "right_ankle",
  29: "left_heel",
  30: "right_heel",
  31: "left_foot_index",
  32: "right_foot_index",
};

export async function loadPoseDetector(
  preferred: PoseModelKind = "movenet-thunder"
): Promise<PoseDetectorLike> {
  if (activeDetector && activeKind === preferred) return activeDetector;
  if (preferred === "blazepose") {
    return loadBlazePose();
  }
  return loadMoveNet(preferred);
}

export function disposePoseDetector() {
  activeDetector = null;
  activeKind = null;
}

async function loadMoveNet(
  kind: "movenet-thunder" | "movenet-lightning"
): Promise<PoseDetectorLike> {
  // Wait for the TFJS pose-detection script if not yet present.
  await waitForGlobal("poseDetection");
  const variant =
    kind === "movenet-thunder"
      ? window.poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
      : window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
  try {
    const det = await window.poseDetection.createDetector(
      window.poseDetection.SupportedModels.MoveNet,
      { modelType: variant }
    );
    activeDetector = {
      kind,
      estimatePoses: async (img) => det.estimatePoses(img as HTMLCanvasElement),
    };
    activeKind = kind;
    return activeDetector;
  } catch {
    // Fallback to lightning if thunder unavailable
    if (kind === "movenet-thunder") {
      return loadMoveNet("movenet-lightning");
    }
    throw new Error("MoveNet could not be loaded");
  }
}

async function loadBlazePose(): Promise<PoseDetectorLike> {
  await injectScript(MEDIAPIPE_POSE_SCRIPT);
  await waitForGlobal("Pose");
  const pose = new window.Pose({
    locateFile: (f: string) => `${MEDIAPIPE_POSE_BASE}/${f}`,
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  await new Promise<void>((resolve) => {
    pose.onResults(() => resolve());
    const probe = document.createElement("canvas");
    probe.width = 2; probe.height = 2;
    pose.send({ image: probe }).catch(() => resolve());
  });
  activeDetector = {
    kind: "blazepose",
    estimatePoses: (img) => new Promise<Pose[]>((resolve) => {
      pose.onResults((r) => {
        const lm = r.poseLandmarks ?? [];
        const kps: PoseKeypoint[] = [];
        for (const [idx, name] of Object.entries(BLAZEPOSE_MAP)) {
          const l = lm[Number(idx)];
          if (!l) continue;
          kps.push({
            x: l.x,
            y: l.y,
            score: l.visibility ?? 0.5,
            name,
          });
        }
        // BlazePose returns normalised [0,1] coordinates on the input image.
        // The width/height of `img` are needed to denormalise.
        const i = img as HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;
        const w = "videoWidth" in i ? i.videoWidth
                : "naturalWidth" in i ? i.naturalWidth
                : i.width;
        const h = "videoHeight" in i ? i.videoHeight
                : "naturalHeight" in i ? i.naturalHeight
                : i.height;
        for (const k of kps) { k.x *= w; k.y *= h; }
        resolve([{ keypoints: kps }]);
      });
      pose.send({ image: img });
    }),
  };
  activeKind = "blazepose";
  return activeDetector;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

function waitForGlobal(name: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      if ((window as unknown as Record<string, unknown>)[name] !== undefined) {
        clearInterval(id); resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id); reject(new Error(`timeout waiting for ${name}`));
      }
    }, 50);
  });
}
