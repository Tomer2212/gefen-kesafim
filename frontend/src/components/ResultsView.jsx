import { useState } from "react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const UNIFIED_COLS = [
  { key: "קוד דיווח",   label: "קוד דיווח"   },
  { key: "שם ספק",      label: "שם ספק"       },
  { key: "מספר אסמכתה", label: "מספר אסמכתא" },
  { key: "תאריך",       label: "תאריך"        },
  { key: "סכום",        label: "סכום פריט"    },
  { key: "תיאור",       label: "תיאור"        },
];

const REJECTED_COLS = [
  { key: "קוד דיווח",   label: "קוד דיווח"   },
  { key: "שם ספק",      label: "שם ספק"       },
  { key: "מספר אסמכתה", label: "מספר אסמכתא" },
  { key: "תאריך",       label: "תאריך"        },
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
  partial:  "ביצוע חסר",
  yozma:    "יוזמות וצרכים",
  kvua:     "תקציב קבוע",
};
// tabs disabled when no tikhnun data
const TIKHNUN_ONLY_TABS = ["sikar", "kvua", "partial", "yozma"];
// tabs disabled when tikhnun-only (no gefen execution data)
const GEFEN_ONLY_TABS = ["rejected", "nopdf"];

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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
                  <th key={col.key} className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                    style={{ fontWeight: 700, background: thBg, letterSpacing: "0.02em" }}>
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
                    <td key={col.key} className="px-4 py-2.5 text-right text-slate-700 align-middle" style={{ maxWidth: "200px" }}>
                      <span className="block truncate text-xs" title={row[col.key] || "—"}>
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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
// Download bar (per-tab)
// ---------------------------------------------------------------------------

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 17 17" fill="none" className="flex-shrink-0">
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

