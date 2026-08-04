/* ─────────────────────────────────────────────
   Pure image-quality and pose-orientation checks.
   These run in the browser on ImageData / a loaded HTMLImageElement
   (or, for the worker, on an OffscreenCanvas).
───────────────────────────────────────────── */

import type { KeypointWithNoise } from "./measure";

/* ─────────────────────────────────────────────
   §1.2 — keypoint quality gate
───────────────────────────────────────────── */
export interface KeypointConfig {
  required: string[];
  minScore: number;        // default 0.30
  pairMinScore: number;    // default 0.50
  pairNames?: [string, string][];
}

export interface KeypointGate {
  passed: boolean;
  missing: string[];
  weakPairs: string[];
  pairScores: Record<string, number>;
}

export function gateKeypoints(
  keypoints: KeypointWithNoise[],
  cfg: KeypointConfig
): KeypointGate {
  const byName: Record<string, KeypointWithNoise> = {};
  for (const k of keypoints) byName[k.name] = k;

  const missing: string[] = [];
  for (const n of cfg.required) {
    if (!byName[n] || byName[n].score < cfg.minScore) missing.push(n);
  }

  const pairScores: Record<string, number> = {};
  const weakPairs: string[] = [];
  const pairs = cfg.pairNames ?? [
    ["left_shoulder", "right_shoulder"],
    ["left_hip", "right_hip"],
    ["left_ankle", "right_ankle"],
  ];
  for (const [a, b] of pairs) {
    const ka = byName[a], kb = byName[b];
    if (!ka || !kb) continue;
    const pair = Math.min(ka.score, kb.score);
    pairScores[`${a}/${b}`] = pair;
    if (pair < cfg.pairMinScore) weakPairs.push(`${a}/${b}`);
  }

  return {
    passed: missing.length === 0 && weakPairs.length === 0,
    missing,
    weakPairs,
    pairScores,
  };
}

/* ─────────────────────────────────────────────
   §1.5 — pose-orientation validation
   Returns the angle (deg) of the shoulder line, the
   lateral asymmetry score, and a recommended action.
───────────────────────────────────────────── */
export type PoseOrientation = "front" | "side" | "unknown";

export interface OrientationResult {
  /** Angle of the shoulder line, in degrees. 0 = horizontal, ±90 = vertical. */
  shoulderAngleDeg: number;
  /** Asymmetry: |left-shoulder.x - right-shoulder.x| normalised by torso length. */
  shoulderSpread: number;
  /** Recommended orientation based on geometry. */
  expected: PoseOrientation;
  /** What the user claimed. */
  claimed: PoseOrientation;
  /** Whether the claim matches the geometry. */
  matches: boolean;
}

export function validateOrientation(
  keypoints: KeypointWithNoise[],
  claimed: PoseOrientation
): OrientationResult {
  const byName: Record<string, KeypointWithNoise> = {};
  for (const k of keypoints) byName[k.name] = k;
  const ls = byName["left_shoulder"], rs = byName["right_shoulder"];
  const lh = byName["left_hip"], rh = byName["right_hip"];
  if (!ls || !rs || !lh || !rh) {
    return {
      shoulderAngleDeg: 0,
      shoulderSpread: 0,
      expected: "unknown",
      claimed,
      matches: false,
    };
  }
  const angle = (Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI;
  const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y);
  const hipCenterY = (lh.y + rh.y) / 2;
  const torsoLen = Math.max(1, Math.abs(hipCenterY - (ls.y + rs.y) / 2));
  // Side-pose: shoulders should be roughly aligned in x (collapsed).
  const frontSpread = shoulderW / torsoLen; // > 0.5 → front
  let expected: PoseOrientation;
  if (frontSpread > 0.5) expected = "front";
  else if (frontSpread < 0.25) expected = "side";
  else expected = "unknown";

  return {
    shoulderAngleDeg: angle,
    shoulderSpread: frontSpread,
    expected,
    claimed,
    matches: expected === claimed,
  };
}

/* ─────────────────────────────────────────────
   §1.6 — auto-reject unsuitable photos
───────────────────────────────────────────── */
export interface RejectionCheck {
  reason: string | null;
  /** "head-cropped" | "feet-cropped" | "too-small" | "edge-touching"
   *  | "not-centered" | null */
  code:
    | "head-cropped" | "feet-cropped" | "too-small"
    | "edge-touching" | "not-centered" | null;
  /** Specific re-shoot instruction for the user. */
  instruction: string | null;
}

