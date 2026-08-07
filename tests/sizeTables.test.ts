import assert from "node:assert/strict";
import test from "node:test";
import { pickBrandSize, sizeTable, waistRangeForSize } from "../src/utils/sizeTables";

test("size tables select a size from a measurement-to-height ratio", () => {
  const regularUs = sizeTable("male", "bottom", "regular", "US");
  assert.equal(regularUs.pick(0.45), "S");
  assert.equal(regularUs.pick(0.61), "XL");
});

test("regional and fit adjustments change the effective thresholds", () => {
  const regularUs = sizeTable("female", "bottom", "regular", "US");
  const relaxedUs = sizeTable("female", "bottom", "relaxed", "US");
  const regularIndia = sizeTable("female", "bottom", "regular", "IN");

  assert.ok(relaxedUs.rows[0].waistMax > regularUs.rows[0].waistMax);
  assert.ok(regularIndia.rows[0].waistMax < regularUs.rows[0].waistMax);

  const [lower, upper] = waistRangeForSize(regularUs, "M", 170);
  assert.ok(lower < upper);
});

test("a matching brand table overrides a generic recommendation", () => {
  const chart = {
    example: {
      S: { waist: [68, 74] as [number, number] },
      M: { waist: [75, 82] as [number, number] },
    },
  };
  assert.equal(pickBrandSize(chart, "example", 78, "bottom"), "M");
  assert.equal(pickBrandSize(chart, "missing", 78, "bottom"), null);
});
