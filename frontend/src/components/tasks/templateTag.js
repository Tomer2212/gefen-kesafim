import { Node } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// Placeholder tags ({school_name}, 🔒 {booking_link}, ...) inside the rich task-message editor.
// In the editor a tag is an inline atom rendered as the familiar badge; in everything the editor
// hands out it is the literal "{key}" text the backend substitutes at send time (getText via
// renderText, and the stored HTML via tagsToTokens). The last copy of a "critical" tag can never
// be removed: a transaction that would drop it is rejected outright, however it was attempted
// (Backspace, Delete, cut, select-all + typing, drag), and onBlocked shows why.

export const CHIP_BASE_CLASS =
  "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mx-0.5 align-middle select-none";
const CHIP_NORMAL_CLASS = "bg-blue-50 text-blue-700";
const CHIP_CRITICAL_CLASS = "bg-amber-100 text-amber-800";

export const ALLOW_TAG_REMOVAL = "allowTemplateTagRemoval";

function chipLabel(badge, key) {
  return badge ? `${badge.critical ? "🔒 " : ""}${badge.label}` : key;
}

function paintChip(dom, badge, key) {
  dom.className = `${CHIP_BASE_CLASS} ${badge?.critical ? CHIP_CRITICAL_CLASS : CHIP_NORMAL_CLASS}`;
  dom.textContent = chipLabel(badge, key);
  if (badge?.critical) dom.title = "תגית חובה — לא ניתנת להסרה";
  else dom.removeAttribute("title");
}

function countCritical(doc, criticalKeys) {
  const counts = {};
  doc.descendants(node => {
    if (node.type.name === "templateTag" && criticalKeys.has(node.attrs.key)) {
      counts[node.attrs.key] = (counts[node.attrs.key] || 0) + 1;
    }
  });
  return counts;
}

// getBadges() returns the current badge list (labels change with the recipient choice);
// onBlocked(message) is called when a removal of a critical tag was refused.
export function createTemplateTag({ getBadges, onBlocked }) {
  const badgeFor = key => (getBadges() || []).find(b => b.key === key);
  return Node.create({
    name: "templateTag",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return { key: { default: null } };
    },

    parseHTML() {
      return [{ tag: "span[data-badge-key]", getAttrs: el => ({ key: el.getAttribute("data-badge-key") }) }];
    },

    renderHTML({ node }) {
      return ["span", { "data-badge-key": node.attrs.key }, chipLabel(badgeFor(node.attrs.key), node.attrs.key)];
    },

    renderText({ node }) {
      return `{${node.attrs.key}}`;
    },

    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.badgeKey = node.attrs.key;
        paintChip(dom, badgeFor(node.attrs.key), node.attrs.key);
        return {
          dom,
          // Labels are repainted from outside (refreshTemplateTags) — not a document change.
          ignoreMutation: () => true,
        };
      };
    },

    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey("templateTagGuard"),
        filterTransaction(tr, state) {
          if (!tr.docChanged || tr.getMeta(ALLOW_TAG_REMOVAL)) return true;
          const criticalKeys = new Set((getBadges() || []).filter(b => b.critical).map(b => b.key));
          if (criticalKeys.size === 0) return true;
          const before = countCritical(state.doc, criticalKeys);
          const after = countCritical(tr.doc, criticalKeys);
          // Only the last copy is protected — an extra one (inserted twice) can be removed.
          const removed = Object.keys(before).some(k => !after[k]);
          if (removed) onBlocked?.("לא ניתן להסיר תגית חובה — היא נדרשת לשליחת הבקשה.");
          return !removed;
        },
      })];
    },
  });
}

// Repaints every tag's label/colour in the editor DOM (e.g. after the recipient changed).
export function refreshTemplateTags(editor, badges) {
  if (!editor || editor.isDestroyed) return;
  editor.view.dom.querySelectorAll("[data-badge-key]").forEach(el => {
    const key = el.dataset.badgeKey;
    paintChip(el, (badges || []).find(b => b.key === key), key);
  });
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Stored HTML ("{key}" text) → editor HTML (tag spans). Only text nodes are touched, so a
// "{...}" that happens to sit in an attribute is left alone.
export function tokensToTags(html) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const t of textNodes) {
    if (!/\{\w+\}/.test(t.textContent)) continue;
    const frag = document.createDocumentFragment();
    t.textContent.split(/(\{\w+\})/).forEach(part => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) {
        const span = document.createElement("span");
        span.setAttribute("data-badge-key", m[1]);
        span.textContent = m[1];
        frag.appendChild(span);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    t.replaceWith(frag);
  }
  return root.innerHTML;
}

// Editor HTML (tag spans) → stored HTML ("{key}" text).
export function tagsToTokens(html) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  root.querySelectorAll("span[data-badge-key]").forEach(el => {
    el.replaceWith(document.createTextNode(`{${el.getAttribute("data-badge-key")}}`));
  });
  return root.innerHTML;
}

// A plain template (built-in / saved before formatting existed): one paragraph per line, the
// same way the meeting notes convert legacy plain text (RichNoteView.plainTextToHtml).
export function plainTemplateToHtml(text) {
  return (text || "").split("\n").map(line => `<p>${escapeHtml(line)}</p>`).join("");
}
