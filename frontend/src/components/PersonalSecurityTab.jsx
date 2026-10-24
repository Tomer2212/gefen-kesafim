import { useEffect, useState } from "react";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { clearTrustedDeviceToken } from "../lib/trustedDevice";
import stepInstallImg from "../assets/mfa-guide/step-install.jpeg";
import stepOpenImg from "../assets/mfa-guide/step-open.jpeg";
import stepAddImg from "../assets/mfa-guide/step-add.jpeg";
import stepScanImg from "../assets/mfa-guide/step-scan.jpeg";

// "אבטחה" tab in אזור אישי — lets a user turn on optional TOTP-based two-factor
// authentication (Supabase MFA) for their own account. See backend/auth.py for
// how this is actually enforced on every request once enabled.

function Toggle({ checked, disabled, onClick, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-slate-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? "translate-x-0.5" : "translate-x-5"
        }`}
      />
    </button>
  );
}

function GuideStep({ n, img, children }) {
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5"
        >
          {n}
        </span>
        <p>{children}</p>
      </div>
      {img && (
        <img
          src={img}
          alt=""
          aria-hidden="true"
          className="rounded-lg border border-slate-200 self-start mr-[30px]"
          style={{ height: 180, width: "auto" }}
        />
      )}
    </li>
  );
}

function MfaEnrollModal({ onCancel, onEnrolled }) {
  const [factorId, setFactorId] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: "totp" });
        if (enrollErr) throw enrollErr;
        if (cancelled) return;
        setFactorId(data.id);
        setQrCode(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch (err) {
        if (!cancelled) setError(err?.message || "שגיאה ביצירת קוד ה-QR. נסה שוב.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Passed to useFocusTrap below (not the raw `onCancel` prop) so that pressing Escape
  // also cleans up the not-yet-verified factor on Supabase's side — otherwise it's left
  // orphaned, and Supabase only allows one unverified TOTP factor at a time per user, so
  // repeated Escape-outs would silently block all future enrollment attempts.
  async function handleCancel() {
    if (factorId) {
      try { await supabase.auth.mfa.unenroll({ factorId }); } catch { /* best-effort cleanup */ }
    }
    onCancel();
  }

  const { ref, handleKeyDown } = useFocusTrap(handleCancel);

  async function handleVerify(e) {
    e.preventDefault();
    setVerifying(true);
    setError("");
    try {
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.trim(),
      });
      if (verifyErr) {
        setError("קוד שגוי. ודא שהשעון בטלפון מסונכרן ונסה שוב.");
        return;
      }
      await axios.post("/schools/users/me/mfa/confirm");
      onEnrolled();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "שגיאה באימות הקוד. נסה שוב.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="mfa-enroll-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 id="mfa-enroll-title" className="text-base font-semibold text-slate-800">הפעלת אימות דו-שלבי</h2>
          <button onClick={handleCancel} aria-label="סגור"
            className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {loading ? (
            <div role="status" aria-label="טוען" className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
              <span aria-hidden="true" className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full inline-block animate-spin" />
              מכין קוד QR...
            </div>
          ) : (
            <>
              <ol className="flex flex-col gap-5 text-sm text-slate-700 leading-relaxed">
                <GuideStep n={1} img={stepInstallImg}>
                  הורד/י את האפליקציה <strong>מאמת החשבונות של Google</strong> (Google Authenticator)
                  מחנות האפליקציות בטלפון שלך (App Store ל-iPhone, או Google Play לאנדרואיד) ולחץ/י
                  על <strong>"התקנה"</strong>.
                </GuideStep>
                <GuideStep n={2} img={stepOpenImg}>
                  לאחר שההתקנה הסתיימה, לחץ/י על <strong>"פתיחה"</strong> כדי לפתוח את האפליקציה.
                </GuideStep>
                <GuideStep n={3} img={stepAddImg}>
                  בתוך האפליקציה, לחץ/י על כפתור ההוספה <strong>(+)</strong>.
                </GuideStep>
                <GuideStep n={4} img={stepScanImg}>
                  בחר/י באפשרות <strong>"סריקת קוד QR"</strong>.
                </GuideStep>
                <GuideStep n={5}>
                  סרוק/י את קוד ה-QR שמופיע כאן למטה.
                </GuideStep>
                <GuideStep n={6}>
                  האפליקציה תציג קוד בן 6 ספרות שמתחלף כל 30 שניות — הזן/י אותו בשדה למטה ולחץ/י "אמת".
                </GuideStep>
              </ol>

              {qrCode && (
                <div className="flex justify-center bg-slate-50 rounded-xl py-4">
                  <img src={qrCode} alt="קוד QR להגדרת אימות דו-שלבי" width={180} height={180} />
                </div>
              )}

              {secret && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowManualEntry(v => !v)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {showManualEntry ? "הסתר קוד ידני" : "לא ניתן לסרוק? הזן קוד ידנית"}
                  </button>
                  {showManualEntry && (
                    <p className="mt-2 text-xs text-slate-500 font-mono select-all" dir="ltr">{secret}</p>
                  )}
                </div>
              )}

              <form onSubmit={handleVerify} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="mfa-enroll-code" className="text-xs text-slate-500" style={{ fontWeight: 600 }}>
                    קוד אימות מהאפליקציה
                  </label>
                  <input
                    id="mfa-enroll-code"
                    className="input-field text-center tracking-[0.3em]"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    required
                    dir="ltr"
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm text-red-600">{error}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={verifying || code.length !== 6}
                    className="btn-blue flex-1 py-2.5 text-sm"
                  >
                    {verifying ? "מאמת..." : "אמת והפעל"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 py-2.5 text-sm rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PersonalSecurityTab() {
  const [mfaEnabled, setMfaEnabled] = useState(null); // null = loading
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    axios.get("/schools/users/me").then(({ data }) => {
      if (!cancelled) setMfaEnabled(!!data.mfa_enabled);
    }).catch(() => {
      if (!cancelled) setMfaEnabled(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleToggle() {
    setError("");
    if (!mfaEnabled) {
      setShowEnrollModal(true);
      return;
    }
    if (!window.confirm("לכבות אימות דו-שלבי? החשבון שלך יהיה מוגן רק באמצעות סיסמה.")) return;
    setDisabling(true);
    try {
      await axios.post("/schools/users/me/mfa/disable");
      clearTrustedDeviceToken();
      setMfaEnabled(false);
      setSavedMsg("אימות דו-שלבי כובה");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בכיבוי אימות דו-שלבי. נסה שוב.");
    } finally {
      setDisabling(false);
    }
  }

  function handleEnrolled() {
    setShowEnrollModal(false);
    setMfaEnabled(true);
    setSavedMsg("אימות דו-שלבי הופעל בהצלחה");
    setTimeout(() => setSavedMsg(""), 2500);
  }

  return (
    <section
      aria-labelledby="section-security"
      className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
      style={{ boxShadow: "0 2px 16px rgba(0,112,243,0.06)" }}
    >
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 id="section-security" className="text-base font-semibold text-slate-800">אבטחה</h2>
      </div>

      <div className="px-6 py-5">
        <div className="flex items-center justify-between gap-4 max-w-xl">
          <div>
            <p className="text-sm font-medium text-slate-800">הפעל אימות דו-שלבי</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              הוסף שכבת הגנה נוספת לחשבון שלך: בנוסף לסיסמה, תתבקש/י להזין קוד חד-פעמי
              מאפליקציית אימות (כמו Google Authenticator) בכל כניסה למערכת. ניתן לסמן
              "זכור מכשיר זה ל-30 יום" כדי לדלג על הקוד בכניסות הבאות מאותו מחשב.
            </p>
          </div>
          {mfaEnabled === null ? (
            <div role="status" aria-label="טוען" className="w-11 h-6 flex-shrink-0" />
          ) : (
            <Toggle
              checked={mfaEnabled}
              disabled={disabling}
              onClick={handleToggle}
              label="הפעל אימות דו-שלבי"
            />
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 mt-3">{error}</p>
        )}
        {savedMsg && (
          <p role="status" className="text-sm text-emerald-600 mt-3">{savedMsg} ✓</p>
        )}

        {mfaEnabled && (
          <p className="text-xs text-slate-400 mt-4 max-w-xl leading-relaxed">
            איבדת את הטלפון? פנה/י לבעלים (owner) של המערכת כדי לאפס את האימות הדו-שלבי
            ולהגדיר אותו מחדש במכשיר חדש.
          </p>
        )}
      </div>

      {showEnrollModal && (
        <MfaEnrollModal
          onCancel={() => setShowEnrollModal(false)}
          onEnrolled={handleEnrolled}
        />
      )}
    </section>
  );
}
