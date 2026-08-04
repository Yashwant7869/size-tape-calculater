/* ─────────────────────────────────────────────
   useWorkerDetector — runs pose detection in a
   Web Worker to keep the main thread responsive.
───────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import type { PoseKeypoint } from "../utils/poseModel";

export interface WorkerDetectorState {
  ready: boolean;
  status: string;
  error: string | null;
}

export function useWorkerDetector() {
  const [state, setState] = useState<WorkerDetectorState>({
    ready: false,
    status: "Preparing photo scanner…",
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const callbacks = useRef(new Map<number, (kps: PoseKeypoint[], avg: number) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      setState({ ready: false, status: "Photo scanner unavailable", error: "no worker support" });
      return;
    }
    try {
      const w = new Worker(
        new URL("../workers/poseWorker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = w;
      w.addEventListener("message", (e) => {
        const m = e.data;
        if (m.type === "init") {
          if (m.ok) {
            setState({ ready: true, status: "Photo scanner ready", error: null });
          } else {
            setState({ ready: false, status: "Photo scanner could not load", error: m.error ?? "init failed" });
          }
        } else if (m.type === "detect") {
          const cb = callbacks.current.get(m.id);
          if (cb) {
            cb(m.keypoints, m.averageScore);
            callbacks.current.delete(m.id);
          }
        }
      });
      w.postMessage({ type: "init", model: "movenet-thunder" });
    } catch (err) {
      setState({
        ready: false,
        status: "Photo scanner unavailable",
        error: String(err),
      });
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  async function detect(image: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Promise<{ keypoints: PoseKeypoint[]; averageScore: number }> {
    if (!workerRef.current) {
      return { keypoints: [], averageScore: 0 };
    }
    // Create an ImageBitmap from the source.
    let bitmap: ImageBitmap;
    if (image instanceof HTMLVideoElement) {
      bitmap = await createImageBitmap(image);
    } else if (image instanceof HTMLCanvasElement) {
      bitmap = await createImageBitmap(image);
    } else {
      bitmap = await createImageBitmap(image);
    }
    const id = nextId.current++;
    return new Promise((resolve) => {
      callbacks.current.set(id, (keypoints, averageScore) => {
        resolve({ keypoints, averageScore });
      });
      workerRef.current!.postMessage({ type: "detect", id, bitmap }, [bitmap]);
    });
  }

  return { ...state, detect };
}