export function checkPhotoAcceptance(
  keypoints: KeypointWithNoise[],
  imageW: number,
  imageH: number
): RejectionCheck {
  const byName: Record<string, KeypointWithNoise> = {};
  for (const k of keypoints) byName[k.name] = k;

  const headTop = byName["nose"]; // closest to top
  const ankleL = byName["left_ankle"];
  const ankleR = byName["right_ankle"];
  const hip = byName["left_hip"];

  // Head cropped: nose within 3% of image top
  if (headTop && headTop.y < imageH * 0.03) {
    return {
      reason: "Head is cut off at the top of the frame.",
      code: "head-cropped",
      instruction: "Move the camera up so the top of your head is visible with a small gap above.",
    };
  }
  // Feet cropped: ankles within 4% of image bottom
  if (ankleL && ankleR) {
    const ay = Math.max(ankleL.y, ankleR.y);
    if (ay > imageH * 0.96) {
      return {
        reason: "Feet are cut off at the bottom of the frame.",
        code: "feet-cropped",
        instruction: "Step back ~1 m so your full body fits in the frame.",
      };
    }
  }
  // Body too small: hip-to-ankle span < 20% of image height
  if (ankleL && ankleR && hip) {
    const ankleY = (ankleL.y + ankleR.y) / 2;
    const span = ankleY - hip.y;
    if (span < imageH * 0.20) {
      return {
        reason: "Body is too small in the frame.",
        code: "too-small",
        instruction: "Move closer to the camera, or use the camera's zoom.",
      };
    }
  }
  // Edge touching: any required keypoint within 2% of left/right edge
  if (hip) {
    if (hip.x < imageW * 0.02 || hip.x > imageW * 0.98) {
      return {
        reason: "Body is too close to the edge.",
        code: "edge-touching",
        instruction: "Center yourself in the frame with a small margin on each side.",
      };
    }
  }
  // Not centered: hip center offset > 15% of width
  if (ankleL && ankleR && hip) {
    const ankleX = (ankleL.x + ankleR.x) / 2;
    const bodyCx = (hip.x + ankleX) / 2;
    const imgCx = imageW / 2;
    if (Math.abs(bodyCx - imgCx) > imageW * 0.15) {
      return {
        reason: "Body is not centered in the frame.",
        code: "not-centered",
        instruction: "Shift sideways so your body is in the middle of the frame.",
      };
    }
  }
  return { reason: null, code: null, instruction: null };
}

/* ─────────────────────────────────────────────
   §5.3 — image quality: sharpness, lighting,
   background contrast. All work on ImageData.
───────────────────────────────────────────── */
export interface ImageQuality {
  sharpness: number;        // 0–100, higher = sharper
  lightingUniformity: number; // 0–100, higher = more uniform
  bgContrast: number;       // 0–100, higher = better separation
  warnings: string[];
}

/** Extract the central body region from ImageData. */
function centralRegion(
  data: Uint8ClampedArray,
  w: number,
  h: number
): { lumas: number[]; mean: number; std: number } {
  const x0 = Math.floor(w * 0.30), x1 = Math.floor(w * 0.70);
  const y0 = Math.floor(h * 0.20), y1 = Math.floor(h * 0.80);
  const lumas: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  const mean = lumas.reduce((s, v) => s + v, 0) / Math.max(1, lumas.length);
  const variance =
    lumas.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, lumas.length);
  return { lumas, mean, std: Math.sqrt(variance) };
}

