/* ─────────────────────────────────────────────
   useWorkerDetector — runs pose detection in a Web Worker to keep the main
   thread responsive. The worker can use a self-hosted MoveNet model URL.
───────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import type { PoseKeypoint } from "../utils/poseModel";

export type WorkerPoseModel = "movenet-thunder" | "movenet-lightning";

export interface WorkerDetectorState {
  ready: boolean;
  status: string;
  error: string | null;
}

interface PendingDetection {
  resolve: (value: { keypoints: PoseKeypoint[]; averageScore: number }) => void;
  reject: (reason: Error) => void;
  timeoutId: number;
}

export function useWorkerDetector(
  model: WorkerPoseModel = "movenet-thunder",
  modelUrl?: string
) {
  const [state, setState] = useState<WorkerDetectorState>({
    ready: false,
    status: "Preparing photo scanner…",
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const callbacks = useRef(new Map<number, PendingDetection>());
  const nextId = useRef(1);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      setState({ ready: false, status: "Photo scanner unavailable", error: "Web Worker support is unavailable" });
      return;
    }

    setState({ ready: false, status: "Preparing photo scanner…", error: null });
    let initTimer: number | null = null;
    let worker: Worker | null = null;
    let initSettled = false;

    const rejectPending = (reason: string) => {
      for (const pending of callbacks.current.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error(reason));
      }
      callbacks.current.clear();
    };

    try {
      worker = new Worker(
        new URL("../workers/poseWorker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;
      initTimer = window.setTimeout(() => {
        if (initSettled) return;
        initSettled = true;
        worker?.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        rejectPending("Photo scanner initialization timed out");
        setState({
          ready: false,
          status: "Photo scanner could not load",
          error: "Worker initialization timed out",
        });
      }, 30000);

      worker.addEventListener("error", (event) => {
        const message = event.message || "Photo scanner worker failed to load";
        if (initTimer !== null) window.clearTimeout(initTimer);
        initSettled = true;
        worker?.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        rejectPending(message);
        setState({ ready: false, status: "Photo scanner unavailable", error: message });
      });

      worker.addEventListener("message", (event) => {
        const message = event.data as {
          type?: string;
          ok?: boolean;
          error?: string;
          id?: number;
          keypoints?: PoseKeypoint[];
          averageScore?: number;
        };
        if (message.type === "init") {
          initSettled = true;
          if (initTimer !== null) window.clearTimeout(initTimer);
          if (message.ok) {
            setState({ ready: true, status: "Photo scanner ready", error: null });
          } else {
            const error = message.error ?? "Photo scanner initialization failed";
            setState({ ready: false, status: "Photo scanner could not load", error });
          }
          return;
        }

        if (message.type === "detect" && typeof message.id === "number") {
          const pending = callbacks.current.get(message.id);
          if (!pending) return;
          callbacks.current.delete(message.id);
          window.clearTimeout(pending.timeoutId);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve({
              keypoints: message.keypoints ?? [],
              averageScore: message.averageScore ?? 0,
            });
          }
        }
      });

      worker.postMessage({ type: "init", model, modelUrl });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      rejectPending(error);
      setState({ ready: false, status: "Photo scanner unavailable", error });
    }

    return () => {
      if (initTimer !== null) window.clearTimeout(initTimer);
      rejectPending("Photo scanner was stopped");
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [model, modelUrl]);

  async function detect(
    image: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  ): Promise<{ keypoints: PoseKeypoint[]; averageScore: number }> {
    const worker = workerRef.current;
    if (!worker) return { keypoints: [], averageScore: 0 };

    const bitmap = await createImageBitmap(image);
    const id = nextId.current++;
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        const pending = callbacks.current.get(id);
        if (!pending) return;
        callbacks.current.delete(id);
        bitmap.close();
        reject(new Error("Photo scanner timed out while analyzing the image"));
      }, 45000);
      callbacks.current.set(id, { resolve, reject, timeoutId });
      try {
        worker.postMessage({ type: "detect", id, bitmap }, [bitmap]);
      } catch (cause) {
        window.clearTimeout(timeoutId);
        callbacks.current.delete(id);
        bitmap.close();
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  return { ...state, detect };
}
