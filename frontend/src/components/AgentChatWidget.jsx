import { useEffect, useRef, useState } from "react";
import axios from "axios";
import ChatMessage from "./ChatMessage";

// Fork of ChatWidget.jsx (מדריך גפן) — identical floating panel behavior (minimize/expand,
// resize, positioning style), but talks to POST /agent/ask (Claude tool-use, non-streaming)
// instead of the SSE-streaming /chatbot/ask, and wires structured filter results back into
// the admin schools/meetings tables instead of just rendering text.

const MIN_WIDTH = 300;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 460;

export default function AgentChatWidget({
  activeTab,
  setAdminColumnFilters,
  setAdminSearchQuery,
  setAdminSortKey,
  setAdminSortDir,
  adminMeetingsRef,
  onNavigateToTab,
}) {
  const [messages, setMessages] = useState([]);
  const [minimized, setMinimized] = useState(true);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [draftId, setDraftId] = useState(null);
  const [lastBookingSummary, setLastBookingSummary] = useState(null);
  const listRef = useRef(null);
  const resizeRef = useRef(null);

  function startResize(e) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }
  function onResize(e) {
    const r = resizeRef.current;
    if (!r) return;
    setSize({
      // Panel is anchored bottom-right (right/bottom CSS), so it grows leftward with the
      // drag's inverted X delta and upward with the drag's inverted Y delta.
      width: Math.max(MIN_WIDTH, r.origW + (r.startX - e.clientX)),
      height: Math.max(MIN_HEIGHT, r.origH + (r.startY - e.clientY)),
    });
  }
  function stopResize() {
    resizeRef.current = null;
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  function applyFilterInstruction(instruction) {
    if (!instruction) return;
    if (instruction.target === "schools") {
      setAdminColumnFilters(instruction.filters || {});
      if (instruction.search !== null && instruction.search !== undefined) setAdminSearchQuery(instruction.search);
      if (instruction.sort) {
        setAdminSortKey(instruction.sort.key);
        setAdminSortDir(instruction.sort.dir || "asc");
      } else {
        setAdminSortKey(null);
      }
      onNavigateToTab?.("schools");
    } else if (instruction.target === "meetings") {
      adminMeetingsRef?.current?.applyAgentFilters?.(instruction.filters || {});
      onNavigateToTab?.("meetings");
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isSending) return;
    setError("");
    setInput("");

    // History sent to the backend on every call (mirrors ChatWidget.jsx/chatbot_router.py) so
    // Claude has multi-turn context for the booking flow (e.g. resolving "לבית ספר X" from an
    // earlier reply). The last-16 bound matches the backend's MAX_HISTORY_MESSAGES.
    const history = messages.slice(-16).map(({ role, content }) => ({ role, content }));
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setIsSending(true);

    try {
      const resp = await axios.post("/agent/ask", {
        message: text,
        active_tab: activeTab || null,
        history,
        draft_id: draftId,
      });
      const { reply_text, filter_instruction, draft_id, booking_summary } = resp.data || {};
      setMessages(prev => [...prev, { role: "assistant", content: reply_text || "בוצע." }]);
      applyFilterInstruction(filter_instruction);
      if (draft_id !== undefined) setDraftId(draft_id);
      setLastBookingSummary(booking_summary || null);
    } catch (err) {
      if (err?.response?.status === 429) {
        setError(err.response?.data?.detail || "הגעת למכסת השימוש היומית בעוזר, נסה שוב מחר");
      } else if (err?.response?.status === 403) {
        setError("אין הרשאה להשתמש בעוזר");
      } else {
        setError("אירעה שגיאה בקבלת תשובה מהעוזר. נסה שוב.");
      }
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        dir="rtl"
        aria-label="פתח את סוכן הניהול"
        style={{ position: "fixed", right: 16, bottom: 88, zIndex: 60 }}
        className="glass-card rounded-full w-14 h-14 shadow-lg flex items-center justify-center hover:shadow-xl transition-shadow bg-blue-600"
      >
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a2 2 0 0 1 2 2v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1V5a2 2 0 0 1 2-2z" />
          <circle cx="9" cy="12" r="1" fill="#fff" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="#fff" stroke="none" />
          <line x1="4" y1="11" x2="4" y2="15" />
          <line x1="20" y1="11" x2="20" y2="15" />
        </svg>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="חלון צ'אט עם סוכן ניהול"
      dir="rtl"
      style={{ position: "fixed", right: 16, bottom: 88, width: size.width, height: size.height, zIndex: 60, background: "#ffffff" }}
      className="rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0"
        style={{ background: "#f1f5f9" }}
      >
        <div className="text-sm font-bold text-slate-800">סוכן ניהול</div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="מזער צ'אט"
          className="text-slate-400 hover:text-slate-700 transition-colors"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="19" x2="19" y2="19" />
          </svg>
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-4">
            בקש ממני לסנן או למיין את טבלת בתי הספר או הפגישות — למשל "תראה לי בתי ספר בעיר תל אביב שחוזה טרם נשלח להם"
          </p>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} role={m.role} content={m.content} />
        ))}
        {lastBookingSummary && lastBookingSummary.schools?.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700">
            <p className="font-semibold text-slate-800 mb-1.5">
              סיכום אצווה{lastBookingSummary.status ? ` (${lastBookingSummary.status})` : ""}:
            </p>
            {lastBookingSummary.default_scheduling_window && (
              <p className="text-slate-500 mb-1.5">
                חלון ברירת מחדל: {lastBookingSummary.default_scheduling_window.start_hour}:00-{lastBookingSummary.default_scheduling_window.end_hour}:00,
                {" "}{lastBookingSummary.default_scheduling_window.duration_minutes} דק'
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {lastBookingSummary.schools.map(s => (
                <li key={s.school_id} className="flex items-center justify-between gap-2">
                  <span>{s.school_name} · {s.missing_months.join(", ")}</span>
                  <span className={s.resolved_advisor_name ? "text-green-700" : "text-orange-600 font-medium"}>
                    {s.resolved_advisor_name || "ממתין לפתרון יועץ"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isSending && (
          <div role="status" aria-label="הסוכן חושב" className="flex items-center gap-1.5 px-3.5 py-2 text-xs text-slate-400">
            <span className="spinner w-3 h-3" aria-hidden="true" />
            הסוכן חושב...
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-slate-200 p-2.5 flex items-end gap-2 flex-shrink-0">
        <label htmlFor="agent-widget-input" className="sr-only">הקלד בקשת סינון</label>
        <textarea
          id="agent-widget-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="בקש סינון..."
          disabled={isSending}
          className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={isSending || !input.trim()}
          aria-label="שלח הודעה"
          className="rounded-xl bg-blue-600 text-white w-9 h-9 flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>

      {/* Resize handle — panel is anchored bottom-right, so this sits at the opposite (top-left) corner */}
      <div
        onMouseDown={startResize}
        aria-hidden="true"
        className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize"
        style={{ touchAction: "none" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", top: 2, left: 2 }}>
          <path d="M12 12 L2 2 M7 12 L2 7" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
