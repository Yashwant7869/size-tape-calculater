# size-tape-calculator

A privacy-first React component that estimates clothing size from basic body details plus front/side photos. It uses TensorFlow.js MoveNet pose detection, optional silhouette refinement, and an ellipse-based waist approximation in the browser.

> **Photo handling:** this package does not upload photo pixels to an application server. See [Privacy, network, and CSP](#privacy-network-and-csp) for the model and optional-runtime requests a browser makes by default.

## Features

- 📸 Front-photo waist estimate; optional side-photo depth estimate for ellipse circumference
- 🤖 MoveNet Thunder by default, with a Lightning option for faster devices
- 📏 Height-based photo scale or standard bank-card calibration
- 👕 Recommendations for bottoms, tops, outerwear, and dress/formal categories
- 🌍 Region- and fit-aware tables: US, UK, EU, IN, JP, CN, AU
- 📊 Pose, scale, image-quality, and plausibility confidence breakdowns
- 🧰 ESM, CommonJS, TypeScript declarations, and a bundled module worker
- 🎨 Scoped component styles that do **not** reset the host page's `body`, `:root`, or all elements

## Installation

```bash
npm install size-tape-calculator react react-dom
```

`react` and `react-dom` are peer dependencies. React 17 or newer is supported.

## Quick usage

```tsx
import { SizeTapeCalculator } from "size-tape-calculator";

export default function App() {
  return <SizeTapeCalculator />;
}
```

No CSS import is required. The component injects one namespaced stylesheet while it is mounted, uses system fonts by default, and removes the stylesheet after the final instance unmounts.

### Receive a result in your application

```tsx
import { SizeTapeCalculator, type SizeTapeResult } from "size-tape-calculator";

export default function SizePage() {
  function saveRecommendation(result: SizeTapeResult) {
    console.log(result.selectedGarment, result.selectedSize);
    // result.measurements and result.recommendations are also available here.
  }

  return (
    <SizeTapeCalculator
      initialRegion="IN"
      initialFit="regular"
      onResult={saveRecommendation}
      onError={(error) => console.warn(error.source, error.message)}
    />
  );
}
```

### Supply brand-specific charts

```tsx
import { SizeTapeCalculator, type BrandMap } from "size-tape-calculator";

const brandCharts: BrandMap = {
  "Example Brand": {
    S: { waist: [70, 76], chest: [86, 92] },
    M: { waist: [77, 84], chest: [93, 100] },
    L: { waist: [85, 92], chest: [101, 108] },
  },
};

export function BrandedSizeFinder() {
  return <SizeTapeCalculator brandCharts={brandCharts} initialBrand="Example Brand" />;
}
```

## Public props

| Prop | Purpose |
| --- | --- |
| `className`, `style` | Style the isolated calculator root without modifying host-page defaults. |
| `brandCharts`, `initialBrand` | Provide brand measurement ranges and preselect a brand label. |
| `initialFit`, `initialRegion`, `initialGarment` | Seed editable UI defaults. |
| `initialPoseModel` | Choose `"movenet-thunder"` or `"movenet-lightning"`. |
| `enableSegmentation` | Set to `false` for manual/keypoint-only measurement and no MediaPipe segmentation request. |
| `assetUrls` | Self-host or otherwise configure MoveNet and MediaPipe asset locations. |
| `onResult` | Receive measurements and the active recommendation after calculation. |
| `onError` | Receive non-fatal pose-detector or segmentation errors. |

The exported TypeScript types include `SizeTapeCalculatorProps`, `SizeTapeResult`, `SizeTapeError`, `SizeTapeAssetUrls`, `BrandMap`, `Measurements`, and `Recommendations`.

## Privacy, network, and CSP

Photo pixels are processed in the browser and are not sent by this package to an application server. By default, however, a user's browser does make these **asset** requests:

- **MoveNet model weights:** TensorFlow Hub downloads model files when the pose worker initializes.
- **Optional silhouette segmentation:** a version-pinned MediaPipe Selfie Segmentation script and model assets are loaded from jsDelivr, unless `enableSegmentation={false}`.

Those requests can disclose ordinary request metadata such as IP address to the selected asset hosts, but this component does not upload the source photo to them. If your privacy policy, CSP, offline mode, or data-residency requirements prohibit those requests, self-host the assets:

```tsx
<SizeTapeCalculator
  assetUrls={{
    moveNetModelUrl: "/models/movenet-thunder/model.json",
    segmentationScriptUrl: "/vendor/mediapipe/selfie_segmentation.js",
    segmentationBaseUrl: "/vendor/mediapipe",
  }}
/>
```

The MoveNet `model.json` and its weight shards must be CORS-accessible from the page. The MediaPipe script and all files under `segmentationBaseUrl` must also be served from origins permitted by your CSP. If you retain the defaults, permit the relevant TensorFlow Hub and jsDelivr origins in your site's `connect-src`, `script-src`, and worker policy. Camera capture requires HTTPS in production.

## Browser/runtime notes

- This component uses browser APIs (`window`, `Worker`, `ImageBitmap`, `OffscreenCanvas`, and camera APIs), so render it only on the client.
- Browsers without worker or segmentation support degrade to manual/keypoint guide measurement where possible.
- Consumers do not need to install TensorFlow.js separately; its pose runtime is bundled into `dist/poseWorker.js`.
- The component is intentionally a client-side widget. Its `onResult` callback is the integration point for your own persistence or checkout flow.

### Next.js example

```tsx
import dynamic from "next/dynamic";

const SizeTapeCalculator = dynamic(
  () => import("size-tape-calculator").then((module) => module.SizeTapeCalculator),
  { ssr: false }
);

export default function Page() {
  return <SizeTapeCalculator />;
}
```

## How it works

1. The user enters gender, height, weight, fit preference, and region.
2. The user uploads or captures a front photo; a side photo improves waist-depth estimation.
3. MoveNet finds body keypoints, then the user can adjust waist/head/feet guides.
4. The package calibrates pixels to centimeters using height or a standard card.
5. Waist circumference uses an ellipse formula with a side photo, or a body-shape estimate from a single front photo.
6. The result is mapped to the selected garment class, region, fit, and optional brand table.

## Development and quality checks

```bash
npm install
npm run dev          # Vite demo app
npm run typecheck    # TypeScript check
npm test             # measurement, calibration, and size-table regression tests
npm run build        # library build: dist/index.{js,cjs,d.ts} + dist/poseWorker.js
npm run build:demo   # production demo build
npm run pack:check   # typecheck + tests + package dry-run
```

`prepack` builds `dist/`, so a direct `npm pack --dry-run` is also representative from a clean checkout.

## Publish to npm

1. Update `CHANGELOG.md` and increment the semantic version. npm never permits publishing the same version twice.
2. Run:

   ```bash
   npm run pack:check
   ```

3. Publish:

   ```bash
   npm publish
   ```

`publishConfig.access` is already `public`. The package lifecycle typechecks and tests before publish, and rebuilds the worker during packing.

## Automated publishing with GitHub Actions

- `.github/workflows/publish.yml` runs typecheck and tests, then publishes when you create a GitHub Release or run it manually.
- `.github/workflows/demo.yml` tests and deploys the Vite demo to GitHub Pages from `main`.

For npm publishing through GitHub Actions, add a repository secret named `NPM_TOKEN` with npm publish permission.

## Package contents

The npm tarball includes only:

- `dist/` library files and bundled worker
- `README.md`, `CHANGELOG.md`, and `LICENSE`
- Apache 2.0 third-party license text and notices for bundled TensorFlow/MediaPipe code
- `package.json`

## Accuracy and safety note

This package provides an apparel-sizing estimate. Results can vary with photo quality, pose, clothing, fabric, brand, and size chart. It is not a medical device, biometric-identification system, or professional tailoring tool.

## License

MIT © Yashwant Singh Gour. See [third-party notices](./THIRD_PARTY_NOTICES.md) for bundled dependencies.
