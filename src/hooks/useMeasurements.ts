/* ─────────────────────────────────────────────
   useMeasurements — the heart of the accuracy work.
   Given a loaded image, calibration, and the two
   photos, produces:
     - waist (cm) with uncertainty (±cm)
     - chest, hip, inseam, shoulder (cm) with uncertainty
     - somatotype
     - per-measurement confidence sub-scores
───────────────────────────────────────────── */

import {
  type KeypointWithNoise, type Gender, type SizeStr,
  keypointSigmaPx, pairWidthSigmaPx, widthUncertaintyCm,
  circumferenceFromEllipse, circumferenceFromWidth,
  circumferenceUncertaintyCm, somatotype as somatotypeFn,
  waistlineFraction, depthRatio, ORDER,
  plausibilityCheckWaist,
} from "../utils/measure";
import {
  sizeTable, waistRangeForSize,
  type GarmentClass, type Fit, type Region,
  pickBrandSize, type BrandMap,
} from "../utils/sizeTables";
import { imageQuality, type ImageQuality } from "../utils/imageAnalysis";
import { aggregateConfidence, type ConfidenceBreakdown } from "../utils/confidence";
import { calibrate, type CalibrationEstimate } from "../utils/calibration";

export interface DetectionResult {
  /** Keypoints returned by the model. */
  keypoints: KeypointWithNoise[];
  /** Image natural width/height. */
  imageW: number;
  imageH: number;
  /** Fractional Y of the natural waist (top=0, bottom=1). */
  waistYFrac: number;
  /** Fractional X of left/right torso edges at the waist. */
  leftFrac: number;
  rightFrac: number;
  /** Top of head and bottom of feet fractions (used for height calibration). */
  topFrac: number;
  bottomFrac: number;
  /** Average keypoint score, 0–100. */
  keypointAvg: number;
  /** Optional silhouette-derived width fractions (if segmentation succeeded). */
  silhouetteLeftFrac?: number;
  silhouetteRightFrac?: number;
  /** Image quality, if measured. */
  imageQuality?: ImageQuality;
  /** Was the auto-detected waist Y adjusted by the user? */
  userAdjustedWaist: boolean;
  /** Optional user-typed waist override (cm). */
  userWaistOverride?: number;
}

export interface Measurements {
  /** Waist circumference, cm. */
  waistCm: number;
  waistUncertaintyCm: number;
  /** Chest circumference, cm. */
  chestCm: number;
  chestUncertaintyCm: number;
  /** Hip circumference, cm. */
  hipCm: number;
  hipUncertaintyCm: number;
  /** Inseam length, cm. */
  inseamCm: number;
  inseamUncertaintyCm: number;
  /** Shoulder width, cm. */
  shoulderW: number;
  shoulderUncertaintyCm: number;
  /** Front silhouette width at waist (cm). */
  frontW: number;
  frontDepthCm: number;
  /** Somatotype. */
  somatotype: "ectomorph" | "mesomorph" | "endomorph";
  /** Confidence breakdown. */
  confidence: ConfidenceBreakdown;
  /** Calibration (combined). */
  calibration: CalibrationEstimate;
  /** Method used for the circumference. */
  method: "ellipse" | "single";
  /** Plausibility check. */
  plausibility: { ok: true } | { ok: false; reason: string };
}

export interface Inputs {
  gender: Gender;
  heightCm: number;
  /** Optional user-typed known waist. */
  userWaistOverride?: number;
  /** Front photo detection. */
  front: DetectionResult | null;
  /** Side photo detection. */
  side: DetectionResult | null;
  /** Calibration method for each photo. */
  frontCal: CalibrationEstimate;
  sideCal: CalibrationEstimate;
}

