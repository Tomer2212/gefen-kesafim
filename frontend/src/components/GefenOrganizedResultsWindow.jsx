import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useGefenOrganizedResults } from "../context/GefenOrganizedResultsContext";

export const MISMATCH_COLUMNS = ["שם מוסד", "סמל מוסד", "בעלות", 'מחיר כולל מע"מ', "גובה הזמנה בפועל", "פער"];
export const MISMATCH_AMOUNT_COLUMNS = new Set(['מחיר כולל מע"מ', "גובה הזמנה בפועל", "פער"]);

export function formatAmount(v) {
  return v === null || v === undefined || v === "" ? "" : Math.round(Number(v)).toLocaleString("he-IL");
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const timePart = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${datePart} - ${timePart}`;
}

// Generated server-side (openpyxl) so the sheet is genuinely RTL — the client-side
// xlsx library can only read the RTL sheet-view flag, not write it.
async function exportMismatchRows(exportRows, academicYear) {
  const res = await axios.post(
    "/schools/collection/gefen-organized-mismatches-export",
    { rows: exportRows, academic_year: academicYear },
    { responseType: "blob" }
  );
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = `gefen-organized-mismatches-${academicYear}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function DownloadExcelButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
      style={{ background: "#16a34a" }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#15803d"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#16a34a"; }}
    >
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      הורד EXCEL
    </button>
  );
}

const RESULTS_MIN_WIDTH = 460;
const RESULTS_MIN_HEIGHT = 320;
const RESULTS_DEFAULT_WIDTH = 720;
const RESULTS_DEFAULT_HEIGHT = 480;
const RESULTS_PILL_WIDTH = 260;

// Persistent across route changes — mounted once in App.jsx outside <Outlet />.
// Renders nothing until a check has been opened via useGefenOrganizedResults().openResults().
export default function GefenOrganizedResultsWindow() {
  const { result, closeResults, setMinimized } = useGefenOrganizedResults();
  if (!result) return null;
  return <GefenOrganizedResultsWindowInner key={result.id} data={result} onClose={closeResults} onSetMinimized={setMinimized} />;
}

function GefenOrganizedResultsWindowInner({ data, onClose, onSetMinimized }) {
  const { displayRows, exportRows, checkedAt, academicYear, minimized } = data;
  const [exporting, setExporting] = useState(false);
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState({ width: RESULTS_DEFAULT_WIDTH, height: RESULTS_DEFAULT_HEIGHT });
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const windowRef = useRef(null);
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  async function handleExport() {
    setExporting(true);
    try {
      await exportMismatchRows(exportRows, academicYear);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (pos === null) {
      const x = Math.max(16, Math.round((window.innerWidth - RESULTS_DEFAULT_WIDTH) / 2));
      const y = Math.max(16, Math.round((window.innerHeight - RESULTS_DEFAULT_HEIGHT) / 3));
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
      width: Math.max(RESULTS_MIN_WIDTH, r.origW + (e.clientX - r.startX)),
      height: Math.max(RESULTS_MIN_HEIGHT, r.origH + (e.clientY - r.startY)),
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

  const title = `תוצאות בדיקת "גפן מסודר" — אי-התאמות${checkedAt ? ` - ${formatDateTime(checkedAt)}` : ""}`;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => onSetMinimized(false)}
        dir="rtl"
        aria-label="שחזור חלון תוצאות בדיקת גפן מסודר"
        style={{ position: "fixed", left: 16, bottom: 16, zIndex: 60, width: RESULTS_PILL_WIDTH, flexShrink: 0 }}
        className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polyline points="9 3 5 3 5 7" />
          <polyline points="15 3 19 3 19 7" />
          <polyline points="9 21 5 21 5 17" />
          <polyline points="15 21 19 21 19 17" />
        </svg>
        <span className="truncate">תוצאות בדיקת "גפן מסודר"</span>
      </button>
    );
  }

  return (
    <div
      ref={windowRef}
      role="region"
      aria-label={title}
      dir="rtl"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60 }}
      className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        className="flex flex-col flex-1 min-h-0"
      >
        <div
          onMouseDown={startDrag}
          className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0 gap-2"
          style={{ background: "rgba(241,245,249,0.97)", gridTemplateColumns: "auto 1fr auto" }}
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="סגור חלונית תוצאות"
              className="text-slate-400 hover:text-slate-700 transition-colors"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => onSetMinimized(true)}
              aria-label="מזער חלונית תוצאות"
              className="text-slate-400 hover:text-slate-700 transition-colors"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="19" x2="19" y2="19" />
              </svg>
            </button>
          </div>
          <div className="text-sm font-bold text-slate-800 truncate text-right">{title}</div>
          <div onMouseDown={e => e.stopPropagation()}>
            <DownloadExcelButton onClick={handleExport} disabled={displayRows.length === 0 || exporting} />
          </div>
        </div>

        <div className="overflow-auto flex-1">
          {displayRows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center p-8">אין אי-התאמות</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200" style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)" }}>
                  {MISMATCH_COLUMNS.map(col => (
                    <th key={col} scope="col" className="text-right px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    {MISMATCH_COLUMNS.map(col => (
                      <td key={col} className="px-4 py-2 text-slate-600 whitespace-nowrap">
                        {MISMATCH_AMOUNT_COLUMNS.has(col) ? formatAmount(row[col]) : row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
