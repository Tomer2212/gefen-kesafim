import { createContext, useCallback, useContext, useRef, useState } from "react";

const MeetingNotesCtx = createContext(null);

export function MeetingNotesProvider({ children }) {
  // Multiple notes windows can be open at once (different meetings) — each is independent,
  // same append-only-ordered array pattern as CompareChecksContext.
  const [noteWindows, setNoteWindows] = useState([]); // [{ id, meetingId, schoolId, schoolName, schoolAuthority, schoolSymbol, highlightNoteId, minimized }]
  const idRef = useRef(0);

  const openMeetingNotes = useCallback((info) => {
    setNoteWindows(prev => {
      // Reopening notes for a meeting that's already open just brings that window back
      // (un-minimizes it, applies a fresh highlight target) instead of stacking duplicates.
      const existing = prev.find(w => w.meetingId === info.meetingId);
      if (existing) {
        return prev.map(w => w.id === existing.id
          ? { ...w, ...info, minimized: false }
          : w);
      }
      const id = ++idRef.current;
      return [...prev, { id, minimized: false, ...info }];
    });
  }, []);

  const closeMeetingNotes = useCallback((id) => {
    setNoteWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const setMinimized = useCallback((id, minimized) => {
    setNoteWindows(prev => prev.map(w => (w.id === id ? { ...w, minimized } : w)));
  }, []);

  return (
    <MeetingNotesCtx.Provider value={{ noteWindows, openMeetingNotes, closeMeetingNotes, setMinimized }}>
      {children}
    </MeetingNotesCtx.Provider>
  );
}

export const useMeetingNotes = () => useContext(MeetingNotesCtx);
