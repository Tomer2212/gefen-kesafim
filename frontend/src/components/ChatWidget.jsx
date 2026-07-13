import { useContext, useEffect, useRef, useState } from "react";
import { SessionContext } from "../App";
import { supabase } from "../lib/supabase";
import { useChatPersistence } from "../hooks/useChatPersistence";
import ChatMessage from "./ChatMessage";
import logoIcon from "../assets/logo-icon.png";

const API_BASE = import.meta.env.VITE_API_URL || "";

const MIN_WIDTH = 300;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 460;

export default function ChatWidget() {
  const session = useContext(SessionContext);
  const { messages, setMessages } = useChatPersistence();
  const [minimized, setMinimized] = useState(true);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
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
      // Panel is anchored bottom-left (left/bottom CSS), so it grows rightward with
      // the drag's X delta and upward with the drag's inverted Y delta.
      width: Math.max(MIN_WIDTH, r.origW + (e.clientX - r.startX)),
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
  }, [messages, isStreaming]);

  if (!session) return null;

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setError("");
    setInput("");

    const history = messages.slice(-16).map(({ role, content }) => ({ role, content }));
    const nextMessages = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(nextMessages);
    setIsStreaming(true);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/chatbot/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshSession?.access_token || ""}`,
        },
        body: JSON.stringify({ history, message: text }),
      });

      if (resp.status === 429) {
        let reason = "";
        try {
          const body = await resp.json();
          reason = body?.detail?.reason || "";
        } catch {
          // ignore — fall through to generic quota message
        }
        setError(
          reason === "global_limit"
            ? "העוזר עמוס כרגע עקב שימוש כבד במערכת. נסו שוב מאוחר יותר."
            : "הגעת למכסת השאלות היומית לעוזר ה-AI. נסה שוב מחר."
        );
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      if (!resp.ok || !resp.body) {
        throw new Error("request failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantText += delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistantText };
                return copy;
              });
            }
          } catch {
            // ignore malformed/partial SSE chunks
          }
        }
      }

      if (!assistantText) {
        throw new Error("empty response");
      }
    } catch {
      setError("אירעה שגיאה בקבלת תשובה מהעוזר. נסה שוב.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
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
        aria-label="פתח את הצ'אט"
        style={{ position: "fixed", left: 16, bottom: 88, zIndex: 60 }}
        className="glass-card rounded-full w-14 h-14 shadow-lg flex items-center justify-center hover:shadow-xl transition-shadow p-2"
      >
        <img src={logoIcon} alt="" aria-hidden="true" className="w-full h-full object-contain" />
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="חלון צ'אט עם עוזר AI"
      dir="rtl"
      style={{ position: "fixed", left: 16, bottom: 88, width: size.width, height: size.height, zIndex: 60, background: "#ffffff" }}
      className="rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0"
        style={{ background: "#f1f5f9" }}
      >
        <div className="text-sm font-bold text-slate-800">מדריך גפן - עוזר AI</div>
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
            שאל אותי כל שאלה מקצועית על מדריך הגפן
          </p>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} role={m.role} content={m.content} />
        ))}
        {isStreaming && (
          <div role="status" aria-label="הבוט מקליד" className="flex items-center gap-1.5 px-3.5 py-2 text-xs text-slate-400">
            <span className="spinner w-3 h-3" aria-hidden="true" />
            הבוט מקליד...
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-slate-200 p-2.5 flex items-end gap-2 flex-shrink-0">
        <label htmlFor="chat-widget-input" className="sr-only">הקלד שאלה</label>
        <textarea
          id="chat-widget-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="הקלד שאלה..."
          disabled={isStreaming}
          className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          aria-label="שלח הודעה"
          className="rounded-xl bg-blue-600 text-white w-9 h-9 flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>

      {/* Resize handle — panel is anchored bottom-left, so this sits at the opposite (top-right) corner */}
      <div
        onMouseDown={startResize}
        aria-hidden="true"
        className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize"
        style={{ touchAction: "none" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", top: 2, right: 2 }}>
          <path d="M2 12 L12 2 M7 12 L12 7" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
