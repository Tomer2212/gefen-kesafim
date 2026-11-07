import { memo, useCallback, useMemo, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import { VirtualRows } from "../common/VirtualRows";
import { STAGE_SCOPE_OPTIONS, stageScopeLabel } from "./taskShared";

const getSchoolKey = s => s.school_id;

const SchoolRow = memo(function SchoolRow({ school, value, isCustom, onChoose }) {
  return (
    <tr className={`border-b border-slate-100 ${isCustom ? "bg-blue-50/60" : ""}`}>
      <td className="px-4 py-2 text-sm text-slate-800">
        <span>{school.school_name}</span>
        {school.principal_same_person && (
          <span className="block text-[11px] text-amber-700">מנהל/ת אחד/ת לשתי החטיבות</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{school.symbol || "—"}</td>
      <td className="px-3 py-2">
        <div role="group" aria-label={`בחירת חטיבות עבור ${school.school_name}`} className="flex flex-wrap gap-1.5">
          {STAGE_SCOPE_OPTIONS.map(opt => (
            <button key={opt.value} type="button"
              aria-pressed={value === opt.value}
              onClick={() => onChoose(school.school_id, opt.value)}
              className={`text-xs px-2.5 py-1 rounded-lg border whitespace-nowrap transition-colors ${
                value === opt.value
                  ? "bg-blue-600 border-blue-600 text-white font-semibold"
                  : "border-slate-400 text-black hover:bg-slate-50"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
});

// "התאמה אישית" for one meeting card: which divisions each six-year school in the audience is
// invited for. `overrides` holds exceptions only; a row without one shows `defaultScope` (the
// card's regular button) and keeps following it if that button changes later. All edits stay in
// a local draft until "אישור". The school list comes from the wizard's uncapped /tasks/preview
// and can be long, so rows are virtualized.
export default function StageScopeCustomizeModal({ meetingLabel, schools, defaultScope, overrides, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [draft, setDraft] = useState(() => ({ ...(overrides || {}) }));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(s => (s.school_name || "").toLowerCase().includes(q) || String(s.symbol || "").includes(q));
  }, [schools, query]);

  const { scrollRef, virtualizer, items, padTop, padBottom } = useRowVirtualizer(filtered, { estimateSize: 46, getItemKey: getSchoolKey });

  // Clicking a row's own exception again returns the row to the default. Clicking the default
  // while the row is already following it changes nothing.
  const chooseForSchool = useCallback((schoolId, value) => {
    setDraft(prev => {
      const current = prev[schoolId];
      if (current === value || (!current && value === defaultScope)) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[schoolId];
        return next;
      }
      return { ...prev, [schoolId]: value };
    });
  }, [defaultScope]);

  function applyToShown(value) {
    setDraft(prev => {
      const next = { ...prev };
      for (const s of filtered) {
        if (value === defaultScope) delete next[s.school_id];
        else next[s.school_id] = value;
      }
      return next;
    });
  }

  const customCount = schools.filter(s => draft[s.school_id]).length;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="stage-scope-customize-title" onKeyDown={handleKeyDown}
        className="bg-white shadow-2xl rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="stage-scope-customize-title" className="font-bold text-slate-800">התאמה אישית — {meetingLabel}</h2>
          <p className="text-xs text-slate-500 mt-1">
            {defaultScope
              ? <>בתי ספר שלא תשנו עבורם את הבחירה יקבלו: <b>{stageScopeLabel(defaultScope)}</b></>
              : "בתי ספר שלא תבחרו עבורם יקבלו את האפשרות שתבחרו במסך הקודם"}
          </p>
        </div>

        <div className="px-6 py-3 flex flex-col gap-2 border-b border-slate-100">
          <div>
            <label htmlFor="stage-scope-search" className="block text-xs font-medium text-black mb-1">חיפוש לפי שם מוסד או סמל מוסד</label>
            <input id="stage-scope-search" type="text" value={query} onChange={e => setQuery(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400" />
          </div>
          <div role="group" aria-label={`החל על כל ${filtered.length} בתי הספר המוצגים`} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-black">החל על כל המוצגים ({filtered.length}):</span>
            {STAGE_SCOPE_OPTIONS.map(opt => (
              <button key={opt.value} type="button" disabled={filtered.length === 0} onClick={() => applyToShown(opt.value)}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" style={{ maxHeight: "55vh" }}>
          <table className="w-full min-w-[860px] table-fixed text-right">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-xs text-slate-600 border-b border-slate-200">
                <th scope="col" className="px-4 py-2 font-semibold">בית ספר</th>
                <th scope="col" className="px-3 py-2 font-semibold w-24">סמל</th>
                <th scope="col" className="px-3 py-2 font-semibold w-[500px]">לאילו חטיבות לקבוע פגישה?</th>
              </tr>
            </thead>
            <VirtualRows items={items} padTop={padTop} padBottom={padBottom} colSpan={3}
              measureElement={virtualizer.measureElement} rows={filtered} rowKey={getSchoolKey}>
              {school => (
                <SchoolRow school={school} value={draft[school.school_id] || defaultScope}
                  isCustom={!!draft[school.school_id]} onChoose={chooseForSchool} />
              )}
            </VirtualRows>
          </table>
          {filtered.length === 0 && (
            <p role="status" className="text-sm text-slate-500 text-center py-8">לא נמצאו בתי ספר</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-xs text-slate-600">{customCount} מתוך {schools.length} בתי ספר בהתאמה אישית</span>
            <button type="button" disabled={Object.keys(draft).length === 0} onClick={() => setDraft({})}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40 disabled:no-underline">
              בטל את כל ההתאמות האישיות
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">ביטול</button>
            <button type="button" onClick={() => onConfirm(draft)} className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">אישור</button>
          </div>
        </div>
      </div>
    </div>
  );
}
