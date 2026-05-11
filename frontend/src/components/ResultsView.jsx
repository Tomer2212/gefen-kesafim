import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const TIKKON_CODES   = new Set([48,54,55,58,59,61,62,66,76,87,91,92,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,127,136,137,138,139,140,141,142,148,150,152,154,156,158,160,162,164,165,167,169]);
const BEINAYIM_CODES = new Set([43,44,45,46,47,49,50,51,52,53,56,57,60,63,64,65,67,68,69,70,71,72,73,74,75,77,78,80,81,83,84,85,88,89,90,126,128,129,130,131,132,133,134,135,147,151,153,155,161,166,168]);

function splitByDivision(rows) {
  const tikkon = [], beinayim = [];
  for (const r of rows) {
    const code = Number(r["קוד דיווח"]);
    if (TIKKON_CODES.has(code)) tikkon.push(r);
    else beinayim.push(r);  // BEINAYIM, SHARED, and unknown all go to beinayim
  }
  return { tikkon, beinayim };
}

const CODE_COL_STYLE = { width: "48px", minWidth: "48px", maxWidth: "48px", padding: "12px 6px", textAlign: "center", whiteSpace: "normal", wordBreak: "break-word" };

const UNIFIED_COLS = [
  { key: "קוד דיווח",   label: "קוד",          thStyle: CODE_COL_STYLE, tdStyle: { ...CODE_COL_STYLE, padding: "10px 6px" } },
  { key: "שם ספק",      label: "שם ספק"       },
  { key: "מספר אסמכתה", label: "מספר אסמכתא" },
  { key: "תאריך",       label: "תאריך",        noWrap: true },
  { key: "סכום",        label: "סכום פריט"    },
  { key: "תיאור",       label: "תיאור"        },
];

const REJECTED_COLS = [
  { key: "קוד דיווח",   label: "קוד",          thStyle: CODE_COL_STYLE, tdStyle: { ...CODE_COL_STYLE, padding: "10px 6px" } },
  { key: "שם ספק",      label: "שם ספק"       },
  { key: "מספר אסמכתה", label: "מספר אסמכתא" },
  { key: "תאריך",       label: "תאריך",        noWrap: true },
  { key: "סכום",        label: "סכום פריט"    },
  { key: "סיבת הדחייה", label: "סיבת הדחייה" },
];

const STAGE_LABELS = {
  tikkon:   "תיכון",
  beinayim: "יסודי/חטיבה",
  both:     "תיכון + יסודי/חטיבה",
};

const DIVISION_LABELS = {
  tikkon:   "חטיבה עליונה בלבד",
  beinayim: "יסודי/חטיבה בלבד",
  both:     "יסודי/חטיבה + חטיבה עליונה",
};

// ---------------------------------------------------------------------------
// Tabs configuration
// ---------------------------------------------------------------------------

const TAB_IDS = ["hashva", "sikar", "rejected", "nopdf", "partial", "yozma", "kvua"];
const TAB_LABELS_MAP = {
  hashva:   "השוואה גפן-כספים",
  sikar:    "סקירה",
  rejected: "אסמכתאות שנדחו",
  nopdf:    "ללא PDF",
  partial:  "דיווח חסר",
  yozma:    "יוזמות וצרכים",
  kvua:     "תקציב קבוע",
};
// tabs disabled when no tikhnun data
const TIKHNUN_ONLY_TABS = ["kvua", "partial", "yozma"];
// tabs disabled when tikhnun-only (no gefen execution data)
const GEFEN_ONLY_TABS = ["rejected", "nopdf", "partial"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v) {
  if (v == null) return "";
  try { return Math.round(Number(v)).toLocaleString("he-IL"); } catch { return String(v); }
}

function fmtPct(v, decimals = 0) {
  if (v == null) return "";
  const pct = Number(v) * 100;
  return pct.toFixed(decimals) + "%";
}

function sumRowsAmount(rows) {
  return rows.reduce((s, r) => {
    const v = parseFloat((r["סכום"] || "0").replace(/,/g, "")) || 0;
    return s + v;
  }, 0);
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function InfoGrid({ rows }) {
  return (
    <dl className="text-sm leading-relaxed" style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: "6px", columnGap: "10px" }}>
      {rows.filter(r => r.value != null).map(({ label, value, highlight, danger }) => (
        <>
          <dt key={label + "_l"} className="text-slate-400 text-right whitespace-nowrap">{label}:</dt>
          <dd key={label + "_v"} style={danger ? { fontWeight: 700, color: "#dc2626" } : highlight ? { fontWeight: 700, color: "#334155" } : { color: "#475569" }}>{value}</dd>
        </>
      ))}
    </dl>
  );
}

