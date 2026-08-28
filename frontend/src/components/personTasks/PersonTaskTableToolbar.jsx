import { useEffect, useRef, useState } from "react";
import { SCHOOL_FILTER_FIELDS } from "./personTaskSchoolFilter";

// Free-text school search + compact "סינון מתקדם" popover (pick one field + one value), shown
// above the per-assignee / personal schools table inside an expanded person-task.
export default function PersonTaskTableToolbar({ freeText, setFreeText, advanced, setAdvanced, fieldOptions }) {
  const [open, setOpen] = useState(false);
  const [draftField, setDraftField] = useState(advanced?.fieldKey || SCHOOL_FILTER_FIELDS[0].key);
  const [draftValue, setDraftValue] = useState(advanced?.value || "");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const fieldDef = SCHOOL_FILTER_FIELDS.find(f => f.key === draftField) || SCHOOL_FILTER_FIELDS[0];
  const valueOptions = (fieldOptions.find(f => f.field === fieldDef.fieldOptionKey)?.options) || null;
  const activeLabel = advanced ? (SCHOOL_FILTER_FIELDS.find(f => f.key === advanced.fieldKey)?.label || "") : null;

  function apply() {
    if (!String(draftValue).trim()) { setAdvanced(null); setOpen(false); return; }
    setAdvanced({ fieldKey: draftField, value: draftValue, isText: !valueOptions });
    setOpen(false);
  }
  function clear() {
    setAdvanced(null);
    setDraftValue("");
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <label className="sr-only" htmlFor="ptask-school-search">חיפוש בית ספר</label>
      <input
        id="ptask-school-search"
        type="text"
        value={freeText}
        onChange={e => setFreeText(e.target.value)}
        placeholder="חיפוש בית ספר / עיר / בעלות / סמל..."
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-64 min-w-[10rem]"
      />
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className={`text-xs px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap border ${
            advanced
              ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          סינון מתקדם{activeLabel ? `: ${activeLabel}` : ""}
          <span aria-hidden="true" className="mr-1 opacity-60">▾</span>
        </button>
        {open && (
          <div className="absolute z-30 top-full mt-1 right-0 w-64 border border-slate-200 rounded-lg bg-white shadow-lg p-2 space-y-2">
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="ptask-adv-field">שדה</label>
              <select
                id="ptask-adv-field"
                value={draftField}
                onChange={e => { setDraftField(e.target.value); setDraftValue(""); }}
                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                {SCHOOL_FILTER_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="ptask-adv-value">ערך</label>
              {valueOptions ? (
                <select
                  id="ptask-adv-value"
                  value={draftValue}
                  onChange={e => setDraftValue(e.target.value)}
                  className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="">בחר</option>
                  {valueOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id="ptask-adv-value"
                  type="text"
                  value={draftValue}
                  onChange={e => setDraftValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
                  className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                />
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={apply} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700">
                החל
              </button>
              {advanced && (
                <button type="button" onClick={clear} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-100">
                  נקה
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
