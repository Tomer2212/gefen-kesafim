import { createContext, useCallback, useContext, useState } from "react";

const TasksCtx = createContext(null);

export function TasksProvider({ children }) {
  // Multiple task panels can be open at once, each independent — mirrors
  // CompareChecksContext.jsx. Keyed by taskId (tasks are persisted rows, unlike the
  // ephemeral compare-window data), so opening the same task twice just refocuses it.
  const [taskWindows, setTaskWindows] = useState([]); // [{ taskId, minimized }]

  const openTask = useCallback((taskId) => {
    setTaskWindows(prev =>
      prev.some(w => w.taskId === taskId)
        ? prev.map(w => (w.taskId === taskId ? { ...w, minimized: false } : w))
        : [...prev, { taskId, minimized: false }]
    );
  }, []);

  const closeTask = useCallback((taskId) => {
    setTaskWindows(prev => prev.filter(w => w.taskId !== taskId));
  }, []);

  const setMinimized = useCallback((taskId, minimized) => {
    setTaskWindows(prev => prev.map(w => (w.taskId === taskId ? { ...w, minimized } : w)));
  }, []);

  return (
    <TasksCtx.Provider value={{ taskWindows, openTask, closeTask, setMinimized }}>
      {children}
    </TasksCtx.Provider>
  );
}

export const useTasks = () => useContext(TasksCtx);
