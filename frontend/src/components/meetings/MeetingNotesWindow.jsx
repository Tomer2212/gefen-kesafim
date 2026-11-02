import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useMeetingNotes } from "../../context/MeetingNotesContext";
import { formatUpdateDate, buildAuthorColorMap } from "../SchoolNotesModal";
import { RichNoteView, plainTextToHtml } from "./RichNoteView";
import { draftKey, writeDraft, removeDraft, findDrafts } from "./meetingNoteDrafts";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 340;
const DEFAULT_WIDTH_RATIO = 0.7;
const DEFAULT_HEIGHT_RATIO = 0.88;
const EDITOR_HEIGHT_RATIO = 0.8;
const MIN_EDITOR_HEIGHT = 220;
const MAXIMIZED_MARGIN = 8;
const DRAFT_WRITE_DELAY = 400;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;
const NOTE_COLS = "72px 84px 1fr";

// Window resize grips on all four edges and corners (like a desktop window). Inset by the window
// border since the window clips its overflow; corners sit above the edges.
const RESIZE_GRIPS = [
  { dir: "n", cursor: "ns-resize", style: { top: 0, left: 14, right: 14, height: 6 } },
  { dir: "s", cursor: "ns-resize", style: { bottom: 0, left: 14, right: 14, height: 6 } },
  { dir: "e", cursor: "ew-resize", style: { right: 0, top: 14, bottom: 14, width: 6 } },
  { dir: "w", cursor: "ew-resize", style: { left: 0, top: 14, bottom: 14, width: 6 } },
  { dir: "ne", cursor: "nesw-resize", style: { top: 0, right: 0, width: 14, height: 14 } },
  { dir: "nw", cursor: "nwse-resize", style: { top: 0, left: 0, width: 14, height: 14 } },
  { dir: "se", cursor: "nwse-resize", style: { bottom: 0, right: 0, width: 14, height: 14 } },
  { dir: "sw", cursor: "nesw-resize", style: { bottom: 0, left: 0, width: 14, height: 14 } },
];

// TipTap/ProseMirror is large and this window is mounted app-wide (App.jsx) — load the editor
// only when a notes window opens (prefetched below, so "+ הוספת הערה" doesn't wait on it).
const loadRichNoteEditor = () => import("./RichNoteEditor");
const RichNoteEditor = lazy(() => loadRichNoteEditor().then(m => ({ default: m.RichNoteEditor })));

function EditorFallback({ height }) {
  return (
    <div role="status" aria-label="טוען עורך" className="rounded-[0.6rem] border-[1.5px] border-slate-200 bg-white/80"
      style={{ height }} />
  );
}

// This window is mounted app-wide, so an editor failure (e.g. a stale tab requesting a lazy chunk
// that a newer deploy replaced) must stay inside the editor slot instead of unmounting the app.
class EditorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error("RichNoteEditor failed:", err); }
  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
          טעינת עורך ההערות נכשלה — רענן את הדף ונסה שוב
        </div>
      );
    }
    return this.props.children;
  }
}

// Meeting notes are strictly self-edit/self-delete — unlike SchoolNotesModal's
// canEditSegment/canDeleteSegment (which let a higher role edit/delete another user's note),
// every user here can only touch their own note; everyone else's is view-only to them.
function isOwnSegment(currentUser, seg) {
  return !!currentUser?.id && seg.author_id === currentUser.id;
}

// Opens large (relative to the viewport) so users don't have to resize it every time.
function defaultSize() {
  return {
    width: Math.max(MIN_WIDTH, Math.round(window.innerWidth * DEFAULT_WIDTH_RATIO)),
    height: Math.max(MIN_HEIGHT, Math.round(window.innerHeight * DEFAULT_HEIGHT_RATIO)),
  };
}

function windowTitle(w) {
  const parts = [w.schoolName, w.schoolAuthority].filter(Boolean).join(", ");
  const symbol = w.schoolSymbol ? ` - ${w.schoolSymbol}` : "";
  return `הערות פגישה${parts ? " - " + parts : ""}${symbol}`;
}

