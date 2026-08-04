# Scope of Improvement — Better Measurement Accuracy

This document captures the full set of opportunities I see for increasing the **measurement accuracy** of `size-tape-calculater`. It is organized by the layer of the pipeline that each improvement affects, with a rough priority and effort estimate for each item.

> **Pillars of accuracy here**
> 1. **Correct scale** (px → cm on every photo)
> 2. **Correct landmarks** (where the body actually is in the image)
> 3. **Correct geometry** (turning landmarks into a real circumference)
> 4. **Correct mapping** (circumference → size, accounting for body type and brand)
> 5. **Plausibility + feedback** (sanity checks, confidence, and re-shoot prompts)

Every item below is mapped to one of those pillars.

---

## 1. Pose detection (pillar: correct landmarks)

### 1.1 Use a richer pose model
- **Current:** MoveNet THUNDER (17 keypoints) → LIGHTNING fallback.
- **Issue:** MoveNet has no real shoulder/elbow/wrist depth info and is poor at lateral (side) poses. Many important anatomical landmarks for waist/hip estimation (greater trochanter, ASIS, iliac crest) are not available.
- **Improvement options**
  - **MediaPipe Pose** or **BlazePose** → 33 keypoints, better with 3D depth cues. Use via `@mediapipe/pose` or `@tensorflow-models/pose-detection`'s BlazePose backend.
  - **MoveNet MULTIPOSE** for the rare case of multiple people in frame, plus an explicit rejection of multi-person shots to keep measurements clean.
  - **TFJS BodyPix** as a third fallback (segmentation) to refine body silhouette when joints are noisy.
- **Impact:** High. Better landmarks directly improve every downstream step.
- **Effort:** Medium (model swap, new keypoint names).

### 1.2 Stricter keypoint quality gate
- **Current:** `score < 0.2` is treated as missing.
- **Issue:** 0.2 is too low. Many "low confidence" keypoints are spatially wrong by tens of pixels and bias the waist line.
- **Improvement**
  - Raise the threshold to **0.30 for required joints** and **0.50 for the hip/shoulder pair** that drives the waist Y.
  - For each pair (L/R hip, L/R shoulder), use the *minimum* of the two scores as the pair's confidence, not the average.
  - Add a **coverage check**: head top and feet must both be present; otherwise the photo must be re-shot (we cannot calibrate).
- **Impact:** High–medium.
- **Effort:** Low.

### 1.3 Multi-frame detection for live preview
- **Current:** Single-shot detection on the captured image.
- **Issue:** A single bad frame (motion blur, occlusion) ruins the measurement.
- **Improvement**
  - For **live camera**, run detection on the last N frames (e.g., 5) and keep the *median* keypoint positions + the *maximum* pair-wise score as confidence.
  - For **uploaded photos**, run 2× on a slightly rotated image (±2°) and pick the higher-confidence result — fixes small tilt errors.
- **Impact:** Medium.
- **Effort:** Medium.

### 1.4 Auto-detect camera mirror flip
- **Current:** Front camera captures are saved **mirrored** (because the OS mirrors the preview) but the user could also upload a mirrored selfie.
- **Issue:** L/R hip and L/R shoulder are swapped, which is fine for width but breaks any future anatomy-specific logic (e.g., dominant-side posture bias).
- **Improvement**
  - Detect by face landmark orientation (nose tip relative to eye midpoint) and **auto-unmirror** before detection. This also helps the user perceive their own body correctly.
- **Impact:** Medium (mostly correctness, less accuracy).
- **Effort:** Low–medium.

### 1.5 Pose-orientation validation
- **Current:** User picks "front" or "side" themselves. There is no check.
- **Issue:** A user can upload a side photo into the "front" slot, producing a wildly wrong width.
- **Improvement**
  - Compute shoulder-line **angle** in the image. If it is within ±15° of horizontal for "front" or near-vertical for "side", accept; otherwise show a warning and ask the user to confirm or re-shoot.
  - For side photos, also check that **one shoulder is significantly closer to the camera** than the other (depth asymmetry) — otherwise it is not a true profile.
