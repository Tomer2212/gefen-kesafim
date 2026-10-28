import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import axios from "axios";

const CalendarSyncCtx = createContext(null);

const POLL_INTERVAL_MS = 8000;

export function CalendarSyncProvider({ children }) {
  // Multiple import batches can be tracked at once (e.g. the user imports again before an
  // earlier batch finished draining) — each window polls independently. syncWindows is an
  // append-only-ordered array, same pattern as CompareChecksContext.
  const [syncWindows, setSyncWindows] = useState([]); // [{ id, batchId, minimized, data, error }]
  const idRef = useRef(0);
  const pollersRef = useRef({}); // id -> interval handle

  const stopPolling = useCallback((id) => {
    if (pollersRef.current[id]) {
      clearInterval(pollersRef.current[id]);
      delete pollersRef.current[id];
    }
  }, []);

  const pollOnce = useCallback(async (id, batchId) => {
    try {
      const { data } = await axios.get(`/schools/meetings/import/${batchId}/calendar-sync-status`);
      setSyncWindows(prev => prev.map(w => (w.id === id ? { ...w, data, error: null } : w)));
      if (data.is_complete) stopPolling(id);
    } catch {
      // The backend never raises for this endpoint (it returns a safe { unavailable: true } /
      // { not_found: true } payload instead — see get_calendar_sync_status) — reaching this
      // catch means a network-level failure (no connection, CORS, etc.), not a status this
      // endpoint itself returns. Never fatal to the underlying sync (which runs entirely
      // server-side via cron) — just surface it and keep retrying on the next tick.
      setSyncWindows(prev => prev.map(w => (w.id === id ? { ...w, error: "poll_failed" } : w)));
    }
  }, [stopPolling]);

  const openCalendarSync = useCallback((batchId) => {
    const id = ++idRef.current;
    setSyncWindows(prev => [...prev, { id, batchId, minimized: false, data: null, error: null }]);
    pollOnce(id, batchId);
    pollersRef.current[id] = setInterval(() => pollOnce(id, batchId), POLL_INTERVAL_MS);
    return id;
  }, [pollOnce]);

  const closeCalendarSync = useCallback((id) => {
    stopPolling(id);
    setSyncWindows(prev => prev.filter(w => w.id !== id));
  }, [stopPolling]);

  const setMinimized = useCallback((id, minimized) => {
    setSyncWindows(prev => prev.map(w => (w.id === id ? { ...w, minimized } : w)));
  }, []);

  useEffect(() => () => {
    Object.values(pollersRef.current).forEach(clearInterval);
  }, []);

  return (
    <CalendarSyncCtx.Provider value={{ syncWindows, openCalendarSync, closeCalendarSync, setMinimized }}>
      {children}
    </CalendarSyncCtx.Provider>
  );
}

export const useCalendarSync = () => useContext(CalendarSyncCtx);
