/* ─────────────────────────────────────────────
   Pure measurement math (no React, no DOM, no TF).
   Kept side-effect-free so it can be:
   - unit-tested with a labelled dataset
   - run in Node (scripts/evaluate.ts, scripts/synthesize.ts)
   - reused across the worker / main thread
───────────────────────────────────────────── */

export type Gender = "male" | "female";

export type SizeStr =
  | "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL";

export const ORDER: SizeStr[] = [
  "XS", "S", "M", "L", "XL", "XXL", "XXXL"
];

/* ─────────────────────────────────────────────
   Geometry
───────────────────────────────────────────── */

/** Ramanujan's second approximation for ellipse circumference.
 *  Accurate to ~0.04% across all aspect ratios. */
export function ellipseCircumference(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const h = Math.pow(a - b, 2) / Math.pow(a + b, 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/* ─────────────────────────────────────────────
   §3.1 — body-shape-aware waistline placement
   Returns the fractional position of the natural waistline
   between shoulderY (1.0) and hipY (0.0).
   Apple/pear/athletic builds move the waist differently.
───────────────────────────────────────────── */
export function waistlineFraction(shoulderW: number, hipW: number): number {
  if (shoulderW <= 0 || hipW <= 0) return 0.20;
  // Normalised width difference. Positive = broader shoulders than hips.
  const ratio = (shoulderW - hipW) / (shoulderW + hipW);
  // 0.18 (pear) … 0.22 (apple/athletic)
  return 0.20 + 0.10 * ratio;
}

/* ─────────────────────────────────────────────
   §3.3 — body-shape-aware depth/width ratio.
   Used when only one photo is available, to estimate the
   side-view depth from the front-view width.

   Empirical: at the natural waistline, the human torso is
   not a flat slab — its depth is ~75–85% of its width.
   Body shape modulates this by ±10%.
───────────────────────────────────────────── */
export function depthRatio(shoulderW: number, hipW: number): number {
  if (shoulderW <= 0 || hipW <= 0) return 0.80;
  const ratio = (shoulderW - hipW) / (shoulderW + hipW);
  // Range: 0.70 (pear) … 0.90 (athletic/mesomorph)
  const k = 0.80 + 0.20 * ratio;
  return Math.max(0.70, Math.min(0.95, k));
}

/* ─────────────────────────────────────────────
   Circumference from a single front width.
───────────────────────────────────────────── */
export function circumferenceFromWidth(
  widthCm: number,
  shoulderW: number,
  hipW: number
): number {
  if (widthCm <= 0) return 0;
  const b = (widthCm / 2) * depthRatio(shoulderW, hipW);
  return ellipseCircumference(widthCm / 2, b);
}

/* ─────────────────────────────────────────────
   Circumference from front width + side depth.
───────────────────────────────────────────── */
export function circumferenceFromEllipse(
  widthCm: number,
  depthCm: number
): number {
  if (widthCm <= 0 || depthCm <= 0) return 0;
  return ellipseCircumference(widthCm / 2, depthCm / 2);
}

/* ─────────────────────────────────────────────
   §3.7 — plausibility check on final waist.
   Returns { ok, reason? }. Flags anything outside the
   population range, scaled by height.
───────────────────────────────────────────── */
export function plausibilityCheckWaist(
  waistCm: number,
  heightCm: number,
  gender: Gender
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(waistCm) || waistCm <= 0) {
    return { ok: false, reason: "no measurement" };
  }

  // Population ranges: roughly waist-to-height 0.40 … 0.65
  const ratio = waistCm / Math.max(heightCm, 1);
  if (ratio < 0.36) {
    return { ok: false, reason: "waist is unusually small for this height" };
  }
  if (ratio > 0.70) {
    return { ok: false, reason: "waist is unusually large for this height" };
  }

  // Absolute sanity bands (very generous, in cm)
  const [lo, hi] =
    gender === "male" ? [55, 160] : [50, 150];
  if (waistCm < lo) {
    return { ok: false, reason: `waist below ${lo} cm is rare` };
  }
  if (waistCm > hi) {
    return { ok: false, reason: `waist above ${hi} cm is rare` };
  }

  return { ok: true };
}

/* ─────────────────────────────────────────────
   §5.5 — Gaussian error propagation helpers.
   All keypoint noise is in pixels; we scale it to cm
   using the per-image scale factor.
───────────────────────────────────────────── */

export interface KeypointWithNoise {
  x: number;
  y: number;
  score: number;
  name: string;
}

export function keypointSigmaPx(kp: KeypointWithNoise): number {
  // Lower score → more noise. Empirically tuned to MoveNet.
  // score=1.0 → 1.5 px, score=0.3 → ~12 px, score=0.1 → ~30 px.
  return 1.5 + 30 * Math.pow(Math.max(0, 1 - kp.score), 2);
}

export function pairWidthSigmaPx(
  a: KeypointWithNoise,
  b: KeypointWithNoise
): number {
  return Math.sqrt(
    keypointSigmaPx(a) ** 2 + keypointSigmaPx(b) ** 2
  );
}

/** Returns ±1σ in cm for a width measured between two keypoints. */
export function widthUncertaintyCm(
  a: KeypointWithNoise,
  b: KeypointWithNoise,
  scaleCmPerPx: number
): number {
  return pairWidthSigmaPx(a, b) * scaleCmPerPx;
}

/** Propagate uncertainty through the Ramanujan ellipse.
 *  Linear approximation — exact enough for ±range display. */
export function circumferenceUncertaintyCm(
  widthCm: number,
  widthSigmaCm: number,
  depthCm: number,
  depthSigmaCm: number
): number {
  if (widthCm <= 0 || depthCm <= 0) return 0;
  // dC/da and dC/db for an ellipse, evaluated at (a, b).
  const a = widthCm / 2;
  const b = depthCm / 2;
  const e = ellipseCircumference(a, b);
  // Numerical partial derivatives.
  const eps = 0.01; // 0.01 cm
  const dCda =
    (ellipseCircumference(a + eps, b) - ellipseCircumference(a - eps, b)) /
    (2 * eps);
  const dCdb =
    (ellipseCircumference(a, b + eps) - ellipseCircumference(a - eps, b)) /
    (2 * eps);
  return Math.sqrt(
    (dCda * widthSigmaCm / 2) ** 2 + (dCdb * depthSigmaCm / 2) ** 2
  );
}

/* ─────────────────────────────────────────────
   §4.4 — somatotype classification (ectomorph /
   mesomorph / endomorph) from measured widths.
───────────────────────────────────────────── */
export type Somatotype = "ectomorph" | "mesomorph" | "endomorph";

export function somatotype(
  shoulderW: number,
  waistW: number,
  hipW: number
): Somatotype {
  if (shoulderW <= 0 || waistW <= 0 || hipW <= 0) return "mesomorph";
  const whr = waistW / hipW;
  const shr = shoulderW / hipW;
  if (whr < 0.80 && shr > 1.10) return "mesomorph";
  if (whr > 0.90) return "endomorph";
  if (shr < 0.95 && whr < 0.85) return "ectomorph";
  return "mesomorph";
}

/** Nudge (in size steps) the recommendation by somatotype. */
export function somatotypeNudge(s: Somatotype): number {
  switch (s) {
    case "ectomorph": return -0.5;  // lean: pick slightly tighter
    case "mesomorph": return 0;
    case "endomorph": return 0.5;  // fuller: pick slightly larger
  }
}
