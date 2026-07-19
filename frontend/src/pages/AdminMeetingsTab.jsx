import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { DeleteMeetingModal } from "../components/meetings/DeleteMeetingModal";
import { MeetingsBulkActionBar } from "../components/meetings/MeetingsBulkActionBar";
import { MeetingsTable } from "../components/meetings/MeetingsTable";
import { NotesModal } from "../components/meetings/NotesModal";
import { SchoolPickerModal, SchoolPickerPopover, schoolLabel } from "../components/meetings/SchoolPickerCell";
import { MEETING_STATUS_OPTIONS, MEETING_TYPE_OPTIONS, STATUS_MAP, formatMeetingDate } from "../components/meetings/constants";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { getMissingCriticalFields, isMeetingIncomplete } from "../components/meetings/meetingCompleteness";
import { buildSchoolContacts } from "../components/meetings/schoolContacts";
import { useMeetingsPolling } from "../hooks/useMeetingsPolling";

const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_FILTERS = { status: "scheduled", date_from: null, date_to: TODAY, advisor_id: null, school_id: null };
const SS_KEY = "admin_meetings_ui_state";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

function readSavedState() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || "null"); } catch { return null; }
}
function saveState(state) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const AdminMeetingsTab = forwardRef(function AdminMeetingsTab({ users, loadingUsers, loadUsers, canDeleteMeetings, onIncompleteChange }, ref) {
  const saved = readSavedState();

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [filters, setFilters] = useState(saved?.filters ?? DEFAULT_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(saved?.showAdvanced ?? false);
  const [search] = useState("");

  // Client-side text filters
  const [nameFilter, setNameFilter] = useState(saved?.nameFilter ?? "");
  const [symbolFilter, setSymbolFilter] = useState(saved?.symbolFilter ?? "");
  const [cityFilter, setCityFilter] = useState(saved?.cityFilter ?? "");
  const [districtFilter, setDistrictFilter] = useState(saved?.districtFilter ?? "");

  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);

  const [selectable, setSelectable] = useState(false);
  const [dotsOpen, setDotsOpen] = useState(false);
  const dotsRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [notesModal, setNotesModal] = useState(null);
  const [schoolPickerFor, setSchoolPickerFor] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Status reminder states
  const [alreadySentModal, setAlreadySentModal] = useState(null); // { meeting, lastSentAt, recipients }
  const [reminderToasts, setReminderToasts] = useState([]);
  function addReminderToast(msg) {
    const id = Date.now();
    setReminderToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setReminderToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }

  const sessionCreatedMeetingIdsRef = useRef(new Set());
  const incompleteSessionMeetings = meetings.filter(m =>
    sessionCreatedMeetingIdsRef.current.has(m.id) && isMeetingIncomplete(m, { requireSchool: true, requireAdvisor: true })
  );
  const hasIncompleteMeetings = incompleteSessionMeetings.length > 0;

  useEffect(() => {
    onIncompleteChange?.(hasIncompleteMeetings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasIncompleteMeetings]);

  useImperativeHandle(ref, () => ({
    getMissingFields: () =>
      [...new Set(incompleteSessionMeetings.flatMap(m => getMissingCriticalFields(m, { requireSchool: true, requireAdvisor: true })))],
    discardIncompleteMeetings: async () => {
      const ids = incompleteSessionMeetings.map(m => m.id);
      for (const id of ids) {
        const m = meetings.find(x => x.id === id);
        if (!m) continue;
        try { await axios.delete(`/schools/${m.school_id}/meetings/${id}`); } catch { /* best-effort */ }
      }
      setMeetings(prev => prev.filter(m => !ids.includes(m.id)));
      ids.forEach(id => sessionCreatedMeetingIdsRef.current.delete(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [incompleteSessionMeetings, meetings]);

  async function loadAllMeetings(activeFilters, year = academicYear, { silent } = {}) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const params = {};
      if (activeFilters.status) params.status = activeFilters.status;
      if (activeFilters.date_from) params.date_from = activeFilters.date_from;
      if (activeFilters.date_to) params.date_to = activeFilters.date_to;
      if (activeFilters.advisor_id) params.advisor_id = activeFilters.advisor_id;
      if (activeFilters.school_id) params.school_id = activeFilters.school_id;
      params.academic_year = year;
      const res = await axios.get("/schools/meetings/all", { params });
      setMeetings(res.data || []);
    } catch {
      if (!silent) setError("שגיאה בטעינת הפגישות — נסה לרענן");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useMeetingsPolling(() => loadAllMeetings(filters, academicYear, { silent: true }), true, [filters, academicYear]);

  function handleYearChange(year) {
    setAcademicYear(year);
    loadAllMeetings(filters, year);
  }

  async function loadOrgSchools() {
    setLoadingSchools(true);
    try {
      const res = await axios.get("/schools/");
      setSchools(res.data || []);
    } catch {
      setSchools([]);
    } finally {
      setLoadingSchools(false);
    }
  }

  // Close 3-dot dropdown on outside click
  useEffect(() => {
    if (!dotsOpen) return;
    function handler(e) {
      if (dotsRef.current && !dotsRef.current.contains(e.target)) setDotsOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dotsOpen]);

  // Persist all filter/search state to sessionStorage on every change
  useEffect(() => {
    saveState({ filters, showAdvanced, nameFilter, symbolFilter, cityFilter, districtFilter });
  }, [filters, showAdvanced, nameFilter, symbolFilter, cityFilter, districtFilter]);

  useEffect(() => {
    loadAllMeetings(filters);
    loadOrgSchools();
    if (!users || users.length === 0) loadUsers?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setServerFilter(key, val) {
    const next = { ...filters, [key]: val || null };
    setFilters(next);
    loadAllMeetings(next);
  }

  function clearFilters() {
    const reset = DEFAULT_FILTERS;
    setFilters(reset);
    setNameFilter("");
    setSymbolFilter("");
    setCityFilter("");
    setDistrictFilter("");
    loadAllMeetings(reset);
  }

  const displayedMeetings = useMemo(() => {
    let result = meetings;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(m =>
        (m.school_name || "").toLowerCase().includes(q) ||
        (m.school_symbol || "").toLowerCase().includes(q) ||
        (m.school_city || "").toLowerCase().includes(q) ||
        (m.advisor_profiles || []).some(p => (p.full_name || p.email || "").toLowerCase().includes(q))
      );
    }
    if (nameFilter.trim()) {
      const q = nameFilter.trim().toLowerCase();
      result = result.filter(m => (m.school_name || "").toLowerCase().includes(q));
    }
    if (symbolFilter.trim()) {
      result = result.filter(m => (m.school_symbol || "").toLowerCase().includes(symbolFilter.trim()));
    }
    if (cityFilter.trim()) {
      const q = cityFilter.trim().toLowerCase();
      result = result.filter(m => (m.school_city || "").toLowerCase().includes(q));
    }
    if (districtFilter.trim()) {
      const q = districtFilter.trim().toLowerCase();
      result = result.filter(m => (m.school_district || "").toLowerCase().includes(q));
    }
    return result;
  }, [meetings, search, nameFilter, symbolFilter, cityFilter, districtFilter]);

  function normalizeTime(t) {
    if (!t) return null;
    const digits = t.replace(/\D/g, "");
    if (!digits) return null;
    let hh, mm;
    if (digits.length <= 2) { hh = digits.padStart(2, "0"); mm = "00"; }
    else if (digits.length === 3) { hh = "0" + digits[0]; mm = digits.slice(1); }
    else { hh = digits.slice(0, 2); mm = digits.slice(2, 4); }
    if (parseInt(hh) > 23) hh = "23";
    if (parseInt(mm) > 59) mm = "59";
    return `${hh}:${mm}`;
  }

  async function updateMeeting(draft) {
    if (!draft?.id) return;
    setMeetings(prev => prev.map(m => m.id === draft.id ? { ...m, ...draft } : m));
    const payload = {
      meeting_date: draft.meeting_date || null,
      status: draft.status || "scheduled",
      start_time: normalizeTime(draft.start_time),
      end_time: normalizeTime(draft.end_time),
      advisor_ids: draft.advisor_ids || [],
      participants: draft.participants || [],
      meeting_type: draft.meeting_type || null,
      actual_duration: draft.actual_duration || null,
      notes: draft.notes || null,
      reminder_enabled: draft.reminder_enabled || false,
    };
    try {
      const res = await axios.put(`/schools/${draft.school_id}/meetings/${draft.id}`, payload);
      const saved = { ...res.data, advisor_profiles: draft.advisor_profiles || [], school_name: draft.school_name, school_symbol: draft.school_symbol, school_city: draft.school_city, school_id: draft.school_id };
      setMeetings(prev => prev.map(m => m.id === draft.id ? saved : m));
    } catch (err) {
      console.error("Update meeting failed:", err);
      loadAllMeetings(filters);
    }
  }

  async function deleteMeeting(meetingId) {
    const m = meetings.find(x => x.id === meetingId);
    if (!m) return;
    try {
      await axios.delete(`/schools/${m.school_id}/meetings/${meetingId}`);
      setMeetings(prev => prev.filter(x => x.id !== meetingId));
      setSelectedIds(prev => { const n = { ...prev }; delete n[meetingId]; return n; });
    } catch (err) {
      console.error("Delete meeting failed:", err);
    }
  }

  async function createMeetingForSchool(school) {
    const payload = { status: "scheduled", meeting_type: "remote", advisor_ids: [], participants: [], reminder_enabled: false, academic_year: academicYear };
    try {
      const res = await axios.post(`/schools/${school.id}/meetings`, payload);
      const newMeeting = { ...res.data, advisor_profiles: [], school_name: school.name, school_symbol: school.symbol, school_city: school.city };
      setMeetings(prev => [newMeeting, ...prev]);
      sessionCreatedMeetingIdsRef.current.add(newMeeting.id);
    } catch (err) {
      console.error("Failed to create meeting:", err);
    }
    setSchoolPickerFor(null);
  }

  async function reassignSchool(meetingId, school) {
    try {
      await axios.patch(`/schools/meetings/${meetingId}/reassign-school`, { new_school_id: school.id });
      // Server clears participants/primary_contact_key on reassignment (they belonged to
      // the old school's staff) — mirror that here so the row doesn't show stale contacts.
      setMeetings(prev => prev.map(m => m.id === meetingId
        ? { ...m, school_id: school.id, school_name: school.name, school_symbol: school.symbol, school_city: school.city, participants: [], primary_contact_key: null }
        : m));
    } catch (err) {
      console.error("Failed to reassign school:", err);
    }
    setSchoolPickerFor(null);
  }

  function toggleSelect(id) {
    setSelectedIds(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleSelectAll() {
    const allSelected = displayedMeetings.length > 0 && displayedMeetings.every(m => selectedIds[m.id]);
    if (allSelected) {
      setSelectedIds(prev => { const n = { ...prev }; displayedMeetings.forEach(m => delete n[m.id]); return n; });
    } else {
      setSelectedIds(prev => { const n = { ...prev }; displayedMeetings.forEach(m => { n[m.id] = true; }); return n; });
    }
  }
  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

  async function sendStatusReminder(meeting, force = false) {
    try {
      const res = await axios.post(
        `/schools/meetings/${meeting.id}/send-status-reminder?force=${force}`,
      );
      if (res.data.already_sent && !force) {
        setAlreadySentModal({ meeting, lastSentAt: res.data.last_sent_at, recipients: res.data.recipients });
        return;
      }
      const names = (res.data.recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
      const dateStr = meeting.meeting_date ? formatMeetingDate(meeting.meeting_date) : "";
      const schoolName = meeting.school_name || "";
      addReminderToast(`נשלחה תזכורת ל-${names} עבור עדכון סטטוס פגישה עם ${schoolName} (${dateStr})`);
    } catch (e) {
      const detail = e.response?.data?.detail;
      addReminderToast(detail || "שגיאה בשליחת התזכורת");
    }
  }

  async function sendBulkStatusReminders() {
    const eligible = displayedMeetings.filter(m =>
      selectedIds[m.id] &&
      m.status === "scheduled" &&
      m.meeting_date <= TODAY &&
      m.end_time &&
      new Date(`${m.meeting_date}T${m.end_time}:00`) <= new Date()
    );
    if (!eligible.length) {
      addReminderToast("אין פגישות מתאימות לשליחת תזכורת");
      return;
    }
    const results = await Promise.allSettled(eligible.map(m =>
      axios.post(`/schools/meetings/${m.id}/send-status-reminder?force=true`)
    ));
    const sent = results.filter(r => r.status === "fulfilled").length;
    addReminderToast(`נשלחו תזכורות ל-${sent} פגישות`);
  }

  function exportSelectedToExcel() {
    const selected = displayedMeetings.filter(m => selectedIds[m.id]);
    const headers = ["שם מוסד", "סמל", "תאריך", "שעה", "סטטוס", "סוג פגישה", "יועצים", "עיר"];
    const rows = selected.map(m => [
      m.school_name || "",
      m.school_symbol || "",
      m.meeting_date ? formatMeetingDate(m.meeting_date) : "",
      m.meeting_time || "",
      STATUS_MAP[m.status]?.label || m.status || "",
      MEETING_TYPE_OPTIONS.find(o => o.value === m.meeting_type)?.label || m.meeting_type || "",
      (m.advisor_profiles || []).map(p => p?.full_name || p?.email || "").filter(Boolean).join(", "),
      m.school_city || "",
    ]);
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "פגישות");
    XLSX.writeFile(wb, "פגישות_נבחרות.xlsx");
  }

  async function exportSelectedToPdf() {
    const selected = displayedMeetings.filter(m => selectedIds[m.id]);
    const headers = ["שם מוסד", "סמל", "תאריך", "שעה", "סטטוס", "סוג פגישה", "יועצים", "עיר"];
    const rows = selected.map(m => [
      m.school_name || "",
      m.school_symbol || "",
      m.meeting_date ? formatMeetingDate(m.meeting_date) : "",
      m.meeting_time || "",
      STATUS_MAP[m.status]?.label || m.status || "",
      MEETING_TYPE_OPTIONS.find(o => o.value === m.meeting_type)?.label || m.meeting_type || "",
      (m.advisor_profiles || []).map(p => p?.full_name || p?.email || "").filter(Boolean).join(", "),
      m.school_city || "",
    ]);
    try {
      const res = await axios.post(
        "/schools/export-pdf",
        { title: `פגישות נבחרות (${selected.length})`, headers, rows },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "פגישות_נבחרות.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  }

  async function bulkDelete() {
    const ids = Object.keys(selectedIds).filter(id => selectedIds[id]);
    const results = await Promise.allSettled(ids.map(id => {
      const m = meetings.find(x => x.id === id);
      return m ? axios.delete(`/schools/${m.school_id}/meetings/${id}`) : Promise.reject();
    }));
    const okIds = ids.filter((_, i) => results[i].status === "fulfilled");
    setMeetings(prev => prev.filter(m => !okIds.includes(m.id)));
    setSelectedIds({});
    setBulkDeleteConfirm(false);
    if (okIds.length < ids.length) {
      setError(`נמחקו ${okIds.length} מתוך ${ids.length} פגישות`);
    }
  }

  async function bulkReassignAdvisor(advisorId) {
    const advisor = (users || []).find(u => u.id === advisorId);
    const ids = Object.keys(selectedIds).filter(id => selectedIds[id]);
    await Promise.allSettled(ids.map(id => {
      const m = meetings.find(x => x.id === id);
      if (!m) return Promise.reject();
      return updateMeeting({ ...m, advisor_ids: [advisorId], advisor_profiles: advisor ? [advisor] : [] });
    }));
    setSelectedIds({});
  }

  function meetingToRow(m) {
    return [
      formatMeetingDate(m.meeting_date),
      STATUS_MAP[m.status]?.label || m.status || "",
      schoolLabel({ name: m.school_name, symbol: m.school_symbol, city: m.school_city }),
      m.start_time || "",
      m.end_time || "",
      (m.advisor_profiles || []).map(p => p.full_name || p.email).join(", "),
      (m.participants || []).map(p => p.name).join(", "),
      MEETING_TYPE_OPTIONS.find(o => o.value === m.meeting_type)?.label || "",
      m.notes || "",
      m.reminder_enabled ? "פעיל" : "כבוי",
    ];
  }

  const EXPORT_HEADERS = ["תאריך", "סטטוס", "שם מוסד", "התחלה", "סיום", "יועץ מבצע", "משתתפים", "סוג", "הערות", "תזכורת"];

  function exportMeetingsToExcel() {
    const rows = displayedMeetings.map(meetingToRow);
    const wsData = [EXPORT_HEADERS, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = EXPORT_HEADERS.map(() => ({ wch: 22 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "פגישות");
    XLSX.writeFile(wb, "פגישות.xlsx");
  }

  async function exportMeetingsToPdf() {
    const rows = displayedMeetings.map(meetingToRow);
    try {
      const res = await axios.post(
        "/schools/export-pdf",
        { title: `פגישות (${displayedMeetings.length})`, headers: EXPORT_HEADERS, rows },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "פגישות.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  }

  const advancedFilterCount = (cityFilter ? 1 : 0) + (districtFilter ? 1 : 0);
  const currentSchoolPickerMeeting = schoolPickerFor && schoolPickerFor !== "new"
    ? meetings.find(m => m.id === schoolPickerFor)
    : null;
  const advisors = (users || []).filter(u => u.role === "advisor" || u.role === "manager" || u.role === "owner");

  return (
    <div>
      {/* Status reminder toasts */}
      {reminderToasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 items-start" dir="rtl">
          {reminderToasts.map(t => (
            <div key={t.id} role="alert"
              className="flex items-start gap-3 bg-white border border-sky-200 rounded-xl shadow-lg px-4 py-3 w-80 max-w-[calc(100vw-2rem)]">
              <span className="text-xl mt-0.5 flex-shrink-0" aria-hidden="true">🔔</span>
              <p className="text-sm text-slate-800 leading-snug flex-1">{t.msg}</p>
              <button aria-label="סגור" onClick={() => setReminderToasts(prev => prev.filter(x => x.id !== t.id))}
                className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5 p-0.5 rounded">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
                  <path d="M10.5 1.5L1.5 10.5M1.5 1.5L10.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Already-sent confirmation modal */}
      {alreadySentModal && (() => {
        const { meeting, lastSentAt, recipients } = alreadySentModal;
        const d = new Date(lastSentAt);
        const pad = n => String(n).padStart(2, "0");
        const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(-2)}`;
        const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const names = (recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
              <h2 className="text-base font-bold text-slate-800 text-center">תזכורת כבר נשלחה</h2>
              <p className="text-sm text-slate-600 text-center leading-relaxed">
                תזכורת כבר נשלחה ב-<strong>{dateStr}</strong> בשעה <strong>{timeStr}</strong>
                {names ? <> ל-<strong>{names}</strong></> : ""}.
                <br />האם לשלוח תזכורת חדשה בכל זאת?
              </p>
              <div className="flex gap-3 justify-center mt-1">
                <button type="button"
                  onClick={() => { sendStatusReminder(meeting, true); setAlreadySentModal(null); }}
                  className="px-5 py-2 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors">
                  שלח תזכורת חדשה
                </button>
                <button type="button" onClick={() => setAlreadySentModal(null)}
                  className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
                  ביטול
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {notesModal && (
        <NotesModal
          notes={notesModal.notes}
          users={users}
          onSave={(noteText) => { notesModal.onSave(noteText); setNotesModal(null); }}
          onClose={() => setNotesModal(null)}
        />
      )}

      {schoolPickerFor === "new" && (
        <SchoolPickerModal schools={schools} onConfirm={createMeetingForSchool} onCancel={() => setSchoolPickerFor(null)} />
      )}

      {bulkDeleteConfirm && (
        <DeleteMeetingModal
          titleText="מחיקת פגישות"
          confirmText={`האם למחוק ${selectedCount} פגישות לצמיתות? לא ניתן לשחזר פעולה זו.`}
          onConfirm={bulkDelete}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}

      {deleteConfirmId && (
        <DeleteMeetingModal
          onConfirm={() => { deleteMeeting(deleteConfirmId); setDeleteConfirmId(null); }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">פגישות</h1>
          <AcademicYearSelector value={academicYear} onChange={handleYearChange} />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setSchoolPickerFor("new")}
              className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl font-medium">
              <span aria-hidden="true">+</span> הוסף פגישה
            </button>
          </div>
          <button type="button" onClick={() => setShowAdvanced(o => !o)} aria-expanded={showAdvanced}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium ${showAdvanced || advancedFilterCount > 0 ? "btn-blue" : "btn-ghost"}`}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            סינון מתקדם
            {advancedFilterCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-white/80 text-blue-700 leading-none">
                {advancedFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Always-visible base filter panel */}
      <div className="glass-card rounded-xl p-4 mb-3 relative" dir="rtl">
        {/* 3-dot menu — top-left corner */}
        <div ref={dotsRef} className="absolute left-3 top-3">
          <button
            type="button"
            aria-label="אפשרויות נוספות"
            onClick={() => setDotsOpen(o => !o)}
            className={`p-1.5 rounded-lg transition-colors ${selectable ? "bg-blue-100 text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
          {dotsOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[130px]">
              <button
                type="button"
                onClick={() => { setSelectable(true); setSelectedIds({}); setDotsOpen(false); }}
                className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                סמן פגישות
              </button>
            </div>
          )}
        </div>

        {/* Filter fields + נקה סינון in the same flex row */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="filter-date-from" className="block text-xs font-medium text-slate-500 mb-1">מתאריך</label>
            <input id="filter-date-from" type="date" value={filters.date_from || ""}
              onChange={e => setServerFilter("date_from", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="filter-date-to" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
            <input id="filter-date-to" type="date" value={filters.date_to || ""}
              onChange={e => setServerFilter("date_to", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-slate-500 mb-1">סטטוס</label>
            <select id="filter-status" value={filters.status || ""} onChange={e => setServerFilter("status", e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              {MEETING_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-advisor" className="block text-xs font-medium text-slate-500 mb-1">יועץ מבצע</label>
            <select id="filter-advisor" value={filters.advisor_id || ""} onChange={e => setServerFilter("advisor_id", e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              {advisors.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-school-name" className="block text-xs font-medium text-slate-500 mb-1">שם מוסד</label>
            <input id="filter-school-name" type="text" value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              placeholder="חיפוש לפי שם..."
              className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="filter-school-symbol" className="block text-xs font-medium text-slate-500 mb-1">סמל מוסד</label>
            <input id="filter-school-symbol" type="text" value={symbolFilter}
              onChange={e => setSymbolFilter(e.target.value)}
              placeholder="סמל..."
              className={INPUT_CLS + " w-28"} />
          </div>
          <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1 py-1.5 self-end">
            נקה סינון
          </button>
        </div>
      </div>

      {/* Advanced filter panel */}
      {showAdvanced && (
        <div className="glass-card rounded-xl p-4 mb-3 flex flex-wrap items-end gap-4" dir="rtl">
          <div>
            <label htmlFor="filter-city" className="block text-xs font-medium text-slate-500 mb-1">עיר</label>
            <input id="filter-city" type="text" value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              placeholder="חיפוש לפי עיר..."
              className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="filter-district" className="block text-xs font-medium text-slate-500 mb-1">מחוז</label>
            <input id="filter-district" type="text" value={districtFilter}
              onChange={e => setDistrictFilter(e.target.value)}
              placeholder="חיפוש לפי מחוז..."
              className={INPUT_CLS} />
          </div>
        </div>
      )}

      <MeetingsBulkActionBar
        selectedCount={selectedCount}
        canDelete={canDeleteMeetings}
        onBulkDelete={() => setBulkDeleteConfirm(true)}
        onClearSelection={() => { setSelectedIds({}); setSelectable(false); }}
        onExportExcel={exportSelectedToExcel}
        onExportPdf={exportSelectedToPdf}
        onSendBulkReminder={sendBulkStatusReminders}
      />

      {loading ? (
        <div className="glass-card rounded-2xl p-10 flex justify-center">
          <div role="status" aria-label="טוען פגישות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
        </div>
      ) : error && meetings.length === 0 ? (
        <div role="alert" className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={() => loadAllMeetings(filters)} className="btn-blue text-sm px-4 py-2">רענן</button>
        </div>
      ) : displayedMeetings.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-3xl mb-3">📅</p>
          <p className="font-semibold text-slate-700 mb-1">אין פגישות להצגה</p>
          <p className="text-slate-400 text-sm mb-4">נסה לשנות את הסינון או להוסיף פגישה חדשה</p>
        </div>
      ) : (
        <div className="relative">
          {error && <p role="alert" className="text-red-600 text-sm mb-2">{error}</p>}
          <MeetingsTable
            meetings={displayedMeetings}
            usersWithAccess={users || []}
            usersWithoutAccess={[]}
            contactsFor={m => buildSchoolContacts(schools.find(s => s.id === m.school_id))}
            onSave={updateMeeting}
            onDelete={id => setDeleteConfirmId(id)}
            onOpenNotes={(meetingId, notes, onSave) => setNotesModal({ meetingId, notes, onSave })}
            onRequestAccess={() => {}}
            canDeleteMeetings={canDeleteMeetings}
            showSchoolColumn
            schoolLabelFor={m => schoolLabel({ name: m.school_name, symbol: m.school_symbol, city: m.school_city })}
            onOpenSchoolPicker={id => setSchoolPickerFor(id)}
            selectable={selectable}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onSendStatusReminder={sendStatusReminder}
          />
          {currentSchoolPickerMeeting && (
            <SchoolPickerPopover
              schools={schools}
              currentSchoolId={currentSchoolPickerMeeting.school_id}
              onConfirm={s => reassignSchool(currentSchoolPickerMeeting.id, s)}
              onClose={() => setSchoolPickerFor(null)}
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button type="button" onClick={exportMeetingsToPdf}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
          style={{ background: "#b45309" }} aria-label="הורד PDF">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          PDF
        </button>
        <button type="button" onClick={exportMeetingsToExcel}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
          style={{ background: "#166534" }} aria-label="הורד Excel">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Excel
        </button>
        <span className="text-xs text-slate-400 mr-2">{displayedMeetings.length} פגישות</span>
      </div>
    </div>
  );
});

export default AdminMeetingsTab;
