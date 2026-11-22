import { useMemo, useState } from "react";
import { formatDateDMY } from "../tasks/taskShared";
import { MONTH_SHORT } from "../../constants/meetingPlan";
import { PLAN_PART_LABELS } from "./roundsShared";

// "מי צריך כמה" — the step of a round "לפי תוכנית" (RoundCreateModal). One line per school and
// part (גפן / שוטף / מחוז / תקומה) from POST /rounds/plan-preview: what the card's plan puts
// before the round and inside it, what the school already had before it, what's missing from
// before (⚠ — offered now or deferred to the next round, never dropped), and the total the
// round will ask. Every number inside the round can be changed; a part with no plan on the card
// must be filled in by hand before the round can be saved (backend/meeting_plan.py).
// answers = {school_id: {part: {planned_in, offer}}} — only what the manager changed.

export function partAnswer(row, part, answers) {
  const p = row.parts[part];
  const a = answers[row.school_id]?.[part] || {};
  const plannedIn = a.planned_in !== undefined ? a.planned_in : p.planned_in;
  const offer = a.offer !== undefined ? a.offer : p.offer;
  return { plannedIn, offer };
}

export function partTotal(row, part, answers) {
  const p = row.parts[part];
  const { plannedIn, offer } = partAnswer(row, part, answers);
  if (plannedIn === null || plannedIn === undefined || plannedIn === "") return null;
  return Math.max(0, Number(plannedIn) - p.ahead) + (offer ? p.carried : 0);
}

// Parts still without a number (no plan on the card and nothing typed in) — they block saving.
export function missingParts(row, answers) {
  return Object.keys(row.parts).filter(part => {
    const { plannedIn } = partAnswer(row, part, answers);
    return plannedIn === null || plannedIn === undefined || plannedIn === "";
  });
}

// What the server gets: every part's number and offer/defer answer.
export function planPayload(rows, answers, excludedIds) {
  const out = {};
  for (const row of rows) {
    if (excludedIds.has(row.school_id)) continue;
    const parts = {};
    for (const part of Object.keys(row.parts)) {
      const { plannedIn, offer } = partAnswer(row, part, answers);
      if (plannedIn === null || plannedIn === undefined || plannedIn === "") continue;
      parts[part] = { planned_in: Number(plannedIn), offer };
    }
    if (Object.keys(parts).length) out[row.school_id] = parts;
  }
  return out;
}

