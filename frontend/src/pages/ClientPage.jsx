import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { History, Phone, UsersRound, CalendarDays } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { SchoolActivityModal } from "../components/SchoolActivityModal";
import { MeetingsTable } from "../components/meetings/MeetingsTable";
import { MeetingSummaryModal } from "../components/meetings/MeetingSummaryModal";
import { buildSchoolContacts } from "../components/meetings/schoolContacts";
import { mergeMeetingsSilently } from "../components/meetings/mergeMeetings";
import { useMeetingsPolling } from "../hooks/useMeetingsPolling";
import { useAiSummaryEnabled } from "../hooks/useAiSummaryEnabled";
import { useMeetingNotes } from "../context/MeetingNotesContext";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { ENTITY_TYPE_LABELS } from "../constants/clientEntities";

// District / ownership client card ("/client/:clientId") — a lighter card than the school's:
// details (name, "לקוח של הארגון", contacts) and a meetings tab for logging work on the whole
// district / ownership in one row. The row is a `schools` row (client_type district/ownership),
// so meetings use the regular /schools/{id}/meetings endpoints. See backend/client_entities.py.

const WEEKDAY_OPTIONS = [
  { value: "sun", label: "א" },
  { value: "mon", label: "ב" },
  { value: "tue", label: "ג" },
  { value: "wed", label: "ד" },
  { value: "thu", label: "ה" },
  { value: "fri", label: "ו" },
];

const EMPTY_CONTACT = { role: "", name: "", phone: "", email: "", day_off: [] };
const SURFACE_HEADERS = { headers: { "X-Client-Surface": "client_card" } };
const sectionCardCls = "bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden";
const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 bg-white";

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

