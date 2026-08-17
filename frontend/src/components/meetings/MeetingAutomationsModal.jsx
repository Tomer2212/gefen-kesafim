import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const AUTOMATIONS = [
  {
    key: "meeting_reminders_enabled",
    description: "שליחת תזכורת למשתתפים לפני פגישה",
  },
  {
    key: "secretary_upload_request_enabled",
    description: "שליחת בקשה למנהלנית להעלאת קבצים יום לפני פגישת גפן/מחוז",
  },
];

export default function MeetingAutomationsModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    axios.get("/schools/meetings/automations")
      .then(res => setSettings(res.data || {}))
      .catch(() => setError("טעינת האוטומציות נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key) {
    const next = !settings[key];
    setSavingKey(key);
    setError("");
    try {
      await axios.put("/schools/meetings/automations", { [key]: next });
      setSettings(prev => ({ ...prev, [key]: next }));
    } catch {
      setError("עדכון האוטומציה נכשל, נסה שוב");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="automations-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-2xl flex flex-col gap-4">
        <h2 id="automations-modal-title" className="font-bold text-slate-900 text-lg">אוטומציות</h2>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div role="status" aria-label="טוען אוטומציות" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="text-right py-2 px-2 font-semibold text-slate-600">תיאור</th>
                <th scope="col" className="text-right py-2 px-2 font-semibold text-slate-600 w-28">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {AUTOMATIONS.map(a => {
                const active = !!settings?.[a.key];
                const saving = savingKey === a.key;
                return (
                  <tr key={a.key} className="border-b border-slate-100">
                    <td className="py-3 px-2 text-slate-700">{a.description}</td>
                    <td className="py-3 px-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggle(a.key)}
                        aria-pressed={active}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-60 ${
                          active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-red-50 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        {saving ? "..." : active ? "פעיל" : "כבוי"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
        </div>
      </div>
    </div>
  );
}
