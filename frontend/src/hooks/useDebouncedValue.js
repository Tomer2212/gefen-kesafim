import { useEffect, useRef, useState, useCallback } from "react";

// Returns a debounced copy of `value` that only updates `delayMs` after `value`
// stops changing. Used to keep expensive derived pipelines (filter/sort over the
// full schools list) from recomputing on every keystroke.
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

// Returns a stable function that calls `fn` at most once per `delayMs` quiet
// window. The returned function also exposes `.flush()` (run the pending call
// now) and `.cancel()` (drop it) — used by controlled autosave inputs that must
// still commit on blur / unmount.
export function useDebouncedCallback(fn, delayMs = 400) {
  const fnRef = useRef(fn);
  const timerRef = useRef(null);
  const lastArgsRef = useRef(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const debounced = useCallback((...args) => {
    lastArgsRef.current = args;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const a = lastArgsRef.current;
      lastArgsRef.current = null;
      fnRef.current(...a);
    }, delayMs);
  }, [delayMs]);

  debounced.flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastArgsRef.current) {
      const a = lastArgsRef.current;
      lastArgsRef.current = null;
      fnRef.current(...a);
    }
  }, []);

  debounced.cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastArgsRef.current = null;
  }, []);

  return debounced;
}
