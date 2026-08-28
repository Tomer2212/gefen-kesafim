import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { useFocusTrap } from "../hooks/useFocusTrap";
import sidebarLogoImg from "../assets/logo-sidebar.png";
import NotificationToastContainer from "./NotificationToast";
import { useMeetingReminders } from "../context/MeetingRemindersContext";

const ROLE_LABEL = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };

// When the "auto-complete meeting status from activity" org automation is ON, defer the
// end-of-meeting status popup by 1h (window 1h–3h after end) so the automation has time to
// flip the meeting to "completed" first, avoiding a race between the two mechanisms.
const STATUS_POPUP_AUTO_DELAY_MS = 60 * 60 * 1000;
const STATUS_POPUP_AUTO_WINDOW_END_MS = 3 * 60 * 60 * 1000;

function sessionIsValid(session) {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return (session.expires_at - 60) > Math.floor(Date.now() / 1000);
}

function Icon({ d, d2, circle, rect, viewBox = "0 0 24 24" }) {
  return (
    <svg width="18" height="18" viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {circle && <circle cx={circle[0]} cy={circle[1]} r={circle[2]} />}
      {rect && <rect x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} rx={rect[4] || 0} />}
      {d && <path d={d} />}
      {d2 && <path d={d2} />}
    </svg>
  );
}

