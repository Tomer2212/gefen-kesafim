import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 20000;

/**
 * Periodically re-runs refetchFn while enabled, paused while the tab is
 * backgrounded and re-fetched immediately on refocus (matches the
 * visibilitychange pattern already used in Sidebar.jsx).
 */
export function useMeetingsPolling(refetchFn, enabled, deps = []) {
  const savedRefetch = useRef(refetchFn);
  savedRefetch.current = refetchFn;

  useEffect(() => {
    if (!enabled) return;
    let intervalId = null;
    const start = () => {
      if (!intervalId) intervalId = setInterval(() => savedRefetch.current(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        savedRefetch.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
