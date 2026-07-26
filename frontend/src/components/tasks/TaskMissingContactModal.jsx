import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { RECIPIENT_ROLE_OPTIONS } from "./taskShared";

// Shown after a send action returns 409 with missing_contact_school_ids — lets the manager
// fill in the missing email/phone inline, saved directly to "פרטי בית הספר" (not task-scoped),
// then retries the send. Goes through PUT /tasks/{taskId}/schools/{schoolId}/contact-info
// (not a direct schools PATCH) because recipientRole can be "meeting_coordinator", an
// indirection that resolves to a *different* fixed role per school — only the backend knows
// which schools.<role>_email/<role>_phone column that resolves to for each one.
export default function TaskMissingContactModal({ taskId, schools, channel, recipientRole, onClose, onRetry }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [values, setValues] = useState(() =>
    Object.fromEntries(schools.map(s => [s.id, { email: "", phone: "" }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const needsPhone = channel === "whatsapp_twilio";
  const roleLabel = RECIPIENT_ROLE_OPTIONS.find(r => r.value === recipientRole)?.label || recipientRole;

  function setField(schoolId, key, value) {
    setValues(prev => ({ ...prev, [schoolId]: { ...prev[schoolId], [key]: value } }));
  }

  async function handleSaveAndRetry() {
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        schools.map(s => {
          const v = values[s.id];
          const body = {};
          if (needsPhone && v.phone) body.phone = v.phone;
          if (!needsPhone && v.email) body.email = v.email;
          if (Object.keys(body).length === 0) return Promise.resolve();
          return axios.put(`/tasks/${taskId}/schools/${s.id}/contact-info`, body);
        })
      );
      await onRetry();
    } catch {
      setError("שמירת פרטי הקשר נכשלה — נסה שוב.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-contact-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="missing-contact-title" className="font-bold text-black">
            חסרים פרטי קשר ({roleLabel})
          </h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          <p className="text-xs text-slate-500">
            לבתי הספר הבאים חסר {needsPhone ? "מספר טלפון" : "כתובת מייל"} עבור {roleLabel} — נדרש לשליחה בערוץ שנבחר. ניתן להזין כאן; זה יישמר גם ב"פרטי בית הספר".
          </p>
          {schools.map(s => (
            <div key={s.id} className="border border-slate-200 rounded-xl p-3">
              <div className="text-sm font-semibold text-slate-800 mb-2">{s.name}</div>
              <label htmlFor={`contact-${s.id}`} className="block text-xs text-slate-500 mb-1">
                {needsPhone ? "טלפון" : "מייל"}
              </label>
              <input
                id={`contact-${s.id}`}
                type={needsPhone ? "tel" : "email"}
                value={needsPhone ? values[s.id]?.phone : values[s.id]?.email}
                onChange={e => setField(s.id, needsPhone ? "phone" : "email", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400"
              />
            </div>
          ))}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">
            ביטול
          </button>
          <button
            onClick={handleSaveAndRetry}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "שומר..." : "שמור ושלח שוב"}
          </button>
        </div>
      </div>
    </div>
  );
}
