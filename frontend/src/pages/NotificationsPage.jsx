import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import { useFocusTrap } from "../hooks/useFocusTrap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "עכשיו";
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דק׳`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שע׳`;
  if (diff < 604800) return `לפני ${Math.floor(diff / 86400)} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const TYPE_ICON = {
  update_request_submitted: "✏️",
  update_request_approved:  "✅",
  update_request_rejected:  "❌",
  update_request_result:    "📋",
  school_created:           "➕",
  mention:                  "💬",
  advisor_assigned:         "🏫",
  advisor_removed:          "🚪",
  school_deleted:           "🗑️",
  meeting_reminder:         "🗓️",
  meeting_files_arrived:    "📎",
};

const FIELD_LABEL = {
  name: "שם בית ספר", symbol: "סמל מוסד", city: "עיר", authority: "רשות",
  stage: "שלב", finance_software: "תוכנת כספים",
  address: "כתובת", district: "מחוז", notes: "הערות", school_phone: "טלפון בית ספר",
  principal_name: "שם מנהל/ת", principal_phone: "טלפון מנהל/ת", principal_email: "מייל מנהל/ת",
  secretary_name: "שם מזכיר/ה", secretary_phone: "טלפון מזכיר/ה", secretary_email: "מייל מזכיר/ה",
  finance_contact_name: "איש קשר כספים", finance_contact_phone: "טלפון כספים", finance_contact_email: "מייל כספים",
};

const VALUE_LABEL = {
  // stage
  yesodi: "יסודי", beinayim: "חטיבת ביניים", tikkon: "תיכון",
  sheshshnati: "שש-שנתי", other: "אחר",
  // finance_software
  kesafim2000: "כספים 2000", payscool: "פייסקול", schoolcash: "סקולקאש",
};

function formatValue(val) {
  if (val === null || val === undefined || val === "") return "—";
  return VALUE_LABEL[val] ?? String(val);
}

function ProposedChangesDiff({ changes, currentValues, fieldDecisions, onDecide }) {
  if (!changes || Object.keys(changes).filter(k => k !== "_action").length === 0) return null;
  const entries = Object.entries(changes).filter(([k]) => k !== "_action");
  const hasCurrentValues = currentValues && Object.keys(currentValues).length > 0;
  const isInteractive = !!onDecide && entries.length > 1;

  const cols = isInteractive
    ? (hasCurrentValues ? "grid-cols-[1fr_1fr_1fr_auto]" : "grid-cols-[1fr_1fr_auto]")
    : (hasCurrentValues ? "grid-cols-3" : "grid-cols-2");

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-slate-200">
      <div className={`grid ${cols} text-xs font-semibold text-slate-500 bg-slate-50 px-3 py-2 border-b border-slate-200`}>
        <span>שדה</span>
        {hasCurrentValues && <span>ערך נוכחי</span>}
        <span>ערך חדש</span>
        {isInteractive && <span />}
      </div>
      {entries.map(([k, v]) => {
        const decision = fieldDecisions?.[k] ?? "pending";
        const isRejected = decision === "rejected";
        const isApproved = decision === "approved";
        return (
          <div key={k}
            className={`grid ${cols} text-sm px-3 py-1.5 border-b border-slate-100 last:border-0 items-center transition-colors
              ${isRejected ? "bg-red-50/50 opacity-50" : isApproved ? "bg-green-50/50" : ""}`}
          >
            <span className={`text-slate-500 ${isRejected ? "line-through" : ""}`}>{FIELD_LABEL[k] || k}</span>
            {hasCurrentValues && (
              <span className="text-slate-400">{formatValue(currentValues[k])}</span>
            )}
            <span className={`text-slate-800 font-medium ${isRejected ? "line-through" : ""}`}>{formatValue(v)}</span>
            {isInteractive && (
              <div className="flex gap-1 justify-end">
                <button
                  onClick={() => onDecide(k, isApproved ? "pending" : "approved")}
                  aria-label="אשר שדה זה"
                  className={`w-6 h-6 rounded-full text-xs font-bold transition-colors flex items-center justify-center
                    ${isApproved ? "bg-green-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-green-100 hover:text-green-600"}`}
                >✓</button>
                <button
                  onClick={() => onDecide(k, isRejected ? "pending" : "rejected")}
                  aria-label="דחה שדה זה"
                  className={`w-6 h-6 rounded-full text-xs font-bold transition-colors flex items-center justify-center
                    ${isRejected ? "bg-red-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-red-100 hover:text-red-600"}`}
                >✕</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RequestResultDiff({ changes, approvedFields, status }) {
  if (!changes || Object.keys(changes).filter(k => k !== "_action").length === 0) return null;
  const entries = Object.entries(changes).filter(([k]) => k !== "_action");
  const allApproved = status === "approved" && approvedFields == null;
  const allRejected = status === "rejected";
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-slate-200">
      <div className="grid grid-cols-2 text-xs font-semibold text-slate-500 bg-slate-50 px-3 py-2 border-b border-slate-200">
        <span>שדה</span>
        <span>ערך מבוקש</span>
      </div>
      {entries.map(([k, v]) => {
        const isApproved = allApproved || (approvedFields != null && approvedFields.includes(k));
        const isRejected = allRejected || (approvedFields != null && !approvedFields.includes(k));
        return (
          <div key={k} className={`grid grid-cols-2 text-sm px-3 py-1.5 border-b border-slate-100 last:border-0 items-center
            ${isApproved ? "bg-green-50" : isRejected ? "bg-red-50" : ""}`}>
            <span className="flex items-center gap-1.5 text-slate-600">
              {isApproved
                ? <span className="text-green-600 font-bold text-base leading-none">✓</span>
                : isRejected
                ? <span className="text-red-500 font-bold text-base leading-none">✕</span>
                : null}
              {FIELD_LABEL[k] || k}
            </span>
            <span className={`font-medium ${isApproved ? "text-green-800" : isRejected ? "text-red-700 line-through opacity-70" : "text-slate-800"}`}>
              {formatValue(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

function PrefToggle({ label, prefKey, prefs, saving, savePrefs }) {
  const val = prefs?.[prefKey] ?? true;
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
      <span className="text-sm text-slate-700 leading-snug">{label}</span>
      <button
        role="switch"
        aria-checked={val}
        aria-label={label}
        disabled={saving || !prefs}
        onClick={() => savePrefs({ [prefKey]: !val })}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${
          val ? "bg-blue-600" : "bg-slate-300"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            val ? "translate-x-0.5" : "translate-x-5"
          }`}
        />
      </button>
    </label>
  );
}

