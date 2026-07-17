import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
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
import MeetingNavigationGuardModal from "../components/meetings/MeetingNavigationGuardModal";
import { getMissingCriticalFields, isMeetingIncomplete } from "../components/meetings/meetingCompleteness";
import { buildSchoolContacts } from "../components/meetings/schoolContacts";
import { normalizeTimeValue } from "../components/meetings/TimeInput";

const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_FILTERS = { status: "", date_from: TODAY, date_to: TODAY };
const SS_KEY = "personal_meetings_ui_state";
const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

function readSavedState() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || "null"); } catch { return null; }
}
function saveState(state) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export default function PersonalMeetingsTab({ userId, canDeleteMeetings, users }) {
  const saved = readSavedState();

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [filters, setFilters] = useState(saved?.filters ?? DEFAULT_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(saved?.showAdvanced ?? false);

  const [nameFilter, setNameFilter] = useState(saved?.nameFilter ?? "");
  const [symbolFilter, setSymbolFilter] = useState(saved?.symbolFilter ?? "");
  const [cityFilter, setCityFilter] = useState(saved?.cityFilter ?? "");
  const [districtFilter, setDistrictFilter] = useState(saved?.districtFilter ?? "");

  const [schools, setSchools] = useState([]);
  const [selectable, setSelectable] = useState(false);
  const [dotsOpen, setDotsOpen] = useState(false);
  const dotsRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [notesModal, setNotesModal] = useState(null);
  const [schoolPickerFor, setSchoolPickerFor] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [reminderToasts, setReminderToasts] = useState([]);
  const [alreadySentModal, setAlreadySentModal] = useState(null);
  const sessionCreatedMeetingIdsRef = useRef(new Set());
  const [meetingGuardBusy, setMeetingGuardBusy] = useState(false);

  const incompleteSessionMeetings = meetings.filter(m =>
    sessionCreatedMeetingIdsRef.current.has(m.id) && isMeetingIncomplete(m, { requireSchool: true })
  );
  const hasIncompleteMeetings = incompleteSessionMeetings.length > 0;
  const blocker = useBlocker(hasIncompleteMeetings);

  async function discardIncompleteMeetings(ids) {
    for (const id of ids) {
      const m = meetings.find(x => x.id === id);
      if (!m) continue;
      try { await axios.delete(`/schools/${m.school_id}/meetings/${id}`); } catch { /* best-effort */ }
    }
    setMeetings(prev => prev.filter(m => !ids.includes(m.id)));
    ids.forEach(id => sessionCreatedMeetingIdsRef.current.delete(id));
  }

  function addReminderToast(msg) {
    const id = Date.now();
    setReminderToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setReminderToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }

  // Persist filter state
  useEffect(() => {
    saveState({ filters, showAdvanced, nameFilter, symbolFilter, cityFilter, districtFilter });
  }, [filters, showAdvanced, nameFilter, symbolFilter, cityFilter, districtFilter]);

  // Click-outside for 3-dot
  useEffect(() => {
    function h(e) { if (!dotsRef.current?.contains(e.target)) setDotsOpen(false); }
    if (dotsOpen) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [dotsOpen]);

  async function loadMeetings(activeFilters) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (activeFilters.status) params.set("status", activeFilters.status);
      if (activeFilters.date_from) params.set("date_from", activeFilters.date_from);
      if (activeFilters.date_to) params.set("date_to", activeFilters.date_to);
      params.set("academic_year", academicYear);
      const res = await axios.get(`/schools/meetings/my?${params}`);
      setMeetings(res.data || []);
    } catch {
      setError("שגיאה בטעינת פגישות");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeetings(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, academicYear]);

  useEffect(() => {
    axios.get("/schools/").then(r => setSchools((r.data || []).filter(s => s.status !== "deleted"))).catch(() => {});
  }, []);

  function setServerFilter(key, val) {
    setFilters(prev => {
      const next = { ...prev, [key]: val || null };
      return next;
    });
  }

  async function updateMeeting(draft) {
    const { id, school_id, ...rest } = draft;
    const payload = {
      ...rest,
      start_time: normalizeTimeValue(draft.start_time) || null,
      end_time: normalizeTimeValue(draft.end_time) || null,
    };
    try {
      const res = await axios.put(`/schools/${school_id}/meetings/${id}`, payload);
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, ...res.data } : m));
    } catch { /* silent */ }
  }

  async function deleteMeeting(id) {
    const m = meetings.find(x => x.id === id);
    if (!m) return;
    try {
      await axios.delete(`/schools/${m.school_id}/meetings/${id}`);
      setMeetings(prev => prev.filter(x => x.id !== id));
    } catch { /* silent */ }
  }

  async function createMeetingForSchool(school) {
    const payload = { status: "scheduled", meeting_type: "remote", advisor_ids: userId ? [userId] : [], participants: [], reminder_enabled: false, academic_year: academicYear };
    try {
      const res = await axios.post(`/schools/${school.id}/meetings`, payload);
      const newMeeting = { ...res.data, advisor_profiles: [], school_name: school.name, school_symbol: school.symbol, school_city: school.city, school_district: school.district };
      setMeetings(prev => [newMeeting, ...prev]);
      sessionCreatedMeetingIdsRef.current.add(newMeeting.id);
    } catch { /* silent */ }
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
    } catch { /* silent */ }
    setSchoolPickerFor(null);
  }

  async function sendStatusReminder(meeting, force = false) {
    try {
      const res = await axios.post(`/schools/meetings/${meeting.id}/send-status-reminder?force=${force}`);
      if (res.data.already_sent && !force) {
        setAlreadySentModal({ meeting, lastSentAt: res.data.last_sent_at, recipients: res.data.recipients });
        return;
      }
      const names = (res.data.recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
      const dateStr = meeting.meeting_date ? formatMeetingDate(meeting.meeting_date) : "";
      addReminderToast(`נשלחה תזכורת ל-${names} עבור עדכון סטטוס פגישה עם ${meeting.school_name || ""} (${dateStr})`);
    } catch (e) {
      addReminderToast(e.response?.data?.detail || "שגיאה בשליחת התזכורת");
    }
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
  }

  async function sendBulkStatusReminders() {
    const eligible = displayedMeetings.filter(m =>
      selectedIds[m.id] &&
      m.status === "scheduled" &&
      m.meeting_date <= TODAY &&
      m.end_time &&
      new Date(`${m.meeting_date}T${m.end_time}:00`) <= new Date()
    );
    if (!eligible.length) { addReminderToast("אין פגישות מתאימות לשליחת תזכורת"); return; }
    const results = await Promise.allSettled(
      eligible.map(m => axios.post(`/schools/meetings/${m.id}/send-status-reminder?force=true`))
    );
    const sent = results.filter(r => r.status === "fulfilled").length;
    addReminderToast(`נשלחו תזכורות ל-${sent} פגישות`);
  }

  function exportSelectedToExcel() {
    const selected = displayedMeetings.filter(m => selectedIds[m.id]);
    const headers = ["שם מוסד", "סמל", "תאריך", "שעה", "סטטוס", "סוג פגישה", "עיר"];
    const rows = selected.map(m => [
      m.school_name || "", m.school_symbol || "",
      m.meeting_date ? formatMeetingDate(m.meeting_date) : "",
      m.meeting_time || "",
      STATUS_MAP[m.status]?.label || m.status || "",
      MEETING_TYPE_OPTIONS.find(o => o.value === m.meeting_type)?.label || m.meeting_type || "",
      m.school_city || "",
    ]);
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "הפגישות שלי");
    XLSX.writeFile(wb, "הפגישות_שלי.xlsx");
  }

  async function exportSelectedToPdf() {
    const selected = displayedMeetings.filter(m => selectedIds[m.id]);
    const headers = ["שם מוסד", "סמל", "תאריך", "שעה", "סטטוס", "סוג פגישה", "עיר"];
    const rows = selected.map(m => [
      m.school_name || "", m.school_symbol || "",
      m.meeting_date ? formatMeetingDate(m.meeting_date) : "",
      m.meeting_time || "",
      STATUS_MAP[m.status]?.label || m.status || "",
      MEETING_TYPE_OPTIONS.find(o => o.value === m.meeting_type)?.label || m.meeting_type || "",
      m.school_city || "",
    ]);
    try {
      const res = await axios.post(
        "/schools/export-pdf",
        { title: `הפגישות שלי (${selected.length})`, headers, rows },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "הפגישות_שלי.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setNameFilter(""); setSymbolFilter(""); setCityFilter(""); setDistrictFilter("");
  }

  const displayedMeetings = useMemo(() => {
    let list = meetings;
    if (nameFilter.trim()) list = list.filter(m => (m.school_name || "").includes(nameFilter.trim()));
    if (symbolFilter.trim()) list = list.filter(m => (m.school_symbol || "").includes(symbolFilter.trim()));
    if (cityFilter.trim()) list = list.filter(m => (m.school_city || "").includes(cityFilter.trim()));
    if (districtFilter.trim()) list = list.filter(m => (m.school_district || "").includes(districtFilter.trim()));
    return list;
  }, [meetings, nameFilter, symbolFilter, cityFilter, districtFilter]);

  const advancedFilterCount = (cityFilter ? 1 : 0) + (districtFilter ? 1 : 0);
  const currentSchoolPickerMeeting = schoolPickerFor && schoolPickerFor !== "new"
    ? meetings.find(m => m.id === schoolPickerFor)
    : null;

  return (
    <div dir="rtl">
      {/* Toasts */}
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

      {/* Already-sent modal */}
      {alreadySentModal && (() => {
        const { meeting, lastSentAt, recipients } = alreadySentModal;
        const d = new Date(lastSentAt);
        const pad = n => String(n).padStart(2, "0");
        const dStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(-2)}`;
        const tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const names = (recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
              <h2 className="text-base font-bold text-slate-800 text-center">תזכורת כבר נשלחה</h2>
              <p className="text-sm text-slate-600 text-center leading-relaxed">
                תזכורת כבר נשלחה ב-<strong>{dStr}</strong> בשעה <strong>{tStr}</strong>
                {names ? <> ל-<strong>{names}</strong></> : ""}.<br />האם לשלוח תזכורת חדשה בכל זאת?
              </p>
              <div className="flex gap-3 justify-center mt-1">
                <button type="button" onClick={() => { sendStatusReminder(meeting, true); setAlreadySentModal(null); }}
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

      {/* Modals */}
      {notesModal && (
        <NotesModal notes={notesModal.notes} users={users || []}
          onSave={noteText => { notesModal.onSave(noteText); setNotesModal(null); }}
          onClose={() => setNotesModal(null)} />
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
      {blocker.state === "blocked" && hasIncompleteMeetings && (
        <MeetingNavigationGuardModal
          missingFields={[...new Set(incompleteSessionMeetings.flatMap(m => getMissingCriticalFields(m, { requireSchool: true })))]}
          busy={meetingGuardBusy}
          onStay={() => blocker.reset()}
          onSaveAndLeave={() => blocker.proceed()}
          onDiscardAndLeave={async () => {
            setMeetingGuardBusy(true);
            await discardIncompleteMeetings(incompleteSessionMeetings.map(m => m.id));
            setMeetingGuardBusy(false);
            blocker.proceed();
          }}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
          <button type="button" onClick={() => setSchoolPickerFor("new")}
            className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl font-medium">
            <span aria-hidden="true">+</span> הוסף פגישה
          </button>
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

      {/* Main filter card */}
      <div className="glass-card rounded-xl p-4 mb-3 relative" dir="rtl">
        {/* 3-dot menu — top-left */}
        <div ref={dotsRef} className="absolute left-3 top-3">
          <button type="button" aria-label="אפשרויות נוספות" onClick={() => setDotsOpen(o => !o)}
            className={`p-1.5 rounded-lg transition-colors ${selectable ? "bg-blue-100 text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}>
            <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
          {dotsOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[130px]">
              <button type="button"
                onClick={() => { setSelectable(true); setSelectedIds({}); setDotsOpen(false); }}
                className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                סמן פגישות
              </button>
            </div>
          )}
        </div>

        {/* Filter fields */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="pmt-date-from" className="block text-xs font-medium text-slate-500 mb-1">מתאריך</label>
            <input id="pmt-date-from" type="date" value={filters.date_from || ""}
              onChange={e => setServerFilter("date_from", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="pmt-date-to" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
            <input id="pmt-date-to" type="date" value={filters.date_to || ""}
              onChange={e => setServerFilter("date_to", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="pmt-status" className="block text-xs font-medium text-slate-500 mb-1">סטטוס</label>
            <select id="pmt-status" value={filters.status || ""} onChange={e => setServerFilter("status", e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              {MEETING_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pmt-name" className="block text-xs font-medium text-slate-500 mb-1">שם מוסד</label>
            <input id="pmt-name" type="text" value={nameFilter}
              onChange={e => setNameFilter(e.target.value)} placeholder="חיפוש לפי שם..." className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="pmt-symbol" className="block text-xs font-medium text-slate-500 mb-1">סמל מוסד</label>
            <input id="pmt-symbol" type="text" value={symbolFilter}
              onChange={e => setSymbolFilter(e.target.value)} placeholder="סמל..." className={INPUT_CLS + " w-28"} />
          </div>
          <button type="button" onClick={clearFilters}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1 py-1.5 self-end">
            נקה סינון
          </button>
        </div>
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="glass-card rounded-xl p-4 mb-3" dir="rtl">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="pmt-city" className="block text-xs font-medium text-slate-500 mb-1">עיר</label>
              <input id="pmt-city" type="text" value={cityFilter}
                onChange={e => setCityFilter(e.target.value)} placeholder="סינון לפי עיר..." className={INPUT_CLS} />
            </div>
            <div>
              <label htmlFor="pmt-district" className="block text-xs font-medium text-slate-500 mb-1">מחוז</label>
              <input id="pmt-district" type="text" value={districtFilter}
                onChange={e => setDistrictFilter(e.target.value)} placeholder="סינון לפי מחוז..." className={INPUT_CLS} />
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      <MeetingsBulkActionBar
        selectedCount={selectedCount}
        canDelete={canDeleteMeetings}
        onBulkDelete={() => setBulkDeleteConfirm(true)}
        onClearSelection={() => { setSelectedIds({}); setSelectable(false); }}
        onExportExcel={exportSelectedToExcel}
        onExportPdf={exportSelectedToPdf}
        onSendBulkReminder={sendBulkStatusReminders}
      />

      {/* Table */}
      {loading ? (
        <div className="glass-card rounded-2xl p-10 flex justify-center">
          <div role="status" aria-label="טוען פגישות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
        </div>
      ) : error ? (
        <div role="alert" className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={() => loadMeetings(filters)} className="btn-blue text-sm px-4 py-2">רענן</button>
        </div>
      ) : displayedMeetings.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-3xl mb-3">📅</p>
          <p className="font-semibold text-slate-700 mb-1">אין פגישות להצגה</p>
          <p className="text-slate-400 text-sm mb-4">נסה לשנות את הסינון או להוסיף פגישה חדשה</p>
          <button onClick={() => setSchoolPickerFor("new")}
            className="btn-blue text-sm px-4 py-2">+ הוסף פגישה</button>
        </div>
      ) : (
        <div className="relative">
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
            hideAdvisorColumn
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

      <p className="text-xs text-slate-400 text-left mt-2">סה"כ {displayedMeetings.length} פגישות</p>
    </div>
  );
}
