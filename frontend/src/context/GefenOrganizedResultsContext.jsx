import { createContext, useCallback, useContext, useRef, useState } from "react";

const Ctx = createContext(null);

// Single persistent "last check" result window — survives navigation across the
// app (rendered outside <Outlet /> in App.jsx), mirroring CompareChecksContext's
// pattern for the "השוואה בין בדיקות" window.
export function GefenOrganizedResultsProvider({ children }) {
  const [result, setResult] = useState(null); // { id, displayRows, exportRows, checkedAt, academicYear, minimized }
  const idRef = useRef(0);

  const openResults = useCallback((data) => {
    const id = ++idRef.current;
    setResult({ id, minimized: false, ...data });
  }, []);

  const closeResults = useCallback(() => setResult(null), []);

  const setMinimized = useCallback((minimized) => {
    setResult(prev => (prev ? { ...prev, minimized } : prev));
  }, []);

  return (
    <Ctx.Provider value={{ result, openResults, closeResults, setMinimized }}>
      {children}
    </Ctx.Provider>
  );
}

export const useGefenOrganizedResults = () => useContext(Ctx);
