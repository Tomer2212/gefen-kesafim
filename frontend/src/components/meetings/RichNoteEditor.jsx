import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import {
  Undo2, Redo2, Pilcrow, ALargeSmall, Bold, Italic, Underline, Strikethrough, Baseline, Highlighter,
  List, ListOrdered, ListChecks, AlignRight, AlignCenter, AlignLeft, AlignJustify, ArrowLeftRight,
  Link as LinkIcon, Unlink, Minus, Table as TableIcon, RemoveFormatting, AtSign, ChevronDown, Save,
} from "lucide-react";

// Rich-text editor for the meeting-notes window: a TipTap editor with a Word/monday-style
// toolbar. Saving is explicit (like Word) — nothing happens on blur, so the user can switch to
// another app and come back to the exact same caret position. The parent owns the save logic:
// `onSave` (toolbar save button / Ctrl+S — save and keep editing), `onEscape` (Esc), `canSave`,
// and a `footer` (save / cancel buttons + status) rendered at the bottom of the box. `height` is a
// fixed pixel height set by the parent (the notes window sizes it to its own height). `value` is
// the initial HTML (legacy plain-text notes: convert with plainTextToHtml from RichNoteView
// first); the editor owns its content after mount, and `onReady` hands the parent the editor
// instance (to restore focus after a dialog / un-minimize). `onChange` receives { html, text } where `text` is the
// plain-text version the backend uses for @-mention detection, notification previews and the
// activity log (mentions render there as "@Full Name", exactly like the old textarea).

const POPOVER_Z = 80;
const MENTION_LIST_MAX = 260;

const TEXT_COLORS = [
  { value: "#1e293b", label: "שחור" }, { value: "#64748b", label: "אפור" },
  { value: "#dc2626", label: "אדום" }, { value: "#ea580c", label: "כתום" },
  { value: "#ca8a04", label: "חרדל" }, { value: "#16a34a", label: "ירוק" },
  { value: "#0d9488", label: "טורקיז" }, { value: "#2563eb", label: "כחול" },
  { value: "#7c3aed", label: "סגול" }, { value: "#db2777", label: "ורוד" },
];
const HIGHLIGHT_COLORS = [
  { value: "#fef08a", label: "צהוב" }, { value: "#bbf7d0", label: "ירוק" },
  { value: "#bfdbfe", label: "כחול" }, { value: "#fbcfe8", label: "ורוד" },
  { value: "#fed7aa", label: "כתום" }, { value: "#ddd6fe", label: "סגול" },
  { value: "#fecaca", label: "אדום" }, { value: "#e2e8f0", label: "אפור" },
];
const FONT_SIZES = [
  { value: "11px", label: "קטן" },
  { value: null, label: "רגיל" },
  { value: "16px", label: "גדול" },
  { value: "20px", label: "גדול מאוד" },
];
const BLOCK_TYPES = [
  { key: "paragraph", label: "טקסט רגיל", className: "text-xs" },
  { key: "h1", label: "כותרת 1", className: "text-base font-bold" },
  { key: "h2", label: "כותרת 2", className: "text-sm font-bold" },
  { key: "h3", label: "כותרת 3", className: "text-xs font-bold" },
  { key: "blockquote", label: "ציטוט", className: "text-xs border-r-2 border-blue-300 pr-2" },
];


