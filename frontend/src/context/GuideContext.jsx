import { createContext, useCallback, useContext, useRef, useState } from "react";

const GuideCtx = createContext(null);

export function GuideProvider({ children }) {
  // Multiple guide windows can be open at once, each independent — mirrors
  // CompareChecksContext's pattern so the window survives page navigation
  // (it's rendered at the App layout root, not inside any single page).
  const [guideWindows, setGuideWindows] = useState([]); // [{ id, guideKey, minimized }]
  const idRef = useRef(0);

  const openGuide = useCallback((guideKey) => {
    const id = ++idRef.current;
    setGuideWindows(prev => [...prev, { id, guideKey, minimized: false }]);
    return id;
  }, []);

  const closeGuide = useCallback((id) => {
    setGuideWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const setMinimized = useCallback((id, minimized) => {
    setGuideWindows(prev => prev.map(w => (w.id === id ? { ...w, minimized } : w)));
  }, []);

  return (
    <GuideCtx.Provider value={{ guideWindows, openGuide, closeGuide, setMinimized }}>
      {children}
    </GuideCtx.Provider>
  );
}

export const useGuide = () => useContext(GuideCtx);
