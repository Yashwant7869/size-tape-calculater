/* ─────────────────────────────────────────────
   Size tables, region/brand-aware.
   Each row maps a clothing size to a recommended
   waist or chest range in cm. Range varies by fit
   (Slim / Regular / Relaxed) and garment class
   (bottom, top, outerwear, dress).
───────────────────────────────────────────── */

import type { Gender, SizeStr } from "./measure";

export type Fit = "slim" | "regular" | "relaxed";
export type Region = "US" | "UK" | "EU" | "IN" | "JP" | "CN" | "AU";
export type GarmentClass =
  | "bottom"    // trousers, jeans, skirts
  | "top"       // shirts, t-shirts, blouses
  | "outerwear" // jackets, coats, hoodies
  | "dress";    // dresses, gowns, jumpsuits, formal wear

/* ─────────────────────────────────────────────
   Population-average measurement-to-height ratios per size.
   Bottoms use waist-to-height ratio.
   Tops, outerwear, and dresses use chest/bust-to-height ratio.
───────────────────────────────────────────── */
export interface SizeRow {
  size: SizeStr;
  waistMax: number; // upper bound of measurement/height for this size
}

/* ─────────────────────────────────────────────
   1. Bottoms (Waist-to-Height Ratio)
───────────────────────────────────────────── */
const MEN_BOTTOM: SizeRow[] = [
  { size: "XS",  waistMax: 0.420 },
  { size: "S",   waistMax: 0.460 },
  { size: "M",   waistMax: 0.505 },
  { size: "L",   waistMax: 0.555 },
  { size: "XL",  waistMax: 0.610 },
  { size: "XXL", waistMax: 0.670 },
];

const WOMEN_BOTTOM: SizeRow[] = [
  { size: "XS",  waistMax: 0.395 },
  { size: "S",   waistMax: 0.430 },
  { size: "M",   waistMax: 0.470 },
  { size: "L",   waistMax: 0.515 },
  { size: "XL",  waistMax: 0.575 },
  { size: "XXL", waistMax: 0.635 },
];

/* ─────────────────────────────────────────────
   2. Tops (Chest-to-Height Ratio)
───────────────────────────────────────────── */
const MEN_TOP: SizeRow[] = [
  { size: "XS",  waistMax: 0.495 },
  { size: "S",   waistMax: 0.540 },
  { size: "M",   waistMax: 0.590 },
  { size: "L",   waistMax: 0.640 },
  { size: "XL",  waistMax: 0.690 },
  { size: "XXL", waistMax: 0.740 },
];

const WOMEN_TOP: SizeRow[] = [
  { size: "XS",  waistMax: 0.495 },
  { size: "S",   waistMax: 0.535 },
  { size: "M",   waistMax: 0.575 },
  { size: "L",   waistMax: 0.625 },
  { size: "XL",  waistMax: 0.680 },
  { size: "XXL", waistMax: 0.735 },
];

/* ─────────────────────────────────────────────
   3. Outerwear (Chest-to-Height Ratio, with Layering Ease)
───────────────────────────────────────────── */
const MEN_OUTERWEAR: SizeRow[] = [
  { size: "XS",  waistMax: 0.510 },
  { size: "S",   waistMax: 0.555 },
  { size: "M",   waistMax: 0.605 },
  { size: "L",   waistMax: 0.655 },
  { size: "XL",  waistMax: 0.705 },
  { size: "XXL", waistMax: 0.755 },
];

const WOMEN_OUTERWEAR: SizeRow[] = [
  { size: "XS",  waistMax: 0.510 },
  { size: "S",   waistMax: 0.550 },
  { size: "M",   waistMax: 0.590 },
  { size: "L",   waistMax: 0.640 },
  { size: "XL",  waistMax: 0.695 },
  { size: "XXL", waistMax: 0.750 },
];

/* ─────────────────────────────────────────────
   4. Dresses & Formal Wear (Chest/Bust-to-Height Ratio, Tailored)
───────────────────────────────────────────── */
const MEN_DRESS: SizeRow[] = [
  { size: "XS",  waistMax: 0.485 },
  { size: "S",   waistMax: 0.535 },
  { size: "M",   waistMax: 0.585 },
  { size: "L",   waistMax: 0.635 },
  { size: "XL",  waistMax: 0.685 },
  { size: "XXL", waistMax: 0.735 },
];

