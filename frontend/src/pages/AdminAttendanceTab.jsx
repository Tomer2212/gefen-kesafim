import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import AttendanceCalendar from "../components/attendance/AttendanceCalendar";
import { currentMonthKey } from "../components/attendance/attendanceConstants";
import { exportAttendanceXlsx } from "../components/attendance/attendanceExport";

const STAFF_ROLES = new Set(["advisor", "manager"]);

// טאב "שעון נוכחות" בניהול — מעבר על היומן של כל עובד, עריכה, נעילת חודש וייצוא לאקסל.
export default function AdminAttendanceTab({ users = [], loadingUsers, loadUsers }) {
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());
  const [userId, setUserId] = useState("");
  const [entries, setEntries] = useState([]);
  const [lock, setLock] = useState({ locked: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (loadUsers && users.length === 0 && !loadingUsers) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staff = useMemo(
    () =>
      (users || [])
        .filter((u) => STAFF_ROLES.has(u.role))
        .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", "he")),
    [users]
  );

  useEffect(() => {
    if (!userId && staff.length) setUserId(staff[0].id);
  }, [staff, userId]);

  const load = useCallback(async (uid, mk) => {
    if (!uid) return;
    const rid = ++reqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/attendance/admin", { params: { user_id: uid, month: mk } });
      if (rid !== reqRef.current) return;
      setEntries(res.data.entries || []);
      setLock(res.data.lock || { locked: false });
    } catch (err) {
      if (rid !== reqRef.current) return;
      setError(err?.response?.data?.detail || "טעינת הנתונים נכשלה");
    } finally {
      if (rid === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) load(userId, monthKey);
  }, [userId, monthKey, load]);

  function upsertLocal(entry) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.entry_date !== entry.entry_date);
      return [...rest, entry].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    });
  }

  const onSaveDay = useCallback(async (date, patch) => {
    try {
      const res = await axios.put(`/attendance/admin/${userId}/${date}`, patch);
      upsertLocal(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "השמירה נכשלה");
      load(userId, monthKey);
    }
  }, [userId, monthKey, load]);

  const onDeleteDay = useCallback(async (date) => {
    try {
      await axios.delete(`/attendance/admin/${userId}/${date}`);
      setEntries((prev) => prev.filter((e) => e.entry_date !== date));
    } catch (err) {
      setError(err?.response?.data?.detail || "המחיקה נכשלה");
      load(userId, monthKey);
    }
  }, [userId, monthKey, load]);

  const onUploadFile = useCallback(async (date, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await axios.post(`/attendance/admin/${userId}/${date}/files`, fd);
    await load(userId, monthKey);
  }, [userId, monthKey, load]);

  const onDeleteFile = useCallback(async (date, fileId) => {
    await axios.delete(`/attendance/admin/${userId}/${date}/files/${fileId}`);
    await load(userId, monthKey);
  }, [userId, monthKey, load]);

  const onDownloadFile = useCallback(async (date, fileRec) => {
    const res = await axios.get(`/attendance/admin/${userId}/${date}/files/${fileRec.id}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileRec.filename || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [userId]);

  async function toggleLock() {
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      if (lock.locked) {
        await axios.delete("/attendance/admin/lock", { data: { user_id: userId, month: monthKey } });
      } else {
        await axios.post("/attendance/admin/lock", { user_id: userId, month: monthKey });
      }
      await load(userId, monthKey);
    } catch (err) {
      setError(err?.response?.data?.detail || "פעולת הנעילה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function exportAll() {
    setBusy(true);
    setError("");
    try {
      const res = await axios.get("/attendance/admin/all", { params: { month: monthKey } });
      exportAttendanceXlsx({
        month: monthKey,
        users: (res.data.users || []).map((u) => ({
          name: u.user.full_name || "",
          entries: u.entries || [],
        })),
      });
    } catch (err) {
      setError(err?.response?.data?.detail || "הייצוא נכשל");
    } finally {
      setBusy(false);
    }
  }

  const headerExtra = (
    <>
      <div>
        <label htmlFor="att-admin-user" className="block text-xs font-medium text-slate-500 mb-1">
          עובד
        </label>
        <select
          id="att-admin-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white min-w-[12rem]"
        >
          {staff.length === 0 && <option value="">אין עובדים</option>}
          {staff.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={toggleLock}
        disabled={busy || !userId}
        className={`text-sm px-3 py-1.5 rounded-lg border disabled:opacity-50 ${
          lock.locked
            ? "border-amber-300 text-amber-700 hover:bg-amber-50"
            : "border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {lock.locked ? "שחרר חודש" : "נעל חודש"}
      </button>

      <button
        type="button"
        onClick={exportAll}
        disabled={busy}
        className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
      >
        ייצוא לאקסל — כל העובדים, חודש זה
      </button>
    </>
  );

  return (
    <div dir="rtl">
      <h1 className="text-xl font-bold text-slate-800 mb-3">שעון נוכחות</h1>
      {loadingUsers && users.length === 0 ? (
        <div role="status" aria-label="טוען משתמשים" className="py-10 text-center text-sm text-slate-400">
          טוען…
        </div>
      ) : (
        <AttendanceCalendar
          monthKey={monthKey}
          onMonthChange={setMonthKey}
          entries={entries}
          lock={lock}
          loading={loading}
          error={error}
          onSaveDay={onSaveDay}
          onDeleteDay={onDeleteDay}
          onUploadFile={onUploadFile}
          onDeleteFile={onDeleteFile}
          onDownloadFile={onDownloadFile}
          headerExtra={headerExtra}
        />
      )}
    </div>
  );
}
