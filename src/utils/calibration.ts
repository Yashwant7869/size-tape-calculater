/* ─────────────────────────────────────────────
   Calibration math: card + height, with weighted
   averaging and per-reference variance (§2.1, §2.2).
───────────────────────────────────────────── */

export const CARD_WIDTH_CM = 8.56;
export const CARD_HEIGHT_CM = 5.398;
export const CARD_ASPECT = CARD_WIDTH_CM / CARD_HEIGHT_CM;

export type Reference = "card" | "height" | "A4" | "coin";

export interface CalibrationInput {
  method: Reference;
  /** Pixel length of the chosen reference on the photo. */
  pxLength: number;
  /** Real-world cm of the reference. */
  cmLength: number;
}

export interface CalibrationEstimate {
  scaleCmPerPx: number;       // combined scale
  varianceCmPerPx: number;    // ±1σ
  /** Per-reference scale, for inspection. */
  perRef: Record<string, number>;
}

export function calibrate(refs: CalibrationInput[]): CalibrationEstimate {
  if (refs.length === 0) {
    return { scaleCmPerPx: 0, varianceCmPerPx: 0, perRef: {} };
  }
  const perRef: Record<string, number> = {};
  let sumW = 0, sumWx = 0;
  for (const r of refs) {
    if (r.pxLength <= 0 || r.cmLength <= 0) continue;
    const s = r.cmLength / r.pxLength;
    perRef[r.method] = s;
    // Weight: card is more precise than user-reported height.
    // Empirical weights: card = 1.0, height = 0.4, A4 = 0.9, coin = 0.7
    const w = r.method === "card" ? 1.0
            : r.method === "A4"   ? 0.9
            : r.method === "coin" ? 0.7
            :                       0.4;
    sumW += w; sumWx += w * s;
  }
  const mean = sumWx / Math.max(1e-6, sumW);

  // Variance: sum of (w * (s − mean)^2) / sum(w)
  let v = 0;
  for (const r of refs) {
    if (r.pxLength <= 0 || r.cmLength <= 0) continue;
    const s = r.cmLength / r.pxLength;
    const w = r.method === "card" ? 1.0
            : r.method === "A4"   ? 0.9
            : r.method === "coin" ? 0.7
            :                       0.4;
    v += w * (s - mean) ** 2;
  }
  const varianceCmPerPx = Math.sqrt(v / Math.max(1e-6, sumW));

  return { scaleCmPerPx: mean, varianceCmPerPx, perRef };
}

/* Reference dimensions for non-card objects. */
export const REFERENCE_CM: Record<Exclude<Reference, "height">, [number, number]> = {
  card: [CARD_WIDTH_CM, CARD_HEIGHT_CM],   // short edge × long edge
  A4:   [21.0, 29.7],                      // A4 paper
  coin: [2.35, 2.35],                      // 1 INR / €1 / 1 USD coin ≈ 23.5 mm
};
