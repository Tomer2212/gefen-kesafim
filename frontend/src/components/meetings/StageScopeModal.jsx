import { useFocusTrap } from "../../hooks/useFocusTrap";

const STAGE_SCOPE_OPTIONS = [
  { value: "tichon",   label: "תיכון (חט\"ע) בלבד" },
  { value: "chativa",  label: "חטיבת ביניים (חט\"ב) בלבד" },
  { value: "both",     label: "שניהם יחד — פגישה אחת" },
  { value: "separate", label: "שתי פגישות נפרדות" },
];

/** Asks which stage(s) of a six-year school a new meeting is for — shown right before
 * creating the meeting, only when the target school is `stage === "sheshshnati"`. */
export function StageScopeModal({ schoolName, onChoose, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="stage-scope-title" onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3">
        <h2 id="stage-scope-title" className="font-bold text-slate-900">
          {schoolName ? `${schoolName} — ` : ""}בית ספר שש-שנתי: הפגישה מיועדת ל...
        </h2>
        <div className="flex flex-col gap-2">
          {STAGE_SCOPE_OPTIONS.map(o => (
            <button key={o.value} type="button" onClick={() => onChoose(o.value)}
              className="w-full text-right px-3 py-2 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm text-slate-700">
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} className="btn-ghost text-sm px-4 py-1.5 self-end mt-1">ביטול</button>
      </div>
    </div>
  );
}
