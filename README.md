# size-tape-calculator

React component jo **front + side photos se clothing size estimate** karta hai — TensorFlow.js MoveNet pose detection aur **Ramanujan ellipse formula** ke saath. Sab kuch user ke **browser mein** chalta hai — koi photo server par nahi jaati.

## Features

- 📸 **Front + side photo** se waist circumference (Ramanujan ellipse approximation)
- 🤖 **Auto pose detection** — MoveNet THUNDER (high accuracy) + LIGHTNING fallback
- 💳 **Credit card calibration** (ISO/IEC 7810 ID-1) ya height-based scale
- 📊 **BMI baseline** + photo-based size dono, confidence scoring ke saath
- 🔒 **100% private** — pose detection browser mein hota hai, koi upload nahi
- 🔍 Zoom / pan ke saath manual fine-tuning handles

## Install

```bash
npm install size-tape-calculator
```

React 17+ peer dependency hai:

```bash
npm install react react-dom
```

## Usage

```tsx
import { SizeTapeCalculator } from "size-tape-calculator";

function App() {
  return <SizeTapeCalculator />;
}
```

Component self-contained hai — apni styles aur TensorFlow.js scripts (CDN se) khud inject karta hai. Koi props required nahi hai.

## Local development

```bash
npm install
npm run dev        # demo app (Vite)
npm run typecheck  # TypeScript check
npm run build      # library bundle → dist/ (ESM + CJS + .d.ts)
```

## Publish (npm)

Local se:

```bash
npm login          # ek baar — npmjs.com account chahiye
npm publish --access public
```

Ya phir GitHub par **Release** banao — publish workflow automatically npm par daal dega (repo secrets mein `NPM_TOKEN` add karna hoga — npmjs.com → Access Tokens → Granular token with publish permission).

> **Note:** GitHub Actions ki files abhi [`workflows/`](workflows/) folder mein hain — ek baar `.github/workflows/` mein move karke enable karni hain. Steps: [workflows/README.md](workflows/README.md)

## Demo

`main` branch par push hote hi demo GitHub Pages par deploy ho jaata hai (repo **Settings → Pages → Source: GitHub Actions** select karein — pehle [`workflows/`](workflows/) folder enable karein).

## Kaise kaam karta hai

1. **Step 1** — Gender + height + weight se BMI baseline size
2. **Step 2** — Front photo (waist width) + side photo (waist depth), pose detection se auto-calibrated
3. **Step 3** — Ramanujan ellipse formula: `C ≈ π(a+b)(1 + 3h/(10+√(4-3h)))` se circumference → size chart match

## License

MIT © Yashwant Singh Gour
