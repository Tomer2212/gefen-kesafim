import { useEffect, useState } from "react";

const STORAGE_KEY = "chatbot_conversation_v1";
const EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

function loadInitialMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw);
    if (!stored?.lastActivityAt || Date.now() - stored.lastActivityAt > EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return stored.messages || [];
  } catch {
    return [];
  }
}

export function useChatPersistence() {
  const [messages, setMessages] = useState(loadInitialMessages);

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ messages, lastActivityAt: Date.now() })
      );
    } catch {
      // localStorage unavailable (private browsing quota etc.) — conversation just won't persist
    }
  }, [messages]);

  function clearConversation() {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([]);
  }

  return { messages, setMessages, clearConversation };
}