const WOMEN_DRESS: SizeRow[] = [
  { size: "XS",  waistMax: 0.485 },
  { size: "S",   waistMax: 0.525 },
  { size: "M",   waistMax: 0.565 },
  { size: "L",   waistMax: 0.615 },
  { size: "XL",  waistMax: 0.670 },
  { size: "XXL", waistMax: 0.725 },
];

/* Fit adjustment to the upper bound of each size. */
function withFit(rows: SizeRow[], fit: Fit): SizeRow[] {
  // Slim: tighten the upper bound (smaller measurement fits in same size)
  // Relaxed: loosen it
  const delta = fit === "slim" ? -0.015 : fit === "relaxed" ? 0.020 : 0;
  return rows.map(r => ({ ...r, waistMax: +(r.waistMax + delta).toFixed(4) }));
}

/* Region adjustment. Numbers from published brand-size tables.
   IN/JP/CN sizes run smaller than US/EU for the same measurement. */
function withRegion(rows: SizeRow[], region: Region): SizeRow[] {
  const shift: Record<Region, number> = {
    US:  0,
    UK:  0,
    EU:  0.005,
    AU:  0,
    IN: -0.020,  // Indian sizes ≈ 1 size smaller
    JP: -0.025,  // JP sizes run smaller
    CN: -0.025,  // CN sizes run smaller
  };
  return rows.map(r => ({ ...r, waistMax: +(r.waistMax + shift[region]).toFixed(4) }));
}

/* ─────────────────────────────────────────────
   Public API
───────────────────────────────────────────── */
export interface SizeTable {
  rows: SizeRow[];
  /** Pick the size whose [0, waistMax] band contains the ratio. */
  pick: (ratio: number) => SizeStr;
}

function buildTable(rows: SizeRow[]): SizeTable {
  return {
    rows,
    pick: (ratio: number): SizeStr => {
      for (const r of rows) {
        if (ratio <= r.waistMax) return r.size;
      }
      return "XXXL";
    }
  };
}

export function sizeTable(
  gender: Gender,
  garment: GarmentClass,
  fit: Fit,
  region: Region
): SizeTable {
  let baseRows: SizeRow[];
  switch (garment) {
    case "bottom":
      baseRows = gender === "male" ? MEN_BOTTOM : WOMEN_BOTTOM;
      break;
    case "top":
      baseRows = gender === "male" ? MEN_TOP : WOMEN_TOP;
      break;
    case "outerwear":
      baseRows = gender === "male" ? MEN_OUTERWEAR : WOMEN_OUTERWEAR;
      break;
    case "dress":
      baseRows = gender === "male" ? MEN_DRESS : WOMEN_DRESS;
      break;
    default:
      baseRows = gender === "male" ? MEN_BOTTOM : WOMEN_BOTTOM;
  }
  return buildTable(withRegion(withFit(baseRows, fit), region));
}

export function waistRangeForSize(
  table: SizeTable,
  size: SizeStr,
  heightCm: number
): [number, number] {
  let prevMax = 0;
  for (const r of table.rows) {
    if (r.size === size) {
      return [
        Math.round(prevMax * heightCm),
        Math.round(r.waistMax * heightCm)
      ];
    }
    prevMax = r.waistMax;
  }
  // size is beyond the table — return a wide default
  return [
    Math.round(prevMax * heightCm),
    Math.round(prevMax * heightCm * 1.15)
  ];
}

export function sizeFromWaistRatio(
  ratio: number,
  gender: Gender,
  garment: GarmentClass = "bottom",
  fit: Fit = "regular",
  region: Region = "US"
): SizeStr {
  return sizeTable(gender, garment, fit, region).pick(ratio);
}

/* ─────────────────────────────────────────────
   Brand overrides (consumer or maintainer can ship a
   JSON like { "zara": { "M": { waist: [78, 84] } } }).
   If no override matches, fall back to population table.
───────────────────────────────────────────── */
export interface BrandOverride {
  [size: string]: { waist?: [number, number]; chest?: [number, number]; hip?: [number, number] };
}
export interface BrandMap {
  [brand: string]: BrandOverride;
}

export function pickBrandSize(
  brandMap: BrandMap | undefined,
  brand: string | null,
  measurementCm: number,
  garment: GarmentClass
): SizeStr | null {
  if (!brand || !brandMap || !brandMap[brand]) return null;
  const override = brandMap[brand];
  const key = garment === "bottom" ? "waist" : "chest";
  for (const [size, ranges] of Object.entries(override)) {
    const band = ranges[key as keyof BrandOverride[string]];
    if (band && measurementCm >= band[0] && measurementCm <= band[1]) {
      return size as SizeStr;
    }
  }
  return null;
}
