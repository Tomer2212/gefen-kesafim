import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import AttendanceCalendar from "../components/attendance/AttendanceCalendar";
import { currentMonthKey } from "../components/attendance/attendanceConstants";
import { exportAttendanceXlsx } from "../components/attendance/attendanceExport";

const UI_KEY = "personal_attendance_ui_state";

function loadUi() {
  try {
    const raw = sessionStorage.getItem(UI_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

// טאב "שעון נוכחות" באזור האישי — המשתמש הנוכחי מדווח את הנוכחות שלו.
export default function PersonalAttendanceTab({ userName = "" }) {
  const [monthKey, setMonthKey] = useState(() => loadUi().monthKey || currentMonthKey());
  const [entries, setEntries] = useState([]);
  const [lock, setLock] = useState({ locked: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(UI_KEY, JSON.stringify({ monthKey }));
    } catch {
      /* ignore */
    }
  }, [monthKey]);

  const load = useCallback(async (mk) => {
    const rid = ++reqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/attendance/my", { params: { month: mk } });
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
    load(monthKey);
  }, [monthKey, load]);

  function upsertLocal(entry) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.entry_date !== entry.entry_date);
      return [...rest, entry].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    });
  }

  const onSaveDay = useCallback(async (date, patch) => {
    try {
      const res = await axios.put(`/attendance/my/${date}`, patch);
      upsertLocal(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "השמירה נכשלה");
      load(monthKey);
    }
  }, [monthKey, load]);

  const onDeleteDay = useCallback(async (date) => {
    try {
      await axios.delete(`/attendance/my/${date}`);
      setEntries((prev) => prev.filter((e) => e.entry_date !== date));
    } catch (err) {
      setError(err?.response?.data?.detail || "המחיקה נכשלה");
      load(monthKey);
    }
  }, [monthKey, load]);

  const onUploadFile = useCallback(async (date, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await axios.post(`/attendance/my/${date}/files`, fd);
    await load(monthKey);
  }, [monthKey, load]);

  const onDeleteFile = useCallback(async (date, fileId) => {
    await axios.delete(`/attendance/my/${date}/files/${fileId}`);
    await load(monthKey);
  }, [monthKey, load]);

  const onDownloadFile = useCallback(async (date, fileRec) => {
    const res = await axios.get(`/attendance/my/${date}/files/${fileRec.id}`, {
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
  }, []);

  const headerExtra = (
    <button
      type="button"
      onClick={() =>
        exportAttendanceXlsx({
          month: monthKey,
          users: [{ name: userName, entries }],
          filenamePrefix: "שעון_נוכחות_שלי",
        })
      }
      className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
    >
      ייצוא לאקסל — החודש הזה
    </button>
  );

  return (
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
  );
}
