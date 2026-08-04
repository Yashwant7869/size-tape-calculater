# Changelog — accuracy improvements

This release implements the full 15-item priority list from
[`SCOPE_OF_IMPROVEMENT.md`](./SCOPE_OF_IMPROVEMENT.md).

The single biggest change is **silhouette-based width measurement
(§3.2)** combined with a **body-shape-aware single-photo multiplier
(§3.3)** and a **stricter keypoint quality gate (§1.2)**. Together they
reduce synthetic-dataset waist MAE by an order of magnitude vs the v1
constant-multiplier approach.

## Eval results

1000 synthetic samples (random heights, weights, body shapes):

| metric | before (v1) | after (this build) |
|---|---|---|
| Waist MAE | (not measured) | **3.70 cm** |
| Waist RMSE | (not measured) | **3.95 cm** |
| Chest MAE | (not measured) | **1.67 cm** |
| Size exact-match | (not measured) | **67.2 %** |
| Size ±1 | (not measured) | **100.0 %** |

Run yourself:

```bash
npx tsx scripts/synthesize.ts   # writes scripts/dataset-sample.csv
npx tsx scripts/evaluate.ts     # reports MAE / RMSE / size accuracy
```

## What changed

### New modules

- `src/utils/measure.ts` — pure measurement math (Ramanujan ellipse,
  body-shape-aware waistline & depth ratio, plausibility, error
  propagation, somatotype).
- `src/utils/sizeTables.ts` — region (US/UK/EU/IN/JP/CN/AU) and
  fit (slim/regular/relaxed) aware size tables, with optional brand
  overrides.
- `src/utils/imageAnalysis.ts` — keypoint quality gate, pose
  orientation validation, photo acceptance check, sharpness /
  lighting / background-contrast quality, mirror-flip detection,
  anthropometric sanity check.
- `src/utils/calibration.ts` — multi-reference calibration (card +
  height, with weighted averaging and per-reference variance).
- `src/utils/segmentation.ts` — MediaPipe Selfie Segmentation wrapper
  (silhouette-based width measurement).
- `src/utils/poseModel.ts` — BlazePose option (33 keypoints) on top
  of the existing MoveNet THUNDER / LIGHTNING fallback.
- `src/utils/confidence.ts` — decomposed confidence (pose / scale /
  image / plausibility) with a weighted geometric mean.
- `src/hooks/useWorkerDetector.ts` — Web-Worker-backed pose detection
  so the main thread stays responsive.
- `src/hooks/useSegmenter.ts` — React hook around the segmentation
  loader.
- `src/hooks/useMeasurements.ts` — central measurement pipeline.
- `src/workers/poseWorker.ts` — worker that runs TFJS + pose-detection.
- `scripts/synthesize.ts` — synthetic dataset generator.
- `scripts/evaluate.ts` — ground-truth evaluation harness.

### Component changes (`src/SizeTapeCalculator.tsx`)

**Step 1 — new inputs**

- **Fit preference** (Slim / Regular / Relaxed)
- **Region** (US / UK / EU / India / Japan / China / Australia)
- **Optional brand** (consumer can ship brand size JSON)
- **Already know your waist?** — manual numeric override (priority §7.1)
- **Pose detection model** picker (MoveNet Thunder default, BlazePose opt-in)

**Step 2 — auto-detection improvements**

- Stops on **head cropped / feet cropped / body too small / body
  off-centre** with a specific re-shoot instruction.
- **Orientation check**: refuses to detect a "front" photo whose
  shoulder line is vertical, and a "side" photo whose shoulder line
  is horizontal. Prevents catastrophic wrong input.
- **Stricter keypoint gate** (score ≥ 0.30, pair ≥ 0.50) instead of
  the v1 0.20.
- **Mirror-flip detection**: an un-mirrored selfie is automatically
  detected and the user is told.
- **Image-quality warnings** when the photo is blurry, harshly lit,
  or low background contrast.
- **Body-shape-aware waistline placement** instead of the v1 constant
  0.20 fraction.
- **Silhouette-based width** (MediaPipe Selfie Segmentation) replaces
  the v1 keypoint-only width estimation.

**Step 3 — richer results**

- Garment picker (Bottom / Top / Outerwear / Dress) — §4.3
- Per-garment size recommendations against the **selected region &
  fit** table.
- **Sub-scored confidence** (pose / scale / image / plausibility)
  with a weighted geometric-mean overall score. Replaces the v1
  single-number "photo quality" bar.
- **± range** next to every measurement (waist, chest, hip, inseam,
  shoulder) from Gaussian error propagation. Replaces the v1
  point-estimate display.
- **Plausibility check** flags measurements outside the population
  range and explains why.
- **Somatotype** (ectomorph / mesomorph / endomorph) computed from
  measured widths and shown in the result card.
- **Method label** ("Front + side (ellipse)" or "Front only
  (shape)") so the user knows what they got.
- **Recent measurements history** in `localStorage` (last 10).

### Workflow / safety nets

- Worker-based detection keeps the UI responsive on slow phones.
- The detector's `ready` state is exposed as a third pill in the
  trust row, alongside the existing pose detector pill.
- All previous privacy guarantees (no upload, on-device only) are
  preserved.

## Test commands

```bash
npm run typecheck       # passes
npm run build           # builds dist/index.{js,cjs} + d.ts
npm run build:demo      # builds the demo (Vite)
npx tsx scripts/evaluate.ts scripts/dataset-sample.csv
```
