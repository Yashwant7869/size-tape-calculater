import assert from "node:assert/strict";
import test from "node:test";
import { calibrate, CARD_WIDTH_CM } from "../src/utils/calibration";

test("calibration returns an empty result without valid references", () => {
  assert.deepEqual(calibrate([]), {
    scaleCmPerPx: 0,
    varianceCmPerPx: 0,
    perRef: {},
  });
});

test("card calibration maps pixels to centimetres", () => {
  const estimate = calibrate([
    { method: "card", pxLength: 200, cmLength: CARD_WIDTH_CM },
  ]);
  assert.equal(estimate.scaleCmPerPx, CARD_WIDTH_CM / 200);
  assert.equal(estimate.varianceCmPerPx, 0);
  assert.equal(estimate.perRef.card, CARD_WIDTH_CM / 200);
});

test("a card reference has more influence than a height reference", () => {
  const estimate = calibrate([
    { method: "card", pxLength: 200, cmLength: 10 }, // 0.05 cm/px
    { method: "height", pxLength: 1000, cmLength: 70 }, // 0.07 cm/px
  ]);
  assert.ok(estimate.scaleCmPerPx > 0.05);
  assert.ok(estimate.scaleCmPerPx < 0.07);
  assert.ok(estimate.scaleCmPerPx < 0.06, "card should carry the larger weight");
  assert.ok(estimate.varianceCmPerPx > 0);
});
