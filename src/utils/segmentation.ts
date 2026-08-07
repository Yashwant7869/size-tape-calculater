/* ─────────────────────────────────────────────
   Silhouette-based body-width measurement.

   MediaPipe is loaded only in the browser and can be disabled or self-hosted
   through `SegmentationAssets`. The default URL is version-pinned so a future
   CDN release cannot silently change a published calculator's behaviour.
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

/** URLs used to load MediaPipe's segmentation runtime and its model assets. */
export interface SegmentationAssets {
  scriptUrl?: string;
  baseUrl?: string;
}

const MEDIAPIPE_VERSION = "0.1.1675465747";
export const DEFAULT_SEGMENTATION_SCRIPT_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MEDIAPIPE_VERSION}/selfie_segmentation.js`;
export const DEFAULT_SEGMENTATION_BASE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MEDIAPIPE_VERSION}`;

let segmenterPromise: Promise<Segmenter> | null = null;
let segmenterCacheKey: string | null = null;

/**
 * Create the lazily-loaded MediaPipe segmenter. Consumers can supply local or
 * approved CDN URLs for strict CSP and offline-capable deployments.
 */
export function loadSegmenter(assets: SegmentationAssets = {}): Promise<Segmenter> {
  const scriptUrl = assets.scriptUrl ?? DEFAULT_SEGMENTATION_SCRIPT_URL;
  const baseUrl = assets.baseUrl ?? DEFAULT_SEGMENTATION_BASE_URL;
  const cacheKey = `${scriptUrl}\n${baseUrl}`;

  if (segmenterPromise && segmenterCacheKey === cacheKey) return segmenterPromise;

  const promise = createSegmenter(scriptUrl, baseUrl);
  segmenterPromise = promise;
  segmenterCacheKey = cacheKey;
  void promise.catch(() => {
    if (segmenterPromise === promise) {
      segmenterPromise = null;
      segmenterCacheKey = null;
    }
  });
  return promise;
}

async function createSegmenter(scriptUrl: string, baseUrl: string): Promise<Segmenter> {
  await injectScript(scriptUrl);
  const SelfieSegmentation =
    (window as unknown as { SelfieSegmentation?: new (cfg: { locateFile: (f: string) => string }) => {
      setOptions(opts: { modelSelection: 0 | 1; selfieMode: boolean }): void;
      onResults(cb: (res: { segmentationMask: HTMLCanvasElement }) => void): void;
      send(inputs: { image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement }): Promise<void>;
      close(): Promise<void>;
      reset(): void;
    } }).SelfieSegmentation;

  if (!SelfieSegmentation) {
    throw new Error("MediaPipe SelfieSegmentation was not available after the script loaded");
  }

  const seg = new SelfieSegmentation({
    locateFile: (file: string) => `${baseUrl.replace(/\/$/, "")}/${file}`,
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
            if (!done) {
              done = true;
              res(null);
            }
          }).catch(() => {
            if (!done) {
              done = true;
              res(null);
            }
          });
        });
        return result ? maskToImageData(result.segmentationMask) : null;
      },
    };

    // Initialise with a tiny blank image. A timeout lets the UI fall back to
    // keypoint/manual guides if a CDN is unavailable rather than waiting forever.
    const probe = document.createElement("canvas");
    probe.width = 2;
    probe.height = 2;
    let settled = false;
    seg.onResults(() => {
      if (settled) return;
      settled = true;
      ready.ready = true;
      resolve(ready);
    });
    seg.send({ image: probe }).catch(() => {
      // The timeout below resolves a not-ready segmenter for graceful fallback.
    });
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(ready);
    }, 20000);
  });
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(
      (script) => script.dataset.sizeTapeSegmentationSrc === src
    );
    if (existing) {
      if ((window as unknown as { SelfieSegmentation?: unknown }).SelfieSegmentation) {
        resolve();
        return;
      }
      waitForScript(existing, resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.sizeTapeSegmentationSrc = src;
    waitForScript(script, resolve, reject);
    document.head.appendChild(script);
  });
}

function waitForScript(
  script: HTMLScriptElement,
  resolve: () => void,
  reject: (reason: Error) => void
) {
  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    callback();
  };
  const timeout = window.setTimeout(() => {
    finish(() => reject(new Error("MediaPipe script load timeout")));
  }, 15000);
  script.addEventListener("load", () => finish(resolve), { once: true });
  script.addEventListener("error", () => finish(() => reject(new Error(`Failed to load ${script.src}`))), { once: true });
}

function maskToImageData(canvas: HTMLCanvasElement): ImageData {
  // The mask is a 1-channel alpha-blended image. Threshold at 128.
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context available for segmentation mask");
  const src = ctx.getImageData(0, 0, w, h);
  const out = new ImageData(w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i + 3] > 128 ? 255 : 0;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

/* ─────────────────────────────────────────────
   Measure the silhouette's horizontal extent in a vertical band.
───────────────────────────────────────────── */
export function silhouetteWidthInBand(
  mask: ImageData,
  y0Frac: number,
  y1Frac: number
): SilhouetteWidth | null {
  const w = mask.width;
  const h = mask.height;
  const y0 = Math.max(0, Math.floor(h * y0Frac));
  const y1 = Math.min(h, Math.ceil(h * y1Frac));
  let left = -1;
  let right = -1;
  let pixels = 0;
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

/** Average the silhouette width over several rows for a smoother measurement. */
export function silhouetteWidthAveraged(
  mask: ImageData,
  centerYFrac: number,
  halfBandFrac: number
): SilhouetteWidth | null {
  const samples: SilhouetteWidth[] = [];
  const offsets = [-0.02, -0.01, 0, 0.01, 0.02];
  for (const offset of offsets) {
    const yc = centerYFrac + offset;
    const sample = silhouetteWidthInBand(mask, yc - halfBandFrac, yc + halfBandFrac);
    if (sample) samples.push(sample);
  }
  if (samples.length === 0) return null;
  return {
    leftFrac: samples.reduce((sum, sample) => sum + sample.leftFrac, 0) / samples.length,
    rightFrac: samples.reduce((sum, sample) => sum + sample.rightFrac, 0) / samples.length,
    pixelsInBand: samples.reduce((sum, sample) => sum + sample.pixelsInBand, 0),
    imageW: mask.width,
    imageH: mask.height,
  };
}
