import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await axios.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      navigate("/");
    } catch {
      setError("כתובת אימייל או סיסמה שגויים");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm anim-fade-up">

        {/* Card */}
        <div className="glass-card rounded-3xl px-8 py-10">

          {/* Logo mark */}
          <div className="flex justify-center mb-6">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)", boxShadow: "0 6px 20px rgba(0,112,243,0.35)" }}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="3" y="3" width="9" height="9" rx="2" fill="white" fillOpacity="0.9"/>
                <rect x="16" y="3" width="9" height="9" rx="2" fill="white" fillOpacity="0.5"/>
                <rect x="3" y="16" width="9" height="9" rx="2" fill="white" fillOpacity="0.5"/>
                <rect x="16" y="16" width="9" height="9" rx="2" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-center text-2xl font-800 mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
            מערכת גפן–כספים
          </h1>
          <p className="text-center text-sm text-slate-400 mb-8 font-medium">
            כניסה למערכת בדיקת תקציב
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-600 text-slate-500 text-right" style={{ fontWeight: 600 }}>
                כתובת אימייל
              </label>
              <input
                className="input-field"
                type="email"
                placeholder="name@school.co.il"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                dir="ltr"
                style={{ textAlign: "right" }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-600 text-slate-500 text-right" style={{ fontWeight: 600 }}>
                סיסמה
              </label>
              <input
                className="input-field"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
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
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" style={{ animation: "spin-smooth 0.7s linear infinite" }} />
                  מתחבר...
                </span>
              ) : "כניסה"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          מערכת לבדיקת פערי חשבוניות בין גפן לתוכנות כספים
        </p>
      </div>
    </div>
  );
}