function ContactsSection({ client, onSaved, canEditDirectly, canRequestUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const contacts = client.extra_contacts || [];
  const canEdit = canEditDirectly || canRequestUpdate;

  function startEdit() {
    setDraft(contacts.length ? contacts.map(c => ({ ...EMPTY_CONTACT, ...c, day_off: c.day_off || [] })) : [{ ...EMPTY_CONTACT }]);
    setError("");
    setNotice("");
    setEditing(true);
  }

  function setField(i, field, value) {
    setDraft(prev => prev.map((c, j) => (j === i ? { ...c, [field]: value } : c)));
  }

  async function save() {
    const cleaned = draft
      .map(c => ({ ...c, role: c.role.trim(), name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() }))
      .filter(c => c.name || c.phone || c.email);
    setSaving(true);
    setError("");
    try {
      if (canEditDirectly) {
        const res = await axios.put(`/clients/${client.id}/contacts`, { extra_contacts: cleaned });
        onSaved(res.data);
      } else {
        await axios.post(`/schools/${client.id}/update-requests`, { proposed_changes: { extra_contacts: cleaned } });
        setNotice("הבקשה נשלחה לאישור מנהל");
      }
      setEditing(false);
    } catch (e) {
      setError(e?.response?.data?.detail || "השמירה נכשלה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={sectionCardCls} aria-labelledby="client-contacts-title">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h2 id="client-contacts-title" className="font-semibold text-slate-800 flex items-center gap-2">
          <Phone className="w-4 h-4 text-slate-400" aria-hidden="true" />
          אנשי קשר
        </h2>
        {!editing && canEdit && (
          <button type="button" onClick={startEdit} className="btn-ghost text-sm px-3 py-1.5">
            {canEditDirectly ? "עריכה" : "בקשת עדכון"}
          </button>
        )}
      </div>
      {notice && <p role="status" className="px-5 pt-3 text-sm text-green-700">{notice}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500 text-xs">
              <th scope="col" className="text-right font-semibold py-2 px-3">תפקיד</th>
              <th scope="col" className="text-right font-semibold py-2 px-3">שם</th>
              <th scope="col" className="text-right font-semibold py-2 px-3">טלפון</th>
              <th scope="col" className="text-right font-semibold py-2 px-3">מייל</th>
              <th scope="col" className="text-right font-semibold py-2 px-3">יום חופשי</th>
              {editing && <th scope="col" className="py-2 px-3"><span className="sr-only">פעולות</span></th>}
            </tr>
          </thead>
          <tbody>
            {editing ? draft.map((c, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 px-3">
                  <label htmlFor={`cc-role-${i}`} className="sr-only">תפקיד</label>
                  <input id={`cc-role-${i}`} className={inputCls} value={c.role} onChange={e => setField(i, "role", e.target.value)} placeholder="לדוגמה: מפקח/ת" />
                </td>
                <td className="py-2 px-3">
                  <label htmlFor={`cc-name-${i}`} className="sr-only">שם</label>
                  <input id={`cc-name-${i}`} className={inputCls} value={c.name} onChange={e => setField(i, "name", e.target.value)} />
                </td>
                <td className="py-2 px-3">
                  <label htmlFor={`cc-phone-${i}`} className="sr-only">טלפון</label>
                  <input id={`cc-phone-${i}`} className={`${inputCls} text-center`} dir="ltr" value={c.phone} onChange={e => setField(i, "phone", e.target.value)} />
                </td>
                <td className="py-2 px-3">
                  <label htmlFor={`cc-email-${i}`} className="sr-only">מייל</label>
                  <input id={`cc-email-${i}`} type="email" className={`${inputCls} text-center`} dir="ltr" value={c.email} onChange={e => setField(i, "email", e.target.value)} />
                </td>
                <td className="py-2 px-3">
                  <MultiSelectChips compact options={WEEKDAY_OPTIONS} selected={c.day_off || []} onChange={v => setField(i, "day_off", v)} />
                </td>
                <td className="py-2 px-3 text-center">
                  <button type="button" onClick={() => setDraft(prev => prev.filter((_, j) => j !== i))}
                    className="text-slate-400 hover:text-red-500 px-1" aria-label={`הסר איש קשר ${c.name || i + 1}`}>✕</button>
                </td>
              </tr>
            )) : contacts.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">אין אנשי קשר עדיין</td></tr>
            ) : contacts.map((c, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="py-2.5 px-3 text-slate-600">{c.role || "—"}</td>
                <td className="py-2.5 px-3 font-medium text-slate-800">{c.name || "—"}</td>
                <td className="py-2.5 px-3 text-slate-600" dir="ltr">{c.phone || "—"}</td>
                <td className="py-2.5 px-3 text-slate-600" dir="ltr">{c.email || "—"}</td>
                <td className="py-2.5 px-3">
                  <div className="flex flex-wrap gap-1">
                    {(c.day_off || []).length === 0 ? <span className="text-slate-400">—</span> : c.day_off.map(v => (
                      <span key={v} className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        {WEEKDAY_OPTIONS.find(o => o.value === v)?.label || v}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-100">
          <button type="button" onClick={() => setDraft(prev => [...prev, { ...EMPTY_CONTACT }])} className="btn-ghost text-sm px-3 py-1.5">
            + הוסף איש קשר
          </button>
          <div className="mr-auto flex items-center gap-2">
            {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5">ביטול</button>
            <button type="button" onClick={save} disabled={saving} className="btn-blue text-sm px-4 py-1.5">
              {saving ? "שומר..." : canEditDirectly ? "שמירה" : "שלח בקשה"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ClientMarkSection({ client, onChanged, canMark, canRequestUpdate }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const labels = ENTITY_TYPE_LABELS[client.client_type];

  async function toggle() {
    const next = !client.is_client;
    setBusy(true);
    setMessage("");
    try {
      if (canMark) {
        const res = await axios.patch(`/clients/${client.id}/client-list`, { is_client: next });
        onChanged(res.data);
      } else {
        await axios.post(`/schools/${client.id}/update-requests`, { proposed_changes: { is_client: next } });
        setMessage("הבקשה נשלחה לאישור מנהל");
      }
    } catch (e) {
      setMessage(e?.response?.data?.detail || "הפעולה נכשלה — נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  const canAct = canMark || canRequestUpdate;
  return (
    <section className={`${sectionCardCls} px-5 py-4 flex flex-wrap items-center gap-3`} aria-labelledby="client-mark-title">
      <UsersRound className="w-4 h-4 text-slate-400" aria-hidden="true" />
      <h2 id="client-mark-title" className="font-semibold text-slate-800">לקוח של הארגון</h2>
      {client.is_client
        ? <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">מסומן כלקוח</span>
        : <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500">לא מסומן</span>}
      {canAct && (
        <button type="button" onClick={toggle} disabled={busy} className="btn-ghost text-sm px-3 py-1.5 mr-auto">
          {client.is_client
            ? (canMark ? "הסר סימון לקוח" : "בקש להסיר סימון לקוח")
            : (canMark ? `סמן את ה${labels.singular} כלקוח` : "בקש לסמן כלקוח")}
        </button>
      )}
      {message && <p role="status" className="w-full text-sm text-slate-600">{message}</p>}
    </section>
  );
}

export default function ClientPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("info");
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [showActivity, setShowActivity] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [canDeleteMeetings, setCanDeleteMeetings] = useState(false);
  const [showCalendarColumn, setShowCalendarColumn] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState("");
  const [summaryModalFor, setSummaryModalFor] = useState(null);
  const loadedYearRef = useRef(null);
  const aiSummaryEnabled = useAiSummaryEnabled();
  const { openMeetingNotes } = useMeetingNotes();

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    axios.get(`/clients/${clientId}`)
      .then(res => { if (!cancelled) setClient(res.data); })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err?.response?.status === 404 ? "הכרטיס לא נמצא" : "שגיאה בטעינת הכרטיס — נסה לרענן");
      });
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    axios.get("/schools/users/me").then(res => {
      setCurrentUser(res.data || null);
      setCanDeleteMeetings(!!res.data?.can_delete_own_meetings);
      if (res.data?.role === "owner" || res.data?.role === "manager") {
        axios.get("/schools/users/all").then(r => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
      }
    }).catch(() => {});
    axios.get("/calendar/connection")
      .then(r => setShowCalendarColumn(r.data?.org?.status === "connected"))
      .catch(() => {});
  }, []);

  async function loadMeetings({ silent } = {}) {
    if (!silent) setMeetingsLoading(true);
    setMeetingsError("");
    try {
      const res = await axios.get(`/schools/${clientId}/meetings`, { params: { academic_year: academicYear } });
      const rows = (res.data || []).map(m => ({ ...m, school_client_type: client?.client_type }));
      setMeetings(prev => (silent ? mergeMeetingsSilently(prev, rows) : rows));
    } catch {
      if (!silent) setMeetingsError("שגיאה בטעינת הפגישות — נסה לרענן");
    } finally {
      if (!silent) setMeetingsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "meetings" || !client) return;
    const key = `${clientId}|${academicYear}`;
    if (loadedYearRef.current === key) return;
    loadedYearRef.current = key;
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, client, clientId, academicYear]);

  useMeetingsPolling(() => loadMeetings({ silent: true }), activeTab === "meetings" && !!client, [clientId, academicYear]);

  async function addMeeting() {
    const payload = {
      status: "scheduled",
      meeting_type: "remote",
      advisor_ids: currentUser?.id ? [currentUser.id] : [],
      participants: [],
      academic_year: academicYear,
    };
    try {
      const res = await axios.post(`/schools/${clientId}/meetings`, payload, SURFACE_HEADERS);
      const advisorProfiles = (res.data?.advisor_ids || [])
        .map(id => users.find(u => u.id === id) || (currentUser?.id === id ? currentUser : null))
        .filter(Boolean);
      setMeetings(prev => [{ ...res.data, school_client_type: client.client_type, advisor_profiles: advisorProfiles }, ...prev]);
    } catch (err) {
      console.error("Failed to create meeting:", err);
    }
  }

  async function updateMeeting(draft) {
    if (!draft?.id) return;
    setMeetings(prev => prev.map(m => (m.id === draft.id ? { ...m, ...draft } : m)));
    const payload = {
      meeting_date: draft.meeting_date || null,
      ...(draft.status ? { status: draft.status, status_changed: true } : {}),
      start_time: normalizeTime(draft.start_time),
      end_time: normalizeTime(draft.end_time),
      advisor_ids: draft.advisor_ids || [],
      participants: draft.participants || [],
      meeting_type: draft.meeting_type || null,
      meeting_service_type: draft.meeting_service_type || null,
      actual_duration: draft.actual_duration || null,
      notes: draft.notes || null,
      primary_contact_key: draft.primary_contact_key || null,
      stage_scope: null,
    };
    try {
      const res = await axios.put(`/schools/${clientId}/meetings/${draft.id}`, payload, SURFACE_HEADERS);
      const advisorProfiles = (res.data?.advisor_ids || [])
        .map(id => users.find(u => u.id === id) || (draft.advisor_profiles || []).find(p => p.id === id))
        .filter(Boolean);
      setMeetings(prev => prev.map(m => (m.id === draft.id
        ? { ...res.data, school_client_type: client.client_type, advisor_profiles: advisorProfiles } : m)));
    } catch (err) {
      loadMeetings({ silent: true });
      throw err;
    }
  }

  async function deleteMeeting(meetingId) {
    await axios.delete(`/schools/${clientId}/meetings/${meetingId}`);
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
  }

  function openNotes(meeting) {
    openMeetingNotes({ meetingId: meeting.id, schoolId: clientId, schoolName: client?.label });
  }

  const labels = client ? ENTITY_TYPE_LABELS[client.client_type] : null;
  const tabs = labels ? [
    { id: "info", label: `פרטי ה${labels.singular}`, Icon: UsersRound },
    { id: "meetings", label: "פגישות", Icon: CalendarDays },
  ] : [];

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="max-w-[100rem] mx-auto px-6 py-8">
          <button type="button" onClick={() => navigate("/")} className="text-sm text-slate-500 hover:text-slate-700 mb-4">
            → חזרה למסך הבית
          </button>

          {loadError && (
            <div role="alert" className="glass-card rounded-2xl p-6 text-center text-red-600">{loadError}</div>
          )}

          {!client && !loadError && (
            <div role="status" aria-label="טוען כרטיס" className="flex justify-center py-20">
              <div aria-hidden="true" className="spinner w-10 h-10" />
            </div>
          )}

          {client && (
            <>
              <div className="mb-6">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{labels.singular}</span>
                <h1 className="text-2xl font-bold text-slate-900 mt-2">{client.label}</h1>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 mb-6">
                <div className="flex gap-1" role="tablist" aria-label={`לשוניות כרטיס ${labels.singular}`}>
                  {tabs.map(({ id, label, Icon }) => (
                    <button key={id} type="button" role="tab" aria-selected={activeTab === id}
                      onClick={() => setActiveTab(id)}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        activeTab === id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
                {activeTab === "info" && (
                  <button type="button" onClick={() => setShowActivity(true)}
                    className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 px-2.5 py-1 rounded-lg hover:bg-slate-100">
                    <History className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                    תיעוד פעולות
                  </button>
                )}
                <div className="pb-1.5 mr-auto">
                  <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
                </div>
              </div>

              {showActivity && (
                <SchoolActivityModal schoolId={clientId} schoolName={client.label} academicYear={academicYear}
                  onClose={() => setShowActivity(false)} />
              )}

              {activeTab === "info" && (
                <div className="flex flex-col gap-5">
                  <ClientMarkSection client={client} onChanged={c => setClient(prev => ({ ...prev, ...c }))}
                    canMark={!!client.can_mark_client} canRequestUpdate={!!client.can_request_update} />
                  <ContactsSection client={client} onSaved={c => setClient(prev => ({ ...prev, ...c }))}
                    canEditDirectly={!!client.can_edit_directly} canRequestUpdate={!!client.can_request_update} />
                </div>
              )}

              {activeTab === "meetings" && (
                <div>
                  {summaryModalFor && (
                    <MeetingSummaryModal
                      meeting={summaryModalFor}
                      onClose={() => setSummaryModalFor(null)}
                      onOpenNotes={openNotes}
                      onUploadStarted={meetingId => setMeetings(prev => prev.map(m => (m.id === meetingId ? { ...m, summary_status: "processing" } : m)))}
                    />
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <button type="button" onClick={addMeeting} className="btn-blue text-sm px-4 py-2 flex items-center gap-2">
                      <span aria-hidden="true">+</span> הוסף פגישה / תיעוד עבודה
                    </button>
                  </div>
                  {meetingsLoading ? (
                    <div className="glass-card rounded-2xl p-10 flex justify-center">
                      <div role="status" aria-label="טוען פגישות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
                    </div>
                  ) : meetingsError ? (
                    <div role="alert" className="glass-card rounded-2xl p-6 text-center">
                      <p className="text-red-600 mb-3">{meetingsError}</p>
                      <button type="button" onClick={() => loadMeetings()} className="btn-blue text-sm px-4 py-2">רענן</button>
                    </div>
                  ) : meetings.length === 0 ? (
                    <div className="glass-card rounded-2xl p-12 text-center">
                      <p className="font-semibold text-slate-700 mb-1">אין פגישות עדיין</p>
                      <p className="text-slate-400 text-sm">לחץ על "הוסף פגישה / תיעוד עבודה" כדי לתעד עבודה על ה{labels.singular}</p>
                    </div>
                  ) : (
                    <MeetingsTable
                      clientSurface="client_card"
                      entityMode
                      hideReminderColumn
                      meetings={meetings}
                      usersWithAccess={users}
                      usersWithoutAccess={[]}
                      contacts={buildSchoolContacts(client)}
                      onSave={updateMeeting}
                      onMeetingPatched={(id, patch) => setMeetings(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)))}
                      onDelete={deleteMeeting}
                      onMeetingMovedYear={meetingId => setMeetings(prev => prev.filter(m => m.id !== meetingId))}
                      onOpenNotes={openNotes}
                      canDeleteMeetings={canDeleteMeetings}
                      showCalendarColumn={showCalendarColumn}
                      onOpenSummary={setSummaryModalFor}
                      aiSummaryEnabled={aiSummaryEnabled}
                      typedAdvisorsFor={() => null}
                      currentUserRole={currentUser?.role}
                      currentUserId={currentUser?.id}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
