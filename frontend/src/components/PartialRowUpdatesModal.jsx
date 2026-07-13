import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

const AUTHOR_COLORS = [
  { bg: "#FEF9C3", text: "#854d0e" }, // צהוב לייט
  { bg: "#CFFAFE", text: "#155e75" }, // תכלת לייט
  { bg: "#DCFCE7", text: "#166534" }, // ירוק לייט
  { bg: "#FCE7F3", text: "#9d174d" }, // ורוד לייט
  { bg: "#EDE9FE", text: "#5b21b6" }, // סגול לייט
  { bg: "#FFEDD5", text: "#9a3412" }, // כתום לייט
];

function formatUpdateDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

const ROLE_RANK = { owner: 3, manager: 2, advisor: 1 };

// Assigns a stable pastel color per author, by first-appearance order across the whole thread —
// but only when 2+ distinct authors have written in this thread. A single-author thread stays
// plain/uncolored, since there's nothing to visually distinguish yet.
function buildAuthorColorMap(groups) {
  const chrono = groups.flatMap(g => g.segments).slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const distinctAuthors = new Set(chrono.map(s => s.author_id));
  if (distinctAuthors.size < 2) return {};
  const map = {};
  let idx = 0;
  for (const seg of chrono) {
    if (!(seg.author_id in map)) {
      map[seg.author_id] = AUTHOR_COLORS[idx % AUTHOR_COLORS.length];
      idx++;
    }
  }
  return map;
}

