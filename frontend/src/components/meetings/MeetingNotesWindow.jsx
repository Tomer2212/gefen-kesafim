import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useMeetingNotes } from "../../context/MeetingNotesContext";
import { formatUpdateDate, buildAuthorColorMap } from "../SchoolNotesModal";
import { MentionTextarea } from "./MentionTextarea";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 340;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 480;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;
const NOTE_COLS = "72px 84px 1fr";

// Meeting notes are strictly self-edit/self-delete — unlike SchoolNotesModal's
// canEditSegment/canDeleteSegment (which let a higher role edit/delete another user's note),
// every user here can only touch their own note; everyone else's is view-only to them.
function isOwnSegment(currentUser, seg) {
  return !!currentUser?.id && seg.author_id === currentUser.id;
}

function windowTitle(w) {
  const parts = [w.schoolName, w.schoolAuthority].filter(Boolean).join(", ");
  const symbol = w.schoolSymbol ? ` - ${w.schoolSymbol}` : "";
  return `הערות פגישה${parts ? " - " + parts : ""}${symbol}`;
}

// Renders every open meeting-notes window independently — same minimize/drag/resize/pill
// pattern as CompareResultsWindow, so notes stay open (or minimized to a pill) across page
// navigation instead of closing like the old inline modal did.
export default function MeetingNotesWindow() {
  const { noteWindows } = useMeetingNotes();
  const minimizedIds = noteWindows.filter(w => w.minimized).map(w => w.id);

  return (
    <>
      {noteWindows.map(w => (
        <MeetingNotesWindowItem key={w.id} win={w} minimizedOrder={minimizedIds.indexOf(w.id)} />
      ))}
    </>
  );
}

