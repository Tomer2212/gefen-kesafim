// "סגירת שנה" tab (SchoolPage) — two separate glass-cards, stacked vertically:
// 1. "תוכנת הכספים": closure status + notes toward parents and toward the authority, per
//    school+academic_year. Backed by the same school_year_admin_data row as the admin
//    schools table's other fields (yearAdminData/saveYearAdminField, owned by SchoolPage).
// 2. "מערכת גפן": one section per (division, budget) combo that has at least one check in
//    this academic year (sourced from check_metrics via GET /{school_id}/gefen-closures),
//    backed by gefen_year_closures (gefenClosures/saveGefenClosure, owned by SchoolPage).
//    The "גפן" budget always has a default section per division of the school's stage (one
//    untitled-division "general" section when the stage is empty/other), so it can be closed
//    before any check — the endpoint decides the list; this tab only renders it.
//
// The two cards are deliberately separate elements (not one shared grid) so each card's
// white/glass background ends exactly at its own content, and the gap between them shows
// the page's regular background (.bg-scene) rather than white bleeding downward. Contrast
// against that background comes from each card's own bold border, not a darker backdrop.
//
// Every notes area (parents, authority, each Gefen combo) is a list of signed notes
// (date · user · content) from year_closure_notes, loaded once per school+year by this tab
// (GET /{school_id}/year-closure-notes) — modeled on the meeting-notes window: the same
// RichNoteEditor (full toolbar + @-mentions, which notify the tagged user server-side) and the
// same explicit-save model — one note open at a time across the whole tab, saved by "שמור" /
// Ctrl+S, never on blur; leaving it with unsaved changes asks first, and ✕ asks before deleting.
// `content` stays the plain text (the summary columns read it), `content_html` the formatting.
// Every user may edit/delete only their own notes; a legacy note with no known author
// (migrated from the old free-text fields) is deletable by the owner only.
//
// Both groups' "סגור"/"לא סגור" toggles are disabled outside the academic year's closure
// window (isClosureWindowOpen) — a guard against the common mistake of closing the wrong
// year while viewing a different one — with a tooltip explaining why. The notes are never
// disabled by the date window.
//
// Each card is built as a CSS Grid (ARIA table roles, not a native <table>) rather than real
// table markup — a native table's row-height-distribution algorithm doesn't reliably stretch
// a single body row to fill extra table height across browsers, which is exactly what's
// needed here so the notes textareas can fill the card down to the bottom. A grid row sized
// with `1fr` gets a definite height from grid layout itself, which percentage/h-full children
// resolve against consistently. Every cell is placed with an explicit gridColumn/gridRow line
// number (rather than relying on grid auto-placement) since columns must interleave by
// position, not fill row-by-row in source order.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { isClosureWindowOpen } from "../constants/academicYears";
import { formatUpdateDate, buildAuthorColorMap } from "./SchoolNotesModal";
import { RichNoteView, plainTextToHtml } from "./meetings/RichNoteView";
import { EditorBoundary, EditorFooter, UnsavedChangesDialog, DeleteConfirmDialog } from "./meetings/noteDialogs";
import { useMentionUsers } from "./meetings/mentionAccess";
import { closureDraftKey, writeDraft, removeDraft, findClosureDrafts } from "./meetings/meetingNoteDrafts";

const NOTE_COLS = "92px 96px 1fr";
const UNKNOWN_AUTHOR = "הערה קודמת – משתמש לא ידוע";
const EDITOR_HEIGHT = 240;
const DRAFT_WRITE_DELAY = 400;

// TipTap is large — loaded only when the tab is opened (prefetched on mount below).
const loadRichNoteEditor = () => import("./meetings/RichNoteEditor");
const RichNoteEditor = lazy(() => loadRichNoteEditor().then(m => ({ default: m.RichNoteEditor })));

function noteAreaKey(scope, divisionType, budgetName) {
  return scope === "gefen" ? `gefen::${divisionType}::${budgetName}` : scope;
}

function canEditNote(currentUser, note) {
  return !!currentUser?.id && note.author_id === currentUser.id;
}

function canDeleteNote(currentUser, note) {
  if (!currentUser?.id) return false;
  return note.author_id ? note.author_id === currentUser.id : currentUser.role === "owner";
}