function NavItem({ icon, label, active, onClick, badge, dark, collapsed }) {
  const baseClass = collapsed
    ? "flex items-center justify-center w-full py-2.5 rounded-xl text-sm font-medium transition-all relative"
    : "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right";
  const stateClass = dark
    ? (active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white")
    : (active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900");
  const iconClass = dark
    ? (active ? "text-white" : "text-white/45")
    : (active ? "text-blue-600" : "text-slate-400");

  return (
    <button
      onClick={onClick}
      className={`${baseClass} ${stateClass}`}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {!collapsed && <span className="flex-1 text-right">{label}</span>}
      <span className={`flex-shrink-0 relative ${iconClass}`}>
        {icon}
        {badge > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: "#ef4444", padding: "0 3px" }}
            aria-label={`${badge} התראות`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
    </button>
  );
}

function ProfileModal({ userName, userEmail, onClose, onNameSaved }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [view, setView] = useState("profile"); // "profile" | "reset-sent"
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(userName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const nameInputRef = useRef(null);

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
      // Sync the local Supabase session metadata so the sidebar reads the new name on next load
      await supabase.auth.updateUser({ data: { full_name: trimmed } });
      onNameSaved(trimmed);
      setEditingName(false);
    } catch {
      setNameError("שגיאה בשמירה. נסה שנית.");
    } finally {
      setNameSaving(false);
    }
  }

  async function handleResetPassword() {
    setResetLoading(true);
    setResetError("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: window.location.origin + "/set-password",
      });
      if (error) {
        console.error("Password reset error:", error);
        const msg = error.message || "";
        if (error.status === 429 || msg.toLowerCase().includes("security purposes") || msg.toLowerCase().includes("rate limit")) {
          setResetError("נשלח מייל לאחרונה — נסה שוב בעוד מספר דקות.");
        } else {
          setResetError(`שגיאה: ${msg || "נסה שנית."}`);
        }
        return;
      }
      setView("reset-sent");
    } catch (err) {
      console.error("Password reset exception:", err);
      setResetError("שגיאה בשליחת המייל. נסה שנית.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 id="profile-modal-title" className="text-base font-semibold text-slate-800">אזור אישי</h2>
          <button
            onClick={onClose}
            aria-label="סגור"
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">

          {view === "profile" && (
            <div className="flex flex-col gap-5">

              {/* Name field */}
              <div className="flex flex-col gap-1.5">
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
                    {nameError && (
                      <p role="alert" className="text-xs text-red-600">{nameError}</p>
                    )}
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

              {/* Email field */}
              <div className="flex flex-col gap-1.5">
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

              {/* Divider */}
              <div className="h-px bg-slate-100" />

              {/* Password reset */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-500">נשלח אליך קישור לאיפוס הסיסמה למייל שלך.</p>
                {resetError && (
                  <p role="alert" className="text-xs text-red-600">{resetError}</p>
                )}
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  className="w-full py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {resetLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full inline-block" style={{ animation: "spin 0.7s linear infinite" }} />
                      שולח...
                    </span>
                  ) : "עדכון סיסמה"}
                </button>
              </div>
            </div>
          )}

          {view === "reset-sent" && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}>
                <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-800 text-base">המייל נשלח!</p>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  בדוק את תיבת הדואר בכתובת<br />
                  <span className="font-medium text-slate-700" dir="ltr">{userEmail}</span><br />
                  והקלק על הקישור לאיפוס הסיסמה.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                style={{ background: "#0070F3" }}
              >
                סגור
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ dark = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [role, setRole] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const { addMeetingReminder, addStatusReminder, addTaskReminder, addCallAttribReminder, setUserName: setCtxUserName } = useMeetingReminders();
  const prevCountRef = useRef(0);
  const lastPollTimeRef = useRef(Date.now());
  const notifPrefsRef = useRef({ meeting_reminder: true, meeting_reminder_minutes: 10 });
  const autoCompleteRef = useRef(false);
  const wakeRefreshRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(collapsed)); } catch {}
    document.documentElement.style.setProperty("--sidebar-w", collapsed ? "64px" : "240px");
  }, [collapsed]);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const metaName = session.user.user_metadata?.full_name;
      const metaRole = session.user.user_metadata?.role || "advisor";
      setUserEmail(session.user.email || "");
      try {
        const res = await axios.get("/schools/users/me");
        const name = res.data.full_name || session.user.email;
        setUserName(name);
        setCtxUserName(name);
        setRole(res.data.role || metaRole);
        setOrgName(res.data.org?.name || "");
        setIsSuperAdmin(!!res.data.is_superadmin);
        if (res.data.notification_preferences) {
          notifPrefsRef.current = res.data.notification_preferences;
        }
        autoCompleteRef.current = !!res.data.org?.auto_complete_meetings_from_activity_enabled;
      } catch {
        setUserName(metaName || session.user.email || "");
        setRole(metaRole);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function fetchCount() {
      if (wakeRefreshRef.current) await wakeRefreshRef.current;
      const { data: { session } } = await supabase.auth.getSession();
      if (!sessionIsValid(session)) return;
      try {
        const pollTime = Date.now();
        const res = await axios.get("/schools/notifications");
        const newCount = res.data.count || 0;
        const items = res.data.items || [];

        // Show toasts for new unread notifications (not on first load)
        if (newCount > prevCountRef.current && prevCountRef.current > 0) {
          const newItems = items.filter(n =>
            !n.read_at && new Date(n.created_at).getTime() > lastPollTimeRef.current
          );
          if (newItems.length > 0) {
            setToasts(prev => [
              ...prev,
              ...newItems.map(n => ({ id: `notif-${n.id}`, type: n.type, data: n.data })),
            ]);
          }
        }
        prevCountRef.current = newCount;
        lastPollTimeRef.current = pollTime;
        setNotifCount(newCount);
      } catch {
        // silent
      }
    }

    async function checkMeetingReminders() {
      if (wakeRefreshRef.current) await wakeRefreshRef.current;
      const { data: { session } } = await supabase.auth.getSession();
      if (!sessionIsValid(session)) return;
      const userId = session.user.id;
      const prefs = notifPrefsRef.current;
      if (!prefs.meeting_reminder) return;
      try {
        const res = await axios.get("/schools/upcoming-meetings");
        const meetings = res.data || [];
        const now = new Date();
        const reminderMs = (prefs.meeting_reminder_minutes || 10) * 60 * 1000;
        const twoHours = 2 * 60 * 60 * 1000;
        // Meetings whose reminder toast fires THIS tick — collected so the "יש לך משימה" toast
        // can be batched into one request instead of one /active-for-schools call per meeting.
        const firingMeetings = [];

        for (const m of meetings) {
          if (!m.start_time || !m.meeting_date) continue;
          // Parse as local time (no UTC offset) to avoid midnight timezone shift
          const meetingTime = new Date(`${m.meeting_date}T${m.start_time}:00`);
          const msUntil = meetingTime.getTime() - now.getTime();
          const key = `reminder-${m.id}-${m.meeting_date}-${m.start_time}`;

          const stored = sessionStorage.getItem(key);
          const dismissed = stored === "1";
          const snoozed = stored?.startsWith("snooze:");
          const snoozeDue = snoozed && Date.now() >= parseInt(stored.slice(7));

          const inWindow = msUntil >= 0 && msUntil <= reminderMs;
          const shouldFire = (!dismissed && !snoozed && inWindow) || (snoozeDue && msUntil >= 0);

          if (shouldFire) {
            sessionStorage.setItem(key, "1");
            addMeetingReminder({ ...m, msUntil });
            firingMeetings.push(m);
          }

          // End-of-meeting status update reminder
          if (m.end_time && m.status === "scheduled") {
            const meetingAdvisors = (m.advisor_ids || []).length > 0
              ? m.advisor_ids
              : (m.school_advisor_ids || []);
            const isAssigned = meetingAdvisors.includes(userId);
            if (isAssigned) {
              const endTime = new Date(`${m.meeting_date}T${m.end_time}:00`);
              const msAfterEnd = now.getTime() - endTime.getTime();
              const statusKey = `status-reminder-${m.id}-${m.meeting_date}-${m.end_time}`;
              // When the org's auto-complete automation is on, defer this popup to 1h–3h after
              // the meeting's end (instead of 0–2h) so the automation gets a chance to flip the
              // meeting to "completed" first. If it's still "scheduled" after an hour, no linked
              // call arrived and no offline work was logged — so it's right to ask the advisor.
              const autoOn = autoCompleteRef.current;
              const lowerBound = autoOn ? STATUS_POPUP_AUTO_DELAY_MS : 0;
              const upperBound = autoOn ? STATUS_POPUP_AUTO_WINDOW_END_MS : twoHours;
              if (msAfterEnd >= lowerBound && msAfterEnd <= upperBound && !sessionStorage.getItem(statusKey)) {
                sessionStorage.setItem(statusKey, "1");
                addStatusReminder({ ...m });
              }
            }
          }
        }

        // "יש לך גם משימה לביצוע פה" — piggybacks on the meeting reminder that just fired above
        // (same instant, same on/off preference), rather than its own separate time-window
        // trigger. Deduped independently (own sessionStorage key, still tied to the meeting's
        // own id/date/start_time so a rescheduled meeting can re-fire it) so it never depends on
        // whether the meeting-reminder toast itself is still open.
        if (firingMeetings.length) {
          const dueMeetings = firingMeetings.filter(m => {
            const taskKey = `task-reminder-${m.id}-${m.meeting_date}-${m.start_time}`;
            return !sessionStorage.getItem(taskKey);
          });
          if (dueMeetings.length) {
            try {
              const schoolIds = [...new Set(dueMeetings.map(m => m.school_id))];
              const activeRes = await axios.get("/person-tasks/active-for-schools", {
                params: { school_ids: schoolIds.join(",") },
              });
              const activeBySchool = activeRes.data || {};
              for (const m of dueMeetings) {
                const taskKey = `task-reminder-${m.id}-${m.meeting_date}-${m.start_time}`;
                sessionStorage.setItem(taskKey, "1");
                const taskNames = activeBySchool[m.school_id];
                if (taskNames?.length) {
                  addTaskReminder({ school_id: m.school_id, school_name: m.school_name, task_names: taskNames, meeting_id: m.id });
                }
              }
            } catch {
              // non-fatal — a failed lookup here must never block the meeting reminder itself
            }
          }
        }

        // Manual status reminders triggered by manager/owner
        try {
          const manualRes = await axios.get("/schools/meetings/pending-status-reminders");
          const pending = manualRes.data || [];
          for (const r of pending) {
            addStatusReminder({ ...r });
            // Mark shown in background (non-blocking)
            axios.patch(`/schools/meetings/status-reminders/${r.reminder_id}/mark-shown`).catch(() => {});
          }
        } catch {
          // non-fatal
        }
      } catch (e) {
        console.error("[Reminders] error:", e);
      }
    }

    // Unknown-number call prompts — an interrupting popup asking the advisor whether an
    // unrecognised number belongs to a school. Detected by the Voicenter cron; surfaced here.
    async function checkUnknownCallPrompts() {
      if (wakeRefreshRef.current) await wakeRefreshRef.current;
      const { data: { session } } = await supabase.auth.getSession();
      if (!sessionIsValid(session)) return;
      try {
        const res = await axios.get("/voicenter/calls/unknown/my-prompts");
        for (const p of (res.data?.prompts || [])) {
          const key = `call-attrib-${p.call_id}`;
          if (sessionStorage.getItem(key)) continue;
          sessionStorage.setItem(key, "1");
          addCallAttribReminder({ ...p });
        }
      } catch {
        // silent — must never block other polling
      }
    }

    fetchCount();
    checkMeetingReminders();
    checkUnknownCallPrompts();
    const t = setInterval(() => { fetchCount(); checkMeetingReminders(); checkUnknownCallPrompts(); }, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        wakeRefreshRef.current = supabase.auth.refreshSession().finally(() => {
          wakeRefreshRef.current = null;
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.replace("/login");
  }

  const is = (path) => location.pathname === path;

  const sidebarWidth = collapsed ? 64 : 240;
  const TRANSITION = "0.25s cubic-bezier(0.4,0,0.2,1)";

  const asideStyle = dark
    ? { width: sidebarWidth, background: "#18181b", borderLeft: "1px solid rgba(255,255,255,0.07)", transition: `width ${TRANSITION}`, overflow: "hidden" }
    : { width: sidebarWidth, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderLeft: "1px solid rgba(0,112,243,0.1)", boxShadow: "-4px 0 24px rgba(0,112,243,0.06)", transition: `width ${TRANSITION}`, overflow: "hidden" };

  const dividerClass = dark ? "h-px mx-4 mb-2 bg-white/10" : "h-px bg-slate-100 mx-4 mb-2";
  const innerDividerClass = dark ? "h-px my-1 bg-white/10" : "h-px bg-slate-100 my-1";

  return (
    <>
      <aside
        className="fixed top-0 right-0 h-screen z-40 flex flex-col"
        style={asideStyle}
        aria-label="תפריט ניווט"
      >
        {/* Logo + tagline */}
        <button
          onClick={() => navigate("/")}
          aria-label="עמוד הבית"
          className="flex flex-col items-center px-4 pt-6 pb-4 hover:opacity-90 transition-opacity w-full"
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          {collapsed ? (
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: "1.5rem", lineHeight: 1, color: "white" }}>G</span>
          ) : (
            <img src={sidebarLogoImg} alt="גפן AI לוגו" className="h-10 w-auto object-contain" />
          )}
        </button>

        {/* User info */}
        {!collapsed && (
          <div
            className="mx-3 mb-3 px-3 py-2.5 rounded-xl"
            style={dark
              ? { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }
              : { background: "#f8fafc", border: "1px solid #f1f5f9" }}
          >
            <p className={`text-sm font-semibold truncate ${dark ? "text-white" : "text-slate-800"}`}>{userName || "..."}</p>
            <p className={`text-xs mt-0.5 ${dark ? "text-white/40" : "text-slate-400"}`}>
              {ROLE_LABEL[role] || role}{orgName ? `, ${orgName}` : ""}
            </p>
          </div>
        )}

        {!collapsed && <div className={dividerClass} />}

        {/* Navigation */}
        <nav className={`flex-1 flex flex-col gap-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`} aria-label="ניווט ראשי">
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />}
            label="בית" active={is("/")} onClick={() => navigate("/")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" circle={[12, 7, 4]} />}
            label="אזור אישי" active={is("/profile")} onClick={() => navigate("/profile")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" d2="M13.73 21a2 2 0 0 1-3.46 0" />}
            label="התראות" active={is("/notifications")} onClick={() => navigate("/notifications")} badge={notifCount}
          />
          {(role === "owner" || role === "manager") && (
            <NavItem dark={dark} collapsed={collapsed}
              icon={<Icon d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" circle={[12, 12, 3]} />}
              label="ניהול" active={is("/admin")} onClick={() => navigate("/admin")}
            />
          )}
          {isSuperAdmin && (
            <NavItem dark={dark} collapsed={collapsed}
              icon={<Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />}
              label="ניהול מערכת" active={is("/super-admin")} onClick={() => navigate("/super-admin")}
            />
          )}

          <div className="flex-1 min-h-3" />
          {!collapsed && <div className={innerDividerClass} />}

          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" d2="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />}
            label="הדרכה" active={is("/guide")} onClick={() => navigate("/guide")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" d2="m22 6-10 7L2 6" />}
            label="צור קשר" active={is("/contact")} onClick={() => navigate("/contact")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" circle={[9, 7, 4]} />}
            label="נגישות" active={is("/accessibility")} onClick={() => navigate("/accessibility")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M16 13H8M16 17H8M10 9H8" />}
            label="תנאי שימוש" active={is("/terms")} onClick={() => navigate("/terms")}
          />
          <NavItem dark={dark} collapsed={collapsed}
            icon={<Icon rect={[3, 11, 18, 11, 2]} d="M7 11V7a5 5 0 0 1 10 0v4" />}
            label="מדיניות פרטיות" active={is("/privacy")} onClick={() => navigate("/privacy")}
          />
        </nav>

        {/* Logout */}
        <div className="p-3" style={{ borderTop: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid #f1f5f9" }}>
          <button
            onClick={handleLogout}
            title={collapsed ? "יציאה" : undefined}
            aria-label={collapsed ? "יציאה" : undefined}
            className={`flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              collapsed ? "justify-center" : "gap-3"
            } ${
              dark ? "text-white/50 hover:bg-red-500/15 hover:text-red-400" : "text-slate-500 hover:bg-red-50 hover:text-red-600"
            }`}
          >
            {!collapsed && <span className="flex-1 text-right">יציאה</span>}
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Collapse/expand toggle — floats on the sidebar's left border, vertically centered */}
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? "הרחב תפריט" : "צמצם תפריט"}
        title={collapsed ? "הרחב תפריט" : "צמצם תפריט"}
        className="fixed z-50 w-6 h-6 rounded-full flex items-center justify-center shadow-md"
        style={{
          top: "50%",
          right: sidebarWidth - 12,
          transform: "translateY(-50%)",
          background: dark ? "#3f3f46" : "white",
          border: dark ? "1px solid rgba(255,255,255,0.18)" : "1px solid #e2e8f0",
          color: dark ? "rgba(255,255,255,0.55)" : "#94a3b8",
          transition: `right ${TRANSITION}`,
          cursor: "pointer",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {collapsed
            ? <path d="M15 18l-6-6 6-6" />
            : <path d="M9 18l6-6-6-6" />
          }
        </svg>
      </button>

    </>
  );
}
