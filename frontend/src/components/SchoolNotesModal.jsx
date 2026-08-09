import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

export const AUTHOR_COLORS = [
  { bg: "#FEF9C3", text: "#854d0e" }, // צהוב לייט
  { bg: "#CFFAFE", text: "#155e75" }, // תכלת לייט
  { bg: "#DCFCE7", text: "#166534" }, // ירוק לייט
  { bg: "#FCE7F3", text: "#9d174d" }, // ורוד לייט
  { bg: "#EDE9FE", text: "#5b21b6" }, // סגול לייט
  { bg: "#FFEDD5", text: "#9a3412" }, // כתום לייט
];

export function formatUpdateDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export const ROLE_RANK = { owner: 3, manager: 2, advisor: 1 };

// Assigns a stable pastel color per author, by first-appearance order across the whole thread —
// but only when 2+ distinct authors have written in this thread. A single-author thread stays
// plain/uncolored, since there's nothing to visually distinguish yet.
export function buildAuthorColorMap(groups) {
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

// Cross-user edit/delete only allowed against a strictly-lower-ranked author
// (owner > manager > advisor). Acting on your own segment is always allowed.
export function canEditSegment(currentUser, seg) {
  if (seg.author_id === currentUser?.id) return true;
  if (!seg.author_role) return false;
  return (ROLE_RANK[currentUser?.role] || 0) > (ROLE_RANK[seg.author_role] || 0);
}
export function canDeleteSegment(currentUser, seg) {
  if (currentUser?.role !== "owner" && currentUser?.role !== "manager") return false;
  if (seg.author_id === currentUser?.id) return true;
  if (!seg.author_role) return false;
  return (ROLE_RANK[currentUser?.role] || 0) > (ROLE_RANK[seg.author_role] || 0);
}

export function NotesThread({ groups, currentUser, onCreate, onEdit, onDelete, compact, title }) {
  const [newRecordText, setNewRecordText] = useState(null); // null = closed, string = open+editing
  const [editDraft, setEditDraft] = useState(null); // { segmentId, groupId, text }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const authorColorMap = buildAuthorColorMap(groups);
  const cell = compact ? "px-2 py-1.5" : "px-3 py-2";
  const th = compact ? "px-2 py-1.5" : "px-3 py-2";

  async function saveNewRecord() {
    const content = (newRecordText || "").trim();
    setNewRecordText(null);
    if (!content) return;
    setSaving(true); setError("");
    try {
      await onCreate(content);
    } catch {
      setError("שמירת ההערה נכשלה — נסה שוב");
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
      await onEdit(segmentId, groupId, content);
    } catch {
      setError("עריכת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(groupId, segmentId) {
    setSaving(true); setError("");
    try {
      await onDelete(groupId, segmentId);
    } catch {
      setError("מחיקת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  const addButton = (
    <button type="button" onClick={() => setNewRecordText("")} disabled={saving}
      className="btn-ghost text-xs px-3 py-1.5">
      + הערה חדשה
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <div className="relative flex items-center justify-center mb-1">
          <p className={compact ? "text-xs font-bold text-slate-700" : "text-sm font-semibold text-slate-700"}>{title}</p>
          <div className="absolute left-0">{addButton}</div>
        </div>
      ) : addButton}

      {error && <div role="alert" className="text-xs text-red-600">{error}</div>}

      <table className="w-full text-sm border-collapse" dir="rtl">
        <thead>
          <tr>
            <th scope="col" className={`text-right text-xs font-700 text-slate-500 ${th}`} style={{ width: compact ? "88px" : "110px" }}>תאריך</th>
            <th scope="col" className={`text-right text-xs font-700 text-slate-500 ${th}`} style={{ width: compact ? "90px" : "120px" }}>משתמש</th>
            <th scope="col" className={`text-right text-xs font-700 text-slate-500 ${th}`}>הערה</th>
          </tr>
        </thead>
        <tbody>
          {newRecordText !== null && (
            <tr className="border-t border-slate-100">
              <td className={`${cell} text-xs text-slate-400 align-top`}>עכשיו</td>
              <td className={`${cell} text-xs text-slate-700 align-top`}>{currentUser?.full_name}</td>
              <td className={`${cell} align-top`}>
                <label htmlFor="new-note-text" className="sr-only">תוכן הערה חדשה</label>
                <textarea id="new-note-text" rows={2} autoFocus
                  className="w-full text-xs border border-slate-200 rounded-lg p-2" dir="rtl"
                  value={newRecordText} onChange={e => setNewRecordText(e.target.value)}
                  onBlur={saveNewRecord} />
              </td>
            </tr>
          )}
          {groups.length === 0 && newRecordText === null && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-xs text-slate-400">אין עדיין הערות</td>
            </tr>
          )}
          {groups.map(group => (
            <tr key={group.group_id} className="border-t border-slate-100">
              <td className={`${cell} align-top`}>
                {group.segments.map(seg => (
                  <div key={seg.id} className="text-xs px-1.5 py-1 rounded mb-1"
                    style={{ background: authorColorMap[seg.author_id]?.bg, color: authorColorMap[seg.author_id]?.text }}>
                    {formatUpdateDate(seg.created_at)}
                  </div>
                ))}
              </td>
              <td className={`${cell} align-top`}>
                {group.segments.map(seg => (
                  <div key={seg.id} className="text-xs px-1.5 py-1 rounded mb-1"
                    style={{ background: authorColorMap[seg.author_id]?.bg, color: authorColorMap[seg.author_id]?.text }}>
                    {seg.author_name || "—"}
                  </div>
                ))}
              </td>
              <td className={`${cell} align-top`}>
                {group.segments.map(seg => {
                  const editable = canEditSegment(currentUser, seg);
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
                          <label htmlFor={`edit-note-${seg.id}`} className="sr-only">עריכת תוכן ההערה</label>
                          <textarea id={`edit-note-${seg.id}`} rows={2} autoFocus
                            className="w-full text-xs border border-slate-300 rounded p-1" dir="rtl"
                            value={editDraft.text} onClick={e => e.stopPropagation()}
                            onChange={e => setEditDraft(d => ({ ...d, text: e.target.value }))}
                            onBlur={() => saveEdit(seg.id, group.group_id, editDraft.text)} />
                        </>
                      ) : (
                        <span className="flex-1" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{seg.content}</span>
                      )}
                      {canDeleteSegment(currentUser, seg) && !isEditing && (
                        <button type="button" aria-label="מחק הערה זו" className="text-slate-400 hover:text-red-600 text-xs flex-shrink-0"
                          onClick={e => { e.stopPropagation(); handleDelete(group.group_id, seg.id); }}>
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
  );
}

const QUARTER_LABELS = { 1: "רבעון 1", 2: "רבעון 2", 3: "רבעון 3", 4: "רבעון 4" };

export function SchoolNotesModal({ schoolId, currentUser, onClose, focusQuarter }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const isAdvisor = currentUser?.role === "advisor";
  const showTabs = !isAdvisor && !focusQuarter;

  const [tab, setTab] = useState(focusQuarter ? "quarterly" : "general");
  const [data, setData] = useState(null); // { general: [...], quarterly: {1:[...],2:[...],3:[...],4:[...]} }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`/schools/${schoolId}/notes`).then(({ data }) => {
      if (cancelled) return;
      setData(data);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError("טעינת ההערות נכשלה");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [schoolId]);

  function updateGeneral(next) {
    setData(d => ({ ...d, general: next }));
  }
  function updateQuarter(q, next) {
    setData(d => ({ ...d, quarterly: { ...d.quarterly, [q]: next } }));
  }

  async function createNote(noteType, quarter, content) {
    const { data: created } = await axios.post(`/schools/${schoolId}/notes`, { note_type: noteType, quarter, content });
    const segment = {
      id: created.id, author_id: created.author_id, author_name: currentUser?.full_name, author_role: currentUser?.role,
      content: created.content, created_at: created.created_at, updated_at: created.updated_at,
    };
    const newGroup = { group_id: created.group_id, segments: [segment] };
    if (noteType === "general") updateGeneral([newGroup, ...(data.general || [])]);
    else updateQuarter(quarter, [newGroup, ...(data.quarterly[quarter] || [])]);
  }

  async function editNote(noteType, quarter, segmentId, groupId, content) {
    await axios.patch(`/schools/${schoolId}/notes/segments/${segmentId}`, { content });
    const apply = groups => groups.map(g => g.group_id !== groupId ? g : {
      ...g, segments: g.segments.map(s => s.id === segmentId ? { ...s, content } : s),
    });
    if (noteType === "general") updateGeneral(apply(data.general || []));
    else updateQuarter(quarter, apply(data.quarterly[quarter] || []));
  }

  async function deleteNote(noteType, quarter, groupId, segmentId) {
    await axios.delete(`/schools/${schoolId}/notes/segments/${segmentId}`);
    const apply = groups => groups
      .map(g => g.group_id !== groupId ? g : { ...g, segments: g.segments.filter(s => s.id !== segmentId) })
      .filter(g => g.segments.length > 0);
    if (noteType === "general") updateGeneral(apply(data.general || []));
    else updateQuarter(quarter, apply(data.quarterly[quarter] || []));
  }

  const title = focusQuarter ? `הערות רבעוניות — ${QUARTER_LABELS[focusQuarter]}` : "הערות";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-notes-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full flex flex-col gap-4"
        style={{ maxHeight: "85vh", maxWidth: showTabs && tab === "quarterly" ? "1100px" : "640px" }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="school-notes-modal-title" className="font-bold text-slate-900 text-base">{title}</h2>
          <button type="button" onClick={onClose} aria-label="סגור חלונית" className="btn-ghost text-sm px-3 py-1.5">✕</button>
        </div>

        {showTabs && (
          <div className="flex items-center gap-1 border-b border-slate-200">
            <button type="button" onClick={() => setTab("general")}
              className={`text-sm px-4 py-2 border-b-2 -mb-px ${tab === "general" ? "border-blue-600 text-blue-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              הערות
            </button>
            <button type="button" onClick={() => setTab("quarterly")}
              className={`text-sm px-4 py-2 border-b-2 -mb-px ${tab === "quarterly" ? "border-blue-600 text-blue-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              הערות רבעוניות
            </button>
          </div>
        )}

        <div className="overflow-y-auto flex-1" style={{ minHeight: "120px" }}>
          {loading && <div role="status" aria-label="טוען הערות" className="text-xs text-slate-400 text-center py-6">טוען…</div>}
          {loadError && <div role="alert" className="text-xs text-red-600 text-center py-6">{loadError}</div>}

          {!loading && !loadError && data && (
            <>
              {(isAdvisor || tab === "general") && !focusQuarter && (
                <NotesThread
                  groups={data.general || []}
                  currentUser={currentUser}
                  onCreate={content => createNote("general", null, content)}
                  onEdit={(segmentId, groupId, content) => editNote("general", null, segmentId, groupId, content)}
                  onDelete={(groupId, segmentId) => deleteNote("general", null, groupId, segmentId)}
                />
              )}

              {!isAdvisor && focusQuarter && (
                <NotesThread
                  groups={data.quarterly[focusQuarter] || []}
                  currentUser={currentUser}
                  onCreate={content => createNote("quarterly", focusQuarter, content)}
                  onEdit={(segmentId, groupId, content) => editNote("quarterly", focusQuarter, segmentId, groupId, content)}
                  onDelete={(groupId, segmentId) => deleteNote("quarterly", focusQuarter, groupId, segmentId)}
                />
              )}

              {!isAdvisor && !focusQuarter && tab === "quarterly" && (
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-4 gap-3" style={{ minWidth: "980px" }}>
                    {[1, 2, 3, 4].map(q => (
                      <div key={q} className="border border-slate-200 rounded-xl p-2 bg-white/60">
                        <NotesThread
                          compact
                          title={QUARTER_LABELS[q]}
                          groups={data.quarterly[q] || []}
                          currentUser={currentUser}
                          onCreate={content => createNote("quarterly", q, content)}
                          onEdit={(segmentId, groupId, content) => editNote("quarterly", q, segmentId, groupId, content)}
                          onDelete={(groupId, segmentId) => deleteNote("quarterly", q, groupId, segmentId)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
