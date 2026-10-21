import { useEffect, useRef, useState } from "react";

// A rich "merge tag" editor for task message bodies: the underlying value is still a plain
// template string with {placeholder} tokens (exactly what the backend substitutes at send
// time — see tasks_router.py's _apply_template), but placeholders render inline as Hebrew
// badges instead of raw "{school_name}"-style text. "critical" badges (booking_link/
// meetings_list) can never be removed from the content — they're the actual mechanism that
// gets the school to the scheduling link, so a manager accidentally deleting one would send a
// broken message. Protected two ways: (1) a keydown guard blocks Backspace/Delete from
// consuming a critical chip, (2) a self-healing check after every edit re-inserts any critical
// badge that's missing regardless of how it disappeared (cut, drag, select-all+delete, etc.) —
// the second one is the actual guarantee; the first is just a smoother no-flash UX for the
// common case.

const CHIP_BASE_CLASS =
  "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mx-0.5 align-middle select-none";
const CHIP_NORMAL_CLASS = "bg-blue-50 text-blue-700";
const CHIP_CRITICAL_CLASS = "bg-amber-100 text-amber-800";

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function badgeChipHtml(badge) {
  const cls = `${CHIP_BASE_CLASS} ${badge.critical ? CHIP_CRITICAL_CLASS : CHIP_NORMAL_CLASS}`;
  const title = badge.critical ? ` title="תגית חובה — לא ניתנת להסרה"` : "";
  return (
    `<span contenteditable="false" data-badge-key="${badge.key}"` +
    `${badge.critical ? ' data-critical="true"' : ""} class="${cls}"${title}>` +
    `${badge.critical ? "🔒 " : ""}${escapeHtml(badge.label)}</span>`
  );
}

// template string -> innerHTML string, resolving each {key} token against badgeByKey (falls
// back to the raw key if a saved template references a badge this task type no longer offers).
function templateToHtml(template, badgeByKey) {
  const re = /\{(\w+)\}/g;
  let html = "";
  let lastIndex = 0;
  let m;
  while ((m = re.exec(template))) {
    if (m.index > lastIndex) html += escapeHtml(template.slice(lastIndex, m.index)).replace(/\n/g, "<br>");
    const badge = badgeByKey[m[1]];
    html += badgeChipHtml(badge || { key: m[1], label: m[1] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < template.length) html += escapeHtml(template.slice(lastIndex)).replace(/\n/g, "<br>");
  return html;
}

// DOM -> template string. Recurses through any wrapper elements the browser inserts for line
// breaks (Chrome/Firefox differ here) so this stays robust regardless of which one the user's
// browser uses — a DIV/P boundary implies a newline, a <br> is a newline, a badge chip (by its
// data-badge-key marker) becomes {key}, everything else is plain text.
function serializeEditor(root) {
  let out = "";
  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === "BR") {
          out += "\n";
        } else if (child.dataset && child.dataset.badgeKey) {
          out += `{${child.dataset.badgeKey}}`;
        } else if (child.tagName === "DIV" || child.tagName === "P") {
          if (out && !out.endsWith("\n")) out += "\n";
          walk(child);
        } else {
          walk(child);
        }
      }
    }
  }
  walk(root);
  return out;
}

function getPrecedingNode(container, offset) {
  if (container.nodeType === Node.TEXT_NODE) {
    return offset === 0 ? container.previousSibling : null;
  }
  return offset > 0 ? container.childNodes[offset - 1] : null;
}
function getFollowingNode(container, offset) {
  if (container.nodeType === Node.TEXT_NODE) {
    return offset === container.textContent.length ? container.nextSibling : null;
  }
  return container.childNodes[offset] || null;
}
function isCriticalChip(node) {
  return !!(node && node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.critical === "true");
}

