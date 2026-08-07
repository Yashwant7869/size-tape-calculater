import assert from "node:assert/strict";
import test from "node:test";
import {
  circumferenceFromEllipse,
  circumferenceFromWidth,
  depthRatio,
  ellipseCircumference,
  plausibilityCheckWaist,
} from "../src/utils/measure";

test("ellipse circumference matches a circle", () => {
  const radius = 10;
  const circumference = ellipseCircumference(radius, radius);
  assert.ok(Math.abs(circumference - 2 * Math.PI * radius) < 0.0001);
});

test("front and side dimensions produce a plausible ellipse waist", () => {
  const waist = circumferenceFromEllipse(30, 24);
  assert.ok(waist > 84 && waist < 86, `expected ~85 cm, received ${waist}`);
});

test("single-photo estimate uses a bounded body-shape depth ratio", () => {
  assert.equal(depthRatio(0, 0), 0.8);
  assert.ok(depthRatio(70, 30) <= 0.95);
  assert.ok(depthRatio(30, 70) >= 0.7);
  assert.ok(circumferenceFromWidth(30, 45, 35) > 80);
});

test("waist plausibility flags invalid and extreme measurements", () => {
  assert.equal(plausibilityCheckWaist(80, 175, "male").ok, true);
  assert.equal(plausibilityCheckWaist(0, 175, "male").ok, false);
  assert.equal(plausibilityCheckWaist(180, 175, "female").ok, false);
});
