import { useMemo } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import { STAGE_SCOPE_OPTIONS } from "./taskShared";

// Flattens {meeting -> option -> schools} into one list, so the virtualizer only mounts what's
// visible however many schools are involved.
function buildItems(cards, schools) {
  const items = [];
  cards.forEach(card => {
    items.push({ kind: "meeting", key: `m-${card.label}`, label: card.label });
    STAGE_SCOPE_OPTIONS.forEach(opt => {
      const matching = schools.filter(s => (card.overrides?.[s.school_id] || card.defaultScope) === opt.value);
      if (!matching.length) return;
      items.push({ kind: "option", key: `o-${card.label}-${opt.value}`, label: opt.label, count: matching.length });
      matching.forEach(s => items.push({ kind: "school", key: `s-${card.label}-${s.school_id}`, school: s }));
    });
  });
  return items;
}

const getItemKey = item => item.key;

// Shown when leaving the wizard's first step after using "התאמה אישית": a read-only recap of what
// each six-year school will be asked for. `cards` = [{label, defaultScope, overrides}].
export default function StageScopeSummaryModal({ cards, schools, onContinue, onEdit }) {
  const { ref, handleKeyDown } = useFocusTrap(onEdit);
  const items = useMemo(() => buildItems(cards, schools), [cards, schools]);
  const { scrollRef, virtualizer, items: virtualItems, padTop, padBottom } = useRowVirtualizer(items, { estimateSize: 32, getItemKey });

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="stage-scope-summary-title" onKeyDown={handleKeyDown}
        className="bg-white shadow-2xl rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="stage-scope-summary-title" className="font-bold text-slate-800">שים לב — סיכום הבחירה לבתי הספר השש-שנתיים</h2>
          <p className="text-xs text-slate-500 mt-1">כך ייקבעו הפגישות עבור כל בית ספר. אפשר להמשיך או לחזור ולערוך.</p>
        </div>
        <div ref={scrollRef} tabIndex={0} role="region" aria-label="רשימת בתי הספר לפי הבחירה" className="flex-1 min-h-0 overflow-auto px-6 py-3" style={{ maxHeight: "60vh" }}>
          <div style={{ height: padTop }} aria-hidden="true" />
          {virtualItems.map(vi => {
            const item = items[vi.index];
            return (
              <div key={item.key} data-index={vi.index} ref={virtualizer.measureElement}>
                {item.kind === "meeting" && <h3 className="text-sm font-bold text-slate-800 pt-3 pb-1">{item.label}</h3>}
                {item.kind === "option" && (
                  <p className="text-sm text-black pt-2 pb-1">
                    עבור בתי הספר הבאים ({item.count}) בחרת: <b className="text-blue-700">{item.label}</b>
                  </p>
                )}
                {item.kind === "school" && (
                  <p className="text-sm text-slate-600 pr-4 py-0.5">
                    {item.school.school_name}{item.school.symbol ? ` (${item.school.symbol})` : ""}
                  </p>
                )}
              </div>
            );
          })}
          <div style={{ height: padBottom }} aria-hidden="true" />
        </div>
        <div className="flex justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onEdit} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">עריכה</button>
          <button type="button" onClick={onContinue} className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">המשך לשלב הבא</button>
        </div>
      </div>
    </div>
  );
}
