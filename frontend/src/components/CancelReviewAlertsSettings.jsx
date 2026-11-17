import { useEffect, useState } from "react";
import axios from "axios";

// Owner-only, org-wide: daily alerts on meetings still "בוטלה" (the cancellation's cause wasn't
// looked into yet — "בוטלה ונבדקה" marks that it was). Off by default; the owner picks who gets
// them. Backend: GET/PUT /schools/meetings/cancel-review-alerts + backend/cancel_review_alerts.py.
const ROLE_LABEL = { owner: "בעלים", manager: "מנהל/ת", advisor: "יועץ/ת" };

export default function CancelReviewAlertsSettings() {
  const [enabled, setEnabled] = useState(null);
  const [recipientIds, setRecipientIds] = useState([]);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      axios.get("/schools/meetings/cancel-review-alerts"),
      axios.get("/schools/users/all"),
    ]).then(([s, u]) => {
      setEnabled(!!s.data?.enabled);
      setRecipientIds(s.data?.recipient_ids || []);
      setUsers((u.data || []).filter(p => p.role && p.status !== "pending"));
    }).catch(() => setError("לא ניתן לטעון את ההגדרה — נסו לרענן"));
  }, []);

  const managerIds = users.filter(u => u.role === "owner" || u.role === "manager").map(u => u.id);

  async function save(patch) {
    setSaving(true);
    setError("");
    try {
      await axios.put("/schools/meetings/cancel-review-alerts", patch);
      return true;
    } catch {
      setError("השמירה נכשלה — נסו שוב");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    const next = !enabled;
    const patch = { enabled: next };
    // First time on with nobody chosen: owners and managers are pre-selected (can be changed).
    if (next && recipientIds.length === 0 && managerIds.length) patch.recipient_ids = managerIds;
    if (await save(patch)) {
      setEnabled(next);
      if (patch.recipient_ids) setRecipientIds(patch.recipient_ids);
    }
  }

  async function setRecipients(ids) {
    const prev = recipientIds;
    setRecipientIds(ids);
    if (!(await save({ recipient_ids: ids }))) setRecipientIds(prev);
  }

  function toggleUser(id) {
    setRecipients(recipientIds.includes(id) ? recipientIds.filter(x => x !== id) : [...recipientIds, id]);
  }

  const label = "שלח התראה יומית על פגישות שבוטלו וטרם נבדקו";

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">🚫 בדיקת ביטולי פגישות (לכל הארגון)</h3>
      <p className="text-xs text-slate-500 leading-snug">
        על כל פגישה שעברה לסטטוס "בוטלה" תישלח התראה פעם ביום, עד שתעודכן ל"בוטלה ונבדקה" (או לסטטוס אחר).
        ההתראות נשלחות בימים א'–ה' בין 08:00 ל-20:00 ובשישי בין 08:00 ל-15:00, ורק על ביטולים מרגע ההפעלה.
      </p>
      {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {enabled === null && !error ? (
        <div role="status" aria-label="טוען הגדרת בדיקת ביטולים" className="text-xs text-slate-400 py-1">טוען…</div>
      ) : enabled !== null && (
        <>
          <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
            <span className="text-sm text-slate-700 leading-snug">{label}</span>
            <button
              role="switch"
              aria-checked={enabled}
              aria-label={label}
              disabled={saving}
              onClick={toggleEnabled}
              className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${
                enabled ? "bg-blue-600" : "bg-slate-300"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  enabled ? "translate-x-0.5" : "translate-x-5"
                }`}
              />
            </button>
          </label>
          {enabled && (
            <fieldset className="border border-slate-200 rounded-xl p-3 flex flex-col gap-1">
              <legend className="text-xs font-medium text-slate-600 px-1">מי יקבל את ההתראה?</legend>
              <button
                type="button"
                onClick={() => setRecipients([...new Set([...recipientIds, ...managerIds])])}
                disabled={saving}
                className="self-start text-xs text-blue-600 hover:underline disabled:opacity-50 mb-1"
              >
                בחר את כל הבעלים והמנהלים
              </button>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                {users.map(u => (
                  <label key={u.id} htmlFor={`cancel-review-user-${u.id}`} className="flex items-center gap-2 text-sm text-slate-700 py-0.5 cursor-pointer">
                    <input
                      id={`cancel-review-user-${u.id}`}
                      type="checkbox"
                      checked={recipientIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      disabled={saving}
                    />
                    <span>{u.full_name || u.email}</span>
                    <span className="text-xs text-slate-400">{ROLE_LABEL[u.role] || ""}</span>
                  </label>
                ))}
              </div>
              {recipientIds.length === 0 && (
                <p className="text-xs text-amber-700">לא נבחר אף משתמש — לא יישלחו התראות.</p>
              )}
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
