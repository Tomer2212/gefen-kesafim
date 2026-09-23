import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

function DisconnectConfirmModal({ deviceLabel, onConfirm, onCancel, confirming }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
      >
        <h2 id="disconnect-modal-title" className="font-bold text-slate-900 text-lg">ניתוק חיבור</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          לנתק את החיבור מ"{deviceLabel}"? המשתמש המחובר שם יזרק החוצה תוך פחות מדקה.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}
          >
            {confirming ? "מנתק..." : "נתק"}
          </button>
          <button onClick={onCancel} disabled={confirming} className="btn-ghost text-sm px-5 py-2">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function formatLastSeen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Lists the current user's own active connections (עד 3), with self-disconnect.
 * Used both in the personal "חיבורים" tab and in ConnectionsLimitPage. */
export default function ConnectionsList({ onDisconnected }) {
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toDisconnect, setToDisconnect] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    axios.get("/sessions/me")
      .then((r) => setSessions(r.data.sessions || []))
      .catch(() => setError("שגיאה בטעינת החיבורים הפעילים"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleConfirmDisconnect() {
    if (!toDisconnect) return;
    setDisconnecting(true);
    try {
      await axios.delete(`/sessions/me/${toDisconnect.id}`);
      setToDisconnect(null);
      load();
      onDisconnected?.();
    } catch {
      setError("ניתוק החיבור נכשל. נסה שוב.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="טוען חיבורים" className="flex items-center gap-3 text-slate-400 text-sm py-6">
        <span aria-hidden="true" className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full inline-block animate-spin" />
        טוען...
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {(sessions || []).map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-4 border border-slate-200 rounded-2xl px-4 py-3 bg-white shadow-sm"
          >
            <div>
              <div className="font-semibold text-slate-900 flex items-center gap-2">
                {s.device_label || "חיבור לא מזוהה"}
                {s.is_current && (
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    המכשיר הזה עכשיו
                  </span>
                )}
                {s.is_primary && (
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                    חיבור ראשי
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                פעילות אחרונה: {formatLastSeen(s.last_seen_at)}
                {s.ip_address && <> · <span dir="ltr">IP {s.ip_address}</span></>}
              </div>
            </div>
            {!s.is_current && !s.is_primary && (
              <button
                onClick={() => setToDisconnect(s)}
                className="text-sm px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
              >
                נתק
              </button>
            )}
          </li>
        ))}
      </ul>

      {(sessions || []).length === 0 && !error && (
        <p className="text-sm text-slate-400 py-4">לא נמצאו חיבורים פעילים.</p>
      )}

      {toDisconnect && (
        <DisconnectConfirmModal
          deviceLabel={toDisconnect.device_label || "חיבור"}
          confirming={disconnecting}
          onConfirm={handleConfirmDisconnect}
          onCancel={() => setToDisconnect(null)}
        />
      )}
    </div>
  );
}
