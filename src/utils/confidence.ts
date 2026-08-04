/* ─────────────────────────────────────────────
   §5.1 / §5.2 — decompose confidence into sub-scores
   and provide a continuous, geometric-mean aggregate.
───────────────────────────────────────────── */

export interface ConfidenceBreakdown {
  pose: number;          // 0–100
  scale: number;         // 0–100
  image: number;         // 0–100
  plausibility: number;  // 0–100
  /** Weighted geometric mean. */
  overall: number;
  /** Single-character traffic light. */
  level: "low" | "medium" | "high";
}

const WEIGHTS = { pose: 0.35, scale: 0.30, image: 0.15, plausibility: 0.20 };

export function aggregateConfidence(
  pose: number, scale: number, image: number, plausibility: number
): ConfidenceBreakdown {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const p = clamp(pose), s = clamp(scale), i = clamp(image), pl = clamp(plausibility);
  // Geometric mean (in log space, then exp). Avoid log(0) by flooring at 1.
  const wsum = WEIGHTS.pose + WEIGHTS.scale + WEIGHTS.image + WEIGHTS.plausibility;
  const log =
    (WEIGHTS.pose * Math.log(Math.max(1, p)) +
     WEIGHTS.scale * Math.log(Math.max(1, s)) +
     WEIGHTS.image * Math.log(Math.max(1, i)) +
     WEIGHTS.plausibility * Math.log(Math.max(1, pl))) / wsum;
  const overall = Math.round(Math.exp(log));
  const level: "low" | "medium" | "high" =
    overall >= 75 ? "high" : overall >= 50 ? "medium" : "low";
  return { pose: p, scale: s, image: i, plausibility: pl, overall, level };
}

/* Continuous confidence delta — used for the
   "details vs photo" alignment flag. */
export function agreementConfidence(sizeIdxPhoto: number, sizeIdxBmi: number): number {
  const diff = Math.abs(sizeIdxPhoto - sizeIdxBmi);
  // 0 diff → 100, 1 diff → 75, 2 diff → 50, 3+ diff → 25
  if (diff === 0) return 100;
  if (diff === 1) return 75;
  if (diff === 2) return 50;
  return 25;
}
