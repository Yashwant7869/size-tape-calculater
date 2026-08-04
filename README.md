# size-tape-calculator

A privacy-first React component that estimates clothing size from basic body details plus front/side photos. It uses TensorFlow.js MoveNet pose detection, optional silhouette refinement, and an ellipse-based waist approximation — all in the user's browser.

> Photos are processed on-device. They are not uploaded by this package.

## Features

- 📸 Front-photo waist estimate; optional side-photo depth estimate for ellipse circumference
- 🤖 MoveNet Thunder by default, with MoveNet Lightning fallback option
- 📏 Height-based photo scale or standard bank-card calibration
- 👕 Recommendations for bottoms, tops, outerwear, and dress/formal categories
- 🌍 Region and fit-aware size tables: US, UK, EU, IN, JP, CN, AU
- 📊 Confidence breakdown: pose, scale, image quality, and plausibility
- 🔒 Browser-only processing with no server requirement
- 🧰 Built as an npm-ready library: ESM, CommonJS, TypeScript types, and bundled worker

## Installation

```bash
npm install size-tape-calculator
```

Peer dependencies:

```bash
npm install react react-dom
```

## Quick usage

```tsx
import { SizeTapeCalculator } from "size-tape-calculator";

export default function App() {
  return <SizeTapeCalculator />;
}
```

No CSS import is required. The component injects its own styles.

## Browser/runtime notes

- This component uses browser APIs (`window`, `Worker`, `ImageBitmap`, camera APIs), so render it only on the client.
- Camera capture requires HTTPS in production.
- The pose detector runs in a bundled module worker (`dist/poseWorker.js`), so consumers do not need to install TensorFlow.js separately.
- MediaPipe Selfie Segmentation is loaded from jsDelivr when available; if it cannot load, the component falls back to keypoint/manual guide measurement.

### Next.js example

```tsx
import dynamic from "next/dynamic";

const SizeTapeCalculator = dynamic(
  () => import("size-tape-calculator").then((m) => m.SizeTapeCalculator),
  { ssr: false }
);

export default function Page() {
  return <SizeTapeCalculator />;
}
```

## How it works

1. User enters gender, height, weight, fit preference, and region.
2. User uploads or captures a front photo; a side photo is recommended for better waist depth.
3. MoveNet finds body keypoints, then the user can adjust waist/head/feet guides.
4. The package calibrates pixels to centimeters using height or a standard card.
5. Waist circumference is estimated with an ellipse formula when side depth is available; otherwise it uses a single-photo body-shape estimate.
6. The result is mapped to the selected garment class, region, and fit table.

## Local development

```bash
npm install
npm run dev          # Vite demo app
npm run typecheck    # TypeScript check
npm run build        # library build: dist/index.{js,cjs,d.ts} + dist/poseWorker.js
npm run build:demo   # production demo build
npm run pack:check   # typecheck + build + npm pack dry-run
```

## Publish to npm

Before publishing, verify the package contents:

```bash
npm run pack:check
```

Then publish:

```bash
npm login
npm publish
```

`publishConfig.access` is already set to `public`, and `prepublishOnly` runs the same package check automatically.

If npm says the package name is already taken, publish under a scope instead, for example `@your-npm-username/size-tape-calculator`, and update `package.json` before publishing.

## Automated publishing with GitHub Actions

The workflows are already in `.github/workflows/`:

- `.github/workflows/publish.yml` publishes to npm when you create a GitHub Release or run the workflow manually.
- `.github/workflows/demo.yml` deploys the Vite demo to GitHub Pages from `main`.

For npm publishing through GitHub Actions, add a repository secret named `NPM_TOKEN` with publish permission from npmjs.com.

## Package contents

The npm tarball includes only:

- `dist/` library files and bundled worker
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`

Check anytime with:

```bash
npm pack --dry-run
```

## Accuracy and safety note

This package provides a sizing estimate for apparel. Results can vary by photo quality, pose, fabric, brand, and size chart. It is not a medical, biometric identification, or professional tailoring tool.

## License

MIT © Yashwant Singh Gour
