import { createContext, useCallback, useContext, useRef, useState } from "react";

const CallNoteWindowsCtx = createContext(null);

export function CallNoteWindowsProvider({ children }) {
  // Multiple call-note windows (summary/transcript) can be open at once — each is
  // independent, mirroring the comparison-window pattern (see CompareChecksContext).
  const [windows, setWindows] = useState([]); // [{ id, data, minimized }]
  const idRef = useRef(0);

  const openCallNote = useCallback((data) => {
    const id = ++idRef.current;
    setWindows(prev => [...prev, { id, data, minimized: false }]);
    return id;
  }, []);

  const closeCallNote = useCallback((id) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const setMinimized = useCallback((id, minimized) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, minimized } : w)));
  }, []);

  return (
    <CallNoteWindowsCtx.Provider value={{ windows, openCallNote, closeCallNote, setMinimized }}>
      {children}
    </CallNoteWindowsCtx.Provider>
  );
}

export const useCallNoteWindows = () => useContext(CallNoteWindowsCtx);
