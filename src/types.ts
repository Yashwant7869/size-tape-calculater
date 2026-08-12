import type { CSSProperties } from "react";
import type { Measurements, Recommendations } from "./hooks/useMeasurements";
import type { SizeStr } from "./utils/measure";
import type { BrandMap, Fit, GarmentClass, Region } from "./utils/sizeTables";

/** The MoveNet variants supported by the bundled browser worker. */
export type MoveNetModel = "movenet-thunder" | "movenet-lightning";

/**
 * Optional URLs for deployments that self-host model assets or need to comply
 * with a strict Content Security Policy. Each URL must be CORS-accessible from
 * the page that renders the calculator.
 */
export interface SizeTapeAssetUrls {
  /**
   * URL of a MoveNet `model.json` file. The matching weight shards must be
   * available relative to that file. When omitted, TensorFlow Hub is used.
   */
  moveNetModelUrl?: string;
  /** URL of the MediaPipe Selfie Segmentation JavaScript loader. */
  segmentationScriptUrl?: string;
  /** Base URL used by the MediaPipe segmentation loader for its WASM/model files. */
  segmentationBaseUrl?: string;
}

/** A completed calculation, emitted whenever the active recommendation changes. */
export interface SizeTapeResult {
  name: string | null;
  gender: "male" | "female" | null;
  measurements: Measurements;
  recommendations: Recommendations;
  selectedGarment: GarmentClass;
  selectedSize: SizeStr;
  fit: Fit;
  region: Region;
  brand: string | null;
}
 
 

export type SizeTapeErrorSource = "pose-detector" | "segmentation";

/** A non-fatal scanner error. The calculator falls back to manual guidance where possible. */
export interface SizeTapeError {
  source: SizeTapeErrorSource;
  message: string;
}

/**
 * Props for the drop-in calculator widget.
 *
 * All `initial*` values seed the first render and remain user-editable in the
 * calculator UI. Use `onResult` to receive the selected recommendation in the
 * parent application.
 */
export interface SizeTapeCalculatorProps {
  /** Additional class name applied to the isolated calculator root. */
  className?: string;
  /** Inline styles applied to the isolated calculator root. */
  style?: CSSProperties;
  /** Optional brand-specific measurement tables keyed by the brand name shown in the UI. */
  brandCharts?: BrandMap;
  initialBrand?: string;
  initialFit?: Fit;
  initialRegion?: Region;
  initialGarment?: GarmentClass;
  initialPoseModel?: MoveNetModel;
  /** Set to false to avoid loading MediaPipe segmentation completely. */
  enableSegmentation?: boolean;
  /** Override remote model/script URLs, e.g. for self-hosted or offline deployments. */
  assetUrls?: SizeTapeAssetUrls;
  /** Called after a measurement is calculated or its selected recommendation changes. */
  onResult?: (result: SizeTapeResult) => void;
  /** Called when a non-fatal pose or segmentation scanner error occurs. */
  onError?: (error: SizeTapeError) => void;
}
