import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Sidebar from "../components/Sidebar";

const STATUS_LABEL = { pending: "ממתין", approved: "אושר", rejected: "נדחה" };
const STATUS_CLASS = {
  pending: "bg-amber-50 text-amber-700 border border-amber-200",
  approved: "bg-green-50 text-green-700 border border-green-200",
  rejected: "bg-red-50 text-red-700 border border-red-200",
};

function RejectModal({ req, onClose, onRejected }) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleReject() {
    setLoading(true);
    try {
      await axios.post(`/signup/requests/${req.id}/reject`, { reviewer_note: note || null });
      onRejected(req.id);
      onClose();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">דחיית הבקשה</h2>
        <p className="text-sm text-slate-500 mb-4">
          דחיית בקשה של <span className="font-medium text-slate-700">{req.org_name}</span>
        </p>
        <div className="flex flex-col gap-1.5 mb-4">
          <label htmlFor="reject-note" className="text-xs font-semibold text-slate-500">הערה (אופציונלי)</label>
          <textarea
            id="reject-note"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="סיבת הדחייה — תישלח במייל למבקש"
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReject}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "#ef4444" }}
          >
            {loading ? "שולח..." : "דחה את הבקשה"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function ApproveModal({ req, onClose, onApproved }) {
  const [trialDays, setTrialDays] = useState(14);
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      await axios.post(`/signup/requests/${req.id}/approve`, { trial_days: trialDays });
      onApproved(req.id);
      onClose();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">אישור בקשה</h2>
        <p className="text-sm text-slate-500 mb-4">
          אישור בקשה של <span className="font-medium text-slate-700">{req.org_name}</span>
        </p>
        <div className="flex flex-col gap-1.5 mb-4">
          <label htmlFor="trial-days" className="text-xs font-semibold text-slate-500">ימי ניסיון</label>
          <input
            id="trial-days"
            type="number"
            min={1}
            max={365}
            value={trialDays}
            onChange={e => setTrialDays(Number(e.target.value))}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            dir="ltr"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "#0070F3" }}
          >
            {loading ? "מאשר..." : "אשר ושלח הזמנה"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTrialModal({ req, onClose, onUpdated }) {
  const currentTrialEnds = req.org_trial_ends_at ? new Date(req.org_trial_ends_at) : null;
  const daysRemaining = currentTrialEnds
    ? Math.ceil((currentTrialEnds.getTime() - Date.now()) / 86400000)
    : null;
  const [trialDays, setTrialDays] = useState(daysRemaining != null && daysRemaining > 0 ? daysRemaining : 14);
  const [loading, setLoading] = useState(false);

  async function handleUpdate() {
    setLoading(true);
    try {
      const res = await axios.patch(`/signup/orgs/${req.org_id}/trial`, { trial_days: trialDays });
      onUpdated(req.id, res.data.trial_ends_at);
      onClose();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">עדכון ימי ניסיון</h2>
        <p className="text-sm text-slate-500 mb-4">
          <span className="font-medium text-slate-700">{req.org_name}</span>
        </p>
        {currentTrialEnds && (
          <div className="bg-slate-50 rounded-xl px-3 py-2.5 mb-4 text-sm flex items-center gap-2">
            <span className="text-slate-500">תוקף נוכחי:</span>
            <span className="font-medium text-slate-700">
              {currentTrialEnds.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
            </span>
            {daysRemaining != null && (
              <span className={`text-xs font-semibold ${daysRemaining > 0 ? "text-green-600" : "text-red-500"}`}>
                ({daysRemaining > 0 ? `עוד ${daysRemaining} ימים` : `פג לפני ${Math.abs(daysRemaining)} ימים`})
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5 mb-5">
          <label htmlFor="edit-trial-days" className="text-xs font-semibold text-slate-500">ימי ניסיון חדשים מהיום</label>
          <input
            id="edit-trial-days"
            type="number"
            min={1}
            max={3650}
            value={trialDays}
            onChange={e => setTrialDays(Number(e.target.value))}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            dir="ltr"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleUpdate}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "#0070F3" }}
          >
            {loading ? "מעדכן..." : "עדכן ימי ניסיון"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [editTrialTarget, setEditTrialTarget] = useState(null);
  const [activating, setActivating] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await axios.get("/schools/users/me");
        if (!meRes.data.is_superadmin) {
          navigate("/", { replace: true });
          return;
        }
        setUser(meRes.data);
        const reqRes = await axios.get("/signup/requests");
        setRequests(reqRes.data);
      } catch {
        navigate("/", { replace: true });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [navigate]);

  function handleApproved(id) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "approved" } : r));
  }

  function handleRejected(id) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" } : r));
  }

  function handleTrialUpdated(id, newTrialEndsAt) {
    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, org_trial_ends_at: newTrialEndsAt, org_subscription_status: "trial" } : r
    ));
  }

  async function handleActivate(orgId) {
    setActivating(orgId);
    try {
      await axios.post(`/signup/orgs/${orgId}/activate`);
      // Refresh to update subscription status shown
    } catch {
      // silent
    } finally {
      setActivating(null);
    }
  }

  const sidebarWidth = 240;

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex">
      <Sidebar dark />
      <main
        className="flex-1 flex flex-col min-h-screen"
        style={{ marginRight: sidebarWidth }}
      >
        <div className="px-8 py-8 max-w-5xl w-full mx-auto">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">ניהול מערכת</h1>
          <p className="text-sm text-slate-500 mb-8">בקשות הרשמה של ארגונים חדשים</p>

          {loading ? (
            <div role="status" aria-label="טוען נתונים" className="flex items-center justify-center py-20">
              <span aria-hidden="true" className="w-8 h-8 border-3 border-blue-200 border-t-blue-500 rounded-full inline-block" style={{ animation: "spin 0.8s linear infinite", borderWidth: 3 }} />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-20 text-slate-400 text-sm">אין בקשות הרשמה עדיין</div>
          ) : (
            <div className="flex flex-col gap-3">
              {requests.map(req => (
                <div key={req.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-base font-bold text-slate-800">{req.org_name}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[req.status] || ""}`}>
                          {STATUS_LABEL[req.status] || req.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600">
                        <span><span className="font-medium text-slate-500">שם בעלים:</span> {req.owner_name}</span>
                        <span><span className="font-medium text-slate-500">מספר עוסק:</span> {req.business_number}</span>
                        <span><span className="font-medium text-slate-500">מייל:</span> {req.owner_email}</span>
                        <span><span className="font-medium text-slate-500">טלפון:</span> {req.owner_phone || "—"}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        התקבל: {new Date(req.created_at).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                      {req.status === "approved" && req.org_trial_ends_at && req.org_subscription_status === "trial" && (
                        <p className="text-xs text-amber-600 mt-0.5 font-medium">
                          ניסיון עד: {new Date(req.org_trial_ends_at).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
                          {(() => { const d = Math.ceil((new Date(req.org_trial_ends_at).getTime() - Date.now()) / 86400000); return d > 0 ? ` (עוד ${d} ימים)` : ` (פג לפני ${Math.abs(d)} ימים)`; })()}
                        </p>
                      )}
                      {req.status === "approved" && req.org_subscription_status === "active" && (
                        <p className="text-xs text-green-600 mt-0.5 font-medium">מנוי פעיל ✓</p>
                      )}
                    </div>

                    {req.status === "pending" && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => setApproveTarget(req)}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
                          style={{ background: "#0070F3" }}
                        >
                          אשר
                        </button>
                        <button
                          onClick={() => setRejectTarget(req)}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors border border-red-200"
                        >
                          דחה
                        </button>
                      </div>
                    )}

                    {req.status === "approved" && (
                      <div className="flex gap-2 flex-shrink-0">
                        {req.org_id && (
                          <button
                            onClick={() => setEditTrialTarget(req)}
                            aria-label="עדכן ימי ניסיון"
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-200"
                          >
                            עדכן ימי ניסיון
                          </button>
                        )}
                        <button
                          onClick={() => handleActivate(req.org_id)}
                          disabled={activating === req.org_id}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200"
                        >
                          {activating === req.org_id ? "מעדכן..." : "שדרג למנוי פעיל"}
                        </button>
                      </div>
                    )}
                  </div>

                  {req.reviewer_note && (
                    <div className="mt-3 pt-3 border-t border-slate-50 text-xs text-slate-500">
                      <span className="font-medium">הערה:</span> {req.reviewer_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {approveTarget && (
        <ApproveModal
          req={approveTarget}
          onClose={() => setApproveTarget(null)}
          onApproved={handleApproved}
        />
      )}
      {rejectTarget && (
        <RejectModal
          req={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={handleRejected}
        />
      )}
      {editTrialTarget && (
        <EditTrialModal
          req={editTrialTarget}
          onClose={() => setEditTrialTarget(null)}
          onUpdated={handleTrialUpdated}
        />
      )}
    </div>
  );
}
