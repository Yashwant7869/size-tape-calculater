/* ─────────────────────────────────────────────
   useWorkerDetector — runs pose detection in a
   Web Worker to keep the main thread responsive.
───────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import type { PoseKeypoint, PoseModelKind } from "../utils/poseModel";

export interface WorkerDetectorState {
  ready: boolean;
  status: string;
  error: string | null;
}

export function useWorkerDetector(model: PoseModelKind = "movenet-thunder") {
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
    setState({ ready: false, status: "Preparing photo scanner…", error: null });
    let initTimer: number | null = null;
    try {
      const w = new Worker(
        new URL("../workers/poseWorker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = w;
      let initSettled = false;
      initTimer = window.setTimeout(() => {
        if (initSettled) return;
        initSettled = true;
        setState({
          ready: false,
          status: "Photo scanner could not load",
          error: "worker init timeout",
        });
      }, 30000);
      w.addEventListener("error", (event) => {
        if (initSettled) return;
        initSettled = true;
        if (initTimer !== null) window.clearTimeout(initTimer);
        setState({
          ready: false,
          status: "Photo scanner unavailable",
          error: event.message || "worker failed to load",
        });
      });
      w.addEventListener("message", (e) => {
        const m = e.data;
        if (m.type === "init") {
          initSettled = true;
          if (initTimer !== null) window.clearTimeout(initTimer);
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
      w.postMessage({ type: "init", model });
    } catch (err) {
      setState({
        ready: false,
        status: "Photo scanner unavailable",
        error: String(err),
      });
    }
    return () => {
      if (initTimer !== null) window.clearTimeout(initTimer);
      workerRef.current?.terminate();
      workerRef.current = null;
      callbacks.current.clear();
    };
  }, [model]);

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