function SettingsModal({ onClose, role }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  useEffect(() => {
    axios.get("/schools/users/me").then(r => {
      setPrefs(r.data.notification_preferences || { meeting_reminder: true, meeting_reminder_minutes: 10 });
    }).catch(() => {});
  }, []);

  async function savePrefs(patch) {
    setPrefs(prev => ({ ...prev, ...patch }));
    setSaving(true);
    try {
      await axios.patch("/schools/users/me/notification-preferences", patch);
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }

  const notifRows = role === "owner"
    ? [
        { label: "יועץ הגיש בקשה לעדכון פרטי בית ספר",   prefKey: "notify_update_request_submitted" },
        { label: "מנהל אישר או דחה בקשת עדכון",           prefKey: "notify_update_request_result" },
        { label: "בית ספר חדש נוסף על ידי יועץ או מנהל", prefKey: "notify_school_created" },
        { label: "בית ספר נמחק על ידי מנהל או יועץ",      prefKey: "notify_school_deleted" },
        { label: "תפקיד של משתמש בצוות שונה",              prefKey: "notify_role_changed" },
        { label: "תויגתי בהערת פגישה",                     prefKey: "notify_mention" },
      ]
    : role === "manager"
    ? [
        { label: "יועץ הגיש בקשה לעדכון פרטי בית ספר", prefKey: "notify_update_request_submitted" },
        { label: "יועץ הוסיף בית ספר חדש",              prefKey: "notify_school_created" },
        { label: "תפקיד של משתמש בצוות שונה",           prefKey: "notify_role_changed" },
        { label: "תויגתי בהערת פגישה",                   prefKey: "notify_mention" },
      ]
    : [
        { label: "הבקשה שלי לעדכון פרטים אושרה או נדחתה", prefKey: "notify_update_request_reviewed" },
        { label: "שויכתי לבית ספר חדש או הוסרתי",          prefKey: "notify_advisor_assignment" },
        { label: "תויגתי בהערת פגישה",                      prefKey: "notify_mention" },
      ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 id="settings-modal-title" className="text-lg font-bold text-slate-900">התאמה אישית</h2>
          <button
            aria-label="סגור"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-lg hover:bg-slate-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Meeting reminders section */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">🗓️ פגישות</h3>
            <PrefToggle
              label="קבל תזכורות לפגישות"
              prefKey="meeting_reminder"
              prefs={prefs}
              saving={saving}
              savePrefs={savePrefs}
            />
            {(prefs?.meeting_reminder ?? true) && (
              <div className="flex items-center gap-3 pr-1">
                <label htmlFor="reminder-minutes-modal" className="text-xs text-slate-500 whitespace-nowrap">כמה זמן מראש?</label>
                <select
                  id="reminder-minutes-modal"
                  className="input-field text-sm py-1.5 flex-1"
                  value={prefs?.meeting_reminder_minutes ?? 10}
                  onChange={e => savePrefs({ meeting_reminder_minutes: Number(e.target.value) })}
                  disabled={saving || !prefs}
                >
                  <option value={5}>5 דקות לפני</option>
                  <option value={10}>10 דקות לפני</option>
                  <option value={15}>15 דקות לפני</option>
                  <option value={30}>30 דקות לפני</option>
                </select>
              </div>
            )}
          </div>

          {/* Per-event toggles */}
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">🔔 שלח לי התראה כאשר:</h3>
            {notifRows.map(({ label, prefKey }) => (
              <PrefToggle
                key={prefKey}
                label={label}
                prefKey={prefKey}
                prefs={prefs}
                saving={saving}
                savePrefs={savePrefs}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meeting-files-arrived expandable detail
// ---------------------------------------------------------------------------

function MeetingFilesArrivedDetail({ meetingId, schoolId }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState("idle"); // idle | working | sent | failed

  useEffect(() => {
    Promise.all([
      axios.get(`/schools/meetings/${meetingId}/upload-comparison`),
      axios.get(`/schools/meetings/${meetingId}/uploaded-files`),
    ])
      .then(([cmpRes, filesRes]) => { setComparison(cmpRes.data); setFiles(filesRes.data || []); })
      .catch(() => setError("שגיאה בטעינת פרטי הקבצים"))
      .finally(() => setLoading(false));
  }, [meetingId]);

  async function handleDownload(fileId, filename) {
    try {
      const res = await axios.get(`/schools/meetings/${meetingId}/uploaded-files/${fileId}/download`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  }

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
      await axios.post(`/analyze/meetings/${meetingId}/run-check-from-uploads`);
      navigate(`/school/${schoolId}?tab=checks`);
    } catch {
      setActionState("failed");
    }
  }

  if (loading) return <p className="text-sm text-slate-500 py-3" role="status">טוען...</p>;
  if (error) return <p className="text-sm text-red-600 py-3" role="alert">{error}</p>;
  if (!comparison) return null;

  return (
    <div className="pt-2">
      {comparison.no_baseline_this_year && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          טרם בוצעה בדיקה עבור בית הספר בשנת הלימודים הנוכחית — לא ניתן לקבוע בוודאות שכל מה שנדרש התקבל.
        </p>
      )}

      {files.length > 0 && (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100">
              <th scope="col" className="text-right font-medium pb-1.5">שם הקובץ</th>
              <th scope="col" className="text-right font-medium pb-1.5">סוג הקובץ</th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => (
              <tr key={f.id} className="border-b border-slate-50 last:border-0">
                <td className="py-1.5">
                  <button type="button" onClick={() => handleDownload(f.id, f.filename)}
                    className="text-blue-600 hover:underline text-right">
                    {f.filename}
                  </button>
                </td>
                <td className="py-1.5 text-slate-600">{f.type_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ul className="space-y-1 mb-3">
        {comparison.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={item.received ? "text-green-600" : "text-red-500"}>
              {item.received ? "✓" : "✗"}
            </span>
            <span className={item.received ? "text-slate-500" : "text-slate-700"}>{item.label}</span>
          </li>
        ))}
      </ul>

      {actionState === "sent" && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-2" role="status">
          נשלחה בקשה למנהלנית עם פירוט הקבצים החסרים.
        </p>
      )}
      {actionState === "failed" && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2" role="alert">
          אירעה שגיאה. נסה שוב.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={handleRunCheck} disabled={actionState === "working" || files.length === 0}
          className="flex-1 text-sm py-2.5 rounded-xl font-medium text-white bg-green-700 hover:bg-green-800 transition-colors disabled:opacity-50">
          {actionState === "working" ? "מריץ..." : "בצע בדיקה עם הקבצים שהתקבלו"}
        </button>
        {!comparison.all_received && (
          <button type="button" onClick={handleRequestMissing} disabled={actionState === "working" || actionState === "sent"}
            className="flex-1 text-sm py-2.5 rounded-xl font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50">
            {actionState === "working" ? "שולח..." : "שלח בקשה מחודשת למנהלנית"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single notification row
// ---------------------------------------------------------------------------

function NotificationRow({ notif, isExpanded, onToggle, onRead, onReload, onDeleteApproved, role }) {
  const navigate = useNavigate();
  const isUnread  = !notif.read_at;
  const icon      = TYPE_ICON[notif.type] || "🔔";
  const title     = notif.data?.title || "התראה";
  const data      = notif.data || {};
  const isActionable = notif.type === "update_request_submitted";
  const isResultExpandable = (
    notif.type === "update_request_approved" ||
    notif.type === "update_request_rejected" ||
    notif.type === "update_request_result"
  ) && !!data.proposed_changes;
  const isFilesArrived = notif.type === "meeting_files_arrived" && !!notif.ref_id;

  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldDecisions, setFieldDecisions] = useState({});  // { [fieldKey]: "pending" | "approved" | "rejected" }
  // Initialize from DB status so remounting after navigation shows the correct state
  const [reviewed, setReviewed] = useState(() => {
    if (!isActionable) return null;
    const s = data.request_status;
    if (s === "approved") return "approved";
    if (s === "rejected") return "rejected";
    return null;
  }); // null | "approved" | "rejected" | "already_done"
  // True only when THIS viewer performed the action — distinguishes "I approved" from "already processed by someone else"
  const [reviewedByViewer, setReviewedByViewer] = useState(false);

  function setFieldDecision(field, decision) {
    setFieldDecisions(prev => ({ ...prev, [field]: decision }));
  }

  async function handleNavigate() {
    // Actionable notifications (approve/reject) only get marked read after the review action,
    // not on simple expand — otherwise the buttons disappear before the user can act.
    if (isUnread && !isActionable) onRead(notif.id);
    if (isActionable || isResultExpandable || isFilesArrived) {
      onToggle(notif.id);
    } else if (data.deeplink) {
      navigate(data.deeplink);
    } else {
      onToggle(notif.id);
    }
  }

  async function handleReview(status, approvedFields = null) {
    if (submitting || reviewed) return;
    setSubmitting(true);
    try {
      const body = { status, reviewer_note: reviewNote || null };
      if (approvedFields !== null) body.approved_fields = approvedFields;
      await axios.patch(`/schools/update-requests/${notif.ref_id}`, body);
      setReviewed(status);
      setReviewedByViewer(true);
      onRead(notif.id);
      if (status === "approved" && data.is_delete_request && data.school_name) {
        onDeleteApproved?.(data.school_name);
      }
      setTimeout(() => {
        onToggle(notif.id);
        onReload();
      }, 2500);
    } catch (err) {
      if (err.response?.status === 400) {
        // Request was already processed (e.g. race condition or double-click)
        setReviewed("already_done");
        setTimeout(() => { onToggle(notif.id); onReload(); }, 2500);
      } else {
        console.error("handleReview failed:", err?.response?.status, err?.response?.data, err?.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`rounded-2xl transition-colors ${
        isUnread ? "bg-blue-50/60 border border-blue-100" : "bg-white border border-slate-100"
      }`}
    >
      {/* Row header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-right"
        onClick={handleNavigate}
        aria-expanded={isExpanded}
      >
        {/* Unread dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${isUnread ? "bg-blue-500" : "bg-transparent"}`} aria-hidden="true" />

        <span className="text-xl flex-shrink-0" aria-hidden="true">{icon}</span>

        <span className={`flex-1 text-sm leading-snug text-right ${isUnread ? "font-semibold text-slate-900" : "font-normal text-slate-600"}`}>
          {title}
        </span>

        <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">{timeAgo(notif.created_at)}</span>

        {(isActionable || isResultExpandable || isFilesArrived) && (
          <span aria-hidden="true" className={`text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>›</span>
        )}
      </button>

      {/* Expanded: uploaded-files comparison + actions (meeting_files_arrived) */}
      {isExpanded && isFilesArrived && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <MeetingFilesArrivedDetail meetingId={notif.ref_id} schoolId={notif.school_id} />
        </div>
      )}

      {/* Expanded: result diff for advisor (approved/rejected notification) */}
      {isExpanded && isResultExpandable && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <RequestResultDiff
            changes={data.proposed_changes}
            approvedFields={data.approved_fields ?? null}
            status={
              notif.type === "update_request_approved" ? "approved" :
              notif.type === "update_request_result" ? (data.status || "approved") :
              "rejected"
            }
          />
          {data.reviewer_note && (
            <p className="text-xs text-slate-500 mt-3 italic">הערת סוקר: {data.reviewer_note}</p>
          )}
        </div>
      )}

      {/* Expanded: inline diff + approve/reject */}
      {isExpanded && isActionable && (() => {
        const isDeleteRequest = data.is_delete_request === true;
        return (
          <div className="px-4 pb-4 border-t border-blue-100">
            {!isDeleteRequest && (() => {
              const entries = Object.entries(data.proposed_changes || {}).filter(([k]) => k !== "_action");
              const isMultiField = entries.length > 1;
              return (
                <ProposedChangesDiff
                  changes={data.proposed_changes}
                  currentValues={data.current_values}
                  fieldDecisions={isMultiField ? fieldDecisions : undefined}
                  onDecide={isMultiField && !reviewed ? setFieldDecision : undefined}
                />
              );
            })()}

            {reviewed ? (
              <div
                role="status"
                aria-label={
                  reviewedByViewer && reviewed === "approved" ? "הבקשה אושרה" :
                  reviewedByViewer && reviewed === "rejected" ? "הבקשה נדחתה" :
                  "הבקשה כבר טופלה"
                }
                className={`mt-4 py-3 px-4 rounded-xl text-sm font-semibold text-center ${
                  reviewedByViewer && reviewed === "approved"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : reviewedByViewer && reviewed === "rejected"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-slate-50 text-slate-600 border border-slate-200"
                }`}
              >
                {reviewedByViewer && reviewed === "approved"
                  ? (isDeleteRequest ? "✓ בית הספר נמחק בהצלחה" : "✓ השינויים אושרו ויושמו בהצלחה")
                  : reviewedByViewer && reviewed === "rejected"
                  ? "✗ הבקשה נדחתה"
                  : "ℹ בקשה זו כבר טופלה"}
              </div>
            ) : (role === "owner" || role === "manager") && (
              <div className="mt-4 flex flex-col gap-2">
                {!isDeleteRequest && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`note-${notif.id}`} className="text-xs text-slate-500">הערה (אופציונלי)</label>
                    <input
                      id={`note-${notif.id}`}
                      className="input-field text-sm"
                      placeholder="הערה לסוקר..."
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                )}
                <div className="flex gap-2 justify-center">
                  <button
                    className="btn-green-light text-sm flex-1 py-2 disabled:opacity-50"
                    onClick={() => {
                      if (isDeleteRequest) { handleReview("approved"); return; }
                      const entries = Object.entries(data.proposed_changes || {}).filter(([k]) => k !== "_action");
                      const isMultiField = entries.length > 1;
                      if (!isMultiField) { handleReview("approved"); return; }
                      const hasDecisions = Object.values(fieldDecisions).some(d => d !== "pending");
                      const approvedList = entries.filter(([k]) => fieldDecisions[k] !== "rejected").map(([k]) => k);
                      if (approvedList.length === 0) { handleReview("rejected"); return; }
                      handleReview("approved", hasDecisions ? approvedList : null);
                    }}
                    disabled={submitting}
                  >
                    {submitting ? "שולח..." : isDeleteRequest ? "✓ אשר מחיקה" : (() => {
                      const entries = Object.entries(data.proposed_changes || {}).filter(([k]) => k !== "_action");
                      const hasRejected = entries.some(([k]) => fieldDecisions[k] === "rejected");
                      return hasRejected ? "✓ אשר שדות נבחרים" : "✓ אשר שינויים";
                    })()}
                  </button>
                  <button
                    className="text-sm flex-1 py-2 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                    onClick={() => handleReview("rejected")}
                    disabled={submitting}
                  >
                    ✕ דחה הכל
                  </button>
                </div>
              </div>
            )}

            {data.reviewer_note && !reviewed && (
              <p className="text-xs text-slate-500 mt-3 italic">הערת סוקר: {data.reviewer_note}</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recycle bin info modal
// ---------------------------------------------------------------------------

function RecycleBinInfoModal({ schoolName, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recycle-modal-title">
      <div ref={ref} onKeyDown={handleKeyDown} className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4 text-right" dir="rtl">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🗑️</span>
          <h2 id="recycle-modal-title" className="text-lg font-bold text-slate-900">הועבר לסל המחזור</h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">
          בית הספר <span className="font-semibold">{schoolName}</span> הועבר לסל המחזור ונתוניו יימחקו לחלוטין מהמערכת תוך 30 יום.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          אם תרצו לשחזר את בית הספר, ניתן לבצע זאת בפרק הזמן הזה בלבד דרך אזור <span className="font-medium">ניהול ← בתי ספר ← סל מחזור</span>.
        </p>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-sm font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
            autoFocus
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NotificationsPage() {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [role, setRole]             = useState("advisor");
  const [expandedId, setExpandedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [recycleInfoSchoolName, setRecycleInfoSchoolName] = useState(null);
  const headerRef = useRef(null);

  async function load() {
    try {
      const res = await axios.get("/schools/notifications");
      setItems(res.data.items || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setRole(session.user.user_metadata?.role || "advisor");
      try {
        const me = await axios.get("/schools/users/me");
        setRole(me.data.role || "advisor");
      } catch {}
      load();
    })();
  }, []);

  const handleToggle = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleRead = useCallback((id) => {
    axios.patch(`/schools/notifications/${id}/read`).catch(() => {});
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  }, []);

  async function handleMarkAll() {
    setMarkingAll(true);
    try {
      await axios.patch("/schools/notifications/read-all");
      const now = new Date().toISOString();
      setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Header */}
          <div ref={headerRef} className="relative flex items-center justify-between mb-8 gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">התראות</h1>
              {!loading && unreadCount > 0 && (
                <p className="text-sm text-slate-500 mt-0.5">{unreadCount} התראות שטרם נקראו</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-2 rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-50"
                  onClick={handleMarkAll}
                  disabled={markingAll}
                >
                  {markingAll ? "מעדכן..." : "כבר קראתי הכל"}
                </button>
              )}
              <button
                aria-label="הגדרות התראות"
                aria-expanded={showSettings}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                onClick={() => setShowSettings(v => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                התאמה אישית
              </button>
            </div>

            {showSettings && (
              <SettingsModal onClose={() => setShowSettings(false)} role={role} />
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div role="status" aria-label="טוען התראות" className="flex justify-center py-20">
              <div aria-hidden="true" className="spinner w-10 h-10" />
            </div>
          )}

          {/* Empty state */}
          {!loading && items.length === 0 && (
            <div className="glass-card rounded-2xl p-12 text-center text-slate-500">
              <p className="text-4xl mb-3">🔔</p>
              <p className="font-medium">אין התראות</p>
              <p className="text-sm mt-1">כאן יופיעו כל ההתראות הרלוונטיות לחשבונך</p>
            </div>
          )}

          {/* Notifications list */}
          {!loading && items.length > 0 && (
            <div className="flex flex-col gap-2" role="list" aria-label="רשימת התראות">
              {items.map(notif => (
                <div key={notif.id} role="listitem">
                  <NotificationRow
                    notif={notif}
                    isExpanded={expandedId === notif.id}
                    onToggle={handleToggle}
                    onRead={handleRead}
                    onReload={load}
                    onDeleteApproved={setRecycleInfoSchoolName}
                    role={role}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {recycleInfoSchoolName && (
        <RecycleBinInfoModal
          schoolName={recycleInfoSchoolName}
          onClose={() => setRecycleInfoSchoolName(null)}
        />
      )}
    </div>
  );
}
