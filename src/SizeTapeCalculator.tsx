import { useEffect, useRef, useState, useCallback, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
type Gender = "male" | "female";
type SizeStr = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL";
type PhotoType = "front" | "side";
type CameraFacing = "user" | "environment";
type CalibrationMethod = "height" | "card";

interface KP { x: number; y: number; score: number; name: string }
interface Pose { keypoints: KP[] }
interface Detector { estimatePoses(img: HTMLCanvasElement): Promise<Pose[]> }

declare global {
  interface Window {
    tf: { setBackend(b: string): Promise<void>; ready(): Promise<void> };
    poseDetection: {
      createDetector(model: string, cfg: object): Promise<Detector>;
      SupportedModels: { MoveNet: string; BlazePose: string };
      movenet: { modelType: { SINGLEPOSE_THUNDER: string; SINGLEPOSE_LIGHTNING: string } };
    };
  }
}

/* ─────────────────────────────────────────────
   Constants / helpers
───────────────────────────────────────────── */
const ORDER: SizeStr[] = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

// Credit card standard dimensions (ISO/IEC 7810 ID-1)
const CARD_WIDTH_CM = 8.56;
const CARD_HEIGHT_CM = 5.398;

function sizeFromBMI(bmi: number, g: Gender): SizeStr {
  const t = g === "male" ? [18.5, 23, 27, 30] : [17.5, 21.5, 25, 28.5];
  if (bmi < t[0]) return "XS";
  if (bmi < t[1]) return "S";
  if (bmi < t[2]) return "M";
  if (bmi < t[3]) return "L";
  return "XL";
}

function sizeFromWaist(waistCm: number, heightCm: number, g: Gender): SizeStr {
  const ratio = waistCm / heightCm;
  const men: [SizeStr, number][] = [["S", 0.48], ["M", 0.535], ["L", 0.595], ["XL", 0.655], ["XXL", 0.715]];
  const women: [SizeStr, number][] = [["XS", 0.415], ["S", 0.445], ["M", 0.475], ["L", 0.525], ["XL", 0.59], ["XXL", 0.65]];
  const table = g === "male" ? men : women;
  for (const [s, max] of table) if (ratio <= max) return s;
  return "XXXL";
}

// Ramanujan's second approximation for ellipse circumference (accurate to ~0.04%)
function ellipseCircumference(a: number, b: number): number {
  const h = Math.pow(a - b, 2) / Math.pow(a + b, 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// Calculate confidence score based on keypoint visibility
function calculateConfidence(keypoints: KP[], required: string[]): number {
  let total = 0;
  let count = 0;
  for (const name of required) {
    const kp = keypoints.find(k => k.name === name);
    if (kp) {
      total += kp.score;
      count++;
    }
  }
  return count > 0 ? (total / count) * 100 : 0;
}

/* ─────────────────────────────────────────────
   Inline styles (mirroring original CSS)
───────────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  :root{
    --ink:#1B2A4A;--brass:#B08D57;--chalk:#EDE7DD;--stitch:#C1443C;
    --sage:#7A8B6F;--paper:#F7F4EE;--line:#D8D0BF;--blue:#3B82F6;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',sans-serif;padding:0 0 60px;}
  button,input{font:inherit;}
  button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid rgba(59,130,246,.28);outline-offset:3px;}
  .st-wrap{max-width:860px;margin:0 auto;padding:28px 20px 0;}
  .st-tape{height:8px;background:linear-gradient(90deg,var(--ink),var(--brass),var(--stitch));}
  .st-header{position:relative;overflow:hidden;padding:38px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,#fff 0%,#f8f3e9 100%);box-shadow:0 18px 50px rgba(27,42,74,.08);}
  .st-header:after{content:"";position:absolute;width:240px;height:240px;border:46px solid rgba(176,141,87,.08);border-radius:50%;right:-105px;top:-130px;pointer-events:none;z-index:0;}
  .st-header > *{position:relative;z-index:1;}
  .st-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 9px;}
  .st-h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(34px,6vw,50px);margin:0 0 12px;line-height:1.05;max-width:650px;letter-spacing:-.02em;}
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
  .st-quick-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:24px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--line);position:relative;z-index:1;}
  .st-flow-item{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.82);}
  .st-flow-num{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--chalk);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;}
  .st-flow-item strong{display:block;font-size:12.5px;line-height:1.25;}
  .st-flow-item small{display:block;margin-top:2px;color:#858c99;font-size:10.5px;}
  @keyframes st-pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .st-step{margin-top:28px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px;position:relative;transition:opacity .2s;}
  .st-step.locked{opacity:.45;pointer-events:none;}
  .st-step-head{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
  .st-num{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:13px;width:28px;height:28px;border-radius:50%;border:1.5px solid var(--ink);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .st-hint{font-size:12.5px;color:#8a8f9c;margin-left:auto;}
  .st-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
  .st-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px;}
  .st-label{display:block;font-size:12.5px;font-weight:600;color:#5b6478;margin-bottom:6px;letter-spacing:.02em;}
  .st-input{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:9px;font-family:'IBM Plex Mono',monospace;font-size:16px;background:var(--paper);color:var(--ink);}
  .st-input:focus{outline:none;border-color:var(--brass);}
  .st-gtoggle{display:flex;gap:8px;margin-bottom:14px;}
  .st-gbtn{flex:1;padding:12px;border:1.5px solid var(--line);background:var(--paper);border-radius:9px;font-family:'Inter',sans-serif;font-weight:600;font-size:14px;cursor:pointer;color:#5b6478;transition:.15s;}
  .st-gbtn.active{border-color:var(--ink);background:var(--ink);color:#fff;}
  .st-gbtn.blue{border-color:var(--blue);background:var(--blue);color:#fff;}
  .st-btn{display:inline-flex;align-items:center;gap:8px;background:var(--stitch);color:#fff;border:none;border-radius:9px;padding:12px 20px;font-family:'Inter',sans-serif;font-weight:600;font-size:14.5px;cursor:pointer;transition:.15s;margin-top:6px;}
  .st-btn:hover{filter:brightness(1.06);}
  .st-btn.secondary{background:transparent;color:var(--ink);border:1.5px solid var(--ink);}
  .st-btn.ghost{background:transparent;color:#8a8f9c;border:1px dashed var(--line);}
  .st-btn.blue{background:var(--blue);}
  .st-btn:disabled{opacity:.4;cursor:not-allowed;}
  .st-baseline{margin-top:16px;padding:14px 16px;background:var(--chalk);border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:13.5px;}
  .st-baseline b{font-family:'Fraunces',serif;font-size:17px;}
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
  .st-zctrl{width:38px;height:38px;border-radius:9px;border:1.5px solid var(--line);background:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600;color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;}
  .st-zctrl:hover{border-color:var(--brass);background:#fff;}
  .st-zctrl:active{transform:scale(.92);}
  .st-zgroup{display:flex;gap:6px;}
  .st-zlabel{font-size:11.5px;color:#8a8f9c;font-family:'IBM Plex Mono',monospace;margin-right:2px;}
  .st-reset-z{padding:0 12px;width:auto;font-size:12px;font-weight:600;color:#8a8f9c;background:transparent;border:1px dashed var(--line);}
  .st-result-hero{text-align:center;padding:30px 20px;background:var(--ink);color:#fff;border-radius:12px;}
  .st-result-hero .st-eyebrow{color:var(--brass);opacity:1;}
  .st-size-big{font-family:'Fraunces',serif;font-size:64px;font-weight:700;margin:6px 0;}
  .st-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;}
  .st-result-card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px 16px;}
  .st-result-card .val{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600;}
  .st-flag{margin-top:14px;padding:12px 14px;border-radius:9px;font-size:13px;line-height:1.5;}
  .st-flag.ok{background:#eef3ea;color:var(--sage);}
  .st-flag.warn{background:#faf1e8;color:#a5652a;}
  table.st-sizechart{width:100%;border-collapse:collapse;margin-top:16px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
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
  .st-measure-details summary:after{content:"+";float:right;font-family:'IBM Plex Mono',monospace;}
  .st-measure-details[open] summary:after{content:"−";}
  .st-measure-details p{margin:0;padding:0 14px 14px;color:#7a8290;font-size:11.5px;line-height:1.6;}
  .st-handle{cursor:grab;}
  .st-handle:active{cursor:grabbing;}
  .st-tabs{display:flex;gap:8px;margin-bottom:16px;}
  .st-tab{flex:1;padding:10px 14px;border:1.5px solid var(--line);background:var(--paper);border-radius:9px;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;cursor:pointer;color:#5b6478;transition:.15s;text-align:center;}
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
  .st-photo-thumb{position:relative;width:120px;height:160px;border-radius:8px;overflow:hidden;border:2px solid var(--line);}
  .st-photo-thumb.active{border-color:var(--brass);}
  .st-photo-thumb img{width:100%;height:100%;object-fit:cover;}
  .st-photo-thumb .label{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:4px 8px;text-align:center;}
  .st-photo-thumb .remove{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;}
  .st-card-overlay{position:absolute;border:2px dashed var(--blue);background:rgba(59,130,246,0.1);cursor:move;}
  .st-accuracy-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;font-family:'IBM Plex Mono',monospace;}
  .st-accuracy-badge.high{background:#dcfce7;color:#15803d;}
  .st-accuracy-badge.medium{background:#fef3c7;color:#a16207;}
  .st-accuracy-badge.low{background:#fee2e2;color:#b91c1c;}
  .st-step h2{font-family:'Fraunces',serif;font-size:20px;font-weight:600;margin:0;}
  .st-saved{display:flex;align-items:center;gap:10px;margin-top:16px;padding:12px 14px;border-radius:10px;background:#eef3ea;color:#53644b;font-size:12.5px;line-height:1.45;}
  .st-saved-mark{width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:50%;background:#d7e5d0;font-size:11px;font-weight:800;}
  .st-result-note{margin-top:16px;padding:13px 15px;border:1px solid #dbe1e8;border-radius:10px;background:#f8fafc;color:#657083;font-size:12px;line-height:1.55;}
  .st-result-note strong{color:var(--ink);}
  @media(max-width:680px){
    body{padding-bottom:32px;}
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
  }
`;

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function SizeTapeCalculator() {
  /* ── Step 1 state ── */
  const [gender, setGender] = useState<Gender | null>(null);
  const [heightVal, setHeightVal] = useState("");
  const [weightVal, setWeightVal] = useState("");
  const [bmi, setBmi] = useState<number | null>(null);
  const [baselineSize, setBaselineSize] = useState<SizeStr | null>(null);

  /* ── Calibration method ── */
  const [calibrationMethod, setCalibrationMethod] = useState<CalibrationMethod>("height");

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
  
  // Front photo state
  const [frontPhotoSrc, setFrontPhotoSrc] = useState<string | null>(null);
  const [frontConfidence, setFrontConfidence] = useState(0);
  const [frontLeftX, setFrontLeftX] = useState(0.32);
  const [frontRightX, setFrontRightX] = useState(0.68);
  const [frontWaistY, setFrontWaistY] = useState(0.55);
  const [frontTopY, setFrontTopY] = useState(0.06);
  const [frontBottomY, setFrontBottomY] = useState(0.97);
  const [frontAutoDetected, setFrontAutoDetected] = useState(false);
  
  // Side photo state
  const [sidePhotoSrc, setSidePhotoSrc] = useState<string | null>(null);
  const [sideConfidence, setSideConfidence] = useState(0);
  const [sideLeftX, setSideLeftX] = useState(0.35);
  const [sideRightX, setSideRightX] = useState(0.65);
  const [sideWaistY, setSideWaistY] = useState(0.55);
  const [sideTopY, setSideTopY] = useState(0.06);
  const [sideBottomY, setSideBottomY] = useState(0.97);
  const [sideAutoDetected, setSideAutoDetected] = useState(false);

  // Card calibration state
  const [cardRect, setCardRect] = useState({ x: 0.4, y: 0.7, w: 0.2, h: 0.126 });
  const [cardDragging, setCardDragging] = useState<string | null>(null);
  
  const [showInstructions, setShowInstructions] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [detectBanner, setDetectBanner] = useState<{ text: string; type: "loading" | "warn" | "success" } | null>(null);

  const draggingRef = useRef<string | null>(null);

  /* ── Zoom / pan state ── */
  const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25, PAN_STEP = 30;
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  /* ── Step 3 state ── */
  const [waistCm, setWaistCm] = useState<number | null>(null);
  const [frontWidthCm, setFrontWidthCm] = useState<number | null>(null);
  const [sideDepthCm, setSideDepthCm] = useState<number | null>(null);
  const [measurementMethod, setMeasurementMethod] = useState<"single" | "ellipse">("single");

  /* ── Model ── */
  const [modelReady, setModelReady] = useState(false);
  const [modelStatus, setModelStatus] = useState("Preparing photo scanner…");
  const [, setModelType] = useState<"lightning" | "thunder">("thunder");
  const detectorRef = useRef<Detector | null>(null);

  /* ── DOM refs ── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);

  /* ── Inject global styles & scripts ── */
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);

    const tfScript = document.createElement("script");
    tfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.20.0/tf.min.js";
    tfScript.async = true;
    document.head.appendChild(tfScript);

    const pdScript = document.createElement("script");
    pdScript.src = "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection";
    pdScript.async = true;
    document.head.appendChild(pdScript);

    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded === 2) initModel();
    };
    tfScript.addEventListener("load", onLoad);
    pdScript.addEventListener("load", onLoad);

    return () => {
      document.head.removeChild(style);
      if (document.head.contains(tfScript)) document.head.removeChild(tfScript);
      if (document.head.contains(pdScript)) document.head.removeChild(pdScript);
    };
  }, []);

  async function initModel() {
    try {
      try { await window.tf.setBackend("webgl"); await window.tf.ready(); }
      catch { await window.tf.setBackend("cpu"); await window.tf.ready(); }
      
      // Use MoveNet THUNDER for better accuracy (slower but more precise)
      detectorRef.current = await window.poseDetection.createDetector(
        window.poseDetection.SupportedModels.MoveNet,
        { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }
      );
      setModelReady(true);
      setModelType("thunder");
      setModelStatus("Photo scanner ready");
    } catch {
      // Fallback to Lightning
      try {
        detectorRef.current = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );
        setModelReady(true);
        setModelType("lightning");
        setModelStatus("Photo scanner ready");
      } catch {
        setModelStatus("Automatic scanning is unavailable — adjust the guides manually");
      }
    }
  }

  /* ─── Step 1 ─── */
  function calcBaseline() {
    const h = parseFloat(heightVal), w = parseFloat(weightVal);
    if (!gender) { alert("Please select a gender."); return; }
    if (!h || !w) { alert("Please enter your height and weight."); return; }
    const b = w / Math.pow(h / 100, 2);
    const sz = sizeFromBMI(b, gender);
    setBmi(b); setBaselineSize(sz);
    setStep2Locked(false); setStep3Locked(true); setWaistCm(null);
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
      if (type === "front") {
        setFrontPhotoSrc(src);
        setFrontAutoDetected(false);
        setFrontLeftX(0.32); setFrontRightX(0.68); setFrontWaistY(0.55);
        setFrontTopY(0.06); setFrontBottomY(0.97);
      } else {
        setSidePhotoSrc(src);
        setSideAutoDetected(false);
        setSideLeftX(0.35); setSideRightX(0.65); setSideWaistY(0.55);
        setSideTopY(0.06); setSideBottomY(0.97);
      }
      setActivePhotoType(type);
      setShowInstructions(false);
      setShowConfirm(false);
      setDetectBanner(null);
      resetZoom();
    };
    reader.readAsDataURL(file);
  }

  /* ─── Run detection after image loads ─── */
  async function runDetection(type: PhotoType) {
    setDetectBanner({ text: "Scanning your photo…", type: "loading" });
    setShowInstructions(false);
    
    if (!detectorRef.current) {
      setDetectBanner({ text: "The scanner is not ready yet — adjust the guides manually", type: "warn" });
      finishDetectUI(false); return;
    }
    
    try {
      const imgEl = imgRef.current!;
      const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
      const cnv = document.createElement("canvas");
      cnv.width = nw; cnv.height = nh;
      cnv.getContext("2d")!.drawImage(imgEl, 0, 0, nw, nh);
      
      const poses = await detectorRef.current.estimatePoses(cnv);
      if (!poses.length) throw new Error("no-pose");
      
      const keypoints = poses[0].keypoints;
      const kp: Record<string, KP> = {};
      keypoints.forEach(k => (kp[k.name] = k));
      
      // Required keypoints for measurement
      const frontRequired = ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"];
      const sideRequired = ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"];
      
      const required = type === "front" ? frontRequired : sideRequired;
      const missing = required.filter(n => !kp[n] || kp[n].score < 0.2);
      
      // Calculate confidence
      const confidence = calculateConfidence(keypoints, required);
      
      if (missing.length > 2) throw new Error("low-confidence");

      const noseY = kp.nose?.y || 0;
      const ankleY = ((kp.left_ankle?.y || 0) + (kp.right_ankle?.y || 0)) / 2;
      const shoulderY = ((kp.left_shoulder?.y || 0) + (kp.right_shoulder?.y || 0)) / 2;
      const hipY = ((kp.left_hip?.y || 0) + (kp.right_hip?.y || 0)) / 2;
      
      let shoulderW: number, hipW: number, hipCenterX: number;
      
      if (type === "front") {
        shoulderW = Math.abs((kp.left_shoulder?.x || 0) - (kp.right_shoulder?.x || 0));
        hipW = Math.abs((kp.left_hip?.x || 0) - (kp.right_hip?.x || 0));
        hipCenterX = ((kp.left_hip?.x || 0) + (kp.right_hip?.x || 0)) / 2;
      } else {
        // For side view, use single points for depth
        shoulderW = Math.abs((kp.left_shoulder?.x || 0) - (kp.right_shoulder?.x || 0)) * 0.6;
        hipW = Math.abs((kp.left_hip?.x || 0) - (kp.right_hip?.x || 0)) * 0.8;
        hipCenterX = ((kp.left_hip?.x || 0) + (kp.right_hip?.x || 0)) / 2;
      }

      const span = ankleY - noseY;
      const headTopY = noseY - span * 0.08;
      const feetY = ankleY + span * 0.04;
      
      // Natural waistline position
      const wY = hipY - 0.20 * (hipY - shoulderY);
      const frac = (hipY - wY) / Math.max(1, hipY - shoulderY);
      const waistWpx = hipW + (shoulderW - hipW) * frac * 0.5;

      if (type === "front") {
        setFrontTopY(headTopY / nh);
        setFrontBottomY(feetY / nh);
        setFrontWaistY(wY / nh);
        setFrontLeftX((hipCenterX - waistWpx / 2) / nw);
        setFrontRightX((hipCenterX + waistWpx / 2) / nw);
        setFrontAutoDetected(true);
        setFrontConfidence(confidence);
      } else {
        setSideTopY(headTopY / nh);
        setSideBottomY(feetY / nh);
        setSideWaistY(wY / nh);
        setSideLeftX((hipCenterX - waistWpx / 2) / nw);
        setSideRightX((hipCenterX + waistWpx / 2) / nw);
        setSideAutoDetected(true);
        setSideConfidence(confidence);
      }
      
      const qualityText = confidence >= 80
        ? "photo quality is excellent"
        : confidence >= 50
          ? "photo quality looks good"
          : "please review the guides";
      setDetectBanner({
        text: `Photo ready — ${qualityText}`,
        type: confidence >= 50 ? "success" : "warn"
      });
      finishDetectUI(true);
    } catch {
      if (type === "front") setFrontAutoDetected(false);
      else setSideAutoDetected(false);
      setDetectBanner({
        text: "We could not detect the full body clearly — position the waist guide manually",
        type: "warn"
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
    // Do not reopen the already-selected camera, but allow a live switch to the other one.
    if (cameraStarting || (camActive && facing === cameraFacing)) return;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access requires a secure HTTPS connection. Open this page over HTTPS and try again.");
      return;
    }

    const requestId = ++cameraRequestRef.current;
    setCameraStarting(true);
    setCameraReady(false);
    setCameraError(null);

    // Mobile browsers generally require the current camera track to be stopped before opening
    // the other facing mode. Clear the old preview while the selected camera is opening.
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (camActive) setCamActive(false);

    try {
      // `ideal` honours the selected camera when it exists and still works on devices with one camera.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      // The request may finish after the user cancels or the component unmounts.
      if (cameraRequestRef.current !== requestId) {
        stopStream(stream);
        return;
      }

      camStreamRef.current = stream;
      setCameraFacing(facing);
      // Trigger the preview attachment effect even when React batches a live camera switch.
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
    // Invalidate an in-flight permission request as well as the active stream.
    cameraRequestRef.current++;
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCamActive(false);
    setCameraStarting(false);
    setCameraReady(false);
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
    if (!context) {
      setCameraError("We could not prepare the photo. Please try again.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) {
        loadImageFile(blob, activePhotoType);
        stopCamera();
      } else {
        setCameraError("We could not capture the photo. Please try again.");
      }
    }, "image/jpeg", 0.92);
  }

  // The video element is rendered only after camera state changes. Attach the stream in an
  // effect so it is not lost while the video ref is still null during `startCamera`.
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

  // Always release the hardware camera if the component is removed from the page.
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

  // Get current photo state based on active type
  const currentPhotoSrc = activePhotoType === "front" ? frontPhotoSrc : sidePhotoSrc;
  const leftX = activePhotoType === "front" ? frontLeftX : sideLeftX;
  const rightX = activePhotoType === "front" ? frontRightX : sideRightX;
  const waistY = activePhotoType === "front" ? frontWaistY : sideWaistY;
  const topY = activePhotoType === "front" ? frontTopY : sideTopY;
  const bottomY = activePhotoType === "front" ? frontBottomY : sideBottomY;
  const autoDetected = activePhotoType === "front" ? frontAutoDetected : sideAutoDetected;
  const currentConfidence = activePhotoType === "front" ? frontConfidence : sideConfidence;
  const currentPhotoQuality = currentConfidence >= 70 ? "Clear" : currentConfidence >= 40 ? "Good" : "Review needed";

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const h = draggingRef.current;
    
    if (activePhotoType === "front") {
      if (h === "L") setFrontLeftX(Math.min(fx, frontRightX - 0.02));
      if (h === "R") setFrontRightX(Math.max(fx, frontLeftX + 0.02));
      if (h === "Y") setFrontWaistY(fy);
      if (h === "T") setFrontTopY(Math.min(fy, frontBottomY - 0.05));
      if (h === "B") setFrontBottomY(Math.max(fy, frontTopY + 0.05));
    } else {
      if (h === "L") setSideLeftX(Math.min(fx, sideRightX - 0.02));
      if (h === "R") setSideRightX(Math.max(fx, sideLeftX + 0.02));
      if (h === "Y") setSideWaistY(fy);
      if (h === "T") setSideTopY(Math.min(fy, sideBottomY - 0.05));
      if (h === "B") setSideBottomY(Math.max(fy, sideTopY + 0.05));
    }
  }

  function handlePointerUp() { draggingRef.current = null; }

  /* ─── Card calibration handlers ─── */
  function handleCardPointerDown(e: ReactPointerEvent, edge: string) {
    e.preventDefault(); e.stopPropagation();
    setCardDragging(edge);
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
        const newH = newW * (CARD_HEIGHT_CM / CARD_WIDTH_CM);
        return { ...prev, w: newW, h: newH };
      }
      return prev;
    });
  }
  
  function handleCardPointerUp() { setCardDragging(null); }

  /* ─── Confirm waist ─── */
  function confirmWaist() {
    const img = imgRef.current!;
    let scale: number;
    
    if (calibrationMethod === "card" && frontPhotoSrc) {
      // Use credit card for calibration
      const cardPixelWidth = cardRect.w * img.naturalWidth;
      scale = CARD_WIDTH_CM / cardPixelWidth;
    } else {
      // Use height for calibration
      const pxHeight = (frontBottomY - frontTopY) * img.naturalHeight;
      if (pxHeight <= 0) {
        alert("Please position the head and feet guides correctly.");
        return;
      }
      const h = parseFloat(heightVal);
      scale = h / pxHeight;
    }
    
    // Calculate front width
    const frontPxWidth = (frontRightX - frontLeftX) * img.naturalWidth;
    const frontW = frontPxWidth * scale;
    setFrontWidthCm(frontW);
    
    // Check if we have side photo for ellipse calculation
    if (sidePhotoSrc) {
      // For side photo, we need its own scale
      let sideScale: number;
      if (calibrationMethod === "height") {
        const sidePxHeight = (sideBottomY - sideTopY) * img.naturalHeight;
        sideScale = parseFloat(heightVal) / sidePxHeight;
      } else {
        sideScale = scale; // Use same card scale
      }
      
      const sidePxWidth = (sideRightX - sideLeftX) * img.naturalWidth;
      const sideW = sidePxWidth * sideScale;
      setSideDepthCm(sideW);
      
      // Use Ramanujan's formula for ellipse circumference
      const a = frontW / 2; // semi-major axis (front half-width)
      const b = sideW / 2;  // semi-minor axis (side half-depth)
      const circumference = ellipseCircumference(a, b);
      setWaistCm(circumference);
      setMeasurementMethod("ellipse");
    } else {
      // Single photo method with gender-based multiplier
      const factor = gender === "male" ? 2.5 : 2.35;
      const wc = frontW * factor;
      setWaistCm(wc);
      setMeasurementMethod("single");
    }
    
    setStep3Locked(false);
    setTimeout(() => {
      document.getElementById("st-step3")?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  /* ─── Retake ─── */
  function retake(type: PhotoType) {
    if (type === "front") {
      setFrontPhotoSrc(null);
      setFrontAutoDetected(false);
    } else {
      setSidePhotoSrc(null);
      setSideAutoDetected(false);
    }
    setShowConfirm(false);
    setShowInstructions(false);
    setDetectBanner(null);
    resetZoom();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /* ─── Results ─── */
  const heightCm = parseFloat(heightVal) || 0;
  const waistSize = waistCm && gender && heightCm ? sizeFromWaist(waistCm, heightCm, gender) : null;
  const finalSize = waistSize || baselineSize;

  let flagType: "ok" | "warn" | null = null;
  let flagText = "";
  if (waistSize && baselineSize) {
    const diff = Math.abs(ORDER.indexOf(waistSize) - ORDER.indexOf(baselineSize));
    if (diff >= 2) {
      flagType = "warn";
      flagText = "Your details and photo estimate do not match closely. For a better result, retake the photo while standing straight.";
    } else {
      flagType = "ok";
      flagText = "Your details and photo estimate are closely aligned.";
    }
  }

  // User-facing quality is based on photo coverage, not a measurement guarantee.
  const getPhotoSetupQuality = () => {
    if (measurementMethod === "ellipse" && frontConfidence >= 70 && sideConfidence >= 70) return "high";
    if (frontConfidence >= 60 || measurementMethod === "ellipse") return "medium";
    return "low";
  };

  type ChartRow = [SizeStr, number, number];
  const menChart: ChartRow[] = [["S", 0, 0.48], ["M", 0.48, 0.535], ["L", 0.535, 0.595], ["XL", 0.595, 0.655], ["XXL", 0.655, 0.715]];
  const womenChart: ChartRow[] = [["XS", 0, 0.415], ["S", 0.415, 0.445], ["M", 0.445, 0.475], ["L", 0.475, 0.525], ["XL", 0.525, 0.59], ["XXL", 0.59, 0.65]];
  const chartRows = gender === "male" ? menChart : gender === "female" ? womenChart : [];

  const [imgDim, setImgDim] = useState({ w: 0, h: 0 });
  function onImgLoad() {
    const el = imgRef.current;
    if (el) { 
      setImgDim({ w: el.clientWidth, h: el.clientHeight }); 
      runDetection(activePhotoType); 
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
    <>
      <div className="st-tape" />
      <div className="st-wrap">

        {/* ── Header ── */}
        <header className="st-header">
          <p className="st-eyebrow">Smart size finder</p>
          <h1 className="st-h1">Find your best fit from home.</h1>
          <p className="st-header-copy">
            Enter your basic details and add two clear photos to get an estimated waist measurement and recommended clothing size.
          </p>

          <div className="st-hero-actions">
            <button
              type="button"
              className="st-hero-btn"
              onClick={() => document.getElementById("st-step1")?.scrollIntoView({ behavior: "smooth" })}
            >
              Start size check <span aria-hidden="true">→</span>
            </button>
            <span className="st-time-note">Takes about 2 minutes</span>
          </div>

          <div className="st-trust-row">
            <span className="st-pill">
              <span className="st-pill-icon" aria-hidden="true">✓</span>
              Your photos stay private on this device
            </span>
            <span className="st-pill status" aria-live="polite">
              <span className={`st-dot ${modelReady ? "ready" : modelStatus.includes("Preparing") ? "busy" : ""}`} />
              {modelStatus}
            </span>
          </div>

          <div className="st-quick-flow" aria-label="Three steps to check your size">
            <div className="st-flow-item">
              <span className="st-flow-num">1</span>
              <div><strong>Enter your details</strong><small>Height and weight</small></div>
            </div>
            <div className="st-flow-item">
              <span className="st-flow-num">2</span>
              <div><strong>Add your photos</strong><small>Front and side views</small></div>
            </div>
            <div className="st-flow-item">
              <span className="st-flow-num">3</span>
              <div><strong>See your size</strong><small>Waist and fit estimate</small></div>
            </div>
          </div>
        </header>

        {/* ── Step 1 ── */}
        <div id="st-step1" className="st-step">
          <div className="st-step-head">
            <div className="st-num">1</div>
            <h2>Tell us a little about you</h2>
            <span className="st-hint">All fields are required</span>
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

          <button type="button" className="st-btn" onClick={calcBaseline} style={{ marginTop: 16 }}>
            Continue <span aria-hidden="true">→</span>
          </button>
          {baselineSize && bmi && (
            <div className="st-saved" role="status">
              <span className="st-saved-mark" aria-hidden="true">✓</span>
              <span>Details saved. Add a front photo to complete your size check.</span>
            </div>
          )}
        </div>

        {/* ── Step 2 ── */}
        <div className={`st-step ${step2Locked ? "locked" : ""}`}>
          <div className="st-step-head">
            <div className="st-num">2</div>
            <h2>Add front and side photos</h2>
            <span className="st-hint">Front required · Side recommended</span>
          </div>

          {/* Photo type tabs */}
          <div className="st-tabs">
            <button 
              className={`st-tab ${activePhotoType === "front" ? "active" : ""} ${frontPhotoSrc ? "" : ""}`}
              onClick={() => setActivePhotoType("front")}
            >
              <span className="icon" aria-hidden="true">①</span>
              Front view {frontPhotoSrc && "✓"}
            </button>
            <button 
              className={`st-tab ${activePhotoType === "side" ? "active" : ""}`}
              onClick={() => setActivePhotoType("side")}
            >
              <span className="icon" aria-hidden="true">②</span>
              Side view {sidePhotoSrc && "✓"} <span style={{ fontSize: 10, opacity: 0.72 }}>(recommended)</span>
            </button>
          </div>

          {/* Short, action-focused photo checklist */}
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
                ? "face the camera and stand straight."
                : "turn 90° and stand in a true side profile."}
              {calibrationMethod === "card" && activePhotoType === "front"
                ? " Hold a standard bank card flat near your waist."
                : ""}
            </p>
          </div>

          {/* Photo previews */}
          {(frontPhotoSrc || sidePhotoSrc) && (
            <div className="st-photo-preview">
              {frontPhotoSrc && (
                <div className={`st-photo-thumb ${activePhotoType === "front" ? "active" : ""}`} onClick={() => setActivePhotoType("front")}>
                  <img src={frontPhotoSrc} alt="Front" />
                  <span className="label">Front view · Ready</span>
                  <button className="remove" onClick={(e) => { e.stopPropagation(); retake("front"); }}>×</button>
                </div>
              )}
              {sidePhotoSrc && (
                <div className={`st-photo-thumb ${activePhotoType === "side" ? "active" : ""}`} onClick={() => setActivePhotoType("side")}>
                  <img src={sidePhotoSrc} alt="Side" />
                  <span className="label">Side view · Ready</span>
                  <button className="remove" onClick={(e) => { e.stopPropagation(); retake("side"); }}>×</button>
                </div>
              )}
            </div>
          )}

          {/* Upload zones */}
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
                      {/* Head top line */}
                      <line x1={0} y1={ty} x2={sw} y2={ty} stroke="#1B2A4A" strokeWidth={2} strokeDasharray="6,4" />
                      <circle
                        className="st-handle" cx={sw / 2} cy={ty} r={10}
                        fill="#1B2A4A" stroke="#fff" strokeWidth={2}
                        onPointerDown={e => handlePointerDown(e, "T")}
                      />
                      <text x={sw / 2 + 16} y={ty + 4} fontSize={10} fill="#1B2A4A" fontFamily="IBM Plex Mono">head</text>

                      {/* Feet line */}
                      <line x1={0} y1={by} x2={sw} y2={by} stroke="#1B2A4A" strokeWidth={2} strokeDasharray="6,4" />
                      <circle
                        className="st-handle" cx={sw / 2} cy={by} r={10}
                        fill="#1B2A4A" stroke="#fff" strokeWidth={2}
                        onPointerDown={e => handlePointerDown(e, "B")}
                      />
                      <text x={sw / 2 + 16} y={by + 4} fontSize={10} fill="#1B2A4A" fontFamily="IBM Plex Mono">feet</text>

                      {/* Waist line */}
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
                      
                      {/* Credit card overlay for calibration */}
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

              {/* Photo scan quality — intentionally qualitative, not an accuracy claim */}
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

              {/* Zoom controls */}
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

          {/* Detection banner */}
          {detectBanner && (
            <div className={`st-detect-banner ${detectBanner.type}`}>
              {detectBanner.type === "loading" && <div className="st-spinner" />}
              {detectBanner.type === "success" && <span>✅</span>}
              {detectBanner.type === "warn" && <span>⚠️</span>}
              <span>{detectBanner.text}</span>
            </div>
          )}

          {/* Instructions */}
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

          {/* Action buttons */}
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {frontPhotoSrc && !sidePhotoSrc && (
              <button 
                className="st-btn blue" 
                onClick={() => { setActivePhotoType("side"); }}
              >
                Add a side photo →
              </button>
            )}
            
            {showConfirm && frontPhotoSrc && (
              <button className="st-btn" onClick={confirmWaist}>
                {sidePhotoSrc ? "See my size →" : "Continue with front photo →"}
              </button>
            )}
            
            {currentPhotoSrc && (
              <button className="st-btn ghost" onClick={() => retake(activePhotoType)}>
                Change {activePhotoType === "front" ? "front" : "side"} photo
              </button>
            )}
          </div>
        </div>

        {/* ── Step 3 ── */}
        <div id="st-step3" className={`st-step ${step3Locked ? "locked" : ""}`}>
          <div className="st-step-head">
            <div className="st-num">3</div>
            <h2>Final size</h2>
          </div>

          {finalSize && (
            <>
              <div className="st-result-hero">
                <p className="st-eyebrow">Your recommended size</p>
                <div className="st-size-big">{finalSize}</div>
                <div style={{ fontSize: "12.5px", opacity: 0.78, marginBottom: 12 }}>
                  {measurementMethod === "ellipse"
                    ? "Based on your front and side photos"
                    : waistSize
                      ? "Based on your front photo and details"
                      : "Based on your basic details"}
                </div>
                <span className={`st-accuracy-badge ${getPhotoSetupQuality()}`}>
                  {getPhotoSetupQuality() === "high" && "Photo setup · Excellent"}
                  {getPhotoSetupQuality() === "medium" && "Photo setup · Good"}
                  {getPhotoSetupQuality() === "low" && "Photo setup · Basic"}
                </span>
              </div>

              <div className="st-result-grid" style={{ marginTop: 18 }}>
                <div className="st-result-card">
                  <label className="st-label">Details-based estimate</label>
                  <div className="val">{baselineSize}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Photo-based estimate</label>
                  <div className="val">{waistSize || "—"}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Estimated waist</label>
                  <div className="val">{waistCm ? waistCm.toFixed(1) + " cm" : "—"}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Photos used</label>
                  <div className="val" style={{ fontSize: 14 }}>
                    {measurementMethod === "ellipse" ? "Front + side" : "Front only"}
                  </div>
                </div>
              </div>
              
              {/* Optional details stay out of the primary user journey. */}
              {(frontWidthCm || sideDepthCm) && (
                <details className="st-measure-details">
                  <summary>View measurement details</summary>
                  <div className="st-result-grid" style={{ margin: 0, padding: "0 14px 14px" }}>
                    <div className="st-result-card">
                      <label className="st-label">Front measurement</label>
                      <div className="val">{frontWidthCm ? frontWidthCm.toFixed(1) + " cm" : "—"}</div>
                    </div>
                    <div className="st-result-card">
                      <label className="st-label">Side measurement</label>
                      <div className="val">{sideDepthCm ? sideDepthCm.toFixed(1) + " cm" : "—"}</div>
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

              {/* Size chart */}
              {heightCm > 0 && (
                <table className="st-sizechart">
                  <thead>
                    <tr><th>Size</th><th>Waist range for your height (cm)</th></tr>
                  </thead>
                  <tbody>
                    {chartRows.map(([s, lo, hi]) => {
                      const loStr = (lo * heightCm).toFixed(0);
                      const hiStr = (hi * heightCm).toFixed(0);
                      const label = lo === 0 ? `up to ${hiStr}` : `${loStr}–${hiStr}`;
                      return (
                        <tr key={s} className={`st-size-row ${s === finalSize ? "hit" : ""}`}>
                          <td>{s}</td><td>{label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <footer className="st-note">
          <span className="st-footer-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Your photos stay private</strong>
            <p>Photos are processed entirely on your device. We never upload, share, or store them.</p>
            <p className="st-disclaimer">Size recommendations are estimates; final fit may vary by brand and style.</p>
          </div>
        </footer>

      </div>
    </>
  );
}
