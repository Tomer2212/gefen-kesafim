import { useState, useEffect, Fragment } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { PartialRowUpdatesModal } from "./PartialRowUpdatesModal";

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

// Mirrors backend/zihuy_core.py normalize_budget_name() — used only as a fallback
// for kvua_rows saved before the "budget_norm" field was attached server-side.
const BUDGET_NAME_MAP = [
  [["חירום מחוזי", "גפן חירום", "חירום"], "גפן חירום"],
  [["גפ\"ן", "גפן"], "גפן"],
  [["תנופה לצפון", "תנופה"], "תנופה"],
  [["תקומה"], "תקומה"],
  [["דוקאטי", "סל דוקאטי"], "דוקאטי"],
  [["חינוך לסובלנות"], "חינוך לסובלנות"],
  [["קולות קוראים", "קול קורא"], "קולות קוראים"],
  [["פל\"ג", "פלג"], "פל\"ג"],
];
function normalizeBudgetNameJS(rawName) {
  if (!rawName) return rawName;
  const name = String(rawName).trim();
  for (const [keys, normalized] of BUDGET_NAME_MAP) {
    if (keys.some(key => name.includes(key))) return normalized;
  }
  return name;
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

const TAB_IDS = ["hashva", "sikar", "rejected", "nopdf", "partial", "yozma", "nihul", "kvua"];
const TAB_LABELS_MAP = {
  hashva:   "השוואה גפן-כספים",
  sikar:    "סקירה",
  rejected: "אסמכתאות שנדחו",
  nopdf:    "ללא PDF",
  partial:  "דיווח חסר",
  yozma:    "יוזמות וצרכים",
  nihul:    "ניהול ותפעול",
  kvua:     "תקציב קבוע",
};
// tabs disabled when no tikhnun data
const TIKHNUN_ONLY_TABS = ["kvua", "partial", "yozma", "nihul"];
// tabs disabled when tikhnun-only (no gefen execution data)
const GEFEN_ONLY_TABS = ["rejected", "nopdf", "partial"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        <Fragment key={label}>
          <dt className="text-slate-400 text-right whitespace-nowrap">{label}:</dt>
          <dd style={danger ? { fontWeight: 700, color: "#dc2626" } : highlight ? { fontWeight: 700, color: "#334155" } : { color: "#475569" }}>{value}</dd>
        </Fragment>
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

function TabDownloadBar({ activeTab, runId, hasTikhnun, tikhnunOnly, yozmaMultiplier, availableTabs, onNewRun }) {
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
        const res = await axios.get(excelUrl, { responseType: "blob" });
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
        const res = await axios.get(pdfUrl, { responseType: "blob" });
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

function SikarTab({ tikhnun, activeBudgetIdx: propIdx, setActiveBudgetIdx: propSetter }) {
  const [localIdx, setLocalIdx] = useState(0);
  const activeBudgetIdx = propIdx !== undefined ? propIdx : localIdx;
  const setActiveBudgetIdx = propSetter ?? setLocalIdx;
  if (!tikhnun) return <NoTikhnunNotice />;

  const budgets = tikhnun.budgets;
  const isMultiBudget = budgets && budgets.length > 1;

  if (isMultiBudget) {
    const safeIdx = Math.min(activeBudgetIdx, budgets.length - 1);
    const bud = budgets[safeIdx];
    const ov = bud.overview ?? {};
    return (
      <div className="flex flex-col gap-4">
        {/* Budget selector pills */}
        <div className="flex gap-2 flex-wrap" dir="rtl">
          {budgets.map((b, i) => (
            <button
              key={i}
              onClick={() => setActiveBudgetIdx(i)}
              style={{
                fontWeight: safeIdx === i ? 700 : 500,
                fontSize: "12px",
                padding: "4px 14px",
                borderRadius: "20px",
                border: `1.5px solid ${safeIdx === i ? "#0070F3" : "#e2e8f0"}`,
                background: safeIdx === i ? "#0070F3" : "transparent",
                color: safeIdx === i ? "white" : "#64748b",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {b.name}
            </button>
          ))}
        </div>

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
              <h3 className="text-xs font-700 text-slate-500 tracking-wide mb-3" style={{ fontWeight: 700 }}>תקציב {bud.name}</h3>
              <InfoGrid rows={[
                { label: "גובה תקציב",  value: fmtNum(ov.budget) },
                { label: "סכום שתוכנן", value: fmtNum(ov.planned) },
                { label: "אחוז תכנון",  value: fmtPct(ov.pct_plan, 2) },
              ]} />
            </div>
          </div>
        </div>

        {tikhnun.has_doch && (
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

  // Single budget — existing display
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
  const [activeBudgetIdx, setActiveBudgetIdx] = useState(0);

  if (!tikhnun) return <NoTikhnunNotice />;
  const allRows = tikhnun.kvua_rows ?? [];
  const budgets = tikhnun.budgets;
  const isMultiBudget = budgets && budgets.length > 1;
  const safeIdx = isMultiBudget ? Math.min(activeBudgetIdx, budgets.length - 1) : 0;
  const selectedBudget = isMultiBudget ? budgets[safeIdx]?.name : null;
  const rows = selectedBudget
    ? allRows.filter(r => (r.budget_norm ?? normalizeBudgetNameJS(r.budget_type)) === selectedBudget)
    : allRows;
  const hasMulti = !isMultiBudget && tikhnun.has_multiple_budget_types;
  const totalKvua    = rows.reduce((s, r) => s + (r.kvua    ?? 0), 0);
  const totalTikhnun = rows.reduce((s, r) => s + (r.tikhnun ?? 0), 0);
  const totalHefresh = rows.reduce((s, r) => s + (r.hefresh ?? 0), 0);

  const pillsEl = isMultiBudget ? (
    <div className="flex gap-2 flex-wrap" dir="rtl">
      {budgets.map((b, i) => (
        <button
          key={i}
          onClick={() => setActiveBudgetIdx(i)}
          style={{
            fontWeight: safeIdx === i ? 700 : 500,
            fontSize: "12px",
            padding: "4px 14px",
            borderRadius: "20px",
            border: `1.5px solid ${safeIdx === i ? "#0070F3" : "#e2e8f0"}`,
            background: safeIdx === i ? "#0070F3" : "transparent",
            color: safeIdx === i ? "white" : "#64748b",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {b.name}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {pillsEl}
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
    </div>
  );
}

function PartialTab({ tikhnun, activeBudgetIdx: propBudgetIdx, setActiveBudgetIdx: propSetBudgetIdx, schoolId, division = "main", currentUser }) {
  const [updatesByRowKey, setUpdatesByRowKey] = useState({});
  const [openRowKey, setOpenRowKey] = useState(null);
  const [localBudgetIdx, setLocalBudgetIdx] = useState(0);
  const activeBudgetIdx = propBudgetIdx !== undefined ? propBudgetIdx : localBudgetIdx;
  const setActiveBudgetIdx = propSetBudgetIdx !== undefined ? propSetBudgetIdx : setLocalBudgetIdx;

  const allRows = tikhnun?.partial_rows ?? [];
  const budgets = tikhnun?.budgets;
  const isMultiBudget = budgets && budgets.length > 1;
  const safeIdx = isMultiBudget ? Math.min(activeBudgetIdx, budgets.length - 1) : 0;
  const selectedBudget = isMultiBudget ? budgets[safeIdx]?.name : null;
  const rows = selectedBudget ? allRows.filter(r => r.budget === selectedBudget) : allRows;
  const totalHefresh = rows.reduce((s, r) => s + (r.hefresh ?? 0), 0);

  useEffect(() => {
    if (!schoolId || rows.length === 0) { setUpdatesByRowKey({}); return; }
    const rowKeys = rows.map(r => r.key).filter(Boolean);
    if (!rowKeys.length) return;
    let cancelled = false;
    axios.post(`/schools/${schoolId}/partial-updates/batch`, {
      division, budget_name: selectedBudget || null, row_keys: rowKeys,
    }).then(({ data }) => { if (!cancelled) setUpdatesByRowKey(data || {}); })
      .catch(() => { if (!cancelled) setUpdatesByRowKey({}); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, division, selectedBudget, rows.length]);

  function handleUpdatesChange(rowKey, newGroups) {
    setUpdatesByRowKey(prev => ({ ...prev, [rowKey]: newGroups }));
  }

  if (!tikhnun) return <NoTikhnunNotice />;

  const pillsEl = isMultiBudget && setActiveBudgetIdx ? (
    <div className="flex gap-2 flex-wrap" dir="rtl">
      {budgets.map((b, i) => (
        <button
          key={i}
          onClick={() => setActiveBudgetIdx(i)}
          style={{
            fontWeight: safeIdx === i ? 700 : 500,
            fontSize: "12px",
            padding: "4px 14px",
            borderRadius: "20px",
            border: `1.5px solid ${safeIdx === i ? "#0070F3" : "#e2e8f0"}`,
            background: safeIdx === i ? "#0070F3" : "transparent",
            color: safeIdx === i ? "white" : "#64748b",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {b.name}
        </button>
      ))}
    </div>
  ) : null;

  if (!tikhnun.has_doch) {
    return (
      <div className="flex flex-col gap-3">
        {pillsEl}
        <div className="glass-card-dark rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center gap-2 py-12">
            <span className="text-sm font-700 text-amber-700" style={{ fontWeight: 700 }}>
              לא הועלה קובץ דיווח ביצוע — לא ניתן לחשב ביצוע חלקי
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {pillsEl}
        <div className="glass-card-dark rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center gap-2 py-12">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
              <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>כל התוכניות דווחו במלואן</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {pillsEl}
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
              {["קוד", "שם מענה", "מספר מענה", "תכנון", "דיווח", "הפרש", "אחוז דיווח", "עדכונים"].map((h, hi) => (
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
            {rows.map((row, i) => {
              const rowGroups = (row.key && updatesByRowKey[row.key]) || [];
              const latest = latestSegmentOf(rowGroups);
              return (
              <tr key={row.key || i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
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
                <td className="px-4 py-2.5 text-right text-xs" style={{ maxWidth: "180px" }}>
                  {row.key && schoolId ? (
                    latest ? (
                      <button type="button" onClick={() => setOpenRowKey(row.key)}
                        className="text-right w-full text-slate-600 hover:text-blue-600"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <span className="block" style={{
                          overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical", whiteSpace: "normal", wordBreak: "break-word",
                        }}>
                          {latest.content}
                        </span>
                        <span className="block text-slate-400" style={{ fontSize: "10px" }}>{formatShortDate(latest.created_at)}</span>
                      </button>
                    ) : (
                      <button type="button" onClick={() => setOpenRowKey(row.key)}
                        className="text-blue-600 hover:underline" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        + הוסף עדכון
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
              );
            })}
            <tr style={{ background: "#E8EDF5" }}>
              <td className="px-4 py-2.5 text-right text-sm font-700" style={{ fontWeight: 700 }} colSpan={5}>סה"כ הפרש לטיפול</td>
              <td className="px-4 py-2.5 text-right text-sm font-700 tabular-nums" style={{ fontWeight: 700 }}>
                {fmtNum(totalHefresh)}
              </td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    {openRowKey && (() => {
      const openRow = rows.find(r => r.key === openRowKey);
      if (!openRow) return null;
      return (
        <PartialRowUpdatesModal
          schoolId={schoolId}
          division={division}
          budgetName={selectedBudget || null}
          rowKey={openRowKey}
          rowLabel={`${openRow.rcode} — ${openRow.name}`}
          currentUser={currentUser}
          groups={updatesByRowKey[openRowKey] || []}
          onChange={handleUpdatesChange}
          onClose={() => setOpenRowKey(null)}
        />
      );
    })()}
    </div>
  );
}

function latestSegmentOf(groups) {
  let latest = null;
  for (const g of (groups || [])) {
    for (const seg of g.segments) {
      if (!latest || new Date(seg.created_at) > new Date(latest.created_at)) latest = seg;
    }
  }
  return latest;
}

function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function YozmaSupplierBreakdown({ breakdown, title = "פירוט ספקים שדווחו — לפי יוזמה" }) {
  const [openSuppliers, setOpenSuppliers] = useState(new Set());
  function toggleSup(key) {
    setOpenSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  if (!breakdown || breakdown.length === 0) return null;
  const isSingle = breakdown.length === 1;
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm px-1 text-center mt-12" style={{ fontWeight: 700, color: "#475569" }}>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: isSingle ? "1fr" : "1fr 1fr", gap: "0" }}>
      {breakdown.map((item, idx) => (
        <div key={`${item.plan_number}-${item.code}`} className="glass-card-dark overflow-hidden"
          style={{
            borderRadius: 0,
            borderRight: !isSingle && idx % 2 === 0 ? "1px solid #e2e8f0" : "none",
            borderBottom: "1px solid #e2e8f0",
          }}>
          <div className="px-5 py-3 flex justify-between items-center" dir="rtl"
            style={{ background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)" }}>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-white" style={{ fontWeight: 700 }}>
                קוד {item.code} — {item.initiative_name}
              </span>
              {item.plan_number && (
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>מענה {item.plan_number}</span>
              )}
            </div>
            <span className="text-sm tabular-nums text-white">{fmtNum(item.total_amount)} ₪</span>
          </div>
          {item.suppliers.map(sup => {
            const supKey = `${item.plan_number}-${item.code}-${sup.supplier_number}`;
            const isOpen = openSuppliers.has(supKey);
            return (
              <div key={supKey} className="border-t border-slate-100">
                <button
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  dir="rtl" onClick={() => toggleSup(supKey)}
                  aria-expanded={isOpen} aria-controls={`supd-${supKey}`}
                  aria-label={`${sup.supplier_name} — ${fmtNum(sup.total_amount)} ₪`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 tabular-nums">{sup.supplier_number}</span>
                    <span className="text-sm text-slate-700">{sup.supplier_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums" style={{ color: "#1e293b" }}>{fmtNum(sup.total_amount)} ₪</span>
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"
                      style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}>
                      <path d="M4 6l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>
                {isOpen && (
                  <div id={`supd-${supKey}`} className="bg-slate-50 border-t border-slate-100">
                    <div className="table-scroll">
                      <table className="w-full text-xs border-collapse" dir="rtl">
                        <thead>
                          <tr>
                            {["תאריך", "מספר אסמכתא", "תיאור", "סכום"].map(h => (
                              <th key={h} scope="col" className="text-right px-4 py-2 text-slate-500 border-b border-slate-200 whitespace-nowrap"
                                style={{ fontWeight: 700, background: "#f8fafc" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sup.transactions.map((txn, ti) => (
                            <tr key={ti} style={{ background: ti % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{txn.date}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{txn.invoice}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{txn.description}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700" style={{ fontWeight: 700 }}>{fmtNum(txn.amount)} ₪</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}

function YozmaTab({ tikhnun, multiplier, autoSwitch }) {
  const budgetsWithYozma = (tikhnun?.budgets || []).filter(b => b.yozma_03);
  const hasBudgetPills = budgetsWithYozma.length > 1;

  const [localActiveBudget, setLocalActiveBudget] = useState(null);
  const [budgetMultipliers, setBudgetMultipliers] = useState({});
  const [pendingDialogBudget, setPendingDialogBudget] = useState(
    () => hasBudgetPills && budgetsWithYozma.length > 0 ? budgetsWithYozma[0].name : null
  );

  if (!tikhnun) return <NoTikhnunNotice />;

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

  const handlePillClick = (name) => {
    if (!budgetMultipliers[name]) setPendingDialogBudget(name);
    else setLocalActiveBudget(name);
  };

  const handlePerBudgetAnswer = (answer, budgetName) => {
    const bObj = budgetsWithYozma.find(b => b.name === budgetName);
    const mult = answer === "yes" ? "04" : (bObj?.yozma_03?.is_negative ? "04" : "03");
    setBudgetMultipliers(prev => ({ ...prev, [budgetName]: mult }));
    setLocalActiveBudget(budgetName);
    setPendingDialogBudget(null);
  };

  const effectiveBudget = hasBudgetPills ? (localActiveBudget ?? budgetsWithYozma[0]?.name ?? null) : null;
  let yozmaData;
  let flexibleRemaining;
  let breakdownData = null;
  if (hasBudgetPills && effectiveBudget) {
    const effMult = budgetMultipliers[effectiveBudget] ?? "03";
    const bObj = budgetsWithYozma.find(b => b.name === effectiveBudget);
    yozmaData = bObj?.[`yozma_${effMult}`] ?? bObj?.yozma_03 ?? {};
    flexibleRemaining = bObj?.overview?.flexible_remaining ?? tikhnun.overview?.flexible_remaining;
    breakdownData = bObj?.yozma_breakdown ?? null;
  } else {
    const yozmaKey = multiplier === "04" ? "yozma_04" : "yozma_03";
    yozmaData = tikhnun[yozmaKey] ?? tikhnun.yozma_03 ?? {};
    flexibleRemaining = tikhnun.overview?.flexible_remaining;
    breakdownData = tikhnun.budgets?.[0]?.yozma_breakdown ?? null;
  }

  const hefreshTotal = yozmaData?.hefresh ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {autoSwitch && !hasBudgetPills && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-right"
          style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#92400e" }}
        >
          <strong>שים לב!</strong> לפי נתוני הקובץ בית הספר כן עמד במודל התמרוץ ולכן חישוב הנתונים בוצע בהתאם.
        </div>
      )}

      {hasBudgetPills && (
        <div className="flex gap-2 flex-wrap" dir="rtl">
          {budgetsWithYozma.map(b => (
            <button
              key={b.name}
              onClick={() => handlePillClick(b.name)}
              aria-pressed={effectiveBudget === b.name}
              style={PILL_STYLE(effectiveBudget === b.name)}
            >
              {b.name}
              {budgetMultipliers[b.name] && (
                <span style={{ marginRight: "4px", fontSize: "11px", opacity: 0.6 }}>
                  {budgetMultipliers[b.name] === "04" ? "40%" : "30%"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {pendingDialogBudget ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-right" dir="rtl">
          <p className="text-sm font-medium mb-3">
            האם המוסד עמד במודל התמרוץ תשפ"ה עבור תקציב <strong>{pendingDialogBudget}</strong>?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handlePerBudgetAnswer("yes", pendingDialogBudget)}
              className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              כן — עמד
            </button>
            <button
              onClick={() => handlePerBudgetAnswer("no", pendingDialogBudget)}
              className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-300 transition-colors"
            >
              לא
            </button>
          </div>
        </div>
      ) : (
        <>
          <SummaryBlock title="סיכום יוזמות" index={0}>
            <InfoGrid rows={[
              { label: "תקציב מקסימלי לתכנון יוזמות", value: fmtNum(yozmaData.max) },
              { label: "בתכנון",                        value: fmtNum(yozmaData.betikhnun) },
              { label: "הפרש",                          value: fmtNum(hefreshTotal),
                danger: hefreshTotal < 0, highlight: hefreshTotal >= 0 },
              { label: "תקציב גמיש פנוי",              value: fmtNum(flexibleRemaining) },
            ]} />
          </SummaryBlock>

          <div className="glass-card-dark rounded-2xl overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm border-collapse" dir="rtl">
                <thead>
                  <tr>
                    {["סעיף", "תקרה", "בתכנון", "משויך", "טרם שויך", "סכום זמין לתכנון בשקלול תקציב גמיש פנוי"].map(h => (
                      <th key={h} scope="col" className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                        style={{ fontWeight: 700, background: "linear-gradient(135deg, #0c237d 0%, #091a60 100%)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(yozmaData.detail ?? []).map((item, i) => {
                    const teremShuyakh = (item.betikhnun ?? 0) - (item.meshuyakh ?? 0);
                    return (
                    <tr key={i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                      <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{item.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(item.cap)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 text-xs tabular-nums">{fmtNum(item.betikhnun)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600 text-xs tabular-nums">{item.meshuyakh != null ? fmtNum(item.meshuyakh) : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums"
                        style={{ color: teremShuyakh < 0 ? "#dc2626" : teremShuyakh > 0 ? "#0f172a" : "#64748b" }}>
                        {item.meshuyakh != null ? fmtNum(teremShuyakh) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-700 tabular-nums"
                        style={{ fontWeight: 700, color: item.hefresh < 0 ? "#dc2626" : "#1e293b" }}>
                        {fmtNum(item.hefresh)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <YozmaSupplierBreakdown breakdown={breakdownData} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nihul (ניהול ותפעול) tab
// ---------------------------------------------------------------------------

function NihulTab({ tikhnun }) {
  const budgetsWithNihul = (tikhnun?.budgets || []).filter(b => b.nihul_breakdown?.length > 0);
  const hasBudgetPills   = budgetsWithNihul.length > 1;
  const [activeBudget, setActiveBudget] = useState(null);
  const effectiveBudget  = hasBudgetPills ? (activeBudget ?? budgetsWithNihul[0]?.name ?? null) : null;

  let breakdownData;
  if (hasBudgetPills && effectiveBudget) {
    const bObj = budgetsWithNihul.find(b => b.name === effectiveBudget);
    breakdownData = bObj?.nihul_breakdown ?? null;
  } else {
    breakdownData = tikhnun?.budgets?.[0]?.nihul_breakdown ?? null;
  }

  if (!tikhnun || !breakdownData?.length) {
    return (
      <p className="text-center text-slate-500 py-10 text-sm" dir="rtl">
        אין נתוני ניהול ותפעול לבדיקה זו
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {hasBudgetPills && (
        <div className="flex gap-2 flex-wrap" dir="rtl">
          {budgetsWithNihul.map(b => (
            <button
              key={b.name}
              onClick={() => setActiveBudget(b.name)}
              aria-pressed={(activeBudget ?? budgetsWithNihul[0]?.name) === b.name}
              style={PILL_STYLE((activeBudget ?? budgetsWithNihul[0]?.name) === b.name)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
      <YozmaSupplierBreakdown
        breakdown={breakdownData}
        title="פירוט ספקים - ניהול ותפעול"
      />
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
  const [activeBudgetName, setActiveBudgetName] = useState(null);
  const { summary, gefen_only } = result;
  const perComboResults = result.per_combo_results;
  const perCombos = perComboResults ? Object.values(perComboResults) : null;

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

  const { division, finance_rows_total, finance_rows_checked, finance_file } = summary;
  const softwareLabel = finance_file?.software ?? "תוכנת הכספים";
  const label    = DIVISION_LABELS[division] ?? division;
  const filtered = finance_rows_total !== finance_rows_checked;

  // Build pill list: prefer tikhnun plan budgets, fall back to per_combo keys
  const tikhnunBudgets = (
    result.tikhnun?.budgets ||
    result.tikhnun_tikkon?.budgets ||
    result.tikhnun_beinayim?.budgets ||
    []
  ).map(b => b.name);
  const pillBudgets = tikhnunBudgets.length > 0
    ? tikhnunBudgets
    : perCombos ? [...new Set(perCombos.map(c => c.budget))] : [];

  const hasPills = pillBudgets.length > 1 || (pillBudgets.length === 1 && perCombos);
  const effectiveBudget = hasPills ? (activeBudgetName ?? pillBudgets[0] ?? null) : null;
  const selectedCombos = (perCombos && effectiveBudget)
    ? perCombos.filter(c => c.budget === effectiveBudget)
    : perCombos ?? null;
  const selectedCombo = selectedCombos?.[0] ?? null;
  const isNotChecked = selectedCombo?.not_checked === true;

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

  if (hasPills) {
    return (
      <div className="flex flex-col gap-4">
        <div className="anim-fade-up glass-card-dark rounded-2xl px-5 py-3.5 flex items-center justify-center flex-wrap gap-2">
          <span className="text-sm text-slate-500">בדיקה מפורטת לפי תקציב</span>
        </div>
        <div className="flex gap-2 flex-wrap" dir="rtl">
          {pillBudgets.map((bname) => (
            <button
              key={bname}
              onClick={() => setActiveBudgetName(bname)}
              aria-pressed={effectiveBudget === bname}
              style={PILL_STYLE(effectiveBudget === bname)}
            >
              {bname}
            </button>
          ))}
        </div>
        {isNotChecked ? (
          <div className="anim-fade-up bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800 text-right" dir="rtl">
            {selectedCombo.not_checked_text || `לא ניתן היה לבצע השוואה עבור תקציב ${effectiveBudget} — לא נמצאו נתוני כספים תואמים`}
          </div>
        ) : selectedCombo ? (
          <>
            <ResultTable
              title={`קיים ב${softwareLabel}, לא משויך בגפן — ${effectiveBudget}`}
              rows={selectedCombo.in_finance_not_gefen}
              columns={UNIFIED_COLS} index={1} showSum
              headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)"
            />
            <ResultTable
              title={`משויך בגפן, לא קיים ב${softwareLabel} — ${effectiveBudget}`}
              rows={selectedCombo.in_gefen_not_finance}
              columns={UNIFIED_COLS} index={2} showSum
              headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)"
            />
          </>
        ) : (
          <div className="anim-fade-up bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800 text-right" dir="rtl">
            {`לא ניתן היה לבצע השוואה עבור תקציב ${effectiveBudget} — לא נמצאו נתוני כספים תואמים`}
          </div>
        )}
      </div>
    );
  }

  // No pills — single combo or no per_combo (legacy path)
  const financeRows = selectedCombo ? selectedCombo.in_finance_not_gefen : (result.rows_finance_not_gefen ?? []);
  const gefenRows   = selectedCombo ? selectedCombo.in_gefen_not_finance  : (result.rows_gefen_not_finance  ?? []);

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
      <ResultTable title={`קיים ב${softwareLabel}, לא משויך בגפן`}
        rows={financeRows} columns={UNIFIED_COLS} index={1} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
      <ResultTable title={`משויך בגפן, לא קיים ב${softwareLabel}`}
        rows={gefenRows} columns={UNIFIED_COLS} index={2} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
    </div>
  );
}

function RejectedTab({ result, rows: rowsOverride, tikhnun: tikhnunProp }) {
  const [activeBudgetIdx, setActiveBudgetIdx] = useState(0);
  const tikhnun = tikhnunProp ?? result.tikhnun;
  const perBudget = tikhnun?.per_budget_rejected;
  const budgets = tikhnun?.budgets;
  const isMultiBudget = budgets && budgets.length > 1;

  if (perBudget != null) {
    if (isMultiBudget) {
      const safeIdx = Math.min(activeBudgetIdx, budgets.length - 1);
      const selectedName = budgets[safeIdx]?.name;
      const rows = perBudget[selectedName] ?? [];
      return (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 flex-wrap" dir="rtl">
            {budgets.map((b, i) => (
              <button
                key={i}
                onClick={() => setActiveBudgetIdx(i)}
                style={{
                  fontWeight: safeIdx === i ? 700 : 500,
                  fontSize: "12px",
                  padding: "4px 14px",
                  borderRadius: "20px",
                  border: `1.5px solid ${safeIdx === i ? "#0070F3" : "#e2e8f0"}`,
                  background: safeIdx === i ? "#0070F3" : "transparent",
                  color: safeIdx === i ? "white" : "#64748b",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="glass-card-dark rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center gap-2 py-12">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
                  <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין אסמכתאות שנדחו</span>
              </div>
            </div>
          ) : (
            <ResultTable
              title={`אסמכתאות שנדחו — ${selectedName}`}
              rows={rows}
              columns={REJECTED_COLS}
              index={0}
              showSum
              headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)"
            />
          )}
        </div>
      );
    }
    // Single budget with per_budget_rejected
    const singleRows = Object.values(perBudget)[0] ?? [];
    return (
      <div className="flex flex-col gap-4">
        {singleRows.length === 0 ? (
          <div className="glass-card-dark rounded-2xl overflow-hidden">
            <div className="flex items-center justify-center gap-2 py-12">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
                <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין אסמכתאות שנדחו</span>
            </div>
          </div>
        ) : (
          <ResultTable title="אסמכתאות שנדחו" rows={singleRows} columns={REJECTED_COLS} index={0} showSum
            headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
        )}
      </div>
    );
  }

  // Fallback: no tikhnun identification — use provided rows or flat list
  const rows = rowsOverride ?? result.rows_gefen_rejected ?? [];
  return (
    <div className="flex flex-col gap-4">
      <ResultTable title="אסמכתאות שנדחו" rows={rows} columns={REJECTED_COLS} index={0} showSum
        headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
    </div>
  );
}

function NoPdfTab({ result, rows: rowsOverride, tikhnun: tikhnunProp }) {
  const [activeBudgetIdx, setActiveBudgetIdx] = useState(0);
  const tikhnun = tikhnunProp ?? result.tikhnun;
  const perBudget = tikhnun?.per_budget_no_pdf;
  const budgets = tikhnun?.budgets;
  const isMultiBudget = budgets && budgets.length > 1;

  if (perBudget != null) {
    if (isMultiBudget) {
      const safeIdx = Math.min(activeBudgetIdx, budgets.length - 1);
      const selectedName = budgets[safeIdx]?.name;
      const rows = perBudget[selectedName] ?? [];
      return (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 flex-wrap" dir="rtl">
            {budgets.map((b, i) => (
              <button
                key={i}
                onClick={() => setActiveBudgetIdx(i)}
                style={{
                  fontWeight: safeIdx === i ? 700 : 500,
                  fontSize: "12px",
                  padding: "4px 14px",
                  borderRadius: "20px",
                  border: `1.5px solid ${safeIdx === i ? "#0070F3" : "#e2e8f0"}`,
                  background: safeIdx === i ? "#0070F3" : "transparent",
                  color: safeIdx === i ? "white" : "#64748b",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="glass-card-dark rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center gap-2 py-12">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
                  <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין אסמכתאות ללא PDF</span>
              </div>
            </div>
          ) : (
            <ResultTable
              title={`אסמכתאות ללא PDF — ${selectedName}`}
              rows={rows}
              columns={UNIFIED_COLS}
              index={0}
              showSum
              headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)"
            />
          )}
        </div>
      );
    }
    // Single budget with per_budget_no_pdf
    const singleRows = Object.values(perBudget)[0] ?? [];
    return (
      <div className="flex flex-col gap-4">
        {singleRows.length === 0 ? (
          <div className="glass-card-dark rounded-2xl overflow-hidden">
            <div className="flex items-center justify-center gap-2 py-12">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
                <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין אסמכתאות ללא PDF</span>
            </div>
          </div>
        ) : (
          <ResultTable title="אסמכתאות ללא PDF" rows={singleRows} columns={UNIFIED_COLS} index={0} showSum
            headerGradient="linear-gradient(135deg, #0c237d 0%, #091a60 100%)" />
        )}
      </div>
    );
  }

  // Fallback: no tikhnun identification — use provided rows or flat list
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

export default function ResultsView({ result, runId, onNewRun, onTikhnunUpdate = () => {}, schoolId, currentUser }) {
  const [activeTab, setActiveTab]       = useState("hashva");
  const [activeBudgetIdx, setActiveBudgetIdx] = useState(0);
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
      const perCombo = result.per_combo_results;
      if (perCombo != null) {
        return Object.values(perCombo).some(
          c => !c.not_checked && (c.in_finance_not_gefen.length + c.in_gefen_not_finance.length > 0)
        );
      }
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
      const _budgetsWithYozma = (tikhnun?.budgets || []).filter(b => b.yozma_03);
      if (_budgetsWithYozma.length <= 1) {
        setShowYozmaDialog(true);
        return;
      }
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
              {hasTikhnun && <SikarTab tikhnun={tikhnun} activeBudgetIdx={activeBudgetIdx} setActiveBudgetIdx={setActiveBudgetIdx} />}
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
              {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><RejectedTab result={result} rows={tikkon} tikhnun={tikhnunTikkon} /></DualTikhnunSection>}
              {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><RejectedTab result={result} rows={beinayim} tikhnun={tikhnunBeinayim} /></DualTikhnunSection>}
            </div>
          );
        })()}
        {activeTab === "nopdf" && !isDualTikhnun && <NoPdfTab result={result} />}
        {activeTab === "nopdf" && isDualTikhnun && (() => {
          const { tikkon, beinayim } = splitByDivision(result.rows_gefen_no_pdf ?? []);
          return (
            <div className="flex flex-col gap-24">
              {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><NoPdfTab result={result} rows={tikkon}   tikhnun={tikhnunTikkon} /></DualTikhnunSection>}
              {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><NoPdfTab result={result} rows={beinayim} tikhnun={tikhnunBeinayim} /></DualTikhnunSection>}
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
        {activeTab === "partial" && !isDualTikhnun && (
          <PartialTab tikhnun={hasTikhnun ? tikhnun : null} activeBudgetIdx={activeBudgetIdx} setActiveBudgetIdx={setActiveBudgetIdx}
            schoolId={schoolId} division="main" currentUser={currentUser} />
        )}
        {activeTab === "partial" && isDualTikhnun && (
          <div className="flex flex-col gap-24">
            {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><PartialTab tikhnun={tikhnunTikkon} schoolId={schoolId} division="tikkon" currentUser={currentUser} /></DualTikhnunSection>}
            {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><PartialTab tikhnun={tikhnunBeinayim} schoolId={schoolId} division="beinayim" currentUser={currentUser} /></DualTikhnunSection>}
          </div>
        )}
        <div style={{ display: activeTab === "yozma" && !isDualTikhnun ? undefined : "none" }}>
          <YozmaTab tikhnun={hasTikhnun ? tikhnun : null} multiplier={yozmaMultiplier} autoSwitch={yozmaAutoSwitch} />
        </div>
        <div className="flex flex-col gap-24" style={{ display: activeTab === "yozma" && isDualTikhnun ? undefined : "none" }}>
          {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><YozmaTab tikhnun={tikhnunTikkon} multiplier={yozmaMultiplierTikkon} autoSwitch={yozmaAutoSwitchTikkon} /></DualTikhnunSection>}
          {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><YozmaTab tikhnun={tikhnunBeinayim} multiplier={yozmaMultiplierBeinayim} autoSwitch={yozmaAutoSwitchBeinayim} /></DualTikhnunSection>}
        </div>
        {activeTab === "nihul" && !isDualTikhnun && (
          <NihulTab tikhnun={hasTikhnun ? tikhnun : null} />
        )}
        {activeTab === "nihul" && isDualTikhnun && (
          <div className="flex flex-col gap-24">
            {tikhnunTikkon   && <DualTikhnunSection label={tikhnunTikkon.school_stage}><NihulTab tikhnun={tikhnunTikkon} /></DualTikhnunSection>}
            {tikhnunBeinayim && <DualTikhnunSection label={tikhnunBeinayim.school_stage}><NihulTab tikhnun={tikhnunBeinayim} /></DualTikhnunSection>}
          </div>
        )}
      </div>

      <TabDownloadBar
        activeTab={activeTab}
        runId={runId}
        hasTikhnun={hasTikhnun}
        tikhnunOnly={tikhnunOnly}
        yozmaMultiplier={yozmaMultiplier}
        availableTabs={availableTabs}
        onNewRun={onNewRun}
      />
    </div>
  );
}
