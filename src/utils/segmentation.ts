/* ─────────────────────────────────────────────
   §3.2 — Silhouette-based body width measurement.
   Uses MediaPipe Selfie Segmentation (loaded as a script
   tag) to produce a binary body mask, then measures the
   actual horizontal width at a given Y.

   Why MediaPipe Selfie Segmentation (not BodyPix):
   - 250 KB vs 3 MB
   - 5–10× faster on mid-range phones
   - More accurate silhouette edges for single-person shots
───────────────────────────────────────────── */

export interface SilhouetteWidth {
  /** Fractional x position of the leftmost body pixel. */
  leftFrac: number;
  /** Fractional x position of the rightmost body pixel. */
  rightFrac: number;
  /** Number of body pixels in the band (used as a confidence proxy). */
  pixelsInBand: number;
  /** Image width and height the band was measured on. */
  imageW: number;
  imageH: number;
}

export interface Segmenter {
  segment(image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): Promise<ImageData | null>;
  ready: boolean;
}

/* ─────────────────────────────────────────────
   Loader
   MediaPipe's `@mediapipe/selfie_segmentation` package
   attaches a global `window.SelfieSegmentation`. We
   dynamically inject the script + wasm + model loader.
───────────────────────────────────────────── */
const MEDIAPIPE_SCRIPT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
const MEDIAPIPE_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";

let segmenterPromise: Promise<Segmenter> | null = null;

export function loadSegmenter(): Promise<Segmenter> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    await injectScript(MEDIAPIPE_SCRIPT);
    const SelfieSegmentation =
      (window as unknown as { SelfieSegmentation: new (cfg: { locateFile: (f: string) => string }) => {
        setOptions(opts: { modelSelection: 0 | 1; selfieMode: boolean }): void;
        onResults(cb: (res: { segmentationMask: HTMLCanvasElement }) => void): void;
        send(inputs: { image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement }): Promise<void>;
        close(): Promise<void>;
        reset(): void;
      } }).SelfieSegmentation;

    const seg = new SelfieSegmentation({
      locateFile: (file: string) => `${MEDIAPIPE_BASE}/${file}`,
    });
    seg.setOptions({ modelSelection: 1, selfieMode: false });
    return new Promise<Segmenter>((resolve) => {
      const ready: Segmenter = {
        ready: false,
        segment: async (image) => {
          const result = await new Promise<{ segmentationMask: HTMLCanvasElement } | null>((res) => {
            let done = false;
            seg.onResults((r) => {
              if (done) return;
              done = true;
              res(r);
            });
            seg.send({ image }).then(() => {
              if (!done) { done = true; res(null); }
            });
          });
          if (!result) return null;
          return maskToImageData(result.segmentationMask);
        },
      };
      // Initialise by sending a 2×2 blank image to trigger model load.
      // If the model/wasm can't be fetched (offline, blocked CDN), the
      // probe never produces a result — resolve after a timeout anyway so
      // callers aren't stuck on "Preparing…" forever (ready stays false).
      const probe = document.createElement("canvas");
      probe.width = 2; probe.height = 2;
      let settled = false;
      seg.onResults(() => {
        if (settled) return;
        settled = true;
        ready.ready = true;
        resolve(ready);
      });
      seg.send({ image: probe }).catch(() => {/* handled by timeout */});
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(ready); // ready.ready === false → degraded mode
      }, 20000);
    });
  })();
  return segmenterPromise;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) {
      // Already injected — wait for it to be defined if needed.
      const w = src.split("/").pop()!;
      if ((window as unknown as Record<string, unknown>)[w] !== undefined) {
        resolve();
        return;
      }
      // Otherwise: poll briefly.
      let tries = 0;
      const id = setInterval(() => {
        tries++;
        if ((window as unknown as Record<string, unknown>)[w] !== undefined) {
          clearInterval(id);
          resolve();
        } else if (tries > 200) {
          clearInterval(id);
          reject(new Error("mediapipe script load timeout"));
        }
      }, 50);
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

function maskToImageData(canvas: HTMLCanvasElement): ImageData {
  // The mask is a 1-channel alpha-blended image. Threshold at 128.
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  const src = ctx.getImageData(0, 0, w, h);
  const out = new ImageData(w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i + 3] > 128 ? 255 : 0;
    out.data[i]     = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

/* ─────────────────────────────────────────────
   §3.2 — Measure the silhouette's horizontal extent
   in a vertical band [y0, y1] of the mask.
───────────────────────────────────────────── */
export function silhouetteWidthInBand(
  mask: ImageData,
  y0Frac: number,
  y1Frac: number
): SilhouetteWidth | null {
  const w = mask.width, h = mask.height;
  const y0 = Math.max(0, Math.floor(h * y0Frac));
  const y1 = Math.min(h, Math.ceil(h * y1Frac));
  let left = -1, right = -1, pixels = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (mask.data[i] > 128) {
        if (left < 0) left = x;
        right = x;
        pixels++;
      }
    }
  }
  if (left < 0 || right < 0 || pixels < 20) return null;
  return {
    leftFrac: left / w,
    rightFrac: right / w,
    pixelsInBand: pixels,
    imageW: w,
    imageH: h,
  };
}

/** Average the silhouette width over several rows (smoother). */
export function silhouetteWidthAveraged(
  mask: ImageData,
  centerYFrac: number,
  halfBandFrac: number
): SilhouetteWidth | null {
  // Sample 5 horizontal lines around centerY.
  const samples: SilhouetteWidth[] = [];
  const offsets = [-0.02, -0.01, 0, 0.01, 0.02];
  for (const off of offsets) {
    const yc = centerYFrac + off;
    const s = silhouetteWidthInBand(mask, yc - halfBandFrac, yc + halfBandFrac);
    if (s) samples.push(s);
  }
  if (samples.length === 0) return null;
  const left = samples.reduce((s, x) => s + x.leftFrac, 0) / samples.length;
  const right = samples.reduce((s, x) => s + x.rightFrac, 0) / samples.length;
  const pix = samples.reduce((s, x) => s + x.pixelsInBand, 0);
  return {
    leftFrac: left,
    rightFrac: right,
    pixelsInBand: pix,
    imageW: mask.width,
    imageH: mask.height,
  };
}
