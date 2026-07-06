import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function NotesModal({ notes, onSave, onClose, users }) {
  const [val, setVal] = useState(notes || "");
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const mentionListRef = useRef(null);
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  // Shared typography — must be identical between overlay div and textarea
  const editorStyle = {
    fontFamily: "inherit",
    fontSize: "0.875rem",
    lineHeight: "1.5",
    padding: "0.75rem 1rem",
    textAlign: "right",
    direction: "rtl",
    boxSizing: "border-box",
  };

  function handleChange(e) {
    const newVal = e.target.value;
    setVal(newVal);
    const cursor = e.target.selectionStart;
    const textBefore = newVal.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx !== -1) {
      const afterAt = textBefore.slice(atIdx + 1);
      const query = afterAt.toLowerCase();
      // Allow multi-word names: trigger if query is a prefix of any user name
      const hasMatch = query === "" || (users || []).some(u =>
        (u.full_name || u.email || "").toLowerCase().startsWith(query)
      );
      if (hasMatch) {
        setMentionQuery(query);
        setMentionStart(atIdx);
        return;
      }
    }
    setMentionQuery(null);
    setMentionStart(null);
  }

  function selectMention(user) {
    const cursor = textareaRef.current?.selectionStart ?? val.length;
    const mention = `@${user.full_name || user.email}`;
    const newVal = val.slice(0, mentionStart) + mention + " " + val.slice(cursor);
    setVal(newVal);
    setMentionQuery(null);
    setMentionStart(null);
    setTimeout(() => {
      const pos = mentionStart + mention.length + 1;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  }

  function extractMentionedIds(text) {
    const ids = [];
    for (const u of (users || [])) {
      const name = u.full_name || u.email || "";
      if (name && text.includes(`@${name}`)) ids.push(u.id);
    }
    return [...new Set(ids)];
  }

  function renderHighlightedText(text) {
    const allNames = (users || [])
      .map(u => u.full_name || u.email || "")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length); // longest first → greedy match
    if (!allNames.length) return <span>{text}</span>;
    const escaped = allNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`@(${escaped.join("|")})`, "g");
    const parts = [];
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, match.index)}</span>);
      parts.push(<span key={`m-${match.index}`} style={{ color: "#2563eb", fontWeight: 600 }}>{match[0]}</span>);
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
    return parts;
  }

  const filteredMentions = mentionQuery !== null
    ? (users || []).filter(u => (u.full_name || u.email || "").toLowerCase().startsWith(mentionQuery)).slice(0, 8)
    : [];

  // Reset highlighted index when dropdown list changes
  useEffect(() => { setMentionIdx(0); }, [filteredMentions.length, mentionQuery]);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = mentionListRef.current?.children[mentionIdx];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [mentionIdx]);

  function handleTextareaKeyDown(e) {
    if (filteredMentions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIdx(i => (i + 1) % filteredMentions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectMention(filteredMentions[mentionIdx]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); // don't let this close the modal too
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="notes-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4">
        <h2 id="notes-modal-title" className="font-bold text-slate-900">הערות לפגישה</h2>
        <div className="relative">
          <label htmlFor="notes-textarea" className="sr-only">הערות</label>
          {/* Wrapper provides the visual border + focus ring */}
          <div style={{
            position: "relative",
            border: `1.5px solid ${focused ? "#0070F3" : "#e2e8f0"}`,
            borderRadius: "0.75rem",
            background: focused ? "white" : "rgba(255,255,255,0.8)",
            boxShadow: focused ? "0 0 0 3px rgba(0,112,243,0.12)" : "none",
            transition: "all 0.18s ease",
          }}>
            {/* Highlight overlay: renders @mentions in blue, sits behind the textarea */}
            <div ref={overlayRef} aria-hidden="true" style={{
              ...editorStyle,
              position: "absolute",
              inset: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-words",
              color: "#1e293b",
              overflow: "hidden",
              pointerEvents: "none",
              borderRadius: "0.75rem",
            }}>
              {val
                ? renderHighlightedText(val)
                : <span style={{ color: "#94a3b8" }}>הכנס הערות כאן... השתמש ב-@ לתיוג משתמש</span>}
            </div>
            {/* Textarea: transparent text so overlay shows through; caret stays visible */}
            <textarea
              ref={textareaRef}
              id="notes-textarea"
              rows={6}
              style={{
                ...editorStyle,
                display: "block",
                width: "100%",
                border: 0,
                outline: "none",
                resize: "none",
                background: "transparent",
                color: "transparent",
                caretColor: "#1e293b",
                borderRadius: "0.75rem",
              }}
              value={val}
              onChange={handleChange}
              onKeyDown={handleTextareaKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onScroll={e => { if (overlayRef.current) overlayRef.current.scrollTop = e.target.scrollTop; }}
              placeholder=""
            />
          </div>
          {filteredMentions.length > 0 && (
            <div ref={mentionListRef}
              className="absolute bottom-full mb-1 right-0 left-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50 max-h-44 overflow-y-auto" role="listbox">
              {filteredMentions.map((u, i) => (
                <button key={u.id} type="button" role="option"
                  aria-selected={i === mentionIdx}
                  onMouseDown={e => { e.preventDefault(); selectMention(u); }}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={`w-full text-right px-3 py-2 text-sm text-slate-700 flex items-center gap-2 ${i === mentionIdx ? "bg-blue-50" : "hover:bg-blue-50"}`}>
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    {(u.full_name || u.email || "?")[0].toUpperCase()}
                  </span>
                  {u.full_name || u.email}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">ביטול</button>
          <button type="button" onClick={() => { onSave(val, extractMentionedIds(val)); }}
            className="btn-blue text-sm px-4 py-2">שמור הערות</button>
        </div>
      </div>
    </div>
  );
}
