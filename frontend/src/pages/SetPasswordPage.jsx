import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import axios from "axios";

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    let handled = false;

    // Detect expired/invalid token from URL hash before setting up auth listener
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get("error")) {
      setLinkExpired(true);
      setChecking(false);
      return;
    }

    async function handleSession(session) {
      if (handled) return;
      handled = true;
      setEmail(session.user.email || "");
      try {
        const res = await axios.get("/schools/users/me");
        if (res.data.status === "active") {
          navigate("/", { replace: true });
        } else {
          setChecking(false);
        }
      } catch {
        navigate("/login", { replace: true });
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (handled) return;
      if (event === "PASSWORD_RECOVERY") {
        // User clicked the reset link from email
        handled = true;
        setEmail(session.user.email || "");
        setIsRecovery(true);
        setChecking(false);
      } else if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && session)) {
        handleSession(session);
      } else if (event === "SIGNED_OUT") {
        handled = true;
        navigate("/login", { replace: true });
      }
      // INITIAL_SESSION with null = invite hash still being exchanged → wait
    });

    // Fallback: if no auth event within 6 seconds, redirect to login
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        navigate("/login", { replace: true });
      }
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("שגיאה בהגדרת הסיסמה. נסה שנית.");
        return;
      }
      if (!isRecovery) {
        await axios.post("/schools/users/me/setup-complete");
      }
      window.location.replace("/");
    } catch {
      setError("שגיאה. אנא נסה שנית.");
    } finally {
      setLoading(false);
    }
  }

  if (linkExpired) {
    return (
      <div className="bg-scene min-h-screen flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card rounded-3xl px-8 py-10 w-full max-w-sm text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "rgba(239,68,68,0.1)" }}
          >
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">קישור לא תקין</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            קישור ההזמנה פג תוקף או שכבר נעשה בו שימוש.<br />
            אנא פנה למנהל המערכת כדי לשלוח לך הזמנה חדשה.
          </p>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="bg-scene min-h-screen flex items-center justify-center" dir="rtl">
        <div role="status" aria-label="טוען">
          <div aria-hidden="true" className="spinner w-8 h-8" />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm anim-fade-up">

        <div className="glass-card rounded-3xl px-8 py-10">

          {/* Logo */}
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

          <h1 className="text-center text-2xl mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
            {isRecovery ? "איפוס סיסמה" : "ברוכים הבאים לגפן AI"}
          </h1>
          <p className="text-center text-sm text-slate-400 mb-8 font-medium">
            {isRecovery ? "בחר סיסמה חדשה לחשבונך" : "בחר סיסמה כדי להשלים את הרישום"}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Email — read-only */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="setup-email" className="text-xs font-600 text-slate-500 text-right" style={{ fontWeight: 600 }}>
                אימייל
              </label>
              <input
                id="setup-email"
                className="input-field bg-slate-50 text-slate-400 cursor-not-allowed"
                type="email"
                value={email}
                readOnly
                dir="ltr"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="setup-password" className="text-xs font-600 text-slate-500 text-right" style={{ fontWeight: 600 }}>
                סיסמה
              </label>
              <div className="relative">
                <input
                  id="setup-password"
                  className="input-field w-full pl-10"
                  type={showPassword ? "text" : "password"}
                  placeholder="לפחות 8 תווים"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
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

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="setup-confirm" className="text-xs font-600 text-slate-500 text-right" style={{ fontWeight: 600 }}>
                אימות סיסמה
              </label>
              <div className="relative">
                <input
                  id="setup-confirm"
                  className="input-field w-full pl-10"
                  type={showConfirm ? "text" : "password"}
                  placeholder="הכנס שוב את הסיסמה"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showConfirm ? "הסתר אימות סיסמה" : "הצג אימות סיסמה"}
                >
                  {showConfirm ? (
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
                  שומר...
                </span>
              ) : "אישור"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          מערכת חכמה לניהול תקציב הגפן
        </p>
      </div>
    </div>
  );
}
