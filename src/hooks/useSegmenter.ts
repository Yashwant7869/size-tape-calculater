/* ─────────────────────────────────────────────
   useSegmenter — optional MediaPipe Selfie Segmentation loader.
───────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { loadSegmenter, type SegmentationAssets, type Segmenter } from "../utils/segmentation";

export function useSegmenter(assets: SegmentationAssets | undefined, enabled = true) {
  const [segmenter, setSegmenter] = useState<Segmenter | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing body outline scanner…");
  const [error, setError] = useState<string | null>(null);
  const scriptUrl = assets?.scriptUrl;
  const baseUrl = assets?.baseUrl;

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setSegmenter(null);
      setReady(false);
      setError(null);
      setStatus("Body outline scanner disabled");
      return () => { cancelled = true; };
    }

    setSegmenter(null);
    setReady(false);
    setError(null);
    setStatus("Preparing body outline scanner…");
    loadSegmenter({ scriptUrl, baseUrl })
      .then((loadedSegmenter) => {
        if (cancelled) return;
        setSegmenter(loadedSegmenter);
        // Wait until the model has produced a result, but stop polling so a
        // blocked/offline CDN does not leave the UI in a permanent loading state.
        let tries = 0;
        const id = window.setInterval(() => {
          tries++;
          if (cancelled) {
            window.clearInterval(id);
            return;
          }
          if (loadedSegmenter.ready) {
            window.clearInterval(id);
            setReady(true);
            setStatus("Body outline ready");
          } else if (tries >= 250) {
            window.clearInterval(id);
            setError("Body outline scanner could not load — width will be estimated from keypoints only.");
            setStatus("Body outline unavailable");
          }
        }, 100);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSegmenter(null);
        setError(cause instanceof Error ? cause.message : "Body outline scanner could not load.");
        setStatus("Body outline unavailable");
      });
    return () => { cancelled = true; };
  }, [baseUrl, enabled, scriptUrl]);

  return { segmenter, ready, status, error };
}
