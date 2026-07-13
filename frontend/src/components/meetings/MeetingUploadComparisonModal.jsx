import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export default function MeetingUploadComparisonModal({ meetingId, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState("idle"); // idle | working | sent | failed

  useEffect(() => {
    axios.get(`/schools/meetings/${meetingId}/upload-comparison`)
      .then(res => setComparison(res.data))
      .catch(() => setError("שגיאה בטעינת ההשוואה"))
      .finally(() => setLoading(false));
  }, [meetingId]);

  async function handleRequestMissing() {
    setActionState("working");
    try {
      await axios.post(`/schools/meetings/${meetingId}/request-missing-files`);
      setActionState("sent");
    } catch {
      setActionState("failed");
    }
  }

  async function handleRunCheck() {
    setActionState("working");
    try {
      const res = await axios.post(`/analyze/meetings/${meetingId}/run-check-from-uploads`);
      navigate(`/check?run_id=${res.data.run_id}`);
    } catch {
      setActionState("failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-comparison-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl w-full max-w-md p-6"
      >
        <h2 id="upload-comparison-title" className="text-base font-bold text-slate-800 mb-4">
          קבצים שהתקבלו לפגישה
        </h2>

        {loading && <p className="text-sm text-slate-500" role="status">טוען...</p>}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        {comparison && (
          <>
            {comparison.no_baseline_this_year && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
                טרם בוצעה בדיקה עבור בית הספר בשנת הלימודים הנוכחית — לא ניתן לקבוע בוודאות שכל מה שנדרש התקבל.
              </p>
            )}

            <ul className="space-y-2 mb-5">
              {comparison.items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className={item.received ? "text-green-600" : "text-red-500"}>
                    {item.received ? "✓" : "✗"}
                  </span>
                  <span className={item.received ? "text-slate-700" : "text-slate-500"}>{item.label}</span>
                </li>
              ))}
            </ul>

            {actionState === "sent" && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-3" role="status">
                נשלחה בקשה למנהלנית עם פירוט הקבצים החסרים.
              </p>
            )}
            {actionState === "failed" && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-3" role="alert">
                אירעה שגיאה. נסה שוב.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
                סגור
              </button>
              {comparison.all_received ? (
                <button type="button" onClick={handleRunCheck} disabled={actionState === "working"}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {actionState === "working" ? "מריץ..." : "בצע בדיקה"}
                </button>
              ) : (
                <button type="button" onClick={handleRequestMissing} disabled={actionState === "working" || actionState === "sent"}
                  className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                  {actionState === "working" ? "שולח..." : "שלח למנהלנית בקשה לקבצים חסרים"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