function formatTime(d) {
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatDraftDate(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} ${formatTime(d)}`;
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

// Editing model (explicit save, like Word): one note at a time is open in the editor —
// `editing` = { key, origin: "new" | "edit", segmentId, groupId, initialHtml, html, text, dirty,
// saving, savedAt, error }. Nothing is saved on blur, so switching apps / minimizing keeps the
// caret where it was. Saving: footer "שמור" (save + close), toolbar save / Ctrl+S (save + keep
// editing). Leaving with unsaved changes (cancel, Esc, another note, "+ הוספת הערה", closing the
// window) asks first. A new note keeps editing in the composer row after its first save
// (POST, then PATCHes) — its list row is hidden meanwhile so it isn't shown twice.
function MeetingNotesWindowItem({ win, minimizedOrder }) {
  const { id, meetingId, schoolId, minimized, highlightNoteId } = win;
  const { closeMeetingNotes, setMinimized } = useMeetingNotes();
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState(defaultSize);
  const [currentUser, setCurrentUser] = useState(null);
  const [mentionUsers, setMentionUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState(null); // { action } — the leave action waiting on the answer
  const [drafts, setDrafts] = useState([]);
  const [listHeight, setListHeight] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { groupId, segmentId, authorName } — cross-user delete by owner/manager only
  const [error, setError] = useState("");
  const editingRef = useRef(null);
  editingRef.current = editing;
  const changeSeqRef = useRef(0);
  const draftTimerRef = useRef(null);
  const editorRef = useRef(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const maximizedRef = useRef(null); // bounds before a title-bar double-click maximize
  const highlightRowRef = useRef(null);

  useEffect(() => { loadRichNoteEditor().catch(() => {}); }, []);

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

  // Unsaved backups left by a crash / closed tab, offered once the notes are loaded.
  useEffect(() => {
    if (loading || !currentUser?.id) return;
    setDrafts(findDrafts(currentUser.id, meetingId));
  }, [loading, currentUser?.id, meetingId]);

  useEffect(() => {
    if (highlightNoteId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightNoteId, groups]);

  // The note being edited takes ~80% of the notes area (all of it when it's the only row) and
  // follows the window as it's resized.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    setListHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [loading]);

  // Bring the note just opened for editing to the top of the list.
  useEffect(() => {
    if (!editing || !listRef.current) return;
    const row = listRef.current.querySelector("[data-editing-row]");
    if (row) listRef.current.scrollTop = Math.max(0, row.offsetTop - 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.key]);

  // Un-minimizing: put the caret back exactly where it was.
  useEffect(() => {
    if (!minimized && editingRef.current) setTimeout(() => editorRef.current?.commands.focus(), 0);
  }, [minimized]);

  // Leaving / reloading the page with unsaved changes: let the browser ask first.
  const dirty = !!editing?.dirty;
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => clearTimeout(draftTimerRef.current), []);

  const authorColorMap = buildAuthorColorMap(groups);

  function patchEditing(changes) {
    setEditing(prev => (prev ? { ...prev, ...changes } : prev));
  }

  function keyFor(segmentId) {
    return currentUser?.id ? draftKey(currentUser.id, meetingId, segmentId) : null;
  }

  function openEditor({ origin, segmentId = null, groupId = null, html = "", text = "", dirty: startDirty = false }) {
    clearTimeout(draftTimerRef.current);
    changeSeqRef.current = 0;
    editorRef.current = null;
    setError("");
    setEditing({
      key: `${origin}-${segmentId || "new"}-${Date.now()}`, origin, segmentId, groupId,
      initialHtml: html, html, text, dirty: startDirty, saving: false, savedAt: null, error: "",
    });
  }

  function closeEditor() {
    clearTimeout(draftTimerRef.current);
    editorRef.current = null;
    setEditing(null);
  }

  // Runs `action` (or just closes the editor when null), asking to save first if needed.
  function requestLeave(action) {
    const e = editingRef.current;
    // A new note that was never saved and has no text left has nothing worth asking about.
    const emptyNew = e && !e.segmentId && !(e.text || "").trim();
    if (e?.dirty && !emptyNew) {
      setUnsavedPrompt({ action });
      return;
    }
    if (e) closeEditor();
    action?.();
  }

  function handleEditorChange({ html, text }) {
    changeSeqRef.current += 1;
    setEditing(prev => (prev ? { ...prev, html, text, dirty: true } : prev));
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const e = editingRef.current;
      const key = e && keyFor(e.segmentId);
      if (key && e.dirty) writeDraft(key, { html: e.html, text: e.text });
    }, DRAFT_WRITE_DELAY);
  }

  // `content` is the plain-text version (mentions/notifications/activity log); `content_html`
  // carries the formatting — see RichNoteEditor. Returns true when nothing is left unsaved.
  async function save({ close = false } = {}) {
    const e = editingRef.current;
    if (!e || e.saving) return false;
    if (!e.dirty) {
      if (close) closeEditor();
      return true;
    }
    const content = (e.text || "").trim();
    if (!content) {
      patchEditing({ error: e.segmentId ? "לא ניתן לשמור הערה ריקה — למחיקת ההערה השתמשו ב-✕" : "לא ניתן לשמור הערה ריקה" });
      return false;
    }
    const seq = changeSeqRef.current;
    patchEditing({ saving: true, error: "" });
    try {
      let saved = {};
      if (!e.segmentId) {
        const { data } = await axios.post(`/schools/${schoolId}/meetings/${meetingId}/notes`, { content, content_html: e.html || null });
        const segment = {
          id: data.id, author_id: data.author_id, author_name: currentUser?.full_name, author_role: currentUser?.role,
          content: data.content, content_html: data.content_html, created_at: data.created_at, updated_at: data.updated_at,
        };
        setGroups(prev => [{ group_id: data.group_id, segments: [segment] }, ...prev]);
        const newKey = keyFor(null);
        if (newKey) removeDraft(newKey);
        saved = { segmentId: data.id, groupId: data.group_id };
      } else {
        const { data } = await axios.patch(`/schools/${schoolId}/meetings/${meetingId}/notes/segments/${e.segmentId}`, { content, content_html: e.html || null });
        setGroups(prev => prev.map(g => g.group_id !== e.groupId ? g : {
          ...g, segments: g.segments.map(s => s.id === e.segmentId ? { ...s, content, content_html: data?.content_html ?? null } : s),
        }));
      }
      // Typing that happened while the request was in flight is still unsaved.
      const stillDirty = changeSeqRef.current !== seq;
      if (!stillDirty) {
        clearTimeout(draftTimerRef.current);
        const key = keyFor(saved.segmentId || e.segmentId);
        if (key) removeDraft(key);
      }
      patchEditing({ ...saved, saving: false, dirty: stillDirty, savedAt: new Date(), error: "" });
      if (close && !stillDirty) closeEditor();
      return !stillDirty;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      patchEditing({ saving: false, error: `${typeof detail === "string" ? detail : "השמירה נכשלה"} — התוכן לא נמחק, נסו לשמור שוב` });
      return false;
    }
  }

  async function promptSave() {
    const pending = unsavedPrompt;
    setUnsavedPrompt(null);
    const ok = await save();
    if (ok) {
      closeEditor();
      pending?.action?.();
    } else {
      setTimeout(() => editorRef.current?.commands.focus(), 0);
    }
  }

  function promptDiscard() {
    const pending = unsavedPrompt;
    setUnsavedPrompt(null);
    const e = editingRef.current;
    const key = e && keyFor(e.segmentId);
    if (key) removeDraft(key);
    closeEditor();
    pending?.action?.();
  }

  function promptBackToEditing() {
    setUnsavedPrompt(null);
    setTimeout(() => editorRef.current?.commands.focus(), 0);
  }

  function startNewNote() {
    if (editingRef.current?.origin === "new") {
      editorRef.current?.commands.focus();
      return;
    }
    requestLeave(() => openEditor({ origin: "new" }));
  }

  function startEditNote(seg, groupId) {
    requestLeave(() => openEditor({
      origin: "edit", segmentId: seg.id, groupId,
      html: seg.content_html || plainTextToHtml(seg.content), text: seg.content,
    }));
  }

  function restoreDraft(draft) {
    requestLeave(() => {
      const seg = draft.segmentId && groups.flatMap(g => g.segments.map(s => ({ ...s, groupId: g.group_id })))
        .find(s => s.id === draft.segmentId);
      // A draft of a note that has since been deleted comes back as a new note.
      const target = seg && isOwnSegment(currentUser, seg)
        ? { origin: "edit", segmentId: seg.id, groupId: seg.groupId }
        : { origin: "new" };
      removeDraft(draft.key);
      const key = keyFor(target.segmentId);
      if (key) writeDraft(key, draft);
      openEditor({ ...target, html: draft.html, text: draft.text, dirty: true });
      setDrafts(prev => prev.filter(d => d.key !== draft.key));
    });
  }

  function discardDraft(draft) {
    removeDraft(draft.key);
    setDrafts(prev => prev.filter(d => d.key !== draft.key));
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
      const x = Math.max(16, Math.round((window.innerWidth - size.width) / 2) + cascade);
      const y = Math.max(16, Math.round((window.innerHeight - size.height) / 3) + cascade);
      setPos({ x, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest("button")) return;
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

  // Resizing from any edge / corner; the opposite edge stays put, and the window never grows
  // past the viewport or shrinks below its minimum.
  function startResize(e, grip) {
    e.preventDefault();
    e.stopPropagation();
    maximizedRef.current = null;
    resizeRef.current = { dir: grip.dir, startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y, w: size.width, h: size.height };
    document.body.style.cursor = grip.cursor;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }
  function onResize(e) {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    const west = r.dir.includes("w");
    const north = r.dir.includes("n");
    let w = r.w;
    let h = r.h;
    if (r.dir.includes("e")) w = r.w + dx;
    if (west) w = r.w - dx;
    if (r.dir.includes("s")) h = r.h + dy;
    if (north) h = r.h - dy;
    const maxW = west ? r.x + r.w : window.innerWidth - r.x;
    const maxH = north ? r.y + r.h : window.innerHeight - r.y;
    w = Math.min(Math.max(MIN_WIDTH, w), Math.max(MIN_WIDTH, maxW));
    h = Math.min(Math.max(MIN_HEIGHT, h), Math.max(MIN_HEIGHT, maxH));
    setSize({ width: w, height: h });
    setPos({ x: west ? r.x + r.w - w : r.x, y: north ? r.y + r.h - h : r.y });
  }
  function stopResize() {
    resizeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }

  // Double-click on the title bar: (almost) full screen, and back to the previous bounds.
  function toggleMaximize(e) {
    if (e.target.closest("button")) return;
    if (maximizedRef.current) {
      const prev = maximizedRef.current;
      maximizedRef.current = null;
      setPos(prev.pos);
      setSize(prev.size);
      return;
    }
    maximizedRef.current = { pos, size };
    setPos({ x: MAXIMIZED_MARGIN, y: MAXIMIZED_MARGIN });
    setSize({ width: window.innerWidth - MAXIMIZED_MARGIN * 2, height: window.innerHeight - MAXIMIZED_MARGIN * 2 });
  }

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pos) return null;

  const title = windowTitle(win);
  const editingNewId = editing?.origin === "new" ? editing.segmentId : null;
  const visibleGroups = groups
    .map(g => ({ ...g, segments: g.segments.filter(s => s.id !== editingNewId) }))
    .filter(g => g.segments.length > 0);
  const editorHeight = Math.max(MIN_EDITOR_HEIGHT, Math.round(
    editing?.origin === "new" && visibleGroups.length === 0 ? listHeight - 20 : listHeight * EDITOR_HEIGHT_RATIO,
  ));

  function renderEditor(ariaLabel, editorId) {
    return (
      <EditorBoundary><Suspense fallback={<EditorFallback height={editorHeight} />}>
        <RichNoteEditor
          key={editing.key}
          id={editorId}
          ariaLabel={ariaLabel}
          value={editing.initialHtml}
          onChange={handleEditorChange}
          onSave={() => save()}
          onEscape={() => requestLeave(null)}
          canSave={editing.dirty && !editing.saving}
          onReady={ed => {
            editorRef.current = ed;
            // Re-assert focus after mount: closing the "save changes?" dialog in the same render
            // hands focus back to whatever had it before the dialog (useFocusTrap), which would
            // otherwise steal it from the note that just opened.
            setTimeout(() => { if (editorRef.current === ed && !ed.isDestroyed) ed.commands.focus("end"); }, 0);
          }}
          users={mentionUsers}
          autoFocus
          height={editorHeight}
          placeholder="הכנס הערה כאן... השתמש ב-@ לתיוג משתמש"
          footer={<EditorFooter editing={editing} onSave={() => save({ close: true })} onCancel={() => requestLeave(null)} />}
        />
      </Suspense></EditorBoundary>
    );
  }

  return (
    <>
      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(id, false)}
          dir="rtl"
          aria-label={`שחזור חלון ${title}`}
          style={{ position: "fixed", left: 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP), bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
          className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
        >
          <span aria-hidden="true">📝</span>
          <span className="truncate">{title}</span>
          {dirty && <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="יש שינויים שלא נשמרו" aria-label="יש שינויים שלא נשמרו" />}
        </button>
      )}

      {/* Minimizing only hides the window — it stays mounted, so a note being edited keeps its
          content, undo history and caret position. */}
      {/* tabIndex=-1: a click on an empty part of the window keeps focus inside it, so Ctrl+S
          still saves the open note instead of opening the browser's "save page" dialog. */}
      <div
        role="region"
        aria-label={title}
        aria-hidden={minimized || undefined}
        dir="rtl"
        tabIndex={-1}
        onKeyDown={e => {
          if (editingRef.current && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s" && !e.defaultPrevented) {
            e.preventDefault();
            save();
          }
        }}
        style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60, display: minimized ? "none" : undefined }}
        className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden outline-none"
      >
        <div
          onMouseDown={startDrag}
          onDoubleClick={toggleMaximize}
          title="גרירה להזזה · לחיצה כפולה להגדלה / החזרה לגודל הקודם"
          className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0"
          style={{ background: "rgba(241,245,249,0.97)", gridTemplateColumns: "1fr auto 1fr" }}
        >
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => requestLeave(() => closeMeetingNotes(id))} aria-label="סגור חלון הערות"
              className="text-slate-400 hover:text-slate-700 transition-colors">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <button type="button" onClick={() => setMinimized(id, true)}
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
          <button type="button" onClick={startNewNote} className="btn-blue text-sm px-4 py-2 self-start flex-shrink-0">
            + הוספת הערה
          </button>

          {drafts[0] && (
            <div role="alert" className="flex-shrink-0 flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0">
                נמצאה טיוטה שלא נשמרה ({drafts[0].segmentId ? "עריכת הערה" : "הערה חדשה"}, {formatDraftDate(drafts[0].at)}):
                {" "}<span className="text-amber-700">"{drafts[0].text.trim().slice(0, 60)}{drafts[0].text.trim().length > 60 ? "…" : ""}"</span>
              </span>
              <button type="button" onClick={() => restoreDraft(drafts[0])} className="btn-blue text-xs px-3 py-1">שחזור הטיוטה</button>
              <button type="button" onClick={() => discardDraft(drafts[0])}
                className="text-xs px-3 py-1 rounded-full border border-amber-300 hover:bg-amber-100">מחיקת הטיוטה</button>
            </div>
          )}

          {error && <div role="alert" className="text-xs text-red-600 flex-shrink-0">{error}</div>}
          {loadError && <div role="alert" className="text-xs text-red-600 flex-shrink-0">{loadError}</div>}
          {loading && <div role="status" aria-label="טוען הערות" className="text-xs text-slate-400 text-center py-4 flex-shrink-0">טוען…</div>}

          {/* Rendered as an ARIA grid rather than a literal <table>, so rows can be laid out with
              flexbox inside one scroll area; the note being edited is sized from that area's
              height (EDITOR_HEIGHT_RATIO) and the other notes scroll below it. */}
          {!loading && (
            <div role="table" aria-label="הערות פגישה" dir="rtl" className="flex-1 min-h-0 flex flex-col">
              <div role="row" className="grid text-xs font-700 text-slate-500 px-2 py-2 border-b border-slate-200 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
                <span role="columnheader">תאריך</span>
                <span role="columnheader">משתמש</span>
                <span role="columnheader">תוכן</span>
              </div>

              <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col relative">
                {editing?.origin === "new" && (
                  <div role="row" data-editing-row="" className="grid border-t border-slate-100 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
                    <div role="cell" className="px-2 py-2 text-xs text-slate-400">{editing.segmentId ? formatTime(editing.savedAt || new Date()) : "עכשיו"}</div>
                    <div role="cell" className="px-2 py-2 text-xs text-slate-700">{currentUser?.full_name}</div>
                    <div role="cell" className="px-2 py-2 min-w-0">
                      {renderEditor("תוכן הערה חדשה", "meeting-new-note-text")}
                    </div>
                  </div>
                )}
                {visibleGroups.length === 0 && editing?.origin !== "new" && (
                  <div role="row" className="grid flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
                    <div role="cell" className="px-2 py-6 text-center text-xs text-slate-400" style={{ gridColumn: "1 / -1" }}>
                      אין עדיין הערות לפגישה זו
                    </div>
                  </div>
                )}
                {visibleGroups.map(group => (
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
                    <div role="cell" className="px-2 py-2 min-w-0">
                      {group.segments.map(seg => {
                        const editable = isOwnSegment(currentUser, seg);
                        const isEditing = editing?.origin === "edit" && editing.segmentId === seg.id;
                        const color = authorColorMap[seg.author_id];
                        return (
                          <div key={seg.id}
                            data-editing-row={isEditing ? "" : undefined}
                            className={`text-xs px-1.5 py-1 rounded mb-1 flex items-start justify-between gap-2 ${editable && !isEditing ? "cursor-pointer" : ""}`}
                            style={{
                              background: color?.bg, color: color?.text,
                              outline: seg.id === highlightNoteId ? "2px solid #0070F3" : "none",
                            }}
                            onClick={e => {
                              if (!editable || isEditing || e.target.closest("a")) return;
                              startEditNote(seg, group.group_id);
                            }}>
                            {isEditing ? (
                              <div className="flex-1 min-w-0">
                                {renderEditor("עריכת תוכן ההערה", `meeting-edit-note-${seg.id}`)}
                              </div>
                            ) : (
                              <RichNoteView html={seg.content_html} text={seg.content} className="flex-1 min-w-0" />
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

        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="pointer-events-none"
          style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {RESIZE_GRIPS.map(grip => (
          <div key={grip.dir} aria-hidden="true" onMouseDown={e => startResize(e, grip)}
            style={{ position: "absolute", zIndex: grip.dir.length === 2 ? 3 : 2, cursor: grip.cursor, touchAction: "none", ...grip.style }} />
        ))}

        {deleteConfirm && (
          <DeleteConfirmDialog
            authorName={deleteConfirm.authorName}
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={confirmDeleteNow}
          />
        )}
        {unsavedPrompt && (
          <UnsavedChangesDialog onSave={promptSave} onDiscard={promptDiscard} onCancel={promptBackToEditing} />
        )}
      </div>
    </>
  );
}

function EditorFooter({ editing, onSave, onCancel }) {
  const { saving, dirty, savedAt, error } = editing;
  let status = null;
  if (error) {
    status = <span role="alert" className="text-red-600">{error}</span>;
  } else if (saving) {
    status = <span className="text-slate-500">שומר…</span>;
  } else if (dirty) {
    status = (
      <span className="text-amber-700 flex items-center gap-1.5">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-amber-500" />יש שינויים שלא נשמרו
      </span>
    );
  } else if (savedAt) {
    status = <span className="text-emerald-700">✓ נשמר ב-{formatTime(savedAt)}</span>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={onSave} disabled={saving} className="btn-blue text-xs px-4 py-1.5 disabled:opacity-60">
        {saving ? "שומר…" : "שמור"}
      </button>
      <button type="button" onClick={onCancel}
        className="text-xs px-3 py-1.5 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 font-semibold transition-colors">
        {dirty ? "ביטול" : "סגירה"}
      </button>
      <div className="text-[11px] min-w-0 flex-1" aria-live="polite">{status}</div>
    </div>
  );
}

// Word/Excel-style "save changes?" prompt — Esc / backdrop = back to editing (nothing is lost).
function UnsavedChangesDialog({ onSave, onDiscard, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm" style={{ zIndex: 70 }} dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="unsaved-note-title" aria-describedby="unsaved-note-desc"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl p-6 w-[380px] flex flex-col gap-4">
        <h2 id="unsaved-note-title" className="text-base font-bold text-slate-800 text-center">לשמור את השינויים?</h2>
        <p id="unsaved-note-desc" className="text-sm text-slate-600 text-center leading-relaxed">
          בהערה יש שינויים שעדיין לא נשמרו. אם לא תשמור — הם יימחקו.
        </p>
        <div className="flex gap-2 justify-center mt-1 flex-wrap">
          <button type="button" onClick={onSave} className="btn-blue text-sm px-5 py-2">שמור</button>
          <button type="button" onClick={onDiscard}
            className="px-4 py-2 rounded-full border border-red-300 hover:bg-red-50 text-red-600 text-sm font-semibold transition-colors">
            אל תשמור
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            חזרה לעריכה
          </button>
        </div>
      </div>
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
