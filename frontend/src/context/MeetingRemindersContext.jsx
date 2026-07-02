import { createContext, useCallback, useContext, useEffect, useState } from "react";

const MeetingRemindersCtx = createContext(null);

export function MeetingRemindersProvider({ children }) {
  const [reminders, setReminders] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [userName, setUserName] = useState("");

  // When active popup is dismissed, auto-activate the first remaining
  useEffect(() => {
    if (!reminders.length) {
      setActiveKey(null);
    } else if (!reminders.some(r => r._key === activeKey)) {
      setActiveKey(reminders[0]._key);
    }
  }, [reminders, activeKey]);

  const addMeetingReminder = useCallback((m) => {
    const key = `reminder-${m.id}`;
    setReminders(prev => {
      if (prev.some(r => r._key === key)) return prev;
      return [...prev, { ...m, _type: "reminder", _key: key }];
    });
    // First reminder becomes active; subsequent ones stack as collapsed headers
    setActiveKey(prev => prev ?? key);
  }, []);

  const addStatusReminder = useCallback((m) => {
    const key = `status-${m.id}`;
    setReminders(prev => {
      if (prev.some(r => r._key === key)) return prev;
      return [...prev, { ...m, _type: "status", _key: key }];
    });
    setActiveKey(prev => prev ?? key);
  }, []);

  const dismiss = useCallback((key) => {
    setReminders(prev => prev.filter(r => r._key !== key));
  }, []);

  return (
    <MeetingRemindersCtx.Provider value={{
      reminders, activeKey, setActiveKey,
      addMeetingReminder, addStatusReminder, dismiss,
      userName, setUserName,
    }}>
      {children}
    </MeetingRemindersCtx.Provider>
  );
}

export const useMeetingReminders = () => useContext(MeetingRemindersCtx);