function MeetingNotesWindowItem({ win, minimizedOrder }) {
  const { id, meetingId, schoolId, minimized, highlightNoteId } = win;
  const { closeMeetingNotes, setMinimized } = useMeetingNotes();
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [currentUser, setCurrentUser] = useState(null);
  const [mentionUsers, setMentionUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [newRecordText, setNewRecordText] = useState(null); // null = closed, string = open+editing
  const [editDraft, setEditDraft] = useState(null); // { segmentId, groupId, text }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { groupId, segmentId, authorName } — cross-user delete by owner/manager only
  const [error, setError] = useState("");
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const highlightRowRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    axios.get("/schools/users/me").then(({ data }) => { if (!cancelled) setCurrentUser(data); }).catch(() => {});
    axios.get("/schools/users/mentionable").then(({ data }) => { if (!cancelled) setMentionUsers(data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`/schools/${schoolId}/meetings/${meetingId}/notes`).then(({ data }) => {
      if (cancelled) return;
      setGroups(data.groups || []);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError("טעינת ההערות נכשלה");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [schoolId, meetingId]);

  useEffect(() => {
    if (highlightNoteId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightNoteId, groups]);

  const authorColorMap = buildAuthorColorMap(groups);

  async function saveNewRecord() {
    const content = (newRecordText || "").trim();
    setNewRecordText(null);
    if (!content) return;
    setError("");
    try {
      const { data } = await axios.post(`/schools/${schoolId}/meetings/${meetingId}/notes`, { content });
      const segment = {
        id: data.id, author_id: data.author_id, author_name: currentUser?.full_name, author_role: currentUser?.role,
        content: data.content, created_at: data.created_at, updated_at: data.updated_at,
      };
      setGroups(prev => [{ group_id: data.group_id, segments: [segment] }, ...prev]);
    } catch {
      setError("שמירת ההערה נכשלה — נסה שוב");
    }
  }

  async function saveEdit(segmentId, groupId, text) {
    const content = (text || "").trim();
    setEditDraft(null);
    if (!content) return;
    setError("");
    try {
      await axios.patch(`/schools/${schoolId}/meetings/${meetingId}/notes/segments/${segmentId}`, { content });
      setGroups(prev => prev.map(g => g.group_id !== groupId ? g : {
        ...g, segments: g.segments.map(s => s.id === segmentId ? { ...s, content } : s),
      }));
    } catch {
      setError("עריכת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    }
  }

  async function handleDelete(groupId, segmentId) {
    setError("");
    try {
      await axios.delete(`/schools/${schoolId}/meetings/${meetingId}/notes/segments/${segmentId}`);
      setGroups(prev => prev
        .map(g => g.group_id !== groupId ? g : { ...g, segments: g.segments.filter(s => s.id !== segmentId) })
        .filter(g => g.segments.length > 0));
    } catch {
      setError("מחיקת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    }
  }

  // Clicking the X: own note deletes immediately (as before); someone else's note (owner/manager
  // only — see isDeletable below) instead opens a confirmation naming the original author, since
  // this is a cross-user destructive action.
  function requestDelete(groupId, seg) {
    if (isOwnSegment(currentUser, seg)) {
      handleDelete(groupId, seg.id);
    } else {
      setDeleteConfirm({ groupId, segmentId: seg.id, authorName: seg.author_name || "משתמש" });
    }
  }

  function confirmDeleteNow() {
    if (!deleteConfirm) return;
    const { groupId, segmentId } = deleteConfirm;
    setDeleteConfirm(null);
    handleDelete(groupId, segmentId);
  }

  useEffect(() => {
    if (pos === null) {
      const cascade = (id % CASCADE_CYCLE) * CASCADE_STEP;
      const x = Math.max(16, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2) + cascade);
      const y = Math.max(16, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 3) + cascade);
      setPos({ x, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(e) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  }
  function onDrag(e) {
    const d = dragRef.current;
    if (!d) return;
    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 60;
    setPos({
      x: Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), maxX),
      y: Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), maxY),
    });
  }
  function stopDrag() {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
  }

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }
  function onResize(e) {
    const r = resizeRef.current;
    if (!r) return;
    setSize({
      width: Math.max(MIN_WIDTH, r.origW + (e.clientX - r.startX)),
      height: Math.max(MIN_HEIGHT, r.origH + (e.clientY - r.startY)),
    });
  }
  function stopResize() {
    resizeRef.current = null;
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  if (!pos) return null;

  const title = windowTitle(win);

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(id, false)}
        dir="rtl"
        aria-label={`שחזור חלון ${title}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <span aria-hidden="true">📝</span>
        <span className="truncate">{title}</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={title}
      dir="rtl"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60 }}
      className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      <div
        onMouseDown={startDrag}
        className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0"
        style={{ background: "rgba(241,245,249,0.97)", gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => closeMeetingNotes(id)} aria-label="סגור חלון הערות"
            className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => setMinimized(id, true)}
            aria-label="מזער חלון הערות" className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19"/>
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800 truncate text-center">{title}</div>
        <div aria-hidden="true" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3">
        <button type="button" onClick={() => setNewRecordText("")} className="btn-blue text-sm px-4 py-2 self-start flex-shrink-0">
          + הוספת הערה
        </button>

        {error && <div role="alert" className="text-xs text-red-600 flex-shrink-0">{error}</div>}
        {loadError && <div role="alert" className="text-xs text-red-600 flex-shrink-0">{loadError}</div>}
        {loading && <div role="status" aria-label="טוען הערות" className="text-xs text-slate-400 text-center py-4 flex-shrink-0">טוען…</div>}

        {/* Rendered as an ARIA grid rather than a literal <table>, so the "new entry" row can
            grow with flexbox to fill the window down to its bottom edge — a real <table> row
            can't be given flex-grow. The composer row's content cell then stretches with it
            (MentionTextarea's `fill` prop), so a long note stays fully visible while typing
            instead of being clipped to 2-3 lines; existing notes below become scrollable. */}
        {!loading && (
          <div role="table" aria-label="הערות פגישה" dir="rtl" className="flex-1 min-h-0 flex flex-col">
            <div role="row" className="grid text-xs font-700 text-slate-500 px-2 py-2 border-b border-slate-200 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
              <span role="columnheader">תאריך</span>
              <span role="columnheader">משתמש</span>
              <span role="columnheader">תוכן</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {newRecordText !== null && (
                <div role="row" className="grid border-t border-slate-100"
                  style={{ gridTemplateColumns: NOTE_COLS, flex: "1 1 auto", minHeight: "140px" }}>
                  <div role="cell" className="px-2 py-2 text-xs text-slate-400">עכשיו</div>
                  <div role="cell" className="px-2 py-2 text-xs text-slate-700">{currentUser?.full_name}</div>
                  <div role="cell" className="px-2 py-2 flex flex-col min-h-0">
                    <label htmlFor="meeting-new-note-text" className="sr-only">תוכן הערה חדשה</label>
                    <MentionTextarea
                      id="meeting-new-note-text"
                      value={newRecordText}
                      onChange={setNewRecordText}
                      onBlur={saveNewRecord}
                      users={mentionUsers}
                      autoFocus
                      fill
                      placeholder="הכנס הערה כאן... השתמש ב-@ לתיוג משתמש"
                    />
                  </div>
                </div>
              )}
              {groups.length === 0 && newRecordText === null && (
                <div role="row" className="grid flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
                  <div role="cell" className="px-2 py-6 text-center text-xs text-slate-400" style={{ gridColumn: "1 / -1" }}>
                    אין עדיין הערות לפגישה זו
                  </div>
                </div>
              )}
              {groups.map(group => (
                <div role="row" key={group.group_id} className="grid border-t border-slate-100 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
                  <div role="cell" className="px-2 py-2">
                    {group.segments.map(seg => (
                      <div key={seg.id} ref={seg.id === highlightNoteId ? highlightRowRef : undefined}
                        className="text-xs px-1.5 py-1 rounded mb-1"
                        style={{
                          background: authorColorMap[seg.author_id]?.bg,
                          color: authorColorMap[seg.author_id]?.text,
                          outline: seg.id === highlightNoteId ? "2px solid #0070F3" : "none",
                        }}>
                        {formatUpdateDate(seg.created_at)}
                      </div>
                    ))}
                  </div>
                  <div role="cell" className="px-2 py-2">
                    {group.segments.map(seg => (
                      <div key={seg.id} className="text-xs px-1.5 py-1 rounded mb-1"
                        style={{ background: authorColorMap[seg.author_id]?.bg, color: authorColorMap[seg.author_id]?.text }}>
                        {seg.author_name || "—"}
                      </div>
                    ))}
                  </div>
                  <div role="cell" className="px-2 py-2">
                    {group.segments.map(seg => {
                      const editable = isOwnSegment(currentUser, seg);
                      const isEditing = editDraft?.segmentId === seg.id;
                      const color = authorColorMap[seg.author_id];
                      return (
                        <div key={seg.id}
                          className="text-xs px-1.5 py-1 rounded mb-1 flex items-start justify-between gap-2"
                          style={{
                            background: color?.bg, color: color?.text,
                            outline: seg.id === highlightNoteId ? "2px solid #0070F3" : "none",
                          }}
                          onClick={() => {
                            if (!editable || isEditing) return;
                            setEditDraft({ segmentId: seg.id, groupId: group.group_id, text: seg.content });
                          }}>
                          {isEditing ? (
                            <>
                              <label htmlFor={`meeting-edit-note-${seg.id}`} className="sr-only">עריכת תוכן ההערה</label>
                              <MentionTextarea
                                id={`meeting-edit-note-${seg.id}`}
                                value={editDraft.text}
                                onChange={text => setEditDraft(d => ({ ...d, text }))}
                                onBlur={() => saveEdit(seg.id, group.group_id, editDraft.text)}
                                users={mentionUsers}
                                rows={2}
                                autoFocus
                              />
                            </>
                          ) : (
                            <span className="flex-1" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{seg.content}</span>
                          )}
                          {(isOwnSegment(currentUser, seg) || currentUser?.role === "owner" || currentUser?.role === "manager") && !isEditing && (
                            <button type="button" aria-label="מחק הערה זו" className="text-slate-400 hover:text-red-600 text-xs flex-shrink-0"
                              onClick={e => { e.stopPropagation(); requestDelete(group.group_id, seg); }}>
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        onMouseDown={startResize}
        aria-hidden="true"
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        style={{ touchAction: "none" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {deleteConfirm && (
        <DeleteConfirmDialog
          authorName={deleteConfirm.authorName}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmDeleteNow}
        />
      )}
    </div>
  );
}

// A separate component (not inline JSX) so useFocusTrap's mount-time auto-focus effect fires
// fresh every time this specific confirmation opens — it wouldn't if the hook were called at
// the top of MeetingNotesWindowItem, which stays mounted the whole time the window is open.
function DeleteConfirmDialog({ authorName, onCancel, onConfirm }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm" style={{ zIndex: 70 }} dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="delete-note-confirm-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl p-6 w-[360px] flex flex-col gap-4">
        <h2 id="delete-note-confirm-title" className="text-base font-bold text-slate-800 text-center">שים לב!</h2>
        <p className="text-sm text-slate-600 text-center leading-relaxed">
          אתה עומד למחוק את ההערה של <strong>{authorName}</strong>. האם אתה בטוח שאתה רוצה למחוק את ההערה?
        </p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onCancel}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול הפעולה
          </button>
          <button type="button" onClick={onConfirm}
            className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            מחק בכל זאת
          </button>
        </div>
      </div>
    </div>
  );
}
