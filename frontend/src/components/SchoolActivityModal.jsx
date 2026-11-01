import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { History, X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { AUTHOR_COLORS, formatUpdateDate } from "./SchoolNotesModal";
import { fieldLabel, formatFieldValue } from "./schoolFieldLabels";

// "תיעוד פעולות" — who changed which field of the school card's "פרטי בית הספר" tab, from what to
// what, when and from which screen (GET /schools/{id}/activity). Direct changes and update
// requests share one timeline; a request card shows each requested field with its own
// approved/rejected/pending decision and who made it.

const SOURCE_LABELS = {
  school_card: "כרטיס בית ספר",
  add_school: "הוספת בית ספר",
  admin_modal: "ניהול — עריכת בית ספר",
  admin_grid: "ניהול — עריכה בטבלה",
  admin_bulk: "ניהול — עריכה מרובה",
  admin_undo: "ניהול — ביטול עריכה מרובה",
  import: "ייבוא מאקסל",
  dashboard: "לוח בתי הספר",
  task_resolution: "משימות",
  tasks_contacts_import: "משימות — ייבוא אנשי קשר",
  calls: "מסך השיחות",
  collection: "ניהול — גבייה",
  update_request: "בקשת עדכון",
};

const INSTITUTION_FIELDS = new Set([
  "name", "symbol", "city", "authority", "stage", "district", "address", "school_phone",
  "finance_software", "finance_software_other_text", "education_authority", "sector", "supervision",
  "grade_levels", "study_days", "student_count",
]);
const ESCORT_FIELDS = new Set(["client_status", "service_type", "order_amount_gefen", "order_method", "order_method_other_text"]);

function categoryOf(field) {
  if (INSTITUTION_FIELDS.has(field)) return "institution";
  if (ESCORT_FIELDS.has(field)) return "escort";
  if (field === "restrict_access_to") return "access";
  if (field.startsWith("advisors_") || field.startsWith("meeting_allocation_") || field.startsWith("meeting_duration_")) return "advisors";
  if (/^(principal|secretary|finance_contact|finance)_/.test(field) || ["extra_contacts", "meeting_coordinators", "meeting_coordinator", "gefen_files_responsible"].includes(field)) return "contacts";
  return "other";
}

const CATEGORIES = [
  { key: "all", label: "הכל" },
  { key: "institution", label: "פרטי מוסד" },
  { key: "contacts", label: "אנשי קשר" },
  { key: "escort", label: "פרטי ליווי" },
  { key: "advisors", label: "יועצים מלווים" },
  { key: "access", label: "הרשאות גישה" },
];

function personName(profiles, id) {
  const p = profiles[id];
  return p?.full_name || p?.email || "משתמש לא ידוע";
}

function actorLabel(ev, profiles) {
  if (ev.actor_id) return personName(profiles, ev.actor_id);
  return ev.actor_type === "system" ? "המערכת" : "לא ידוע";
}

// Normalized rows of an event: [{field, from, to, fromKnown, decision?}].
function rowsOf(ev) {
  if (ev.kind === "request") {
    return (ev.rows || []).map(r => ({ field: r.field, from: r.from, to: r.to, fromKnown: r.from_known, decision: r.decision }));
  }
  return Object.entries(ev.changes || {}).map(([field, ch]) => ({ field, from: ch.from, to: ch.to, fromKnown: true }));
}

function requestStatusPill(ev) {
  if (ev.is_delete) {
    if (ev.status === "pending") return { text: "בקשת מחיקה — ממתינה לאישור", cls: "bg-amber-100 text-amber-800" };
    return ev.status === "approved"
      ? { text: "בקשת מחיקה — אושרה", cls: "bg-red-100 text-red-700" }
      : { text: "בקשת מחיקה — נדחתה", cls: "bg-slate-100 text-slate-600" };
  }
  if (ev.status === "pending") return { text: "ממתינה לאישור", cls: "bg-amber-100 text-amber-800" };
  const decisions = (ev.rows || []).map(r => r.decision);
  if (ev.status === "rejected" || decisions.every(d => d === "rejected")) return { text: "נדחתה", cls: "bg-red-100 text-red-700" };
  if (decisions.some(d => d === "rejected")) return { text: "אושרה חלקית", cls: "bg-amber-100 text-amber-800" };
  return { text: "אושרה", cls: "bg-green-100 text-green-700" };
}

function DecisionCell({ decision, reviewer, resolvedAt }) {
  if (decision === "pending") return <span className="text-amber-700 font-medium">⏳ ממתין לאישור</span>;
  const approved = decision === "approved";
  return (
    <span className={`font-medium ${approved ? "text-green-700" : "text-red-600"}`}>
      {approved ? "✓ אושר" : "✕ נדחה"}{reviewer ? ` ע"י ${reviewer}` : ""}
      {resolvedAt && <span className="block text-[11px] font-normal text-slate-400">{formatUpdateDate(resolvedAt)}</span>}
    </span>
  );
}

// Every card's table uses the same fixed column grid (field | before | after | decision), so the
// columns line up vertically across all cards regardless of content length; the decision column
// is simply left empty outside request cards.
const COL_WIDTHS = ["22%", "30%", "30%", "18%"];

function ChangesTable({ rows, profiles, onPickField, isRequest, reviewer, resolvedAt, initialValues }) {
  return (
    <table className="w-full text-xs border-collapse mt-2" style={{ tableLayout: "fixed" }}>
      <colgroup>
        {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
      </colgroup>
      <thead>
        <tr className="bg-slate-50 text-slate-500">
          <th scope="col" className="px-2 py-1.5 text-right font-semibold">שדה</th>
          <th scope="col" className="px-2 py-1.5 text-right font-semibold">{initialValues ? "" : "ערך קודם"}</th>
          <th scope="col" className="px-2 py-1.5 text-right font-semibold">{initialValues ? "ערך" : isRequest ? "ערך מבוקש" : "ערך חדש"}</th>
          <th scope="col" className="px-2 py-1.5 text-right font-semibold">{isRequest ? "החלטה" : ""}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const rejected = r.decision === "rejected";
          return (
            <tr key={r.field} className={`border-t border-slate-100 align-top ${rejected ? "bg-red-50/40" : ""}`}>
              <td className="px-2 py-1.5">
                <button type="button" onClick={() => onPickField(r.field)}
                  className="text-right text-slate-600 hover:text-blue-700 hover:underline"
                  title="הצג את כל ההיסטוריה של שדה זה">
                  {fieldLabel(r.field)}
                </button>
              </td>
              <td className="px-2 py-1.5 text-slate-400" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {initialValues ? null : r.fromKnown
                  ? <span className="line-through decoration-slate-300">{formatFieldValue(r.from, r.field, { profiles })}</span>
                  : <span className="italic">לא ידוע</span>}
              </td>
              <td className={`px-2 py-1.5 font-medium ${rejected ? "text-slate-400 line-through" : "text-emerald-800"}`}
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {formatFieldValue(r.to, r.field, { profiles })}
              </td>
              <td className="px-2 py-1.5">
                {isRequest && <DecisionCell decision={r.decision} reviewer={reviewer} resolvedAt={resolvedAt} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SchoolActivityModal({ schoolId, schoolName, academicYear, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [category, setCategory] = useState("all");
  const [actorFilter, setActorFilter] = useState("");
  const [yearFilter, setYearFilter] = useState(academicYear || "");
  const [fieldFilter, setFieldFilter] = useState(null);
  const [expandedCreated, setExpandedCreated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`/schools/${schoolId}/activity`)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setLoadError("טעינת תיעוד הפעולות נכשלה — נסה שוב"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId]);

  const events = data?.events || [];
  const profiles = data?.profiles || {};

  const years = useMemo(
    () => [...new Set(events.map(e => e.academic_year).filter(Boolean))].sort().reverse(),
    [events]
  );
  const actors = useMemo(() => {
    const ids = new Set();
    for (const e of events) {
      if (e.actor_id) ids.add(e.actor_id);
      if (e.reviewer_id) ids.add(e.reviewer_id);
    }
    return [...ids].map(id => ({ id, name: personName(profiles, id) })).sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [events, profiles]);

  // Stable pastel color per actor (by first appearance), only when 2+ actors appear.
  const colorMap = useMemo(() => {
    const distinct = [...new Set([...events].reverse().map(e => e.actor_id).filter(Boolean))];
    return distinct.length > 1 ? Object.fromEntries(distinct.map((id, i) => [id, AUTHOR_COLORS[i % AUTHOR_COLORS.length]])) : {};
  }, [events]);

  const yearActive = yearFilter && years.includes(yearFilter);
  const fieldFiltering = category !== "all" || !!fieldFilter;

  const visible = events.map(ev => {
    if (yearActive && ev.academic_year && ev.academic_year !== yearFilter) return null;
    if (actorFilter && ev.actor_id !== actorFilter && ev.reviewer_id !== actorFilter) return null;
    const rows = rowsOf(ev).filter(r =>
      (category === "all" || categoryOf(r.field) === category) && (!fieldFilter || r.field === fieldFilter));
    const isLifecycle = ["created", "deleted", "restored"].includes(ev.kind) || (ev.kind === "request" && ev.is_delete);
    if (rows.length === 0 && (fieldFiltering || !isLifecycle)) return null;
    return { ev, rows };
  }).filter(Boolean);

  const lastChange = events.find(e => e.kind !== "created");
  const created = events.find(e => e.kind === "created");

  function pickField(field) {
    setFieldFilter(field);
    setCategory("all");
  }

  function renderCard({ ev, rows }) {
    const color = colorMap[ev.actor_id];
    const actorBadge = (
      <span className="inline-block rounded px-1.5 py-0.5 font-semibold"
        style={color ? { background: color.bg, color: color.text } : { background: "#F1F5F9", color: "#334155" }}>
        {actorLabel(ev, profiles)}
      </span>
    );
    const source = SOURCE_LABELS[ev.source];
    const yearBadge = ev.academic_year && (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">שנה {ev.academic_year}</span>
    );

    if (ev.kind === "request") {
      const pill = requestStatusPill(ev);
      const reviewer = ev.reviewer_id ? personName(profiles, ev.reviewer_id) : null;
      return (
        <article key={ev.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            {actorBadge}
            <span>הגיש/ה בקשת עדכון</span>
            <span className="text-slate-400">· {formatUpdateDate(ev.submitted_at)}</span>
            <span className={`mr-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.text}</span>
          </header>
          {ev.is_delete ? (
            <p className="text-xs text-slate-700 mt-2">
              בקשה למחיקת בית הספר
              {ev.status !== "pending" && reviewer && <> — {ev.status === "approved" ? "אושרה" : "נדחתה"} ע"י {reviewer} · {formatUpdateDate(ev.resolved_at)}</>}
            </p>
          ) : (
            <ChangesTable rows={rows} profiles={profiles} onPickField={pickField} isRequest reviewer={reviewer} resolvedAt={ev.resolved_at} />
          )}
          {ev.reviewer_note && (
            <p className="text-xs text-slate-600 mt-2 bg-slate-50 rounded px-2 py-1">הערת המאשר/ת: {ev.reviewer_note}</p>
          )}
        </article>
      );
    }

    if (ev.kind === "created") {
      return (
        <article key={ev.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            {ev.legacy ? <span className="font-semibold text-slate-700">בית הספר נוצר</span> : <>{actorBadge}<span>יצר/ה את בית הספר</span></>}
            <span className="text-slate-400">· {formatUpdateDate(ev.created_at)}</span>
            {source && <span className="text-slate-500">· {source}</span>}
          </header>
          {ev.legacy && <p className="text-xs text-slate-400 mt-1">נוצר לפני תחילת התיעוד — היוצר והערכים ההתחלתיים לא נשמרו.</p>}
          {rows.length > 0 && (fieldFiltering || expandedCreated
            ? <ChangesTable rows={rows} profiles={profiles} onPickField={pickField} initialValues />
            : (
              <button type="button" onClick={() => setExpandedCreated(true)} className="text-xs text-blue-700 hover:underline mt-1">
                הצג ערכים התחלתיים ({rows.length})
              </button>
            ))}
        </article>
      );
    }

    if (ev.kind === "deleted" || ev.kind === "restored") {
      const deleted = ev.kind === "deleted";
      return (
        <article key={ev.id} className={`rounded-xl border p-3 text-xs ${deleted ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {actorBadge}
            <span className={`font-semibold ${deleted ? "text-red-700" : "text-green-700"}`}>
              {deleted ? (ev.source === "update_request" ? "העביר/ה את בית הספר לסל המחזור (באישור בקשת מחיקה)" : "העביר/ה את בית הספר לסל המחזור") : "שחזר/ה את בית הספר מסל המחזור"}
            </span>
            <span className="text-slate-400">· {formatUpdateDate(ev.created_at)}</span>
          </header>
        </article>
      );
    }

    return (
      <article key={ev.id} className="rounded-xl border border-slate-200 bg-white p-3">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          {actorBadge}
          <span className="text-slate-400">· {formatUpdateDate(ev.created_at)}</span>
          {source && <span className="text-slate-500">· {source}</span>}
          {ev.merged_count > 1 && <span className="text-slate-400">({ev.merged_count} שמירות רצופות)</span>}
          {yearBadge && <span className="mr-auto">{yearBadge}</span>}
        </header>
        <ChangesTable rows={rows} profiles={profiles} onPickField={pickField} />
      </article>
    );
  }

  const chipCls = (active) =>
    `text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-activity-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full flex flex-col gap-3"
        style={{ maxHeight: "88vh", maxWidth: "960px" }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="school-activity-title" className="font-bold text-slate-900 text-base">
            תיעוד פעולות — {schoolName || "פרטי בית הספר"}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגור חלונית" className="btn-ghost text-sm px-3 py-1.5">✕</button>
        </div>

        {!loading && !loadError && (lastChange || created) && (
          <div className="text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
            {lastChange && (
              <span>
                <span className="font-semibold">עודכן לאחרונה ע"י {actorLabel(lastChange, profiles)}</span>
                {" · "}{formatUpdateDate(lastChange.created_at)}
              </span>
            )}
            {created && !created.legacy && (
              <span><span className="font-semibold">נוצר ע"י {actorLabel(created, profiles)}</span>{" · "}{formatUpdateDate(created.created_at)}</span>
            )}
          </div>
        )}

        {!loading && !loadError && events.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="סינון לפי אזור" className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button key={c.key} type="button" aria-pressed={category === c.key && !fieldFilter}
                  onClick={() => { setCategory(c.key); setFieldFilter(null); }}
                  className={chipCls(category === c.key && !fieldFilter)}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mr-auto">
              {actors.length > 1 && (
                <>
                  <label htmlFor="school-activity-actor" className="sr-only">סינון לפי משתמש</label>
                  <select id="school-activity-actor" value={actorFilter} onChange={e => setActorFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                    <option value="">כל המשתמשים</option>
                    {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </>
              )}
              {years.length > 0 && (
                <>
                  <label htmlFor="school-activity-year" className="sr-only">שנת לימודים לשדות ליווי</label>
                  <select id="school-activity-year" value={yearActive ? yearFilter : ""} onChange={e => setYearFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white" title="שנת הלימודים של שדות פרטי הליווי">
                    <option value="">ליווי: כל השנים</option>
                    {years.map(y => <option key={y} value={y}>ליווי: {y}</option>)}
                  </select>
                </>
              )}
            </div>
            {fieldFilter && (
              <div className="w-full">
                <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-full px-2.5 py-1">
                  היסטוריית השדה: <strong>{fieldLabel(fieldFilter)}</strong>
                  <button type="button" onClick={() => setFieldFilter(null)} aria-label="הצג את כל השדות" className="hover:text-blue-950">
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              </div>
            )}
          </div>
        )}

        <div className="overflow-auto flex-1 flex flex-col gap-2 pl-1" style={{ minHeight: "120px" }}>
          {loading && <div role="status" aria-label="טוען תיעוד פעולות" className="text-xs text-slate-400 text-center py-6">טוען…</div>}
          {loadError && <div role="alert" className="text-xs text-red-600 text-center py-6">{loadError}</div>}
          {!loading && !loadError && visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
              <History aria-hidden="true" size={28} />
              <span className="text-sm">{events.length === 0 ? "אין עדיין פעולות מתועדות" : "אין פעולות שתואמות את הסינון"}</span>
            </div>
          )}
          {!loading && !loadError && visible.map(renderCard)}
        </div>
        <p className="text-xs text-slate-500">
          לחיצה על שם שדה מציגה את כל ההיסטוריה שלו. שינויים שבוצעו לפני הפעלת התיעוד אינם מוצגים, למעט בקשות עדכון.
        </p>
      </div>
    </div>,
    document.body
  );
}
