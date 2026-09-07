import { useEffect, useRef, useState, useCallback } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

// Interactive circular crop for the profile picture.
// The user pans (drag / arrow keys) and zooms (slider) the source image inside a
// circular frame; on confirm the framed square region is drawn to a 512×512
// canvas and returned as a JPEG blob (q0.85 ≈ 40–80 KB).

const VIEW = 288;      // on-screen crop viewport (px)
const OUT = 512;       // exported image size (px)
const MAX_ZOOM_FACTOR = 3;
const NUDGE = 12;      // px per arrow-key press

export default function AvatarCropModal({ file, onCancel, onConfirm }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [img, setImg] = useState(null);          // ImageBitmap | HTMLImageElement
  const [dims, setDims] = useState(null);        // { w, h }
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dragRef = useRef(null);

  // Decode the picked file (EXIF-oriented where supported).
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    async function load() {
      try {
        let bitmap = null;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
          bitmap = await new Promise((resolve, reject) => {
            const el = new Image();
            objectUrl = URL.createObjectURL(file);
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = objectUrl;
          });
        }
        if (cancelled) return;
        const w = bitmap.width || bitmap.naturalWidth;
        const h = bitmap.height || bitmap.naturalHeight;
        const ms = Math.max(VIEW / w, VIEW / h);
        setImg(bitmap);
        setDims({ w, h });
        setMinScale(ms);
        setScale(ms);
        setOffset({ x: 0, y: 0 });
      } catch {
        if (!cancelled) setError("לא ניתן לטעון את התמונה. נסה קובץ אחר.");
      }
    }
    load();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);

  const clamp = useCallback((o, s) => {
    if (!dims) return o;
    const maxX = Math.max(0, (dims.w * s - VIEW) / 2);
    const maxY = Math.max(0, (dims.h * s - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, o.x)),
      y: Math.min(maxY, Math.max(-maxY, o.y)),
    };
  }, [dims]);

  function onZoom(e) {
    const s = Number(e.target.value);
    setScale(s);
    setOffset(o => clamp(o, s));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset };
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const { startX, startY, base } = dragRef.current;
    setOffset(clamp({ x: base.x + (e.clientX - startX), y: base.y + (e.clientY - startY) }, scale));
  }
  function onPointerUp() { dragRef.current = null; }

  function onViewportKeyDown(e) {
    const map = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    setOffset(o => clamp({ x: o.x + d[0], y: o.y + d[1] }, scale));
  }

  async function handleConfirm() {
    if (!img || !dims || busy) return;
    setBusy(true);
    try {
      const left = VIEW / 2 - (dims.w * scale) / 2 + offset.x;
      const top = VIEW / 2 - (dims.h * scale) / 2 + offset.y;
      const sx = (0 - left) / scale;
      const sy = (0 - top) / scale;
      const sSize = VIEW / scale;

      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);

      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob) throw new Error("toBlob failed");
      await onConfirm(blob);
    } catch {
      setError("שמירת התמונה נכשלה. נסה שוב.");
      setBusy(false);
    }
  }

  // Position the image element inside the viewport.
  const imgStyle = dims ? {
    position: "absolute",
    width: dims.w * scale,
    height: dims.h * scale,
    left: VIEW / 2 - (dims.w * scale) / 2 + offset.x,
    top: VIEW / 2 - (dims.h * scale) / 2 + offset.y,
    userSelect: "none",
    pointerEvents: "none",
  } : {};

  const previewSrc = img && !(img instanceof HTMLImageElement) ? null : img?.src;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 id="avatar-crop-title" className="text-base font-semibold text-slate-800">חיתוך תמונת פרופיל</h2>
          <button onClick={onCancel} aria-label="סגור"
            className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col items-center gap-4">
          {error && <p role="alert" className="text-sm text-red-600 self-stretch text-center">{error}</p>}

          <div
            role="application"
            aria-label="גרור למיקום התמונה, מקשי החצים להזזה עדינה"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onViewportKeyDown}
            className="relative overflow-hidden bg-slate-100 rounded-lg cursor-move focus:outline-none focus:ring-2 focus:ring-blue-300 touch-none"
            style={{ width: VIEW, height: VIEW }}
          >
            {img && (
              previewSrc
                ? <img src={previewSrc} alt="" style={imgStyle} draggable={false} />
                : <BitmapCanvas bitmap={img} style={imgStyle} />
            )}
            {/* circular mask */}
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", pointerEvents: "none",
            }} />
          </div>

          <label className="flex items-center gap-3 self-stretch">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">זום</span>
            <input
              type="range"
              aria-label="זום"
              min={minScale}
              max={minScale * MAX_ZOOM_FACTOR}
              step={minScale / 100}
              value={scale}
              onChange={onZoom}
              disabled={!img || busy}
              className="flex-1"
            />
          </label>
        </div>

        <div className="px-6 pb-5 flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={!img || busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-60"
            style={{ background: "#0070F3" }}
          >
            {busy ? "שומר..." : "שמור תמונה"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// Renders an ImageBitmap into a <canvas> sized to the requested style (used when
// createImageBitmap succeeded — ImageBitmap can't be shown with <img>).
function BitmapCanvas({ bitmap, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !bitmap) return;
    const w = Math.round(parseFloat(style.width));
    const h = Math.round(parseFloat(style.height));
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
  }, [bitmap, style.width, style.height]);
  return <canvas ref={ref} style={style} />;
}