function TabDownloadBar({ activeTab, runId, authHeader, hasTikhnun, yozmaMultiplier, onNewRun }) {
  const [dlExcel, setDlExcel] = useState(false);
  const [dlPdf,   setDlPdf]   = useState(false);
  const [pdfErr,  setPdfErr]  = useState(false);

  const isTikhnunTab = TIKHNUN_ONLY_TABS.includes(activeTab);
  const excelUrl = isTikhnunTab
    ? `/analyze/download-tikhnun/${runId}?section=${activeTab}&multiplier=${yozmaMultiplier}`
    : `/analyze/download/${runId}`;
  const pdfUrl = isTikhnunTab
    ? `/analyze/pdf-tikhnun/${runId}?section=${activeTab}&multiplier=${yozmaMultiplier}`
    : `/analyze/pdf/${runId}`;
  const excelName = isTikhnunTab ? `tikhnun-${activeTab}.xlsx` : "hashvaa-gefen-ksafim.xlsx";
  const pdfName   = isTikhnunTab ? `tikhnun-${activeTab}.pdf`  : "hashvaa-gefen-kesafim.pdf";

  async function handleExcel() {
    if (dlExcel || dlPdf) return;
    setDlExcel(true);
    try {
      const res = await axios.get(excelUrl, { headers: authHeader, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = excelName; a.click();
      URL.revokeObjectURL(url);
    } catch {}
    finally { setDlExcel(false); }
  }

  async function handlePdf() {
    if (dlExcel || dlPdf) return;
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

  return (
    <div className="flex justify-center gap-3 mt-2 anim-fade-up-4 flex-wrap items-center">
      <button onClick={handleExcel} disabled={dlExcel || dlPdf}
        className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
        style={{ fontWeight: 700, background: "rgba(34,197,94,0.09)", color: "#16a34a", border: "1.5px solid rgba(34,197,94,0.28)" }}>
        {dlExcel ? <><Spinner dark /><span>מוריד...</span></> : <><DownloadIcon /><span>הורד קובץ Excel</span></>}
      </button>

      {(!isTikhnunTab || hasTikhnun) && (
        <button onClick={handlePdf} disabled={dlExcel || dlPdf}
          className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
          style={{ fontWeight: 700, background: pdfErr ? "#fee2e2" : "rgba(239,68,68,0.08)", color: "#dc2626", border: "1.5px solid rgba(239,68,68,0.25)" }}>
          {dlPdf ? <><Spinner dark /><span>מוריד...</span></> : pdfErr ? <span>שגיאה, נסה שוב</span> : <><DownloadIcon /><span>הורד קובץ PDF</span></>}
        </button>
      )}

      <button onClick={onNewRun} className="btn-ghost flex items-center gap-2 px-5 py-3 text-sm font-600" style={{ fontWeight: 600 }}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="flex-shrink-0">
          <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        בדיקה חדשה
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yozma dialog
// ---------------------------------------------------------------------------

function YozmaDialog({ onAnswer, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
      <div className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right" dir="rtl">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(0,112,243,0.09)" }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#0070F3" strokeWidth="1.6"/>
            <path d="M10 6.5c0-1.1.9-2 2-2a2 2 0 0 1 1.4 3.4L10 11" stroke="#0070F3" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="14" r=".8" fill="#0070F3"/>
          </svg>
        </div>
        <h2 className="text-base font-800 mb-3" style={{ fontWeight: 800, color: "#0f172a" }}>
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

// ---------------------------------------------------------------------------
// Tikhnun tab content components
// ---------------------------------------------------------------------------

function NoTikhnunNotice() {
  return (
    <div className="glass-card-dark rounded-2xl overflow-hidden">
      <div className="flex items-center justify-center gap-2 py-14">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
              {hasMulti && <th className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                style={{ fontWeight: 700, background: "linear-gradient(135deg, #2D5FA0 0%, #1e4a8a 100%)" }}>סוג תקציב</th>}
              {["שלב חינוך", "סל", "תת סל", "תקציב קבוע", "תקציב שתוכנן", "הפרש שלא תוכנן"].map(h => (
                <th key={h} className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                  style={{ fontWeight: 700, background: "linear-gradient(135deg, #2D5FA0 0%, #1e4a8a 100%)" }}>
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
      <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
        <span className="text-xs font-700 text-slate-500" style={{ fontWeight: 700 }}>
          {rows.length} תוכניות עם ביצוע חלקי
        </span>
        <span className="text-xs font-700 text-slate-500" style={{ fontWeight: 700 }}>
          סה"כ הפרש לטיפול: <span className="text-slate-700">{fmtNum(totalHefresh)}</span>
        </span>
      </div>
      <div className="table-scroll">
        <table className="w-full text-sm border-collapse" dir="rtl">
          <thead>
            <tr>
              {["קוד דיווח", "שם מענה", "מספר מענה", "תכנון", "דיווח", "הפרש", "אחוז דיווח"].map(h => (
                <th key={h} className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                  style={{ fontWeight: 700, background: "linear-gradient(135deg, #2D5FA0 0%, #1e4a8a 100%)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100" style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs">{row.rcode}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 text-xs" style={{ maxWidth: "220px" }}>
                  <span className="block truncate" title={row.name}>{row.name}</span>
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
        ]} />
      </SummaryBlock>

      <div className="glass-card-dark rounded-2xl overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm border-collapse" dir="rtl">
            <thead>
              <tr>
                {["סעיף", "תקרה", "בתכנון", "הפרש שניתן לתכנון"].map(h => (
                  <th key={h} className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                    style={{ fontWeight: 700, background: "linear-gradient(135deg, #2D5FA0 0%, #1e4a8a 100%)" }}>
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
            <span className="font-700 text-slate-700" style={{ fontWeight: 700 }}>קובץ גפן בלבד</span>
          </span>
        </div>
        <GefenOnlyNotice title="קיים בתוכנת הכספים, לא משויך בגפן" index={1} />
        <GefenOnlyNotice title="משויך בגפן, לא קיים בתוכנת הכספים" index={2} />
        <SummaryBlock title="קבצי גפן" index={3}>
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

      <SummaryBlock title="קבצי גפן" index={3}>
        <GefenFilesDetail gefen_files={summary.gefen_files ?? []} gefen_rows={summary.gefen_rows} gefen_merge_note={summary.gefen_merge_note} />
      </SummaryBlock>
      <SummaryBlock title="קבצים מתוכנת הכספים" index={4}>
        <div className="px-2 flex flex-col gap-2">
          <InfoGrid rows={[
            { label: "שם קובץ",          value: finance_file?.filename },
            { label: "סוג תוכנה",         value: finance_file?.software },
            { label: "שלב",               value: STAGE_LABELS[division] ?? division },
            { label: "אסמכתאות שזוהו",   value: summary.finance_rows_total + (finance_file?.cancelled_rows ?? 0) },
            { label: "אסמכתאות מבוטלות", value: finance_file?.cancelled_rows ?? null },
          ]} />
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-1">
            {filtered && (
              <p className="text-xs text-slate-500">
                {`מתוך ${summary.finance_rows_total} שורות כספים, ${summary.finance_rows_checked} שייכות לשלב שנבדק.`}
              </p>
            )}
            <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
              {`סה"כ ${summary.finance_rows_checked} אסמכתאות ייחודיות`}
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
  );
}

function RejectedTab({ result }) {
  const rows = result.rows_gefen_rejected ?? [];
  return (
    <div className="flex flex-col gap-4">
      <ResultTable title="אסמכתאות שנדחו" rows={rows} columns={REJECTED_COLS} index={0} showSum
        headerGradient="linear-gradient(135deg, #2C3E50 0%, #1e2d3d 100%)" />
    </div>
  );
}

function NoPdfTab({ result }) {
  const rows = result.rows_gefen_no_pdf ?? [];
  return (
    <div className="flex flex-col gap-4">
      <ResultTable title="אסמכתאות ללא PDF" rows={rows} columns={UNIFIED_COLS} index={0} showSum
        headerGradient="linear-gradient(135deg, #2C3E50 0%, #1e2d3d 100%)" />
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
  const [yozmaDialogShown, setYozmaDialogShown] = useState(false);
  const [showYozmaDialog, setShowYozmaDialog]   = useState(false);
  const [yozmaMultiplier, setYozmaMultiplier]   = useState("03");
  const [yozmaAutoSwitch, setYozmaAutoSwitch]   = useState(false);

  const tikhnun    = result.tikhnun;
  const hasTikhnun = !!(tikhnun && !tikhnun.error);
  const tikhnunOnly = !!result.tikhnun_only;

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
    if (tab === "kvua")    return !!tikhnun.kvua_has_issues;
    if (tab === "partial") return !!tikhnun.partial_has_issues;
    if (tab === "yozma") {
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

  return (
    <div className="flex flex-col gap-5" dir="rtl">
      {showYozmaDialog && (
        <YozmaDialog onAnswer={handleYozmaAnswer} onCancel={() => setShowYozmaDialog(false)} />
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
        {activeTab === "sikar"    && <SikarTab   tikhnun={hasTikhnun ? tikhnun : null} />}
        {activeTab === "rejected" && <RejectedTab result={result} />}
        {activeTab === "nopdf"    && <NoPdfTab   result={result} />}
        {activeTab === "kvua"     && <KvuaTab    tikhnun={hasTikhnun ? tikhnun : null} />}
        {activeTab === "partial"  && <PartialTab tikhnun={hasTikhnun ? tikhnun : null} />}
        {activeTab === "yozma"    && (
          <YozmaTab
            tikhnun={hasTikhnun ? tikhnun : null}
            multiplier={yozmaMultiplier}
            autoSwitch={yozmaAutoSwitch}
          />
        )}
      </div>

      <TabDownloadBar
        activeTab={activeTab}
        runId={runId}
        authHeader={authHeader}
        hasTikhnun={hasTikhnun}
        yozmaMultiplier={yozmaMultiplier}
        onNewRun={onNewRun}
      />
    </div>
  );
}
