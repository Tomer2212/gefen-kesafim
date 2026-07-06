import { createContext, useCallback, useContext, useRef, useState } from "react";

const CompareChecksCtx = createContext(null);

export function CompareChecksProvider({ children }) {
  // Multiple comparison windows can be open at once — each is independent:
  // closing/minimizing one never affects the others. compareWindows is an
  // append-only-ordered array (new comparisons are pushed to the end).
  const [compareWindows, setCompareWindows] = useState([]); // [{ id, data, minimized }]
  const idRef = useRef(0);

  const openCompare = useCallback((data) => {
    const id = ++idRef.current;
    setCompareWindows(prev => [...prev, { id, data, minimized: false }]);
    return id;
  }, []);

  const closeCompare = useCallback((id) => {
    setCompareWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const setMinimized = useCallback((id, minimized) => {
    setCompareWindows(prev => prev.map(w => (w.id === id ? { ...w, minimized } : w)));
  }, []);

  // Merges into a specific window's data. `updater` is either a partial
  // object or a function (data) => partial. No-ops if the window was already
  // closed by the time an async response (e.g. /analyze/compare-plans) arrives.
  const patchCompare = useCallback((id, updater) => {
    setCompareWindows(prev => prev.map(w => {
      if (w.id !== id) return w;
      const partial = typeof updater === "function" ? updater(w.data) : updater;
      return { ...w, data: { ...w.data, ...partial } };
    }));
  }, []);

  return (
    <CompareChecksCtx.Provider value={{ compareWindows, openCompare, closeCompare, setMinimized, patchCompare }}>
      {children}
    </CompareChecksCtx.Provider>
  );
}

export const useCompareChecks = () => useContext(CompareChecksCtx);
