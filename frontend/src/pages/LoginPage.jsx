import { useState } from "react";
import { supabase } from "../lib/supabase";

const LogoMark = () => (
  <div className="flex justify-center mb-6">
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)", boxShadow: "0 6px 20px rgba(0,112,243,0.35)" }}
    >
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="3" width="9" height="9" rx="2" fill="white" fillOpacity="0.9"/>
        <rect x="16" y="3" width="9" height="9" rx="2" fill="white" fillOpacity="0.5"/>
        <rect x="3" y="16" width="9" height="9" rx="2" fill="white" fillOpacity="0.5"/>
        <rect x="16" y="16" width="9" height="9" rx="2" fill="white" fillOpacity="0.9"/>
      </svg>
    </div>
  </div>
);

export default function LoginPage() {
  const [view, setView]           = useState("login"); // "login" | "forgot" | "sent"
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [resetEmail, setResetEmail]   = useState("");
  const [resetError, setResetError]   = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError("אימייל או סיסמה שגויים");
        return;
      }
      window.location.replace("/");
    } catch {
      setError("לא ניתן להתחבר לשרת. אנא נסה שוב בעוד כמה שניות.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest(e) {
    e.preventDefault();
    setResetError("");
    setResetLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + "/set-password",
      });
      if (resetErr) {
        setResetError("שגיאה בשליחת המייל. אנא נסה שוב.");
        return;
      }
      setView("sent");
    } catch {
      setResetError("שגיאה בשליחת המייל. אנא נסה שוב.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm anim-fade-up">

        <div className="glass-card rounded-3xl px-8 py-10">

          {/* ── LOGIN VIEW ── */}
          {view === "login" && (
            <>
              <LogoMark />
              <h1 className="text-center text-2xl font-800 mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
                גפן AI
              </h1>
              <p className="text-center text-sm text-slate-400 mb-8 font-medium">
                כניסה למערכת בדיקת תקציב
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-email" className="text-xs text-slate-500 text-right" style={{ fontWeight: 600 }}>
                    אימייל
                  </label>
                  <input
                    id="login-email"
                    className="input-field"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    dir="ltr"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-password" className="text-xs text-slate-500 text-right" style={{ fontWeight: 600 }}>
                    סיסמה
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      className="input-field w-full pl-10"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                    >
                      {showPassword ? (
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                      <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/>
                      <path d="M8 4.5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-blue mt-2 py-3 text-base"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" style={{ animation: "spin-smooth 0.7s linear infinite" }} />
                      מתחבר...
                    </span>
                  ) : "כניסה"}
                </button>

                <button
                  type="button"
                  onClick={() => { setView("forgot"); setResetEmail(email); setResetError(""); }}
                  className="text-center text-sm text-blue-500 hover:text-blue-700 hover:underline mt-1"
                >
                  שכחת סיסמה?
                </button>
              </form>
            </>
          )}

          {/* ── FORGOT PASSWORD VIEW ── */}
          {view === "forgot" && (
            <>
              <LogoMark />
              <h1 className="text-center text-2xl mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
                איפוס סיסמה
              </h1>
              <p className="text-center text-sm text-slate-400 mb-8 font-medium">
                הכנס את כתובת המייל שלך ונשלח לך קישור לאיפוס הסיסמה
              </p>

              <form onSubmit={handleResetRequest} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reset-email" className="text-xs text-slate-500 text-right" style={{ fontWeight: 600 }}>
                    אימייל
                  </label>
                  <input
                    id="reset-email"
                    className="input-field"
                    type="email"
                    placeholder="your@email.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoFocus
                    dir="ltr"
                  />
                </div>

                {resetError && (
                  <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                      <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/>
                      <path d="M8 4.5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <p className="text-red-600 text-sm">{resetError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resetLoading}
                  className="btn-blue mt-2 py-3 text-base"
                >
                  {resetLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" style={{ animation: "spin-smooth 0.7s linear infinite" }} />
                      שולח...
                    </span>
                  ) : "שלח קישור לאיפוס"}
                </button>

                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="text-center text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  חזור לכניסה
                </button>
              </form>
            </>
          )}

          {/* ── SENT VIEW ── */}
          {view === "sent" && (
            <>
              <div className="flex justify-center mb-6">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", boxShadow: "0 6px 20px rgba(16,185,129,0.35)" }}>
                  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
              <h1 className="text-center text-2xl mb-1" style={{ color: "#10b981", fontWeight: 800 }}>
                המייל נשלח!
              </h1>
              <p className="text-center text-sm text-slate-500 mb-8 font-medium leading-relaxed">
                בדוק את תיבת הדואר שלך בכתובת<br />
                <span className="font-semibold text-slate-700" dir="ltr">{resetEmail}</span><br />
                והקלק על הקישור לאיפוס הסיסמה.
              </p>
              <button
                type="button"
                onClick={() => setView("login")}
                className="btn-blue w-full py-3 text-base"
              >
                חזור לכניסה
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          מערכת חכמה לניהול תקציב הגפן
        </p>
      </div>
    </div>
  );
}
