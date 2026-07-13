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

function UploadResultModal({ mode, missing, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const isError = mode === "error";
  const allReceived = mode === "complete";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="upload-result-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-3 text-center">
        <span className="text-3xl" aria-hidden="true">{isError ? "❌" : allReceived ? "🎉" : "⚠️"}</span>
        <h2 id="upload-result-title" className="text-base font-bold text-slate-800">
          {isError ? "אירעה שגיאה בהעלאה" : allReceived ? "תודה רבה! כל הקבצים הנדרשים התקבלו" : "עדיין חסרים קבצים"}
        </h2>
        {isError && (
          <p className="text-sm text-slate-600 leading-relaxed">נסו שוב, או פנו ליועץ שלכם אם השגיאה חוזרת.</p>
        )}
        {!isError && !allReceived && (
          <p className="text-sm text-slate-600 leading-relaxed">
            תודה על המאמץ שלך, אבל אנחנו צריכים שתעלי גם את <b>{missing.join(", ")}</b> כדי שהמאמץ שלך לא יהיה לשווא.
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

export default function MeetingUploadPage() {
  const { token } = useParams();
  const [status, setStatus] = useState("loading"); // loading | invalid | expired | ready
  const [data, setData] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [resultModal, setResultModal] = useState(null); // { allReceived, missing } | "error" | null
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function load() {
    axios.get(`/public/meeting-upload/${token}`)
      .then(res => { setData(res.data); setStatus("ready"); })
      .catch(err => {
        setStatus(err?.response?.status === 410 ? "expired" : "invalid");
      });
  }

  useEffect(() => { load(); }, [token]);

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

  async function handleSubmit() {
    if (!pendingFiles.length || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      pendingFiles.forEach(f => form.append("files", f));
      const res = await axios.post(`/public/meeting-upload/${token}/files`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const missing = (res.data.items || []).filter(i => !i.received).map(i => i.label);
      setResultModal({ mode: res.data.all_received ? "complete" : "partial", missing });
      setPendingFiles([]);
      load();
    } catch {
      setResultModal({ mode: "error", missing: [] });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg anim-fade-up">
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

              {data.no_baseline_this_year && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
                  טרם בוצעה בדיקה עבור בית הספר בשנת הלימודים הנוכחית — הרשימה למטה כללית.
                </p>
              )}

              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-2">קבצים נדרשים:</h2>
                <ul className="text-sm space-y-1.5">
                  {data.items.map((item, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span aria-hidden="true" className={item.received ? "text-green-600" : "text-slate-400"}>
                        {item.received ? "✓" : "○"}
                      </span>
                      <span className={item.received ? "text-slate-500 line-through" : "text-slate-700"}>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <label htmlFor="upload-dropzone" className="sr-only">גרירת קבצים להעלאה</label>
              <div
                id="upload-dropzone"
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
                  aria-label="בחירת קבצים להעלאה"
                  className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
                />
                <p className="text-sm text-slate-500">
                  גררו לכאן קבצים, או לחצו לבחירה
                </p>
              </div>

              {pendingFiles.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">קבצים לשליחה:</h2>
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
                  <button type="button" onClick={handleSubmit} disabled={uploading}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                    {uploading ? "שולח..." : "שליחת קבצים"}
                  </button>
                </div>
              )}

              {data.already_uploaded?.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">קבצים שהועלו עד כה:</h2>
                  <ul className="text-sm text-slate-500 list-disc pr-5 space-y-1">
                    {data.already_uploaded.map((f, i) => <li key={i}>{f.original_filename}</li>)}
                  </ul>
                </div>
              )}
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
          missing={resultModal.missing}
          onClose={() => setResultModal(null)}
        />
      )}
    </div>
  );
}
