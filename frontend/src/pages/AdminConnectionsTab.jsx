import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import ColumnFilterMenu from "../components/ColumnFilterMenu";

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_ORDER = { owner: 0, manager: 1, advisor: 2 };

const COLUMNS = [
  { key: "user", label: "משתמש" },
  { key: "role", label: "תפקיד" },
  { key: "count", label: "חיבורים פעילים" },
  { key: "primary", label: "חיבור ראשי" },
];

const AUTO_DISCONNECT_OPTIONS = [
  { value: 0, label: "כבוי" },
  { value: 1, label: "כל שעה" },
  { value: 2, label: "כל שעתיים" },
  { value: 3, label: "כל 3 שעות" },
  { value: 6, label: "כל 6 שעות" },
  { value: 12, label: "כל 12 שעות" },
  { value: 24, label: "כל 24 שעות" },
];

function formatLastSeen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function UserConnectionsModal({ userRow, onClose, onCountsChanged }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [toDisconnect, setToDisconnect] = useState(null);

  function load() {
    setLoading(true);
    axios.get(`/sessions/users/${userRow.id}`)
      .then(r => setSessions(r.data.sessions || []))
      .catch(() => setError("שגיאה בטעינת החיבורים"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleTogglePrimary(sessionId, isPrimary) {
    setBusyId(sessionId);
    setError("");
    try {
      await axios.patch(`/sessions/users/${userRow.id}/${sessionId}/primary`, { is_primary: isPrimary });
      load();
      onCountsChanged?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "קביעת החיבור הראשי נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect() {
    if (!toDisconnect) return;
    setBusyId(toDisconnect.id);
    setError("");
    try {
      await axios.delete(`/sessions/users/${userRow.id}/${toDisconnect.id}`);
      setToDisconnect(null);
      load();
      onCountsChanged?.();
    } catch {
      setError("ניתוק החיבור נכשל");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="user-connections-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 id="user-connections-title" className="font-bold text-black">חיבורים פעילים — {userRow.full_name || userRow.email}</h2>
            <p className="text-xs text-slate-400 mt-0.5">ניתוק חיבור נכנס לתוקף תוך פחות מדקה</p>
          </div>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

          {loading ? (
            <div role="status" aria-label="טוען חיבורים" className="flex justify-center py-8">
              <div aria-hidden="true" className="spinner w-7 h-7" />
            </div>
          ) : (sessions || []).length === 0 ? (
            <p className="text-sm text-slate-400 py-4">אין חיבורים פעילים.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => (
                <li key={s.id} className="border border-slate-200 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900 flex items-center gap-2">
                        {s.device_label || "חיבור לא מזוהה"}
                        {s.is_primary && (
                          <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">ראשי</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        פעילות אחרונה: {formatLastSeen(s.last_seen_at)}
                        {s.ip_address && <> · <span dir="ltr">IP {s.ip_address}</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.is_primary ? (
                        <button
                          onClick={() => handleTogglePrimary(s.id, false)}
                          disabled={busyId === s.id}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-60 whitespace-nowrap"
                        >
                          הסר מראשי
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTogglePrimary(s.id, true)}
                          disabled={busyId === s.id}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-60 whitespace-nowrap"
                        >
                          קבע כראשי
                        </button>
                      )}
                      <button
                        onClick={() => setToDisconnect(s)}
                        disabled={busyId === s.id}
                        className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        נתק
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {toDisconnect && (
          <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3 bg-slate-50">
            <span className="text-xs text-slate-600">לנתק את "{toDisconnect.device_label || "החיבור"}"?</span>
            <div className="flex gap-2">
              <button onClick={handleDisconnect} disabled={busyId === toDisconnect.id}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60">
                {busyId === toDisconnect.id ? "מנתק..." : "אישור ניתוק"}
              </button>
              <button onClick={() => setToDisconnect(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors">
                ביטול
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminConnectionsTab({ users, loadingUsers, loadUsers }) {
  const [counts, setCounts] = useState({});
  const [primaryByUser, setPrimaryByUser] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [autoHours, setAutoHours] = useState(0);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);

  // Default order (owner → manager → advisor) is a baseline, not a user-applied sort — it
  // must not show as "active" on the תפקיד column header until the user actually clicks it.
  const [sortKey, setSortKey] = useState("role");
  const [sortDir, setSortDir] = useState("asc");
  const [sortIsExplicit, setSortIsExplicit] = useState(false);
  // Each column's filter spec is either null (no filter) or { selected: string[] } — same
  // shape as the main dashboard table's value-list filter (see ColumnFilterMenu).
  const [columnFilters, setColumnFilters] = useState({});

  function handleSort(key, dir) {
    if (!dir) { setSortKey("role"); setSortDir("asc"); setSortIsExplicit(false); return; }
    setSortKey(key); setSortDir(dir); setSortIsExplicit(true);
  }

  function setColumnFilter(key, spec) {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (spec) next[key] = spec; else delete next[key];
      return next;
    });
  }

  function loadCounts() {
    setLoadingCounts(true);
    axios.get("/sessions/users/counts")
      .then(r => {
        setCounts(r.data.counts || {});
        setPrimaryByUser(r.data.primary || {});
      })
      .catch(() => { setCounts({}); setPrimaryByUser({}); })
      .finally(() => setLoadingCounts(false));
  }

  useEffect(() => {
    if (users.length === 0) loadUsers();
    loadCounts();
    axios.get("/sessions/automations")
      .then(r => setAutoHours(r.data.session_auto_disconnect_hours || 0))
      .catch(() => setAutoHours(0))
      .finally(() => setAutoLoading(false));
  }, []);

  async function handleAutoHoursChange(e) {
    const hours = Number(e.target.value);
    setAutoHours(hours);
    setAutoSaving(true);
    setAutoSaved(false);
    try {
      await axios.put("/sessions/automations", { session_auto_disconnect_hours: hours || null });
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2000);
    } catch {
      // no-op — value stays as selected, user can retry
    } finally {
      setAutoSaving(false);
    }
  }

  const rows = users.map(u => {
    const primaries = primaryByUser[u.id] || [];
    return {
      user: u,
      display: {
        user: u.full_name || u.email || "",
        role: ROLE_LABELS[u.role] || u.role || "",
        count: String(counts[u.id] || 0),
        primary: primaries.length
          ? primaries.map(p => `${p.device_label || "הוגדר"}${p.ip_address ? ` · ${p.ip_address}` : ""}`).join("; ")
          : "לא הוגדר",
      },
    };
  });

  function passesFilters(row, excludeKey) {
    return Object.entries(columnFilters).every(([key, spec]) => {
      if (!spec || key === excludeKey) return true;
      return spec.selected.includes(row.display[key]);
    });
  }

  // Distinct values available for one column's dropdown — computed from rows that already
  // pass every OTHER active filter (Excel-style: narrows as you filter other columns too).
  function distinctValuesFor(key) {
    const seen = new Map();
    for (const row of rows) {
      if (!passesFilters(row, key)) continue;
      const v = row.display[key];
      if (!seen.has(v)) seen.set(v, { value: v, label: v });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "he", { numeric: true }));
  }

  const filteredRows = rows.filter(row => passesFilters(row, null));

  const sortedRows = sortKey ? [...filteredRows].sort((a, b) => {
    let cmp;
    if (sortKey === "role") cmp = (ROLE_ORDER[a.user.role] ?? 99) - (ROLE_ORDER[b.user.role] ?? 99);
    else if (sortKey === "count") cmp = Number(a.display.count) - Number(b.display.count);
    else cmp = String(a.display[sortKey]).localeCompare(String(b.display[sortKey]), "he", { numeric: true });
    if (cmp === 0) cmp = a.display.user.localeCompare(b.display.user, "he");
    return sortDir === "desc" ? -cmp : cmp;
  }) : filteredRows;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="border border-slate-200 rounded-2xl p-5 bg-white shadow-sm mb-6">
        <h2 className="font-semibold text-slate-900 mb-1">ניתוק אוטומטי של חיבורים לא-ראשיים</h2>
        <p className="text-sm text-slate-500 mb-4">
          כל כמה זמן המערכת תנתק אוטומטית את כל החיבורים הפעילים בארגון שאינם מסומנים כ"חיבור ראשי" של המשתמש.
        </p>
        <div className="flex items-center gap-3">
          <label htmlFor="auto-disconnect-hours" className="text-sm font-medium text-slate-700">תדירות:</label>
          <select
            id="auto-disconnect-hours"
            value={autoHours}
            onChange={handleAutoHoursChange}
            disabled={autoLoading || autoSaving}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white"
          >
            {AUTO_DISCONNECT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {autoSaved && <span role="status" className="text-xs text-green-700">נשמר ✓</span>}
        </div>
      </div>

      <div className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {COLUMNS.map(col => (
                <th key={col.key} scope="col" className="text-right px-4 py-3 font-medium text-slate-500 select-none">
                  <div className="flex items-center gap-1.5">
                    <span>{col.label}</span>
                    <ColumnFilterMenu
                      label={col.label}
                      values={distinctValuesFor(col.key)}
                      filterSpec={columnFilters[col.key] || null}
                      onApply={(spec) => setColumnFilter(col.key, spec)}
                      sortDir={sortIsExplicit && sortKey === col.key ? sortDir : null}
                      onSort={(dir) => handleSort(col.key, dir)}
                      numeric={col.key === "count"}
                    />
                  </div>
                </th>
              ))}
              <th scope="col" className="text-right px-4 py-3 font-medium text-slate-500"></th>
            </tr>
          </thead>
          <tbody>
            {(loadingUsers || loadingCounts) ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <div role="status" aria-label="טוען משתמשים" className="flex justify-center">
                    <div aria-hidden="true" className="spinner w-6 h-6" />
                  </div>
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">אין משתמשים תואמים</td></tr>
            ) : (
              sortedRows.map(({ user: u }) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-900">{u.full_name || u.email}</td>
                  <td className="px-4 py-3 text-slate-500">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="px-4 py-3 text-slate-700">{counts[u.id] || 0}</td>
                  <td className="px-4 py-3">
                    {(primaryByUser[u.id] || []).length ? (
                      <div className="flex flex-wrap gap-1">
                        {primaryByUser[u.id].map((p, i) => (
                          <span key={i} className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                            {p.ip_address ? (
                              <span dir="ltr">IP {p.ip_address} · {p.device_label || "הוגדר"}</span>
                            ) : (
                              p.device_label || "הוגדר"
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">לא הוגדר</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedUser(u)}
                      disabled={!counts[u.id]}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      נהל חיבורים
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <UserConnectionsModal
          userRow={selectedUser}
          onClose={() => setSelectedUser(null)}
          onCountsChanged={loadCounts}
        />
      )}
    </div>
  );
}
