/* ─────────────────────────────────────────────
   Size tables, region/brand-aware.
   Each row maps a clothing size to a recommended
   waist range in cm. Range varies by fit (Slim /
   Regular / Relaxed).
───────────────────────────────────────────── */

import type { Gender, SizeStr } from "./measure";

export type Fit = "slim" | "regular" | "relaxed";
export type Region = "US" | "UK" | "EU" | "IN" | "JP" | "CN" | "AU";
export type GarmentClass =
  | "bottom"    // trousers, jeans
  | "top"       // shirts, t-shirts
  | "outerwear" // jackets, coats
  | "dress";    // dresses, gowns

/* ─────────────────────────────────────────────
   Population-average waist-to-height ratios per size.
   Same source as the legacy component, extended per fit.
───────────────────────────────────────────── */
export interface SizeRow {
  size: SizeStr;
  waistMax: number; // upper bound of waist/height for this size
}

const MEN_BASE: SizeRow[] = [
  { size: "S",   waistMax: 0.48  },
  { size: "M",   waistMax: 0.535 },
  { size: "L",   waistMax: 0.595 },
  { size: "XL",  waistMax: 0.655 },
  { size: "XXL", waistMax: 0.715 },
];

const WOMEN_BASE: SizeRow[] = [
  { size: "XS",  waistMax: 0.415 },
  { size: "S",   waistMax: 0.445 },
  { size: "M",   waistMax: 0.475 },
  { size: "L",   waistMax: 0.525 },
  { size: "XL",  waistMax: 0.59  },
  { size: "XXL", waistMax: 0.65  },
];

/* Fit adjustment to the upper bound of each size. */
function withFit(rows: SizeRow[], fit: Fit): SizeRow[] {
  // Slim:  tighten the upper bound (smaller waist fits in same size)
  // Relaxed: loosen it
  const delta = fit === "slim" ? -0.015 : fit === "relaxed" ? 0.020 : 0;
  return rows.map(r => ({ ...r, waistMax: r.waistMax + delta }));
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
  return rows.map(r => ({ ...r, waistMax: r.waistMax + shift[region] }));
}

/* ─────────────────────────────────────────────
   Top / outerwear / dress tables use a chest-based
   ratio (chest circumference / height), matching the
   chestRatio used by recommendSizes. (The legacy draft
   of this table held chest-diameter-to-height anchors —
   roughly 2.7 times smaller than a circumference —
   which made every chest ratio fall past the last row
   and resolve to XXXL. Anchors below are diameter x 2.7.)
───────────────────────────────────────────── */
const TOP_MEN: SizeRow[] = [
  { size: "S",   waistMax: 0.662 },
  { size: "M",   waistMax: 0.702 },
  { size: "L",   waistMax: 0.743 },
  { size: "XL",  waistMax: 0.783 },
  { size: "XXL", waistMax: 0.824 },
];
const TOP_WOMEN: SizeRow[] = [
  { size: "XS",  waistMax: 0.608 },
  { size: "S",   waistMax: 0.648 },
  { size: "M",   waistMax: 0.689 },
  { size: "L",   waistMax: 0.729 },
  { size: "XL",  waistMax: 0.770 },
  { size: "XXL", waistMax: 0.810 },
];

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
  if (garment === "bottom") {
    return buildTable(
      withRegion(withFit(gender === "male" ? MEN_BASE : WOMEN_BASE, fit), region)
    );
  }
  // top / outerwear / dress: use chest-based table
  return buildTable(
    withRegion(withFit(gender === "male" ? TOP_MEN : TOP_WOMEN, fit), region)
  );
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
