import { useEffect, useState } from "react";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = { pending: "ממתין", approved: "אושר", rejected: "נדחה" };
const STATUS_STYLE = {
  pending:  { background: "rgba(251,191,36,0.15)", color: "#b45309" },
  approved: { background: "rgba(22,163,74,0.12)",  color: "#15803d" },
  rejected: { background: "rgba(239,68,68,0.12)",  color: "#dc2626" },
};

function ChangesDiff({ changes }) {
  const FIELD_LABEL = {
    name: "שם בית ספר", symbol: "סמל מוסד", city: "עיר", authority: "רשות",
    principal_name: "שם מנהל/ת", principal_phone: "טלפון מנהל/ת",
    school_phone: "טלפון בית ספר", notes: "הערות",
  };
  return (
    <div className="flex flex-col gap-1 mt-2">
      {Object.entries(changes).map(([k, v]) => (
        <span key={k} className="text-xs text-slate-600">
          <span className="font-medium text-slate-700">{FIELD_LABEL[k] || k}:</span> {String(v)}
        </span>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("advisor");
  const [reviewing, setReviewing] = useState(null);
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setRole(session.user.user_metadata?.role || "advisor");
      try {
        const res = await axios.get("/schools/notifications");
        setItems(res.data.items || []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleReview(reqId, status) {
    setReviewing(reqId);
    try {
      await axios.patch(`/schools/update-requests/${reqId}`, { status, reviewer_note: reviewNote || null });
      const res = await axios.get("/schools/notifications");
      setItems(res.data.items || []);
      setReviewNote("");
    } finally {
      setReviewing(null);
    }
  }

  const isApprover = role === "owner" || role === "manager";

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: 240 }}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">התראות</h1>
          <p className="text-slate-500 text-sm mb-8">
            {isApprover
              ? "בקשות עדכון פרטים הממתינות לאישורך"
              : "סטטוס בקשות העדכון שהגשת"}
          </p>

          {loading && (
            <div role="status" aria-label="טוען" className="flex justify-center py-20">
              <div aria-hidden="true" className="spinner w-10 h-10" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="glass-card rounded-2xl p-12 text-center text-slate-500">
              {isApprover ? "אין בקשות ממתינות לאישור" : "לא הגשת בקשות עדכון עדיין"}
            </div>
          )}

          <div className="flex flex-col gap-4">
            {items.map(item => (
              <div key={item.id} className="glass-card rounded-2xl px-6 py-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="font-semibold text-slate-900 text-base">{item.schools?.name || "בית ספר"}</h2>
                    {isApprover && (
                      <p className="text-sm text-slate-500 mt-0.5">
                        הגיש: {item.requester?.full_name || item.requester?.email || "—"} · {formatDate(item.created_at)}
                      </p>
                    )}
                    {!isApprover && (
                      <p className="text-sm text-slate-500 mt-0.5">{formatDate(item.resolved_at || item.created_at)}</p>
                    )}
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0" style={STATUS_STYLE[item.status]}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>

                <div className="text-sm text-slate-600 mb-3">
                  <span className="text-xs text-slate-400 font-medium">שינויים מבוקשים:</span>
                  <ChangesDiff changes={item.proposed_changes} />
                </div>

                {item.reviewer_note && (
                  <p className="text-xs text-slate-500 mb-3 italic">הערת סוקר: {item.reviewer_note}</p>
                )}

                {isApprover && item.status === "pending" && (
                  <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`note-${item.id}`} className="text-xs text-slate-500">הערה (אופציונלי)</label>
                      <input
                        id={`note-${item.id}`}
                        className="input-field text-sm"
                        placeholder="הערה לסוקר..."
                        value={reviewing === item.id ? reviewNote : ""}
                        onChange={e => setReviewNote(e.target.value)}
                        onFocus={() => setReviewing(item.id)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReview(item.id, "approved")}
                        disabled={reviewing === item.id && reviewing !== null}
                        className="btn-blue text-sm px-5 py-2"
                      >
                        ✓ אשר שינויים
                      </button>
                      <button
                        onClick={() => handleReview(item.id, "rejected")}
                        disabled={reviewing === item.id && reviewing !== null}
                        className="text-sm px-5 py-2 rounded-xl font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        ✕ דחה
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Owner delegation setting */}
          {role === "owner" && !loading && (
            <DelegationSetting />
          )}
        </div>
      </div>
    </div>
  );
}

function DelegationSetting() {
  const [delegated, setDelegated] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get("/schools/users/me").then(res => {
      setDelegated(res.data.delegate_approvals_to_managers || false);
    }).catch(() => {});
  }, []);

  async function toggle() {
    setSaving(true);
    const next = !delegated;
    try {
      await axios.patch("/schools/users/me/settings", { delegate_approvals_to_managers: next });
      setDelegated(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl px-6 py-5 mt-6 border border-slate-100">
      <h2 className="font-semibold text-slate-800 mb-1">הגדרת האצלת סמכות</h2>
      <p className="text-sm text-slate-500 mb-4">
        כשמופעל, בקשות עדכון פרטים יישלחו גם למנהלים לאישור — לא רק אליך.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="delegate-toggle"
          checked={delegated}
          onChange={toggle}
          disabled={saving}
          className="w-4 h-4 rounded"
        />
        <label htmlFor="delegate-toggle" className="text-sm text-slate-700 font-medium">
          {delegated ? "מנהלים יכולים לאשר בקשות עדכון" : "רק אני מאשר בקשות עדכון"}
        </label>
      </div>
    </div>
  );
}
