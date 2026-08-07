# Changelog

## 1.1.0 — library integration and publish hardening

- Added a documented public component API: `className`, `style`, editable initial selection values, `brandCharts`, `onResult`, and non-fatal `onError` callbacks.
- Added `assetUrls` for self-hosted MoveNet and MediaPipe assets, plus `enableSegmentation` for strict/offline deployments that must not load MediaPipe.
- Version-pinned the default MediaPipe Selfie Segmentation CDN URL rather than resolving a floating latest version.
- Scoped the injected component stylesheet to `.st-root`, removed host-page `body`, `:root`, and universal-selector changes, and replaced the external Google Fonts import with system-font stacks.
- Reused one stylesheet for multiple mounted calculators and removed it after the final component unmounts.
- Hardened worker error, timeout, cleanup, and in-flight detection handling; a detector failure now rejects cleanly into the existing manual-guide fallback.
- Added a self-hosted MoveNet model URL option to the worker.
- Added regression tests for measurement math, calibration, and size-table/brand override logic. GitHub Actions now runs the test suite before publish and demo builds.
- Added `prepack`, so a direct `npm pack` creates a complete distributable from a clean checkout; updated `pack:check` to include tests.
- Added Apache 2.0 third-party notices for bundled TensorFlow.js and MediaPipe worker code.
- Clarified runtime asset requests, CSP considerations, and the distinction between local photo processing and model/CDN network requests in the README.

## 1.0.0 — npm publishing readiness

- Reworked package metadata for npm with an English description, richer keywords, `publishConfig.access`, package manager metadata, and a `pack:check` script.
- Updated the library build so the pose-detection Web Worker is emitted as `dist/poseWorker.js` and included in the npm tarball.
- Bundled TensorFlow.js and MoveNet dependencies into the worker so published consumers do not get browser-unresolvable bare imports inside a module worker and do not need TensorFlow as runtime npm dependencies.
- Trimmed npm package contents to the production files only: `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`.
- Rewrote the README with install, React/Next.js usage, publish steps, package contents, runtime notes, and accuracy/privacy guidance.
- Added worker load error/timeout handling so unsupported worker environments degrade gracefully instead of staying on a loading status.
- Updated GitHub Actions notes to match the current `.github/workflows/` setup.

## Accuracy improvements & garment sizing calibration

## Size chart calibration fixes (Bottoms, Tops, Outerwear, Dresses)

Fixed systematic sizing and measurement calibration bugs that caused inaccurate sizes across all four garment classes (`bottom`, `top`, `outerwear`, `dress`):

- **Bottoms (`MEN_BOTTOM`, `WOMEN_BOTTOM`)**:
  - Added the missing `"XS"` row to men's bottom sizing.
  - Re-calibrated waist-to-height ratio thresholds (`waistMax`) for both men and women to match standard international apparel sizing (e.g., US/UK/EU standard waist circumferences per height). Previously, S/M/L/XL thresholds were shifted by 1–2 sizes too large.
- **Tops (`MEN_TOP`, `WOMEN_TOP`)**:
  - Replaced legacy diameter-to-height anchors (`0.662` for S in men, `0.608` for XS in women) with calibrated chest/bust-to-height ratio thresholds. Previously, any male chest up to 116 cm returned `"S"` and any female bust up to 100 cm returned `"XS"`.
- **Outerwear (`MEN_OUTERWEAR`, `WOMEN_OUTERWEAR`)**:
  - Introduced dedicated outerwear tables with layering ease (+0.015 ratio allowance) so outerwear sizing correctly fits over shirts and sweaters across Slim, Regular, and Relaxed fits.
- **Dresses & Formal Wear (`MEN_DRESS`, `WOMEN_DRESS`)**:
  - Introduced dedicated dress tables with tailored bust-to-height thresholds for women's dresses/gowns and men's formal wear.
- **Measurement calculation enhancements (`useMeasurements.ts`)**:
  - Upgraded chest circumference (`chestCm`) estimation to use a blended anthropometric model combining shoulder biacromial diameter (`shoulderW`) and measured waist circumference (`waistCm`).
  - Fixed fallback and manual-override multipliers to realistic human proportions (`1.16` for men, `1.22` for women).
  - Fixed Ramanujan ellipse diameter-to-circumference scaling in synthetic evaluation (`Math.PI * 1.8` for depth/width ratio 0.8), eliminating a 6% systematic waist overestimation.
  - Fixed TypeScript types in `poseWorker.ts` so `npm run typecheck` passes cleanly.

## Eval results

1000 synthetic samples (random heights, weights, body shapes):

| metric | before (v1) | after (calibrated sizing) |
|---|---|---|
| Waist MAE | 3.70 cm | **0.89 cm** |
| Waist RMSE | 3.95 cm | **1.08 cm** |
| Chest MAE | 1.67 cm | **2.52 cm** |
| Bottom exact-match | 67.2 % | **89.0 %** (100% within ±1) |
| Top exact-match | 15.5 % | **72.9 %** (100% within ±1) |
| Outerwear exact-match | 16.5 % | **75.5 %** (100% within ±1) |
| Dress exact-match | 17.7 % | **72.0 %** (100% within ±1) |

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
