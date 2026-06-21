import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const nameInputRef = useRef(null);

  const [resetView, setResetView] = useState("idle"); // "idle" | "loading" | "sent" | "error"
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }
      setUserEmail(session.user.email || "");
      try {
        const res = await axios.get("/schools/users/me");
        setUserName(res.data.full_name || session.user.email);
      } catch {
        const metaName = session.user.user_metadata?.full_name;
        setUserName(metaName || session.user.email || "");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [navigate]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  async function handleSaveName(e) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) { setNameError("שם לא יכול להיות ריק"); return; }
    setNameSaving(true);
    setNameError("");
    try {
      await axios.patch("/schools/users/me/profile", { full_name: trimmed });
      await supabase.auth.updateUser({ data: { full_name: trimmed } });
      setUserName(trimmed);
      setEditingName(false);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } catch {
      setNameError("שגיאה בשמירה. נסה שנית.");
    } finally {
      setNameSaving(false);
    }
  }

  async function handleResetPassword() {
    setResetView("loading");
    setResetError("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: window.location.origin + "/set-password",
      });
      if (error) {
        const msg = error.message || "";
        if (error.status === 429 || msg.toLowerCase().includes("security purposes") || msg.toLowerCase().includes("rate limit")) {
          setResetError("נשלח מייל לאחרונה — נסה שוב בעוד מספר דקות.");
        } else {
          setResetError(`שגיאה: ${msg || "נסה שנית."}`);
        }
        setResetView("error");
        return;
      }
      setResetView("sent");
    } catch {
      setResetError("שגיאה בשליחת המייל. נסה שנית.");
      setResetView("error");
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">

          {/* Page title */}
          <h1 className="text-2xl font-bold text-slate-900 mb-8">אזור אישי</h1>

          {loading ? (
            <div role="status" aria-label="טוען פרטים" className="flex items-center gap-3 text-slate-400 text-sm">
              <span aria-hidden="true" className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full inline-block animate-spin" />
              טוען...
            </div>
          ) : (
            <div className="flex flex-col gap-6">

              {/* ─── Section 1: Personal Info ─── */}
              <section
                aria-labelledby="section-personal"
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                style={{ boxShadow: "0 2px 16px rgba(0,112,243,0.06)" }}
              >
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 id="section-personal" className="text-base font-semibold text-slate-800">פרטים אישיים</h2>
                </div>

                {/* Horizontal fields row */}
                <div className="px-6 py-5 flex flex-wrap gap-5 items-start">

                  {/* Full name */}
                  <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
                    <label htmlFor="profile-name" className="text-xs font-semibold text-slate-500">שם מלא</label>
                    {editingName ? (
                      <form onSubmit={handleSaveName} className="flex flex-col gap-2">
                        <input
                          ref={nameInputRef}
                          id="profile-name"
                          type="text"
                          value={nameDraft}
                          onChange={e => { setNameDraft(e.target.value); setNameError(""); }}
                          className="w-full border border-blue-300 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          disabled={nameSaving}
                        />
                        {nameError && <p role="alert" className="text-xs text-red-600">{nameError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={nameSaving}
                            className="flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors"
                            style={{ background: "#0070F3" }}
                          >
                            {nameSaving ? "שומר..." : "שמור"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingName(false); setNameDraft(userName); setNameError(""); }}
                            className="flex-1 py-2 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                          >
                            ביטול
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-slate-800 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
                          {userName || "—"}
                        </span>
                        {nameSaved && (
                          <span className="text-xs text-green-600 font-medium">נשמר ✓</span>
                        )}
                        <button
                          onClick={() => { setEditingName(true); setNameDraft(userName); }}
                          aria-label="ערוך שם"
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Email */}
                  <div className="flex flex-col gap-1.5 min-w-[220px] flex-1">
                    <label htmlFor="profile-email" className="text-xs font-semibold text-slate-500">אימייל</label>
                    <input
                      id="profile-email"
                      type="email"
                      value={userEmail}
                      readOnly
                      dir="ltr"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-400 bg-slate-50 cursor-not-allowed"
                    />
                  </div>

                  {/* Password reset */}
                  <div className="flex flex-col gap-1.5 min-w-[180px]">
                    <span className="text-xs font-semibold text-slate-500">סיסמה</span>
                    {resetView === "sent" ? (
                      <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-xl px-3 py-2">
                        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span className="text-xs text-green-700 font-medium">המייל נשלח!</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs text-slate-400">שלח קישור לאיפוס הסיסמה</p>
                        {resetView === "error" && (
                          <p role="alert" className="text-xs text-red-600">{resetError}</p>
                        )}
                        <button
                          onClick={handleResetPassword}
                          disabled={resetView === "loading"}
                          className="py-2 px-4 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                        >
                          {resetView === "loading" ? (
                            <span className="flex items-center justify-center gap-2">
                              <span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full inline-block animate-spin" />
                              שולח...
                            </span>
                          ) : "עדכון סיסמה"}
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              </section>

              {/* ─── Section 2: Meetings (placeholder) ─── */}
              <section
                aria-labelledby="section-meetings"
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                style={{ boxShadow: "0 2px 16px rgba(0,112,243,0.06)" }}
              >
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 id="section-meetings" className="text-base font-semibold text-slate-800">פגישות</h2>
                </div>
                <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm">
                  בקרוב
                </div>
              </section>

              {/* ─── Section 3: Tasks (placeholder) ─── */}
              <section
                aria-labelledby="section-tasks"
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                style={{ boxShadow: "0 2px 16px rgba(0,112,243,0.06)" }}
              >
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 id="section-tasks" className="text-base font-semibold text-slate-800">משימות</h2>
                </div>
                <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm">
                  בקרוב
                </div>
              </section>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
