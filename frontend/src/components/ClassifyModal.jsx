import { useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

const CLASSIFY_STAGES = ["תיכון", "חטיבת ביניים", "יסודי"];

export default function ClassifyModal({ item, runId, onComplete, onCancel }) {
  const { division } = item;
  const [currentTikhnun, setCurrentTikhnun] = useState(item.tikhnun);
  const rows = currentTikhnun.unidentified_rows ?? [];
  const availableBudgets = currentTikhnun.available_budgets ?? [];
  const [selections, setSelections] = useState(() =>
    Object.fromEntries(rows.map(r => [r.union_key, { budget: null, stage: null, skip: false }]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [financeFiles, setFinanceFiles] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryInfo, setRetryInfo] = useState("");
  const fileInputRef = useRef(null);
  const { ref, handleKeyDown } = useFocusTrap(onCancel || (() => {}));

  const allAnswered = rows.every(r => {
    const s = selections[r.union_key];
    return s.skip || (s.budget && s.stage);
  });

  function setField(unionKey, field, value) {
    setSelections(prev => ({
      ...prev,
      [unionKey]: { ...prev[unionKey], [field]: value },
    }));
  }

  function toggleSkip(unionKey) {
    setSelections(prev => {
      const cur = prev[unionKey];
      return { ...prev, [unionKey]: { budget: null, stage: null, skip: !cur.skip } };
    });
  }

  async function handleRetry() {
    if (!runId) {
      setRetryError("שגיאה: מזהה ריצה חסר. סגור את החלונית ונסה בדיקה חדשה.");
      return;
    }
    setRetrying(true);
    setRetryError("");
    setRetryInfo("");
    const form = new FormData();
    financeFiles.forEach(f => form.append("files", f));
    form.append("division", division);
    try {
      const { data } = await axios.post(`/analyze/retry-finance/${runId}`, form);
      if (!data.pending) {
        onComplete(division, data.tikhnun, data.per_combo_results ?? null);
      } else {
        const prevCount = rows.length;
        const newRows = data.tikhnun.unidentified_rows ?? [];
        const identified = prevCount - newRows.length;
        setCurrentTikhnun(data.tikhnun);
        setSelections(Object.fromEntries(
          newRows.map(r => [r.union_key, { budget: null, stage: null, skip: false }])
        ));
        setFinanceFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (data.tikhnun.finance_invalid_reason) {
          // invalid reason shown in yellow box above — no additional message needed
        } else if (identified > 0) {
          setRetryInfo(`זוהו ${identified} שורות אוטומטית. נותרו ${newRows.length} שורות לסיווג ידני.`);
        } else {
          setRetryInfo("הקובץ עובד אך לא הצליח לזהות שורות. בחר קובץ אחר או סווג ידנית.");
        }
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      setRetryError(typeof detail === "string" ? detail : "שגיאה בעיבוד הקובץ. נסה שוב.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleSkipAll() {
    setSubmitting(true);
    setError("");
    try {
      const skipped = rows.map(r => r.union_key);
      const { data } = await axios.post(`/analyze/classify/${runId}`, {
        classifications: [], skipped, division,
      });
      onComplete(division, data.tikhnun, data.per_combo_results ?? null);
    } catch (err) {
      setError(err.response?.data?.detail || "שגיאה. נסה שוב.");
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const classifications = [];
      const skipped = [];
      for (const r of rows) {
        const s = selections[r.union_key];
        if (s.skip) {
          skipped.push(r.union_key);
        } else {
          classifications.push({ union_key: r.union_key, budget: s.budget, stage: s.stage });
        }
      }
      const { data } = await axios.post(`/analyze/classify/${runId}`, {
        classifications, skipped, division,
      });
      onComplete(division, data.tikhnun, data.per_combo_results ?? null);
    } catch (err) {
      setError(err.response?.data?.detail || "שגיאה בשמירת הסיווג. נסה שוב.");
      setSubmitting(false);
    }
  }

  const covered = currentTikhnun.covered_budgets ?? [];
  const missing = currentTikhnun.missing_budgets ?? [];
  const invalidReason = currentTikhnun.finance_invalid_reason ?? null;
  const needsUpload = currentTikhnun.needs_finance_upload;
  const allBudgets = [...covered, ...missing];

  function getUploadExplanation() {
    const budgetList = allBudgets.length > 0 ? `לבית הספר הוגדרו תקציבים: ${allBudgets.join(", ")}.` : "";
    if (covered.length === 0) {
      return `${budgetList} לא הועלו קבצי כספים. העלאת קובץ/קבצי כספים תאפשר זיהוי אוטומטי של השורות.`;
    }
    return `${budgetList} הועלה קובץ כספים עבור: ${covered.join(", ")}. יש להעלות קובץ כספים גם עבור: ${missing.join(", ")} (ניתן לבחור מספר קבצים).`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classify-modal-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-3xl p-7 w-full anim-fade-up text-right overflow-y-auto"
        dir="rtl"
        style={{ maxWidth: 640, maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(251,191,36,0.12)" }}>
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M11 2.5L19.5 17.5H2.5L11 2.5Z" stroke="#d97706" strokeWidth="1.7" strokeLinejoin="round"/>
                <path d="M11 9v4M11 15v.5" stroke="#d97706" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="ביטול וסגירה"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: "#94a3b8", padding: "4px", borderRadius: "8px", lineHeight: 1,
                }}
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          <h2 id="classify-modal-title" className="text-lg mb-2" style={{ fontWeight: 800, color: "#0f172a" }}>
            נמצאו {rows.length} שורות לא מזוהות
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            לא ניתן להציג את ניתוח התכנון עד שכל השורות יזוהו. יש לפעול לפי האפשרויות הבאות.
          </p>
        </div>

        {/* Finance upload section — always shown while rows remain unidentified */}
        {rows.length > 0 && (
          <div className="rounded-2xl p-4 mb-6 border"
            style={{ background: "rgba(239,246,255,0.8)", borderColor: "#bfdbfe" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#1e40af" }}>
              אפשרות 1: {needsUpload ? "העלאת קובץ מתוכנת הכספים" : "נסה עם קובץ כספים אחר"}
            </p>
            {invalidReason ? (
              <div role="alert" className="rounded-xl px-3 py-2 mb-3 text-xs leading-relaxed"
                style={{ background: "#fef9c3", border: "1px solid #fde047", color: "#854d0e" }}>
                ⚠ {invalidReason}
              </div>
            ) : (
              <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                {getUploadExplanation()}
              </p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="file"
                hidden
                multiple
                ref={fileInputRef}
                accept=".xlsx,.xls"
                id="classify-finance-file-input"
                onChange={e => { setFinanceFiles(Array.from(e.target.files || [])); setRetryInfo(""); setRetryError(""); }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  fontSize: "13px", padding: "6px 14px", borderRadius: "20px",
                  border: "1.5px solid #93c5fd", background: "white",
                  color: "#1d4ed8", cursor: "pointer", fontWeight: 600,
                }}
              >
                {financeFiles.length > 0 ? "החלף קבצים" : "בחר קבצי כספים"}
              </button>
              {financeFiles.length > 0 && (
                <span className="text-xs text-slate-500">
                  {financeFiles.length === 1
                    ? financeFiles[0].name
                    : `${financeFiles.length} קבצים נבחרו`}
                </span>
              )}
            </div>
            {financeFiles.length > 0 && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="btn-blue mt-3 py-2 px-5 text-sm"
                style={{ opacity: retrying ? 0.6 : 1, cursor: retrying ? "not-allowed" : "pointer" }}
              >
                {retrying ? "⏳ מעבד קבצים..." : "התחל בדיקה"}
              </button>
            )}
            {retryInfo && (
              <div role="status" className="mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed"
                style={{ background: "#dbeafe", border: "1px solid #93c5fd", color: "#1e3a8a" }}>
                ✓ {retryInfo}
              </div>
            )}
            {retryError && (
              <div role="alert" className="mt-3 rounded-xl px-3 py-2 text-xs"
                style={{ background: "#fee2e2", border: "1px solid #fecaca", color: "#dc2626" }}>
                {retryError}
              </div>
            )}
          </div>
        )}

        {/* Manual classification section */}
        <div className="mb-2">
          <p className="text-sm font-semibold mb-3" style={{ color: "#0f172a" }}>
            אפשרות 2: סיווג ידני
          </p>
          <div className="flex flex-col gap-4 mb-4">
            {rows.map((row, i) => {
              const sel = selections[row.union_key];
              return (
                <div key={row.union_key}
                  className="rounded-2xl p-4 border"
                  style={{ background: sel.skip ? "rgba(248,250,252,0.6)" : "white", borderColor: sel.skip ? "#e2e8f0" : "#dbeafe" }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex flex-col gap-0.5 text-right min-w-0">
                      <span className="text-sm" style={{ fontWeight: 700, color: sel.skip ? "#94a3b8" : "#0f172a" }}>
                        {row.supplier || "—"}
                      </span>
                      <span className="text-xs text-slate-400">
                        חשבונית: {row.invoice || "—"} | קוד: {row.report_code || "—"} | סכום: ₪{row.amount || "—"}
                      </span>
                      {row.date && <span className="text-xs text-slate-300">{row.date}</span>}
                    </div>
                    <span className="text-xs text-slate-300 whitespace-nowrap flex-shrink-0">שורה {i + 1}</span>
                  </div>

                  <div className="mb-2.5">
                    <p className="text-xs text-slate-400 mb-1.5">תקציב:</p>
                    <div className="flex gap-2 flex-wrap">
                      {availableBudgets.map(b => (
                        <button
                          key={b}
                          disabled={sel.skip}
                          onClick={() => setField(row.union_key, "budget", b)}
                          style={{
                            fontSize: "12px", padding: "4px 12px", borderRadius: "20px",
                            border: `1.5px solid ${sel.budget === b ? "#0070F3" : "#e2e8f0"}`,
                            background: sel.budget === b ? "#0070F3" : "transparent",
                            color: sel.skip ? "#cbd5e1" : sel.budget === b ? "white" : "#64748b",
                            cursor: sel.skip ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                            fontWeight: sel.budget === b ? 700 : 500,
                          }}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-3">
                    <p className="text-xs text-slate-400 mb-1.5">שלב חינוכי:</p>
                    <div className="flex gap-2 flex-wrap">
                      {CLASSIFY_STAGES.map(s => (
                        <button
                          key={s}
                          disabled={sel.skip}
                          onClick={() => setField(row.union_key, "stage", s)}
                          style={{
                            fontSize: "12px", padding: "4px 12px", borderRadius: "20px",
                            border: `1.5px solid ${sel.stage === s ? "#0070F3" : "#e2e8f0"}`,
                            background: sel.stage === s ? "#0070F3" : "transparent",
                            color: sel.skip ? "#cbd5e1" : sel.stage === s ? "white" : "#64748b",
                            cursor: sel.skip ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                            fontWeight: sel.stage === s ? 700 : 500,
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => toggleSkip(row.union_key)}
                    style={{
                      fontSize: "12px", padding: "3px 12px", borderRadius: "20px",
                      border: `1.5px solid ${sel.skip ? "#94a3b8" : "#e2e8f0"}`,
                      background: sel.skip ? "#f1f5f9" : "transparent",
                      color: sel.skip ? "#475569" : "#94a3b8",
                      cursor: "pointer", transition: "all 0.15s", fontWeight: 500,
                    }}
                  >
                    {sel.skip ? "✓ מדולגת — לחץ לביטול" : "דלג על שורה זו"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl px-4 py-2.5 text-sm"
            style={{ background: "#fee2e2", border: "1px solid #fecaca", color: "#dc2626" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className="btn-blue w-full py-3 text-sm mb-3"
          style={{ opacity: (!allAnswered || submitting) ? 0.5 : 1, cursor: (!allAnswered || submitting) ? "not-allowed" : "pointer" }}
        >
          {submitting ? "שומר..." : "אשר סיווגים והמשך"}
        </button>
        {!allAnswered && (
          <p className="text-center text-xs text-slate-400 mb-3">יש לסווג את כל השורות (או לסמן לדילוג) לפני האישור</p>
        )}

        <button
          onClick={handleSkipAll}
          disabled={submitting}
          className="w-full py-2.5 text-sm mb-3"
          style={{
            borderRadius: "12px", border: "1.5px solid #e2e8f0",
            background: "transparent", color: "#94a3b8",
            cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500,
          }}
        >
          המשך ללא שורות אלו (דלג על הכל)
        </button>

        {onCancel && (
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full py-2.5 text-sm"
            style={{
              borderRadius: "12px", border: "1.5px solid #fecaca",
              background: "transparent", color: "#dc2626",
              cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500,
            }}
          >
            ביטול הבדיקה
          </button>
        )}
      </div>
    </div>
  );
}
