import { useEffect, useRef } from "react";

// A date range the user picked, remembered until the next 07:00 — after that the default
// (today only) comes back. Used by the personal area's "פגישות" and "שיחות" tabs.

const RESET_HOUR = 7;

// Local date (not toISOString, which is UTC — after midnight in Israel it still says yesterday).
export function localToday() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayRange = () => ({ from: localToday(), to: localToday() });

// The most recent 07:00 that has already passed (before 07:00 → yesterday's).
function lastResetBoundary(now = new Date()) {
  const b = new Date(now);
  b.setHours(RESET_HOUR, 0, 0, 0);
  if (b > now) b.setDate(b.getDate() - 1);
  return b.getTime();
}

// True when a range set at `setAt` (ms) belongs to an earlier day — for a page left open overnight.
export const rangeExpired = setAt => setAt < lastResetBoundary();

const storageKey =(name, userId) => `daily_range:${name}:${userId || "anon"}`;

// {from, to} if the user picked it since the last 07:00, else null.
export function readDailyRange(name, userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(name, userId)) || "null");
    if (!saved?.from || !saved?.to || !(saved.savedAt >= lastResetBoundary())) return null;
    return { from: saved.from, to: saved.to };
  } catch {
    return null;
  }
}

export function saveDailyRange(name, userId, range) {
  try {
    localStorage.setItem(storageKey(name, userId), JSON.stringify({ from: range.from, to: range.to, savedAt: Date.now() }));
  } catch { /* ignore */ }
}

export function clearDailyRange(name, userId) {
  try { localStorage.removeItem(storageKey(name, userId)); } catch { /* ignore */ }
}

// A page left open overnight: when the window is shown again after 07:00, calls onReset if the
// range on screen was set before that 07:00. setAtRef holds when the range was last set (ms).
export function useResetRangeOnNewDay(setAtRef, onReset) {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  useEffect(() => {
    function check() {
      if (document.visibilityState === "visible" && rangeExpired(setAtRef.current)) onResetRef.current();
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [setAtRef]);
}
