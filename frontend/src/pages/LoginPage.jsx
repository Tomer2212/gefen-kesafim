import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { describeConnectionError } from "../lib/connectionError";
import { getTrustedDeviceToken, setTrustedDeviceToken } from "../lib/trustedDevice";
import { getDeviceId } from "../lib/deviceSession";
import logoImg from "../assets/logo.png";

const LogoMark = () => (
  <div className="flex justify-center mb-6">
    <img src={logoImg} alt="גפן AI לוגו" className="h-[12.96rem] w-auto object-contain" />
  </div>
);

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const [view, setView]           = useState("login"); // "login" | "forgot" | "sent" | "mfa"
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [resetEmail, setResetEmail]   = useState("");
  const [resetError, setResetError]   = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const [mfaFactorId, setMfaFactorId]     = useState(null);
  const [mfaChallengeId, setMfaChallengeId] = useState(null);
  const [mfaCode, setMfaCode]             = useState("");
  const [mfaError, setMfaError]           = useState("");
  const [mfaLoading, setMfaLoading]       = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("gefen_device_revoked") === "1") {
        sessionStorage.removeItem("gefen_device_revoked");
        setError("החיבור שלך נותק מרחוק על ידי מנהל המערכת. יש להתחבר מחדש.");
      }
    } catch {
      // sessionStorage unavailable — no-op
    }
  }, []);

  // Reached via a backend-initiated 401 "mfa_challenge_required" redirect: the password
  // step already passed earlier (the Supabase session is still valid at AAL1) and only
  // the TOTP step-up is missing — so go straight to the challenge screen on the existing
  // session instead of asking for the password again.
  useEffect(() => {
    if (searchParams.get("mfa_required") !== "1") return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await startMfaChallenge();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startMfaChallenge() {
    setMfaError("");
    try {
      const { data: factorsData, error: factorsErr } = await supabase.auth.mfa.listFactors();
      if (factorsErr) throw factorsErr;
      const totpFactor = (factorsData?.totp || []).find(f => f.status === "verified");
      if (!totpFactor) {
        setError("לא נמצא פקטור אימות דו-שלבי מאומת. פנה לבעלים של המערכת לאיפוס.");
        setView("login");
        return;
      }
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
      if (challengeErr) throw challengeErr;
      setMfaFactorId(totpFactor.id);
      setMfaChallengeId(challengeData.id);
      setView("mfa");
    } catch (err) {
      setError(describeConnectionError(err).message);
    }
  }

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
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2") {
        // Enrolled in MFA. If this browser was marked as trusted within the last 30 days,
        // proceed optimistically — the backend re-validates the token on every request and
        // will bounce back here (via the mfa_challenge_required redirect) if it's invalid.
        if (getTrustedDeviceToken()) {
          window.location.replace("/");
          return;
        }
        await startMfaChallenge();
        return;
      }
      window.location.replace("/");
    } catch (err) {
      setError(describeConnectionError(err).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setMfaLoading(true);
    setMfaError("");
    try {
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (verifyErr) {
        setMfaError("קוד שגוי. נסה שוב.");
        return;
      }
      if (rememberDevice) {
        // Deliberately NOT a plain axios.post(): the shared interceptor in main.jsx attaches
        // its own cached token (mirrored from onAuthStateChange, which may not have caught up
        // to the AAL2 session mfa.verify() just minted) and, on any failure, triggers global
        // side effects (sign-out / redirect) that would collide with this page's own
        // navigation below. A raw fetch with an explicitly fresh token keeps this truly
        // best-effort — a failure here has zero side effects beyond not remembering the device.
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const baseURL = axios.defaults.baseURL || "";
          const resp = await fetch(`${baseURL}/schools/users/me/mfa/trust-device`, {
            method: "POST",
            headers: {
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              "X-Device-Id": getDeviceId(),
            },
          });
          if (resp.ok) {
            const data = await resp.json();
            setTrustedDeviceToken(data.token, data.expires_at);
          }
        } catch {
          // best-effort — failing to remember the device just means a code is needed next time
        }
      }
      window.location.replace("/");
    } catch (err) {
      setMfaError(describeConnectionError(err).message);
    } finally {
      setMfaLoading(false);
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
              <p className="text-center text-sm text-black mb-8 font-medium">
                מערכת חכמה לניהול תקציב הגפן
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

                <div className="border-t border-slate-100 mt-2 pt-4 text-center">
                  <Link
                    to="/register"
                    className="text-sm text-slate-500 hover:text-blue-600 hover:underline"
                  >
                    אין לכם חשבון עדיין? הגישו בקשת הרשמה
                  </Link>
                </div>
              </form>
            </>
          )}

          {/* ── MFA CHALLENGE VIEW ── */}
          {view === "mfa" && (
            <>
              <LogoMark />
              <h1 className="text-center text-2xl mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
                אימות דו-שלבי
              </h1>
              <p className="text-center text-sm text-slate-400 mb-8 font-medium">
                הזן את הקוד בן 6 הספרות המוצג כרגע באפליקציית האימות שלך
              </p>

              <form onSubmit={handleMfaSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="mfa-code" className="text-xs text-slate-500 text-right" style={{ fontWeight: 600 }}>
                    קוד אימות
                  </label>
                  <input
                    id="mfa-code"
                    className="input-field text-center tracking-[0.3em]"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                    dir="ltr"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="w-4 h-4"
                  />
                  זכור מכשיר זה ל-30 יום
                </label>

                {mfaError && (
                  <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                      <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/>
                      <path d="M8 4.5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <p className="text-red-600 text-sm">{mfaError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={mfaLoading || mfaCode.length !== 6}
                  className="btn-blue mt-2 py-3 text-base"
                >
                  {mfaLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" style={{ animation: "spin-smooth 0.7s linear infinite" }} />
                      מאמת...
                    </span>
                  ) : "אמת והיכנס"}
                </button>

                <button
                  type="button"
                  onClick={async () => { await supabase.auth.signOut(); setView("login"); }}
                  className="text-center text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  חזור לכניסה
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

      </div>
    </div>
  );
}