export function PartialRowUpdatesModal({
  schoolId, division, budgetName, rowKey, rowLabel, currentUser,
  groups: initialGroups, onChange, onClose,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [groups, setGroups] = useState(initialGroups || []);
  const [newRecordText, setNewRecordText] = useState(null); // null = closed, string = open+editing
  const [editDraft, setEditDraft] = useState(null); // { segmentId, groupId, text }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const authorColorMap = buildAuthorColorMap(groups);

  function pushChange(next) {
    setGroups(next);
    onChange?.(rowKey, next);
  }

  // Cross-user edit/delete only allowed against a strictly-lower-ranked author
  // (owner > manager > advisor). Acting on your own segment is always allowed.
  function canEditSegment(seg) {
    if (seg.author_id === currentUser?.id) return true;
    if (!seg.author_role) return false;
    return (ROLE_RANK[currentUser?.role] || 0) > (ROLE_RANK[seg.author_role] || 0);
  }
  function canDeleteSegment(seg) {
    if (currentUser?.role !== "owner" && currentUser?.role !== "manager") return false;
    if (seg.author_id === currentUser?.id) return true;
    if (!seg.author_role) return false;
    return (ROLE_RANK[currentUser?.role] || 0) > (ROLE_RANK[seg.author_role] || 0);
  }

  async function saveNewRecord() {
    const content = (newRecordText || "").trim();
    setNewRecordText(null);
    if (!content) return;
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`/schools/${schoolId}/partial-updates`, {
        division, budget_name: budgetName || null, row_key: rowKey, content,
      });
      const segment = {
        id: data.id, author_id: data.author_id, author_name: currentUser?.full_name, author_role: currentUser?.role,
        content: data.content, created_at: data.created_at, updated_at: data.updated_at,
      };
      pushChange([{ group_id: data.group_id, segments: [segment] }, ...groups]);
    } catch {
      setError("שמירת העדכון נכשלה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(segmentId, groupId, text) {
    const content = (text || "").trim();
    setEditDraft(null);
    if (!content) return;
    setSaving(true); setError("");
    try {
      await axios.patch(`/schools/${schoolId}/partial-updates/segments/${segmentId}`, { content });
      pushChange(groups.map(g => g.group_id !== groupId ? g : {
        ...g,
        segments: g.segments.map(s => s.id === segmentId ? { ...s, content } : s),
      }));
    } catch {
      setError("עריכת העדכון נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSegment(groupId, segmentId) {
    setSaving(true); setError("");
    try {
      await axios.delete(`/schools/${schoolId}/partial-updates/segments/${segmentId}`);
      const next = groups
        .map(g => g.group_id !== groupId ? g : { ...g, segments: g.segments.filter(s => s.id !== segmentId) })
        .filter(g => g.segments.length > 0);
      pushChange(next);
    } catch {
      setError("מחיקת העדכון נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="partial-updates-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-2xl flex flex-col gap-4" style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="partial-updates-modal-title" className="font-bold text-slate-900 text-base">
            עדכונים — {rowLabel}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגור חלונית" className="btn-ghost text-sm px-3 py-1.5">✕</button>
        </div>

        <button type="button" onClick={() => setNewRecordText("")} disabled={saving}
          className="btn-blue text-sm px-4 py-2 self-start">
          + הוספת עדכון חדש
        </button>

        {error && <div role="alert" className="text-xs text-red-600">{error}</div>}

        <div className="overflow-y-auto flex-1" style={{ minHeight: "120px" }}>
          <table className="w-full text-sm border-collapse" dir="rtl">
            <thead>
              <tr>
                <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2" style={{ width: "110px" }}>תאריך</th>
                <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2" style={{ width: "120px" }}>משתמש</th>
                <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2">תוכן</th>
              </tr>
            </thead>
            <tbody>
              {newRecordText !== null && (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 text-xs text-slate-400 align-top">עכשיו</td>
                  <td className="px-3 py-2 text-xs text-slate-700 align-top">{currentUser?.full_name}</td>
                  <td className="px-3 py-2 align-top">
                    <label htmlFor="new-record-text" className="sr-only">תוכן עדכון חדש</label>
                    <textarea id="new-record-text" rows={2} autoFocus
                      className="w-full text-xs border border-slate-200 rounded-lg p-2" dir="rtl"
                      value={newRecordText} onChange={e => setNewRecordText(e.target.value)}
                      onBlur={saveNewRecord} />
                  </td>
                </tr>
              )}
              {groups.length === 0 && newRecordText === null && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-xs text-slate-400">אין עדיין עדכונים למענה זה</td>
                </tr>
              )}
              {groups.map(group => (
                <tr key={group.group_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">
                    {group.segments.map(seg => (
                      <div key={seg.id} className="text-xs px-1.5 py-1 rounded mb-1"
                        style={{ background: authorColorMap[seg.author_id]?.bg, color: authorColorMap[seg.author_id]?.text }}>
                        {formatUpdateDate(seg.created_at)}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {group.segments.map(seg => (
                      <div key={seg.id} className="text-xs px-1.5 py-1 rounded mb-1"
                        style={{ background: authorColorMap[seg.author_id]?.bg, color: authorColorMap[seg.author_id]?.text }}>
                        {seg.author_name || "—"}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {group.segments.map(seg => {
                      const editable = canEditSegment(seg);
                      const isEditing = editDraft?.segmentId === seg.id;
                      const color = authorColorMap[seg.author_id];
                      return (
                        <div key={seg.id}
                          className="text-xs px-1.5 py-1 rounded mb-1 flex items-start justify-between gap-2"
                          style={{ background: color?.bg, color: color?.text }}
                          onClick={() => {
                            if (!editable) return;
                            setEditDraft({ segmentId: seg.id, groupId: group.group_id, text: seg.content });
                          }}>
                          {isEditing ? (
                            <>
                              <label htmlFor={`edit-${seg.id}`} className="sr-only">עריכת תוכן העדכון</label>
                              <textarea id={`edit-${seg.id}`} rows={2} autoFocus
                                className="w-full text-xs border border-slate-300 rounded p-1" dir="rtl"
                                value={editDraft.text} onClick={e => e.stopPropagation()}
                                onChange={e => setEditDraft(d => ({ ...d, text: e.target.value }))}
                                onBlur={() => saveEdit(seg.id, group.group_id, editDraft.text)} />
                            </>
                          ) : (
                            <span className="flex-1" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{seg.content}</span>
                          )}
                          {canDeleteSegment(seg) && !isEditing && (
                            <button type="button" aria-label="מחק עדכון זה" className="text-slate-400 hover:text-red-600 text-xs flex-shrink-0"
                              onClick={e => { e.stopPropagation(); deleteSegment(group.group_id, seg.id); }}>
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