const CLOSURE_WINDOW_TOOLTIP =
  'לא ניתן לעדכן סגירת שנה עבור שנת הלימודים הנוכחית כעת — עדכון סגירת שנה אפשרי רק בין 1 ביוני ל-31 בדצמבר של השנה שבה שנת הלימודים מסתיימת.';

// Small fixed-position tooltip rendered via a portal into <body>, positioned from the
// anchor element's own bounding rect — a plain `position: absolute` child gets silently
// clipped by the card's `overflow-hidden`, which is exactly what this avoids.
function DisabledWindowTooltip({ anchorRef }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div
      role="tooltip"
      dir="rtl"
      className="fixed z-[9999] bg-amber-300 text-slate-900 border border-amber-400 rounded-lg shadow-lg px-3 py-2 text-xs font-semibold"
      style={{ top: pos.top, right: pos.right, width: "max-content", maxWidth: 280 }}
    >
      {CLOSURE_WINDOW_TOOLTIP}
    </div>,
    document.body
  );
}

function ClosureStatusToggle({ label, value, onChange, disabled, windowClosed }) {
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef(null);
  const noClass = value === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  const yesClass = value === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  return (
    <div
      ref={anchorRef}
      role="group"
      aria-label={label}
      className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      style={{ direction: "ltr" }}
      onMouseEnter={() => windowClosed && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => onChange(value === false ? null : false)}
        aria-pressed={value === false}
        className={`px-3 py-1.5 transition-colors focus:outline-none ${noClass}`}
      >לא סגור</button>
      <button
        type="button"
        onClick={() => onChange(value === true ? null : true)}
        aria-pressed={value === true}
        className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${yesClass}`}
      >סגור</button>
      {hovered && <DisabledWindowTooltip anchorRef={anchorRef} />}
    </div>
  );
}

// One notes area: a "new note" row (opened by clicking the area — signed with the current
// user) above the existing notes, newest first. The editing state lives in the tab, so only
// one note is open at a time across all areas; `editing` here is that note when it belongs to
// this area, else null.
function ClosureNotesList({ notesId, notesLabel, notes, currentUser, editing, renderEditor, highlightNoteId, onStartNew, onStartEdit, onRequestDelete }) {
  const colorMap = buildAuthorColorMap([{ segments: notes }]);
  const composing = editing?.origin === "new";
  // A new note keeps editing in the composer row after its first save — hide its list row meanwhile.
  const visibleNotes = composing && editing.noteId ? notes.filter(n => n.id !== editing.noteId) : notes;

  return (
    <div role="table" aria-label={notesLabel}
      className="input-field text-sm w-full h-full min-h-[120px] flex flex-col p-0 overflow-hidden">
      <div role="row" className="grid text-xs font-semibold text-slate-500 px-2 py-1.5 border-b border-slate-200 flex-shrink-0"
        style={{ gridTemplateColumns: NOTE_COLS }}>
        <span role="columnheader">תאריך</span>
        <span role="columnheader">משתמש</span>
        <span role="columnheader">תוכן</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {composing ? (
          <div role="row" className="grid border-b border-slate-100 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS }}>
            <div role="cell" className="px-2 py-2 text-xs text-slate-500">{editing.createdAt ? formatUpdateDate(editing.createdAt) : "עכשיו"}</div>
            <div role="cell" className="px-2 py-2 text-xs text-slate-700">{currentUser?.full_name || "—"}</div>
            <div role="cell" className="px-2 py-1 min-w-0">
              {renderEditor(`תוכן הערה חדשה — ${notesLabel}`, `${notesId}-new`)}
            </div>
          </div>
        ) : (
          <button type="button" onClick={onStartNew}
            className="text-right text-xs text-slate-400 hover:text-blue-600 hover:bg-slate-50 px-2 py-2 border-b border-slate-100 flex-shrink-0">
            + לחץ להוספת הערה
          </button>
        )}
        {visibleNotes.map(note => {
          const isEditing = editing?.origin === "edit" && editing.noteId === note.id;
          const editable = canEditNote(currentUser, note);
          const color = colorMap[note.author_id];
          const cellStyle = { background: color?.bg, color: color?.text };
          const highlighted = note.id === highlightNoteId;
          return (
            <div role="row" key={note.id} data-closure-note-id={note.id}
              className="grid border-b border-slate-100 flex-shrink-0" style={{ gridTemplateColumns: NOTE_COLS, outline: highlighted ? "2px solid #0070F3" : "none", outlineOffset: -2 }}>
              <div role="cell" className="px-2 py-2 text-xs" style={cellStyle}>{formatUpdateDate(note.created_at)}</div>
              <div role="cell" className="px-2 py-2 text-xs" style={cellStyle}>{note.author_id ? (note.author_name || "—") : UNKNOWN_AUTHOR}</div>
              <div role="cell" className={`px-2 py-2 text-xs flex items-start justify-between gap-2 min-w-0 ${editable && !isEditing ? "cursor-pointer" : ""}`}
                style={cellStyle}
                onClick={e => { if (editable && !isEditing && !e.target.closest("a")) onStartEdit(note); }}>
                {isEditing ? (
                  <div className="flex-1 min-w-0">
                    {renderEditor("עריכת תוכן ההערה", `${notesId}-edit-${note.id}`)}
                  </div>
                ) : (
                  <RichNoteView html={note.content_html} text={note.content} className="flex-1 min-w-0" />
                )}
                {canDeleteNote(currentUser, note) && !isEditing && (
                  <button type="button" aria-label="מחק הערה זו" className="text-slate-400 hover:text-red-600 text-xs flex-shrink-0"
                    onClick={e => { e.stopPropagation(); onRequestDelete(note); }}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* Clicking the empty space below the notes also opens the composer. */}
        <div className="flex-1 min-h-[24px] cursor-text" onClick={onStartNew} aria-hidden="true" />
      </div>
    </div>
  );
}

// One account/budget column, placed at explicit grid lines `rows` = [titleRow, statusRow,
// notesLabelRow, notesRow] in column `col`. `borderSide="left"` draws the vertical
// divider between this column and the one physically to its left (in RTL, every column
// except the first/rightmost one gets it, so each boundary gets exactly one divider).
function AccountColumn({ col, rows, title, statusLabel, statusValue, onStatusChange, statusSaving, windowClosed, notesId, notesLabel, notesProps, borderSide }) {
  const sideCls = borderSide === "left" ? "border-l" : "";
  const gridColumn = String(col);
  return (
    <>
      <div role="columnheader" style={{ gridColumn, gridRow: String(rows[0]) }}
        className={`py-4 px-2 text-[1.75rem] font-bold text-slate-700 text-center border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        {title}
      </div>
      <div role="row" style={{ gridColumn, gridRow: String(rows[1]) }}
        className={`flex items-center justify-between gap-3 py-3 px-2 border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">סטטוס סגירה</span>
        <ClosureStatusToggle
          label={statusLabel}
          value={statusValue ?? false}
          disabled={statusSaving || windowClosed}
          windowClosed={windowClosed}
          onChange={onStatusChange}
        />
      </div>
      <div role="row" style={{ gridColumn, gridRow: String(rows[2]) }}
        className={`py-3 px-2 border-b border-slate-200 ${sideCls}`}>
        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</span>
      </div>
      <div role="cell" style={{ gridColumn, gridRow: String(rows[3]) }} className={`py-2 px-2 h-full ${sideCls} border-slate-200`}>
        <ClosureNotesList notesId={notesId} notesLabel={notesLabel} {...notesProps} />
      </div>
    </>
  );
}

function GroupHeader({ span, title }) {
  return (
    <div
      style={{ gridColumn: `1 / span ${span}`, gridRow: "1" }}
      className="py-3 px-2 text-[1.75rem] font-bold text-slate-700 text-center bg-slate-100/60 border-b border-slate-200"
    >
      {title}
    </div>
  );
}

// `leaveGuardRef` (from SchoolPage) lets the page ask before it switches tab / year / page while
// a note here has unsaved changes: { hasUnsaved(), requestLeave(action, onCancel) }.
export function SchoolYearClosureTab({ yearAdminData, saveYearAdminField, gefenClosures, saveGefenClosure, academicYear, schoolId, currentUser, highlightNoteId, leaveGuardRef }) {
  const [saving, setSaving] = useState(null); // which field is currently saving (disables its control)
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState("");
  const mentionUsers = useMentionUsers(schoolId);
  // The one open note: { key, areaKey, scope, divisionType, budgetName, origin: "new" | "edit",
  // noteId, createdAt, initialHtml, html, text, dirty, saving, savedAt, error } — as in MeetingNotesWindow.
  const [editing, setEditing] = useState(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState(null); // { action } — the leave action waiting on the answer
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { noteId, title }
  const editingRef = useRef(null);
  editingRef.current = editing;
  const changeSeqRef = useRef(0);
  const editorRef = useRef(null);
  const draftTimerRef = useRef(null);
  const [drafts, setDrafts] = useState([]); // unsaved backups left by a crash / closed tab (meetingNoteDrafts)
  const windowClosed = !isClosureWindowOpen(academicYear);

  useEffect(() => { loadRichNoteEditor().catch(() => {}); }, []);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setNotesLoading(true);
    setNotesError("");
    setEditing(null);
    axios.get(`/schools/${schoolId}/year-closure-notes`, { params: { academic_year: academicYear } })
      .then(({ data }) => { if (!cancelled) setNotes(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) { setNotes([]); setNotesError("טעינת ההערות נכשלה"); } })
      .finally(() => { if (!cancelled) setNotesLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId, academicYear]);

  // Unsaved backups of this school + year, offered once the notes are loaded.
  useEffect(() => {
    if (notesLoading || !currentUser?.id) return;
    setDrafts(findClosureDrafts(currentUser.id, schoolId, academicYear));
  }, [notesLoading, currentUser?.id, schoolId, academicYear]);

  useEffect(() => () => clearTimeout(draftTimerRef.current), []);

  // Arriving from a "tagged you" notification: bring the note into view (it is outlined in its list).
  // The Gefen card renders only once its combos arrive (often after the notes), hence that dep.
  const comboCount = (gefenClosures || []).length;
  useEffect(() => {
    if (!highlightNoteId || notesLoading) return;
    document.querySelector(`[data-closure-note-id="${CSS.escape(highlightNoteId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightNoteId, notesLoading, comboCount]);

  // Leaving / reloading the page with unsaved changes: let the browser ask first.
  const dirty = !!editing?.dirty;
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function patchEditing(changes) {
    setEditing(prev => (prev ? { ...prev, ...changes } : prev));
  }

  // The backup slot of the open note (`noteId` null = a new note of its area).
  function keyFor(e, noteId = e.noteId) {
    return currentUser?.id ? closureDraftKey(currentUser.id, schoolId, academicYear, e.areaKey, noteId) : null;
  }

  function openEditor(area, { origin, noteId = null, html = "", text = "", dirty: startDirty = false }) {
    clearTimeout(draftTimerRef.current);
    changeSeqRef.current = 0;
    editorRef.current = null;
    setEditing({
      key: `${origin}-${noteId || "new"}-${Date.now()}`, ...area, origin, noteId, createdAt: null,
      initialHtml: html, html, text, dirty: startDirty, saving: false, savedAt: null, error: "",
    });
  }

  function closeEditor() {
    clearTimeout(draftTimerRef.current);
    editorRef.current = null;
    // Synchronously too: a leave action run right after (e.g. the page's blocker proceeding)
    // must already see nothing unsaved.
    editingRef.current = null;
    setEditing(null);
  }

  function hasUnsaved() {
    const e = editingRef.current;
    // A new note that was never saved and has no text left has nothing worth asking about.
    return !!e?.dirty && !(!e.noteId && !(e.text || "").trim());
  }

  // Runs `action` (or just closes the editor when null), asking to save first if needed;
  // `onCancel` runs when the user chooses to stay (or the save fails).
  function requestLeave(action, onCancel) {
    if (hasUnsaved()) {
      setUnsavedPrompt({ action, onCancel });
      return;
    }
    if (editingRef.current) closeEditor();
    action?.();
  }

  if (leaveGuardRef) leaveGuardRef.current = { hasUnsaved, requestLeave };
  useEffect(() => () => { if (leaveGuardRef) leaveGuardRef.current = null; }, [leaveGuardRef]);

  function handleEditorChange({ html, text }) {
    changeSeqRef.current += 1;
    setEditing(prev => (prev ? { ...prev, html, text, dirty: true } : prev));
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const e = editingRef.current;
      const key = e && keyFor(e);
      if (key && e.dirty) {
        const { areaKey, scope, divisionType, budgetName, areaTitle } = e;
        writeDraft(key, { html: e.html, text: e.text, meta: { areaKey, scope, divisionType, budgetName, areaTitle } });
      }
    }, DRAFT_WRITE_DELAY);
  }

  // `content` is the plain text (mentions, the summary columns); `content_html` the formatting.
  // Returns true when nothing is left unsaved.
  async function save({ close = false } = {}) {
    const e = editingRef.current;
    if (!e || e.saving) return false;
    if (!e.dirty) {
      if (close) closeEditor();
      return true;
    }
    const content = (e.text || "").trim();
    if (!content) {
      patchEditing({ error: e.noteId ? "לא ניתן לשמור הערה ריקה — למחיקת ההערה השתמשו ב-✕" : "לא ניתן לשמור הערה ריקה" });
      return false;
    }
    const seq = changeSeqRef.current;
    patchEditing({ saving: true, error: "" });
    try {
      let saved = {};
      if (!e.noteId) {
        const { data } = await axios.post(`/schools/${schoolId}/year-closure-notes`, {
          academic_year: academicYear, scope: e.scope, division_type: e.divisionType ?? null, budget_name: e.budgetName ?? null,
          content, content_html: e.html || null,
        });
        setNotes(prev => [{ ...data, author_name: data.author_name || currentUser?.full_name }, ...prev]);
        saved = { noteId: data.id, createdAt: data.created_at };
      } else {
        const { data } = await axios.patch(`/schools/${schoolId}/year-closure-notes/${e.noteId}`, { content, content_html: e.html || null });
        setNotes(prev => prev.map(n => n.id === e.noteId ? { ...n, content, content_html: data?.content_html ?? null } : n));
      }
      // Typing that happened while the request was in flight is still unsaved.
      const stillDirty = changeSeqRef.current !== seq;
      if (!e.noteId) removeDraft(keyFor(e, null) || "");
      if (!stillDirty) {
        clearTimeout(draftTimerRef.current);
        removeDraft(keyFor(e, saved.noteId || e.noteId) || "");
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
    if (await save()) {
      closeEditor();
      pending?.action?.();
    } else {
      pending?.onCancel?.();
      setTimeout(() => editorRef.current?.commands.focus(), 0);
    }
  }

  function promptDiscard() {
    const pending = unsavedPrompt;
    setUnsavedPrompt(null);
    const e = editingRef.current;
    const key = e && keyFor(e);
    if (key) removeDraft(key);
    closeEditor();
    pending?.action?.();
  }

  function promptBackToEditing() {
    const pending = unsavedPrompt;
    setUnsavedPrompt(null);
    pending?.onCancel?.();
    setTimeout(() => editorRef.current?.commands.focus(), 0);
  }

  function restoreDraft(draft) {
    requestLeave(() => {
      const note = draft.noteId && notes.find(n => n.id === draft.noteId);
      // A backup of a note that has since been deleted comes back as a new note of its area.
      const target = note && canEditNote(currentUser, note) ? { origin: "edit", noteId: note.id } : { origin: "new", noteId: null };
      const area = draft.meta;
      removeDraft(draft.key);
      const key = keyFor(area, target.noteId);
      if (key) writeDraft(key, draft);
      openEditor(area, { ...target, html: draft.html, text: draft.text, dirty: true });
      setDrafts(prev => prev.filter(d => d.key !== draft.key));
    });
  }

  function discardDraft(draft) {
    removeDraft(draft.key);
    setDrafts(prev => prev.filter(d => d.key !== draft.key));
  }

  async function confirmDeleteNow() {
    if (!deleteConfirm) return;
    const { noteId } = deleteConfirm;
    setDeleteConfirm(null);
    setNotesError("");
    try {
      await axios.delete(`/schools/${schoolId}/year-closure-notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch {
      setNotesError("מחיקת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    }
  }

  function renderEditor(ariaLabel, editorId) {
    return (
      <EditorBoundary message="טעינת עורך ההערות נכשלה — רענון הדף יטען אותו מחדש">
        <Suspense fallback={<div role="status" aria-label="טוען עורך" className="rounded-[0.6rem] border-[1.5px] border-slate-200 bg-white/80" style={{ height: EDITOR_HEIGHT }} />}>
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
              // hands focus back to whatever had it before the dialog (useFocusTrap).
              setTimeout(() => { if (editorRef.current === ed && !ed.isDestroyed) ed.commands.focus("end"); }, 0);
            }}
            users={mentionUsers}
            autoFocus
            resizable
            height={EDITOR_HEIGHT}
            placeholder="הכנס הערה כאן... השתמש ב-@ לתיוג משתמש"
            footer={<EditorFooter editing={editing} onSave={() => save({ close: true })} onCancel={() => requestLeave(null)} />}
          />
        </Suspense>
      </EditorBoundary>
    );
  }

  async function handleStatusChange(field, value) {
    setSaving(field);
    await saveYearAdminField(field, value);
    setSaving(null);
  }

  async function handleGefenStatusChange(divisionType, budgetName, value) {
    const key = `${divisionType}::${budgetName}`;
    setSaving(key);
    await saveGefenClosure(divisionType, budgetName, "status", value);
    setSaving(null);
  }

  // Props for one notes area — its own notes (newest first) plus new/edit/delete bound to it.
  function notesPropsFor(areaTitle, scope, divisionType, budgetName) {
    const areaKey = noteAreaKey(scope, divisionType, budgetName);
    const area = { areaKey, scope, divisionType, budgetName, areaTitle };
    return {
      notes: notes.filter(n => noteAreaKey(n.scope, n.division_type, n.budget_name) === areaKey),
      currentUser,
      editing: editing?.areaKey === areaKey ? editing : null,
      renderEditor,
      highlightNoteId,
      onStartNew: () => {
        const e = editingRef.current;
        if (e?.origin === "new" && e.areaKey === areaKey) {
          editorRef.current?.commands.focus();
          return;
        }
        requestLeave(() => openEditor(area, { origin: "new" }));
      },
      onStartEdit: note => requestLeave(() => openEditor(area, {
        origin: "edit", noteId: note.id, html: note.content_html || plainTextToHtml(note.content), text: note.content,
      })),
      onRequestDelete: note => setDeleteConfirm({ noteId: note.id, title: `מחיקת הערת סגירת שנה - ${areaTitle}` }),
    };
  }

  const combos = gefenClosures || [];
  // A backup is offered only while its area is on screen (a Gefen area appears once its combos load).
  const shownAreaKeys = new Set(["parents", "authority", ...combos.map(c => noteAreaKey("gefen", c.division_type, c.budget_name))]);
  const shownDraft = drafts.find(d => d.meta?.areaKey && shownAreaKeys.has(d.meta.areaKey));
  // Balanced auto-grid for the dynamic Gefen combos: as close to a square as possible so
  // e.g. 7 combos become a 3x3 grid (one empty cell) rather than one long cramped row.
  const gefenCols = combos.length > 0 ? Math.ceil(Math.sqrt(combos.length)) : 0;
  const gefenRowCount = gefenCols > 0 ? Math.ceil(combos.length / gefenCols) : 0;

  const financeRows = [2, 3, 4, 5]; // header is row 1
  const gefenRowTemplate = ["auto", ...Array.from({ length: gefenRowCount }, () => ["auto", "auto", "auto", "1fr"]).flat()];

  return (
    <div dir="rtl" className="flex flex-col">
      <h2 className="text-lg font-bold text-slate-900 mb-4">סגירת שנה</h2>
      {notesLoading && <div role="status" aria-label="טוען הערות" className="text-xs text-slate-400 mb-2">טוען הערות…</div>}
      {notesError && <div role="alert" className="text-xs text-red-600 mb-2">{notesError}</div>}
      {shownDraft && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          <span className="flex-1 min-w-0">
            נמצאה טיוטה שלא נשמרה ({shownDraft.noteId ? "עריכת הערה" : "הערה חדשה"} ב{shownDraft.meta.areaTitle || "הערות"}, {formatUpdateDate(new Date(shownDraft.at).toISOString())}):
            {" "}<span className="text-amber-700">"{shownDraft.text.trim().slice(0, 60)}{shownDraft.text.trim().length > 60 ? "…" : ""}"</span>
          </span>
          <button type="button" onClick={() => restoreDraft(shownDraft)} className="btn-blue text-xs px-3 py-1">שחזור הטיוטה</button>
          <button type="button" onClick={() => discardDraft(shownDraft)}
            className="text-xs px-3 py-1 rounded-full border border-amber-300 hover:bg-amber-100">מחיקת הטיוטה</button>
        </div>
      )}

      <div className="glass-card rounded-2xl border-2 border-slate-800 flex flex-col overflow-hidden">
        <div
          role="table"
          aria-label="סגירת שנה — תוכנת הכספים"
          className="grid text-right"
          style={{ gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "auto auto auto auto 1fr" }}
        >
          <GroupHeader span={2} title="תוכנת הכספים" />
          <AccountColumn
            col={1}
            rows={financeRows}
            title="חשבון הורים"
            statusLabel="סטטוס סגירה מול הורים"
            statusValue={yearAdminData.closure_parents_status}
            statusSaving={saving === "closure_parents_status"}
            windowClosed={windowClosed}
            onStatusChange={v => handleStatusChange("closure_parents_status", v)}
            notesId="closure-parents-notes"
            notesLabel="הערות סגירה מול הורים"
            notesProps={notesPropsFor("חשבון הורים", "parents")}
            borderSide="left"
          />
          <AccountColumn
            col={2}
            rows={financeRows}
            title="חשבון רשות"
            statusLabel="סטטוס סגירה מול הרשות"
            statusValue={yearAdminData.closure_authority_status}
            statusSaving={saving === "closure_authority_status"}
            windowClosed={windowClosed}
            onStatusChange={v => handleStatusChange("closure_authority_status", v)}
            notesId="closure-authority-notes"
            notesLabel="הערות סגירה מול הרשות"
            notesProps={notesPropsFor("חשבון רשות", "authority")}
          />
        </div>
      </div>

      {combos.length > 0 && (
        <>
          {/* At least 3 text-lines' worth of breathing room — the gap shows the page's
              regular background, not a white card stretching down. */}
          <div style={{ height: "4.5rem" }} aria-hidden="true" />

          <div className="glass-card rounded-2xl border-2 border-slate-800 flex flex-col overflow-hidden">
            <div
              role="table"
              aria-label="סגירת שנה — מערכת גפן"
              className="grid text-right"
              style={{ gridTemplateColumns: `repeat(${gefenCols}, 1fr)`, gridTemplateRows: gefenRowTemplate.join(" ") }}
            >
              <GroupHeader span={gefenCols} title="מערכת גפן" />
              {combos.map((combo, idx) => {
                const col = (idx % gefenCols) + 1;
                const rowIdx = Math.floor(idx / gefenCols);
                const titleRow = 2 + rowIdx * 4; // row 1 is the group header
                const rows = [titleRow, titleRow + 1, titleRow + 2, titleRow + 3];
                const key = `${combo.division_type}::${combo.budget_name}`;
                const title = combo.division_label ? `${combo.division_label} — ${combo.budget_name}` : combo.budget_name;
                return (
                  <AccountColumn
                    key={key}
                    col={col}
                    rows={rows}
                    title={title}
                    statusLabel={`סטטוס סגירה — ${title}`}
                    statusValue={combo.status}
                    statusSaving={saving === key}
                    windowClosed={windowClosed}
                    onStatusChange={v => handleGefenStatusChange(combo.division_type, combo.budget_name, v)}
                    notesId={`gefen-closure-notes-${key}`}
                    notesLabel={`הערות סגירה — ${title}`}
                    notesProps={notesPropsFor(title, "gefen", combo.division_type, combo.budget_name)}
                    borderSide={col !== 1 ? "left" : undefined}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Portaled: the glass cards' backdrop-filter would otherwise clip these fixed overlays. */}
      {deleteConfirm && createPortal(
        <DeleteConfirmDialog title={deleteConfirm.title} onCancel={() => setDeleteConfirm(null)} onConfirm={confirmDeleteNow} />,
        document.body,
      )}
      {unsavedPrompt && createPortal(
        <UnsavedChangesDialog onSave={promptSave} onDiscard={promptDiscard} onCancel={promptBackToEditing} />,
        document.body,
      )}
    </div>
  );
}