export default function RoundPlanStep({ rows, loading, error, answers, setAnswers, excludedIds, setExcludedIds, overlaps, attempted }) {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [query, setQuery] = useState("");

  const overlapIds = useMemo(() => new Set((overlaps || []).flatMap(o => o.shared_school_ids)), [overlaps]);
  const active = rows.filter(r => !excludedIds.has(r.school_id));
  const missingRows = active.filter(r => missingParts(r, answers).length);
  const carriedRows = active.filter(r => Object.values(r.parts).some(p => p.carried > 0));
  const totalMeetings = active.reduce((sum, r) => sum + Object.keys(r.parts).reduce((s, part) => s + (partTotal(r, part, answers) || 0), 0), 0);

  function setPart(sid, part, patch) {
    setAnswers(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), [part]: { ...(prev[sid]?.[part] || {}), ...patch } } }));
  }
  function setOfferAll(offer) {
    setAnswers(prev => {
      const next = { ...prev };
      for (const r of carriedRows) {
        for (const [part, p] of Object.entries(r.parts)) {
          if (p.carried > 0) next[r.school_id] = { ...(next[r.school_id] || {}), [part]: { ...(next[r.school_id]?.[part] || {}), offer } };
        }
      }
      return next;
    });
  }
  function toggleExcluded(ids, exclude) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) exclude ? next.add(id) : next.delete(id);
      return next;
    });
  }

  const needsAttention = r => missingParts(r, answers).length > 0 || Object.values(r.parts).some(p => p.carried > 0 || p.physical_months?.length)
    || overlapIds.has(r.school_id);
  const q = query.trim();
  const shown = rows
    .filter(r => !onlyAttention || needsAttention(r))
    .filter(r => !q || `${r.school_name} ${r.symbol || ""} ${r.city || ""} ${r.authority || ""}`.includes(q));

  if (loading) return <div role="status" aria-label="טוען את תוכניות הפגישות" className="text-sm text-slate-500 py-6 text-center">טוען את תוכניות הפגישות של בתי הספר...</div>;
  if (error) return <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-600">
        לכל בית ספר: כמה פגישות מגיעות לו בסבב לפי תוכנית הפגישות בכרטיס שלו. פגישה שלא התקיימה לפני הסבב מסומנת ⚠ — אפשר להציע אותה עכשיו או לדחות לסבב הבא (היא לא נמחקת). כל מספר בעמודה "בתוך הסבב" ניתן לשינוי.
      </p>

      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
        <span><b className="text-blue-700">{active.length}</b> בתי ספר · <b className="text-blue-700">{totalMeetings}</b> פגישות בסבב</span>
        {carriedRows.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="text-amber-800">⚠ {carriedRows.length} עם פגישות שלא התקיימו</span>
            <button type="button" onClick={() => setOfferAll(true)} className="text-xs px-2 py-0.5 rounded-md border border-amber-300 bg-white hover:bg-amber-50">להציע לכולם</button>
            <button type="button" onClick={() => setOfferAll(false)} className="text-xs px-2 py-0.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50">לדחות לכולם</button>
          </span>
        )}
      </div>

      {missingRows.length > 0 && (
        <p role={attempted ? "alert" : undefined} className={`text-sm rounded-lg px-3 py-2 ${attempted ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"}`}>
          ל-{missingRows.length} בתי ספר אין תוכנית פגישות בכרטיס — יש למלא להם כמה פגישות בסבב (מסומנים באדום). אפשר גם להגדיר תוכנית בכרטיס ולחזור לשלב הזה.
        </p>
      )}

      {(overlaps || []).map(o => {
        const ids = o.shared_school_ids;
        const allOut = ids.every(id => excludedIds.has(id));
        return (
          <div key={o.round_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>
              ⚠ הסבב "{o.name}" (<bdi>{formatDateDMY(o.start_date)}</bdi>–<bdi>{formatDateDMY(o.end_date)}</bdi>) כבר כולל {ids.length} מבתי הספר האלה — אותה פגישה עלולה להיספר בשני הסבבים.
            </span>
            <button type="button" onClick={() => toggleExcluded(ids, !allOut)}
              className="text-xs px-2.5 py-1 rounded-md border border-amber-400 bg-white hover:bg-amber-100">
              {allOut ? "להחזיר אותם לסבב הזה" : "להוציא אותם מהסבב הזה"}
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <label htmlFor="round-plan-search" className="sr-only">חיפוש בית ספר</label>
        <input id="round-plan-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש לפי שם, סמל, עיר או בעלות..."
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5" />
        <label className="flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={onlyAttention} onChange={e => setOnlyAttention(e.target.checked)} className="accent-blue-600" />
          רק מי שדורש תשומת לב
        </label>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[45vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
            <tr>
              <th scope="col" className="text-right px-2 py-2">בית ספר</th>
              <th scope="col" className="text-right px-2 py-2">שירות</th>
              <th scope="col" className="text-right px-2 py-2">הקצאה</th>
              <th scope="col" className="text-right px-2 py-2" title="פגישות שבוצעו או נקבעו השנה לפני הסבב, מתוך מה שהתוכנית קבעה עד אז">לפני הסבב</th>
              <th scope="col" className="text-right px-2 py-2">בתוך הסבב</th>
              <th scope="col" className="text-right px-2 py-2">לא התקיימו</th>
              <th scope="col" className="text-right px-2 py-2">סה"כ בסבב</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.slice(0, 300).map(r => {
              const parts = Object.keys(r.parts);
              const out = excludedIds.has(r.school_id);
              if (!parts.length) {
                return (
                  <tr key={r.school_id} className={out ? "opacity-40" : ""}>
                    <th scope="row" className="text-right font-normal px-2 py-1.5">{r.school_name}</th>
                    <td colSpan={6} className="px-2 py-1.5 text-slate-500">אין פגישה לבקש (לא הוגדר סוג שירות בכרטיס, או שהיועץ קובע בעצמו)</td>
                  </tr>
                );
              }
              return parts.map((part, i) => {
                const p = r.parts[part];
                const { plannedIn, offer } = partAnswer(r, part, answers);
                const missing = plannedIn === null || plannedIn === undefined || plannedIn === "";
                const total = partTotal(r, part, answers);
                const changedFromCard = p.has_card_plan && plannedIn !== null && plannedIn !== "" && Number(plannedIn) !== p.card_planned_in;
                return (
                  <tr key={`${r.school_id}-${part}`} className={out ? "opacity-40" : missing && attempted ? "bg-red-50/60" : ""}>
                    {i === 0 && (
                      <th scope="row" rowSpan={parts.length} className="text-right font-normal align-top px-2 py-1.5">
                        <span className="text-slate-800">{r.school_name}</span>
                        {overlapIds.has(r.school_id) && <span className="mr-1 text-[10px] text-amber-700">(גם בסבב אחר)</span>}
                        <span className="block text-[10px] text-slate-400">{[r.authority, r.city].filter(Boolean).join(" · ")}</span>
                        {out && <span className="block text-[10px] text-slate-500">הוצא מהסבב</span>}
                      </th>
                    )}
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {PLAN_PART_LABELS[part] || part}
                      {p.physical_months?.length > 0 && (
                        <span className="mr-1" title={`פגישה פיזית בתוכנית: ${p.physical_months.map(m => MONTH_SHORT[m]).join(", ")}`}>
                          <span aria-hidden="true">🏫</span><span className="sr-only">פגישה פיזית בתוכנית</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{p.allocation ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">
                      {p.has_card_plan ? `${p.held_before} מתוך ${p.planned_before}` : `${p.held_before} התקיימו`}
                      {p.ahead > 0 && <span className="block text-[10px] text-emerald-700">{p.ahead} מעבר לתוכנית — מקטינות את הסבב</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <label htmlFor={`plan-in-${r.school_id}-${part}`} className="sr-only">{`${r.school_name} — ${PLAN_PART_LABELS[part]}: פגישות בתוך הסבב`}</label>
                      <input id={`plan-in-${r.school_id}-${part}`} type="number" min="0" max="30" inputMode="numeric" disabled={out}
                        value={plannedIn ?? ""} placeholder={p.has_card_plan ? "" : "מספר"}
                        onChange={e => setPart(r.school_id, part, { planned_in: e.target.value === "" ? "" : Math.max(0, Math.min(30, Math.round(Number(e.target.value) || 0))) })}
                        className={`w-14 text-center border rounded-md py-0.5 ${missing ? "border-red-400" : changedFromCard ? "border-blue-400 bg-blue-50" : "border-slate-300"}`} />
                      {!p.has_card_plan && <span className="block text-[10px] text-red-600">אין תוכנית בכרטיס</span>}
                      {changedFromCard && <span className="block text-[10px] text-blue-700">בכרטיס: {p.card_planned_in}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {p.carried > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-amber-800">⚠ {p.carried}</span>
                          <div className="flex gap-1" role="group" aria-label={`${r.school_name} — ${PLAN_PART_LABELS[part]}: פגישות שלא התקיימו`}>
                            <button type="button" aria-pressed={offer} disabled={out} onClick={() => setPart(r.school_id, part, { offer: true })}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${offer ? "bg-amber-500 border-amber-500 text-white" : "border-slate-300"}`}>להציע</button>
                            <button type="button" aria-pressed={!offer} disabled={out} onClick={() => setPart(r.school_id, part, { offer: false })}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${!offer ? "bg-slate-600 border-slate-600 text-white" : "border-slate-300"}`}>לדחות</button>
                          </div>
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{out ? "—" : total ?? "?"}</td>
                  </tr>
                );
              });
            })}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">אין בתי ספר להצגה</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <p className="text-[11px] text-slate-500">מוצגים 300 מתוך {shown.length} — צמצמו בחיפוש. כל בתי הספר נכללים בסבב.</p>}
    </div>
  );
}
