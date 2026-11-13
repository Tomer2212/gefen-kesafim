import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// "בעיות" window of a new round: physical schools whose combined גפן+שוטף meeting has different
// גפן and שוטף advisors — for each, who goes out to the school (the other one joins remotely, or
// has a separate remote meeting). An answer is copied to the other unanswered schools with the
// same advisors, and can still be changed per school. Data: POST /rounds/physical-check.
function names(list) {
  return list.map(a => a.name || "—").join(", ");
}

function pairKey(s) {
  return `${s.gefen.map(a => a.id).sort().join(",")}|${s.current.map(a => a.id).sort().join(",")}`;
}

// initialVisitors ({school_id: [advisor_id]}, when editing a round) pre-selects earlier answers.
function choiceFromVisitors(school, ids) {
  if (!ids?.length) return undefined;
  const g = school.gefen.some(a => ids.includes(a.id));
  const c = school.current.some(a => ids.includes(a.id));
  return g && c ? "both" : g ? "gefen" : c ? "current" : undefined;
}

export default function PhysicalVisitorsModal({ schools, onCancel, onConfirm, initialVisitors = {} }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [choice, setChoice] = useState(() => Object.fromEntries(
    schools.map(s => [s.school_id, choiceFromVisitors(s, initialVisitors[s.school_id])]).filter(([, v]) => v),
  )); // {school_id: "gefen" | "current" | "both"}
  const [attempted, setAttempted] = useState(false);

  function choose(school, value) {
    const key = pairKey(school);
    setChoice(prev => {
      const next = { ...prev, [school.school_id]: value };
      for (const s of schools) {
        if (!prev[s.school_id] && s.school_id !== school.school_id && pairKey(s) === key) next[s.school_id] = value;
      }
      return next;
    });
  }

  const answered = schools.filter(s => choice[s.school_id]).length;

  function confirm() {
    if (answered < schools.length) { setAttempted(true); return; }
    const visitors = {};
    for (const s of schools) {
      const c = choice[s.school_id];
      visitors[s.school_id] = [
        ...(c === "gefen" || c === "both" ? s.gefen.map(a => a.id) : []),
        ...(c === "current" || c === "both" ? s.current.map(a => a.id) : []),
      ];
    }
    onConfirm(visitors);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="physical-visitors-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="physical-visitors-title" className="text-base font-bold text-slate-800">בעיות — מי מגיע לשטח?</h2>
          <p className="text-sm text-slate-600 mt-1">
            ל-{schools.length} מבתי הספר הפיזיים יש פגישת גפן+שוטף עם יועץ גפן ויועץ שוטף שונים. בחרו לכל אחד מי מגיע לבית הספר:
            רק בימי השטח שלו בית הספר יוכל לקבוע. מי שלא מגיע משתתף מרחוק (בפגישות נפרדות — הפגישה שלו מרחוק).
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
          {schools.map(s => {
            const c = choice[s.school_id];
            const options = [
              { value: "gefen", label: `${names(s.gefen)} (גפן)` },
              { value: "current", label: `${names(s.current)} (שוטף)` },
              { value: "both", label: "שניהם מגיעים" },
            ];
            return (
              <li key={s.school_id} className={`border rounded-xl p-3 flex flex-col gap-2 ${attempted && !c ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}>
                <span className="text-sm font-semibold text-slate-800">{[s.school_name, s.symbol && !(s.school_name || "").includes(s.symbol) ? s.symbol : null, s.authority].filter(Boolean).join(" - ")}</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`מי מגיע ל${s.school_name}`}>
                  {options.map(o => (
                    <button key={o.value} type="button" role="radio" aria-checked={c === o.value} onClick={() => choose(s, o.value)}
                      className={`text-sm px-3 py-1.5 rounded-lg border ${c === o.value ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-black text-black hover:bg-slate-50"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-50">חזרה</button>
          <div className="flex items-center gap-3">
            {attempted && answered < schools.length && (
              <span role="alert" className="text-xs text-red-600">יש לבחור לכל בית ספר ({schools.length - answered} נותרו)</span>
            )}
            <span className="text-xs text-slate-500">{answered}/{schools.length} נבחרו</span>
            <button type="button" onClick={confirm} className="btn-blue text-sm px-5 py-2">אישור</button>
          </div>
        </div>
      </div>
    </div>
  );
}