export function computeMeasurements(inputs: Inputs): Measurements | null {
  const { front, side, heightCm, gender } = inputs;
  if (!front && !inputs.userWaistOverride) return null;
  if (heightCm <= 0) return null;

  // 1. If user has a known waist, use it directly (zero-uncertainty ideal).
  if (inputs.userWaistOverride && inputs.userWaistOverride > 0) {
    return buildManualOverrideResult(inputs);
  }
  if (!front) return null;

  // 2. Calibration: use the supplied calibration estimates.
  const frontCal = inputs.frontCal;
  const sideCal = inputs.sideCal;
  if (frontCal.scaleCmPerPx <= 0) return null;

  // 3. Keypoints (optional) — the on-screen guides can stand in when
  //    auto-detection failed and the user positioned them manually.
  const byNameF: Record<string, KeypointWithNoise> = {};
  for (const k of front.keypoints) byNameF[k.name] = k;
  const ls = byNameF["left_shoulder"], rs = byNameF["right_shoulder"];
  const lh = byNameF["left_hip"],     rh = byNameF["right_hip"];
  const la = byNameF["left_ankle"],   ra = byNameF["right_ankle"];
  const hasPose = !!(ls && rs && lh && rh);

  // 4. Waist width — measure the on-screen guide (left/right handles).
  //    On successful detection the guide is initialised from the
  //    silhouette (or the keypoint baseline), so this equals the automatic
  //    measurement unless the user dragged a handle — either way the
  //    number matches what the user sees. Keypoint interpolation remains
  //    as a fallback for callers that supply no guide positions.
  const guideWpx = front.imageW > 0 && front.rightFrac > front.leftFrac
    ? (front.rightFrac - front.leftFrac) * front.imageW
    : 0;
  let waistWpx: number, waistWpxUnc: number;
  if (guideWpx > 0) {
    waistWpx = guideWpx;
    waistWpxUnc = hasPose || front.silhouetteLeftFrac !== undefined
      ? 3 * Math.SQRT2   // auto-initialised guide ≈ silhouette edge noise
      : 8 * Math.SQRT2;  // fully manual guide placement
  } else if (ls && rs && lh && rh) {
    // Keypoint-based approximation: interpolate from shoulder/hip
    const shoulderWpx = Math.hypot(rs.x - ls.x, rs.y - ls.y);
    const hipWpx = Math.hypot(rh.x - lh.x, rh.y - lh.y);
    waistWpx = hipWpx + (shoulderWpx - hipWpx) * 0.5;
    waistWpxUnc = Math.sqrt(pairWidthSigmaPx(lh, rh) ** 2 + pairWidthSigmaPx(ls, rs) ** 2);
  } else {
    // No width signal at all (e.g. no photo data).
    return null;
  }
  const frontW = waistWpx * frontCal.scaleCmPerPx;
  const frontWUnc = waistWpxUnc * frontCal.scaleCmPerPx;

  // 5. Shoulder & hip width — keypoint-based when available, otherwise
  //    population proportions around the measured waist.
  let shoulderW: number, shoulderUnc: number;
  let hipW: number, hipUnc: number;
  if (ls && rs && lh && rh) {
    const shoulderWpx = Math.hypot(rs.x - ls.x, rs.y - ls.y);
    const shoulderSigmaPx = pairWidthSigmaPx(ls, rs);
    shoulderW = shoulderWpx * frontCal.scaleCmPerPx;
    shoulderUnc = shoulderSigmaPx * frontCal.scaleCmPerPx;
    const hipWpx = Math.hypot(rh.x - lh.x, rh.y - lh.y);
    const hipSigmaPx = pairWidthSigmaPx(lh, rh);
    hipW = hipWpx * frontCal.scaleCmPerPx;
    hipUnc = hipSigmaPx * frontCal.scaleCmPerPx;
  } else {
    // No pose keypoints: derive from the waist using the same ratios as
    // buildManualOverrideResult (relative to waist circumference).
    // depthRatio() is scale-invariant, so relative widths are enough to
    // size the provisional circumference first.
    const shRel = gender === "male" ? 0.78 : 0.72;
    const hipRel = gender === "male" ? 1.08 : 1.18;
    const waistProv = circumferenceFromWidth(frontW, shRel, hipRel);
    shoulderW = waistProv * shRel;
    shoulderUnc = waistProv * shRel * 0.12 + 2;
    hipW = waistProv * hipRel;
    hipUnc = waistProv * hipRel * 0.10 + 2;
  }

  // 7. Circumference — ellipse if side photo available, else body-shape estimate
  let waistCm = 0, waistUncCm = 0, method: "ellipse" | "single";
  let frontDepthCm = 0;
  if (side && sideCal.scaleCmPerPx > 0) {
    // Side depth: silhouette when available, otherwise the on-screen
    // side-photo guide the user can position manually.
    const sideGuidePx = side.imageW > 0 && side.rightFrac > side.leftFrac
      ? (side.rightFrac - side.leftFrac) * side.imageW
      : 0;
    const depthPx =
      side.silhouetteLeftFrac !== undefined && side.silhouetteRightFrac !== undefined
        ? (side.silhouetteRightFrac - side.silhouetteLeftFrac) * side.imageW
        : sideGuidePx;
    if (depthPx > 0) {
      frontDepthCm = depthPx * sideCal.scaleCmPerPx;
      const depthSigmaPx =
        side.silhouetteLeftFrac !== undefined ? 3 * Math.SQRT2 : 6;
      const depthUnc = depthSigmaPx * sideCal.scaleCmPerPx;
      waistCm = circumferenceFromEllipse(frontW, frontDepthCm);
      waistUncCm = circumferenceUncertaintyCm(frontW, frontWUnc, frontDepthCm, depthUnc);
      method = "ellipse";
    } else {
      // No usable side depth — fall back to single photo
      waistCm = circumferenceFromWidth(frontW, shoulderW, hipW);
      waistUncCm = frontWUnc * 1.6; // ~60% extra uncertainty for assumed depth
      method = "single";
    }
  } else {
    waistCm = circumferenceFromWidth(frontW, shoulderW, hipW);
    waistUncCm = frontWUnc * 1.6;
    method = "single";
  }

  // 8. Chest and hip circumferences
  // Without a true "chest" keypoint, we approximate chest diameter
  // from shoulder width. For most adults, chest_diameter ≈ 0.95× shoulder
  // (shoulder is slightly wider due to deltoid muscles). The chest
  // depth/width ratio is ~0.70, so the conversion factor from diameter
  // to circumference is ~2.7.
  const chestWDiameterCm = shoulderW * 0.95;
  const chestCm = chestWDiameterCm * 2.7;
  const chestUnc = shoulderUnc * 0.95 * 2.7 + 3;
  // Hip circumference — hip_diameter × ~2.55 (deeper body at the hips).
  const hipCircCm = hipW * 2.55;
  const hipCircUnc = hipUnc * 2.55 + 3;

  // 9. Inseam: ankle - hip keypoint vertical distance
  let inseamCm = 0, inseamUnc = 0;
  if (la && ra && lh && rh) {
    const ankleY = (la.y + ra.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const inseamPx = ankleY - hipY;
    inseamCm = inseamPx * frontCal.scaleCmPerPx;
    inseamUnc = Math.sqrt(keypointSigmaPx(la) ** 2 + keypointSigmaPx(ra) ** 2) * frontCal.scaleCmPerPx + 0.5;
  } else if (heightCm > 0) {
    // No leg keypoints — population estimate from height.
    inseamCm = heightCm * 0.45;
    inseamUnc = heightCm * 0.03 + 2;
  }

  // 10. Somatotype
  const som = somatotypeFn(shoulderW, waistCm, hipCircCm);

  // 11. Confidence breakdown
  const plausibility = plausibilityCheckWaist(waistCm, heightCm, gender);
  const plausibilityScore = plausibility.ok ? 95 : 30;
  // No keypoints → the measurement rests on the user's manual guide
  // placement alone: degrade the pose score to reflect that honestly.
  const poseScore = hasPose ? front.keypointAvg : 25;
  const scaleScore = frontCal.scaleCmPerPx > 0
    ? Math.max(0, 100 - (frontCal.varianceCmPerPx / Math.max(1e-6, frontCal.scaleCmPerPx)) * 100 * 5)
    : 50;
  const imageScore = front.imageQuality
    ? (front.imageQuality.sharpness * 0.5 +
       front.imageQuality.lightingUniformity * 0.3 +
       front.imageQuality.bgContrast * 0.2)
    : 60;
  const confidence = aggregateConfidence(poseScore, scaleScore, imageScore, plausibilityScore);

  return {
    waistCm, waistUncertaintyCm: waistUncCm,
    chestCm, chestUncertaintyCm: chestUnc,
    hipCm: hipCircCm, hipUncertaintyCm: hipCircUnc,
    inseamCm, inseamUncertaintyCm: inseamUnc,
    shoulderW, shoulderUncertaintyCm: shoulderUnc,
    frontW,
    frontDepthCm,
    somatotype: som,
    confidence,
    calibration: frontCal,
    method,
    plausibility,
  };
}

function buildManualOverrideResult(inputs: Inputs): Measurements | null {
  if (!inputs.userWaistOverride || inputs.userWaistOverride <= 0) return null;
  const w = inputs.userWaistOverride;
  // No keypoint data — best guess on other measurements from height.
  const h = inputs.heightCm;
  const gender = inputs.gender;
  // Population average chest/hip/shoulder for the given waist.
  // These are rough but reasonable.
  const chestCm = gender === "male" ? w * 1.30 : w * 1.32;
  const hipCm   = gender === "male" ? w * 1.08 : w * 1.18;
  const shoulderW = gender === "male" ? w * 0.78 : w * 0.72;
  const inseamCm = h * 0.45;
  const plausibility = plausibilityCheckWaist(w, h, gender);
  const confidence = aggregateConfidence(
    80, 95, 100, plausibility.ok ? 95 : 30
  );
  return {
    waistCm: w, waistUncertaintyCm: 0.5,
    chestCm, chestUncertaintyCm: 3,
    hipCm, hipUncertaintyCm: 3,
    inseamCm, inseamUncertaintyCm: 2,
    shoulderW, shoulderUncertaintyCm: 2,
    frontW: w / 2, frontDepthCm: w * 0.27,
    somatotype: "mesomorph",
    confidence,
    calibration: { scaleCmPerPx: 0, varianceCmPerPx: 0, perRef: {} },
    method: "single",
    plausibility,
  };
}

/* ─────────────────────────────────────────────
   Recommend sizes for each garment class.
───────────────────────────────────────────── */
export interface Recommendations {
  bottom: SizeStr;
  top: SizeStr;
  outerwear: SizeStr;
  dress: SizeStr;
  /** Source: photo | manual | bmi */
  source: "photo" | "manual" | "bmi";
}

export function recommendSizes(
  m: Measurements | null,
  bmiSize: SizeStr | null,
  heightCm: number,
  gender: Gender,
  fit: Fit,
  region: Region,
  brandMap?: BrandMap,
  brand?: string | null
): Recommendations | null {
  if (!m) return null;
  const source: Recommendations["source"] = m.calibration.scaleCmPerPx > 0 ? "photo" : "manual";
  const waistRatio = m.waistCm / heightCm;
  const chestRatio = m.chestCm / heightCm;

  // Brand override (per-garment) — if a brand row exists, prefer it.
  const overrideBottom = brand ? pickBrandSize(brandMap, brand, m.waistCm, "bottom") : null;
  const overrideTop = brand ? pickBrandSize(brandMap, brand, m.chestCm, "top") : null;

  const bottom = overrideBottom
    ?? sizeTable(gender, "bottom", fit, region).pick(waistRatio);
  const top = overrideTop
    ?? sizeTable(gender, "top", fit, region).pick(chestRatio);
  const outerwear = overrideTop
    ?? sizeTable(gender, "outerwear", fit, region).pick(chestRatio);
  const dress = sizeTable(gender, "dress", fit, region).pick(chestRatio);

  return { bottom, top, outerwear, dress, source };
}

export { waistRangeForSize, ORDER };
