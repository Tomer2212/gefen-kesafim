import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap(onEscape) {
  const ref = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const firstFocusable = ref.current?.querySelectorAll(FOCUSABLE)?.[0];
    firstFocusable?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  function handleKeyDown(e) {
    if (e.key === "Escape") { onEscape(); return; }
    if (e.key !== "Tab") return;
    const nodes = [...(ref.current?.querySelectorAll(FOCUSABLE) ?? [])];
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { ref, handleKeyDown };
}
