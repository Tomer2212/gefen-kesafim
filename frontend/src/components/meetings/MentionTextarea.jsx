import { useEffect, useRef, useState } from "react";

// Shared typography — must be identical between overlay div and textarea
const EDITOR_STYLE = {
  fontFamily: "inherit",
  fontSize: "0.75rem",
  lineHeight: "1.5",
  padding: "0.5rem 0.6rem",
  textAlign: "right",
  direction: "rtl",
  boxSizing: "border-box",
};

function renderHighlightedText(text, users) {
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

// Controlled <textarea> with @-mention autocomplete + live highlighting. Extracted from the
// old standalone NotesModal so the same tagging UX can be reused inside the meeting-notes
// window's "new entry" composer (and any future free-text field that wants @-mentions).
// `fill` makes it stretch to the full height of its (flex) parent instead of sizing to `rows`
// — used by the meeting-notes composer so a long note is fully visible while typing, down to
// the bottom of the window, instead of being clipped to 2-3 visible lines.
export function MentionTextarea({ id, value, onChange, onBlur, users, rows = 2, autoFocus, placeholder, fill = false }) {
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const mentionListRef = useRef(null);

  function handleChange(e) {
    const newVal = e.target.value;
    onChange(newVal);
    const cursor = e.target.selectionStart;
    const textBefore = newVal.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx !== -1) {
      const afterAt = textBefore.slice(atIdx + 1);
      const query = afterAt.toLowerCase();
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
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const mention = `@${user.full_name || user.email}`;
    const newVal = value.slice(0, mentionStart) + mention + " " + value.slice(cursor);
    onChange(newVal);
    setMentionQuery(null);
    setMentionStart(null);
    setTimeout(() => {
      const pos = mentionStart + mention.length + 1;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  }

  const filteredMentions = mentionQuery !== null
    ? (users || []).filter(u => (u.full_name || u.email || "").toLowerCase().startsWith(mentionQuery)).slice(0, 8)
    : [];

  useEffect(() => { setMentionIdx(0); }, [filteredMentions.length, mentionQuery]);

  useEffect(() => {
    const item = mentionListRef.current?.children[mentionIdx];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [mentionIdx]);

  function handleKeyDown(e) {
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
      e.stopPropagation();
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  return (
    <div className="relative" style={fill ? { height: "100%", display: "flex", flexDirection: "column" } : undefined}>
      <div style={{
        position: "relative",
        border: `1.5px solid ${focused ? "#0070F3" : "#e2e8f0"}`,
        borderRadius: "0.6rem",
        background: focused ? "white" : "rgba(255,255,255,0.8)",
        boxShadow: focused ? "0 0 0 3px rgba(0,112,243,0.12)" : "none",
        transition: "all 0.18s ease",
        ...(fill ? { flex: "1 1 auto", minHeight: 0 } : null),
      }}>
        <div ref={overlayRef} aria-hidden="true" style={{
          ...EDITOR_STYLE,
          position: "absolute",
          inset: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-words",
          color: "#1e293b",
          overflow: "auto",
          pointerEvents: "none",
          borderRadius: "0.6rem",
        }}>
          {value ? renderHighlightedText(value, users) : <span style={{ color: "#94a3b8" }}>{placeholder}</span>}
        </div>
        <textarea
          ref={textareaRef}
          id={id}
          rows={rows}
          autoFocus={autoFocus}
          style={{
            ...EDITOR_STYLE,
            display: "block",
            width: "100%",
            border: 0,
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "transparent",
            caretColor: "#1e293b",
            borderRadius: "0.6rem",
            ...(fill ? { position: "absolute", inset: 0, height: "100%" } : null),
          }}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={e => { setFocused(false); onBlur?.(e); }}
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
  );
}

export { renderHighlightedText };