- **Impact:** High (prevents catastrophic wrong input).
- **Effort:** Low.

### 1.6 Reject unsuitable photos automatically
- Detect and warn (or reject) when:
  - **Head or feet cropped** (no ankle score, or top of head above image top).
  - **Body too small** (hip-to-ankle < 20% of image height — scale will be unstable).
  - **Body too close to edge** (touching the side of the frame — manual drag handles won't work).
  - **Body not centered** in the image (centroid offset > 15% of image dimension).
- Show a specific instruction ("step back ~1 m", "raise the camera", "center yourself") instead of a generic "try again".
- **Impact:** High.
- **Effort:** Low.

---

## 2. Calibration (pillar: correct scale)

### 2.1 Two-reference calibration
- **Current:** Card OR height. Height is approximate (±2 cm user error → ±1.4% scale error). Card is precise but only available in the front photo.
- **Improvement**
  - Allow **two reference objects**: a card on the front photo, **and** a known height span. Combine them as a weighted estimate:
    `scale = (h_user / px_height + card_cm / card_px) / 2`
  - Use the *minimum* of the two variances as the calibration confidence, and propagate that into the final confidence score.
  - Allow **A4 paper** (210 × 297 mm) and a **standard coin** as fallback reference objects in regions where bank cards are uncommon.
- **Impact:** Medium–high.
- **Effort:** Low.

### 2.2 Anthropometric sanity check on calibration
- **Current:** No check that `topY` and `bottomY` actually span the body.
- **Issue:** A user can place the top mark at the chin and the bottom at the floor — the result still "works" but is wrong by 13% (head height is ~13% of body height in adults).
- **Improvement**
  - After auto-detection, compute the **head-to-ankle pixel distance** and compare to the expected ratio for an adult (≈ 0.87 of full body, since head top to ankle ≈ 0.93 of body, with the rest being feet below the ankle).
  - If the user's drag is > 10% off from the auto-detected positions, gently correct or flag.
  - For children (height < 150 cm), use child-specific ratios.
- **Impact:** Medium.
- **Effort:** Low.

### 2.3 Lens distortion correction
- **Current:** Raw image is used as-is.
- **Issue:** Phone selfie cameras have noticeable barrel distortion near the edges, which can inflate the measured waist width by 3–5%.
- **Improvement**
  - Run a lightweight **Brown–Conrady undistortion** with pre-calibrated intrinsics for common phones (or estimate from EXIF focal length).
  - Cheaper alternative: only **measure widths from the central 60% of the image** and ignore the periphery, where distortion is worst.
- **Impact:** Medium.
- **Effort:** Medium–high.

### 2.4 Better card-detection
- **Current:** User manually drags a rectangle.
- **Improvement**
  - Auto-detect the card with a small **Canny-edge + contour** pass (cheap, runs in ~30 ms). Snap the rectangle to the four strongest near-axis-aligned edges.
  - Validate aspect ratio (CARD_WIDTH_CM / CARD_HEIGHT_CM = 1.585) — warn if the user drags a non-card-shaped box.
  - Apply a perspective transform so the card is measured flat, not foreshortened.
- **Impact:** High.
- **Effort:** Medium.

---

## 3. Body geometry & measurement math (pillar: correct geometry)

### 3.1 Better waistline Y placement
- **Current:** `waistY = hipY - 0.20 * (hipY - shoulderY)`. Constant 0.20.
- **Issue:** The natural waistline varies by body type:
  - "Apple" shape: waist is high (close to the lower ribs).
  - "Pear" shape: waist is low and indistinct from the hips.
  - Athletic build: waist is well-defined and slightly above mid-torso.
- **Improvement**
  - Replace the constant 0.20 with a function of **shoulder-to-hip width ratio**:
    - High shoulder/hip ratio (broad shoulders) → 0.22 (waist a bit higher).
    - Low ratio (narrow shoulders, wide hips) → 0.18.
  - If the user manually adjusts the waist Y, learn the *delta* and apply it as a per-user offset for the side photo as well.
- **Impact:** Medium.
- **Effort:** Low.

### 3.2 Use torso segmentation, not just keypoints
- **Current:** Waist width is *interpolated* from shoulder width and hip width.
- **Issue:** A muscular torso or a loose sweater can make interpolation wrong by ±15%.
- **Improvement**
  - After pose detection, run **BodyPix** at low resolution to get a torso silhouette.
  - Measure the **actual** horizontal width of the silhouette at the chosen waist Y, with a 5-pixel band averaged to reduce noise.
  - The same approach gives the side depth directly from the silhouette, not from keypoint interpolation.
- **Impact:** **High.** This is probably the single biggest accuracy win in the geometry layer.
- **Effort:** Medium.

### 3.3 Replace the constant circumference multiplier
- **Current:** For single-photo mode: `circumference = frontW × 2.5 (male) / 2.35 (female)`.
- **Issue:** A real body's depth/width ratio at the waist is **not constant**:
  - Avg male waist: depth/width ≈ 0.55
  - Avg female waist: depth/width ≈ 0.50
  - Athletes: ≈ 0.65 (deeper chest, narrower waist)
  - Larger bodies: depth/width can be ≈ 0.45 (flatter, wider)
- **Improvement**
  - If only one photo is available, estimate depth/width ratio from the **shoulder/hip width ratio**:
    - `k = clamp(0.45 + 0.3 × (hipW - shoulderW) / (hipW + shoulderW), 0.40, 0.70)`
    - `circumference = π · (a + b) · (1 + 3h/(10+√(4-3h)))` with `b = a · k`
  - Keep Ramanujan's #2 — it is excellent.
- **Impact:** High.
- **Effort:** Low.

### 3.4 Account for clothing vs body
- **Current:** No check.
- **Issue:** Loose clothing (hoodie, kurta, dress) inflates the measured width by 2–8 cm.
- **Improvement**
  - Ask the user to **wear fitted clothing** in the on-screen guide (we already say this — make it blocking until they tick a "I'm wearing fitted clothing" checkbox).
  - For loose clothing, offer a **clothing-fit correction factor** slider (1.0 = body-hugging, 0.92 = regular fit, 0.85 = loose) that the user can dial in.
  - Long-term: train a small classifier on the photo to *predict* fit from silhouette regularity (e.g., a sharp edge = fitted; a soft edge = loose).
- **Impact:** Medium–high.
- **Effort:** Low for the slider, high for the classifier.

### 3.5 Posture and breathing correction
- **Current:** No posture handling.
- **Issue:** A relaxed pose (slouching, leaning) vs an erect pose changes the measured circumference by 2–4 cm.
- **Improvement**
  - Use shoulder/hip/ankle vertical alignment as a **straightness score**. If slouch > 5°, warn the user.
  - Optionally, add a "**breathe out gently**" prompt before capture — the difference between full inhale and full exhale at the waist is ~2 cm.
  - Take **two captures ~1 s apart** and use the smaller (more exhaled) value.
- **Impact:** Medium.
- **Effort:** Low.

### 3.6 Use the spine, not the silhouette, for the side photo
- **Current:** Side photo width comes from the *horizontal extent* of the body at waist Y. With a keypoint-only approach, this is approximated as `0.8 × |left_hip.x − right_hip.x|`.
- **Issue:** In a true side profile, `|left_hip.x − right_hip.x|` is near zero, so this collapses.
- **Improvement**
  - For side photos, **measure the actual silhouette width** at waist Y (per §3.2) — this is the only reliable method.
  - Fall back to the silhouette-based measurement before any keypoint-based approximation.
- **Impact:** High for side accuracy.
- **Effort:** Medium.

### 3.7 Plausibility check on final waist
- **Current:** No sanity check.
- **Improvement**
  - Reject or flag waist values outside **55–130 cm** (or 45–110 cm for women, 65–150 cm for men) as "unusual — please re-check".
  - Compare to BMI-based estimate: if photo waist is more than 1.4× or less than 0.6× the BMI-implied waist, flag it.
- **Impact:** Medium (mostly UX, but also catches gross errors).
- **Effort:** Trivial.

---

## 4. Size recommendation (pillar: correct mapping)

### 4.1 Region / brand-aware size tables
- **Current:** Single hard-coded chart for each gender.
- **Issue:** Asian, European, US, and UK sizes are systematically different. Even within a region, brands differ.
- **Improvement**
  - Add a **region picker** (US / UK / EU / IN / JP / CN / AU) with separate size tables.
  - Allow **brand overrides** as a JSON config the consumer (or a maintainer) can ship — e.g., `brands/{zara,hm,uniqlo}.json`.
  - Internationalization: render the chart in the user's locale.
- **Impact:** High.
- **Effort:** Medium.

### 4.2 Fit preference
- **Current:** None.
- **Improvement**
  - Add a "**fit preference**" toggle: Slim / Regular / Relaxed.
  - For each size in the table, store a recommended waist range per fit; the recommendation then picks the size whose recommended range contains the user's waist *with a margin appropriate to the fit*.
  - This is the single most-requested feature for any size tool and we currently ignore it.
- **Impact:** High.
- **Effort:** Low.

### 4.3 Use a full body model, not just waist
- **Current:** Only waist → size.
- **Issue:** Chest, hip, and inseam all matter for shirts, jackets, and trousers. A user whose waist says "M" but whose chest says "XL" should be told "M bottom, XL top" — or at least shown both numbers.
- **Improvement**
  - Use the same pose + silhouette pipeline to estimate:
    - **Chest circumference** (at the level of the armpits, between the nipples).
    - **Hip circumference** (at the widest point of the hips, ~0.05 below the iliac crest).
    - **Inseam** (crotch to ankle, used for trousers).
    - **Shoulder width** (used for shirts/jackets).
  - Render a **complete measurement card** (waist, chest, hip, inseam, shoulder) and per-garment-class recommendations (top / bottom / dress / outerwear).
- **Impact:** Very high.
- **Effort:** Medium–high.

### 4.4 Body-shape classification
- **Improvement**
  - From the measured widths and ratios, classify the user into one of the standard somatotypes:
    - **Ectomorph** (narrow shoulders, narrow hips, low waist)
    - **Mesomorph** (broad shoulders, narrow waist)
    - **Endomorph** (wider waist, similar hip/shoulder widths)
  - Use this to nudge the recommendation by half a size in either direction.
- **Impact:** Medium.
- **Effort:** Low.

### 4.5 BMI baseline with confidence, not as a fallback
- **Current:** BMI-derived size is shown alongside photo size; the photo size wins if it disagrees.
- **Issue:** BMI is a *population average* — for muscular or atypical builds it is wrong by 1–2 sizes. A user with low body fat and high muscle mass will be told they're "L" when they're actually "M".
- **Improvement**
  - Use BMI only as a **tie-breaker** when confidence is low, not as a default.
  - Explicitly surface the **disagreement** (already shown via the green/amber flag) and let the user pick.
  - Add a body-fat% or activity-level input for better BMI interpretation.
- **Impact:** Medium.
- **Effort:** Low.

---

## 5. Confidence, plausibility, and feedback (pillar: trust)

### 5.1 Decompose confidence into sub-scores
- **Current:** One number — average of keypoint scores.
- **Improvement** — surface and aggregate:
  - **Pose quality** (keypoint scores, coverage).
  - **Scale quality** (card vs height agreement, OR residual from anthropometric ratio).
  - **Image quality** (sharpness, lighting, background contrast).
  - **Geometric plausibility** (is the measured waist within the population range for this height/weight/gender?).
  - **Final confidence** = weighted geometric mean of the four.
- Show each as a labelled mini-bar in the result card.
- **Impact:** Medium (UX) → High (user trust + fewer wrong sizes returned).
- **Effort:** Medium.

### 5.2 Continuous confidence, not a flag
- **Current:** "If diff ≥ 2 sizes → warn".
- **Improvement**
  - Compute `delta = |photo_size_idx − bmi_size_idx|`.
  - Show a **continuous confidence bar** (0–100%) and the underlying numbers.
  - Recommend the size whose sub-scores are highest, and let the user see why.
- **Impact:** Medium.
- **Effort:** Low.

### 5.3 Image-quality checks
- **Improvement** — automatically run, on the uploaded photo:
  - **Sharpness**: Laplacian variance over the body region. If below threshold, warn "photo is blurry — re-shoot".
  - **Lighting uniformity**: std-dev of luminance across the body region. If too high, warn "harsh shadow on one side — diffuse the light".
  - **Background contrast**: ratio of body-region mean luminance to background mean luminance. If too low, warn "stand in front of a plain background".
  - **Color tint**: detect yellow/orange room lighting that can fool the silhouette.
- **Impact:** Medium–high.
- **Effort:** Medium.

### 5.4 Smart "re-shoot" prompts
- Replace the current generic "we could not detect the body" with **specific, actionable** prompts:
  - "Your head is cut off — move the camera up."
  - "We can't see your feet — step back ~1 m."
  - "Your shadow is on the right — turn 90° so the light is behind you."
  - "You're wearing loose clothing — the measurement will be off by 2–4 cm."
- **Impact:** High (UX) → Medium (accuracy via fewer bad photos).
- **Effort:** Medium.

### 5.5 Per-photo uncertainty propagation
- Use **Gaussian error propagation** through the pipeline:
  - Each keypoint has a noise σ proportional to `(1 − score)` (in pixels).
  - Propagate that to width in cm and to circumference.
  - Display a **± range** next to every measurement ("82 ± 2 cm") instead of a single value.
- This is the difference between "we measured 82 cm" and "we measured 82 cm, give or take 2". Users make better decisions with the range.
- **Impact:** Medium (mostly trust).
- **Effort:** Medium.

---

## 6. Pipeline / architecture improvements

### 6.1 Decouple measurement from UI
- The measurement math is currently interleaved with React state. Move it into a pure function in `src/utils/measure.ts` so it can be:
  - Unit-tested against a labelled dataset.
  - Re-used from Node (for batch evaluation) and from the browser.
- **Impact:** High (enables §6.2 and §6.3 below).
- **Effort:** Medium.

### 6.2 Ground-truth evaluation harness
- Create `scripts/evaluate.ts` that runs the pipeline against a labelled set (synthetic + captured) and reports:
  - **MAE / RMSE** of waist, chest, hip in cm.
  - **Size-match accuracy** (% of cases where the recommended size is exactly the true size).
  - **Off-by-one accuracy** (% within ±1 size).
- Without this, "we improved accuracy" is a guess.
- **Impact:** High (foundational).
- **Effort:** Medium.

### 6.3 Synthetic dataset for CI
- Use a 3D body model (e.g., **SMPL** or **MakeHuman**) to render thousands of synthetic front+side photo pairs with known ground-truth measurements, at varied:
  - Heights (140–200 cm), weights, body shapes, skin tones, lighting, camera angles, focal lengths.
  - Clothing fits.
- Run the test suite on every PR. This catches regressions in the math, the calibration, and the pose detector selection.
- **Impact:** High.
- **Effort:** High (one-time).

### 6.4 WebWorker for pose + segmentation
- **Current:** Both MoveNet and any future segmentation run on the main thread. The UI freezes on slower devices.
- **Improvement**
  - Move pose + segmentation to a **Web Worker** with OffscreenCanvas transfer. Main thread stays responsive, and we can stream partial results.
- **Impact:** Medium (UX, and a prerequisite for §1.3 multi-frame detection).
- **Effort:** Medium.

### 6.5 Model warmup + caching
- **Current:** The detector is created lazily on first use.
- **Improvement**
  - Warm the model on `useEffect` mount (already done — good).
  - Cache the detector across page reloads with **IndexedDB** (TF.js supports this) so repeat users see instant readiness.
- **Impact:** Low.
- **Effort:** Low.

### 6.6 Bundle size
- The component is self-contained and ships via npm. MoveNet THUNDER itself is ~12 MB and downloaded on every page load. Consider:
  - Hosting the model and serving it from a CDN with `Cache-Control: immutable`.
  - Lazy-loading MoveNet only when the user reaches Step 2.
  - Offering a "**lite mode**" prop that uses BlazePose (smaller) or no model (manual only).
- **Impact:** Medium (load time, not accuracy, but increases the number of users who reach the measurement step at all).
- **Effort:** Low.

---

## 7. New features that *enable* better accuracy

### 7.1 Manual numeric override
- Let the user **type a known waist measurement** ("I already know my waist is 78 cm — recommend a size from that").
- This is the *cheapest* accuracy improvement possible: zero algorithm work, and for users who know their waist it is 100% accurate.
- Many "size" tools are used by people who already own clothes that fit; they want to know what size of *this* garment matches that fit.
- **Impact:** High.
- **Effort:** Trivial.

### 7.2 Reference object: known garment
- Let the user place a **flat garment they already own and that fits well** on the floor and snap it.
- We measure the garment's known dimensions (e.g., a flat-laid trouser waistband is ~0.85× the body waist for jeans) and use that as a personal calibration reference.
- **Impact:** High.
- **Effort:** Medium.

### 7.3 Three-photo mode
- **Front, side, and back** photos give a much better ellipse fit because the back confirms the depth measurement (the side view is a single projection).
- **Impact:** Medium.
- **Effort:** Low (additive to existing code).

### 7.4 Save and compare
- Save measurements to `localStorage`. Next time, the user can re-measure and see drift ("your waist estimate changed by 0.5 cm — probably posture, not body").
- Also: if a user reports "size X fit me well", store that and use it as a personal override for that brand.
- **Impact:** High for retention; medium for accuracy.
- **Effort:** Low.

---

## 8. Recommended priority order

If the goal is **accuracy-per-hour-of-engineering-time**, I would do them in this order:

| # | Item | Why first | Effort |
|---|------|-----------|--------|
| 1 | §3.2 **Silhouette-based width** | Single biggest geometry win | M |
| 2 | §1.2 **Stricter keypoint threshold** | Cheap and removes worst cases | L |
| 3 | §1.5 **Pose-orientation validation** | Prevents catastrophic wrong input | L |
| 4 | §1.6 **Auto-reject bad photos** | Cleaner input → cleaner output | L |
| 5 | §4.2 **Fit preference toggle** | High user value, trivial | L |
| 6 | §7.1 **Manual numeric override** | Trivial, perfect for users who already know | XS |
| 7 | §3.3 **Smarter single-photo multiplier** | Fixes the worst single-photo case | L |
| 8 | §3.7 **Plausibility check on waist** | Catches gross errors before they ship | XS |
| 9 | §4.1 **Region / brand tables** | Mass-market usability | M |
| 10 | §5.1 **Sub-scored confidence** | Builds trust | M |
| 11 | §2.4 **Auto card detection** | Reduces user error in calibration | M |
| 12 | §6.1–6.3 **Decouple + eval harness + synthetic data** | Foundational for future work | M–H |
| 13 | §1.3 **Multi-frame detection** | Smooths the live experience | M |
| 14 | §4.3 **Full body model (chest, hip, inseam)** | Massively expands what we can recommend | M–H |
| 15 | §1.1 **Switch to BlazePose / MediaPipe Pose** | Bigger model, better landmarks | M |

Items 1–8 are the "**make the current measurement right**" pass.
Items 9–11 are the "**make the result trustworthy and usable**" pass.
Items 12–15 are the "**expand what we can measure and recommend**" pass.

---

## 9. Summary

The current implementation is already well-designed: it picks a sensible pose model, uses Ramanujan's excellent ellipse formula, has a credit-card calibration option, and shows a clear BMI-vs-photo agreement flag. Most of the remaining accuracy gains live in three places:

1. **Input quality** — auto-rejecting bad photos, validating pose orientation, stricter keypoint thresholds.
2. **Geometric measurement** — replacing keypoint interpolation with **silhouette-based width/depth** (§3.2), and the constant circumference multiplier with a body-shape-aware estimate (§3.3).
3. **Mapping to a size** — region-aware tables, fit preference, and a full body model instead of waist-only.

A short, focused pass on items 1–8 of the priority list above should produce a **measurable 1–2 cm RMSE reduction** in waist estimation, and a **+10–20% improvement in exact-size-match rate** without changing the user-visible flow.