export default function TemplateBodyEditor({ value, onChange, badges, ariaLabel, minHeightClassName = "min-h-[120px]" }) {
  const editorRef = useRef(null);
  const lastEmittedRef = useRef(null);
  const savedRangeRef = useRef(null);
  const warningTimeoutRef = useRef(null);
  const [warning, setWarning] = useState("");

  const badgeByKey = Object.fromEntries((badges || []).map(b => [b.key, b]));
  const criticalBadges = (badges || []).filter(b => b.critical);

  function showWarning(text) {
    setWarning(text);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    warningTimeoutRef.current = setTimeout(() => setWarning(""), 4000);
  }

  useEffect(() => {
    if (value === lastEmittedRef.current) return; // our own emitted change, DOM already reflects it
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = templateToHtml(value || "", badgeByKey);
    // Skip the critical-badge auto-insert while the template is still genuinely empty — a
    // caller (TaskCreateWizard's own "auto-suggest the built-in template on first reaching this
    // step" effect) may be about to fill `value` with real content in this very same effect
    // flush. Auto-inserting bare badges into "" first would call onChange with a bare-badges-
    // only string that, depending on effect order, could race with (and get clobbered by, or
    // itself clobber) that other effect's setBodyTemplate call. Once `value` is genuinely
    // non-empty this guard no longer applies, and handleInput's own self-heal (not guarded —
    // see below) still protects a critical badge the user removed from otherwise-real content,
    // including deleting everything down to "".
    if ((value || "").trim() !== "") appendMissingCriticalBadges(el);
    const serialized = serializeEditor(el);
    lastEmittedRef.current = serialized;
    if (serialized !== value) onChange(serialized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, JSON.stringify((badges || []).map(b => b.key))]);

  // Keep existing chips' visible labels in sync when e.g. the "נמען" selection changes the
  // {recipient_name} badge's label — mutates text only, never touches structure, so this can't
  // disturb the cursor or trigger a re-render loop.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.querySelectorAll("[data-badge-key]").forEach(chip => {
      const badge = badgeByKey[chip.dataset.badgeKey];
      if (badge) chip.textContent = (badge.critical ? "🔒 " : "") + badge.label;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(badges || [])]);

  function appendMissingCriticalBadges(el) {
    const serialized = serializeEditor(el);
    const missing = criticalBadges.filter(b => !serialized.includes(`{${b.key}}`));
    if (missing.length === 0) return;
    const temp = document.createElement("div");
    temp.innerHTML = missing.map(b => badgeChipHtml(b)).join("<br>");
    if (el.childNodes.length > 0) el.appendChild(document.createElement("br"));
    while (temp.firstChild) el.appendChild(temp.firstChild);
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    const before = serializeEditor(el);
    const missing = criticalBadges.filter(b => !before.includes(`{${b.key}}`));
    if (missing.length > 0) {
      appendMissingCriticalBadges(el);
      showWarning("לא ניתן להסיר תגית חובה — היא נדרשת לשליחת הבקשה, והוחזרה אוטומטית.");
    }
    const serialized = serializeEditor(el);
    lastEmittedRef.current = serialized;
    onChange(serialized);
    saveSelection();
  }

  function handleKeyDown(e) {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current || !editorRef.current.contains(range.commonAncestorContainer)) return;

    if (!range.collapsed) {
      const chips = editorRef.current.querySelectorAll('[data-critical="true"]');
      for (const chip of chips) {
        if (range.intersectsNode(chip)) {
          e.preventDefault();
          showWarning("לא ניתן להסיר תגית חובה מתוך הטקסט המסומן.");
          return;
        }
      }
      return;
    }

    const adjacent = e.key === "Backspace"
      ? getPrecedingNode(range.startContainer, range.startOffset)
      : getFollowingNode(range.startContainer, range.startOffset);
    if (isCriticalChip(adjacent)) {
      e.preventDefault();
      showWarning("לא ניתן למחוק תגית זו — היא נדרשת לשליחת הבקשה.");
    }
  }

  function handleCut(e) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    const range = sel.getRangeAt(0);
    const chips = editorRef.current.querySelectorAll('[data-critical="true"]');
    for (const chip of chips) {
      if (range.intersectsNode(chip)) {
        e.preventDefault();
        showWarning("לא ניתן לגזור טקסט שמכיל תגית חובה.");
        return;
      }
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function insertBadge(badge) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    let range = savedRangeRef.current && el.contains(savedRangeRef.current.commonAncestorContainer)
      ? savedRangeRef.current.cloneRange()
      : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel.addRange(range);
    const activeRange = sel.getRangeAt(0);
    activeRange.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = badgeChipHtml(badge);
    const span = temp.firstChild;
    activeRange.insertNode(span);
    const after = document.createRange();
    after.setStartAfter(span);
    after.setEndAfter(span);
    sel.removeAllRanges();
    sel.addRange(after);
    savedRangeRef.current = after.cloneRange();
    handleInput();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {(badges || []).map(b => (
          <button
            key={b.key}
            type="button"
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

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel || "תוכן ההודעה"}
        contentEditable
        suppressContentEditableWarning
        dir="rtl"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onCut={handleCut}
        onPaste={handlePaste}
        className={`w-full text-sm border border-black rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white whitespace-pre-wrap ${minHeightClassName}`}
      />

      {warning && (
        <p role="alert" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {warning}
        </p>
      )}
    </div>
  );
}