function normalizeUrl(raw) {
  const url = raw.trim();
  if (!url) return "";
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

// Every org user, alphabetically, filtered by the start of the full name OR of any word in it
// (so "@סגמן" finds "גל סגמן") — the list is scrollable, never truncated.
function filterMentionUsers(users, query) {
  const q = (query || "").trim().toLowerCase();
  const name = u => (u.full_name || u.email || "").trim();
  return users
    .filter(u => {
      const n = name(u).toLowerCase();
      return !q || n.startsWith(q) || n.split(/\s+/).some(w => w.startsWith(q));
    })
    .sort((a, b) => name(a).localeCompare(name(b), "he"));
}

export function RichNoteEditor({ id, value, onChange, onSave, onEscape, canSave = false, footer, onReady, users, autoFocus, placeholder, height, ariaLabel }) {
  const wrapperRef = useRef(null);
  const layerRef = useRef(null);
  const mentionListRef = useRef(null);
  const usersRef = useRef(users || []);
  usersRef.current = users || [];
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mention, setMention] = useState(null); // { items, command, rect, index }
  const mentionKeyRef = useRef(() => false);
  const openLinkRef = useRef(() => {});
  const toolbarRef = useRef(null);
  const [popover, setPopover] = useState(null); // { kind, rect }
  const [focused, setFocused] = useState(false);

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["right", "center", "left", "justify"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: placeholder || "" }),
    Mention.configure({
      HTMLAttributes: { class: "rt-mention" },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      renderHTML: ({ node, options }) => ["span", { ...options.HTMLAttributes, "data-type": "mention", "data-id": node.attrs.id, "data-label": node.attrs.label }, `@${node.attrs.label ?? node.attrs.id}`],
      suggestion: {
        char: "@",
        allowSpaces: true,
        items: ({ query }) => filterMentionUsers(usersRef.current, query),
        render: () => ({
          onStart: props => setMention({ items: props.items, command: props.command, rect: props.clientRect?.(), index: 0 }),
          onUpdate: props => setMention(m => ({ items: props.items, command: props.command, rect: props.clientRect?.(), index: m && m.items.length === props.items.length ? m.index : 0 })),
          onKeyDown: ({ event }) => mentionKeyRef.current(event),
          onExit: () => setMention(null),
        }),
      },
    }),
    Extension.create({
      name: "richNoteShortcuts",
      addKeyboardShortcuts() {
        return {
          "Mod-k": () => { openLinkRef.current(); return true; },
          "Mod-s": () => { onSaveRef.current?.(); return true; },
          Escape: () => { onEscapeRef.current?.(); return true; },
          // WAI-ARIA toolbar pattern: Alt+F10 jumps from the text to the first toolbar button.
          "Alt-F10": () => {
            toolbarRef.current?.querySelector("button:not(:disabled)")?.focus();
            return true;
          },
        };
      },
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const editor = useEditor({
    extensions,
    content: value || "",
    autofocus: autoFocus ? "end" : false,
    textDirection: "rtl",
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "rich-note",
        id: id || "",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel || "תוכן ההערה",
        style: "padding: 0.5rem 0.65rem;",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current?.({ html: ed.isEmpty ? "" : ed.getHTML(), text: ed.getText({ blockSeparator: "\n" }) });
    },
  });

  useEffect(() => { if (editor) onReady?.(editor); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [editor]);

  // Keep the highlighted mention visible while arrowing through the (full, scrollable) list.
  useEffect(() => {
    mentionListRef.current?.children[mention?.index ?? 0]?.scrollIntoView({ block: "nearest" });
  }, [mention?.index]);

  mentionKeyRef.current = event => {
    if (!mention || mention.items.length === 0) return false;
    const n = mention.items.length;
    if (event.key === "ArrowDown") { setMention(m => ({ ...m, index: (m.index + 1) % n })); return true; }
    if (event.key === "ArrowUp") { setMention(m => ({ ...m, index: (m.index - 1 + n) % n })); return true; }
    if (event.key === "Enter" || event.key === "Tab") { pickMention(mention.items[mention.index]); return true; }
    if (event.key === "Escape") { setMention(null); return true; }
    return false;
  };

  function pickMention(user) {
    if (!mention || !user) return;
    mention.command({ id: user.id, label: user.full_name || user.email });
  }

  function openPopover(kind, anchorEl) {
    if (popover?.kind === kind) { setPopover(null); return; }
    setPopover({ kind, rect: anchorEl.getBoundingClientRect() });
  }

  openLinkRef.current = () => {
    const btn = wrapperRef.current?.querySelector("[data-rt-btn='link']");
    if (btn) setPopover({ kind: "link", rect: btn.getBoundingClientRect() });
  };

  function closePopover({ refocus = true } = {}) {
    // Move focus back into the editor BEFORE unmounting a focused popover input, so the
    // resulting focusout lands inside the wrapper and doesn't count as "left the note".
    if (refocus) editor?.commands.focus();
    setPopover(null);
  }

  // Outside click / Escape closes an open popover.
  useEffect(() => {
    if (!popover) return;
    function onDown(e) {
      if (layerRef.current?.contains(e.target) || e.target.closest?.("[data-rt-popover-anchor]")) return;
      setPopover(null);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover]);

  // Only drives the focus ring — leaving the editor never saves or closes it.
  function handleBlur(e) {
    const next = e.relatedTarget;
    if (next && (wrapperRef.current?.contains(next) || layerRef.current?.contains(next))) return;
    setFocused(false);
  }

  // Ctrl+S / Esc while focus is on the toolbar or footer buttons. Inside the text they're TipTap
  // shortcuts (Mod-s / Escape above) — ProseMirror preventDefaults every Esc, so it can't be told
  // apart here, and the mention list must get the first chance at Esc. A popover's Esc is
  // stopped at the document before it gets here; the toolbar's own Esc (back to the text) is
  // defaultPrevented and must not also leave the note.
  function handleKeyDown(e) {
    if (e.defaultPrevented || editor.view.dom.contains(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
  }

  function mentionListStyle(rect) {
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const left = Math.max(8, rect.right - 224);
    if (below >= Math.min(MENTION_LIST_MAX, 200) || below >= above) {
      return { top: rect.bottom + 4, left, maxHeight: Math.min(MENTION_LIST_MAX, below) };
    }
    return { bottom: window.innerHeight - rect.top + 4, left, maxHeight: Math.min(MENTION_LIST_MAX, above) };
  }

  if (!editor) return null;

  const boxStyle = {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    border: `1.5px solid ${focused ? "#0070F3" : "#e2e8f0"}`,
    borderRadius: "0.6rem",
    color: "#1e293b",
    background: focused ? "white" : "rgba(255,255,255,0.85)",
    boxShadow: focused ? "0 0 0 3px rgba(0,112,243,0.12)" : "none",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease",
    height: height || 240,
  };

  return (
    <div
      ref={wrapperRef}
      dir="rtl"
      onFocusCapture={() => setFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{ width: "100%" }}
    >
      <div style={boxStyle}>
        <Toolbar editor={editor} popover={popover} openPopover={openPopover} toolbarRef={toolbarRef} onSave={onSave} canSave={canSave} />
        {/* The editable area is only as tall as its content — a mousedown on the empty space below
            it lands on this non-focusable div; keep focus and move the caret to the end instead. */}
        <div className="flex-1 min-h-0 overflow-y-auto cursor-text"
          onMouseDown={e => {
            if (editor.view.dom.contains(e.target)) return;
            e.preventDefault();
            editor.commands.focus("end");
          }}>
          <EditorContent editor={editor} />
        </div>
        {footer && (
          <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50/90 rounded-b-[0.55rem] px-2.5 py-1.5">
            {footer}
          </div>
        )}
      </div>

      {/* Popovers render in a body-level layer: the notes window uses backdrop-filter, which
          turns it into the containing block for position:fixed and clips anything inside its
          scroll area. The layer is still part of this React tree, so focus/blur events from it
          bubble to the wrapper above and are recognized as "still inside the editor". */}
      {createPortal(
        <div ref={layerRef} dir="rtl">
          {popover && (
            <PopoverBody editor={editor} popover={popover} onClose={closePopover} />
          )}
          {mention && mention.items.length > 0 && mention.rect && (
            <div ref={mentionListRef} role="listbox" aria-label="תיוג משתמש"
              className="fixed bg-white border border-slate-200 rounded-xl shadow-lg py-1 overflow-y-auto w-56"
              style={{ zIndex: POPOVER_Z, ...mentionListStyle(mention.rect) }}>
              {mention.items.map((u, i) => (
                <button key={u.id} type="button" role="option" aria-selected={i === mention.index}
                  onMouseDown={e => { e.preventDefault(); pickMention(u); }}
                  onMouseEnter={() => setMention(m => ({ ...m, index: i }))}
                  className={`w-full text-right px-3 py-2 text-sm text-slate-700 flex items-center gap-2 ${i === mention.index ? "bg-blue-50" : "hover:bg-blue-50"}`}>
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    {(u.full_name || u.email || "?")[0].toUpperCase()}
                  </span>
                  {u.full_name || u.email}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar

function ToolButton({ label, shortcut, active, disabled, onClick, children, btnKey, hasPopover, popoverOpen }) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={hasPopover ? undefined : !!active}
      aria-haspopup={hasPopover ? "true" : undefined}
      aria-expanded={hasPopover ? !!popoverOpen : undefined}
      disabled={disabled}
      data-rt-btn={btnKey}
      data-rt-popover-anchor={hasPopover ? "" : undefined}
      tabIndex={-1}
      onMouseDown={e => e.preventDefault()}
      onClick={e => onClick(e.currentTarget)}
      className={`h-7 min-w-7 px-1 rounded-md flex items-center justify-center gap-0.5 transition-colors flex-shrink-0
        ${active || popoverOpen ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}
        disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-default`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="w-px h-5 bg-slate-200 mx-0.5 flex-shrink-0" />;
}

const ICON = { size: 16, strokeWidth: 2, "aria-hidden": true };

function currentBlockKey(editor) {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("blockquote")) return "blockquote";
  return "paragraph";
}

const ALIGNMENTS = [
  { value: "right", label: "יישור לימין", Icon: AlignRight },
  { value: "center", label: "מרכוז", Icon: AlignCenter },
  { value: "left", label: "יישור לשמאל", Icon: AlignLeft },
  { value: "justify", label: "יישור לשני הצדדים", Icon: AlignJustify },
];

function currentAlign(editor) {
  return ["center", "left", "justify"].find(a => editor.isActive({ textAlign: a })) || "right";
}

function currentDir(editor) {
  const attrs = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  return attrs.dir === "ltr" ? "ltr" : "rtl";
}

function Toolbar({ editor, popover, openPopover, toolbarRef, onSave, canSave }) {
  const chain = () => editor.chain().focus();
  const textColor = editor.getAttributes("textStyle").color;
  const highlightColor = editor.getAttributes("highlight").color;
  const align = currentAlign(editor);
  const AlignIcon = ALIGNMENTS.find(a => a.value === align).Icon;
  const dir = currentDir(editor);
  const pop = kind => popover?.kind === kind;

  // Roving arrow-key navigation between toolbar buttons (WAI-ARIA toolbar pattern); buttons are
  // tabIndex=-1 so Tab moves between editor and the rest of the page, and the first button is
  // reachable with Alt+F10 from inside the editor.
  function onToolbarKeyDown(e) {
    const btns = [...toolbarRef.current.querySelectorAll("button:not(:disabled)")];
    const i = btns.indexOf(document.activeElement);
    if (i === -1) return;
    // RTL: ArrowLeft moves to the next button visually.
    if (e.key === "ArrowLeft") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); btns[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); btns[btns.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); editor.commands.focus(); }
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="עיצוב טקסט"
      aria-orientation="horizontal"
      onKeyDown={onToolbarKeyDown}
      className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-slate-200 bg-slate-50/90 rounded-t-[0.55rem] flex-shrink-0"
    >
      {onSave && (
        <>
          <ToolButton label="שמירה (ממשיכים לערוך)" shortcut="Ctrl+S" disabled={!canSave} onClick={() => onSave()}><Save {...ICON} /></ToolButton>
          <Sep />
        </>
      )}
      <ToolButton label="ביטול פעולה" shortcut="Ctrl+Z" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}><Undo2 {...ICON} /></ToolButton>
      <ToolButton label="ביצוע חוזר" shortcut="Ctrl+Y" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}><Redo2 {...ICON} /></ToolButton>
      <Sep />
      <ToolButton label="סוג טקסט" btnKey="block" hasPopover popoverOpen={pop("block")} onClick={el => openPopover("block", el)}>
        <Pilcrow {...ICON} /><ChevronDown size={11} aria-hidden="true" />
      </ToolButton>
      <ToolButton label="גודל גופן" btnKey="size" hasPopover popoverOpen={pop("size")} onClick={el => openPopover("size", el)}>
        <ALargeSmall {...ICON} /><ChevronDown size={11} aria-hidden="true" />
      </ToolButton>
      <Sep />
      <ToolButton label="מודגש" shortcut="Ctrl+B" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><Bold {...ICON} strokeWidth={2.6} /></ToolButton>
      <ToolButton label="נטוי" shortcut="Ctrl+I" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><Italic {...ICON} /></ToolButton>
      <ToolButton label="קו תחתון" shortcut="Ctrl+U" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><Underline {...ICON} /></ToolButton>
      <ToolButton label="קו חוצה" shortcut="Ctrl+Shift+S" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><Strikethrough {...ICON} /></ToolButton>
      <Sep />
      <ToolButton label="צבע טקסט" btnKey="color" hasPopover popoverOpen={pop("color")} onClick={el => openPopover("color", el)}>
        <span className="flex flex-col items-center leading-none">
          <Baseline size={15} strokeWidth={2} aria-hidden="true" />
          <span aria-hidden="true" className="block w-3.5 h-[3px] rounded-sm -mt-0.5" style={{ background: textColor || "#1e293b" }} />
        </span>
      </ToolButton>
      <ToolButton label="מירקור" btnKey="highlight" hasPopover popoverOpen={pop("highlight")} onClick={el => openPopover("highlight", el)}>
        <span className="flex flex-col items-center leading-none">
          <Highlighter size={15} strokeWidth={2} aria-hidden="true" />
          <span aria-hidden="true" className="block w-3.5 h-[3px] rounded-sm -mt-0.5" style={{ background: highlightColor || "#fef08a" }} />
        </span>
      </ToolButton>
      <Sep />
      <ToolButton label="רשימת תבליטים" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><List {...ICON} /></ToolButton>
      <ToolButton label="רשימה ממוספרת" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><ListOrdered {...ICON} /></ToolButton>
      <ToolButton label="רשימת משימות" active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()}><ListChecks {...ICON} /></ToolButton>
      <Sep />
      <ToolButton label="יישור" btnKey="align" hasPopover popoverOpen={pop("align")} onClick={el => openPopover("align", el)}>
        <AlignIcon {...ICON} /><ChevronDown size={11} aria-hidden="true" />
      </ToolButton>
      <ToolButton label={dir === "ltr" ? "כיוון כתיבה: מימין לשמאל" : "כיוון כתיבה: משמאל לימין (לטקסט באנגלית)"} active={dir === "ltr"}
        onClick={() => chain().setTextDirection(dir === "ltr" ? "rtl" : "ltr").run()}>
        <ArrowLeftRight {...ICON} />
      </ToolButton>
      <Sep />
      <ToolButton label="קישור" shortcut="Ctrl+K" btnKey="link" hasPopover popoverOpen={pop("link")} active={editor.isActive("link")} onClick={el => openPopover("link", el)}>
        <LinkIcon {...ICON} />
      </ToolButton>
      <ToolButton label="קו מפריד" onClick={() => chain().setHorizontalRule().run()}><Minus {...ICON} /></ToolButton>
      <ToolButton label="טבלה" btnKey="table" hasPopover popoverOpen={pop("table")} active={editor.isActive("table")} onClick={el => openPopover("table", el)}>
        <TableIcon {...ICON} /><ChevronDown size={11} aria-hidden="true" />
      </ToolButton>
      <Sep />
      <ToolButton label="תיוג משתמש" onClick={() => {
        // The suggestion only triggers after whitespace / line start — add a space only when needed.
        const { from } = editor.state.selection;
        const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, " ", " ");
        chain().insertContent(before && !/\s/.test(before) ? " @" : "@").run();
      }}><AtSign {...ICON} /></ToolButton>
      <ToolButton label="ניקוי עיצוב" onClick={() => chain().unsetAllMarks().clearNodes().unsetTextAlign().run()}><RemoveFormatting {...ICON} /></ToolButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popovers (rendered in the body-level layer, positioned under their toolbar button)

function PopoverBody({ editor, popover, onClose }) {
  const { kind, rect } = popover;
  const width = kind === "link" ? 300 : kind === "table" ? 200 : kind === "color" || kind === "highlight" ? 196 : 150;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  const style = { position: "fixed", top: rect.bottom + 6, left, width, zIndex: POPOVER_Z };
  const shell = "bg-white border border-slate-200 rounded-xl shadow-xl p-1.5";
  const run = fn => { fn(editor.chain().focus()).run(); onClose({ refocus: false }); };

  if (kind === "block") {
    const cur = currentBlockKey(editor);
    return (
      <div role="menu" aria-label="סוג טקסט" style={style} className={shell}>
        {BLOCK_TYPES.map(b => (
          <MenuItem key={b.key} active={cur === b.key} onClick={() => run(c => {
            if (b.key === "paragraph") return c.setParagraph();
            if (b.key === "blockquote") return cur === "blockquote" ? c.lift("blockquote") : c.setParagraph().setBlockquote();
            return c.setHeading({ level: Number(b.key[1]) });
          })}>
            <span className={b.className}>{b.label}</span>
          </MenuItem>
        ))}
      </div>
    );
  }

  if (kind === "size") {
    const cur = editor.getAttributes("textStyle").fontSize || null;
    return (
      <div role="menu" aria-label="גודל גופן" style={style} className={shell}>
        {FONT_SIZES.map(s => (
          <MenuItem key={s.label} active={cur === s.value} onClick={() => run(c => s.value ? c.setFontSize(s.value) : c.unsetFontSize())}>
            <span style={{ fontSize: s.value || "12px" }}>{s.label}</span>
          </MenuItem>
        ))}
      </div>
    );
  }

  if (kind === "color" || kind === "highlight") {
    const isColor = kind === "color";
    const colors = isColor ? TEXT_COLORS : HIGHLIGHT_COLORS;
    const cur = isColor ? editor.getAttributes("textStyle").color : editor.getAttributes("highlight").color;
    return (
      <div role="menu" aria-label={isColor ? "צבע טקסט" : "צבע מירקור"} style={style} className={shell}>
        <div className="grid grid-cols-5 gap-1.5 p-1">
          {colors.map(c => (
            <button key={c.value} type="button" role="menuitemradio" aria-checked={cur === c.value}
              aria-label={c.label} title={c.label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => run(ch => isColor ? ch.setColor(c.value) : ch.setHighlight({ color: c.value }))}
              className={`w-7 h-7 rounded-md border flex items-center justify-center transition-transform hover:scale-110
                ${cur === c.value ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"}`}
              style={{ background: isColor ? "white" : c.value }}>
              {isColor
                ? <span aria-hidden="true" className="text-sm font-bold" style={{ color: c.value }}>א</span>
                : <span aria-hidden="true" className="text-xs text-slate-700">א</span>}
            </button>
          ))}
        </div>
        <button type="button" role="menuitem" onMouseDown={e => e.preventDefault()}
          onClick={() => run(ch => isColor ? ch.unsetColor() : ch.unsetHighlight())}
          className="w-full mt-1 text-xs text-slate-600 hover:bg-slate-100 rounded-md py-1.5">
          {isColor ? "ללא צבע (ברירת מחדל)" : "ללא מירקור"}
        </button>
      </div>
    );
  }

  if (kind === "table") {
    const inTable = editor.isActive("table");
    const items = inTable ? [
      { label: "הוספת שורה מתחת", fn: c => c.addRowAfter() },
      { label: "הוספת שורה מעל", fn: c => c.addRowBefore() },
      { label: "הוספת עמודה משמאל", fn: c => c.addColumnAfter() },
      { label: "הוספת עמודה מימין", fn: c => c.addColumnBefore() },
      { label: "מחיקת שורה", fn: c => c.deleteRow(), danger: true },
      { label: "מחיקת עמודה", fn: c => c.deleteColumn(), danger: true },
      { label: "שורת כותרת (הפעלה/כיבוי)", fn: c => c.toggleHeaderRow() },
      { label: "מחיקת הטבלה", fn: c => c.deleteTable(), danger: true },
    ] : [
      { label: "הוספת טבלה 2×2", fn: c => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }) },
      { label: "הוספת טבלה 3×3", fn: c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
      { label: "הוספת טבלה 4×4", fn: c => c.insertTable({ rows: 4, cols: 4, withHeaderRow: true }) },
    ];
    return (
      <div role="menu" aria-label="טבלה" style={style} className={shell}>
        {items.map(it => (
          <MenuItem key={it.label} danger={it.danger} onClick={() => run(it.fn)}>
            <span className="text-xs">{it.label}</span>
          </MenuItem>
        ))}
      </div>
    );
  }

  if (kind === "align") {
    const cur = currentAlign(editor);
    return (
      <div role="menu" aria-label="יישור" style={style} className={shell}>
        {ALIGNMENTS.map(({ value, label, Icon }) => (
          <MenuItem key={value} active={cur === value} onClick={() => run(c => c.setTextAlign(value))}>
            <span className="flex items-center gap-2 text-xs"><Icon size={15} aria-hidden="true" />{label}</span>
          </MenuItem>
        ))}
      </div>
    );
  }

  if (kind === "link") return <LinkPopover editor={editor} style={style} shell={shell} onClose={onClose} />;
  return null;
}

function MenuItem({ active, danger, onClick, children }) {
  return (
    <button type="button" role="menuitem" onMouseDown={e => e.preventDefault()} onClick={onClick}
      className={`w-full text-right px-2.5 py-1.5 rounded-md flex items-center transition-colors
        ${active ? "bg-blue-50 text-blue-700" : danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}

function LinkPopover({ editor, style, shell, onClose }) {
  const existing = editor.getAttributes("link").href || "";
  const [url, setUrl] = useState(existing);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function apply(e) {
    e.preventDefault();
    const href = normalizeUrl(url);
    const c = editor.chain().focus().extendMarkRange("link");
    if (!href) {
      c.unsetLink().run();
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
      // No selected text: insert the URL itself as the link text.
      c.insertContent({ type: "text", text: url.trim(), marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    } else {
      c.setLink({ href }).run();
    }
    onClose({ refocus: false });
  }

  return (
    <form role="dialog" aria-label="הוספת קישור" style={style} className={`${shell} p-2.5 flex flex-col gap-2`} onSubmit={apply}>
      <label htmlFor="rich-note-link-url" className="text-xs font-semibold text-slate-600">כתובת הקישור</label>
      <input
        ref={inputRef}
        id="rich-note-link-url"
        type="text"
        dir="ltr"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://..."
        className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400"
      />
      <div className="flex gap-2 justify-between">
        <button type="submit" className="btn-blue text-xs px-3 py-1.5">החל</button>
        {existing && (
          <button type="button" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose({ refocus: false }); }}
            className="text-xs text-red-600 hover:bg-red-50 rounded-md px-2 py-1.5 flex items-center gap-1">
            <Unlink size={13} aria-hidden="true" /> הסרת קישור
          </button>
        )}
      </div>
    </form>
  );
}
