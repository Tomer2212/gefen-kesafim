import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import PersonalMeetingsTab from "./PersonalMeetingsTab";
import PersonalTasksSection from "../components/personTasks/PersonalTasksSection";
import PersonalAttendanceTab from "./PersonalAttendanceTab";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { DOMAIN_OPTIONS } from "../constants/domains";
import Avatar from "../components/Avatar";
import AvatarCropModal from "../components/AvatarCropModal";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

const WORK_PHONE_REGEX = /^05\d{8}$/;
const DOMAIN_LABEL = Object.fromEntries(DOMAIN_OPTIONS.map(o => [o.value, o.label]));
function formatWorkPhone(p) {
  if (!p) return "";
  return p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

const BASE_TABS = [
  { id: "meetings", label: "פגישות" },
  { id: "tasks", label: "משימות" },
  { id: "attendance", label: "שעון נוכחות" },
  { id: "personal", label: "פרטים אישיים" },
];
const TAB_IDS = BASE_TABS.map(t => t.id);
// "שעון נוכחות" מיועד לתפקידים advisor/manager בלבד (owner לא מדווח נוכחות).
const canSeeAttendance = (role) => role === "advisor" || role === "manager";

export default function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // ?tab= in the URL (same pattern as AdminPage.jsx) — a page refresh must land back on the
  // same tab instead of always resetting to "meetings".
  const [activeTab, setActiveTabState] = useState(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return TAB_IDS.includes(t) ? t : "meetings";
  });
  function setActiveTab(id) {
    setActiveTabState(id);
    navigate(`/profile?tab=${id}`, { replace: true });
  }
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const nameInputRef = useRef(null);

  // מגדר — סימבולי בלבד: משפיע על תווית התפקיד ב-Sidebar עבור יועץ/מנהל.
  // "" = אין בחירה (ברירת מחדל), "male" = זכר, "female" = נקבה.
  const [gender, setGender] = useState("");
  const [genderSaving, setGenderSaving] = useState(false);
  const [genderSaved, setGenderSaved] = useState(false);
  const [genderError, setGenderError] = useState("");

  const [resetView, setResetView] = useState("idle"); // "idle" | "loading" | "sent" | "error"
  const [resetError, setResetError] = useState("");

  // טלפון עבודה + תחומי ידע — אותם שדות שמופיעים ב"ניהול > משתמשים".
  // כשלמשתמש (יועץ) אין הרשאת עריכה ישירה — עדכון נשלח לאישור בעלים/מנהל.
  const [workPhone, setWorkPhone] = useState("");
  const [controlDomains, setControlDomains] = useState([]);
  const [canEditPhone, setCanEditPhone] = useState(true);
  const [canEditDomains, setCanEditDomains] = useState(true);
  const [pendingFields, setPendingFields] = useState(() => new Set()); // "work_phone" | "control_domains"

  const [phoneEdit, setPhoneEdit] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [phoneMsg, setPhoneMsg] = useState(""); // "" | "saved" | "sent"

  const [domainsEdit, setDomainsEdit] = useState(false);
  const [domainsDraft, setDomainsDraft] = useState([]);
  const [domainsSaving, setDomainsSaving] = useState(false);
  const [domainsMsg, setDomainsMsg] = useState(""); // "" | "saved" | "sent"

  // תמונת פרופיל
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cropFile, setCropFile] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const avatarInputRef = useRef(null);

  async function refreshPendingFields() {
    try {
      const res = await axios.get("/schools/profile-update-requests");
      const pend = new Set();
      for (const r of (res.data || [])) {
        if (r.status === "pending") {
          for (const k of Object.keys(r.proposed_changes || {})) pend.add(k);
        }
      }
      setPendingFields(pend);
    } catch {
      /* non-fatal — the fields just won't show a "pending" lock */
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }
      setUserEmail(session.user.email || "");
      // Seed the role from the session metadata (mirrored from profiles.role on invite/
      // role-change) so the tab bar shows "שעון נוכחות" correctly on first paint, instead of
      // popping in a few seconds later when the /users/me request resolves. The API result
      // below still overwrites this as the source of truth.
      const metaRole = session.user.user_metadata?.role;
      if (metaRole) setUserRole(metaRole);
      try {
        const res = await axios.get("/schools/users/me");
        setUserName(res.data.full_name || session.user.email);
        setUserId(res.data.id);
        setUserRole(res.data.role);
        setGender(res.data.gender || "");
        setWorkPhone(res.data.work_phone || "");
        setControlDomains(res.data.control_domains || []);
        setCanEditPhone(res.data.can_edit_own_work_phone !== false);
        setCanEditDomains(res.data.can_edit_own_knowledge_areas !== false);
        setAvatarUrl(res.data.avatar_url || "");
        try {
          if (res.data.avatar_url) localStorage.setItem("avatar_url", res.data.avatar_url);
          else localStorage.removeItem("avatar_url");
        } catch { /* ignore */ }
        refreshPendingFields();
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

  async function handleGenderChange(e) {
    const value = e.target.value; // "" | "male" | "female"
    const prev = gender;
    setGender(value);
    setGenderSaving(true);
    setGenderError("");
    setGenderSaved(false);
    try {
      await axios.patch("/schools/users/me/profile", { gender: value || null });
      setGenderSaved(true);
      setTimeout(() => setGenderSaved(false), 2500);
    } catch {
      setGender(prev);
      setGenderError("שגיאה בשמירה. נסה שנית.");
    } finally {
      setGenderSaving(false);
    }
  }

  async function handleSavePhone(e) {
    e?.preventDefault?.();
    const value = phoneDraft.trim();
    if (value !== "" && !WORK_PHONE_REGEX.test(value)) {
      setPhoneError("טלפון עבודה חייב להיות 10 ספרות המתחילות ב-05");
      return;
    }
    setPhoneSaving(true);
    setPhoneError("");
    try {
      const res = await axios.patch("/schools/users/me/profile", { work_phone: value });
      const wentToApproval = (res.data?.pending_fields || []).includes("work_phone");
      if (wentToApproval) {
        setPendingFields(prev => new Set(prev).add("work_phone"));
        setPhoneMsg("sent");
      } else {
        setWorkPhone(value);
        setPhoneMsg("saved");
        setTimeout(() => setPhoneMsg(""), 2500);
      }
      setPhoneEdit(false);
    } catch (err) {
      setPhoneError(err?.response?.data?.detail || "שגיאה בשמירה. נסה שנית.");
    } finally {
      setPhoneSaving(false);
    }
  }

  async function handleSaveDomains() {
    setDomainsSaving(true);
    try {
      const res = await axios.patch("/schools/users/me/profile", { control_domains: domainsDraft });
      const wentToApproval = (res.data?.pending_fields || []).includes("control_domains");
      if (wentToApproval) {
        setPendingFields(prev => new Set(prev).add("control_domains"));
        setDomainsMsg("sent");
      } else {
        setControlDomains(domainsDraft);
        setDomainsMsg("saved");
        setTimeout(() => setDomainsMsg(""), 2500);
      }
      setDomainsEdit(false);
    } catch {
      setDomainsMsg("");
    } finally {
      setDomainsSaving(false);
    }
  }

  function notifyAvatarChanged(url) {
    try {
      if (url) localStorage.setItem("avatar_url", url);
      else localStorage.removeItem("avatar_url");
    } catch { /* ignore */ }
    window.dispatchEvent(new Event("avatar-updated"));
  }

  function handleAvatarPick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setAvatarError("");
    if (!AVATAR_TYPES.includes(f.type)) {
      setAvatarError("קובץ חייב להיות תמונה (JPG, PNG או WebP)");
      return;
    }
    if (f.size > AVATAR_MAX_BYTES) {
      setAvatarError("הקובץ גדול מדי (עד 5MB)");
      return;
    }
    setCropFile(f);
  }

  async function handleAvatarUpload(blob) {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const fd = new FormData();
      fd.append("file", blob, "avatar.jpg");
      const res = await axios.post("/schools/users/me/avatar", fd);
      const url = res.data?.avatar_url || "";
      setAvatarUrl(url);
      notifyAvatarChanged(url);
      setCropFile(null);
      setAvatarMsg("נשמר ✓");
      setTimeout(() => setAvatarMsg(""), 2500);
    } catch (err) {
      setAvatarError(err?.response?.data?.detail || "שגיאה בהעלאת התמונה. נסה שנית.");
      throw err; // keep the crop modal open
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      await axios.delete("/schools/users/me/avatar");
      setAvatarUrl("");
      notifyAvatarChanged("");
      setAvatarMsg("הוסר ✓");
      setTimeout(() => setAvatarMsg(""), 2500);
    } catch {
      setAvatarError("שגיאה בהסרת התמונה. נסה שנית.");
    } finally {
      setAvatarBusy(false);
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
        {/* Header + tabs — fixed width, independent of how wide the active tab's own content
            needs to be, same pattern as AdminPage.jsx's tab bar. */}
        <div className="mx-auto px-6 pt-10 max-w-4xl">
          <h1 className="text-2xl font-bold text-slate-900 mb-8">אזור אישי</h1>

          <div className="flex items-end border-b border-slate-200 mb-6 gap-1">
            {BASE_TABS.filter(t => t.id !== "attendance" || canSeeAttendance(userRole)).map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === t.id
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`mx-auto px-6 pb-10 ${activeTab === "personal" ? "max-w-4xl" : "max-w-[100rem]"}`}>
          {loading ? (
            <div role="status" aria-label="טוען פרטים" className="flex items-center gap-3 text-slate-400 text-sm">
              <span aria-hidden="true" className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full inline-block animate-spin" />
              טוען...
            </div>
          ) : (
            <>
              {activeTab === "meetings" && (
                <PersonalMeetingsTab
                  userId={userId}
                  canDeleteMeetings={userRole === "owner" || userRole === "manager"}
                  users={[]}
                />
              )}

              {activeTab === "tasks" && <PersonalTasksSection />}

              {activeTab === "personal" && (
                <section
                  aria-labelledby="section-personal"
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                  style={{ boxShadow: "0 2px 16px rgba(0,112,243,0.06)" }}
                >
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h2 id="section-personal" className="text-base font-semibold text-slate-800">פרטים אישיים</h2>
                  </div>

                  {/* Fields — 3 columns × 2 rows, each field aligned above the one below it.
                      Row 1: שם מלא · אימייל · סיסמה   Row 2: מגדר · טלפון עבודה · תחומי ידע */}
                  <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-6 items-start">

                    {/* Full name */}
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

                    {/* Password reset */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-slate-500">איפוס סיסמה</span>
                      {resetView === "sent" ? (
                        <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-xl px-3 py-2">
                          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span className="text-xs text-green-700 font-medium">המייל נשלח!</span>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={handleResetPassword}
                            disabled={resetView === "loading"}
                            className="w-full py-2 px-4 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                          >
                            {resetView === "loading" ? (
                              <span className="flex items-center justify-center gap-2">
                                <span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full inline-block animate-spin" />
                                שולח...
                              </span>
                            ) : "שלח קישור למייל לאיפוס סיסמה"}
                          </button>
                          {resetView === "error" && (
                            <p role="alert" className="text-xs text-red-600">{resetError}</p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Gender — symbolic; drives the role label in the sidebar for advisor/manager */}
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="profile-gender" className="text-xs font-semibold text-slate-500">מגדר</label>
                      <div className="flex items-center gap-2">
                        <select
                          id="profile-gender"
                          value={gender}
                          onChange={handleGenderChange}
                          disabled={genderSaving}
                          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
                        >
                          <option value="">בחר/י</option>
                          <option value="male">זכר</option>
                          <option value="female">נקבה</option>
                        </select>
                        {genderSaved && <span className="text-xs text-green-600 font-medium whitespace-nowrap">נשמר ✓</span>}
                      </div>
                      {genderError && <p role="alert" className="text-xs text-red-600">{genderError}</p>}
                    </div>

                    {/* Work phone — same field as "ניהול > משתמשים". Advisor without the
                        "לערוך ישירות מספר טלפון עבודה" permission → change goes to approval. */}
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="profile-work-phone" className="text-xs font-semibold text-slate-500">טלפון עבודה</label>
                      {pendingFields.has("work_phone") ? (
                        <>
                          <span className="w-full text-sm text-slate-800 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 block" dir="ltr">
                            {formatWorkPhone(workPhone) || "—"}
                          </span>
                          <span className="text-xs text-amber-600 font-medium">ממתין לאישור</span>
                        </>
                      ) : phoneEdit ? (
                        <form onSubmit={handleSavePhone} className="flex flex-col gap-2">
                          <input
                            id="profile-work-phone"
                            type="tel"
                            dir="ltr"
                            inputMode="numeric"
                            value={phoneDraft}
                            onChange={e => { setPhoneDraft(e.target.value.replace(/\D/g, "").slice(0, 10)); setPhoneError(""); }}
                            className="w-full border border-blue-300 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            disabled={phoneSaving}
                          />
                          {phoneError && <p role="alert" className="text-xs text-red-600">{phoneError}</p>}
                          {!canEditPhone && <p className="text-xs text-amber-600">השינוי יישלח לאישור בעלים/מנהל</p>}
                          <div className="flex gap-2">
                            <button type="submit" disabled={phoneSaving}
                              className="flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors" style={{ background: "#0070F3" }}>
                              {phoneSaving ? "שומר..." : "שמור"}
                            </button>
                            <button type="button" onClick={() => { setPhoneEdit(false); setPhoneDraft(workPhone); setPhoneError(""); }}
                              className="flex-1 py-2 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                              ביטול
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => { setPhoneEdit(true); setPhoneDraft(workPhone); setPhoneMsg(""); }}
                            aria-label={workPhone ? "ערוך טלפון עבודה" : "הוסף טלפון עבודה"}
                            className="w-full min-h-[38px] text-sm border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center"
                          >
                            {workPhone ? (
                              <span dir="ltr" className="text-slate-800">{formatWorkPhone(workPhone)}</span>
                            ) : (
                              <span className="mx-auto text-slate-400" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              </span>
                            )}
                          </button>
                          {phoneMsg === "saved" && <span className="text-xs text-green-600 font-medium">נשמר ✓</span>}
                          {phoneMsg === "sent" && <span className="text-xs text-amber-600 font-medium">נשלח לאישור ✓</span>}
                        </>
                      )}
                    </div>

                    {/* Knowledge areas (control_domains) — same field as "ניהול > משתמשים". */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-slate-500">תחומי ידע</span>
                      {pendingFields.has("control_domains") ? (
                        <>
                          <span className="w-full text-sm text-slate-800 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 block">
                            {controlDomains.length ? controlDomains.map(d => DOMAIN_LABEL[d] || d).join(", ") : "—"}
                          </span>
                          <span className="text-xs text-amber-600 font-medium">ממתין לאישור</span>
                        </>
                      ) : domainsEdit ? (
                        <div className="flex flex-col gap-2">
                          <MultiSelectChips
                            neutral
                            options={DOMAIN_OPTIONS}
                            selected={domainsDraft}
                            onChange={setDomainsDraft}
                            placeholder="בחר תחומים"
                          />
                          {!canEditDomains && <p className="text-xs text-amber-600">השינוי יישלח לאישור בעלים/מנהל</p>}
                          <div className="flex gap-2">
                            <button type="button" onClick={handleSaveDomains} disabled={domainsSaving}
                              className="flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors" style={{ background: "#0070F3" }}>
                              {domainsSaving ? "שומר..." : "שמור"}
                            </button>
                            <button type="button" onClick={() => { setDomainsEdit(false); setDomainsDraft(controlDomains); }}
                              className="flex-1 py-2 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                              ביטול
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => { setDomainsEdit(true); setDomainsDraft(controlDomains); setDomainsMsg(""); }}
                            aria-label={controlDomains.length ? "ערוך תחומי ידע" : "הוסף תחומי ידע"}
                            className="w-full min-h-[38px] text-sm border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center"
                          >
                            {controlDomains.length ? (
                              <span className="text-slate-800">{controlDomains.map(d => DOMAIN_LABEL[d] || d).join(", ")}</span>
                            ) : (
                              <span className="mx-auto text-slate-400" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              </span>
                            )}
                          </button>
                          {domainsMsg === "saved" && <span className="text-xs text-green-600 font-medium">נשמר ✓</span>}
                          {domainsMsg === "sent" && <span className="text-xs text-amber-600 font-medium">נשלח לאישור ✓</span>}
                        </>
                      )}
                    </div>

                  </div>

                  {/* Profile picture — shown as a circle in the Sidebar */}
                  <div className="border-t border-slate-100 px-6 py-5">
                    <h3 className="text-xs font-semibold text-slate-500 mb-3">תמונת פרופיל</h3>
                    <div className="flex items-center gap-4">
                      <Avatar url={avatarUrl} name={userName} size={96} />
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            disabled={avatarBusy}
                            className="py-2 px-4 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                          >
                            {avatarUrl ? "החלף תמונה" : "העלה תמונה"}
                          </button>
                          {avatarUrl && (
                            <button
                              type="button"
                              onClick={handleAvatarRemove}
                              disabled={avatarBusy}
                              className="py-2 px-4 rounded-xl text-sm font-medium border border-slate-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                            >
                              הסר תמונה
                            </button>
                          )}
                          {avatarMsg && <span className="text-xs text-green-600 font-medium self-center">{avatarMsg}</span>}
                        </div>
                        <p className="text-xs text-slate-400">JPG, PNG או WebP · עד 5MB</p>
                        {avatarError && <p role="alert" className="text-xs text-red-600">{avatarError}</p>}
                      </div>
                      <label htmlFor="profile-avatar-input" className="sr-only">בחירת תמונת פרופיל</label>
                      <input
                        id="profile-avatar-input"
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleAvatarPick}
                      />
                    </div>
                  </div>
                </section>
              )}

              {cropFile && (
                <AvatarCropModal
                  file={cropFile}
                  onCancel={() => { setCropFile(null); setAvatarError(""); }}
                  onConfirm={handleAvatarUpload}
                />
              )}

              {activeTab === "attendance" && canSeeAttendance(userRole) && (
                <PersonalAttendanceTab userName={userName} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