function SummaryBlock({ title, children, index = 0 }) {
  return (
    <div className="anim-fade-up glass-card-dark rounded-2xl overflow-hidden" style={{ animationDelay: `${index * 0.06}s` }}>
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-xs font-700 text-slate-500 tracking-wide" style={{ fontWeight: 700 }}>{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function CountBadge({ count, totalAmount }) {
  const isZero = count === 0;
  return (
    <div className="flex items-center gap-3">
      {/* Amount — rightmost in RTL (first in JSX) */}
      {!isZero && totalAmount != null && (
        <span className="flex items-center gap-1 text-xs tabular-nums font-700" style={{ fontWeight: 700, color: "#1e293b" }}>
          <span className="text-slate-400 font-400" style={{ fontWeight: 400 }}>סה"כ</span>
          {Math.round(totalAmount).toLocaleString("he-IL")}
          <span style={{ color: "#64748b", fontWeight: 400 }}>₪</span>
        </span>
      )}
      {/* Count badge — leftmost in RTL (second in JSX) */}
      <span
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-700"
        style={{ fontWeight: 700, background: isZero ? "#dcfce7" : "#fee2e2", color: isZero ? "#15803d" : "#dc2626" }}
      >
        {isZero ? "אין פערים" : `${count} רשומות`}
      </span>
    </div>
  );
}

function ResultTable({ title, rows, columns, index = 0, headerGradient, showSum }) {
  const thBg = headerGradient ?? "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)";
  const isEmpty = rows.length === 0;
  const totalAmount = showSum ? sumRowsAmount(rows) : null;
  return (
    <div className="anim-fade-up glass-card-dark rounded-2xl overflow-hidden" style={{ animationDelay: `${index * 0.1}s` }}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-700 text-slate-700 text-right" style={{ fontWeight: 700 }}>{title}</h3>
        <CountBadge count={rows.length} totalAmount={totalAmount} />
      </div>
      {isEmpty ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
            <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין פערים</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm border-collapse" dir="rtl">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}
                    scope="col"
                    className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                    style={{ fontWeight: 700, background: thBg, letterSpacing: "0.02em", ...col.thStyle }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-blue-50/40 transition-colors"
                  style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-2.5 text-right text-slate-700 align-middle"
                      style={col.tdStyle}>
                      <span className="block text-xs" style={{ wordBreak: col.noWrap ? "normal" : "break-word", whiteSpace: col.noWrap ? "nowrap" : "normal" }}>
                        {row[col.key] || <span className="text-slate-300">—</span>}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GefenOnlyNotice({ title, index }) {
  return (
    <div className="anim-fade-up glass-card-dark rounded-2xl overflow-hidden" style={{ animationDelay: `${index * 0.1}s` }}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-700 text-slate-700 text-right" style={{ fontWeight: 700 }}>{title}</h3>
      </div>
      <div className="flex items-center justify-center gap-2 py-10">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" fill="#d97706" fillOpacity="0.15"/>
          <path d="M8 5v3.5M8 10.5v.5" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <span className="text-sm font-700 text-amber-700" style={{ fontWeight: 700 }}>
          לא בוצעה בדיקה — לא הועלה קובץ מתוכנת הכספים
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({ activeTab, hasTikhnun, tikhnunOnly, getTabIssues, onTabClick }) {
  return (
    <div
      className="flex flex-nowrap gap-0.5"
      style={{ direction: "rtl", borderBottom: "2px solid rgba(226,232,240,0.8)" }}
    >
      {TAB_IDS.map(tab => {
        const disabled =
          (TIKHNUN_ONLY_TABS.includes(tab) && !hasTikhnun) ||
          (GEFEN_ONLY_TABS.includes(tab) && tikhnunOnly);
        const isActive = activeTab === tab;
        const hasIssues = !disabled && getTabIssues(tab);

        return (
          <button
            key={tab}
            onClick={() => !disabled && onTabClick(tab)}
            disabled={disabled}
            style={{
              fontWeight: isActive ? 700 : 500,
              fontSize: "12px",
              padding: "7px 8px",
              borderRadius: "8px 8px 0 0",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
              background: isActive ? "white" : "transparent",
              color: disabled ? "#cbd5e1" : isActive ? "#0f172a" : "#64748b",
              borderBottom: isActive ? "2px solid #0070F3" : "2px solid transparent",
              marginBottom: "-2px",
            }}
          >
            {TAB_LABELS_MAP[tab]}
            {hasIssues && (
              <span
                style={{
                  marginRight: "5px",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#dc2626",
                  display: "inline-block",
                  verticalAlign: "middle",
                  marginBottom: "2px",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Download selection modal
// ---------------------------------------------------------------------------

function DownloadSelectModal({ activeTab, availableTabs, onConfirm, onCancel }) {
  const otherTabs = availableTabs.filter(t => t !== activeTab);
  const allTabs = [activeTab, ...otherTabs];
  const [checked, setChecked] = useState(new Set([activeTab]));
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  function toggle(tab) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(tab)) { next.delete(tab); } else { next.add(tab); }
      return next;
    });
  }

  const allSelected = allTabs.every(t => checked.has(t));

  function handleSelectAll() {
    if (allSelected) {
      setChecked(new Set([activeTab]));
    } else {
      setChecked(new Set(allTabs));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-modal-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-3xl p-6 max-w-sm w-full anim-fade-up text-right" dir="rtl">
        <h2 id="download-modal-title" className="text-base mb-4" style={{ fontWeight: 800, color: "#0f172a" }}>בחר לשוניות לייצוא</h2>
        <div className="flex flex-col gap-2.5 mb-5">
          <label className="flex items-center gap-3 cursor-default select-none">
            <input type="checkbox" checked readOnly className="w-4 h-4 accent-blue-600" />
            <span className="text-sm" style={{ fontWeight: 700 }}>{TAB_LABELS_MAP[activeTab]}</span>
            <span className="text-xs text-slate-400">(לשונית נוכחית)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer select-none border-t border-slate-100 pt-2.5">
            <input type="checkbox" checked={allSelected} onChange={handleSelectAll} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm" style={{ fontWeight: 600 }}>הכל</span>
          </label>
          {otherTabs.map(tab => (
            <label key={tab} className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={checked.has(tab)} onChange={() => toggle(tab)} className="w-4 h-4 accent-blue-600" />
              <span className="text-sm">{TAB_LABELS_MAP[tab]}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => onConfirm([...checked])} className="btn-blue flex-1 py-2.5 text-sm">אישור</button>
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-sm rounded-xl transition-all"
            style={{ fontWeight: 600, border: "1.5px solid #e2e8f0", color: "#64748b" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Download bar (per-tab)
// ---------------------------------------------------------------------------

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 17 17" fill="none" className="flex-shrink-0">
      <path d="M8.5 2v9M5 8l3.5 3.5L12 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 13.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function Spinner({ dark }) {
  return (
    <span className="w-4 h-4 rounded-full flex-shrink-0"
      style={{
        border: dark ? "2px solid rgba(0,0,0,0.15)" : "2px solid rgba(255,255,255,0.3)",
        borderTopColor: dark ? "#b91c1c" : "white",
        animation: "spin-smooth 0.7s linear infinite",
      }}
    />
  );
}

function TabDownloadBar({ activeTab, runId, authHeader, hasTikhnun, tikhnunOnly, yozmaMultiplier, availableTabs, onNewRun }) {
  const [dlExcel, setDlExcel] = useState(false);
  const [dlPdf,   setDlPdf]   = useState(false);
  const [pdfErr,  setPdfErr]  = useState(false);
  const [modal,   setModal]   = useState(null); // null | "excel" | "pdf"

  const isTikhnunTab = TIKHNUN_ONLY_TABS.includes(activeTab);

  function resolveUrls(sections) {
    if (sections.length === 1) {
      const s = sections[0];
      const isTk = TIKHNUN_ONLY_TABS.includes(s);
      return {
        excelUrl:  isTk ? `/analyze/download-tikhnun/${runId}?section=${s}&multiplier=${yozmaMultiplier}` : `/analyze/download/${runId}`,
        pdfUrl:    isTk ? `/analyze/pdf-tikhnun/${runId}?section=${s}&multiplier=${yozmaMultiplier}` : `/analyze/pdf/${runId}?section=${s}`,
        excelName: isTk ? `tikhnun-${s}.xlsx` : "hashvaa-gefen-ksafim.xlsx",
        pdfName:   isTk ? `tikhnun-${s}.pdf`  : "hashvaa-gefen-kesafim.pdf",
      };
    }
    const sp = sections.join(",");
    return {
      excelUrl:  `/analyze/excel-combined/${runId}?sections=${sp}&multiplier=${yozmaMultiplier}`,
      pdfUrl:    `/analyze/pdf-combined/${runId}?sections=${sp}&multiplier=${yozmaMultiplier}`,
      excelName: "gefen-combined.xlsx",
      pdfName:   "gefen-combined.pdf",
    };
  }

  async function doDownload(type, sections) {
    const { excelUrl, pdfUrl, excelName, pdfName } = resolveUrls(sections);
    if (type === "excel") {
      setDlExcel(true);
      try {
        const res = await axios.get(excelUrl, { headers: authHeader, responseType: "blob" });
        const url = URL.createObjectURL(res.data);
        const a = document.createElement("a");
        a.href = url; a.download = excelName; a.click();
        URL.revokeObjectURL(url);
      } catch {}
      finally { setDlExcel(false); }
    } else {
      setPdfErr(false);
      setDlPdf(true);
      try {
        const res = await axios.get(pdfUrl, { headers: authHeader, responseType: "blob" });
        const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url; a.download = pdfName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        setPdfErr(true);
        setTimeout(() => setPdfErr(false), 3000);
      } finally { setDlPdf(false); }
    }
  }

  function handleExcelClick() {
    if (dlExcel || dlPdf) return;
    if (availableTabs.length > 0) { setModal("excel"); }
    else { doDownload("excel", [activeTab]); }
  }

  function handlePdfClick() {
    if (dlExcel || dlPdf) return;
    if (availableTabs.length > 0) { setModal("pdf"); }
    else { doDownload("pdf", [activeTab]); }
  }

  function handleModalConfirm(sections) {
    const type = modal;
    setModal(null);
    doDownload(type, sections);
  }

  return (
    <>
      {modal && (
        <DownloadSelectModal
          activeTab={activeTab}
          availableTabs={availableTabs}
          onConfirm={handleModalConfirm}
          onCancel={() => setModal(null)}
        />
      )}
      <div className="flex justify-center gap-3 mt-2 anim-fade-up-4 flex-wrap items-center">
        <button onClick={handleExcelClick} disabled={dlExcel || dlPdf}
          className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
          style={{ fontWeight: 700, background: "rgba(34,197,94,0.09)", color: "#16a34a", border: "1.5px solid rgba(34,197,94,0.28)" }}>
          {dlExcel ? <><Spinner dark /><span>מוריד...</span></> : <><DownloadIcon /><span>הורד קובץ Excel</span></>}
        </button>

        {(!isTikhnunTab || hasTikhnun) && (
          <button onClick={handlePdfClick} disabled={dlExcel || dlPdf}
            className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
            style={{ fontWeight: 700, background: pdfErr ? "#fee2e2" : "rgba(239,68,68,0.08)", color: "#dc2626", border: "1.5px solid rgba(239,68,68,0.25)" }}>
            {dlPdf ? <><Spinner dark /><span>מוריד...</span></> : pdfErr ? <span>שגיאה, נסה שוב</span> : <><DownloadIcon /><span>הורד קובץ PDF</span></>}
          </button>
        )}

        <button onClick={onNewRun} className="btn-ghost flex items-center gap-2 px-5 py-3 text-sm font-600" style={{ fontWeight: 600 }}>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none" className="flex-shrink-0">
            <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          בדיקה חדשה
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Yozma dialog
// ---------------------------------------------------------------------------

function YozmaDialog({ onAnswer, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="yozma-modal-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right" dir="rtl">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(0,112,243,0.09)" }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#0070F3" strokeWidth="1.6"/>
            <path d="M10 6.5c0-1.1.9-2 2-2a2 2 0 0 1 1.4 3.4L10 11" stroke="#0070F3" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="14" r=".8" fill="#0070F3"/>
          </svg>
        </div>
        <h2 id="yozma-modal-title" className="text-base font-800 mb-3" style={{ fontWeight: 800, color: "#0f172a" }}>
          האם המוסד עמד במודל התמרוץ תשפ"ה?
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          תשובתך תשפיע על חישוב תקציב היוזמות המקסימלי (30% לעומת 40%).
        </p>
        <div className="flex gap-2 flex-col">
          <button onClick={() => onAnswer("yes")}
            className="btn-blue py-2.5 text-sm w-full">
            כן — עמד במודל התמרוץ
          </button>
          <button onClick={() => onAnswer("no")}
            className="flex items-center justify-center py-2.5 text-sm w-full rounded-xl transition-all"
            style={{ fontWeight: 600, border: "1.5px solid #e2e8f0", color: "#64748b" }}>
            לא
          </button>
          <button onClick={onCancel}
            className="flex items-center justify-center py-2.5 text-sm w-full rounded-xl transition-all"
            style={{ fontWeight: 600, border: "1.5px solid #e2e8f0", color: "#64748b" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function YozmaDualDialog({ tikkonLabel, beinayimLabel, onAnswer, onCancel }) {
  const [tikkonAns,   setTikkonAns]   = useState(null);
  const [beinayimAns, setBeinayimAns] = useState(null);
  const canConfirm = tikkonAns !== null && beinayimAns !== null;
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  const AnswerRow = ({ label, value, onChange }) => (
    <div className="mb-4">
      <p className="text-xs font-700 text-slate-500 mb-2" style={{ fontWeight: 700 }}>{label}</p>
      <div className="flex gap-2">
        {["yes", "no"].map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            className="flex-1 py-2 text-sm rounded-xl transition-all"
            style={{
              fontWeight: 600,
              background: value === opt ? "#0070F3" : "transparent",
              color: value === opt ? "white" : "#64748b",
              border: value === opt ? "1.5px solid #0070F3" : "1.5px solid #e2e8f0",
            }}>
            {opt === "yes" ? "כן" : "לא"}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="yozma-dual-modal-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right" dir="rtl">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(0,112,243,0.09)" }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#0070F3" strokeWidth="1.6"/>
            <path d="M10 6.5c0-1.1.9-2 2-2a2 2 0 0 1 1.4 3.4L10 11" stroke="#0070F3" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="14" r=".8" fill="#0070F3"/>
          </svg>
        </div>
        <h2 id="yozma-dual-modal-title" className="text-base font-800 mb-2" style={{ fontWeight: 800, color: "#0f172a" }}>
          האם המוסד עמד במודל התמרוץ תשפ"ה?
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-5">
          בחר עבור כל חטיבה בנפרד — תשובתך תשפיע על חישוב תקציב היוזמות המקסימלי (30% לעומת 40%).
        </p>
        <AnswerRow label={tikkonLabel}   value={tikkonAns}   onChange={setTikkonAns}   />
        <AnswerRow label={beinayimLabel} value={beinayimAns} onChange={setBeinayimAns} />
        <div className="flex gap-2 mt-1">
          <button onClick={() => canConfirm && onAnswer(tikkonAns, beinayimAns)}
            disabled={!canConfirm}
            className="btn-blue flex-1 py-2.5 text-sm"
            style={{ opacity: canConfirm ? 1 : 0.45 }}>
            אישור
          </button>
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-sm rounded-xl transition-all"
            style={{ fontWeight: 600, border: "1.5px solid #e2e8f0", color: "#64748b" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tikhnun tab content components
// ---------------------------------------------------------------------------

function DualTikhnunSection({ label, children }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-700 text-slate-500 tracking-widest px-2"
          style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {children}
    </div>
  );
}

function NoTikhnunNotice() {
  return (
    <div className="glass-card-dark rounded-2xl overflow-hidden">
      <div className="flex items-center justify-center gap-2 py-14">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" fill="#d97706" fillOpacity="0.15"/>
          <path d="M8 5v3.5M8 10.5v.5" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <span className="text-sm font-700 text-amber-700" style={{ fontWeight: 700 }}>
          לא הועלה קובץ תכנון תקציבי
        </span>
      </div>
    </div>
  );
}

function OverviewRow({ label, value, red, bold }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm font-500 text-slate-500" style={{ fontWeight: 500 }}>{label}</span>
      <span className="text-sm font-700 tabular-nums"
        style={{ fontWeight: bold ? 700 : 600, color: red ? "#dc2626" : "#1e293b" }}>
        {value}
      </span>
    </div>
  );
}

function SikarTab({ tikhnun }) {
  if (!tikhnun) return <NoTikhnunNotice />;
  const ov = tikhnun.overview ?? {};
  const hasDoch = tikhnun.has_doch;

  return (
    <div className="flex flex-col gap-4">
      {/* Top row: פרטי מוסד (right) | קו | תקציב (left) */}
      <div className="glass-card-dark rounded-2xl overflow-hidden">
        <div className="flex" dir="rtl">
          <div className="flex-1 px-5 py-4">
            <h3 className="text-xs font-700 text-slate-500 tracking-wide mb-3" style={{ fontWeight: 700 }}>פרטי מוסד</h3>
            <InfoGrid rows={[
              { label: "שם מוסד",  value: tikhnun.school_name },
              { label: "סמל מוסד", value: tikhnun.school_code },
              { label: "שלב מוסד", value: tikhnun.school_stage },
            ]} />
          </div>
          <div className="w-px bg-slate-100 self-stretch" />
          <div className="flex-1 px-5 py-4">
            <h3 className="text-xs font-700 text-slate-500 tracking-wide mb-3" style={{ fontWeight: 700 }}>תקציב</h3>
            <InfoGrid rows={[
              { label: "תקציב גפן",                value: fmtNum(ov.budget) },
              { label: "סכום שתוכנן",              value: fmtNum(ov.planned) },
              { label: "אחוז תכנון",               value: fmtPct(ov.budget > 0 ? ov.planned / ov.budget : null, 2) },
              { label: "תקציב קבוע שנותר לתכנון", value: fmtNum(ov.fixed_gap_abs) },
              { label: "תקציב גמיש שנותר לתכנון", value: fmtNum(ov.flexible_remaining),
                highlight: ov.flexible_remaining < 0 },
            ]} />
          </div>
        </div>
      </div>

      {/* Bottom: דיווח — full width */}
      {hasDoch && (
        <SummaryBlock title="דיווח" index={1}>
          <InfoGrid rows={[
            { label: "סכום חייב בדיווח",          value: fmtNum(ov.sum_chayav) },
            { label: "סכום שדווח",                 value: fmtNum(ov.sum_divuach) },
            { label: "אחוז דיווח (כללי)",          value: fmtPct(ov.pct_divuach, 0) },
            ...(ov.pct_tanuz != null
              ? [{ label: "אחוז דיווח למודל תמרוץ", value: fmtPct(ov.pct_tanuz, 2), highlight: true }]
              : []),
          ]} />
        </SummaryBlock>
      )}
    </div>
  );
}

function KvuaTab({ tikhnun }) {
  if (!tikhnun) return <NoTikhnunNotice />;
  const rows = tikhnun.kvua_rows ?? [];
  const hasMulti = tikhnun.has_multiple_budget_types;
  const totalKvua    = rows.reduce((s, r) => s + (r.kvua    ?? 0), 0);
  const totalTikhnun = rows.reduce((s, r) => s + (r.tikhnun ?? 0), 0);
  const totalHefresh = rows.reduce((s, r) => s + (r.hefresh ?? 0), 0);

  return (
    <div className="glass-card-dark rounded-2xl overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm border-collapse" dir="rtl">
          <thead>
            <tr>
              {hasMulti && <th scope="col" className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                style={{ fontWeight: 700, background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)" }}>סוג תקציב</th>}
              {["שלב חינוך", "סל", "תת סל", "תקציב קבוע", "תקציב שתוכנן", "הפרש שלא תוכנן"].map(h => (
                <th key={h} scope="col" className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                  style={{ fontWeight: 700, background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                {hasMulti && <td className="px-4 py-2.5 text-right text-slate-600 text-xs">{row.budget_type}</td>}
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{row.stage}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{row.sal}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{row.tatsub}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(row.kvua)}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(row.tikhnun)}</td>
                <td className="px-4 py-2.5 text-right text-xs tabular-nums font-700"
                  style={{ fontWeight: 700, color: row.hefresh < 0 ? "#dc2626" : "#1e293b" }}>
                  {fmtNum(row.hefresh)}
                </td>
              </tr>
            ))}
            <tr style={{ background: "#E8EDF5" }}>
              {hasMulti && <td className="px-4 py-2.5" />}
              <td className="px-4 py-2.5 text-right text-sm font-700" style={{ fontWeight: 700 }} colSpan={2}>סה"כ</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right text-sm font-700 tabular-nums" style={{ fontWeight: 700 }}>{fmtNum(totalKvua)}</td>
              <td className="px-4 py-2.5 text-right text-sm font-700 tabular-nums" style={{ fontWeight: 700 }}>{fmtNum(totalTikhnun)}</td>
              <td className="px-4 py-2.5 text-right text-sm font-700 tabular-nums"
                style={{ fontWeight: 700, color: totalHefresh < 0 ? "#dc2626" : "#1e293b" }}>
                {fmtNum(totalHefresh)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartialTab({ tikhnun }) {
  if (!tikhnun) return <NoTikhnunNotice />;
  const rows = tikhnun.partial_rows ?? [];
  const totalHefresh = tikhnun.sum_hefresh_partial ?? 0;

  if (rows.length === 0) {
    return (
      <div className="glass-card-dark rounded-2xl overflow-hidden">
        <div className="flex items-center justify-center gap-2 py-12">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
            <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>כל התוכניות דווחו במלואן</span>
        </div>
      </div>
    );
  }

  if (!tikhnun.has_doch) {
    return (
      <div className="glass-card-dark rounded-2xl overflow-hidden">
        <div className="flex items-center justify-center gap-2 py-12">
          <span className="text-sm font-700 text-amber-700" style={{ fontWeight: 700 }}>
            לא הועלה קובץ דיווח ביצוע — לא ניתן לחשב ביצוע חלקי
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card-dark rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-700 text-slate-700 text-right" style={{ fontWeight: 700 }}>תוכניות עם דיווח חסר</h3>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs tabular-nums font-700" style={{ fontWeight: 700, color: "#1e293b" }}>
            <span className="text-slate-400" style={{ fontWeight: 400 }}>סכום שטרם דווח:</span>
            {Math.abs(Math.round(totalHefresh)).toLocaleString("he-IL")}
            <span style={{ color: "#64748b", fontWeight: 400 }}>₪</span>
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-700"
            style={{ fontWeight: 700, background: "#fee2e2", color: "#dc2626" }}>
            {rows.length} רשומות
          </span>
        </div>
      </div>
      <div className="table-scroll">
        <table className="w-full text-sm border-collapse" dir="rtl">
          <thead>
            <tr>
              {["קוד", "שם מענה", "מספר מענה", "תכנון", "דיווח", "הפרש", "אחוז דיווח"].map((h, hi) => (
                <th key={h} scope="col" className="text-right text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                  style={{
                    fontWeight: 700,
                    background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)",
                    ...(hi === 0 ? { ...CODE_COL_STYLE, padding: "12px 6px" } : { padding: "12px 16px" }),
                  }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                <td className="text-right text-slate-700 text-xs"
                  style={{ ...CODE_COL_STYLE, padding: "10px 6px" }}>{row.rcode}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">
                  <span className="block" style={{ wordBreak: "break-word", whiteSpace: "normal" }}>{row.name}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{row.mispnum}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(row.tikhnun)}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(row.divuach)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-700 tabular-nums"
                  style={{ fontWeight: 700, color: row.hefresh < 0 ? "#dc2626" : "#1e293b" }}>
                  {fmtNum(row.hefresh)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">
                  {fmtPct(row.pct, 2)}
                </td>
              </tr>
            ))}
            <tr style={{ background: "#E8EDF5" }}>
              <td className="px-4 py-2.5 text-right text-sm font-700" style={{ fontWeight: 700 }} colSpan={5}>סה"כ הפרש לטיפול</td>
              <td className="px-4 py-2.5 text-right text-sm font-700 tabular-nums" style={{ fontWeight: 700 }}>
                {fmtNum(totalHefresh)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function YozmaTab({ tikhnun, multiplier, autoSwitch }) {
  if (!tikhnun) return <NoTikhnunNotice />;
  const yozmaKey = multiplier === "04" ? "yozma_04" : "yozma_03";
  const yozma = tikhnun[yozmaKey] ?? tikhnun.yozma_03 ?? {};
  const hefreshTotal = yozma.hefresh ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {autoSwitch && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-right"
          style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#92400e" }}
        >
          <strong>שים לב!</strong> לפי נתוני הקובץ בית הספר כן עמד במודל התמרוץ ולכן חישוב הנתונים בוצע בהתאם.
        </div>
      )}

      <SummaryBlock title="סיכום יוזמות" index={0}>
        <InfoGrid rows={[
          { label: "תקציב מקסימלי לתכנון יוזמות", value: fmtNum(yozma.max) },
          { label: "בתכנון",                        value: fmtNum(yozma.betikhnun) },
          { label: "הפרש",                          value: fmtNum(hefreshTotal),
            danger: hefreshTotal < 0, highlight: hefreshTotal >= 0 },
          { label: "תקציב גמיש פנוי",              value: fmtNum(tikhnun.overview?.flexible_remaining) },
        ]} />
      </SummaryBlock>

      <div className="glass-card-dark rounded-2xl overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm border-collapse" dir="rtl">
            <thead>
              <tr>
                {["סעיף", "תקרה", "בתכנון", "סכום זמין לתכנון בשקלול תקציב גמיש פנוי"].map(h => (
                  <th key={h} scope="col" className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                    style={{ fontWeight: 700, background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(yozma.detail ?? []).map((item, i) => (
                <tr key={i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                  <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{item.label}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(item.cap)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(item.betikhnun)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-700 tabular-nums"
                    style={{ fontWeight: 700, color: item.hefresh < 0 ? "#dc2626" : "#1e293b" }}>
                    {fmtNum(item.hefresh)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hashva (comparison) tab content
// ---------------------------------------------------------------------------

function GefenFileCard({ file }) {
  return (
    <div className="flex flex-col gap-2">
      <InfoGrid rows={[
        { label: "שם קובץ",        value: file.filename },
        { label: "שלב",             value: STAGE_LABELS[file.division] ?? file.division },
        { label: "אסמכתאות שזוהו", value: file.rows },
      ]} />
      {file.was_deduplicated && <p className="text-xs text-amber-600">כפילות שורות זוהתה בקובץ זה ונוטרלה אוטומטית</p>}
    </div>
  );
}

function GefenFilesDetail({ gefen_files, gefen_rows, gefen_merge_note }) {
  const hasMerge = gefen_files.length === 2 && gefen_merge_note;
  const { overlap, file0_rows, file1_rows } = gefen_merge_note ?? {};
  let mergeNote = null;
  if (hasMerge) {
    if (overlap === file1_rows) mergeNote = `כלל האסמכתאות ב-${gefen_files[1].filename} קיימות גם ב-${gefen_files[0].filename}.`;
    else if (overlap === file0_rows) mergeNote = `כלל האסמכתאות ב-${gefen_files[0].filename} קיימות גם ב-${gefen_files[1].filename}.`;
    else if (overlap > 0) mergeNote = `${overlap} שורות מופיעות בשני הקבצים (מתוך ${file0_rows + file1_rows} סה"כ).`;
  }
  const singleFileDedup = gefen_files.length === 1 && gefen_files[0]?.was_deduplicated;
  return (
    <div>
      {gefen_files.length === 2 ? (
        <div className="flex items-start gap-0">
          <div className="flex-1 px-2"><GefenFileCard file={gefen_files[0]} /></div>
          <div className="w-px self-stretch bg-slate-100 mx-3" />
          <div className="flex-1 px-2"><GefenFileCard file={gefen_files[1]} /></div>
        </div>
      ) : (
        <div className="px-2">{(gefen_files ?? []).map((f, i) => <GefenFileCard key={i} file={f} />)}</div>
      )}
      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-1">
        {mergeNote && <p className="text-xs text-slate-500">{mergeNote}</p>}
        {singleFileDedup && <p className="text-xs text-slate-500">קובץ הגפן הכיל כפילות של כלל השורות — נוטרלה אוטומטית.</p>}
        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>{`סה"כ ${gefen_rows} אסמכתאות ייחודיות`}</p>
      </div>
    </div>
  );
}

function HashvaTab({ result }) {
  const { summary, gefen_only } = result;

  if (gefen_only) {
    return (
      <div className="flex flex-col gap-4">
        <div className="anim-fade-up glass-card-dark rounded-2xl px-5 py-3.5 flex items-center justify-center">
          <span className="text-sm text-slate-500">
            בדיקה בוצעה עבור:{" "}
            <span className="font-700 text-slate-700" style={{ fontWeight: 700 }}>קובץ דיווח ביצוע בלבד</span>
          </span>
        </div>
        <GefenOnlyNotice title="קיים בתוכנת הכספים, לא משויך בגפן" index={1} />
        <GefenOnlyNotice title="משויך בגפן, לא קיים בתוכנת הכספים" index={2} />
        <SummaryBlock title="קבצי דיווח ביצוע" index={3}>
          <GefenFilesDetail gefen_files={summary.gefen_files ?? []} gefen_rows={summary.gefen_rows} gefen_merge_note={summary.gefen_merge_note} />
        </SummaryBlock>
      </div>
    );
  }

  const financeRows = result.rows_finance_not_gefen ?? [];
  const gefenRows   = result.rows_gefen_not_finance ?? [];
  const { division, finance_rows_total, finance_rows_checked, finance_file } = summary;
  const label    = DIVISION_LABELS[division] ?? division;
  const filtered = finance_rows_total !== finance_rows_checked;

  return (
    <div className="flex flex-col gap-4">
      <div className="anim-fade-up glass-card-dark rounded-2xl px-5 py-3.5 flex items-center justify-center flex-wrap gap-2">
        <span className="text-sm text-slate-500">
          הבדיקה בוצעה עבור:{" "}
          <span className="font-700 text-slate-700" style={{ fontWeight: 700 }}>{label}</span>
        </span>
        {filtered && (
          <span className="text-xs text-slate-400">
            {finance_rows_checked} מתוך {finance_rows_total} שורות כספים נבדקו
          </span>
        )}
      </div>

      <ResultTable title={`קיים ב${finance_file?.software ?? "תוכנת הכספים"}, לא משויך בגפן`}
        rows={financeRows} columns={UNIFIED_COLS} index={1} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
      <ResultTable title={`משויך בגפן, לא קיים ב${finance_file?.software ?? "תוכנת הכספים"}`}
        rows={gefenRows} columns={UNIFIED_COLS} index={2} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />

    </div>
  );
}

function RejectedTab({ result, rows: rowsOverride }) {
  const rows = rowsOverride ?? result.rows_gefen_rejected ?? [];
  return (
    <div className="flex flex-col gap-4">
      <ResultTable title="אסמכתאות שנדחו" rows={rows} columns={REJECTED_COLS} index={0} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
    </div>
  );
}

function NoPdfTab({ result, rows: rowsOverride }) {
  const rows = rowsOverride ?? result.rows_gefen_no_pdf ?? [];
  return (
    <div className="flex flex-col gap-4">
      <ResultTable title="אסמכתאות ללא PDF" rows={rows} columns={UNIFIED_COLS} index={0} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tikhnun-only result (no gefen files)
// ---------------------------------------------------------------------------

function TikhnunOnlyBanner() {
  return (
    <div className="anim-fade-up glass-card-dark rounded-2xl px-5 py-3.5 flex items-center justify-center">
      <span className="text-sm text-slate-500">
        הועלה{" "}
        <span className="font-700 text-slate-700" style={{ fontWeight: 700 }}>קובץ תכנון בלבד</span>
        {" "}— ניתוח תקציב גפן
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ResultsView({ result, runId, authHeader, onNewRun }) {
  const [activeTab, setActiveTab]       = useState("hashva");
  const [yozmaDialogShown, setYozmaDialogShown]             = useState(false);
  const [showYozmaDialog, setShowYozmaDialog]               = useState(false);
  const [yozmaMultiplier, setYozmaMultiplier]               = useState("03");
  const [yozmaAutoSwitch, setYozmaAutoSwitch]               = useState(false);
  const [yozmaMultiplierTikkon,   setYozmaMultiplierTikkon]   = useState("03");
  const [yozmaAutoSwitchTikkon,   setYozmaAutoSwitchTikkon]   = useState(false);
  const [yozmaMultiplierBeinayim, setYozmaMultiplierBeinayim] = useState("03");
  const [yozmaAutoSwitchBeinayim, setYozmaAutoSwitchBeinayim] = useState(false);

  const tikhnun         = result.tikhnun;
  const tikhnunTikkon   = result.tikhnun_tikkon;
  const tikhnunBeinayim = result.tikhnun_beinayim;
  const isDualTikhnun   = !!(tikhnunTikkon || tikhnunBeinayim);
  const hasTikhnun      = isDualTikhnun || !!(tikhnun && !tikhnun.error);
  const tikhnunOnly     = !!result.tikhnun_only;

  // Enabled tabs other than the currently active one (used by DownloadSelectModal)
  const availableTabs = TAB_IDS.filter(tab => {
    if (tab === activeTab) return false;
    if (TIKHNUN_ONLY_TABS.includes(tab) && !hasTikhnun) return false;
    if (GEFEN_ONLY_TABS.includes(tab) && tikhnunOnly) return false;
    return true;
  });

  // Compute issues flag for each tab
  const getTabIssues = (tab) => {
    if (tikhnunOnly) {
      if (GEFEN_ONLY_TABS.includes(tab)) return false;
    }
    if (tab === "hashva") {
      const a = (result.rows_finance_not_gefen ?? []).length;
      const b = (result.rows_gefen_not_finance ?? []).length;
      return a + b > 0;
    }
    if (tab === "rejected") return (result.rows_gefen_rejected ?? []).length > 0;
    if (tab === "nopdf")    return (result.rows_gefen_no_pdf ?? []).length > 0;
    if (!hasTikhnun) return false;
    if (tab === "kvua")    return isDualTikhnun
      ? !!(tikhnunTikkon?.kvua_has_issues || tikhnunBeinayim?.kvua_has_issues)
      : !!tikhnun.kvua_has_issues;
    if (tab === "partial") return isDualTikhnun
      ? !!(tikhnunTikkon?.partial_has_issues || tikhnunBeinayim?.partial_has_issues)
      : !!tikhnun.partial_has_issues;
    if (tab === "yozma") {
      if (isDualTikhnun) {
        const yt = yozmaMultiplierTikkon   === "04" ? tikhnunTikkon?.yozma_04   : tikhnunTikkon?.yozma_03;
        const yb = yozmaMultiplierBeinayim === "04" ? tikhnunBeinayim?.yozma_04 : tikhnunBeinayim?.yozma_03;
        return !!(yt?.is_negative || yb?.is_negative);
      }
      const y = yozmaMultiplier === "04" ? tikhnun.yozma_04 : tikhnun.yozma_03;
      return !!(y?.is_negative);
    }
    return false;
  };

  const handleTabClick = (tab) => {
    if (TIKHNUN_ONLY_TABS.includes(tab) && !hasTikhnun) return;
    if (GEFEN_ONLY_TABS.includes(tab) && tikhnunOnly) return;
    if (tab === "yozma" && hasTikhnun && !yozmaDialogShown) {
      setShowYozmaDialog(true);
      return;
    }
    setActiveTab(tab);
  };

  const handleYozmaAnswer = (answer) => {
    setYozmaDialogShown(true);
    setShowYozmaDialog(false);
    let multiplier = "03";
    let autoSwitch = false;
    if (answer === "yes") {
      multiplier = "04";
    } else if (tikhnun?.yozma_03?.is_negative) {
      multiplier = "04";
      autoSwitch = true;
    }
    setYozmaMultiplier(multiplier);
    setYozmaAutoSwitch(autoSwitch);
    setActiveTab("yozma");
  };

  const handleDualYozmaAnswer = (tikkonAns, beinayimAns) => {
    setYozmaDialogShown(true);
    setShowYozmaDialog(false);
    const resolveMultiplier = (ans, tikhnunData) => {
      if (ans === "yes") return { mul: "04", auto: false };
      if (tikhnunData?.yozma_03?.is_negative) return { mul: "04", auto: true };
      return { mul: "03", auto: false };
    };
    const { mul: mulT, auto: autoT } = resolveMultiplier(tikkonAns,   tikhnunTikkon);
    const { mul: mulB, auto: autoB } = resolveMultiplier(beinayimAns, tikhnunBeinayim);
    setYozmaMultiplierTikkon(mulT);
    setYozmaAutoSwitchTikkon(autoT);
    setYozmaMultiplierBeinayim(mulB);
    setYozmaAutoSwitchBeinayim(autoB);
    setActiveTab("yozma");
  };

  return (
    <div className="flex flex-col gap-5" dir="rtl">
      {showYozmaDialog && !isDualTikhnun && (
        <YozmaDialog onAnswer={handleYozmaAnswer} onCancel={() => setShowYozmaDialog(false)} />
      )}
      {showYozmaDialog && isDualTikhnun && (
        <YozmaDualDialog
          tikkonLabel={tikhnunTikkon?.school_stage ?? "חטיבה עליונה"}
          beinayimLabel={tikhnunBeinayim?.school_stage ?? "חטיבת ביניים"}
          onAnswer={handleDualYozmaAnswer}
          onCancel={() => setShowYozmaDialog(false)}
        />
      )}

      {tikhnunOnly && <TikhnunOnlyBanner />}

      <TabBar
        activeTab={activeTab}
        hasTikhnun={hasTikhnun}
        tikhnunOnly={tikhnunOnly}
        getTabIssues={getTabIssues}
        onTabClick={handleTabClick}
      />

      <div className="min-h-0">
        {activeTab === "hashva" && (
          tikhnunOnly
            ? (
              <div className="flex flex-col gap-4">
                <GefenOnlyNotice title="קיים בתוכנת הכספים, לא משויך בגפן" index={0} />
                <GefenOnlyNotice title="משויך בגפן, לא קיים בתוכנת הכספים" index={1} />
              </div>
            )
            : <HashvaTab result={result} />
        )}
        {activeTab === "sikar" && !isDualTikhnun && (() => {
          const summary = result.summary;
          const showBedika = !tikhnunOnly && !result.gefen_only && summary;
          const { division, finance_rows_total, finance_rows_checked, finance_file } = summary ?? {};
          const filtered = finance_rows_total !== finance_rows_checked;
          return (
            <div className="flex flex-col gap-4">
              {hasTikhnun && <SikarTab tikhnun={tikhnun} />}
              {showBedika && (
                <>
                  <div className="mt-6 mb-1">
                    <h2 className="text-xs font-700 text-slate-400 tracking-widest uppercase text-center" style={{ fontWeight: 700 }}>פרטי הבדיקה</h2>
                  </div>
                  {hasTikhnun && tikhnun?.filename && (
                    <SummaryBlock title="קבצי תכנון" index={2}>
                      <div className="px-2">
                        <InfoGrid rows={[
                          { label: "שם קובץ", value: tikhnun.filename },
                          { label: "שלב",     value: tikhnun.school_stage },
                        ]} />
                      </div>
                    </SummaryBlock>
                  )}
                  <SummaryBlock title="קבצי דיווח ביצוע" index={3}>
                    <GefenFilesDetail gefen_files={summary.gefen_files ?? []} gefen_rows={summary.gefen_rows} gefen_merge_note={summary.gefen_merge_note} />
                  </SummaryBlock>
                  <SummaryBlock title="קבצים מתוכנת הכספים" index={4}>
                    <div className="px-2 flex flex-col gap-2">
                      <InfoGrid rows={[
                        { label: "שם קובץ",          value: finance_file?.filename },
                        { label: "סוג תוכנה",         value: finance_file?.software },
                        { label: "שלב",               value: STAGE_LABELS[division] ?? division },
                        { label: "אסמכתאות שזוהו",   value: (finance_rows_total ?? 0) + (finance_file?.cancelled_rows ?? 0) },
                        { label: "אסמכתאות מבוטלות", value: finance_file?.cancelled_rows ?? null },
                      ]} />
                      <div className="pt-3 border-t border-slate-100 flex flex-col gap-1">
                        {filtered && (
                          <p className="text-xs text-slate-500">
                            {`מתוך ${finance_rows_total} שורות כספים, ${finance_rows_checked} שייכות לשלב שנבדק.`}
                          </p>
                        )}
                        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
                          {`סה"כ ${finance_rows_checked} אסמכתאות ייחודיות`}
                        </p>
                      </div>
                    </div>
                  </SummaryBlock>
                  <SummaryBlock title="מסקנה ותהליך הבדיקה" index={5}>
                    <div className="px-2 flex flex-col gap-2">
                      <InfoGrid rows={[
                        { label: "גפן",          value: (summary.gefen_files ?? []).length === 1
                          ? `הועלה קובץ דיווח ביצוע עבור ${STAGE_LABELS[division] ?? division}`
                          : `הועלו קבצי דיווח ביצוע עבור ${STAGE_LABELS[division] ?? division}` },
                        { label: "תוכנת כספים", value: `הועלה קובץ ${finance_file?.software ?? "כספים"} עבור ${filtered ? STAGE_LABELS["both"] : (STAGE_LABELS[division] ?? division)}` },
                      ]} />
                      <div className="pt-3 border-t border-slate-100">
                        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
                          {filtered
                            ? `לכן הבדיקה בוצעה עבור ${STAGE_LABELS[division] ?? division} בלבד.`
                            : `לכן הבדיקה בוצעה עבור ${STAGE_LABELS[division] ?? division}.`}
                        </p>
                      </div>
                    </div>
                  </SummaryBlock>
                </>
              )}
            </div>
          );
        })()}
        {activeTab === "sikar" && isDualTikhnun && (() => {
          const summary = result.summary;
          const showBedika = !tikhnunOnly && !result.gefen_only && summary;
          const { division, finance_rows_total, finance_rows_checked, finance_file } = summary ?? {};
          const filtered = finance_rows_total !== finance_rows_checked;
          const hasBothTikhnun = !!(tikhnunTikkon && tikhnunBeinayim);
          return (
            <div className="flex flex-col gap-24">
              {tikhnunTikkon && (
                <DualTikhnunSection label={tikhnunTikkon.school_stage}>
                  <SikarTab tikhnun={tikhnunTikkon} />
                </DualTikhnunSection>
              )}
              {tikhnunBeinayim && (
                <DualTikhnunSection label={tikhnunBeinayim.school_stage}>
                  <SikarTab tikhnun={tikhnunBeinayim} />
                </DualTikhnunSection>
              )}
              {showBedika && (
                <div className="flex flex-col gap-4">
                  <div className="mt-2 mb-1">
                    <h2 className="text-xs font-700 text-slate-400 tracking-widest uppercase text-center" style={{ fontWeight: 700 }}>פרטי הבדיקה</h2>
                  </div>
                  {(tikhnunTikkon || tikhnunBeinayim) && (
                    <SummaryBlock title="קבצי תכנון" index={2}>
                      {hasBothTikhnun ? (
                        <div className="flex items-start gap-0">
                          <div className="flex-1 px-2">
                            <InfoGrid rows={[
                              { label: "שם קובץ", value: tikhnunTikkon.filename },
                              { label: "שלב",     value: tikhnunTikkon.school_stage },
                            ]} />
                          </div>
                          <div className="w-px self-stretch bg-slate-100 mx-3" />
                          <div className="flex-1 px-2">
                            <InfoGrid rows={[
                              { label: "שם קובץ", value: tikhnunBeinayim.filename },
                              { label: "שלב",     value: tikhnunBeinayim.school_stage },
                            ]} />
                          </div>
                        </div>
                      ) : (
                        <div className="px-2">
                          <InfoGrid rows={[
                            { label: "שם קובץ", value: (tikhnunTikkon ?? tikhnunBeinayim).filename },
                            { label: "שלב",     value: (tikhnunTikkon ?? tikhnunBeinayim).school_stage },
                          ]} />
                        </div>
                      )}
                    </SummaryBlock>
                  )}
                  <SummaryBlock title="קבצי דיווח ביצוע" index={3}>
                    <GefenFilesDetail gefen_files={summary.gefen_files ?? []} gefen_rows={summary.gefen_rows} gefen_merge_note={summary.gefen_merge_note} />
                  </SummaryBlock>
                  <SummaryBlock title="קבצים מתוכנת הכספים" index={4}>
                    <div className="px-2 flex flex-col gap-2">
                      <InfoGrid rows={[
                        { label: "שם קובץ",          value: finance_file?.filename },
                        { label: "סוג תוכנה",         value: finance_file?.software },
                        { label: "שלב",               value: STAGE_LABELS[division] ?? division },
                        { label: "אסמכתאות שזוהו",   value: (finance_rows_total ?? 0) + (finance_file?.cancelled_rows ?? 0) },
                        { label: "אסמכתאות מבוטלות", value: finance_file?.cancelled_rows ?? null },
                      ]} />
                      <div className="pt-3 border-t border-slate-100 flex flex-col gap-1">
                        {filtered && (
                          <p className="text-xs text-slate-500">
                            {`מתוך ${finance_rows_total} שורות כספים, ${finance_rows_checked} שייכות לשלב שנבדק.`}
                          </p>
                        )}
                        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
                          {`סה"כ ${finance_rows_checked} אסמכתאות ייחודיות`}
                        </p>
                      </div>
                    </div>
                  </SummaryBlock>
                  <SummaryBlock title="מסקנה ותהליך הבדיקה" index={5}>
                    <div className="px-2 flex flex-col gap-2">
                      <InfoGrid rows={[
                        { label: "גפן",          value: (summary.gefen_files ?? []).length === 1
                          ? `הועלה קובץ דיווח ביצוע עבור ${STAGE_LABELS[division] ?? division}`
                          : `הועלו קבצי דיווח ביצוע עבור ${STAGE_LABELS[division] ?? division}` },
                        { label: "תוכנת כספים", value: `הועלה קובץ ${finance_file?.software ?? "כספים"} עבור ${filtered ? STAGE_LABELS["both"] : (STAGE_LABELS[division] ?? division)}` },
                      ]} />
                      <div className="pt-3 border-t border-slate-100">
                        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
                          {filtered
                            ? `לכן הבדיקה בוצעה עבור ${STAGE_LABELS[division] ?? division} בלבד.`
                            : `לכן הבדיקה בוצעה עבור ${STAGE_LABELS[division] ?? division}.`}
                        </p>
                      </div>
                    </div>
                  </SummaryBlock>
                </div>
              )}
            </div>
          );
        })()}
        {activeTab === "rejected" && !isDualTikhnun && <RejectedTab result={result} />}
        {activeTab === "rejected" && isDualTikhnun && (() => {
          const { tikkon, beinayim } = splitByDivision(result.rows_gefen_rejected ?? []);
          return (
            <div className="flex flex-col gap-24">
              {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><RejectedTab result={result} rows={tikkon} /></DualTikhnunSection>}
              {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><RejectedTab result={result} rows={beinayim} /></DualTikhnunSection>}
            </div>
          );
        })()}
        {activeTab === "nopdf" && !isDualTikhnun && <NoPdfTab result={result} />}
        {activeTab === "nopdf" && isDualTikhnun && (() => {
          const { tikkon, beinayim } = splitByDivision(result.rows_gefen_no_pdf ?? []);
          return (
            <div className="flex flex-col gap-24">
              {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><NoPdfTab result={result} rows={tikkon} /></DualTikhnunSection>}
              {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><NoPdfTab result={result} rows={beinayim} /></DualTikhnunSection>}
            </div>
          );
        })()}
        {activeTab === "kvua" && !isDualTikhnun && <KvuaTab tikhnun={hasTikhnun ? tikhnun : null} />}
        {activeTab === "kvua" && isDualTikhnun && (
          <div className="flex flex-col gap-24">
            {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><KvuaTab tikhnun={tikhnunTikkon} /></DualTikhnunSection>}
            {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><KvuaTab tikhnun={tikhnunBeinayim} /></DualTikhnunSection>}
          </div>
        )}
        {activeTab === "partial" && !isDualTikhnun && <PartialTab tikhnun={hasTikhnun ? tikhnun : null} />}
        {activeTab === "partial" && isDualTikhnun && (
          <div className="flex flex-col gap-24">
            {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><PartialTab tikhnun={tikhnunTikkon} /></DualTikhnunSection>}
            {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><PartialTab tikhnun={tikhnunBeinayim} /></DualTikhnunSection>}
          </div>
        )}
        {activeTab === "yozma" && !isDualTikhnun && (
          <YozmaTab tikhnun={hasTikhnun ? tikhnun : null} multiplier={yozmaMultiplier} autoSwitch={yozmaAutoSwitch} />
        )}
        {activeTab === "yozma" && isDualTikhnun && (
          <div className="flex flex-col gap-24">
            {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><YozmaTab tikhnun={tikhnunTikkon} multiplier={yozmaMultiplierTikkon} autoSwitch={yozmaAutoSwitchTikkon} /></DualTikhnunSection>}
            {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><YozmaTab tikhnun={tikhnunBeinayim} multiplier={yozmaMultiplierBeinayim} autoSwitch={yozmaAutoSwitchBeinayim} /></DualTikhnunSection>}
          </div>
        )}
      </div>

      <TabDownloadBar
        activeTab={activeTab}
        runId={runId}
        authHeader={authHeader}
        hasTikhnun={hasTikhnun}
        tikhnunOnly={tikhnunOnly}
        yozmaMultiplier={yozmaMultiplier}
        availableTabs={availableTabs}
        onNewRun={onNewRun}
      />
    </div>
  );
}
