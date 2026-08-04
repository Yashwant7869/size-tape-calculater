/* ─────────────────────────────────────────────
   scripts/evaluate.ts — ground-truth evaluation
   harness. Reads a labelled CSV and reports
   MAE / RMSE / size-match accuracy for the
   measurement pipeline.

   Usage:  npx tsx scripts/evaluate.ts path/to/dataset.csv
───────────────────────────────────────────── */

import { readFileSync } from "node:fs";
import { computeMeasurements, type DetectionResult } from "../src/hooks/useMeasurements";
import { calibrate } from "../src/utils/calibration";
import { circumferenceFromEllipse } from "../src/utils/measure";
import { sizeFromWaistRatio } from "../src/utils/sizeTables";

interface Row {
  gender: "male" | "female";
  heightCm: number;
  trueWaistCm: number;
  trueChestCm: number;
  trueHipCm: number;
  // Optional: per-photo detection summaries.
  // We accept the bounding-box (left/right/top/bottom, in pixels)
  // plus the keypoint-derived shoulder/hip width in pixels.
  frontPxLeft: number; frontPxRight: number;
  frontPxTop: number; frontPxBottom: number;
  frontShoulderW: number; frontHipW: number;
  imageW: number; imageH: number;
  sidePxLeft?: number; sidePxRight?: number;
  sidePxTop?: number; sidePxBottom?: number;
}

function main() {
  const csvPath = process.argv[2] ?? "scripts/dataset-sample.csv";
  const csv = readFileSync(csvPath, "utf-8");
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const rows: Row[] = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const o: Record<string, string | number> = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o as unknown as Row;
  });

  let waistErr = 0, waistSq = 0, chestErr = 0, hipErr = 0;
  let bottomHit = 0, bottomOff1 = 0;
  let topHit = 0, topOff1 = 0;
  let outHit = 0, outOff1 = 0;
  let dressHit = 0, dressOff1 = 0;
  let n = 0;
  const sizes = ["XS","S","M","L","XL","XXL","XXXL"];

  for (const r of rows) {
    // Build synthetic DetectionResults from CSV cells.
    const cal = calibrate([
      { method: "height", pxLength: r.frontPxBottom - r.frontPxTop, cmLength: r.heightCm * 0.93 },
    ]);
    const frontKP = [
      { name: "left_shoulder",  x: r.imageW / 2 - r.frontShoulderW / 2, y: 0, score: 0.9 },
      { name: "right_shoulder", x: r.imageW / 2 + r.frontShoulderW / 2, y: 0, score: 0.9 },
      { name: "left_hip",       x: r.imageW / 2 - r.frontHipW / 2,      y: 0, score: 0.85 },
      { name: "right_hip",      x: r.imageW / 2 + r.frontHipW / 2,      y: 0, score: 0.85 },
      { name: "left_ankle",     x: r.imageW / 2, y: r.imageH,            score: 0.8 },
      { name: "right_ankle",    x: r.imageW / 2, y: r.imageH,            score: 0.8 },
    ];
    const front: DetectionResult = {
      keypoints: frontKP as { x: number; y: number; score: number; name: string }[],
      imageW: r.imageW, imageH: r.imageH,
      waistYFrac: 0.55, leftFrac: r.frontPxLeft / r.imageW,
      rightFrac: r.frontPxRight / r.imageW,
      topFrac: r.frontPxTop / r.imageH, bottomFrac: r.frontPxBottom / r.imageH,
      keypointAvg: 0.86,
      silhouetteLeftFrac: r.frontPxLeft / r.imageW,
      silhouetteRightFrac: r.frontPxRight / r.imageW,
      userAdjustedWaist: false,
    };
    const m = computeMeasurements({
      gender: r.gender,
      heightCm: r.heightCm,
      front,
      side: null,
      frontCal: cal,
      sideCal: { scaleCmPerPx: 0, varianceCmPerPx: 0, perRef: {} },
    });
    if (!m) { continue; }
    n++;
    const dW = m.waistCm - r.trueWaistCm;
    waistErr += Math.abs(dW);
    waistSq += dW * dW;
    chestErr += Math.abs(m.chestCm - r.trueChestCm);
    hipErr += Math.abs(m.hipCm - r.trueHipCm);

    // Bottom
    const bPhoto = sizeFromWaistRatio(m.waistCm / r.heightCm, r.gender, "bottom", "regular", "US");
    const bTruth = sizeFromWaistRatio(r.trueWaistCm / r.heightCm, r.gender, "bottom", "regular", "US");
    if (bPhoto === bTruth) bottomHit++;
    else if (Math.abs(sizes.indexOf(bPhoto) - sizes.indexOf(bTruth)) === 1) bottomOff1++;

    // Top
    const tPhoto = sizeFromWaistRatio(m.chestCm / r.heightCm, r.gender, "top", "regular", "US");
    const tTruth = sizeFromWaistRatio(r.trueChestCm / r.heightCm, r.gender, "top", "regular", "US");
    if (tPhoto === tTruth) topHit++;
    else if (Math.abs(sizes.indexOf(tPhoto) - sizes.indexOf(tTruth)) === 1) topOff1++;

    // Outerwear
    const oPhoto = sizeFromWaistRatio(m.chestCm / r.heightCm, r.gender, "outerwear", "regular", "US");
    const oTruth = sizeFromWaistRatio(r.trueChestCm / r.heightCm, r.gender, "outerwear", "regular", "US");
    if (oPhoto === oTruth) outHit++;
    else if (Math.abs(sizes.indexOf(oPhoto) - sizes.indexOf(oTruth)) === 1) outOff1++;

    // Dress
    const dPhoto = sizeFromWaistRatio(m.chestCm / r.heightCm, r.gender, "dress", "regular", "US");
    const dTruth = sizeFromWaistRatio(r.trueChestCm / r.heightCm, r.gender, "dress", "regular", "US");
    if (dPhoto === dTruth) dressHit++;
    else if (Math.abs(sizes.indexOf(dPhoto) - sizes.indexOf(dTruth)) === 1) dressOff1++;
  }
  console.log(`n = ${n}`);
  console.log(`Waist MAE:        ${(waistErr / n).toFixed(2)} cm`);
  console.log(`Waist RMSE:       ${Math.sqrt(waistSq / n).toFixed(2)} cm`);
  console.log(`Chest MAE:        ${(chestErr / n).toFixed(2)} cm`);
  console.log(`Hip MAE:          ${(hipErr / n).toFixed(2)} cm`);
  console.log(`Bottom exact:     ${(bottomHit / n * 100).toFixed(1)}% | ±1: ${((bottomHit + bottomOff1) / n * 100).toFixed(1)}%`);
  console.log(`Top exact:        ${(topHit / n * 100).toFixed(1)}% | ±1: ${((topHit + topOff1) / n * 100).toFixed(1)}%`);
  console.log(`Outerwear exact:  ${(outHit / n * 100).toFixed(1)}% | ±1: ${((outHit + outOff1) / n * 100).toFixed(1)}%`);
  console.log(`Dress exact:      ${(dressHit / n * 100).toFixed(1)}% | ±1: ${((dressHit + dressOff1) / n * 100).toFixed(1)}%`);
}

main();

// Reference to silence unused-import warning (used in synthetic dataset).
export { circumferenceFromEllipse };
