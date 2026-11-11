import { useState } from "react";
import { useAppVersion } from "../hooks/useAppVersion";

// Tells a tab left open across a deploy that a newer version is live. Never reloads by itself:
// the floating windows (meeting notes, call notes, task panel) survive page navigation and may
// hold unsaved text, so only the user decides when to reload.
export default function NewVersionBanner() {
  const stale = useAppVersion();
  const [dismissed, setDismissed] = useState(false);

  if (!stale || dismissed) return null;
  return (
    <div dir="rtl" role="status"
         className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-xl bg-slate-800 text-white text-sm px-4 py-2.5 shadow-lg">
      <span>גרסה חדשה של המערכת זמינה — שמרו את העבודה ורעננו את הדף</span>
      <button type="button" onClick={() => window.location.reload()}
              className="rounded-lg bg-white text-slate-800 font-semibold px-3 py-1 hover:bg-slate-100">
        רענן
      </button>
      <button type="button" onClick={() => setDismissed(true)} aria-label="סגור הודעה על גרסה חדשה"
              className="text-slate-300 hover:text-white px-1">
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
