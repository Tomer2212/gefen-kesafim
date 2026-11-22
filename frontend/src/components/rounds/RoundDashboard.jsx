import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useTasks } from "../../context/TasksContext";
import TaskCreateWizard from "../tasks/TaskCreateWizard";
import RoundFieldDays from "./RoundFieldDays";
import RoundCreateModal from "./RoundCreateModal";
import { MEETING_SERVICE_TYPE_LABELS, formatDateDMY } from "../tasks/taskShared";
import { exclusionTypesLabel } from "../tasks/AdvisorExclusionsEditor";
import {
  ROUND_STATUS_META, ROUND_STATUS_ORDER, ROUND_PROBLEM_LABELS, STALE_REQUEST_DAYS, requirementLabel, daysSince,
  PLAN_PART_LABELS,
  MEETING_KIND_ORDER, meetingKindOf, meetingKindLabel,
} from "./roundsShared";

// One "סבב פגישות": where every school stands, what to do next, and the round's tasks.
// Data: GET /rounds/{id} (backend/meeting_rounds.compute_round). Tasks are created through the
// regular TaskCreateWizard, pre-filled for the chosen schools (roundContext).
const WAITING = new Set(["requested", "opened"]);

function Kpi({ label, value, sub, tone = "text-slate-800" }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-w-[120px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// Why a physical-task button is disabled, right under it, with a way to fix it.
function FieldDaysMissingNote({ id, names, onGo }) {
  return (
    <p id={id} className="text-xs text-amber-800 bg-amber-100/70 rounded-lg px-2 py-1.5">
      כדי ליצור משימה פיזית צריך קודם להגדיר לפחות יום שטח אחד בתקופת הסבב ל: <b>{names.join(", ")}</b>.
      {" "}אם יועץ לא מגיע לבתי הספר, אפשר להסיר אותו מימי השטח.{" "}
      <button type="button" onClick={onGo} className="underline font-semibold">מעבר לימי שטח</button>
    </p>
  );
}

function ConfirmDialog({ title, children, actions, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="round-confirm-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3 text-sm">
        <h2 id="round-confirm-title" className="text-base font-bold text-slate-800">{title}</h2>
        {children}
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          {actions}
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// The card's advisor list(s) a meeting type's advisor comes from (takuma: the גפן list) — what's
// missing when a meeting shows under "ללא יועץ בכרטיס" (meeting_rounds._ADVISOR_LISTS).
const NO_ADVISOR_LISTS = { gefen: ["גפן"], current: ["שוטף"], district: ["מחוז"], takuma: ["גפן"], gefen_current: ["גפן", "שוטף"] };

export default function RoundDashboard({ roundId, onBack, onChanged }) {
  const { openTask } = useTasks();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [physicalFilter, setPhysicalFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [taskDraft, setTaskDraft] = useState(null); // {key, schoolIds, physical, requireAdditional}
  // GET /rounds/{id}/field-days as RoundFieldDays last loaded it: null = still loading, {failed: true}.
  const [fieldDays, setFieldDays] = useState(null);
  const [audienceDiff, setAudienceDiff] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showNoAdvisor, setShowNoAdvisor] = useState(false); // "ללא יועץ בכרטיס" row expanded

  function load() {
    axios.get(`/rounds/${roundId}`)
      .then(r => { setData(r.data); setLoadError(false); })
      .catch(() => setLoadError(true));
  }
  useEffect(() => { load(); }, [roundId]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(t);
  }, [roundId]);

  const rnd = data?.round;
  const schools = data?.schools || [];
  const names = data?.advisor_names || {};
  const totals = data?.totals;
  const counts = totals?.counts || {};
  const taskNames = useMemo(() => Object.fromEntries((data?.tasks || []).map(t => [t.id, t.name])), [data]);

  const stale = schools.filter(s => WAITING.has(s.status) && daysSince(s.request?.sent_at) >= STALE_REQUEST_DAYS);
  const untouched = schools.filter(s => s.status === "untouched");
  const partial = schools.filter(s => s.status === "partial");
  const problems = schools.filter(s => s.status === "problem");
  // Still missing a meeting with no live request asking for it — nothing happens unless a task is made.
  const noRequest = schools.filter(s => s.needs_request);

  // How many schools need each kind of meeting (only kinds with at least one school are shown).
  const byKind = useMemo(() => {
    const out = {};
    for (const s of schools) {
      const e = out[meetingKindOf(s, rnd?.requirement)] ||= { schools: 0, required: 0, booked: 0 };
      e.schools += 1;
      e.required += s.required_count;
      e.booked += s.booked_count;
    }
    return MEETING_KIND_ORDER.filter(k => out[k]?.schools).map(k => ({ kind: k, ...out[k] }));
  }, [schools, rnd]);

  // Each advisor is credited only with the meetings they're in (school_status parts) — not the
  // meeting of the school's other advisor (e.g. the שוטף one of a גפן+שוטף school).
  const byAdvisor = useMemo(() => {
    const out = {};
    for (const s of schools) {
      const parts = s.parts?.length ? s.parts : [{ advisor_ids: s.advisor_ids, required: s.required_count, booked: s.booked_count }];
      const seen = new Set();
      for (const p of parts) {
        for (const aid of p.advisor_ids.length ? p.advisor_ids : ["__none__"]) {
          const e = out[aid] ||= { id: aid, schools: 0, required: 0, booked: 0, untouched: 0, items: [] };
          e.required += p.required;
          e.booked += p.booked;
          // "ללא יועץ בכרטיס": which school, and which card list is empty (none = no service type).
          if (aid === "__none__") {
            const item = e.items.find(i => i.school === s) || e.items[e.items.push({ school: s, types: [] }) - 1];
            if (p.type) item.types.push(p.type);
          }
          if (seen.has(aid)) continue;
          seen.add(aid);
          e.schools += 1;
          if (s.status === "untouched") e.untouched += 1;
        }
      }
    }
    return Object.values(out).sort((a, b) => (b.required - b.booked) - (a.required - a.booked));
  }, [schools]);

  const shown = schools.filter(s =>
    (!statusFilter || (statusFilter === "stale" ? stale.includes(s) : statusFilter === "no_request" ? s.needs_request : s.status === statusFilter))
    && (!physicalFilter || (physicalFilter === "physical") === s.physical)
    && (!query.trim() || `${s.school_name} ${s.symbol || ""} ${s.authority || ""} ${s.city || ""}`.includes(query.trim())),
  );

  // Whether a physical task can start for these schools. A physical task offers each school only
  // its visiting advisors' field days, so each of them (unless removed from field days) needs at
  // least one. Read from the data RoundFieldDays already loaded — a click never waits on the
  // network (that wait, with no feedback, let another button open a remote task meanwhile).
  // Returns {loading} | {missing: [names]} | {} (ready; also when loading failed — the task's own
  // pre-send check reports missing field days then).
  function physicalReadiness(rows) {
    if (!fieldDays) return { loading: true };
    if (fieldDays.failed) return {};
    // Only the advisors who visit (the round's per-school choice, when there is one).
    const visitors = rnd.physical_visitors || {};
    // An advisor of a part with several card advisors isn't required yet: the task's pre-check
    // asks which of them the meeting is for, and then checks the chosen one's field days.
    // The task asks only for the meetings still missing, so an advisor whose meeting is already
    // booked needs no field days for it.
    const neededIds = s => {
      const missing = (s.parts || []).filter(p => p.booked < p.required);
      return missing.length ? [...new Set(missing.flatMap(p => p.advisor_ids))] : s.advisor_ids;
    };
    const wanted = new Set(rows.flatMap(s => (visitors[s.school_id] ? neededIds(s).filter(a => visitors[s.school_id].includes(a)) : neededIds(s))
      .filter(a => !(s.advisor_choice_open_ids || []).includes(a))));
    const missing = (fieldDays.advisors || []).filter(a => wanted.has(a.advisor_id) && !a.exempt && !a.days.length);
    return missing.length ? { missing: missing.map(a => a.name || "יועץ"), missingIds: missing.map(a => a.advisor_id) } : {};
  }

  // A new task in the round — for these schools (a dashboard selection), or with no schools to
  // start from a filter in the task window. A fresh key per opening, so the window is always
  // built from this draft.
  function startTask(rows, { physical = false, requireAdditional = false } = {}) {
    if (taskDraft) return;
    // The task window splits these schools against the round: already booked → left out,
    // live request from another task of the round → left out unless chosen (also enforced by
    // the server), the rest get a request.
    setTaskDraft({ key: Date.now(), schoolIds: rows.map(s => s.school_id), physical, requireAdditional });
  }

  // "הצג": filters the schools table and scrolls to it — it's far below the summary sections, so
  // filtering alone changed nothing visible. The search and the physical filter are cleared, so
  // every school of this kind is shown.
  function showInTable(filter) {
    setStatusFilter(filter);
    setPhysicalFilter("");
    setQuery("");
    requestAnimationFrame(() => document.getElementById("round-schools-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // Straight to the "הוספת יום" field of the first advisor missing days (RoundFieldDays' input ids).
  function goToFieldDays(advisorIds = []) {
    const input = advisorIds.map(id => document.getElementById(`field-day-${id}`)).find(Boolean);
    if (input) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus({ preventScroll: true });
    } else {
      document.getElementById("round-field-days-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function sendReminders(rows) {
    const byTask = {};
    for (const s of rows) if (s.request?.task_id) (byTask[s.request.task_id] ||= []).push(s.school_id);
    setBusy(true);
    let sent = 0;
    let stillSending = 0;
    try {
      for (const [taskId, ids] of Object.entries(byTask)) {
        try {
          const r = await axios.post(`/tasks/${taskId}/send`, { only_school_ids: ids });
          sent += r.data?.queued || 0;
        } catch (e) {
          if (e.response?.data?.detail?.send_in_progress) stillSending += ids.length;
          sent += e.response?.data?.detail?.queued || 0;
        }
      }
      setNotice(`נשלחו ${sent} תזכורות (באותו נוסח של כל משימה, עם קישור חדש).`
        + (stillSending ? ` ${stillSending} בתי ספר לא קיבלו תזכורת כי השליחה הקודמת אליהם עדיין מתבצעת — נסו שוב בעוד כמה דקות.` : ""));
      load();
    } finally {
      setBusy(false);
    }
  }

  async function patchRound(patch) {
    setBusy(true);
    try {
      await axios.patch(`/rounds/${roundId}`, patch);
      load();
      onChanged?.();
    } catch {
      setNotice("השמירה נכשלה — נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  // A round "לפי תוכנית": take these schools' numbers from their cards again (the card changed).
  async function refreshPlan(schoolIds) {
    setBusy(true);
    try {
      await axios.post(`/rounds/${roundId}/plan-refresh`, { school_ids: schoolIds });
      load();
      onChanged?.();
      setNotice(`המספרים עודכנו מהכרטיס עבור ${schoolIds.length} בתי ספר.`);
    } catch {
      setNotice("העדכון מהכרטיס נכשל — נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  function excludeSelected() {
    const ids = new Set([...(rnd.excluded_school_ids || []), ...selected]);
    setSelected(new Set());
    patchRound({ excluded_school_ids: [...ids] });
  }

  async function previewAudience() {
    setBusy(true);
    try {
      const r = await axios.post(`/rounds/${roundId}/audience-preview`);
      setAudienceDiff(r.data);
    } catch {
      setNotice("בדיקת הרשימה נכשלה — נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAudience() {
    setBusy(true);
    try {
      await axios.post(`/rounds/${roundId}/audience-apply`, {
        add_ids: audienceDiff.added.map(s => s.school_id), remove_ids: audienceDiff.removed.map(s => s.school_id),
      });
      setAudienceDiff(null);
      load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function deleteRound() {
    await axios.delete(`/rounds/${roundId}`);
    onChanged?.();
    onBack();
  }

  function exportExcel() {
    const rows = schools.map(s => ({
      "בית ספר": s.school_name, "סמל": s.symbol, "בעלות": s.authority, "מחוז": s.district, "עיר": s.city,
      "מצב": ROUND_STATUS_META[s.status]?.label, "בעיה": ROUND_PROBLEM_LABELS[s.problem] || "",
      "פגישה נדרשת": s.required_types.map(t => MEETING_SERVICE_TYPE_LABELS[t]).join(" · "),
      "נקבעו/נדרשו": `${s.booked_count}/${s.required_count}`,
      "תאריכי פגישות": s.meetings.map(m => formatDateDMY(m.date)).join(", "),
      "יועץ": s.advisor_ids.map(id => names[id]).filter(Boolean).join(", "),
      "פיזי": s.physical ? "כן" : "",
      "משימה": taskNames[s.request?.task_id] || "",
      "נשלחה בקשה": s.request?.sent_at ? formatDateDMY(s.request.sent_at.slice(0, 10)) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!views"] = [{ RTL: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "סבב");
    XLSX.writeFile(wb, `${rnd.name}.xlsx`);
  }

  if (loadError && !data) {
    return (
      <div dir="rtl" role="alert" className="text-sm text-red-600">
        טעינת הסבב נכשלה. <button type="button" className="underline" onClick={load}>נסו שוב</button>
        {" · "}<button type="button" className="underline" onClick={onBack}>חזרה</button>
      </div>
    );
  }
  if (!data) return <div dir="rtl" role="status" aria-label="טוען סבב" className="text-sm text-slate-400">טוען...</div>;

  const pct = totals.required ? Math.round((totals.booked / totals.required) * 100) : 0;
  const allShownSelected = shown.length > 0 && shown.every(s => selected.has(s.school_id));
  const selectedRows = schools.filter(s => selected.has(s.school_id));
  // Physical or remote task by where the school's MISSING meetings are held (location_need): a school
  // marked physical whose visiting advisor already booked needs only a remote meeting now.
  const needsPhysical = s => (s.location_need ? s.location_need === "physical" : s.physical);
  const physicalUntouched = untouched.filter(needsPhysical);
  const remoteUntouched = untouched.filter(s => !needsPhysical(s));
  const physicalPartial = partial.filter(needsPhysical);
  const remotePartial = partial.filter(s => !needsPhysical(s));
  const physicalNoRequest = noRequest.filter(needsPhysical);
  const remoteNoRequest = noRequest.filter(s => !needsPhysical(s));
  const excludedNames = (data.excluded_school_ids || []).length;
  const physicalReady = physicalReadiness(physicalUntouched);
  const physicalPartialReady = physicalReadiness(physicalPartial);
  const physicalNoRequestReady = physicalReadiness(physicalNoRequest);
  // A round asking 2+ meetings per school: a school that holds some of them asks for another one.
  const askAdditional = rnd.plan_mode !== "plan" && (rnd.requirement?.count_per_school || 1) > 1;
  const selectedAllPhysical = selectedRows.length > 0 && selectedRows.every(needsPhysical);
  const selectedMixed = selectedRows.some(needsPhysical) && !selectedAllPhysical;
  const selectedReady = selectedAllPhysical ? physicalReadiness(selectedRows) : {};
  const ACTION_BTN = "text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed";
  const planChanged = schools.filter(s => s.plan?.changed);
  const planMissing = schools.filter(s => s.problem === "missing_plan");

  return (
    <div dir="rtl" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <button type="button" onClick={onBack} className="text-xs text-blue-600 hover:underline mb-1">→ כל הסבבים</button>
          <h2 className="text-lg font-bold text-slate-800">
            {rnd.name}
            {rnd.status === "closed" && <span className="mr-2 text-xs font-medium bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">סגור</span>}
          </h2>
          <p className="text-sm text-slate-500">
            <bdi>{formatDateDMY(rnd.start_date)}</bdi>–<bdi>{formatDateDMY(rnd.end_date)}</bdi> · {requirementLabel(rnd.requirement, rnd.plan_mode)}
          </p>
          {Object.keys(rnd.advisor_exclusions || {}).length > 0 && (
            <p className="text-xs text-violet-700">
              קובעים לעצמם (לא נשלחת בקשה):{" "}
              {Object.entries(rnd.advisor_exclusions).map(([id, t]) => `${names[id] || "יועץ"} — ${exclusionTypesLabel(t)}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => startTask([])} className="btn-blue text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">+ משימה חדשה בסבב</button>
          {rnd.criteria && <button type="button" disabled={busy} onClick={previewAudience} className="text-sm px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200">עדכון רשימת בתי הספר</button>}
          <button type="button" onClick={() => setEditing(true)} className="text-sm px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200">עריכת הסבב</button>
          <button type="button" onClick={exportExcel} className="text-sm px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200">ייצוא לאקסל</button>
          <button type="button" disabled={busy} onClick={() => patchRound({ status: rnd.status === "closed" ? "active" : "closed" })} className="text-sm px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200">
            {rnd.status === "closed" ? "פתיחה מחדש" : "סגירת הסבב"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm px-3 py-2 rounded-xl text-red-600 hover:bg-red-50">מחיקה</button>
        </div>
      </div>

      {notice && (
        <p role="status" className="text-sm bg-blue-50 text-blue-800 rounded-lg px-3 py-2 flex justify-between">
          {notice}<button type="button" aria-label="סגירת ההודעה" onClick={() => setNotice("")}>✕</button>
        </p>
      )}

      {planChanged.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>תוכנית הפגישות בכרטיס השתנתה אחרי יצירת הסבב ב-{planChanged.length} בתי ספר ({planChanged.slice(0, 5).map(s => s.school_name).join(", ")}{planChanged.length > 5 ? "…" : ""}). הסבב עדיין סופר לפי המספרים הקודמים.</span>
          <button type="button" disabled={busy} onClick={() => refreshPlan(planChanged.map(s => s.school_id))}
            className="text-xs px-2.5 py-1 rounded-md border border-amber-400 bg-white hover:bg-amber-100 disabled:opacity-50">עדכן את כולם מהכרטיס</button>
        </div>
      )}
      {planMissing.length > 0 && (
        <p role="alert" className="text-sm rounded-lg bg-red-50 text-red-700 px-3 py-2">
          ל-{planMissing.length} בתי ספר בסבב חסר מספר פגישות (אין להם תוכנית בכרטיס) — הם לא נספרים ולא יקבלו בקשה. אפשר להגדיר להם תוכנית בכרטיס ואז "עדכן מהכרטיס", או למלא מספר ב"עריכת הסבב" ← "מי צריך כמה".
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Kpi label="בתי ספר בסבב" value={totals.schools} sub={excludedNames ? `${excludedNames} הוחרגו` : null} />
        <Kpi label="פגישות נקבעו" value={`${totals.booked}/${totals.required}`} sub={`${pct}%`} tone="text-emerald-700" />
        <Kpi label="התקיימו" value={totals.done_meetings} />
        <Kpi label="ממתינים לקביעה" value={(counts.requested || 0) + (counts.opened || 0)} tone="text-sky-700" />
        <Kpi label="טרם טופלו" value={counts.untouched || 0} tone={counts.untouched ? "text-slate-800" : "text-emerald-700"} />
        <Kpi label="בעיות" value={counts.problem || 0} tone={counts.problem ? "text-red-600" : "text-slate-800"} />
      </div>

      {byKind.length > 0 && (
        <section aria-labelledby="round-kinds-title" className="flex flex-col gap-2">
          <h3 id="round-kinds-title" className="font-bold text-slate-800 text-sm">אילו פגישות צריך לקבוע</h3>
          <ul className="flex flex-wrap gap-2">
            {byKind.map(k => (
              <li key={k.kind} className={`border rounded-xl px-3 py-2 text-sm ${k.kind === "missing" ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white"}`}>
                <b>{k.schools}</b> בתי ספר {k.kind === "missing" ? "" : "עם "}{meetingKindLabel(k.kind, rnd.requirement)}
                {k.kind !== "missing" && (
                  <span className="block text-xs text-slate-500">נקבעו {k.booked} מתוך {k.required} פגישות</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-100" role="img"
          aria-label={ROUND_STATUS_ORDER.map(st => `${ROUND_STATUS_META[st].label}: ${counts[st] || 0}`).join(", ")}>
          {ROUND_STATUS_ORDER.map(st => counts[st] ? (
            <div key={st} className={ROUND_STATUS_META[st].bar} style={{ width: `${(counts[st] / Math.max(totals.schools, 1)) * 100}%` }} />
          ) : null)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {ROUND_STATUS_ORDER.map(st => (
            <button key={st} type="button" onClick={() => setStatusFilter(statusFilter === st ? "" : st)}
              className={`flex items-center gap-1.5 ${statusFilter === st ? "font-bold" : ""}`}>
              <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${ROUND_STATUS_META[st].bar}`} />
              {ROUND_STATUS_META[st].label}: {counts[st] || 0}
            </button>
          ))}
        </div>
      </div>

      {(untouched.length > 0 || partial.length > 0 || stale.length > 0 || problems.length > 0 || noRequest.length > 0) && (
        <section aria-labelledby="round-actions-title" className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 flex flex-col gap-2 text-sm">
          <h3 id="round-actions-title" className="font-bold text-slate-800">מה עושים עכשיו</h3>
          {noRequest.length > 0 && (
            <div className="flex flex-col gap-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-red-800"><b>{noRequest.length}</b> בתי ספר שעדיין חסרה להם פגישה — ולא נשלחה להם עליה בקשה.</span>
                <span className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => showInTable("no_request")} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300">הצג</button>
                  {remoteNoRequest.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => startTask(remoteNoRequest, { requireAdditional: askAdditional })} className={ACTION_BTN}>
                      צור משימה עבורם ({remoteNoRequest.length})
                    </button>
                  )}
                  {physicalNoRequest.length > 0 && (
                    <button type="button" disabled={busy || physicalNoRequestReady.loading || !!physicalNoRequestReady.missing}
                      aria-describedby={physicalNoRequestReady.missing ? "round-norequest-physical-missing" : undefined}
                      onClick={() => startTask(physicalNoRequest, { physical: true, requireAdditional: askAdditional })} className={ACTION_BTN}>
                      {physicalNoRequestReady.loading ? "בודק ימי שטח…" : `צור משימה פיזית (${physicalNoRequest.length})`}
                    </button>
                  )}
                </span>
              </div>
              {physicalNoRequestReady.missing && (
                <FieldDaysMissingNote id="round-norequest-physical-missing" names={physicalNoRequestReady.missing} onGo={() => goToFieldDays(physicalNoRequestReady.missingIds)} />
              )}
            </div>
          )}
          {remoteUntouched.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span><b>{remoteUntouched.length}</b> בתי ספר עוד לא קיבלו שום בקשה.</span>
              <button type="button" disabled={busy} onClick={() => startTask(remoteUntouched)} className={ACTION_BTN}>צור משימה עבורם</button>
            </div>
          )}
          {physicalUntouched.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span><b>{physicalUntouched.length}</b> בתי ספר עם פגישה פיזית עוד לא קיבלו בקשה.</span>
                <button type="button" disabled={busy || physicalReady.loading || !!physicalReady.missing}
                  aria-describedby={physicalReady.missing ? "round-physical-missing" : undefined}
                  onClick={() => startTask(physicalUntouched, { physical: true })} className={ACTION_BTN}>
                  {physicalReady.loading ? "בודק ימי שטח…" : "צור משימה פיזית עבורם"}
                </button>
              </div>
              {physicalReady.missing && (
                <FieldDaysMissingNote id="round-physical-missing" names={physicalReady.missing} onGo={() => goToFieldDays(physicalReady.missingIds)} />
              )}
            </div>
          )}
          {partial.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span><b>{partial.length}</b> בתי ספר קבעו רק חלק מהפגישות הנדרשות.</span>
                <span className="flex gap-2 flex-wrap">
                  {remotePartial.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => startTask(remotePartial, { requireAdditional: askAdditional })} className={ACTION_BTN}>
                      צור משימה לפגישות שחסרות{physicalPartial.length > 0 ? ` (${remotePartial.length})` : ""}
                    </button>
                  )}
                  {physicalPartial.length > 0 && (
                    <button type="button" disabled={busy || physicalPartialReady.loading || !!physicalPartialReady.missing}
                      aria-describedby={physicalPartialReady.missing ? "round-partial-physical-missing" : undefined}
                      onClick={() => startTask(physicalPartial, { physical: true, requireAdditional: askAdditional })} className={ACTION_BTN}>
                      {physicalPartialReady.loading ? "בודק ימי שטח…" : `צור משימה פיזית לפגישות שחסרות (${physicalPartial.length})`}
                    </button>
                  )}
                </span>
              </div>
              {physicalPartialReady.missing && (
                <FieldDaysMissingNote id="round-partial-physical-missing" names={physicalPartialReady.missing} onGo={() => goToFieldDays(physicalPartialReady.missingIds)} />
              )}
            </div>
          )}
          {stale.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span><b>{stale.length}</b> בתי ספר קיבלו בקשה לפני {STALE_REQUEST_DAYS} ימים ויותר ועדיין לא קבעו.</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => showInTable("stale")} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300">הצג</button>
                <button type="button" disabled={busy} onClick={() => sendReminders(stale)} className={ACTION_BTN}>שלח להם תזכורת</button>
              </span>
            </div>
          )}
          {problems.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span><b>{problems.length}</b> בתי ספר עם בעיה (חסר איש קשר, סוג שירות, או שליחה שנכשלה).</span>
              <button type="button" onClick={() => showInTable("problem")} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300">הצג</button>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="round-advisors-title">
        <h3 id="round-advisors-title" className="font-bold text-slate-800 text-sm mb-2">לפי יועץ</h3>
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="text-right px-3 py-2">יועץ</th>
                <th scope="col" className="text-right px-3 py-2">בתי ספר</th>
                <th scope="col" className="text-right px-3 py-2">נקבעו / נדרשו</th>
                <th scope="col" className="text-right px-3 py-2">נותרו</th>
                <th scope="col" className="text-right px-3 py-2">טרם טופלו</th>
                <th scope="col" className="text-right px-3 py-2 w-40">התקדמות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byAdvisor.map(a => (
                <Fragment key={a.id}>
                <tr>
                  <td className="px-3 py-2">{a.id === "__none__" ? (
                    <button type="button" onClick={() => setShowNoAdvisor(v => !v)} aria-expanded={showNoAdvisor}
                      aria-controls="round-no-advisor-details" className="text-red-600 underline decoration-dotted text-right">
                      ללא יועץ בכרטיס <span aria-hidden="true">{showNoAdvisor ? "▲" : "▼"}</span>
                    </button>
                  ) : names[a.id] || "—"}</td>
                  <td className="px-3 py-2">{a.schools}</td>
                  <td className="px-3 py-2">{a.booked}/{a.required}</td>
                  <td className="px-3 py-2 font-semibold">{a.required - a.booked}</td>
                  <td className="px-3 py-2">{a.untouched}</td>
                  <td className="px-3 py-2">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${a.required ? (a.booked / a.required) * 100 : 0}%` }} />
                    </div>
                  </td>
                </tr>
                {a.id === "__none__" && showNoAdvisor && (
                  <tr id="round-no-advisor-details">
                    <td colSpan={6} className="px-3 py-3 bg-red-50/50">
                      <ul className="flex flex-col gap-2 text-xs text-slate-700">
                        {a.items.map(({ school: s, types }) => (
                          <li key={s.school_id}>
                            <a href={`/school/${s.school_id}`} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 hover:underline">{s.school_name}</a>
                            {" — "}
                            {types.length
                              ? <>בכרטיס בית הספר אין {[...new Set(types.flatMap(t => NO_ADVISOR_LISTS[t] || []))].map(l => `יועץ מלווה [${l}]`).join(" ו")} לשנה זו.
                                  {" "}מה עושים: פותחים את כרטיס בית הספר ← "פרטי בית הספר" ← "ליווי", ומוסיפים יועץ.</>
                              : <>בכרטיס בית הספר אין סוג שירות לשנה זו, ולכן לא ידוע איזו פגישה הוא צריך ועם מי. מה עושים: פותחים את כרטיס בית הספר ← "פרטי בית הספר" ← "ליווי", ובוחרים סוג שירות ויועץ מלווה.</>}
                            {s.request && (
                              <span className="block text-slate-500 mt-0.5">
                                לבית הספר כבר נשלחה בקשה לפגישה — מי שיופיע בה הוא היועץ שהיה בכרטיס בזמן השליחה. אם היועץ הוחלף, יש לבדוק מול בית הספר.
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(rnd.physical_school_ids || []).length > 0 && (
        <RoundFieldDays roundId={roundId} exemptIds={rnd.field_exempt_advisor_ids || []} onExemptChange={load} refreshKey={rnd.updated_at}
          onData={setFieldDays} onError={() => setFieldDays(prev => prev || { failed: true })} />
      )}

      <section aria-labelledby="round-schools-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 id="round-schools-title" className="font-bold text-slate-800 text-sm">בתי הספר ({shown.length})</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <label htmlFor="round-search" className="sr-only">חיפוש בית ספר</label>
            <input id="round-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש..." className="text-sm border border-slate-300 rounded-lg px-3 py-1.5" />
            <label htmlFor="round-status-filter" className="sr-only">סינון לפי מצב</label>
            <select id="round-status-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
              <option value="">כל המצבים</option>
              {ROUND_STATUS_ORDER.map(st => <option key={st} value={st}>{ROUND_STATUS_META[st].label}</option>)}
              <option value="stale">ממתינים {STALE_REQUEST_DAYS}+ ימים</option>
              <option value="no_request">חסרה פגישה ולא נשלחה בקשה</option>
            </select>
            {(rnd.physical_school_ids || []).length > 0 && (
              <>
                <label htmlFor="round-physical-filter" className="sr-only">סינון לפי מיקום</label>
                <select id="round-physical-filter" value={physicalFilter} onChange={e => setPhysicalFilter(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
                  <option value="">פיזי ומרחוק</option>
                  <option value="physical">פיזי בלבד</option>
                  <option value="remote">מרחוק בלבד</option>
                </select>
              </>
            )}
          </div>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-col gap-1 bg-blue-50 rounded-lg px-3 py-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span>{selected.size} נבחרו</span>
              <button type="button" disabled={busy || selectedReady.loading || !!selectedReady.missing}
                aria-describedby={selectedReady.missing ? "round-selected-missing" : selectedMixed ? "round-selected-mixed" : undefined}
                onClick={() => startTask(selectedRows, { physical: selectedAllPhysical })} className={ACTION_BTN}>
                {selectedReady.loading ? "בודק ימי שטח…" : "צור משימה לנבחרים"}
              </button>
              <button type="button" disabled={busy} onClick={excludeSelected} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed">החרג מהסבב</button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">ניקוי בחירה</button>
            </div>
            {selectedReady.missing && (
              <FieldDaysMissingNote id="round-selected-missing" names={selectedReady.missing} onGo={() => goToFieldDays(selectedReady.missingIds)} />
            )}
            {selectedMixed && (
              <p id="round-selected-mixed" className="text-xs text-slate-600">
                בבחירה יש בתי ספר שחסרה להם פגישה פיזית ובתי ספר שחסרה להם רק פגישה מרחוק — המשימה תהיה מרחוק, ובתי הספר שצריכים פגישה פיזית יסומנו בחלון המשימה וידולגו כברירת מחדל.
                ליצירת משימה פיזית בחרו רק בתי ספר פיזיים (סינון "פיזי בלבד").
              </p>
            )}
          </div>
        )}
        <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th scope="col" className="px-3 py-2 w-8">
                  <input type="checkbox" aria-label="בחירת כל המוצגים" checked={allShownSelected} className="accent-blue-600"
                    onChange={() => setSelected(prev => {
                      const next = new Set(prev);
                      for (const s of shown) allShownSelected ? next.delete(s.school_id) : next.add(s.school_id);
                      return next;
                    })} />
                </th>
                <th scope="col" className="text-right px-3 py-2">בית ספר</th>
                <th scope="col" className="text-right px-3 py-2">מצב</th>
                <th scope="col" className="text-right px-3 py-2">פגישה נדרשת</th>
                <th scope="col" className="text-right px-3 py-2">פגישות</th>
                <th scope="col" className="text-right px-3 py-2">יועץ</th>
                <th scope="col" className="text-right px-3 py-2">בקשה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map(s => (
                <tr key={s.school_id} className={selected.has(s.school_id) ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`בחירת ${s.school_name}`} checked={selected.has(s.school_id)} className="accent-blue-600"
                      onChange={() => setSelected(prev => { const n = new Set(prev); n.has(s.school_id) ? n.delete(s.school_id) : n.add(s.school_id); return n; })} />
                  </td>
                  <td className="px-3 py-2">
                    <a href={`/school/${s.school_id}`} target="_blank" rel="noreferrer" className="text-slate-800 hover:underline">{s.school_name}</a>
                    {s.physical && <span className="mr-1.5 text-[10px] bg-violet-50 text-violet-700 rounded-full px-1.5 py-0.5">פיזי</span>}
                    <span className="block text-[11px] text-slate-400">{[s.authority, s.city].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs rounded-full px-2 py-0.5 ${ROUND_STATUS_META[s.status].chip}`}>{ROUND_STATUS_META[s.status].label}</span>
                    {s.problem && <span className="block text-[11px] text-red-600 mt-0.5">{ROUND_PROBLEM_LABELS[s.problem] || s.problem}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.required_types.map(t => MEETING_SERVICE_TYPE_LABELS[t]).join(" · ") || "—"}
                    {(s.required_count > 1 || s.plan) && <span className="text-slate-500"> ({s.booked_count}/{s.required_count})</span>}
                    {s.plan && Object.entries(s.plan.parts).map(([part, p]) => (
                      <span key={part} className="block text-[11px] text-slate-500">
                        {PLAN_PART_LABELS[part]}: {p.missing ? <span className="text-red-600">חסר מספר</span> : <>
                          {p.required} בסבב
                          {p.carried > 0 && (p.offer
                            ? <span className="text-amber-700"> · כולל {p.carried} שלא התקיימו</span>
                            : <span className="text-slate-500"> · {p.carried} שלא התקיימו נדחו לסבב הבא</span>)}
                        </>}
                        {p.changed && (
                          <button type="button" disabled={busy} onClick={() => refreshPlan([s.school_id])}
                            className="mr-1 text-blue-700 hover:underline disabled:opacity-50">הכרטיס השתנה — עדכן</button>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.meetings.length ? s.meetings.map(m => (
                      <span key={m.id} className="block whitespace-nowrap">
                        <bdi>{formatDateDMY(m.date)}</bdi> · {MEETING_SERVICE_TYPE_LABELS[m.service_type] || ""}{m.status === "completed" ? " ✓" : ""}
                        <span className="text-slate-400"> ({m.via_link ? "לינק" : "צוות"})</span>
                      </span>
                    )) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.advisor_ids.map(id => names[id]).filter(Boolean).join(", ") || <span className="text-red-600">אין</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.request ? (
                      <>
                        <button type="button" className="text-blue-700 hover:underline" onClick={() => openTask(s.request.task_id)}>{taskNames[s.request.task_id] || "משימה"}</button>
                        {s.request.sent_at && <span className="block text-slate-500">נשלחה לפני {daysSince(s.request.sent_at)} ימים</span>}
                      </>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">אין בתי ספר להצגה</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {excludedNames > 0 && (
          <p className="text-xs text-slate-500">
            {excludedNames} בתי ספר הוחרגו מהסבב.{" "}
            <button type="button" className="text-blue-600 hover:underline" disabled={busy} onClick={() => patchRound({ excluded_school_ids: [] })}>החזר את כולם לסבב</button>
          </p>
        )}
      </section>

      <section aria-labelledby="round-tasks-title">
        <h3 id="round-tasks-title" className="font-bold text-slate-800 text-sm mb-2">המשימות בסבב ({data.tasks.length})</h3>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-slate-500">עוד לא נוצרו משימות. התחילו ב"+ משימה חדשה בסבב".</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.tasks.map(t => (
              <li key={t.id}>
                <button type="button" onClick={() => openTask(t.id)} className="w-full text-right flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-sm">
                  <span>{t.name}</span>
                  <span className="text-xs text-slate-500">
                    {t.cached_total_schools ?? "—"} בתי ספר · {t.cached_actions_completed ?? 0}/{t.cached_actions_needed ?? 0} פגישות · {formatDateDMY((t.created_at || "").slice(0, 10))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {audienceDiff && (
        <ConfirmDialog title="עדכון רשימת בתי הספר" onClose={() => setAudienceDiff(null)} actions={
          <button type="button" disabled={busy || (!audienceDiff.added.length && !audienceDiff.removed.length)} onClick={applyAudience} className="px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-40">עדכן</button>
        }>
          {!audienceDiff.added.length && !audienceDiff.removed.length ? <p>הרשימה מעודכנת — אין שינוי מאז יצירת הסבב.</p> : (
            <>
              {audienceDiff.added.length > 0 && <p><b>{audienceDiff.added.length}</b> בתי ספר עונים היום לסינון ולא בסבב: {audienceDiff.added.slice(0, 10).map(s => s.school_name).join(", ")}{audienceDiff.added.length > 10 ? "…" : ""}</p>}
              {audienceDiff.removed.length > 0 && <p><b>{audienceDiff.removed.length}</b> בתי ספר בסבב כבר לא עונים לסינון: {audienceDiff.removed.slice(0, 10).map(s => s.school_name).join(", ")}{audienceDiff.removed.length > 10 ? "…" : ""}</p>}
            </>
          )}
        </ConfirmDialog>
      )}

      {confirmDelete && (
        <ConfirmDialog title="מחיקת הסבב" onClose={() => setConfirmDelete(false)} actions={
          <button type="button" onClick={deleteRound} className="px-4 py-2 rounded-xl bg-red-600 text-white">מחק</button>
        }>
          <p>הסבב יימחק. המשימות שבתוכו יישארו כמשימות רגילות, וכל הפגישות נשארות כמו שהן.</p>
        </ConfirmDialog>
      )}

      {editing && (
        <RoundCreateModal
          round={rnd}
          onClose={() => setEditing(false)}
          onCreated={() => { setEditing(false); load(); onChanged?.(); }}
        />
      )}

      {taskDraft && (
        <TaskCreateWizard
          key={taskDraft.key}
          isMeetingTask
          initialAcademicYear={rnd.academic_year}
          roundContext={{ round: rnd, ...taskDraft }}
          onClose={() => setTaskDraft(null)}
          onCreated={() => { setTaskDraft(null); load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
