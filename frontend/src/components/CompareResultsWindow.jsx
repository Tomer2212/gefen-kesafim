import { useEffect, useRef, useState } from "react";
import { useCompareChecks } from "../context/CompareChecksContext";

const MIN_WIDTH = 460;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 620;
const DEFAULT_HEIGHT = 560;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6; // wrap the offset so windows don't drift off-screen

function fmtILS(v) {
  try { return Math.round(Number(v)).toLocaleString("he-IL"); } catch { return String(v); }
}

function MengonimSection({ mengonim }) {
  if (!mengonim || mengonim.status === "loading") {
    return (
      <div role="status" aria-label="טוען נתוני מענים" className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
        <div aria-hidden="true" className="spinner w-4 h-4" />
        טוען נתוני מענים...
      </div>
    );
  }
  if (mengonim.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
        אירעה שגיאה בטעינת נתוני המענים. נסה להריץ את ההשוואה שוב.
      </p>
    );
  }

  const missing = mengonim.missing || {};
  if (missing.newer || missing.older) {
    const sides = [missing.newer && "החדשה", missing.older && "הישנה"].filter(Boolean).join(" וגם ");
    return (
      <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-center">
        {`לא נמצא קובץ תכנון שמור עבור הבדיקה ${sides} — ייתכן שהקובץ נמחק (מעל 24 חודשים) או שלא הועלה קובץ תכנון באותה בדיקה.`}
      </p>
    );
  }

  const added = mengonim.added || [];
  const removed = mengonim.removed || [];
  const updated = mengonim.updated || [];

  if (added.length === 0 && removed.length === 0 && updated.length === 0) {
    return <p className="text-sm text-slate-400 text-center italic">אין שינויים במענים עבור תקציב זה.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {added.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-emerald-700 mb-1.5">מענים חדשים</h4>
          <ul className="flex flex-col gap-1.5">
            {added.map(p => (
              <li key={p.key} className="text-sm text-slate-700 bg-emerald-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span>{p.name}{p.mispnum !== "אין" && <span className="text-slate-400"> (מספר מענה: {p.mispnum})</span>}</span>
                <span className="font-semibold whitespace-nowrap">{fmtILS(p.tikhnun)} ש"ח</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {updated.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-blue-700 mb-1.5">מענים שעודכנו</h4>
          <ul className="flex flex-col gap-1.5">
            {updated.map(p => (
              <li key={p.key} className="text-sm text-slate-700 bg-blue-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span>{p.name}{p.mispnum !== "אין" && <span className="text-slate-400"> (מספר מענה: {p.mispnum})</span>}</span>
                <span className="font-semibold whitespace-nowrap">{fmtILS(p.oldAmount)} ← {fmtILS(p.newAmount)} ש"ח</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-red-700 mb-1.5">מענים שהוסרו</h4>
          <ul className="flex flex-col gap-1.5">
            {removed.map(p => (
              <li key={p.key} className="text-sm text-slate-700 bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span>{p.name}{p.mispnum !== "אין" && <span className="text-slate-400"> (מספר מענה: {p.mispnum})</span>}</span>
                <span className="font-semibold whitespace-nowrap">{fmtILS(p.tikhnun)} ש"ח</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const PILL_STYLE = (active) => ({
  fontWeight: active ? 700 : 500,
  fontSize: "12px",
  padding: "4px 14px",
  borderRadius: "20px",
  border: `1.5px solid ${active ? "#0070F3" : "#e2e8f0"}`,
  background: active ? "#0070F3" : "transparent",
  color: active ? "white" : "#64748b",
  cursor: "pointer",
  transition: "all 0.15s",
});

// Renders every open comparison window independently — closing or minimizing
// one never affects the others. Minimized windows are laid out side-by-side
// as small pills anchored to the bottom-left corner.
export default function CompareResultsWindow() {
  const { compareWindows } = useCompareChecks();
  const minimizedIds = compareWindows.filter(w => w.minimized).map(w => w.id);

  return (
    <>
      {compareWindows.map(w => (
        <CompareWindowItem
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

function CompareWindowItem({ id, data, minimized, minimizedOrder }) {
  const { closeCompare, setMinimized } = useCompareChecks();
  const [pos, setPos] = useState(null); // { x, y }
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [activeBudgetIdx, setActiveBudgetIdx] = useState(0);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  // Center the window once, the first time it's opened — cascaded by `id` (a
  // stable, ever-increasing counter) so multiple simultaneously-open windows
  // don't spawn exactly on top of each other.
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
        aria-label={`שחזור חלון השוואה בין בדיקות${data.schoolName ? " — " + data.schoolName : ""}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polyline points="9 3 5 3 5 7"/>
          <polyline points="15 3 19 3 19 7"/>
          <polyline points="9 21 5 21 5 17"/>
          <polyline points="15 21 19 21 19 17"/>
        </svg>
        <span className="truncate">
          השוואה בין בדיקות
          {data.schoolName && <span className="font-normal text-slate-500"> — {data.schoolName}</span>}
        </span>
      </button>
    );
  }

  const budgets = data.budgets || [];
  const isMultiBudget = budgets.length > 1;
  const safeIdx = Math.min(activeBudgetIdx, Math.max(0, budgets.length - 1));
  const activeBudget = budgets[safeIdx];

  return (
    <div
      role="region"
      aria-label="חלון השוואה בין בדיקות"
      dir="rtl"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex: 60,
      }}
      className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header — draggable */}
      <div
        onMouseDown={startDrag}
        className="flex items-center justify-between px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0"
        style={{ background: "rgba(241,245,249,0.97)" }}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => closeCompare(id)}
            aria-label="סגור חלון השוואה"
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button
            type="button"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setMinimized(id, true)}
            aria-label="מזער חלון השוואה"
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19"/>
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800 truncate">
          השוואה בין בדיקות
          {data.schoolName && <span className="font-normal text-slate-500"> — {data.schoolName}</span>}
        </div>
      </div>

      {/* Sub-header: which two checks are being compared */}
      <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-center gap-3 text-xs text-slate-500 flex-shrink-0">
        <span className="font-semibold text-slate-700">{data.newerLabel}</span>
        <span aria-hidden="true">↔</span>
        <span className="font-semibold text-slate-700">{data.olderLabel}</span>
      </div>

      {/* Budget pills */}
      {isMultiBudget && (
        <div className="flex gap-2 flex-wrap px-4 pt-3 flex-shrink-0">
          {budgets.map((b, i) => (
            <button
              key={b.name}
              type="button"
              onClick={() => setActiveBudgetIdx(i)}
              style={PILL_STYLE(safeIdx === i)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {!activeBudget ? (
          <p className="text-sm text-slate-400 text-center">אין נתונים להשוואה</p>
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="text-sm font-bold text-slate-800 text-center mb-3">כללי</h3>
              {activeBudget.missingSide ? (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-center">
                  {`תקציב "${activeBudget.name}" לא נמצא ב${activeBudget.missingSide === "newer" ? "בדיקה החדשה" : "בדיקה הישנה"}, לכן לא ניתן להציג השוואה עבורו.`}
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {activeBudget.general.filter(Boolean).map((line, i) => (
                    <li key={i} className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-800 text-center mb-3">מענים</h3>
              <MengonimSection mengonim={activeBudget.mengonim} />
            </section>
          </div>
        )}
      </div>

      {/* Resize handle */}
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
