import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import logoImg from "../assets/logo.png";
import { useFocusTrap } from "../hooks/useFocusTrap";

function formatDateDDMMYYYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Shown after an actual send (partial or full) — always lists what WAS received,
// independently of whether anything was also rejected, so a mixed batch never reads
// as a total failure (this is the direct fix for the "no feedback" bug: a secretary
// whose files really did arrive must never be left thinking nothing went through).
function UploadResultModal({ mode, received, rejected, missing, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const isError = mode === "error";
  const hasReceived = (received || []).length > 0;
  const hasRejected = (rejected || []).length > 0;
  const allReceived = mode === "complete";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="upload-result-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-3 text-center">
        <span className="text-3xl" aria-hidden="true">{isError ? "❌" : allReceived ? "🎉" : hasReceived ? "✓" : "⚠️"}</span>
        <h2 id="upload-result-title" className="text-base font-bold text-slate-800">
          {isError ? "אירעה שגיאה בשליחה" : allReceived ? "תודה רבה! כל הקבצים הנדרשים התקבלו" : hasReceived ? "הקבצים נשלחו" : "לא נשלחו קבצים"}
        </h2>
        {isError && (
          <p className="text-sm text-slate-600 leading-relaxed">נסו שוב, או פנו ליועץ שלכם אם השגיאה חוזרת.</p>
        )}
        {hasReceived && (
          <div role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-right">
            <p className="font-semibold mb-1">✓ התקבלו בהצלחה:</p>
            <ul className="space-y-0.5">
              {received.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
        {hasRejected && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-right">
            <p className="font-semibold mb-1">✗ לא התקבלו:</p>
            <ul className="space-y-0.5">
              {rejected.map((r, i) => <li key={i}><b>{r.filename}</b>: {r.reason}</li>)}
            </ul>
          </div>
        )}
        {!isError && !allReceived && missing?.length > 0 && (
          <p className="text-sm text-slate-600 leading-relaxed">
            עדיין חסר: <b>{missing.join(", ")}</b>
          </p>
        )}
        <button type="button" onClick={onClose}
          className="mt-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors self-center">
          הבנתי
        </button>
      </div>
    </div>
  );
}

// Review-before-commit screen: shows the per-file validation result BEFORE anything is
// actually saved, so the user can fix problems or knowingly send only what's valid —
// instead of the old "upload immediately, find out after the fact" flow.
function FileReviewModal({ files, sending, onSendPartial, onReplace, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const validCount = files.filter(f => f.valid).length;
  const invalidCount = files.length - validCount;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="file-review-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3">
        <h2 id="file-review-title" className="text-base font-bold text-slate-800 text-center">
          בדיקת הקבצים
        </h2>
        <p className="text-sm text-slate-500 text-center">
          {invalidCount === 0 ? "כל הקבצים תקינים" : `${validCount} קבצים תקינים, ${invalidCount} לא תקינים`}
        </p>
        <ul className="text-sm space-y-2 max-h-64 overflow-y-auto">
          {files.map((f, i) => (
            <li key={i} className={`rounded-lg px-3 py-2 border ${f.valid ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true">{f.valid ? "✓" : "✗"}</span>
                <span className="font-semibold text-slate-700 truncate">{f.filename}</span>
              </div>
              {!f.valid && <p role="alert" className="text-red-600 mt-1">{f.reason}</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 mt-2">
          <button type="button" onClick={onSendPartial} disabled={sending || validCount === 0}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {sending ? "שולח..." : invalidCount === 0 ? "שליחה" : `שליחה חלקית (${validCount} קבצים תקינים)`}
          </button>
          {invalidCount > 0 && (
            <button type="button" onClick={onReplace} disabled={sending}
              className="w-full py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-50">
              החלפת הקבצים הלא תקינים
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={sending}
            className="w-full py-2 text-slate-500 hover:text-slate-700 text-sm transition-colors disabled:opacity-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function YearUploadSection({ token, year, standalone, onResult, onUploaded }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [review, setReview] = useState(null); // null | [{filename, kind, valid, reason}]
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const inputId = `upload-dropzone-${year.academic_year}`;

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setPendingFiles(prev => {
      const existingKeys = new Set(prev.map(f => `${f.name}-${f.size}-${f.lastModified}`));
      const newOnes = files.filter(f => !existingKeys.has(`${f.name}-${f.size}-${f.lastModified}`));
      return [...prev, ...newOnes];
    });
  }

  function removePendingFile(index) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function postFiles(filesToSend, commit) {
    const form = new FormData();
    form.append("academic_year", year.academic_year);
    form.append("commit", commit ? "true" : "false");
    filesToSend.forEach(f => form.append("files", f));
    return axios.post(`/public/meeting-upload/${token}/files`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  }

  async function handleCheck() {
    if (!pendingFiles.length || checking) return;
    setChecking(true);
    try {
      const res = await postFiles(pendingFiles, false);
      setReview(res.data.files || []);
    } catch {
      onResult({ mode: "error", received: [], rejected: [], missing: [] });
    } finally {
      setChecking(false);
    }
  }

  async function handleSendPartial() {
    if (!review || sending) return;
    const validFilenames = new Set(review.filter(f => f.valid).map(f => f.filename));
    const filesToSend = pendingFiles.filter(f => validFilenames.has(f.name));
    if (!filesToSend.length) return;
    setSending(true);
    try {
      const res = await postFiles(filesToSend, true);
      const missing = (res.data.items || []).filter(i => !i.received).map(i => i.label);
      const received = filesToSend.map(f => f.name).filter(name => !(res.data.rejected || []).some(r => r.filename === name));
      onResult({
        mode: res.data.all_received ? "complete" : "partial",
        received, rejected: res.data.rejected || [], missing,
      });
      // Keep whatever wasn't sent (invalid files) so the user can replace them; drop the sent ones.
      setPendingFiles(prev => prev.filter(f => !validFilenames.has(f.name)));
      setReview(null);
      onUploaded();
    } catch {
      onResult({ mode: "error", received: [], rejected: [], missing: [] });
    } finally {
      setSending(false);
    }
  }

  function handleReplace() {
    // Drop the invalid files from the pending list so the user re-adds corrected ones;
    // valid files stay queued and can be re-checked together with the replacements.
    const invalidFilenames = new Set((review || []).filter(f => !f.valid).map(f => f.filename));
    setPendingFiles(prev => prev.filter(f => !invalidFilenames.has(f.name)));
    setReview(null);
  }

  function handleCancelReview() {
    setReview(null);
  }

  return (
    <div className={standalone ? "" : "border border-slate-200 rounded-2xl p-4 h-full"}>
      {!standalone && (
        <h2 className="text-base font-bold text-slate-800 mb-3 text-center">
          שנת לימודים {year.academic_year}
        </h2>
      )}

      {year.no_baseline_this_year && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
          טרם בוצעה בדיקה עבור בית הספר בשנת הלימודים הזו — הרשימה למטה כללית.
        </p>
      )}

      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">קבצים נדרשים:</h3>
        <ul className="text-sm space-y-1.5">
          {year.items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden="true" className={item.received ? "text-green-600" : "text-slate-400"}>
                {item.received ? "✓" : "○"}
              </span>
              <span className={item.received ? "text-slate-500 line-through" : "text-slate-700"}>{item.label}</span>
            </li>
          ))}
        </ul>
        {year.gefen_budgets_pending && (
          <p role="status" aria-label="מעבד נתונים" className="text-xs text-blue-600 mt-2 flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            מעבד את הקבצים שהתקבלו — הרשימה תתעדכן בעוד כמה שניות
          </p>
        )}
      </div>

      <label htmlFor={inputId} className="sr-only">גרירת קבצים להעלאה — שנת לימודים {year.academic_year}</label>
      <div
        id={inputId}
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-3 ${
          dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label={`בחירת קבצים להעלאה — שנת לימודים ${year.academic_year}`}
          className="hidden"
          onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <p className="text-sm text-slate-500">
          גררו לכאן קבצים, או לחצו לבחירה
        </p>
      </div>

      {pendingFiles.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">קבצים לשליחה:</h3>
          <ul className="text-sm space-y-1.5 mb-3">
            {pendingFiles.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-slate-700 truncate">{f.name}</span>
                <button type="button" onClick={() => removePendingFile(i)}
                  aria-label={`הסרת ${f.name} מרשימת השליחה`}
                  className="text-slate-400 hover:text-red-600 transition-colors flex-shrink-0 text-base leading-none">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleCheck} disabled={checking}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {checking ? "בודק..." : `בדיקת קבצים — שנת לימודים ${year.academic_year}`}
          </button>
        </div>
      )}

      {year.already_uploaded?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">קבצים שהועלו עד כה:</h3>
          <ul className="text-sm text-slate-500 list-disc pr-5 space-y-1">
            {year.already_uploaded.map((f, i) => <li key={i}>{f.original_filename}</li>)}
          </ul>
        </div>
      )}

      {review && (
        <FileReviewModal
          files={review}
          sending={sending}
          onSendPartial={handleSendPartial}
          onReplace={handleReplace}
          onCancel={handleCancelReview}
        />
      )}
    </div>
  );
}

export default function MeetingUploadPage() {
  const { token } = useParams();
  const [status, setStatus] = useState("loading"); // loading | invalid | expired | ready
  const [data, setData] = useState(null);
  const [resultModal, setResultModal] = useState(null);

  function load() {
    axios.get(`/public/meeting-upload/${token}`)
      .then(res => { setData(res.data); setStatus("ready"); })
      .catch(err => {
        setStatus(err?.response?.status === 410 ? "expired" : "invalid");
      });
  }

  useEffect(() => { load(); }, [token]);

  // While a budget-classification background task is still running for any year
  // (gefen_budgets_pending), poll a few times so the checklist self-corrects without
  // the user needing to refresh manually — capped so a stuck task doesn't poll forever.
  useEffect(() => {
    const pending = (data?.years || []).some(y => y.gefen_budgets_pending);
    if (!pending) return;
    const timer = setTimeout(load, 3000);
    return () => clearTimeout(timer);
  }, [data, token]);

  const multiYear = (data?.years?.length || 0) > 1;

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className={`w-full anim-fade-up ${multiYear ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="glass-card rounded-3xl px-8 py-10">
          <div className="flex justify-center mb-6">
            <img src={logoImg} alt="גפן AI לוגו" className="h-20 w-auto object-contain" />
          </div>

          {status === "loading" && (
            <p className="text-sm text-slate-500 text-center" role="status" aria-label="טוען">טוען...</p>
          )}

          {status === "invalid" && (
            <p className="text-sm text-red-600 text-center" role="alert">
              קישור לא תקין. אנא פנו ליועץ שלכם לקבלת קישור חדש.
            </p>
          )}

          {status === "expired" && (
            <p className="text-sm text-red-600 text-center" role="alert">
              פג תוקפו של קישור זה. אנא פנו ליועץ שלכם לקבלת קישור חדש.
            </p>
          )}

          {status === "ready" && data && (
            <>
              <h1 className="text-lg font-bold text-slate-800 mb-1 text-center">
                העלאת קבצים לקראת הפגישה
              </h1>
              <p className="text-sm text-slate-500 mb-6 text-center">
                {data.school_name} · {formatDateDDMMYYYY(data.meeting_date)}
              </p>

              {multiYear && (
                <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-5 text-center">
                  לקראת הפגישה הזו מתבקשים קבצים עבור <b>{data.years.length} שנות לימוד שונות</b> — יש להעלות ולשלוח בנפרד עבור כל שנה, באזור המתאים לה למטה.
                </p>
              )}

              <div className={multiYear ? "grid grid-cols-1 sm:grid-cols-2 gap-4 items-start" : ""}>
                {data.years.map(year => (
                  <YearUploadSection
                    key={year.academic_year}
                    token={token}
                    year={year}
                    standalone={!multiYear}
                    onResult={setResultModal}
                    onUploaded={load}
                  />
                ))}
              </div>
            </>
          )}

          {(status === "invalid" || status === "expired") && (
            <div className="text-center mt-4">
              <Link to="/contact" className="text-sm text-blue-600 hover:underline">יצירת קשר</Link>
            </div>
          )}
        </div>
      </div>

      {resultModal && (
        <UploadResultModal
          mode={resultModal.mode}
          received={resultModal.received}
          rejected={resultModal.rejected}
          missing={resultModal.missing}
          onClose={() => setResultModal(null)}
        />
      )}
    </div>
  );
}
