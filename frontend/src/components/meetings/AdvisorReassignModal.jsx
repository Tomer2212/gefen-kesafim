import { useFocusTrap } from "../../hooks/useFocusTrap";

function names(profiles) {
  return profiles.map(p => p.full_name || p.email).join(", ");
}

// Shown when a meeting's "סוג" changes and "יועץ מבצע" is already set to someone other than
// the new type's default advisor(s) — lets the user decide how to reconcile the two.
export function AdvisorReassignModal({ oldTypeLabel, newTypeLabel, existingAdvisors, newAdvisors, onChoose, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const union = [...existingAdvisors, ...newAdvisors.filter(z => !existingAdvisors.some(w => w.id === z.id))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="advisor-reassign-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" dir="rtl">
        <h2 id="advisor-reassign-title" className="text-lg font-bold text-slate-800 mb-3">שינוי סוג פגישה</h2>
        <p className="text-sm text-slate-700 mb-5">
          סוג הפגישה שונה מ<strong>{oldTypeLabel}</strong> ל<strong>{newTypeLabel}</strong>, והיועץ המלווה ב{newTypeLabel} הוא <strong>{names(newAdvisors)}</strong>.
          האם להגדיר את {newAdvisors.length > 1 ? "היועצים הללו" : "היועץ הזה"} כיועץ המבצע של הפגישה במקום <strong>{names(existingAdvisors)}</strong>?
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => onChoose(existingAdvisors)}
            className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">
            השאר את הקיימים
          </button>
          <button type="button" onClick={() => onChoose(newAdvisors)}
            className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors">
            החלף לחדשים בלבד
          </button>
          <button type="button" onClick={() => onChoose(union)}
            className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">
            גם הקיימים וגם החדשים
          </button>
        </div>
      </div>
    </div>
  );
}
