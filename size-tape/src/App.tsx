import { useEffect, useRef, useState, useCallback, PointerEvent as ReactPointerEvent } from "react";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
type Gender = "male" | "female";
type SizeStr = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL";
type PhotoType = "front" | "side";
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
  .st-wrap{max-width:820px;margin:0 auto;padding:32px 20px 0;}
  .st-tape{height:34px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 20px);opacity:.15;margin-bottom:-6px;}
  .st-header{padding:10px 0 26px;border-bottom:2px dashed var(--line);}
  .st-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 6px;}
  .st-h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(28px,5vw,40px);margin:0 0 8px;line-height:1.05;}
  .st-header p{margin:0;color:#5b6478;font-size:15px;max-width:56ch;}
  .st-pill{display:inline-flex;align-items:center;gap:7px;margin-top:14px;padding:6px 12px;border-radius:20px;background:var(--chalk);font-size:12.5px;font-family:'IBM Plex Mono',monospace;}
  .st-dot{width:7px;height:7px;border-radius:50%;background:#c9c2ac;flex-shrink:0;}
  .st-dot.ready{background:var(--sage);}
  .st-dot.busy{background:var(--brass);animation:st-pulse 1s infinite;}
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
  .st-upload-zone{border:2px dashed var(--line);border-radius:12px;padding:22px 14px;text-align:center;cursor:pointer;transition:.15s;}
  .st-upload-zone:hover{border-color:var(--brass);}
  .st-upload-zone.active{border-color:var(--sage);background:rgba(122,139,111,0.08);}
  .st-upload-zone p{margin:8px 0 0;font-size:13px;color:#8a8f9c;}
  .st-video{width:100%;border-radius:10px;margin-top:12px;background:#000;}
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
  footer.st-note{margin-top:28px;font-size:12.5px;color:#9098a4;line-height:1.7;padding:16px 4px 0;border-top:1px dashed var(--line);}
  footer.st-note b{color:#5b6478;}
  .st-handle{cursor:grab;}
  .st-handle:active{cursor:grabbing;}
  .st-tabs{display:flex;gap:8px;margin-bottom:16px;}
  .st-tab{flex:1;padding:10px 14px;border:1.5px solid var(--line);background:var(--paper);border-radius:9px;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;cursor:pointer;color:#5b6478;transition:.15s;text-align:center;}
  .st-tab.active{border-color:var(--brass);background:var(--brass);color:#fff;}
  .st-tab .icon{font-size:18px;display:block;margin-bottom:4px;}
  .st-confidence{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--chalk);border-radius:8px;margin-top:12px;font-size:13px;}
  .st-confidence-bar{flex:1;height:8px;background:#d8d0bf;border-radius:4px;overflow:hidden;}
  .st-confidence-fill{height:100%;border-radius:4px;transition:width .3s;}
  .st-tips{background:#f0f4ff;border:1px solid #c7d4f4;border-radius:10px;padding:14px 16px;margin-top:16px;}
  .st-tips h4{margin:0 0 8px;font-size:13px;color:var(--blue);font-weight:600;}
  .st-tips ul{margin:0;padding-left:18px;font-size:12.5px;color:#4b5563;line-height:1.6;}
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
  .st-step h2{font-family:'Fraunces',serif;font-size:19px;font-weight:600;margin:0;}
`;

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function App() {
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
  const [modelStatus, setModelStatus] = useState("Model load ho raha hai…");
  const [, setModelType] = useState<"lightning" | "thunder">("thunder");
  const detectorRef = useRef<Detector | null>(null);

  /* ── DOM refs ── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
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
      setModelStatus("Pose model ready — THUNDER (high accuracy)");
    } catch {
      // Fallback to Lightning
      try {
        detectorRef.current = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );
        setModelReady(true);
        setModelType("lightning");
        setModelStatus("Pose model ready — LIGHTNING (fast)");
      } catch {
        setModelStatus("Auto-detect load nahi hua — manual mode use karein");
      }
    }
  }

  /* ─── Step 1 ─── */
  function calcBaseline() {
    const h = parseFloat(heightVal), w = parseFloat(weightVal);
    if (!gender) { alert("Gender select karein"); return; }
    if (!h || !w) { alert("Height aur weight bharein"); return; }
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

  function handleWheel(e: React.WheelEvent) {
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
    setDetectBanner({ text: "Body detect ho raha hai… (THUNDER model)", type: "loading" });
    setShowInstructions(false);
    
    if (!detectorRef.current) {
      setDetectBanner({ text: "Model abhi ready nahi — handles ko manually adjust karein", type: "warn" });
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
      
      const confText = confidence >= 80 ? "High confidence" : confidence >= 50 ? "Medium confidence" : "Low confidence";
      setDetectBanner({ 
        text: `Body detect ho gaya — ${confText} (${confidence.toFixed(0)}%)`, 
        type: confidence >= 50 ? "success" : "warn" 
      });
      finishDetectUI(true);
    } catch {
      if (type === "front") setFrontAutoDetected(false);
      else setSideAutoDetected(false);
      setDetectBanner({ 
        text: "Poori body clearly detect nahi hui — line ko manually set karein", 
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
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      camStreamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; }
      setCamActive(true);
    } catch { alert("Camera access nahi mil paya. Photo upload try karein."); }
  }
  function stopCamera() {
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    setCamActive(false);
  }
  function capturePhoto() {
    const v = videoRef.current!;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(blob => { if (blob) { loadImageFile(blob, activePhotoType); stopCamera(); } }, "image/jpeg", 0.92);
  }

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
        alert("Head-top aur feet-bottom line sahi jagah par nahi hain."); 
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
      flagText = "Photo-based waist aur height/weight baseline mein bada farak hai. Photo dobara seedhe khade hoke try karein.";
    } else {
      flagType = "ok";
      flagText = "Baseline aur photo measurement consistent hain — confidence high hai.";
    }
  }

  // Accuracy badge
  const getAccuracyLevel = () => {
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
          <p className="st-eyebrow">v2.0 · Ellipse Method · High Accuracy Mode</p>
          <h1 className="st-h1">Size Tape</h1>
          <p>Front + side photo se Ramanujan ellipse formula use karke accurate waist circumference nikalte hain. Pose detection aapke browser mein chalta hai — koi data upload nahi hota.</p>
          <div className="st-pill">
            <span className={`st-dot ${modelReady ? "ready" : "busy"}`} />
            <span>{modelStatus}</span>
          </div>
        </header>

        {/* ── Step 1 ── */}
        <div className="st-step">
          <div className="st-step-head">
            <div className="st-num">1</div>
            <h2>Apni details daalein</h2>
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
          
          {/* Calibration method */}
          <label className="st-label" style={{ marginTop: 16 }}>Scale Calibration Method</label>
          <div className="st-gtoggle">
            <button 
              className={`st-gbtn ${calibrationMethod === "height" ? "active" : ""}`} 
              onClick={() => setCalibrationMethod("height")}
            >
              📏 Height se
            </button>
            <button 
              className={`st-gbtn ${calibrationMethod === "card" ? "active" : ""}`} 
              onClick={() => setCalibrationMethod("card")}
            >
              💳 Credit Card se
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#8a8f9c", margin: "8px 0 0" }}>
            {calibrationMethod === "card" 
              ? "Photo mein credit card rakhein — exact size calibration ke liye (85.6mm × 53.98mm)" 
              : "Photo mein head se feet dikhna chahiye — height se scale calculate hoga"}
          </p>
          
          <button className="st-btn" onClick={calcBaseline} style={{ marginTop: 16 }}>Baseline size nikalein</button>
          {baselineSize && bmi && (
            <div className="st-baseline">
              Baseline estimate: <b>{baselineSize}</b>
              <div style={{ marginTop: 4, color: "#5b6478" }}>BMI {bmi.toFixed(1)} · Sirf height/weight par based</div>
            </div>
          )}
        </div>

        {/* ── Step 2 ── */}
        <div className={`st-step ${step2Locked ? "locked" : ""}`}>
          <div className="st-step-head">
            <div className="st-num">2</div>
            <h2>Photo se waist measure karein</h2>
            <span className="st-hint">2 photos = best accuracy</span>
          </div>

          {/* Photo type tabs */}
          <div className="st-tabs">
            <button 
              className={`st-tab ${activePhotoType === "front" ? "active" : ""} ${frontPhotoSrc ? "" : ""}`}
              onClick={() => setActivePhotoType("front")}
            >
              <span className="icon">👤</span>
              Front Photo {frontPhotoSrc && "✓"}
            </button>
            <button 
              className={`st-tab ${activePhotoType === "side" ? "active" : ""}`}
              onClick={() => setActivePhotoType("side")}
            >
              <span className="icon">🧍</span>
              Side Photo {sidePhotoSrc && "✓"} <span style={{ fontSize: 10, opacity: 0.7 }}>(recommended)</span>
            </button>
          </div>

          {/* Tips */}
          <div className="st-tips">
            <h4>📸 Better Photo = Better Accuracy</h4>
            <ul>
              <li><b>Tight/fitted kapde</b> pehne — loose clothes se measurement galat hota hai</li>
              <li><b>Seedhe khade ho</b>, haath side mein naturally</li>
              <li><b>Camera waist level par</b> rakhein, na ki upar ya neeche se</li>
              <li><b>Full body dikhna chahiye</b> — head se paanv tak</li>
              {calibrationMethod === "card" && <li><b>Credit card</b> waist ke paas floor par ya haath mein rakhein</li>}
              {activePhotoType === "side" && <li><b>90° turn</b> karein — bilkul side profile hona chahiye</li>}
            </ul>
          </div>

          {/* Photo previews */}
          {(frontPhotoSrc || sidePhotoSrc) && (
            <div className="st-photo-preview">
              {frontPhotoSrc && (
                <div className={`st-photo-thumb ${activePhotoType === "front" ? "active" : ""}`} onClick={() => setActivePhotoType("front")}>
                  <img src={frontPhotoSrc} alt="Front" />
                  <span className="label">Front {frontConfidence > 0 && `(${frontConfidence.toFixed(0)}%)`}</span>
                  <button className="remove" onClick={(e) => { e.stopPropagation(); retake("front"); }}>×</button>
                </div>
              )}
              {sidePhotoSrc && (
                <div className={`st-photo-thumb ${activePhotoType === "side" ? "active" : ""}`} onClick={() => setActivePhotoType("side")}>
                  <img src={sidePhotoSrc} alt="Side" />
                  <span className="label">Side {sideConfidence > 0 && `(${sideConfidence.toFixed(0)}%)`}</span>
                  <button className="remove" onClick={(e) => { e.stopPropagation(); retake("side"); }}>×</button>
                </div>
              )}
            </div>
          )}

          {/* Upload zones */}
          {!currentPhotoSrc && !camActive && (
            <div className="st-upload-choices" style={{ marginTop: 16 }}>
              <div className="st-upload-zone" onClick={() => fileInputRef.current?.click()}>
                <div>🖼️</div>
                <p><b>{activePhotoType === "front" ? "Front" : "Side"} photo upload</b> karein</p>
              </div>
              <div className="st-upload-zone" onClick={startCamera}>
                <div>📷</div>
                <p><b>Camera</b> se khinchein</p>
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) loadImageFile(f, activePhotoType); }} />

          {camActive && (
            <>
              <video ref={videoRef} className="st-video" autoPlay playsInline />
              <div className="st-cam-controls">
                <button className="st-btn" onClick={capturePhoto}>{activePhotoType === "front" ? "Front" : "Side"} photo khinchein</button>
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
                      <text x={sw / 2 + 16} y={ty + 4} fontSize={10} fill="#1B2A4A" fontFamily="IBM Plex Mono">head top</text>

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
                        {activePhotoType === "front" ? (autoDetected ? "front width" : "waist line") : (autoDetected ? "side depth" : "waist line")}
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
                            💳 credit card
                          </text>
                        </>
                      )}
                    </svg>
                  )}
                </div>
              </div>

              {/* Confidence indicator */}
              {(frontConfidence > 0 || sideConfidence > 0) && (
                <div className="st-confidence">
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Detection Confidence:</span>
                  <div className="st-confidence-bar">
                    <div 
                      className="st-confidence-fill" 
                      style={{ 
                        width: `${activePhotoType === "front" ? frontConfidence : sideConfidence}%`,
                        background: (activePhotoType === "front" ? frontConfidence : sideConfidence) >= 70 
                          ? "var(--sage)" 
                          : (activePhotoType === "front" ? frontConfidence : sideConfidence) >= 40 
                            ? "var(--brass)" 
                            : "var(--stitch)"
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {(activePhotoType === "front" ? frontConfidence : sideConfidence).toFixed(0)}%
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
                ? <>Lines auto-set ho gayi hain. <b>Brass line</b> waist par honi chahiye. Handles drag karke fine-tune karein.</>
                : <>Side photo ke liye <b>blue line</b> ko waist ki <b>depth</b> (aage-peeche) par align karein.</>
              }
              {calibrationMethod === "card" && activePhotoType === "front" && (
                <> <b>Blue card box</b> ko credit card par fit karein — isse exact scale milega.</>
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
                ➕ Side photo add karein (better accuracy)
              </button>
            )}
            
            {showConfirm && frontPhotoSrc && (
              <button className="st-btn" onClick={confirmWaist}>
                {sidePhotoSrc ? "Ellipse method se measure karein →" : "Waist confirm karein →"}
              </button>
            )}
            
            {currentPhotoSrc && (
              <button className="st-btn ghost" onClick={() => retake(activePhotoType)}>
                {activePhotoType === "front" ? "Front" : "Side"} photo change karein
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
                <p className="st-eyebrow">Recommended size</p>
                <div className="st-size-big">{finalSize}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", opacity: 0.75, marginBottom: 12 }}>
                  {measurementMethod === "ellipse" 
                    ? "Ramanujan Ellipse Formula (front + side)" 
                    : waistSize 
                      ? "Single photo method" 
                      : "BMI baseline (photo add karein)"}
                </div>
                <span className={`st-accuracy-badge ${getAccuracyLevel()}`}>
                  {getAccuracyLevel() === "high" && "🎯 High Accuracy"}
                  {getAccuracyLevel() === "medium" && "📐 Medium Accuracy"}
                  {getAccuracyLevel() === "low" && "📏 Basic Estimate"}
                </span>
              </div>

              <div className="st-result-grid" style={{ marginTop: 18 }}>
                <div className="st-result-card">
                  <label className="st-label">BMI baseline size</label>
                  <div className="val">{baselineSize}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Photo-based size</label>
                  <div className="val">{waistSize || "—"}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Waist circumference</label>
                  <div className="val">{waistCm ? waistCm.toFixed(1) + " cm" : "—"}</div>
                </div>
                <div className="st-result-card">
                  <label className="st-label">Method used</label>
                  <div className="val" style={{ fontSize: 14 }}>
                    {measurementMethod === "ellipse" ? "Ellipse (2 photos)" : "Single photo"}
                  </div>
                </div>
              </div>
              
              {/* Detailed measurements */}
              {(frontWidthCm || sideDepthCm) && (
                <div className="st-result-grid" style={{ marginTop: 12 }}>
                  <div className="st-result-card">
                    <label className="st-label">Front width (a)</label>
                    <div className="val">{frontWidthCm ? frontWidthCm.toFixed(1) + " cm" : "—"}</div>
                  </div>
                  <div className="st-result-card">
                    <label className="st-label">Side depth (b)</label>
                    <div className="val">{sideDepthCm ? sideDepthCm.toFixed(1) + " cm" : "—"}</div>
                  </div>
                </div>
              )}

              {flagType && (
                <div className={`st-flag ${flagType}`}>{flagText}</div>
              )}
              
              {/* Measurement methodology explanation */}
              {measurementMethod === "ellipse" && (
                <div className="st-tips" style={{ marginTop: 16 }}>
                  <h4>🧮 Ramanujan Ellipse Formula</h4>
                  <ul>
                    <li>Front photo se waist ki <b>width (a)</b> = {frontWidthCm?.toFixed(1)} cm</li>
                    <li>Side photo se waist ki <b>depth (b)</b> = {sideDepthCm?.toFixed(1)} cm</li>
                    <li>Ellipse circumference ≈ <b>π(a+b)(1 + 3h/(10+√(4-3h)))</b> where h = (a-b)²/(a+b)²</li>
                    <li>Result: <b>{waistCm?.toFixed(1)} cm</b> — tape measure se ~2-3cm difference ho sakta hai</li>
                  </ul>
                </div>
              )}

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
          <b>🎯 Accuracy Improvements in v2.0:</b><br />
          • <b>THUNDER model</b> — MoveNet ka high-accuracy variant (Lightning se 15-20% better)<br />
          • <b>Ellipse method</b> — Front + side photos se Ramanujan formula use karke real circumference nikalte hain (flat multiplier nahi)<br />
          • <b>Credit card calibration</b> — Reference object se pixel-to-cm ratio accurately calculate hota hai<br />
          • <b>Confidence scoring</b> — Keypoint visibility se accuracy estimate dikhate hain<br /><br />
          <b>Privacy:</b> Sab kuch browser mein hota hai — koi photo server par nahi jaati.
        </footer>

      </div>
    </>
  );
}
