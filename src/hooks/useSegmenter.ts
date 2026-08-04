/* ─────────────────────────────────────────────
   useSegmenter — MediaPipe Selfie Segmentation loader.
───────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { loadSegmenter, type Segmenter } from "../utils/segmentation";

export function useSegmenter() {
  const [segmenter, setSegmenter] = useState<Segmenter | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing body outline scanner…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    setStatus("Preparing body outline scanner…");
    loadSegmenter()
      .then((s) => {
        if (cancelled) return;
        setSegmenter(s);
        // Wait until the model has actually produced a result.
        const id = setInterval(() => {
          if (cancelled) { clearInterval(id); return; }
          if (s.ready) {
            clearInterval(id);
            setReady(true);
            setStatus("Body outline ready");
          }
        }, 100);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Body outline scanner could not load — width will be estimated from keypoints only.");
        setStatus("Body outline unavailable");
      });
    return () => { cancelled = true; };
  }, []);

  return { segmenter, ready, status, error };
}
