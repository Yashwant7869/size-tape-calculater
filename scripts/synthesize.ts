/* ─────────────────────────────────────────────
   scripts/synthesize.ts — synthetic dataset
   generator. Produces 1000 rows of plausible
   body-measurement / pixel-coord pairs.

   Usage:  npx tsx scripts/synthesize.ts > scripts/dataset-sample.csv
───────────────────────────────────────────── */

import { writeFileSync } from "node:fs";

interface SyntheticRow {
  gender: "male" | "female";
  heightCm: number;
  weightKg: number;
  trueWaistCm: number;
  trueChestCm: number;
  trueHipCm: number;
  imageW: number;
  imageH: number;
  frontPxLeft: number;
  frontPxRight: number;
  frontPxTop: number;
  frontPxBottom: number;
  frontShoulderW: number;
  frontHipW: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function generate(n: number): SyntheticRow[] {
  const rows: SyntheticRow[] = [];
  for (let i = 0; i < n; i++) {
    const gender: "male" | "female" = Math.random() < 0.5 ? "male" : "female";
    const heightCm = gender === "male" ? rand(155, 195) : rand(145, 180);
    const weightKg = gender === "male" ? rand(50, 110) : rand(40, 95);
    // BMI → rough waist estimate. Real population: waist ≈ 0.46 × height for BMI 22.
    const bmi = weightKg / Math.pow(heightCm / 100, 2);
    const baseWaistRatio = 0.40 + 0.012 * Math.max(0, bmi - 18);
    const trueWaistCm = heightCm * baseWaistRatio + rand(-2, 2);
    const trueChestCm = gender === "male"
      ? trueWaistCm * 1.16 + rand(-1.5, 1.5)
      : trueWaistCm * 1.22 + rand(-1.5, 1.5);
    const trueHipCm = gender === "male"
      ? trueWaistCm * 1.06 + rand(-1.5, 1.5)
      : trueWaistCm * 1.16 + rand(-1.5, 1.5);

    // Simulate photo at 720 × 1280 with the body taking ~70% of vertical extent.
    const imageW = 720, imageH = 1280;
    // Top of head and bottom of feet
    const topMargin = 0.05 + rand(0, 0.02);
    const bottomMargin = 0.03 + rand(0, 0.02);
    const frontPxTop = imageH * topMargin;
    const frontPxBottom = imageH * (1 - bottomMargin);
    const scaleCmPerPx = (heightCm * 0.93) / (frontPxBottom - frontPxTop);

    // Lateral diameter (l-r) ≈ waistCircumference / π for an "average" ellipse.
    // We use the relation: a + b ≈ C / π where a = lateral radius, b = depth radius.
    // For average depth/width ratio 0.8: a + 0.8a = 1.8a = C / π, so diameter = 2a = 2C / (π × 1.8)
    const lateralWaistCm = trueWaistCm / (Math.PI * 1.8) * 2;
    const trueWaistPxW = lateralWaistCm / scaleCmPerPx;
    const cx = imageW / 2;
    const cy = imageH * 0.55;
    const frontPxLeft = cx - trueWaistPxW / 2 + rand(-2, 2);
    const frontPxRight = cx + trueWaistPxW / 2 + rand(-2, 2);
    // Shoulder and hip are slightly wider than the waist.
    const shFactor = gender === "male" ? 1.38 : 1.30;
    const hipFactor = gender === "male" ? 1.15 : 1.22;
    const trueShoulderW = (lateralWaistCm * shFactor) / scaleCmPerPx;
    const trueHipWPx = (lateralWaistCm * hipFactor) / scaleCmPerPx;
    const frontShoulderW = trueShoulderW + rand(-2, 2);
    const frontHipW = trueHipWPx + rand(-2, 2);
    rows.push({
      gender, heightCm, weightKg,
      trueWaistCm, trueChestCm, trueHipCm,
      imageW, imageH,
      frontPxLeft, frontPxRight, frontPxTop, frontPxBottom,
      frontShoulderW, frontHipW,
    });
  }
  return rows;
}

const rows = generate(1000);
const header = [
  "gender", "heightCm", "weightKg",
  "trueWaistCm", "trueChestCm", "trueHipCm",
  "imageW", "imageH",
  "frontPxLeft", "frontPxRight", "frontPxTop", "frontPxBottom",
  "frontShoulderW", "frontHipW",
];
const csv = [
  header.join(","),
  ...rows.map((r) => header.map((h) => String((r as unknown as Record<string, unknown>)[h])).join(",")),
].join("\n");

const outPath = process.argv[2] ?? "scripts/dataset-sample.csv";
writeFileSync(outPath, csv);
console.error(`Wrote ${rows.length} rows to ${outPath}`);
