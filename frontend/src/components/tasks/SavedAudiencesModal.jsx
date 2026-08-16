import { useMemo, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { describeCondition } from "./taskShared";

// Each field=value combination as its own small pill instead of one run-on "וגם"-joined
// sentence — much easier to visually parse at a glance.
function CriteriaChips({ criteria, fieldOptions }) {
  const groups = criteria?.groups || [];
  if (!groups.length || !groups.some(g => g.conditions?.length)) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-wrap items-center gap-1">
          {gi > 0 && <span className="text-[10px] font-bold text-blue-600 mx-1">או</span>}
          {(g.conditions || []).map((c, ci) => (
            <span key={ci} className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">
              {describeCondition(c, fieldOptions)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// Dedicated dialog for "קהל שמור" (pulled out of the inline expanding panel — with many saved
// audiences that panel got cramped). Free-text search narrows the list live as you type,
// matching both the audience's name and its condition text. Each row offers select/edit/delete.
export default function SavedAudiencesModal({ audiences, fieldOptions, onClose, onSelect, onEdit, onDelete }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return audiences;
    return audiences.filter(a => {
      if (a.name.toLowerCase().includes(q)) return true;
      const groups = a.criteria?.groups || [];
      return groups.some(g => (g.conditions || []).some(c => describeCondition(c, fieldOptions).toLowerCase().includes(q)));
    });
  }, [audiences, q, fieldOptions]);

  async function handleDelete(id) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch {
      setDeleteError("מחיקה נכשלה — נסה שוב.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-audiences-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 id="saved-audiences-title" className="font-bold text-black">קהלים שמורים</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <label htmlFor="saved-audience-search" className="sr-only">חיפוש קהל שמור</label>
          <input
            id="saved-audience-search"
            type="search"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם או תנאי..."
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
          />
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1.5">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              {audiences.length === 0 ? "אין קהלים שמורים עדיין." : "לא נמצאו קהלים תואמים."}
            </p>
          ) : filtered.map(a => (
            <div key={a.id} className="border border-slate-100 rounded-xl p-3 hover:border-blue-200 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{a.name}</div>
                  <CriteriaChips criteria={a.criteria} fieldOptions={fieldOptions} />
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelect(a)}
                    className="text-xs px-3 py-1 rounded-full font-medium bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                  >
                    בחר
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(a)}
                    aria-label={`עריכת ${a.name}`}
                    className="p-1.5 rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
                    </svg>
                  </button>
                  {confirmDeleteId === a.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap"
                      >
                        {deletingId === a.id ? "מוחק..." : "אישור מחיקה"}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs text-slate-400 hover:text-slate-600 px-1">
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(a.id)}
                      aria-label={`מחיקת ${a.name}`}
                      className="p-1.5 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              {confirmDeleteId === a.id && deleteError && (
                <p role="alert" className="text-xs text-red-600 mt-1.5">{deleteError}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
