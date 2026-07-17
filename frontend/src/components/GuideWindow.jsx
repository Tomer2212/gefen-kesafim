import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { useGuide } from "../context/GuideContext";
import { GUIDE_CONTENT } from "./guides/guideContent";

const MIN_WIDTH = 380;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 640;
const PILL_WIDTH = 220;
const PILL_GAP = 8;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;

export default function GuideWindow() {
  const ctx = useGuide();
  if (!ctx) return null;
  const { guideWindows } = ctx;
  const minimizedIds = guideWindows.filter(w => w.minimized).map(w => w.id);
  return (
    <>
      {guideWindows.map(w => (
        <GuideWindowItem key={w.id} id={w.id} guideKey={w.guideKey} minimized={w.minimized}
          minimizedOrder={minimizedIds.indexOf(w.id)} />
      ))}
    </>
  );
}

function GuideWindowItem({ id, guideKey, minimized, minimizedOrder }) {
  const { closeGuide, setMinimized } = useGuide();
  const navigate = useNavigate();
  const guide = GUIDE_CONTENT[guideKey];

  const [pos, setPos] = useState(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [verifyState, setVerifyState] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const windowRef = useRef(null);
  const captureRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (pos === null) {
      const cascade = (id % CASCADE_CYCLE) * CASCADE_STEP;
      const x = Math.max(16, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2) + cascade);
      const y = Math.max(16, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 4) + cascade);
      setPos({ x, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(e) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  }
  function onDrag(e) {
    const d = dragRef.current;
    if (!d) return;
    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 60;
    setPos({
      x: Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), maxX),
      y: Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), maxY),
    });
  }
  function stopDrag() {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
  }

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }
  function onResize(e) {
    const r = resizeRef.current;
    if (!r) return;
    setSize({
      width: Math.max(MIN_WIDTH, r.origW + (e.clientX - r.startX)),
      height: Math.max(MIN_HEIGHT, r.origH + (e.clientY - r.startY)),
    });
  }
  function stopResize() {
    resizeRef.current = null;
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  async function handleVerify() {
    if (!guide?.verifyEndpoint) return;
    setVerifyState("checking");
    try {
      const res = await axios.get(guide.verifyEndpoint);
      setVerifyState(guide.verifySuccessCheck?.(res.data) ? "ok" : "fail");
    } catch {
      setVerifyState("fail");
    }
  }

  async function handleDownloadPdf() {
    if (downloadingPdf || !windowRef.current || !captureRef.current || !bodyRef.current) return;
    setDownloadingPdf(true);
    setPdfError(false);

    // Same technique as CompareResultsWindow: temporarily unclip the fixed-size,
    // overflow-hidden window and its scrollable body so html2canvas captures the
    // whole guide (all steps + images), not just whatever is currently scrolled into view.
    const win = windowRef.current;
    const body = bodyRef.current;
    const prevWinHeight = win.style.height;
    const prevWinOverflow = win.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    const prevBodyMaxHeight = body.style.maxHeight;
    win.style.height = "auto";
    win.style.overflow = "visible";
    body.style.overflow = "visible";
    body.style.height = "auto";
    body.style.maxHeight = "none";
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save("הדרכת_חיבור.pdf");
    } catch (err) {
      console.error("Guide PDF export failed:", err);
      setPdfError(true);
      setTimeout(() => setPdfError(false), 3000);
    } finally {
      win.style.height = prevWinHeight;
      win.style.overflow = prevWinOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
      body.style.maxHeight = prevBodyMaxHeight;
      setDownloadingPdf(false);
    }
  }

  if (!guide || !pos) return null;

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(id, false)}
        dir="rtl"
        aria-label={`שחזור חלון הדרכה — ${guide.title}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span className="truncate">הדרכת חיבור</span>
      </button>
    );
  }

  return (
    <div
      ref={windowRef}
      role="region"
      aria-label={guide.title}
      dir="rtl"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60 }}
      className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header — draggable */}
      <div
        onMouseDown={startDrag}
        className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0"
        style={{ background: "rgba(241,245,249,0.97)", gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="flex items-center gap-2.5" data-html2canvas-ignore="true">
          <button type="button" onClick={() => closeGuide(id)} aria-label="סגור חלון הדרכה"
            className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => setMinimized(id, true)} aria-label="מזער חלון הדרכה"
            className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19" />
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800 truncate text-center">{guide.title}</div>
        <div aria-hidden="true" />
      </div>

      <div ref={captureRef} className="flex flex-col flex-1 min-h-0">
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4 flex flex-col gap-4 flex-1 min-h-0">
          <p className="text-sm text-slate-600 leading-relaxed">{guide.intro}</p>
          <ol className="flex flex-col gap-10">
            {guide.steps.map((s, i) => (
              <li key={i} className="text-sm">
                <div className="font-semibold text-slate-800 mb-0.5">{s.title}</div>
                <div className="text-slate-600 leading-relaxed whitespace-pre-line">{s.body}</div>
                {s.image && (
                  <img src={s.image} alt={s.title} className="mt-2 w-full rounded-xl border border-slate-200 shadow-sm" />
                )}
              </li>
            ))}
          </ol>

          {guide.verifyEndpoint && (
            <div className="border-t border-slate-100 pt-3" data-html2canvas-ignore="true">
              <button type="button" onClick={handleVerify}
                className="w-full py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-sm transition-colors">
                {verifyState === "checking" ? "בודק..." : "בדוק חיבור עכשיו"}
              </button>
              {verifyState === "ok" && (
                <p role="status" className="text-sm text-green-700 mt-2 text-center">✓ החיבור פעיל ומחובר בהצלחה</p>
              )}
              {verifyState === "fail" && (
                <p role="alert" className="text-sm text-red-600 mt-2 text-center">החיבור עדיין לא זוהה. עברו שוב על השלבים, או פנו לתמיכה.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-slate-100 flex-shrink-0" data-html2canvas-ignore="true">
          <button type="button" onClick={handleDownloadPdf} disabled={downloadingPdf}
            className="flex-1 py-2 rounded-xl font-medium text-sm transition-colors disabled:opacity-70"
            style={{ background: pdfError ? "#fee2e2" : "#f1f5f9", color: pdfError ? "#dc2626" : "#334155" }}>
            {downloadingPdf ? "מכין PDF..." : pdfError ? "שגיאה, נסה שוב" : "הורד PDF"}
          </button>
          <button type="button" onClick={() => navigate("/contact")}
            className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">
            צור קשר
          </button>
        </div>
      </div>

      {/* Resize handle */}
      <div onMouseDown={startResize} aria-hidden="true" data-html2canvas-ignore="true"
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" style={{ touchAction: "none" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
