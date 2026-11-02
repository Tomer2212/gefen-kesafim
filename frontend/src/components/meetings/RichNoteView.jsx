import { useMemo } from "react";
import createDOMPurify from "dompurify";

// Mirrors the backend allowlist (_sanitize_note_html in schools_router.py) — the server already
// cleans every saved note; this is the second layer, so a bad row can never render as live HTML.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "span", "mark", "a", "h1", "h2", "h3",
    "ul", "ol", "li", "blockquote", "hr", "table", "colgroup", "col", "tbody", "thead", "tr", "th", "td", "label", "input", "div"],
  ALLOWED_ATTR: ["style", "dir", "href", "target", "rel", "class", "colspan", "rowspan", "data-type", "data-checked",
    "data-id", "data-label", "data-mention-suggestion-char", "data-color", "type", "checked", "disabled", "start"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

// A dedicated instance, so these hooks never leak into any other DOMPurify use in the app.
const purifier = createDOMPurify(window);
purifier.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Task-list checkboxes are display-only outside the editor.
  if (node.tagName === "INPUT") {
    node.setAttribute("type", "checkbox");
    node.setAttribute("disabled", "");
  }
});

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Legacy notes are plain text with "\n" line breaks — turn each line into a paragraph so they
// open in RichNoteEditor looking exactly as they were displayed.
export function plainTextToHtml(text) {
  return (text || "").split("\n").map(line => `<p>${escapeHtml(line)}</p>`).join("");
}

// Displays a saved meeting note: the sanitized rich HTML when the note has one, otherwise the
// legacy plain text exactly as before (line breaks kept).
export function RichNoteView({ html, text, className = "" }) {
  const clean = useMemo(() => (html ? purifier.sanitize(html, PURIFY_CONFIG) : null), [html]);

  if (clean === null) {
    return <span className={className} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</span>;
  }
  return <div className={`rich-note ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
