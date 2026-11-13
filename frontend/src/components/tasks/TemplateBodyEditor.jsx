import { useEffect, useMemo, useRef, useState } from "react";
import { RichNoteEditor } from "../meetings/RichNoteEditor";
import {
  ALLOW_TAG_REMOVAL, createTemplateTag, plainTemplateToHtml, refreshTemplateTags, tagsToTokens, tokensToTags,
} from "./templateTag";

// The task message body: the meeting notes' rich editor (same toolbar, minus the @-tag — a
// school can't be notified) plus placeholder tags, resizable downwards. Emits
// onChange({ text, html }):
//   text — the plain template with {placeholder} tokens, exactly what the backend substituted
//          before formatting existed (message_config.body_template; WhatsApp, validation).
//   html — the same body with its formatting (message_config.body_html), tokens as literal
//          "{key}" text; "" when empty.
// `value` / `html` are those two as last saved / loaded; a template that only has plain text
// (built-in ones, templates saved earlier) opens as one paragraph per line. "critical" tags
// (booking_link / meetings_list) can't be removed — see templateTag.js — and are put back at
// the end of a loaded template that lacks them.
export default function TemplateBodyEditor({ value, html, onChange, badges, ariaLabel, height = 280 }) {
  const [editor, setEditor] = useState(null);
  const [warning, setWarning] = useState("");
  const warningTimeoutRef = useRef(null);
  const lastEmittedRef = useRef(null);
  const badgesRef = useRef(badges);
  badgesRef.current = badges;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function showWarning(text) {
    setWarning(text);
    clearTimeout(warningTimeoutRef.current);
    warningTimeoutRef.current = setTimeout(() => setWarning(""), 4000);
  }
  const showWarningRef = useRef(showWarning);
  showWarningRef.current = showWarning;

  useEffect(() => () => clearTimeout(warningTimeoutRef.current), []);

  const extensions = useMemo(() => [
    createTemplateTag({ getBadges: () => badgesRef.current, onBlocked: msg => showWarningRef.current(msg) }),
  ], []);

  function current(ed) {
    return {
      text: ed.getText({ blockSeparator: "\n" }),
      html: ed.isEmpty ? "" : tagsToTokens(ed.getHTML()),
    };
  }

  function emit(out) {
    lastEmittedRef.current = out;
    onChangeRef.current?.(out);
  }

  function appendMissingCritical(ed) {
    const text = ed.getText();
    const missing = (badgesRef.current || []).filter(b => b.critical && !text.includes(`{${b.key}}`));
    if (missing.length === 0) return;
    ed.chain().setMeta(ALLOW_TAG_REMOVAL, true).insertContentAt(
      ed.state.doc.content.size,
      missing.map(b => ({ type: "paragraph", content: [{ type: "templateTag", attrs: { key: b.key } }] })),
      { updateSelection: false },
    ).run();
  }

  // Loads a body that came from outside (a template was picked, the wizard reopened this
  // step) — never our own emitted change, which the editor already shows.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const last = lastEmittedRef.current;
    if (last && last.text === (value || "") && last.html === (html || "")) return;
    // An empty body stays empty: the wizard may be about to fill in its built-in template in
    // the same render, and bare critical tags emitted first could clobber it.
    const hasContent = !!html || (value || "").trim() !== "";
    const source = html || plainTemplateToHtml(value || "");
    editor.chain().setMeta(ALLOW_TAG_REMOVAL, true)
      .setContent(hasContent ? tokensToTags(source) : "", { emitUpdate: false }).run();
    if (hasContent) appendMissingCritical(editor);
    const out = current(editor);
    lastEmittedRef.current = out;
    if (out.text !== (value || "") || out.html !== (html || "")) emit(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value, html]);

  // Labels follow the recipient choice; a change of task type may add a critical tag.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    refreshTemplateTags(editor, badges);
    if (editor.getText().trim()) appendMissingCritical(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, JSON.stringify(badges || [])]);

  function insertBadge(badge) {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: "templateTag", attrs: { key: badge.key } }).run();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {(badges || []).map(b => (
          <button
            key={b.key}
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => insertBadge(b)}
            title={b.critical ? "תגית חובה — תתווסף אוטומטית אם תימחק" : "לחצו כדי להוסיף לנקודת הסמן"}
            className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
              b.critical
                ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}
          >
            + {b.critical ? "🔒 " : ""}{b.label}
          </button>
        ))}
      </div>

      <RichNoteEditor
        id="task-message-body"
        ariaLabel={ariaLabel || "תוכן ההודעה"}
        value=""
        onChange={({ html: edHtml, text }) => emit({ text, html: edHtml ? tagsToTokens(edHtml) : "" })}
        onReady={setEditor}
        users={[]}
        enableMentions={false}
        extraExtensions={extensions}
        contentClassName="rich-note-email"
        placeholder="כתבו כאן את תוכן ההודעה..."
        height={height}
        resizable
        minHeight={180}
      />

      {warning && (
        <p role="alert" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {warning}
        </p>
      )}
    </div>
  );
}
