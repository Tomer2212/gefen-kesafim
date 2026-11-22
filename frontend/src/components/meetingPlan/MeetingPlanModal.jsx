import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  ACADEMIC_MONTHS, MAX_PER_MONTH, MONTH_SHORT, PLAN_TYPE_LABELS, RHYTHMS,
  allocationGap, normalizePlan, spreadPlan, typeTotal,
} from "../../constants/meetingPlan";

// "תוכנית פגישות" editor — per service type, how many meetings in each month of the academic
// year, with one-click rhythms and "לפי ההקצאה". Used by the school card, the admin edit modal,
// AddSchoolPage and the admin table's bulk edit.
// types = which service types to edit (e.g. ["gefen"] from one card column).
// allocations = {gefen: n, ...} for the "לפי ההקצאה" button and the gap warning.
// bulk = editing many schools at once: "לפי ההקצאה" then means each school's own allocation, so a
// row in that mode has no months of its own — onSave(plan, allocationTypes, touchedTypes) gets the
// list, plus which types were changed at all (a bulk edit applies only those).
// 🏫 under a chosen month = one of that month's meetings must be in person (plan.physical) — it only
// informs the rounds, which pre-mark in-person schools for the manager to confirm; nothing is booked.
export default function MeetingPlanModal({ types, plan, allocations = {}, title, academicYear, bulk = false, saving = false, error = "", onSave, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [draft, setDraft] = useState(() => {
    const out = {};
    for (const t of types) out[t] = { ...(plan?.[t] || {}) };
    return out;
  });
  const [physical, setPhysical] = useState(() => {
    const out = {};
    for (const t of types) out[t] = new Set(plan?.physical?.[t] || []);
    return out;
  });
  const [fromAllocation, setFromAllocation] = useState(() => new Set());
  const [touched, setTouched] = useState(() => new Set());

  function touch(type) { setTouched(s => new Set(s).add(type)); }
  function setMonths(type, months) {
    touch(type);
    setDraft(d => ({ ...d, [type]: months }));
    setFromAllocation(s => { const n = new Set(s); n.delete(type); return n; });
  }
  function setCell(type, month, n) {
    setMonths(type, { ...draft[type], [month]: Math.min(Math.max(0, n), MAX_PER_MONTH) });
    if (n <= 0) setPhysical(p => { const s = new Set(p[type]); s.delete(month); return { ...p, [type]: s }; });
  }
  function togglePhysical(type, month) {
    touch(type);
    setPhysical(p => {
      const s = new Set(p[type]);
      if (s.has(month)) s.delete(month); else s.add(month);
      return { ...p, [type]: s };
    });
  }

  function save() {
    // Types not edited here keep their months; edited ones are replaced.
    const merged = { ...(plan || {}), physical: { ...(plan?.physical || {}) } };
    for (const t of types) {
      merged[t] = fromAllocation.has(t) ? {} : draft[t];
      merged.physical[t] = fromAllocation.has(t) ? [] : [...physical[t]];
    }
    onSave(normalizePlan(merged), [...fromAllocation], [...new Set([...touched, ...fromAllocation])]);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="meeting-plan-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="meeting-plan-title" className="font-bold text-slate-800">{title || "תוכנית פגישות"}{academicYear ? ` — ${academicYear}` : ""}</h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-5 text-sm overflow-y-auto">
          <p className="text-slate-600">
            כמה פגישות בית הספר צריך בכל חודש. סבב פגישות סופר לפי התוכנית הזו: פגישה שלא התקיימה בחודש שלה לא הולכת לאיבוד, היא תופיע כחסרה בסבב הבא.
          </p>
          {bulk && (
            <p className="text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              עריכה של כמה בתי ספר יחד: רק סוג שירות ששינית כאן יוחלף בכל בתי הספר שנבחרו. סוגים שלא נגעת בהם יישארו כמו שהם.
            </p>
          )}
          {types.map(type => {
            const label = PLAN_TYPE_LABELS[type];
            const months = draft[type] || {};
            const allocation = allocations[type];
            const byAllocation = fromAllocation.has(type);
            const total = typeTotal({ [type]: months }, type);
            const gap = bulk ? null : allocationGap({ [type]: months }, type, allocation);
            return (
              <fieldset key={type} className="border border-slate-200 rounded-xl p-3">
                <legend className="px-1 font-semibold text-slate-700">{label}</legend>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {RHYTHMS.map(r => (
                    <button key={r.total} type="button" onClick={() => setMonths(type, spreadPlan(r.total))}
                      className="text-xs px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-50">{r.label}</button>
                  ))}
                  {bulk ? (
                    <button type="button" onClick={() => { touch(type); setFromAllocation(s => new Set(s).add(type)); }}
                      className={`text-xs px-3 py-1 rounded-full border ${byAllocation ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 hover:bg-slate-50"}`}>
                      לפי ההקצאה של כל בית ספר
                    </button>
                  ) : allocation ? (
                    <button type="button" onClick={() => setMonths(type, spreadPlan(allocation))}
                      className="text-xs px-3 py-1 rounded-full border border-blue-300 text-blue-700 hover:bg-blue-50">לפי ההקצאה ({allocation})</button>
                  ) : null}
                  <button type="button" onClick={() => setMonths(type, {})}
                    className="text-xs px-3 py-1 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-50">נקה</button>
                </div>
                {byAllocation ? (
                  <p className="text-slate-600 bg-blue-50 rounded-lg px-3 py-2">
                    לכל בית ספר תיפרס ההקצאה שלו ({label}) באופן שווה על פני השנה. בית ספר בלי הקצאה לא ישתנה.
                  </p>
                ) : (
                  <div className="grid grid-cols-12 gap-1">
                    {/* A month is a toggle (click = one meeting); "+" under a chosen month adds
                        another meeting to it, "−" takes one away (down to one — the toggle clears). */}
                    {ACADEMIC_MONTHS.map(m => {
                      const n = months[m] || 0;
                      const monthName = MONTH_SHORT[m];
                      return (
                        <div key={m} className="flex flex-col items-center gap-1">
                          <button type="button" aria-pressed={n > 0}
                            aria-label={`${label} — ${monthName}: ${n ? `${n} פגישות` : "ללא פגישה"}`}
                            onClick={() => setCell(type, m, n ? 0 : 1)}
                            className={`w-full rounded-lg border py-2 text-xs font-medium transition-colors ${
                              n ? "bg-blue-600 border-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                            {monthName}
                            {n > 1 && <span className="block text-[11px] font-bold">×{n}</span>}
                          </button>
                          {n > 0 && (
                            <div className="flex items-center gap-0.5">
                              <button type="button" aria-pressed={physical[type].has(m)}
                                onClick={() => togglePhysical(type, m)}
                                aria-label={`${monthName}: ${physical[type].has(m) ? "פגישה פיזית — לחץ לביטול" : "סמן שאחת הפגישות פיזית"}`}
                                title={physical[type].has(m) ? "אחת הפגישות בחודש הזה פיזית" : "סמן שאחת הפגישות בחודש הזה צריכה להיות פיזית"}
                                className={`w-5 h-5 rounded-full border text-[11px] leading-none ${physical[type].has(m) ? "bg-amber-100 border-amber-400" : "border-slate-200 opacity-50 hover:opacity-100"}`}>
                                <span aria-hidden="true">🏫</span>
                              </button>
                              {n > 1 && (
                                <button type="button" onClick={() => setCell(type, m, n - 1)}
                                  aria-label={`הסר פגישה מ${monthName}`}
                                  className="w-5 h-5 rounded-full border border-slate-300 text-slate-600 text-xs leading-none hover:bg-slate-50">−</button>
                              )}
                              <button type="button" onClick={() => setCell(type, m, n + 1)} disabled={n >= MAX_PER_MONTH}
                                aria-label={`הוסף פגישה ב${monthName}`} title="הוסף פגישה נוספת בחודש הזה"
                                className="w-5 h-5 rounded-full border border-blue-300 text-blue-700 text-xs leading-none hover:bg-blue-50 disabled:opacity-40">+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!byAllocation && (
                  <p className="text-xs mt-2 text-slate-600">
                    סה״כ {total} פגישות בשנה
                    {gap != null && gap !== 0 && (
                      <span className="text-amber-700"> · ⚠ {gap > 0 ? `${gap} יותר` : `${-gap} פחות`} מההקצאה ({allocation})</span>
                    )}
                    {gap === 0 && <span className="text-green-700"> · תואם להקצאה</span>}
                    {physical[type].size > 0 && <span> · מתוכן {physical[type].size} פיזיות</span>}
                  </p>
                )}
                {!byAllocation && total > 0 && (
                  <p className="text-[11px] mt-1 text-slate-500">
                    <span aria-hidden="true">🏫</span> מתחת לחודש = אחת הפגישות בו צריכה להיות פיזית. בסבב זה רק מסמן את בית הספר כפיזי לאישורך — פגישות פיזיות מוצעות לבית הספר רק בימי השטח של היועץ.
                  </p>
                )}
              </fieldset>
            );
          })}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
          <button type="button" onClick={save} disabled={saving}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}