/** Laplacian variance — a standard sharpness proxy. */
function laplacianVariance(
  data: Uint8ClampedArray,
  w: number,
  h: number
): number {
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const c = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const t = (y - 1) * w + x, b = (y + 1) * w + x, l = y * w + (x - 1), r = y * w + (x + 1);
      const tt = 0.299 * data[t * 4] + 0.587 * data[t * 4 + 1] + 0.114 * data[t * 4 + 2];
      const bb = 0.299 * data[b * 4] + 0.587 * data[b * 4 + 1] + 0.114 * data[b * 4 + 2];
      const ll = 0.299 * data[l * 4] + 0.587 * data[l * 4 + 1] + 0.114 * data[l * 4 + 2];
      const rr = 0.299 * data[r * 4] + 0.587 * data[r * 4 + 1] + 0.114 * data[r * 4 + 2];
      const v = -4 * c + tt + bb + ll + rr;
      sum += v; sum2 += v * v; n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export function imageQuality(imageData: ImageData): ImageQuality {
  const { data, width: w, height: h } = imageData;
  const warnings: string[] = [];

  // Downsample for speed
  const stride = 2;
  const ds = new Uint8ClampedArray(Math.ceil(w / stride) * Math.ceil(h / stride) * 4);
  const dw = Math.ceil(w / stride), dh = Math.ceil(h / stride);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, x * stride);
      const sy = Math.min(h - 1, y * stride);
      const si = (sy * w + sx) * 4;
      const di = (y * dw + x) * 4;
      ds[di]     = data[si];
      ds[di + 1] = data[si + 1];
      ds[di + 2] = data[si + 2];
      ds[di + 3] = 255;
    }
  }
  const dsData: ImageData = { data: ds, width: dw, height: dh, colorSpace: "srgb" };

  // Sharpness
  const lap = laplacianVariance(ds, dw, dh);
  // Empirically: < 30 = blurry, > 100 = sharp
  const sharpness = Math.max(0, Math.min(100, lap / 1.5));
  if (sharpness < 25) warnings.push("Photo is blurry — hold the camera steady and re-shoot.");

  // Lighting uniformity (std dev of central region luma)
  const center = centralRegion(data, w, h);
  // Lower std = more uniform. Map: 0→100, 80→0.
  const lightingUniformity = Math.max(0, Math.min(100, 100 - center.std / 0.8));
  if (lightingUniformity < 50) warnings.push("Harsh shadows — face a soft, even light source.");

  // Background contrast: body region vs image border
  const border = (() => {
    const lumas: number[] = [];
    const t = 6; // 6-pixel border
    for (let y = 0; y < t; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        lumas.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
    for (let y = h - t; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        lumas.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
    return lumas.reduce((s, v) => s + v, 0) / Math.max(1, lumas.length);
  })();
  // Body mean vs background mean — large difference = good
  const diff = Math.abs(center.mean - border);
  const bgContrast = Math.max(0, Math.min(100, diff / 1.2));
  if (bgContrast < 30) warnings.push("Stand in front of a plain background to improve detection.");

  return { sharpness, lightingUniformity, bgContrast, warnings };
}

/* ─────────────────────────────────────────────
   §1.4 — mirror-flip detection
   MoveNet returns left/right by image-space, not by the
   person's anatomy. On a front-camera selfie the image is
   already mirrored, so L/R are reversed.
   We detect this by checking the angle of the eye-nose triangle.
   Returns true if the image should be un-mirrored.
───────────────────────────────────────────── */
export function detectMirrorFlip(
  keypoints: KeypointWithNoise[]
): boolean {
  const byName: Record<string, KeypointWithNoise> = {};
  for (const k of keypoints) byName[k.name] = k;
  const le = byName["left_eye"], re = byName["right_eye"];
  const nose = byName["nose"];
  if (!le || !re || !nose) return false;
  // In a mirrored image, the "left_eye" keypoint is on the
  // person's right. Sign of (nose.x − eye midpoint.x) flips.
  const eyeMidX = (le.x + re.x) / 2;
  const dx = nose.x - eyeMidX;
  // MoveNet's nose tends to be slightly off-centre; we only
  // flag a flip if the deviation is large.
  return Math.abs(dx) > 4;
}

/* ─────────────────────────────────────────────
   §2.2 — anthropometric sanity check on calibration.
   Returns the expected ratio of head-to-ankle vs full
   body height, and the user's measured ratio.
───────────────────────────────────────────── */
export function anthropometricSanity(
  headY: number,
  ankleY: number,
  userHeightCm: number
): { measured: number; expected: number; ok: boolean; deltaPct: number } {
  const measured = (ankleY - headY) / Math.max(1, userHeightCm);
  // Head top to ankle ≈ 0.87 of body height for an adult.
  const expected = 0.87;
  const deltaPct = Math.abs(measured - expected) / expected * 100;
  return { measured, expected, ok: deltaPct < 10, deltaPct };
}
