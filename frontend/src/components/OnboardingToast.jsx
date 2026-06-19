import { useState } from "react";
import axios from "axios";

function Toast({ titleIcon, title, body, actionLabel, actionHref, onDismiss }) {
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    await onDismiss();
  }

  return (
    <div
      className="bg-white rounded-2xl shadow-lg border border-slate-100 w-72 p-4 flex flex-col gap-3"
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #0070F3 0%, #0050d0 100%)" }}>
          {titleIcon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 leading-tight">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{body}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {actionHref && (
          <a
            href={actionHref}
            className="flex-1 text-center py-2 rounded-xl text-xs font-semibold text-white transition-colors"
            style={{ background: "#0070F3" }}
          >
            {actionLabel}
          </a>
        )}
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="flex-1 py-2 rounded-xl text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          {dismissing ? "..." : "אל תציג שוב"}
        </button>
      </div>
    </div>
  );
}

export default function OnboardingToast({ dismissed, onDismissed }) {
  const showAddSchool = !dismissed?.add_school;
  const showAddUser = !dismissed?.add_user;

  if (!showAddSchool && !showAddUser) return null;

  async function dismiss(key) {
    try {
      await axios.patch("/schools/users/me/onboarding", { key });
      onDismissed(key);
    } catch {
      // non-fatal
    }
  }

  return (
    <div
      className="fixed bottom-5 left-5 z-40 flex flex-col gap-3"
      style={{ direction: "rtl" }}
    >
      {showAddSchool && (
        <Toast
          titleIcon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          }
          title="הוסף את בית הספר הראשון"
          body='לחץ על "ניהול ותפעול" בסרגל הצד, ואז על "הוסף בית ספר" כדי להתחיל.'
          actionLabel="לדף הניהול"
          actionHref="/admin"
          onDismiss={() => dismiss("add_school")}
        />
      )}
      {showAddUser && (
        <Toast
          titleIcon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          title="הזמן את המשתמש הראשון"
          body='עבור לדף "ניהול ותפעול", לשונית "משתמשים", ולחץ על "הזמן משתמש" כדי להוסיף מנהל או יועץ.'
          actionLabel="לדף הניהול"
          actionHref="/admin"
          onDismiss={() => dismiss("add_user")}
        />
      )}
    </div>
  );
}
