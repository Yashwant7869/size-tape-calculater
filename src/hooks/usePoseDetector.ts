/* ─────────────────────────────────────────────
   usePoseDetector — loads the model on mount,
   exposes estimate + a `ready` flag.
───────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import {
  loadPoseDetector, disposePoseDetector,
  type PoseDetectorLike, type PoseModelKind,
} from "../utils/poseModel";

export interface UsePoseDetectorResult {
  detector: PoseDetectorLike | null;
  ready: boolean;
  status: string;
  kind: PoseModelKind;
}

export function usePoseDetector(
  preferred: PoseModelKind = "movenet-thunder"
): UsePoseDetectorResult {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing photo scanner…");
  const [kind, setKind] = useState<PoseModelKind>(preferred);
  const detectorRef = useRef<PoseDetectorLike | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setReady(false);
    setStatus("Preparing photo scanner…");
    loadPoseDetector(preferred)
      .then((d) => {
        if (cancelled.current) {
          d.kind; // noop
          return;
        }
        detectorRef.current = d;
        setKind(d.kind);
        setReady(true);
        setStatus("Photo scanner ready");
      })
      .catch(() => {
        if (cancelled.current) return;
        setStatus("Automatic scanning is unavailable — adjust the guides manually");
      });
    return () => {
      cancelled.current = true;
      // We deliberately keep the detector cached for the component
      // lifetime; it's a heavy resource. Only dispose on unmount of
      // the root component (handled in SizeTapeCalculator).
    };
  }, [preferred]);

  return { detector: detectorRef.current, ready, status, kind };
}

export function useDisposeDetectorOnUnmount() {
  useEffect(() => () => { disposePoseDetector(); }, []);
}
