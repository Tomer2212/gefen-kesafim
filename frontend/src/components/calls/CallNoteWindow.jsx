import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useCallNoteWindows } from "../../context/CallNoteWindowsContext";

const MIN_WIDTH = 380;
const MIN_HEIGHT = 260;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 420;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;

function TranscriptBody({ callId }) {
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`/voicenter/calls/${callId}/transcript`);
        const url = res.data?.url;
        if (!url) throw new Error("no url");
        const fileRes = await axios.get(url);
        if (!cancelled) setTranscript(Array.isArray(fileRes.data) ? fileRes.data : []);
      } catch {
        if (!cancelled) setError("לא ניתן היה לטעון את התמלול כרגע");
      }
    })();
    return () => { cancelled = true; };
  }, [callId]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!transcript) return (
    <div role="status" aria-label="טוען תמלול" className="flex justify-center py-4">
      <div aria-hidden="true" className="spinner w-6 h-6" />
    </div>
  );
  if (transcript.length === 0) return <p className="text-sm text-slate-400">אין תמלול זמין לשיחה זו.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {transcript.map((line, i) => (
        <div key={i} className="text-sm leading-relaxed">
          <span className="font-semibold text-slate-600">{line.speaker === "Speaker0" ? "נציג" : "צד שני"}: </span>
          <span className="text-slate-700">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

// Renders every open call-note window independently, same lifecycle model as
// CompareResultsWindow: closing/minimizing one never affects the others.
export default function CallNoteWindows() {
  const { windows } = useCallNoteWindows();
  const minimizedIds = windows.filter(w => w.minimized).map(w => w.id);

  return (
    <>
      {windows.map(w => (
        <CallNoteWindowItem
          key={w.id}
          id={w.id}
          data={w.data}
          minimized={w.minimized}
          minimizedOrder={minimizedIds.indexOf(w.id)}
        />
      ))}
    </>
  );
}

function CallNoteWindowItem({ id, data, minimized, minimizedOrder }) {
  const { closeCallNote, setMinimized } = useCallNoteWindows();
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    if (pos === null) {
      const cascade = (id % CASCADE_CYCLE) * CASCADE_STEP;
      const x = Math.max(16, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2) + cascade);
      const y = Math.max(16, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 3) + cascade);
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

  if (!pos) return null;

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(id, false)}
        dir="rtl"
        aria-label={`שחזור חלון ${data.windowLabel} — ${data.title}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polyline points="9 3 5 3 5 7"/>
          <polyline points="15 3 19 3 19 7"/>
          <polyline points="9 21 5 21 5 17"/>
          <polyline points="15 21 19 21 19 17"/>
        </svg>
        <span className="truncate">{data.windowLabel} — {data.title}</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={`${data.windowLabel} — ${data.title}`}
      dir="rtl"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60 }}
      className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      <div
        onMouseDown={startDrag}
        className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0"
        style={{ background: "rgba(241,245,249,0.97)", gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => closeCallNote(id)} aria-label="סגור חלון" className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => setMinimized(id, true)} aria-label="מזער חלון" className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19"/>
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800 truncate text-center">
          {data.windowLabel} — {data.title}
        </div>
        <div aria-hidden="true" />
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {data.kind === "transcript" ? <TranscriptBody callId={data.callId} /> : (
          <p className="text-sm text-slate-700 leading-relaxed">{data.text || "אין סיכום זמין לשיחה זו."}</p>
        )}
      </div>

      <div
        onMouseDown={startResize}
        aria-hidden="true"
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        style={{ touchAction: "none" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
