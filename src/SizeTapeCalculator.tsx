import { useEffect, useRef, useState, useCallback, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { ReactElement } from "react";
import type { SizeTapeCalculatorProps } from "./types";

/* ─────────────────────────────────────────────
   Local types & helpers
───────────────────────────────────────────── */
type Gender = "male" | "female";
type SizeStr = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL";
type PhotoType = "front" | "side";
type CameraFacing = "user" | "environment";
type CalibrationMethod = "height" | "card";

import {
  type KeypointWithNoise,
  ORDER,
  waistlineFraction,
} from "./utils/measure";
import {
  sizeTable, waistRangeForSize, type SizeRow,
  type BrandMap, type Fit, type GarmentClass, type Region,
} from "./utils/sizeTables";
import {
  gateKeypoints, validateOrientation,
  checkPhotoAcceptance, imageQuality,
  type ImageQuality,
} from "./utils/imageAnalysis";
import { agreementConfidence } from "./utils/confidence";
import {
  calibrate, CARD_WIDTH_CM, CARD_ASPECT,
  type CalibrationInput, type CalibrationEstimate,
} from "./utils/calibration";
import { silhouetteWidthAveraged, type SilhouetteWidth } from "./utils/segmentation";
import { useWorkerDetector, type WorkerPoseModel } from "./hooks/useWorkerDetector";
import { useSegmenter } from "./hooks/useSegmenter";
import {
  computeMeasurements, recommendSizes,
  type DetectionResult, type Measurements, type Recommendations,
} from "./hooks/useMeasurements";

/* ─────────────────────────────────────────────
   Component styles

   The rules are namespaced to the calculator root and deliberately avoid
   changing host-page body, root, universal-selector, or font defaults.
───────────────────────────────────────────── */
const GLOBAL_CSS = `
  .st-root{
    --ink:#1B2A4A;--brass:#B08D57;--chalk:#EDE7DD;--stitch:#C1443C;
    --sage:#7A8B6F;--paper:#F7F4EE;--line:#D8D0BF;--blue:#3B82F6;
    --st-font-sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --st-font-serif:ui-serif,Georgia,Cambria,"Times New Roman",serif;
    --st-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;
    margin:0;background:var(--paper);color:var(--ink);font-family:var(--st-font-sans);padding:0 0 60px;
  }
  .st-root,.st-root *,.st-root *:before,.st-root *:after{box-sizing:border-box;}
  .st-modal-overlay{min-height:100vh;padding:24px;display:flex;align-items:center;justify-content:center;background:rgba(27,42,74,.34);backdrop-filter:blur(6px);}
  .st-modal{width:min(680px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 80px rgba(27,42,74,.22);}
  .st-modal-top{padding:18px 22px 14px;border-bottom:1px solid var(--line);background:linear-gradient(145deg,#fff 0%,#f8f3e9 100%);}
  .st-modal-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .st-modal-eyebrow{font-family:var(--st-font-mono);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 3px;}
  .st-modal-title{font-family:var(--st-font-serif);font-size:23px;font-weight:600;line-height:1.1;margin:0;}
  .st-modal-close{width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .st-progress{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:16px;}
  .st-progress-step{display:flex;align-items:center;gap:7px;min-width:0;color:#9097a4;font-size:11px;font-weight:700;}
  .st-progress-dot{width:24px;height:24px;border-radius:50%;border:1.5px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-family:var(--st-font-mono);font-size:10px;}
  .st-progress-step.active{color:var(--ink);}
  .st-progress-step.active .st-progress-dot{border-color:var(--ink);background:var(--ink);color:#fff;}
  .st-progress-step.done{color:var(--sage);}
  .st-progress-step.done .st-progress-dot{border-color:var(--sage);background:#eef3ea;color:var(--sage);}
  .st-modal-body{padding:22px;}
  .st-step{margin:0;background:#fff;border:0;border-radius:0;padding:0;position:relative;transition:opacity .2s;}
  .st-step-head{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;}
  .st-step-head .st-num{display:none;}
  .st-hint{font-size:11.5px;color:#8a8f9c;margin-left:auto;}
  .st-step h2{font-family:var(--st-font-serif);font-size:22px;font-weight:600;margin:0;}
  .st-step-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:22px;padding-top:16px;border-top:1px solid #eee9df;}
  .st-back-btn{border:0;background:transparent;color:#6f7787;font-size:12.5px;font-weight:700;cursor:pointer;padding:9px 4px;}
  .st-back-btn:hover{color:var(--ink);}
  .st-modal-footer{padding:12px 22px;border-top:1px solid var(--line);background:#faf8f3;color:#7b8493;font-size:10.5px;text-align:center;}

  .st-root button,.st-root input,.st-root select{font:inherit;}
  .st-root button:focus-visible,.st-root input:focus-visible,.st-root select:focus-visible,.st-root summary:focus-visible{outline:3px solid rgba(59,130,246,.28);outline-offset:3px;}
  .st-wrap{width:100%;margin:0;padding:0;}
  .st-tape{display:none;}
  .st-header{display:none;}
  .st-header:after{content:"";position:absolute;width:240px;height:240px;border:46px solid rgba(176,141,87,.08);border-radius:50%;right:-105px;top:-130px;pointer-events:none;z-index:0;}
  .st-header > *{position:relative;z-index:1;}
  .st-eyebrow{font-family:var(--st-font-mono);font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 9px;}
  .st-h1{font-family:var(--st-font-serif);font-weight:600;font-size:clamp(34px,6vw,50px);margin:0 0 12px;line-height:1.05;max-width:650px;letter-spacing:-.02em;}
  .st-header-copy{margin:0;color:#5b6478;font-size:16px;line-height:1.65;max-width:62ch;position:relative;z-index:1;}
  .st-hero-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:24px;position:relative;z-index:1;}
  .st-hero-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:10px;padding:13px 19px;background:var(--ink);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 20px rgba(27,42,74,.16);transition:transform .15s,box-shadow .15s;}
  .st-hero-btn:hover{transform:translateY(-1px);box-shadow:0 11px 24px rgba(27,42,74,.2);}
  .st-time-note{font-size:12.5px;color:#6f7787;font-weight:600;}
  .st-trust-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:20px;position:relative;z-index:1;}
  .st-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid rgba(122,139,111,.2);border-radius:20px;background:#eef3ea;color:#55654c;font-size:11.5px;font-weight:600;}
  .st-pill.status{border-color:var(--line);background:rgba(255,255,255,.72);color:#707887;font-weight:500;}
  .st-pill-icon{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#dce8d5;font-size:11px;font-weight:800;}
  .st-dot{width:7px;height:7px;border-radius:50%;background:#c9c2ac;flex-shrink:0;}
  .st-dot.ready{background:var(--sage);}
  .st-dot.busy{background:var(--brass);animation:st-pulse 1s infinite;}
  .st-quick-flow{display:none;}
  .st-flow-item{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.82);}
  .st-flow-num{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--chalk);color:var(--ink);font-family:var(--st-font-mono);font-size:11px;font-weight:700;}
  .st-flow-item strong{display:block;font-size:12.5px;line-height:1.25;}
  .st-flow-item small{display:block;margin-top:2px;color:#858c99;font-size:10.5px;}
  @keyframes st-pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .st-step{margin-top:28px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px;position:relative;transition:opacity .2s;}
  .st-step.locked{opacity:1;pointer-events:auto;}
  .st-step-head{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
  .st-num{font-family:var(--st-font-mono);font-weight:600;font-size:13px;width:28px;height:28px;border-radius:50%;border:1.5px solid var(--ink);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .st-hint{font-size:12.5px;color:#8a8f9c;margin-left:auto;}
  .st-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
  .st-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px;}
  .st-label{display:block;font-size:12.5px;font-weight:600;color:#5b6478;margin-bottom:6px;letter-spacing:.02em;}
  .st-input{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:9px;font-family:var(--st-font-mono);font-size:16px;background:var(--paper);color:var(--ink);}
  .st-input:focus{outline:none;border-color:var(--brass);}
  .st-select{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:9px;font-family:var(--st-font-sans);font-size:14px;background:var(--paper);color:var(--ink);}
  .st-select:focus{outline:none;border-color:var(--brass);}
  .st-gtoggle{display:flex;gap:8px;margin-bottom:14px;}
  .st-gbtn{flex:1;padding:12px;border:1.5px solid var(--line);background:var(--paper);border-radius:9px;font-family:var(--st-font-sans);font-weight:600;font-size:14px;cursor:pointer;color:#5b6478;transition:.15s;}
  .st-gbtn.active{border-color:var(--ink);background:var(--ink);color:#fff;}
  .st-gbtn.blue{border-color:var(--blue);background:var(--blue);color:#fff;}
  .st-btn{display:inline-flex;align-items:center;gap:8px;background:var(--stitch);color:#fff;border:none;border-radius:9px;padding:12px 20px;font-family:var(--st-font-sans);font-weight:600;font-size:14.5px;cursor:pointer;transition:.15s;margin-top:6px;}
  .st-btn:hover{filter:brightness(1.06);}
  .st-btn.secondary{background:transparent;color:var(--ink);border:1.5px solid var(--ink);}
  .st-btn.ghost{background:transparent;color:#8a8f9c;border:1px dashed var(--line);}
  .st-btn.blue{background:var(--blue);}
  .st-btn:disabled{opacity:.4;cursor:not-allowed;}
  .st-baseline{margin-top:16px;padding:14px 16px;background:var(--chalk);border-radius:10px;font-family:var(--st-font-mono);font-size:13.5px;}
  .st-baseline b{font-family:var(--st-font-serif);font-size:17px;}
  .st-upload-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .st-upload-zone{border:1.5px dashed #bfc6d1;border-radius:12px;padding:22px 14px;text-align:center;cursor:pointer;background:#fff;transition:border-color .15s,background .15s,transform .15s;}
  .st-upload-zone:hover{border-color:var(--brass);background:#fffcf7;transform:translateY(-1px);}
  .st-upload-zone.active{border-color:var(--sage);background:rgba(122,139,111,0.08);}
  .st-upload-icon{width:38px;height:38px;margin:0 auto 9px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--chalk);color:var(--ink);font-size:20px;font-weight:600;}
  .st-upload-zone strong{display:block;color:var(--ink);font-size:13px;}
  .st-upload-zone span{display:block;margin-top:4px;color:#8a8f9c;font-size:11px;}
  .st-video{width:100%;border-radius:10px;margin-top:12px;background:#000;min-height:180px;object-fit:cover;}
  .st-camera-status{display:flex;align-items:center;gap:9px;margin-top:12px;padding:11px 13px;border-radius:9px;background:var(--chalk);color:#5b6478;font-size:12.5px;line-height:1.4;}
  .st-camera-status.error{background:#faf1e8;color:#a5652a;}
  .st-camera-status .st-spinner{border-color:currentColor;border-top-color:transparent;}
  .st-camera-switch{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;}
  .st-camera-switch-label{font-size:12px;font-weight:600;color:#697386;margin-right:2px;}
  .st-camera-switch-btn{border:1.5px solid var(--line);border-radius:8px;padding:8px 11px;background:var(--paper);color:#5b6478;font-size:12px;font-weight:700;cursor:pointer;transition:.15s;}
  .st-camera-switch-btn:hover:not(:disabled){border-color:var(--brass);background:#fff;}
  .st-camera-switch-btn.active{border-color:var(--ink);background:var(--ink);color:#fff;}
  .st-camera-switch-btn:disabled{cursor:default;opacity:1;}
  .st-cam-controls{display:flex;gap:10px;margin-top:10px;}
  .st-photo-stage{position:relative;display:inline-block;max-width:100%;margin-top:16px;touch-action:none;overflow:hidden;border-radius:10px;background:#0000000d;}
  .st-zoom-wrap{position:relative;display:inline-block;transform-origin:center center;transition:transform .08s ease-out;}
  .st-photo-stage img{display:block;max-width:100%;border-radius:10px;user-select:none;-webkit-user-drag:none;}
  .st-photo-stage svg{position:absolute;top:0;left:0;width:100%;height:100%;}
  .st-instructions{font-size:12.5px;color:#8a8f9c;margin-top:10px;line-height:1.5;}
  .st-instructions b{color:var(--ink);}
  .st-detect-banner{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:9px;background:var(--chalk);font-size:13px;margin-top:14px;}
  .st-detect-banner.warn{background:#faf1e8;color:#a5652a;}
  .st-detect-banner.success{background:#eef3ea;color:var(--sage);}
  .st-spinner{width:14px;height:14px;border:2px solid var(--brass);border-top-color:transparent;border-radius:50%;animation:st-spin .7s linear infinite;flex-shrink:0;}
  @keyframes st-spin{to{transform:rotate(360deg)}}
  .st-zoom-controls{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap;}
  .st-zctrl{width:38px;height:38px;border-radius:9px;border:1.5px solid var(--line);background:var(--paper);font-family:var(--st-font-mono);font-size:16px;font-weight:600;color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;}
  .st-zctrl:hover{border-color:var(--brass);background:#fff;}
  .st-zctrl:active{transform:scale(.92);}
  .st-zgroup{display:flex;gap:6px;}
  .st-zlabel{font-size:11.5px;color:#8a8f9c;font-family:var(--st-font-mono);margin-right:2px;}
  .st-reset-z{padding:0 12px;width:auto;font-size:12px;font-weight:600;color:#8a8f9c;background:transparent;border:1px dashed var(--line);}
  .st-result-hero{text-align:center;padding:30px 20px;background:var(--ink);color:#fff;border-radius:12px;}
  .st-result-hero .st-eyebrow{color:var(--brass);opacity:1;}
  .st-size-big{font-family:var(--st-font-serif);font-size:64px;font-weight:700;margin:6px 0;}
  .st-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;}
  .st-result-card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px 16px;}
  .st-result-card .val{font-family:var(--st-font-mono);font-size:20px;font-weight:600;}
  .st-result-card .val.with-unc{font-size:16px;}
  .st-result-card .unc{font-size:11.5px;color:#8a8f9c;font-weight:500;}
  .st-flag{margin-top:14px;padding:12px 14px;border-radius:9px;font-size:13px;line-height:1.5;}
  .st-flag.ok{background:#eef3ea;color:var(--sage);}
  .st-flag.warn{background:#faf1e8;color:#a5652a;}
  table.st-sizechart{width:100%;border-collapse:collapse;margin-top:16px;font-family:var(--st-font-mono);font-size:12.5px;}
  table.st-sizechart th,table.st-sizechart td{border:1px solid var(--line);padding:8px 10px;text-align:center;}
  table.st-sizechart th{background:var(--chalk);}
  .st-size-row.hit{background:var(--stitch);color:#fff;font-weight:700;}
  footer.st-note{display:grid;grid-template-columns:auto 1fr;gap:12px;margin-top:28px;padding:18px;border:1px solid var(--line);border-radius:12px;background:#fff;color:#717a89;font-size:12px;line-height:1.6;}
  .st-footer-mark{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#e8f0e3;color:#53684a;font-weight:800;}
  footer.st-note strong{display:block;color:var(--ink);font-size:12.5px;margin-bottom:2px;}
  footer.st-note p{margin:0;}
  .st-disclaimer{margin-top:5px!important;color:#8b929d;}
  .st-measure-details{margin-top:12px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden;}
  .st-measure-details summary{padding:12px 14px;color:#5b6478;font-size:12px;font-weight:600;cursor:pointer;list-style:none;}
  .st-measure-details summary::-webkit-details-marker{display:none;}
  .st-measure-details summary:after{content:"+";float:right;font-family:var(--st-font-mono);}
  .st-measure-details[open] summary:after{content:"−";}
  .st-measure-details p{margin:0;padding:0 14px 14px;color:#7a8290;font-size:11.5px;line-height:1.6;}
  .st-handle{cursor:grab;}
  .st-handle:active{cursor:grabbing;}
  .st-tabs{display:flex;gap:8px;margin-bottom:16px;}
  .st-tab{flex:1;padding:10px 14px;border:1.5px solid var(--line);background:var(--paper);border-radius:9px;font-family:var(--st-font-sans);font-weight:600;font-size:13px;cursor:pointer;color:#5b6478;transition:.15s;text-align:center;}
  .st-tab.active{border-color:var(--brass);background:var(--brass);color:#fff;}
  .st-tab .icon{font-size:18px;display:block;margin-bottom:4px;}
  .st-confidence{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--chalk);border-radius:8px;margin-top:12px;font-size:13px;}
  .st-confidence-bar{flex:1;height:8px;background:#d8d0bf;border-radius:4px;overflow:hidden;}
  .st-confidence-fill{height:100%;border-radius:4px;transition:width .3s;}
  .st-photo-guide{margin-top:16px;padding:18px;border:1px solid #dbe1e8;border-radius:12px;background:#f8fafc;}
  .st-guide-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;}
  .st-guide-head h3{margin:0;font-size:14px;line-height:1.4;}
  .st-guide-head p{margin:3px 0 0;color:#7b8493;font-size:12px;line-height:1.4;}
  .st-guide-time{flex:0 0 auto;padding:5px 9px;border-radius:20px;background:#fff;border:1px solid #dbe1e8;color:#697386;font-size:10.5px;font-weight:700;}
  .st-guide-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;}
  .st-guide-item{display:flex;align-items:flex-start;gap:9px;padding:10px;background:#fff;border:1px solid #e5e9ef;border-radius:9px;}
  .st-guide-check{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:#e5eee0;color:#5e7254;font-size:11px;font-weight:800;}
  .st-guide-item strong{display:block;font-size:11.5px;line-height:1.3;}
  .st-guide-item small{display:block;margin-top:2px;color:#7f8794;font-size:10.5px;line-height:1.35;}
  .st-active-tip{margin:10px 0 0;padding:9px 11px;border-left:3px solid var(--blue);background:#eef4ff;color:#44536b;border-radius:0 7px 7px 0;font-size:11.5px;line-height:1.45;}
  .st-privacy-strip{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:10px 12px;border-radius:9px;background:#eef3ea;color:#52624b;font-size:11.5px;line-height:1.45;}
  .st-privacy-strip strong{display:block;color:#42523b;}
  .st-photo-preview{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;}
  .st-photo-thumb{position:relative;width:120px;height:160px;border-radius:8px;overflow:hidden;border:2px solid var(--line);cursor:pointer;}
  .st-photo-thumb.active{border-color:var(--brass);}
  .st-photo-thumb img{width:100%;height:100%;object-fit:cover;}
  .st-photo-thumb .label{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:4px 8px;text-align:center;}
  .st-photo-thumb .remove{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;}
  .st-card-overlay{position:absolute;border:2px dashed var(--blue);background:rgba(59,130,246,0.1);cursor:move;}
  .st-accuracy-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;font-family:var(--st-font-mono);}
  .st-accuracy-badge.high{background:#dcfce7;color:#15803d;}
  .st-accuracy-badge.medium{background:#fef3c7;color:#a16207;}
  .st-accuracy-badge.low{background:#fee2e2;color:#b91c1c;}
  .st-step h2{font-family:var(--st-font-serif);font-size:20px;font-weight:600;margin:0;}
  .st-saved{display:flex;align-items:center;gap:10px;margin-top:16px;padding:12px 14px;border-radius:10px;background:#eef3ea;color:#53644b;font-size:12.5px;line-height:1.45;}
  .st-saved-mark{width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:50%;background:#d7e5d0;font-size:11px;font-weight:800;}
  .st-result-note{margin-top:16px;padding:13px 15px;border:1px solid #dbe1e8;border-radius:10px;background:#f8fafc;color:#657083;font-size:12px;line-height:1.55;}
  .st-result-note strong{color:var(--ink);}

  /* NEW: confidence sub-scores */
  .st-sub-scores{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px;}
  .st-sub-score{display:flex;align-items:center;gap:9px;padding:8px 11px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:11.5px;}
  .st-sub-score .lbl{flex:0 0 110px;color:#5b6478;font-weight:600;}
  .st-sub-score .bar{flex:1;height:6px;background:#d8d0bf;border-radius:3px;overflow:hidden;}
  .st-sub-score .fill{height:100%;border-radius:3px;}
  .st-sub-score .num{flex:0 0 36px;text-align:right;font-family:var(--st-font-mono);font-weight:600;font-size:11.5px;}

  /* NEW: garment picker */
  .st-garment-picker{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px;}
  .st-garment-btn{padding:8px 12px;border:1.5px solid var(--line);background:#fff;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:#5b6478;font-family:var(--st-font-sans);transition:.15s;}
  .st-garment-btn.active{border-color:var(--ink);background:var(--ink);color:#fff;}

  /* NEW: history */
  .st-history{margin-top:14px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden;}
  .st-history summary{padding:11px 14px;color:#5b6478;font-size:12px;font-weight:600;cursor:pointer;list-style:none;}
  .st-history summary::-webkit-details-marker{display:none;}
  .st-history summary:after{content:"+";float:right;font-family:var(--st-font-mono);}
  .st-history[open] summary:after{content:"−";}
  .st-history .item{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;font-size:12px;border-top:1px solid var(--line);font-family:var(--st-font-mono);}

  @media(max-width:680px){
    .st-root{padding-bottom:32px;}
    .st-wrap{padding:16px 12px 0;}
    .st-header{padding:26px 20px;border-radius:16px;}
    .st-h1{font-size:36px;}
    .st-header-copy{font-size:14px;line-height:1.55;}
    .st-quick-flow{grid-template-columns:1fr;}
    .st-flow-item{padding:10px 12px;}
    .st-step{padding:18px 15px;margin-top:16px;}
    .st-row,.st-row-3,.st-result-grid{grid-template-columns:1fr;}
    .st-guide-grid{grid-template-columns:1fr;}
    .st-upload-choices{grid-template-columns:1fr;}
    .st-step-head{align-items:flex-start;}
    .st-hint{width:100%;margin-left:40px;}
    .st-tabs{gap:6px;}
    .st-tab{padding:10px 8px;font-size:12px;}
    .st-tab .icon{font-size:16px;}
    .st-photo-thumb{width:100px;height:134px;}
    .st-confidence{align-items:flex-start;flex-wrap:wrap;}
    .st-confidence-bar{min-width:150px;}
    footer.st-note{padding:15px;}
    .st-sub-scores{grid-template-columns:1fr;}
  }
`;

/* ─────────────────────────────────────────────
   Local state types
───────────────────────────────────────────── */
interface PhotoState {
  src: string | null;
  confidence: number;
  leftX: number; rightX: number; waistY: number; topY: number; bottomY: number;
  autoDetected: boolean;
  keypoints: KeypointWithNoise[];
  keypointAvg: number;
  imageW: number; imageH: number;
  imageQuality: ImageQuality | null;
  silhouette: SilhouetteWidth | null;
  /** For side photo: depth fraction (separate from width) */
  userAdjustedWaist: boolean;
}

interface CardCalibrationState {
  x: number; y: number; w: number; h: number;
}

interface HistoryEntry {
  ts: number;
  size: SizeStr;
  waistCm: number;
  source: string;
}

const HISTORY_KEY = "stc:history:v2";
const EMPTY_BRAND_MAP: BrandMap = {};
const STYLE_SELECTOR = "style[data-size-tape-calculator-styles]";

/**
 * A page may render more than one calculator. Keep one scoped style element
 * while at least one instance is mounted, rather than injecting duplicates.
 */
function retainComponentStyles(): () => void {
  let style = document.querySelector<HTMLStyleElement>(STYLE_SELECTOR);
  if (!style) {
    style = document.createElement("style");
    style.dataset.sizeTapeCalculatorStyles = "true";
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }
  const nextMounts = Number(style.dataset.sizeTapeCalculatorMounts ?? "0") + 1;
  style.dataset.sizeTapeCalculatorMounts = String(nextMounts);

  return () => {
    const mounts = Number(style?.dataset.sizeTapeCalculatorMounts ?? "1") - 1;
    if (mounts <= 0) {
      style?.remove();
    } else if (style) {
      style.dataset.sizeTapeCalculatorMounts = String(mounts);
    }
  };
}

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function SizeTapeCalculator({
  className,
  style,
  brandCharts,
  initialBrand = "",
  initialFit = "regular",
  initialRegion = "US",
  initialGarment = "bottom",
  initialPoseModel = "movenet-thunder",
  enableSegmentation = true,
  assetUrls,
  onResult,
  onError,
}: SizeTapeCalculatorProps = {}): ReactElement {
  const rootClassName = ["st-root", className].filter(Boolean).join(" ");
  /* ── Step 1 state ── */
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [heightVal, setHeightVal] = useState("");
  const [weightVal, setWeightVal] = useState("");
  const [bmi, setBmi] = useState<number | null>(null);
  const [baselineSize, setBaselineSize] = useState<SizeStr | null>(null);

  /* ── Calibration method ── */
  const [calibrationMethod, setCalibrationMethod] = useState<CalibrationMethod>("height");

  /* ── Fit, region, brand (NEW) ── */
  const [fit, setFit] = useState<Fit>(initialFit);
  const [region, setRegion] = useState<Region>(initialRegion);
  const [brand, setBrand] = useState<string>(initialBrand);
  const brandMap = brandCharts ?? EMPTY_BRAND_MAP;

  /* ── Manual override (NEW §7.1) ── */
  const [manualWaistCm, setManualWaistCm] = useState<string>("");

  /* ── Garment class (NEW §4.3) ── */
  const [garment, setGarment] = useState<GarmentClass>(initialGarment);

  /* ── Pose model picker ── */
  const [poseModel, setPoseModel] = useState<WorkerPoseModel>(initialPoseModel);

  /* ── Step 2 state ── */
  const [step2Locked, setStep2Locked] = useState(true);
  const [step3Locked, setStep3Locked] = useState(true);
  const [camActive, setCamActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("environment");
  const [cameraStreamVersion, setCameraStreamVersion] = useState(0);
  const [activePhotoType, setActivePhotoType] = useState<PhotoType>("front");

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Front photo state
  const [front, setFront] = useState<PhotoState>(initialPhotoState());
  // Side photo state
  const [side, setSide] = useState<PhotoState>(initialPhotoState());

  // Card calibration state
  const [cardRect, setCardRect] = useState<CardCalibrationState>({ x: 0.4, y: 0.7, w: 0.2, h: 0.2 * CARD_ASPECT });
  /* Only trust the card rectangle as a scale reference once the user has
     actually touched it — otherwise the default overlay position would be
     treated as a real card (weight 1.0, overriding the height reference). */
  const [cardTouched, setCardTouched] = useState(false);

  const [showInstructions, setShowInstructions] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [detectBanner, setDetectBanner] = useState<{ text: string; type: "loading" | "warn" | "success" } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const draggingRef = useRef<string | null>(null);

  /* ── Zoom / pan state ── */
  const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25, PAN_STEP = 30;
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  /* ── Step 3 state ── */
  const [measurements, setMeasurements] = useState<Measurements | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);

  /* ── History (NEW §7.4) ── */
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  /* ── Model ── */
  const poseWorker = useWorkerDetector(poseModel, assetUrls?.moveNetModelUrl);
  const seg = useSegmenter(
    {
      scriptUrl: assetUrls?.segmentationScriptUrl,
      baseUrl: assetUrls?.segmentationBaseUrl,
    },
    enableSegmentation
  );

  /* ── DOM refs ── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => {
    if (poseWorker.error) {
      onErrorRef.current?.({ source: "pose-detector", message: poseWorker.error });
    }
  }, [poseWorker.error]);
  useEffect(() => {
    if (seg.error) {
      onErrorRef.current?.({ source: "segmentation", message: seg.error });
    }
  }, [seg.error]);

  /* ── Inject isolated component styles once per page ── */
  useEffect(() => retainComponentStyles(), []);

  /* ── Load history ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryEntry[]);
    } catch {/* ignore */ }
  }, []);

  function saveHistory(entry: HistoryEntry) {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 10);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {/* ignore */ }
      return next;
    });
  }

  /* ─── Step 1 ─── */
  function calcBaseline() {
    const h = parseFloat(heightVal), w = parseFloat(weightVal);
    if (!gender) { alert("Please select a gender."); return; }
    if (!h || !w) { alert("Please enter your height and weight."); return; }
    const b = w / Math.pow(h / 100, 2);
    // BMI thresholds — kept from v1.
    const t = gender === "male" ? [18.5, 23, 27, 30] : [17.5, 21.5, 25, 28.5];
    let sz: SizeStr;
    if (b < t[0]) sz = "XS";
    else if (b < t[1]) sz = "S";
    else if (b < t[2]) sz = "M";
    else if (b < t[3]) sz = "L";
    else sz = "XL";
    setBmi(b);
    setBaselineSize(sz);
    setStep2Locked(false);
    setStep3Locked(true);
    setMeasurements(null);
    setCurrentStep(2);
  }

  /* ─── Step 2: zoom / pan ─── */
  function resetZoom() { setZoom(1); setPanX(0); setPanY(0); }
  const zoomIn = () => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom(z => {
    const nz = Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2));
    if (nz === ZOOM_MIN) { setPanX(0); setPanY(0); }
    return nz;
  });
  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom(z => {
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + delta).toFixed(2)));
      if (nz === ZOOM_MIN) { setPanX(0); setPanY(0); }
      return nz;
    });
  }

  /* ─── Image load ─── */
  function loadImageFile(file: File | Blob, type: PhotoType) {
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string;
      const next: PhotoState = {
        ...initialPhotoState(),
        src,
      };
      if (type === "front") {
        setFront(next);
        setCardTouched(false); // new photo → old card position no longer applies
      } else {
        setSide(next);
      }
      setActivePhotoType(type);
      // Fresh upload: clear the detection marker so the new photo is always
      // auto-detected, even if it happens to be the same file as before.
      detectedSrcRef.current[type] = null;
      setShowInstructions(false);
      setShowConfirm(false);
      setDetectBanner(null);
      setWarnings([]);
      resetZoom();
    };
    reader.readAsDataURL(file);
  }

  /* ─── Run detection after image loads ─── */
  async function runDetection(type: PhotoType) {
    setDetectBanner({ text: "Scanning your photo…", type: "loading" });
    setShowInstructions(false);
    setWarnings([]);

    if (!poseWorker.ready) {
      setDetectBanner({ text: "The scanner is not ready yet — adjust the guides manually", type: "warn" });
      finishDetectUI(false); return;
    }

    const imgEl = imgRef.current;
    if (!imgEl || !imgEl.complete) {
      setDetectBanner({ text: "Image is still loading — please wait", type: "warn" });
      finishDetectUI(false);
      return;
    }

    try {
      const { keypoints: rawKps, averageScore } = await poseWorker.detect(imgEl);

      // Convert: keypoint names are guaranteed by the model.
      const kp: Record<string, KeypointWithNoise> = {};
      for (const k of rawKps) kp[k.name] = k;

      // §1.2 stricter keypoint gate
      const required = [
        "left_shoulder", "right_shoulder", "left_hip", "right_hip",
        "left_ankle", "right_ankle", "nose",
      ];
      const gate = gateKeypoints(rawKps, { required, minScore: 0.30, pairMinScore: 0.50 });
      if (!gate.passed) {
        const reason =
          gate.missing.length > 0
            ? `Missing: ${gate.missing.slice(0, 3).join(", ")}`
            : `Weak: ${gate.weakPairs.slice(0, 2).join(", ")}`;
        setDetectBanner({
          text: `Body parts unclear (${reason}). Adjust the guides or re-shoot.`,
          type: "warn",
        });
        const cur = type === "front" ? front : side;
        const next: PhotoState = {
          ...cur, keypoints: rawKps, keypointAvg: averageScore,
          imageW: imgEl.naturalWidth, imageH: imgEl.naturalHeight,
          autoDetected: false,
        };
        if (type === "front") setFront(next); else setSide(next);
        finishDetectUI(false);
        return;
      }

      // §1.5 orientation validation
      const orient = validateOrientation(rawKps, type);
      if (!orient.matches) {
        setDetectBanner({
          text: `This doesn't look like a ${type} photo. ${orient.expected === "front"
            ? "Please face the camera and re-shoot."
            : orient.expected === "side"
              ? "Please turn 90° and re-shoot."
              : "Please re-shoot with the full body in view."
            }`,
          type: "warn",
        });
        const cur = type === "front" ? front : side;
        const next: PhotoState = {
          ...cur, keypoints: rawKps, keypointAvg: averageScore,
          imageW: imgEl.naturalWidth, imageH: imgEl.naturalHeight,
          autoDetected: false,
        };
        if (type === "front") setFront(next); else setSide(next);
        finishDetectUI(false);
        return;
      }

      // §1.6 acceptance check
      const accept = checkPhotoAcceptance(rawKps, imgEl.naturalWidth, imgEl.naturalHeight);
      if (!accept.code) {/* ok */ }
      else {
        setDetectBanner({ text: accept.reason ?? "Photo unsuitable", type: "warn" });
        setWarnings([accept.instruction ?? ""].filter(Boolean));
        const cur = type === "front" ? front : side;
        const next: PhotoState = {
          ...cur, keypoints: rawKps, keypointAvg: averageScore,
          imageW: imgEl.naturalWidth, imageH: imgEl.naturalHeight,
          autoDetected: false,
        };
        if (type === "front") setFront(next); else setSide(next);
        finishDetectUI(false);
        return;
      }

      // §5.3 image quality
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(imgEl, 0, 0);
      let iq: ImageQuality | null = null;
      try {
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        iq = imageQuality(id);
      } catch {/* ignore (CORS, etc.) */ }
      const iqWarnings = iq?.warnings ?? [];

      const nh = imgEl.naturalHeight, nw = imgEl.naturalWidth;
      const shoulderW = Math.hypot(
        (kp.right_shoulder.x - kp.left_shoulder.x),
        (kp.right_shoulder.y - kp.left_shoulder.y)
      );
      const hipW = Math.hypot(
        (kp.right_hip.x - kp.left_hip.x),
        (kp.right_hip.y - kp.left_hip.y)
      );
      const hipY = (kp.left_hip.y + kp.right_hip.y) / 2;
      const shoulderY = (kp.left_shoulder.y + kp.right_shoulder.y) / 2;
      const ankleY = (kp.left_ankle.y + kp.right_ankle.y) / 2;
      const noseY = kp.nose.y;
      const span = ankleY - noseY;
      const headTopY = noseY - span * 0.08;
      const feetY = ankleY + span * 0.04;
      // §3.1 body-shape-aware waistline
      const waistFrac = waistlineFraction(shoulderW, hipW);
      const wY = hipY - waistFrac * (hipY - shoulderY);
      // Width at the waist Y — interpolated as a baseline; silhouette refines it.
      const frac = (hipY - wY) / Math.max(1, hipY - shoulderY);
      const waistWpxBase = hipW + (shoulderW - hipW) * frac * 0.5;
      const hipCenterX = (kp.left_hip.x + kp.right_hip.x) / 2;

      // §3.2 silhouette-based width
      let silhouette: SilhouetteWidth | null = null;
      if (seg.ready && seg.segmenter) {
        try {
          const mask = await seg.segmenter.segment(imgEl);
          if (mask) {
            const y0 = (wY - 30) / nh;
            const y1 = (wY + 30) / nh;
            silhouette = silhouetteWidthAveraged(mask, y0 + (y1 - y0) / 2, (y1 - y0) / 2);
          }
        } catch {/* ignore */ }
      }

      const leftFrac = silhouette
        ? silhouette.leftFrac
        : (hipCenterX - waistWpxBase / 2) / nw;
      const rightFrac = silhouette
        ? silhouette.rightFrac
        : (hipCenterX + waistWpxBase / 2) / nw;

      const cur = type === "front" ? front : side;
      const next: PhotoState = {
        ...cur,
        keypoints: rawKps,
        keypointAvg: averageScore,
        imageW: nw, imageH: nh,
        imageQuality: iq,
        silhouette,
        topY: headTopY / nh,
        bottomY: feetY / nh,
        waistY: wY / nh,
        leftX: leftFrac,
        rightX: rightFrac,
        autoDetected: true,
        confidence: averageScore,
        userAdjustedWaist: false,
      };
      if (type === "front") setFront(next); else setSide(next);

      const qualityText = averageScore >= 80
        ? "photo quality is excellent"
        : averageScore >= 50
          ? "photo quality looks good"
          : "please review the guides";
      setDetectBanner({
        text: `Photo ready — ${qualityText}`,
        type: averageScore >= 50 ? "success" : "warn",
      });
      setWarnings(iqWarnings);
      finishDetectUI(true);
    } catch {
      const cur = type === "front" ? front : side;
      const next: PhotoState = {
        ...cur,
        imageW: imgEl.naturalWidth, imageH: imgEl.naturalHeight,
        autoDetected: false,
      };
      if (type === "front") setFront(next); else setSide(next);
      setDetectBanner({
        text: "We could not detect the full body clearly — position the waist guide manually",
        type: "warn",
      });
      finishDetectUI(false);
    }
  }

  function finishDetectUI(ok: boolean) {
    setShowInstructions(true);
    setShowConfirm(true);
    setTimeout(() => setDetectBanner(null), ok ? 3000 : 5000);
  }

  /* ─── Camera ─── */
  function stopStream(stream: MediaStream | null) {
    stream?.getTracks().forEach(track => track.stop());
  }
  function cameraErrorMessage(error: unknown): string {
    const name = typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera permission is blocked. Allow camera access in your browser settings, then try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera was found. Connect a camera or upload a photo from your gallery instead.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Your camera is being used by another app or browser tab. Close it and try again.";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "This camera mode is not available on your device. Try again to use another camera.";
    }
    return "We could not open the camera. Please try again or upload a photo from your gallery.";
  }

  async function startCamera(facing: CameraFacing = cameraFacing) {
    if (cameraStarting || (camActive && facing === cameraFacing)) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access requires a secure HTTPS connection. Open this page over HTTPS and try again.");
      return;
    }
    const requestId = ++cameraRequestRef.current;
    setCameraStarting(true);
    setCameraReady(false);
    setCameraError(null);
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (camActive) setCamActive(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (cameraRequestRef.current !== requestId) {
        stopStream(stream);
        return;
      }
      camStreamRef.current = stream;
      setCameraFacing(facing);
      setCameraStreamVersion(version => version + 1);
      setCamActive(true);
    } catch (error) {
      if (cameraRequestRef.current === requestId) {
        setCameraError(cameraErrorMessage(error));
        setCamActive(false);
      }
    } finally {
      if (cameraRequestRef.current === requestId) setCameraStarting(false);
    }
  }
  function stopCamera() {
    cameraRequestRef.current++;
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCamActive(false); setCameraStarting(false); setCameraReady(false);
  }
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !cameraReady || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera preview is still starting. Wait a moment, then take the photo.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setCameraError("We could not prepare the photo. Please try again."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) { loadImageFile(blob, activePhotoType); stopCamera(); }
      else setCameraError("We could not capture the photo. Please try again.");
    }, "image/jpeg", 0.92);
  }
  useEffect(() => {
    if (!camActive || !videoRef.current || !camStreamRef.current) return;
    const video = videoRef.current;
    const stream = camStreamRef.current;
    const onMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setCameraReady(true);
      void video.play().catch(() => {
        setCameraError("Camera preview could not start. Close it and try again.");
      });
    };
    video.addEventListener("loadedmetadata", onMetadata);
    video.srcObject = stream;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
    return () => {
      video.removeEventListener("loadedmetadata", onMetadata);
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [camActive, cameraStreamVersion]);
  useEffect(() => () => {
    cameraRequestRef.current++;
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
  }, []);

  /* ─── Overlay SVG dragging ─── */
  const handlePointerDown = useCallback((e: ReactPointerEvent, handle: string) => {
    e.preventDefault(); e.stopPropagation();
    draggingRef.current = handle;
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const currentPhoto: PhotoState = activePhotoType === "front" ? front : side;
  const currentPhotoSrc = currentPhoto.src;
  const leftX = currentPhoto.leftX;
  const rightX = currentPhoto.rightX;
  const waistY = currentPhoto.waistY;
  const topY = currentPhoto.topY;
  const bottomY = currentPhoto.bottomY;
  const autoDetected = currentPhoto.autoDetected;
  const currentConfidence = currentPhoto.confidence;
  const currentPhotoQuality = currentConfidence >= 70 ? "Clear" : currentConfidence >= 40 ? "Good" : "Review needed";

  function updateActive(updates: Partial<PhotoState>) {
    if (activePhotoType === "front") setFront(prev => ({ ...prev, ...updates }));
    else setSide(prev => ({ ...prev, ...updates }));
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const h = draggingRef.current;
    if (activePhotoType === "front") {
      if (h === "L") updateActive({ leftX: Math.min(fx, front.rightX - 0.02), userAdjustedWaist: true });
      if (h === "R") updateActive({ rightX: Math.max(fx, front.leftX + 0.02), userAdjustedWaist: true });
      if (h === "Y") updateActive({ waistY: fy, userAdjustedWaist: true });
      if (h === "T") updateActive({ topY: Math.min(fy, front.bottomY - 0.05) });
      if (h === "B") updateActive({ bottomY: Math.max(fy, front.topY + 0.05) });
    } else {
      if (h === "L") updateActive({ leftX: Math.min(fx, side.rightX - 0.02), userAdjustedWaist: true });
      if (h === "R") updateActive({ rightX: Math.max(fx, side.leftX + 0.02), userAdjustedWaist: true });
      if (h === "Y") updateActive({ waistY: fy, userAdjustedWaist: true });
      if (h === "T") updateActive({ topY: Math.min(fy, side.bottomY - 0.05) });
      if (h === "B") updateActive({ bottomY: Math.max(fy, side.topY + 0.05) });
    }
  }
  function handlePointerUp() { draggingRef.current = null; }

  /* ─── Card calibration handlers ─── */
  const [cardDragging, setCardDragging] = useState<string | null>(null);
  function handleCardPointerDown(e: ReactPointerEvent, edge: string) {
    e.preventDefault(); e.stopPropagation();
    setCardDragging(edge);
    setCardTouched(true);
  }
  function handleCardPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!cardDragging || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setCardRect(prev => {
      if (cardDragging === "move") {
        return { ...prev, x: fx - prev.w / 2, y: fy - prev.h / 2 };
      }
      if (cardDragging === "resize") {
        const newW = Math.max(0.05, fx - prev.x);
        const newH = newW * CARD_ASPECT;
        return { ...prev, w: newW, h: newH };
      }
      return prev;
    });
  }
  function handleCardPointerUp() { setCardDragging(null); }

  /* ─── Confirm waist ─── */
  function buildCalibration(): { front: CalibrationEstimate; side: CalibrationEstimate } {
    const heightCm = parseFloat(heightVal) || 0;
    const refsF: CalibrationInput[] = [];
    if (calibrationMethod === "card" && cardTouched && front.imageW > 0) {
      const cardPixelWidth = cardRect.w * front.imageW;
      refsF.push({ method: "card", pxLength: cardPixelWidth, cmLength: CARD_WIDTH_CM });
    }
    if (heightCm > 0 && front.imageH > 0) {
      const pxHeight = (front.bottomY - front.topY) * front.imageH;
      if (pxHeight > 0) refsF.push({ method: "height", pxLength: pxHeight, cmLength: heightCm * 0.93 });
    }
    const frontCal = calibrate(refsF);

    const refsS: CalibrationInput[] = [];
    if (heightCm > 0 && side.imageH > 0) {
      const pxHeight = (side.bottomY - side.topY) * side.imageH;
      if (pxHeight > 0) refsS.push({ method: "height", pxLength: pxHeight, cmLength: heightCm * 0.93 });
    }
    if (refsS.length === 0 && frontCal.scaleCmPerPx > 0) {
      // Fallback to front-photo scale.
      refsS.push({ method: "height", pxLength: 1, cmLength: frontCal.scaleCmPerPx });
    }
    const sideCal = calibrate(refsS);

    return { front: frontCal, side: sideCal };
  }

  function buildDetection(state: PhotoState, isFront: boolean): DetectionResult | null {
    if (!state.src) return null;
    return {
      keypoints: state.keypoints,
      imageW: state.imageW,
      imageH: state.imageH,
      waistYFrac: state.waistY,
      leftFrac: state.leftX,
      rightFrac: state.rightX,
      topFrac: state.topY,
      bottomFrac: state.bottomY,
      keypointAvg: state.keypointAvg,
      silhouetteLeftFrac: state.silhouette?.leftFrac,
      silhouetteRightFrac: state.silhouette?.rightFrac,
      imageQuality: state.imageQuality ?? undefined,
      userAdjustedWaist: state.userAdjustedWaist,
    };
  }

  function confirmWaist() {
    const heightCm = parseFloat(heightVal) || 0;
    if (!gender || heightCm <= 0) {
      alert("Please complete Step 1 first.");
      return;
    }

    // §7.1 manual override takes precedence
    const manualCm = parseFloat(manualWaistCm);
    const userWaistOverride = Number.isFinite(manualCm) && manualCm > 0 ? manualCm : undefined;

    const { front: frontCal, side: sideCal } = buildCalibration();
    const frontDetection = buildDetection(front, true);
    const sideDetection = side.src ? buildDetection(side, false) : null;

    // Sanity: if a card calibration was chosen but no card rect, fall back
    if (calibrationMethod === "card" && frontCal.scaleCmPerPx === 0) {
      alert("Please position the card in the front photo to calibrate scale.");
      return;
    }

    const m = computeMeasurements({
      gender,
      heightCm,
      userWaistOverride,
      front: frontDetection,
      side: sideDetection,
      frontCal,
      sideCal,
    });
    if (!m) {
      alert(
        front.src
          ? "Could not compute a measurement. Please check your height in Step 1, or fill in \"Already know your waist?\" to skip the photo measurement."
          : "Could not compute a measurement. Please add a front photo, or fill in \"Already know your waist?\" in Step 1."
      );
      return;
    }
    // §3.7 plausibility check
    if (!m.plausibility.ok) {
      setDetectBanner({
        text: `Waist is ${m.waistCm.toFixed(1)} cm — ${m.plausibility.reason}. Please re-shoot if this looks wrong.`,
        type: "warn",
      });
    }
    setMeasurements(m);
    setStep3Locked(false);
    setCurrentStep(3);
  }

  /* Recompute recommendations whenever measurements / fit / region / brand change. */
  const lastHistorySigRef = useRef<string>("");
  useEffect(() => {
    if (!measurements || !gender) { setRecommendations(null); return; }
    const heightCm = parseFloat(heightVal) || 0;
    const recs = recommendSizes(
      measurements, baselineSize, heightCm, gender, fit, region,
      brandMap, brand || null
    );
    setRecommendations(recs);
    if (recs && measurements) {
      const size = (recs as unknown as Record<GarmentClass, SizeStr>)[garment];
      // Save history only when the result actually changed — otherwise every
      // garment-tab click or height keystroke would flood the log.
      const sig = `${size}|${measurements.waistCm.toFixed(1)}|${recs.source}`;
      if (sig !== lastHistorySigRef.current) {
        lastHistorySigRef.current = sig;
        saveHistory({
          ts: Date.now(),
          size,
          waistCm: measurements.waistCm,
          source: recs.source,
        });
      }
    }
  }, [measurements, gender, heightVal, fit, region, brand, garment, brandMap, baselineSize]);

  /* Emit an integration-friendly result after the recommendation state settles. */
  useEffect(() => {
    if (!measurements || !recommendations) return;
    onResultRef.current?.({
      name: brand || null,
      gender: gender || null,
      measurements,
      recommendations,
      selectedGarment: garment,
      selectedSize: recommendations[garment],
      fit,
      region,
      brand: brand || null,
      
    });
  }, [measurements, recommendations, garment]);

  /* ─── Retake ─── */
  function retake(type: PhotoType) {
    if (type === "front") setFront(initialPhotoState());
    else setSide(initialPhotoState());
    detectedSrcRef.current[type] = null;
    if (type === "front") setCardTouched(false);
    setShowConfirm(false); setShowInstructions(false); setDetectBanner(null);
    setWarnings([]); resetZoom();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /* ─── Photo status flags ─── */
  const finalSize: SizeStr | null = (() => {
    if (!recommendations) return baselineSize;
    return (recommendations as unknown as Record<GarmentClass, SizeStr>)[garment];
  })();
  let flagType: "ok" | "warn" | null = null;
  let flagText = "";
  if (recommendations && baselineSize) {
    const photoIdx = ORDER.indexOf((recommendations as unknown as Record<GarmentClass, SizeStr>)[garment]);
    const bmiIdx = ORDER.indexOf(baselineSize);
    const conf = agreementConfidence(photoIdx, bmiIdx);
    if (conf >= 75) {
      flagType = "ok";
      flagText = "Your details and photo estimate are closely aligned.";
    } else if (conf >= 50) {
      flagType = "ok";
      flagText = "Your details and photo estimate are within one size — confidence is reasonable.";
    } else {
      flagType = "warn";
      flagText = "Your details and photo estimate do not match closely. For a better result, retake the photo while standing straight.";
    }
  }

  function getPhotoSetupQuality(): "high" | "medium" | "low" {
    if (measurements && measurements.confidence.overall >= 75) return "high";
    if (measurements && measurements.confidence.overall >= 50) return "medium";
    return "low";
  }

  /* Size chart */
  const heightCm = parseFloat(heightVal) || 0;
  const chartRows: SizeRow[] = (() => {
    if (!gender) return [];
    const table = sizeTable(gender, garment, fit, region);
    return table.rows;
  })();

  const [imgDim, setImgDim] = useState({ w: 0, h: 0 });
  /* Tracks which photo src has already been auto-detected, so switching
     between the front/side tabs doesn't re-run detection and wipe out
     the user's manual guide adjustments. */
  const detectedSrcRef = useRef<Record<PhotoType, string | null>>({ front: null, side: null });
  function onImgLoad() {
    const el = imgRef.current;
    if (el) {
      setImgDim({ w: el.clientWidth, h: el.clientHeight });
      // Record natural pixel dims immediately, before detection runs, so
      // height-based calibration keeps working even if detection fails
      // and the user positions the guides manually.
      const cur = activePhotoType === "front" ? front : side;
      if (el.naturalWidth > 0 && (cur.imageW !== el.naturalWidth || cur.imageH !== el.naturalHeight)) {
        updateActive({ imageW: el.naturalWidth, imageH: el.naturalHeight });
      }
      // Only auto-detect a photo we haven't processed yet.
      if (cur.src && detectedSrcRef.current[activePhotoType] !== cur.src) {
        detectedSrcRef.current[activePhotoType] = cur.src;
        runDetection(activePhotoType);
      }
    }
  }
  useEffect(() => {
    if (!currentPhotoSrc) return;
    const obs = new ResizeObserver(() => {
      const el = imgRef.current;
      if (el) setImgDim({ w: el.clientWidth, h: el.clientHeight });
    });
    if (imgRef.current) obs.observe(imgRef.current);
    return () => obs.disconnect();
  }, [currentPhotoSrc]);

  const sw = imgDim.w, sh = imgDim.h;
  const y = waistY * sh, x1 = leftX * sw, x2 = rightX * sw;
  const ty = topY * sh, by = bottomY * sh;

  /* ─────────────────────────────────────────────
     Render
  ───────────────────────────────────────────── */
  return (
    <div className={rootClassName} style={style}>
      <div className="st-modal-overlay">
        <div className="st-modal" role="dialog" aria-modal="true" aria-label="Smart Size Finder">
          <div className="st-modal-top">
            <div className="st-modal-title-row">
              <div>
                <p className="st-modal-eyebrow">Smart Size Finder</p>
                <h1 className="st-modal-title">
                  {currentStep === 1 ? "Tell us about you" : currentStep === 2 ? "Add your photos" : "Your size result"}
                </h1>
              </div>
              <button type="button" className="st-modal-close" aria-label="Close">×</button>
            </div>

            <div className="st-progress" aria-label="Progress">
              <div className={`st-progress-step ${currentStep === 1 ? "active" : "done"}`}>
                <span className="st-progress-dot">{currentStep > 1 ? "✓" : "1"}</span>
                <span>Information</span>
              </div>
              <div className={`st-progress-step ${currentStep === 2 ? "active" : currentStep > 2 ? "done" : ""}`}>
                <span className="st-progress-dot">{currentStep > 2 ? "✓" : "2"}</span>
                <span>Photos</span>
              </div>
              <div className={`st-progress-step ${currentStep === 3 ? "active" : ""}`}>
                <span className="st-progress-dot">3</span>
                <span>Result</span>
              </div>
            </div>
          </div>

          <div className="st-modal-body">
            {currentStep === 1 && (
              <div id="st-step1" className="st-step">
                <div>
                  <label className="st-label">Name</label>
                  <input
                    className="st-input"
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <label className="st-label">Gender</label>
                <div className="st-gtoggle">
                  {(["female", "male"] as Gender[]).map(g => (
                    <button key={g} className={`st-gbtn ${gender === g ? "active" : ""}`} onClick={() => setGender(g)}>
                      {g === "female" ? "Female" : "Male"}
                    </button>
                  ))}
                </div>
                <div className="st-row">
                  <div>
                    <label className="st-label">Height (cm)</label>
                    <input className="st-input" type="number" placeholder="e.g. 165" min={120} max={220} value={heightVal} onChange={e => setHeightVal(e.target.value)} />
                  </div>
                  <div>
                    <label className="st-label">Weight (kg)</label>
                    <input className="st-input" type="number" placeholder="e.g. 60" min={30} max={180} value={weightVal} onChange={e => setWeightVal(e.target.value)} />
                  </div>
                </div>

                {/* Photo scale method */}
                <label className="st-label" style={{ marginTop: 16 }}>How should we scale your photo?</label>
                <div className="st-gtoggle">
                  <button
                    type="button"
                    className={`st-gbtn ${calibrationMethod === "height" ? "active" : ""}`}
                    onClick={() => setCalibrationMethod("height")}
                  >
                    Use my height · Easiest
                  </button>
                  <button
                    type="button"
                    className={`st-gbtn ${calibrationMethod === "card" ? "active" : ""}`}
                    onClick={() => setCalibrationMethod("card")}
                  >
                    Use a standard card
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "#8a8f9c", margin: "8px 0 0", lineHeight: 1.5 }}>
                  {calibrationMethod === "card"
                    ? "Hold a standard bank card flat and clearly visible in your front photo. The card details do not need to be readable."
                    : "Recommended: make sure your full body is visible from head to toe."}
                </p>

                {/* NEW: Fit, region, brand, garment */}
                <div className="st-row-3" style={{ marginTop: 16 }}>
                  <div>
                    <label className="st-label">Fit preference</label>
                    <select className="st-select" value={fit} onChange={e => setFit(e.target.value as Fit)}>
                      <option value="slim">Slim</option>
                      <option value="regular">Regular</option>
                      <option value="relaxed">Relaxed</option>
                    </select>
                  </div>
                  <div>
                    <label className="st-label">Region</label>
                    <select className="st-select" value={region} onChange={e => setRegion(e.target.value as Region)}>
                      <option value="US">US</option>
                      <option value="UK">UK</option>
                      <option value="EU">EU</option>
                      <option value="IN">India</option>
                      <option value="JP">Japan</option>
                      <option value="CN">China</option>
                      <option value="AU">Australia</option>
                    </select>
                  </div>
                  <div>
                    <label className="st-label">Brand (optional)</label>
                    <input className="st-input" type="text" placeholder="e.g. Zara" value={brand} onChange={e => setBrand(e.target.value)} />
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "#8a8f9c", margin: "0 0 8px", lineHeight: 1.5 }}>
                  Region and fit refine the recommended size. Brand is used when your app provides a matching brand chart.
                </p>

                {/* NEW: manual waist override */}
                <label className="st-label" style={{ marginTop: 8 }}>Already know your waist? (optional)</label>
                <input className="st-input" type="number" placeholder="e.g. 78" min={40} max={180}
                  value={manualWaistCm} onChange={e => setManualWaistCm(e.target.value)} />
                <p style={{ fontSize: 12, color: "#8a8f9c", margin: "6px 0 0", lineHeight: 1.5 }}>
                  If you fill this in, it will be used instead of the photo measurement.
                </p>

                {/* Pose model picker — wired to the worker; switching reloads the model */}
                <label className="st-label" style={{ marginTop: 14 }}>Pose detection model</label>
                <div className="st-gtoggle">
                  <button
                    type="button"
                    className={`st-gbtn ${poseModel === "movenet-thunder" ? "active" : ""}`}
                    onClick={() => setPoseModel("movenet-thunder")}
                  >
                    MoveNet Thunder · accurate
                  </button>
                  <button
                    type="button"
                    className={`st-gbtn ${poseModel === "movenet-lightning" ? "active" : ""}`}
                    onClick={() => setPoseModel("movenet-lightning")}
                  >
                    MoveNet Lightning · faster
                  </button>
                </div>

                <div className="st-step-actions">
                  <span style={{ fontSize: 11.5, color: "#8a8f9c" }}>Step 1 of 3</span>
                  <button type="button" className="st-btn" onClick={calcBaseline}>
                    Continue <span aria-hidden="true">→</span>
                  </button>
                </div>
                {baselineSize && bmi && (
                  <div className="st-saved" role="status">
                    <span className="st-saved-mark" aria-hidden="true">✓</span>
                    <span>Details saved. Add a front photo to complete your size check.</span>
                  </div>
                )}
              </div>


            )}

            {currentStep === 2 && (
              <div className="st-step">
                <div className="st-step-head">
                  <div className="st-num">2</div>
                  <h2>Add front and side photos</h2>
                  <span className="st-hint">Front required · Side recommended</span>
                </div>

                <div className="st-tabs">
                  <button
                    className={`st-tab ${activePhotoType === "front" ? "active" : ""}`}
                    onClick={() => setActivePhotoType("front")}
                  >
                    <span className="icon" aria-hidden="true">①</span>
                    Front view {front.src && "✓"}
                  </button>
                  <button
                    className={`st-tab ${activePhotoType === "side" ? "active" : ""}`}
                    onClick={() => setActivePhotoType("side")}
                  >
                    <span className="icon" aria-hidden="true">②</span>
                    Side view {side.src && "✓"} <span style={{ fontSize: 10, opacity: 0.72 }}>(recommended)</span>
                  </button>
                </div>

                <div className="st-photo-guide">
                  <div className="st-guide-head">
                    <div>
                      <h3>Before taking your photo</h3>
                      <p>Check these three things for the best result.</p>
                    </div>
                    <span className="st-guide-time">Quick check</span>
                  </div>
                  <div className="st-guide-grid">
                    <div className="st-guide-item">
                      <span className="st-guide-check" aria-hidden="true">✓</span>
                      <div><strong>Full body</strong><small>Keep your whole body in frame</small></div>
                    </div>
                    <div className="st-guide-item">
                      <span className="st-guide-check" aria-hidden="true">✓</span>
                      <div><strong>Stand straight</strong><small>Wear fitted clothing, arms relaxed</small></div>
                    </div>
                    <div className="st-guide-item">
                      <span className="st-guide-check" aria-hidden="true">✓</span>
                      <div><strong>Camera at waist level</strong><small>Keep the camera level, not tilted</small></div>
                    </div>
                  </div>
                  <p className="st-active-tip">
                    <strong>{activePhotoType === "front" ? "Front photo:" : "Side photo:"}</strong>{" "}
                    {activePhotoType === "front"
                      ? "face the camera and stand straight. Breathe out gently before capture."
                      : "turn 90° and stand in a true side profile."}
                    {calibrationMethod === "card" && activePhotoType === "front"
                      ? " Hold a standard bank card flat near your waist."
                      : ""}
                  </p>
                </div>

                {(front.src || side.src) && (
                  <div className="st-photo-preview">
                    {front.src && (
                      <div className={`st-photo-thumb ${activePhotoType === "front" ? "active" : ""}`} onClick={() => setActivePhotoType("front")}>
                        <img src={front.src} alt="Front" />
                        <span className="label">Front view · Ready</span>
                        <button className="remove" onClick={(e) => { e.stopPropagation(); retake("front"); }}>×</button>
                      </div>
                    )}
                    {side.src && (
                      <div className={`st-photo-thumb ${activePhotoType === "side" ? "active" : ""}`} onClick={() => setActivePhotoType("side")}>
                        <img src={side.src} alt="Side" />
                        <span className="label">Side view · Ready</span>
                        <button className="remove" onClick={(e) => { e.stopPropagation(); retake("side"); }}>×</button>
                      </div>
                    )}
                  </div>
                )}

                {!currentPhotoSrc && !camActive && (
                  <>
                    <div className="st-upload-choices" style={{ marginTop: 16 }}>
                      <div
                        className="st-upload-zone"
                        role="button"
                        tabIndex={cameraStarting ? -1 : 0}
                        aria-disabled={cameraStarting}
                        onClick={() => {
                          if (cameraStarting) return;
                          setCameraError(null);
                          fileInputRef.current?.click();
                        }}
                        onKeyDown={e => {
                          if (cameraStarting || (e.key !== "Enter" && e.key !== " ")) return;
                          e.preventDefault();
                          setCameraError(null);
                          fileInputRef.current?.click();
                        }}
                      >
                        <div className="st-upload-icon" aria-hidden="true">↑</div>
                        <strong>Upload from gallery</strong>
                        <span>{activePhotoType === "front" ? "Select a front-view photo" : "Select a side-view photo"}</span>
                      </div>
                      <div
                        className="st-upload-zone"
                        role="button"
                        tabIndex={cameraStarting ? -1 : 0}
                        aria-disabled={cameraStarting}
                        onClick={() => { void startCamera(); }}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void startCamera();
                          }
                        }}
                      >
                        <div className="st-upload-icon" aria-hidden="true">◎</div>
                        <strong>{cameraStarting ? "Opening camera…" : "Take a photo"}</strong>
                        <span>{cameraStarting ? "Allow camera access if your browser asks" : "Use your camera now"}</span>
                      </div>
                    </div>
                    <div className="st-privacy-strip">
                      <span className="st-pill-icon" aria-hidden="true">✓</span>
                      <span><strong>Your photo is private</strong>It is processed on this device and is never uploaded or stored.</span>
                    </div>
                    {cameraStarting && (
                      <div className="st-camera-status" role="status">
                        <div className="st-spinner" aria-hidden="true" />
                        <span>Opening your camera. Allow access in your browser if prompted.</span>
                      </div>
                    )}
                    {cameraError && (
                      <div className="st-camera-status error" role="alert">
                        <span aria-hidden="true">⚠️</span>
                        <span>{cameraError}</span>
                      </div>
                    )}
                  </>
                )}

                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCameraError(null);
                      loadImageFile(file, activePhotoType);
                    }
                  }} />

                {camActive && (
                  <>
                    <video
                      ref={videoRef}
                      className="st-video"
                      autoPlay
                      muted
                      playsInline
                      onLoadedMetadata={() => {
                        const video = videoRef.current;
                        if (video && video.videoWidth > 0 && video.videoHeight > 0) setCameraReady(true);
                      }}
                    />
                    <div className="st-camera-switch" role="group" aria-label="Choose which camera to use">
                      <span className="st-camera-switch-label">Camera</span>
                      <button
                        type="button"
                        className={`st-camera-switch-btn ${cameraFacing === "user" ? "active" : ""}`}
                        aria-pressed={cameraFacing === "user"}
                        disabled={cameraStarting || cameraFacing === "user"}
                        onClick={() => { void startCamera("user"); }}
                      >
                        Front camera
                      </button>
                      <button
                        type="button"
                        className={`st-camera-switch-btn ${cameraFacing === "environment" ? "active" : ""}`}
                        aria-pressed={cameraFacing === "environment"}
                        disabled={cameraStarting || cameraFacing === "environment"}
                        onClick={() => { void startCamera("environment"); }}
                      >
                        Rear camera
                      </button>
                    </div>
                    {!cameraReady && (
                      <div className="st-camera-status" role="status">
                        <div className="st-spinner" aria-hidden="true" />
                        <span>Starting camera preview…</span>
                      </div>
                    )}
                    {cameraError && (
                      <div className="st-camera-status error" role="alert">
                        <span aria-hidden="true">⚠️</span>
                        <span>{cameraError}</span>
                      </div>
                    )}
                    <div className="st-cam-controls">
                      <button className="st-btn" onClick={capturePhoto} disabled={!cameraReady}>
                        Take {activePhotoType === "front" ? "front" : "side"} photo
                      </button>
                      <button className="st-btn secondary" onClick={stopCamera}>Cancel</button>
                    </div>
                  </>
                )}

                {currentPhotoSrc && (
                  <>
                    <div className="st-photo-stage" onWheel={handleWheel}>
                      <div
                        className="st-zoom-wrap"
                        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
                      >
                        <img ref={imgRef} src={currentPhotoSrc} onLoad={onImgLoad} alt="pose" />
                        {sw > 0 && sh > 0 && (
                          <svg
                            viewBox={`0 0 ${sw} ${sh}`}
                            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                            onPointerMove={(e) => { handlePointerMove(e); handleCardPointerMove(e); }}
                            onPointerUp={() => { handlePointerUp(); handleCardPointerUp(); }}
                          >
                            <line x1={0} y1={ty} x2={sw} y2={ty} stroke="#1B2A4A" strokeWidth={2} strokeDasharray="6,4" />
                            <circle
                              className="st-handle" cx={sw / 2} cy={ty} r={10}
                              fill="#1B2A4A" stroke="#fff" strokeWidth={2}
                              onPointerDown={e => handlePointerDown(e, "T")}
                            />
                            <text x={sw / 2 + 16} y={ty + 4} fontSize={10} fill="#1B2A4A" fontFamily="IBM Plex Mono">head</text>

                            <line x1={0} y1={by} x2={sw} y2={by} stroke="#1B2A4A" strokeWidth={2} strokeDasharray="6,4" />
                            <circle
                              className="st-handle" cx={sw / 2} cy={by} r={10}
                              fill="#1B2A4A" stroke="#fff" strokeWidth={2}
                              onPointerDown={e => handlePointerDown(e, "B")}
                            />
                            <text x={sw / 2 + 16} y={by + 4} fontSize={10} fill="#1B2A4A" fontFamily="IBM Plex Mono">feet</text>

                            <line x1={x1} y1={y} x2={x2} y2={y} stroke={activePhotoType === "front" ? "#B08D57" : "#3B82F6"} strokeWidth={3} />
                            <circle
                              className="st-handle" cx={x1} cy={y} r={11}
                              fill="#C1443C" stroke="#fff" strokeWidth={2}
                              onPointerDown={e => handlePointerDown(e, "L")}
                            />
                            <circle
                              className="st-handle" cx={x2} cy={y} r={11}
                              fill="#C1443C" stroke="#fff" strokeWidth={2}
                              onPointerDown={e => handlePointerDown(e, "R")}
                            />
                            <rect
                              className="st-handle" x={sw / 2 - 36} y={y - 9} width={72} height={18} rx={9}
                              fill={activePhotoType === "front" ? "#1B2A4A" : "#3B82F6"} opacity={0.85}
                              onPointerDown={e => handlePointerDown(e, "Y")}
                            />
                            <text x={sw / 2} y={y + 4} fontSize={9} fill="#fff" textAnchor="middle" fontFamily="IBM Plex Mono" pointerEvents="none">
                              {autoDetected ? "waist" : "set waist"}
                            </text>

                            {calibrationMethod === "card" && activePhotoType === "front" && (
                              <>
                                <rect
                                  x={cardRect.x * sw}
                                  y={cardRect.y * sh}
                                  width={cardRect.w * sw}
                                  height={cardRect.h * sh}
                                  fill="rgba(59,130,246,0.2)"
                                  stroke="#3B82F6"
                                  strokeWidth={2}
                                  strokeDasharray="4,2"
                                  className="st-handle"
                                  onPointerDown={e => handleCardPointerDown(e, "move")}
                                />
                                <circle
                                  cx={(cardRect.x + cardRect.w) * sw}
                                  cy={(cardRect.y + cardRect.h) * sh}
                                  r={8}
                                  fill="#3B82F6"
                                  stroke="#fff"
                                  strokeWidth={2}
                                  className="st-handle"
                                  onPointerDown={e => handleCardPointerDown(e, "resize")}
                                />
                                <text
                                  x={cardRect.x * sw + 4}
                                  y={cardRect.y * sh + 14}
                                  fontSize={10}
                                  fill="#3B82F6"
                                  fontFamily="IBM Plex Mono"
                                >
                                  standard card
                                </text>
                              </>
                            )}
                          </svg>
                        )}
                      </div>
                    </div>

                    {currentConfidence > 0 && (
                      <div className="st-confidence">
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Photo scan quality</span>
                        <div className="st-confidence-bar" aria-hidden="true">
                          <div
                            className="st-confidence-fill"
                            style={{
                              width: `${currentConfidence}%`,
                              background: currentConfidence >= 70
                                ? "var(--sage)"
                                : currentConfidence >= 40
                                  ? "var(--brass)"
                                  : "var(--stitch)"
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {currentPhotoQuality}
                        </span>
                      </div>
                    )}

                    <div className="st-zoom-controls">
                      <span className="st-zlabel">Zoom</span>
                      <div className="st-zgroup">
                        <button className="st-zctrl" onClick={zoomOut} title="Zoom out">−</button>
                        <button className="st-zctrl" onClick={zoomIn} title="Zoom in">+</button>
                      </div>
                      <span className="st-zlabel">Move</span>
                      <div className="st-zgroup">
                        <button className="st-zctrl" onClick={() => setPanX(p => p - PAN_STEP)}>←</button>
                        <button className="st-zctrl" onClick={() => setPanY(p => p - PAN_STEP)}>↑</button>
                        <button className="st-zctrl" onClick={() => setPanY(p => p + PAN_STEP)}>↓</button>
                        <button className="st-zctrl" onClick={() => setPanX(p => p + PAN_STEP)}>→</button>
                      </div>
                      <button className="st-zctrl st-reset-z" onClick={resetZoom}>Reset</button>
                    </div>
                  </>
                )}

                {detectBanner && (
                  <div className={`st-detect-banner ${detectBanner.type}`}>
                    {detectBanner.type === "loading" && <div className="st-spinner" />}
                    {detectBanner.type === "success" && <span>✅</span>}
                    {detectBanner.type === "warn" && <span>⚠️</span>}
                    <span>{detectBanner.text}</span>
                  </div>
                )}

                {warnings.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {warnings.map((w, i) => (
                      <div key={i} className="st-detect-banner warn" style={{ marginTop: 6 }}>
                        <span>💡</span>
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {showInstructions && (
                  <p className="st-instructions">
                    {activePhotoType === "front"
                      ? <>Position the highlighted guide across both edges of your waist. Drag the round handles if needed.</>
                      : <>Position the highlighted guide across the front and back edges of your waist in the side profile.</>
                    }
                    {calibrationMethod === "card" && activePhotoType === "front" && (
                      <> Fit the blue box precisely over the standard card.</>
                    )}
                  </p>
                )}

                <div className="st-step-actions">
                  <button type="button" className="st-back-btn" onClick={() => setCurrentStep(1)}>← Back</button>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {front.src && !side.src && (
                      <button
                        className="st-btn blue"
                        onClick={() => { setActivePhotoType("side"); }}
                      >
                        Add a side photo →
                      </button>
                    )}
                    {showConfirm && front.src && (
                      <button className="st-btn" onClick={confirmWaist}>
                        {side.src ? "See my size →" : "Continue with front photo →"}
                      </button>
                    )}
                    {currentPhotoSrc && (
                      <button className="st-btn ghost" onClick={() => retake(activePhotoType)}>
                        Change {activePhotoType === "front" ? "front" : "side"} photo
                      </button>
                    )}
                  </div>
                </div>
              </div>


            )}

            {currentStep === 3 && (
              <div id="st-step3" className="st-step">
                <div className="st-step-head">
                  <div className="st-num">3</div>
                  <h2>Your size & predictions</h2>
                  <span className="st-hint">Step 3 of 3</span>
                </div>

                <button type="button" className="st-back-btn" style={{ marginBottom: 8 }} onClick={() => setCurrentStep(2)}>
                  ← Back to photos
                </button>

                {/* Garment picker */}
                {recommendations && (
                  <div className="st-garment-picker" role="tablist" aria-label="Garment class">
                    {(["bottom", "top", "outerwear", "dress"] as GarmentClass[]).map((g) => (
                      <button
                        key={g}
                        role="tab"
                        aria-selected={garment === g}
                        className={`st-garment-btn ${garment === g ? "active" : ""}`}
                        onClick={() => setGarment(g)}
                      >
                        {g[0].toUpperCase() + g.slice(1)}
                      </button>
                    ))}
                  </div>
                )}

                {finalSize && (
                  <>
                    <div className="st-result-hero">
                      <p className="st-eyebrow">Your recommended size</p>
                      <div className="st-size-big">{finalSize}</div>
                      <div style={{ fontSize: "12.5px", opacity: 0.78, marginBottom: 12 }}>
                        {measurements
                          ? (measurements.method === "ellipse"
                            ? "Based on your front + side photos (ellipse)"
                            : "Based on your front photo + body shape estimate")
                          : "Based on your basic details"}
                      </div>
                      {measurements ? (
                        <span className={`st-accuracy-badge ${getPhotoSetupQuality()}`}>
                          {getPhotoSetupQuality() === "high" && "Photo setup · Excellent"}
                          {getPhotoSetupQuality() === "medium" && "Photo setup · Good"}
                          {getPhotoSetupQuality() === "low" && "Photo setup · Basic"}
                        </span>
                      ) : (
                        <span className="st-accuracy-badge medium">Details-based estimate</span>
                      )}
                    </div>

                    <div className="st-result-grid" style={{ marginTop: 18 }}>
                      <div className="st-result-card">
                        <label className="st-label">Details-based estimate</label>
                        <div className="val">{baselineSize}</div>
                      </div>
                      <div className="st-result-card">
                        <label className="st-label">Photo-based estimate</label>
                        <div className="val">{finalSize}</div>
                      </div>
                      {measurements && (
                        <>
                          <div className="st-result-card">
                            <label className="st-label">Estimated waist</label>
                            <div className="val with-unc">
                              {measurements.waistCm.toFixed(1)} cm
                              {measurements.waistUncertaintyCm > 0 && (
                                <span className="unc"> ±{measurements.waistUncertaintyCm.toFixed(1)}</span>
                              )}
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Body type</label>
                            <div className="val" style={{ fontSize: 16, textTransform: "capitalize" }}>
                              {measurements.somatotype}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Confidence sub-scores (NEW §5.1) */}
                    {measurements && (
                      <div className="st-sub-scores">
                        <div className="st-sub-score">
                          <span className="lbl">Pose</span>
                          <div className="bar"><div className="fill" style={{ width: `${measurements.confidence.pose}%`, background: "var(--sage)" }} /></div>
                          <span className="num">{Math.round(measurements.confidence.pose)}</span>
                        </div>
                        <div className="st-sub-score">
                          <span className="lbl">Scale</span>
                          <div className="bar"><div className="fill" style={{ width: `${measurements.confidence.scale}%`, background: "var(--blue)" }} /></div>
                          <span className="num">{Math.round(measurements.confidence.scale)}</span>
                        </div>
                        <div className="st-sub-score">
                          <span className="lbl">Image</span>
                          <div className="bar"><div className="fill" style={{ width: `${measurements.confidence.image}%`, background: "var(--brass)" }} /></div>
                          <span className="num">{Math.round(measurements.confidence.image)}</span>
                        </div>
                        <div className="st-sub-score">
                          <span className="lbl">Plausibility</span>
                          <div className="bar"><div className="fill" style={{ width: `${measurements.confidence.plausibility}%`, background: "var(--ink)" }} /></div>
                          <span className="num">{Math.round(measurements.confidence.plausibility)}</span>
                        </div>
                      </div>
                    )}

                    {/* Detailed measurements (NEW §4.3) */}
                    {measurements && (
                      <details className="st-measure-details">
                        <summary>View full body measurements</summary>
                        <div className="st-result-grid" style={{ margin: 0, padding: "0 14px 14px" }}>
                          <div className="st-result-card">
                            <label className="st-label">Waist</label>
                            <div className="val with-unc">
                              {measurements.waistCm.toFixed(1)} cm
                              <span className="unc"> ±{measurements.waistUncertaintyCm.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Chest</label>
                            <div className="val with-unc">
                              {measurements.chestCm.toFixed(1)} cm
                              <span className="unc"> ±{measurements.chestUncertaintyCm.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Hip</label>
                            <div className="val with-unc">
                              {measurements.hipCm.toFixed(1)} cm
                              <span className="unc"> ±{measurements.hipUncertaintyCm.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Inseam</label>
                            <div className="val with-unc">
                              {measurements.inseamCm.toFixed(1)} cm
                              <span className="unc"> ±{measurements.inseamUncertaintyCm.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Shoulder width</label>
                            <div className="val with-unc">
                              {measurements.shoulderW.toFixed(1)} cm
                              <span className="unc"> ±{measurements.shoulderUncertaintyCm.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="st-result-card">
                            <label className="st-label">Method</label>
                            <div className="val" style={{ fontSize: 14 }}>
                              {measurements.method === "ellipse" ? "Front + side (ellipse)" : "Front only (shape)"}
                            </div>
                          </div>
                        </div>
                      </details>
                    )}

                    {flagType && (
                      <div className={`st-flag ${flagType}`}>{flagText}</div>
                    )}

                    <div className="st-result-note">
                      <strong>Fit note:</strong> This is a photo-based estimate. Fit may vary by brand, fabric, and style, so check the brand's size chart before ordering.
                    </div>

                    {/* History (NEW §7.4) */}
                    {history.length > 0 && (
                      <details className="st-history">
                        <summary>Recent measurements ({history.length})</summary>
                        {history.map((h) => (
                          <div key={h.ts} className="item">
                            <span>{new Date(h.ts).toLocaleString()}</span>
                            <span>{h.size} · {h.waistCm.toFixed(1)} cm · {h.source}</span>
                          </div>
                        ))}
                      </details>
                    )}

                    {/* Size chart */}
                    {heightCm > 0 && chartRows.length > 0 && (
                      <table className="st-sizechart">
                        <thead>
                          <tr>
                            <th>Size</th>
                            <th>
                              {garment === "bottom"
                                ? "Waist"
                                : garment === "dress"
                                  ? "Chest / Bust"
                                  : "Chest"}{" "}
                              range for your height (cm)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {chartRows.map((row) => {
                            const [lo, hi] = waistRangeForSize(
                              { rows: chartRows, pick: () => row.size },
                              row.size, heightCm
                            );
                            const label = lo === 0 ? `up to ${hi}` : `${lo}–${hi}`;
                            return (
                              <tr key={row.size} className={`st-size-row ${row.size === finalSize ? "hit" : ""}`}>
                                <td>{row.size}</td><td>{label}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>

            )}
          </div>

          <div className="st-modal-footer">
            🔒 Your photos are processed on this device and are never uploaded or stored.
          </div>
        </div>
      </div>
    </div>
  );
}

function initialPhotoState(): PhotoState {
  return {
    src: null,
    confidence: 0,
    leftX: 0.32, rightX: 0.68,
    waistY: 0.55, topY: 0.06, bottomY: 0.97,
    autoDetected: false,
    keypoints: [],
    keypointAvg: 0,
    imageW: 0, imageH: 0,
    imageQuality: null,
    silhouette: null,
    userAdjustedWaist: false,
  };
}
