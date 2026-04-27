import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import FileUpload from "../components/FileUpload";
import LoadingScreen from "../components/LoadingScreen";
import ResultsView from "../components/ResultsView";
import DownloadButton from "../components/DownloadButton";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
        </svg>
      </div>
      <span className="font-800 text-base" style={{ fontWeight: 800, color: "#0070F3" }}>
        מערכת גפן–כספים
      </span>
    </div>
  );
}

function SingleFileWarningModal({ onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right"
        dir="rtl"
      >
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(251,191,36,0.12)" }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5L17.5 15.5H2.5L10 2.5Z" stroke="#d97706" strokeWidth="1.6" strokeLinejoin="round"/>
            <path d="M10 8.5v3M10 13.5v.5" stroke="#d97706" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </div>
        <h2 className="text-base font-800 mb-3" style={{ fontWeight: 800, color: "#0f172a" }}>
          שים לב! העלית קובץ אחד בלבד
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          אם מדובר בקובץ דיווח ביצוע (גפן) — המערכת תבדוק אסמכתאות שנדחו וכאלה שהגיעו ללא סריקה בלבד.
          <br /><br />
          אם מדובר בקובץ מתוכנת הכספים — הבדיקה תיכשל.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="btn-blue flex-1 py-2.5 text-sm"
          >
            בדוק בכל זאת
          </button>
          <button
            onClick={onCancel}
            className="btn-ghost flex-1 py-2.5 text-sm"
          >
            אחורה
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right"
        dir="rtl"
      >
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(0,112,243,0.08)" }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5L17.5 15.5H2.5L10 2.5Z" stroke="#0070F3" strokeWidth="1.6" strokeLinejoin="round"/>
            <path d="M10 8.5v3M10 13.5v.5" stroke="#0070F3" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </div>
        <h2 className="text-base font-800 mb-3" style={{ fontWeight: 800, color: "#0f172a" }}>
          אישור לפני תחילת הבדיקה
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          אני מאשר/ת שקראתי את תנאי השימוש ומבין/ה שהתוצאות עשויות להכיל טעויות לפעמים. ברור לי שהאחריות לאימות התוצאות חלה עליי בלבד.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="btn-blue flex-1 py-2.5 text-sm"
          >
            אישור והתחלת הבדיקה
          </button>
          <button
            onClick={onCancel}
            className="btn-ghost px-5 py-2.5 text-sm"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MainPage() {
  const [files, setFiles]     = useState([]);
  const [runId, setRunId]     = useState(null);
  const [status, setStatus]   = useState("idle"); // idle | loading | done | error
  const [result, setResult]   = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSingleFileWarning, setShowSingleFileWarning] = useState(false);
  const pollRef = useRef(null);
  const navigate = useNavigate();

  function authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem("token")}` };
  }

  function handleLogout() {
    localStorage.removeItem("token");
    navigate("/login");
  }

  async function handleRun() {
    if (files.length === 0) return;
    if (files.length === 1) {
      setShowSingleFileWarning(true);
    } else {
      setShowConfirm(true);
    }
  }

  async function handleConfirmedRun() {
    setShowConfirm(false);
    setStatus("loading");
    setErrorMsg("");
    try {
      const form = new FormData();
      files.forEach(f => form.append("files", f));
      const { data } = await axios.post("/analyze/upload", form, {
        headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
      });
      setRunId(data.run_id);
      startPolling(data.run_id);
    } catch (err) {
      const msg = err.response?.data?.detail || "שגיאה בהעלאת הקבצים. אנא נסה שוב.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  function startPolling(id) {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`/analyze/result/${id}`, { headers: authHeader() });
        if (data.status === "done") {
          clearInterval(pollRef.current);
          setResult(data);
          setStatus("done");
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setErrorMsg(data.error || "הבדיקה נכשלה. אנא נסה שוב.");
          setStatus("error");
        }
      } catch {
        clearInterval(pollRef.current);
        setErrorMsg("אירעה שגיאה בעת קבלת התוצאות.");
        setStatus("error");
      }
    }, 3000);
  }

  function handleNewRun() {
    if (pollRef.current) clearInterval(pollRef.current);
    setFiles([]);
    setRunId(null);
    setResult(null);
    setErrorMsg("");
    setStatus("idle");
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">

      {showSingleFileWarning && (
        <SingleFileWarningModal
          onConfirm={() => { setShowSingleFileWarning(false); setShowConfirm(true); }}
          onCancel={() => setShowSingleFileWarning(false)}
        />
      )}

      {showConfirm && (
        <ConfirmModal
          onConfirm={handleConfirmedRun}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* Top navigation */}
      <nav className="topbar sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 7h7M9.5 5l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 3H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              יציאה
            </button>
            <button
              onClick={() => navigate("/terms")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              תנאי שימוש
            </button>
          </div>
          <Logo />
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">

        {/* Page heading */}
        <div className="text-center mb-8 anim-fade-up">
          <h1
            className="text-3xl font-900 mb-2"
            style={{ fontWeight: 900, color: "#0f172a" }}
          >
            בדיקת פערי חשבוניות
          </h1>
          <p className="text-slate-500 text-sm">
            השוואה אוטומטית בין קבצי גפן לתוכנת הכספים
          </p>
        </div>

        {/* Instructions + warning — hidden once results are shown */}
        {status !== "done" && (
          <>
            {/* Step-by-step instructions */}
            <div className="glass-card rounded-2xl px-5 py-4 mb-4 anim-fade-up-1">
              <ol className="flex flex-col gap-1.5 text-sm text-slate-600 list-decimal list-inside leading-relaxed" style={{ paddingRight: "0.25rem" }}>
                <li>העלו קובץ דיווח ביצוע ממערכת הגפן</li>
                <li>העלו קובץ פירוט אסמכתאות גפן מתוכנת הכספים (פייסקול / כספים2000)</li>
                <li>לחצו "התחל בדיקה"</li>
                <li>צפו בקסם קורה.</li>
              </ol>
            </div>

            {/* Warning banner */}
            <div
              className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-6 anim-fade-up-1"
              style={{ background: "rgba(254,243,199,0.8)", border: "1px solid rgba(251,191,36,0.4)" }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 mt-0.5">
                <path d="M9 1.5L16.5 15H1.5L9 1.5Z" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M9 7v3.5M9 12.5v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <div className="text-amber-700 text-sm leading-relaxed flex flex-col gap-1.5">
                <p className="font-700" style={{ fontWeight: 700 }}>לקבלת תוצאות מדויקות:</p>
                <ol className="flex flex-col gap-1 list-decimal list-inside">
                  <li>העלו את הקבצים בצורתם הגולמית כפי שהורדו מהמערכות השונות ללא שינויים.</li>
                  <li>במידה ויש לביה"ס תקציבים נוספים, ודאו שאתם מורידים את קובץ דיווח ביצוע מהאזור של תקציב הגפן בלבד.</li>
                </ol>
              </div>
            </div>
          </>
        )}

        {/* State: idle */}
        {status === "idle" && (
          <div className="flex flex-col gap-4">
            <div className="glass-card rounded-3xl p-6 anim-fade-up-2">
              <FileUpload files={files} onChange={setFiles} />
            </div>

            <div className="flex justify-center anim-fade-up-3">
              <button
                onClick={handleRun}
                disabled={files.length === 0}
                className="btn-blue px-10 py-2.5 text-sm"
                style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)" }}
              >
                התחל בדיקה
              </button>
            </div>
          </div>
        )}

        {/* State: loading */}
        {status === "loading" && (
          <div className="glass-card rounded-3xl">
            <LoadingScreen />
          </div>
        )}

        {/* State: done */}
        {status === "done" && result && (
          <ResultsView
            result={result}
            downloadSlot={
              <DownloadButton
                runId={runId}
                authHeader={authHeader()}
                onNewRun={handleNewRun}
              />
            }
          />
        )}

        {/* State: error */}
        {status === "error" && (
          <div className="glass-card rounded-3xl p-8 text-center anim-fade-up">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "#fee2e2" }}
            >
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <circle cx="13" cy="13" r="11" stroke="#dc2626" strokeWidth="1.8"/>
                <path d="M13 8v6M13 16.5v.5" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <h2
              className="text-lg font-800 mb-2"
              style={{ fontWeight: 800, color: "#1e293b" }}
            >
              הבדיקה נכשלה
            </h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              {errorMsg || "אירעה שגיאה. אנא נסה שוב."}
            </p>
            <button
              onClick={handleNewRun}
              className="btn-blue px-8 py-2.5 text-sm inline-block"
            >
              נסה שוב
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
