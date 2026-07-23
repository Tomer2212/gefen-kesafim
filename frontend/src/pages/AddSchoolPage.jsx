import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { useFocusTrap } from "../hooks/useFocusTrap";

// ---- constants (mirrored from AdminPage) ----

const DIVISION_OPTIONS = [
  { value: "tikkon",   label: "חטיבה עליונה" },
  { value: "beinayim", label: "חטיבת ביניים" },
  { value: "yesodi",   label: "יסודי" },
  { value: "other",    label: "אחר" },
];

const SCHOOL_STAGE_OPTIONS = [
  { value: "",            label: "בחר שלב מוסד", divisionType: null },
  { value: "yesodi",      label: "יסודי",          divisionType: "yesodi" },
  { value: "beinayim",    label: "חטיבת ביניים",   divisionType: "beinayim" },
  { value: "tikkon",      label: "תיכון",           divisionType: "tikkon" },
  { value: "sheshshnati", label: "שש שנתי",         divisionType: null },
  { value: "other",       label: "אחר",             divisionType: null },
];

const DEFAULT_CUSTOM_DIVISIONS = [
  { id: 1, division_type: "tikkon" },
  { id: 2, division_type: "beinayim" },
];

const FINANCE_SOFTWARE_OPTIONS = [
  { value: "",           label: "בחר" },
  { value: "kesafim2000", label: "כספים 2000" },
  { value: "payscool",   label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];

const CONTACT_ROWS = [
  { label: "מנהל/ת",        nameField: "principal_name",       phoneField: "principal_phone",       emailField: "principal_email",       dayOffField: "principal_day_off",       coordValue: "principal" },
  { label: "מנהלנ/ית",      nameField: "secretary_name",       phoneField: "secretary_phone",       emailField: "secretary_email",       dayOffField: "secretary_day_off",       coordValue: "secretary" },
  { label: "אחראי/ת כספים", nameField: "finance_contact_name", phoneField: "finance_contact_phone", emailField: "finance_contact_email", dayOffField: "finance_contact_day_off", coordValue: "finance_contact" },
];

const WEEKDAY_OPTIONS = [
  { value: "sun", label: "א" },
  { value: "mon", label: "ב" },
  { value: "tue", label: "ג" },
  { value: "wed", label: "ד" },
  { value: "thu", label: "ה" },
  { value: "fri", label: "ו" },
];

const ROLE_LABELS    = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

const EMPTY_FORM = {
  name: "", symbol: "", city: "", authority: "", stage: "",
  finance_software: "", principal_name: "", principal_phone: "",
  principal_email: "", secretary_name: "", secretary_phone: "",
  secretary_email: "", finance_contact_name: "", finance_contact_phone: "",
  finance_contact_email: "", school_phone: "", address: "", district: "",
  restrict_access_to: [], extra_contacts: [],
  principal_day_off: [], secretary_day_off: [], finance_contact_day_off: [],
  meeting_coordinator: null,
};

function validateSymbol(val) {
  if (!val) return "סמל מוסד הוא שדה חובה";
  if (val.length < 5 || val.length > 6) return "נדרש 5 או 6 ספרות";
  return "";
}

function validateSecretaryPhone(phone) {
  if (!phone) return "";
  if (phone.length !== 10 || !phone.startsWith("05")) return "10 ספרות, חייב להתחיל ב-05";
  return "";
}

function validateSchoolPhone(phone) {
  if (!phone) return "";
  if (!/^\d{9,10}$/.test(phone)) return "9 או 10 ספרות בלבד";
  return "";
}

// ---- AccessSelector (for managers/owners) ----

function AccessSelector({ restrictTo, users, loadingUsers, onChange, schoolAdvisors, onSelectAdvisors }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const containerRef       = useRef(null);

  const isAll    = restrictTo === null || restrictTo === undefined;
  const selected = restrictTo || [];

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer"
        role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        aria-expanded={open} aria-haspopup="listbox"
      >
        {isAll ? (
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#15803d" }}>כולם</span>
        ) : selected.map(id => {
          const u = users.find(u => u.id === id);
          return u ? (
            <span key={id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
              {u.full_name || u.email}
              <button type="button"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); const n = selected.filter(i => i !== id); onChange(n.length === 0 ? null : n); }}
                className="hover:text-red-500 leading-none"
                aria-label={`הסר ${u.full_name || u.email} מרשימת הגישה`}>×</button>
            </span>
          ) : null;
        })}
        {selected.length > 0 && (
          <button type="button"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(null); }}
            className="text-xs text-slate-400 hover:text-slate-600 mr-auto px-1"
            aria-label="אפס לכולם">↺ כולם</button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <label htmlFor="access-sel-search" className="sr-only">חיפוש</label>
            <input id="access-sel-search" type="search" className="input-field text-sm"
              placeholder="חפש יועץ..." value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox">
            <button type="button" role="option" aria-selected={isAll}
              onMouseDown={e => { e.preventDefault(); onChange(null); setOpen(false); }}
              className="w-full text-right px-4 py-2.5 text-sm hover:bg-green-50 flex items-center gap-2">
              <span className={`w-4 h-4 rounded border flex-shrink-0 ${isAll ? "bg-green-500 border-green-500" : "border-slate-300"}`} aria-hidden="true" />
              <span className="font-medium">כולם</span>
              <span className="text-xs text-slate-400 mr-auto">ללא הגבלה</span>
            </button>
            {schoolAdvisors && schoolAdvisors.length > 0 && (
              <button type="button" role="option"
                onMouseDown={e => {
                  e.preventDefault();
                  if (onSelectAdvisors) { onSelectAdvisors(); } else { const ids = schoolAdvisors.map(a => a.id).filter(Boolean); onChange(ids.length > 0 ? ids : null); }
                  setOpen(false);
                }}
                className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2">
                <span className="w-4 h-4 rounded border border-slate-300 flex-shrink-0" aria-hidden="true" />
                <span className="font-medium">היועצים המלווים שנבחרו</span>
                <span className="text-xs text-slate-400 mr-auto">{schoolAdvisors.length} יועצים</span>
              </button>
            )}
            {sortByRole(loadingUsers ? [] : users)
              .filter(u => !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase()))
              .map(u => (
                <button key={u.id} type="button" role="option" aria-selected={selected.includes(u.id)}
                  onMouseDown={e => {
                    e.preventDefault();
                    const newSel = selected.includes(u.id) ? selected.filter(i => i !== u.id) : [...selected, u.id];
                    onChange(newSel.length === 0 ? null : newSel);
                  }}
                  className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2">
                  <span className={`w-4 h-4 rounded border flex-shrink-0 ${selected.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                  {u.full_name || u.email}
                  <span className="text-xs text-slate-400 mr-auto">{ROLE_LABELS[u.role]}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Navigation blocker modal ----

function NavigationBlockerModal({ onStay, onLeave }) {
  const { ref, handleKeyDown } = useFocusTrap(onStay);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="nav-block-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-5">
        <div>
          <h2 id="nav-block-title" className="font-bold text-slate-900 text-lg">עזיבת הדף</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            מעבר לעמוד אחר מבלי לסיים את הוספת בית הספר יגרום לאיבוד הנתונים שהוזנו.
            <br />מה ברצונך לעשות?
          </p>
        </div>
        <div className="flex flex-row gap-2">
          <button onClick={onStay}
            className="flex-1 text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors"
            style={{ background: "#16a34a" }}>
            המשך לערוך
          </button>
          <button onClick={onLeave}
            className="flex-1 text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors"
            style={{ background: "#dc2626" }}>
            עבור לעמוד המבוקש
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main page component ----

export default function AddSchoolPage() {
  const navigate = useNavigate();

  // Auth / permission
  const [checking, setChecking]         = useState(true);
  const [myRole, setMyRole]             = useState("");
  const [canSeeAllUsers, setCanSeeAll]  = useState(false);

  // Form
  const [schoolForm, setSchoolForm]           = useState(EMPTY_FORM);
  const [schoolStage, setSchoolStage]         = useState("");
  const [customDivisions, setCustomDivisions] = useState(DEFAULT_CUSTOM_DIVISIONS);
  const [selectedAdvisors, setSelectedAdvisors] = useState([]);
  const [advisorSearchQuery, setAdvisorSearchQuery] = useState("");
  const [advisorListOpen, setAdvisorListOpen]       = useState(false);
  const [accessLinkedToAdvisors, setAccessLinked]   = useState(false);
  const [triedSave, setTriedSave]   = useState(false);
  const [savingSchool, setSaving]   = useState(false);
  const [saveError, setSaveError]   = useState("");

  // Data
  const [users, setUsers]                   = useState([]);
  const [loadingUsers, setLoadingUsers]     = useState(false);
  const [existingSymbols, setExistingSymbols] = useState([]);

  const advisorContainerRef = useRef(null);
  const advisorInputRef     = useRef(null);

  const symbolError      = validateSymbol(schoolForm.symbol);
  const schoolPhoneError = validateSchoolPhone(schoolForm.school_phone);

  const isDirty = !!(schoolForm.name || schoolForm.symbol || schoolStage || selectedAdvisors.length > 0);
  const blocker = useBlocker(isDirty && !savingSchool);

  // Keep restrict_access_to in sync when "היועצים המלווים" is selected
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    setSchoolForm(p => ({ ...p, restrict_access_to: selectedAdvisors.length > 0 ? selectedAdvisors : [] }));
  }, [selectedAdvisors, accessLinkedToAdvisors]);

  // On mount: verify permission, load users and existing symbols
  useEffect(() => {
    async function init() {
      try {
        const meRes = await axios.get("/schools/users/me");
        const role  = meRes.data?.role;
        setMyRole(role || "");

        if (!role) { navigate("/", { replace: true }); return; }

        if (role === "owner") {
          // always allowed
        } else if (role === "manager") {
          try {
            const permRes = await axios.get("/schools/permissions/defaults");
            if (permRes.data?.can_add_school?.manager === false) {
              navigate("/", { replace: true }); return;
            }
          } catch {} // permissive fallback on error
        } else if (role === "advisor") {
          try {
            const permRes = await axios.get("/schools/permissions/defaults");
            if (permRes.data?.can_add_school?.advisor === false) {
              navigate("/", { replace: true }); return;
            }
          } catch { navigate("/", { replace: true }); return; }
        } else {
          navigate("/", { replace: true }); return;
        }

        // Managers/owners can see all users for advisor selection
        if (role !== "advisor") {
          setCanSeeAll(true);
          setLoadingUsers(true);
          try {
            const res = await axios.get("/schools/users/all");
            setUsers(Array.isArray(res.data) ? res.data : []);
          } finally {
            setLoadingUsers(false);
          }
        }

        // Load existing symbols for duplicate check
        try {
          const sRes = await axios.get("/schools/");
          setExistingSymbols((sRes.data || []).map(s => s.symbol).filter(Boolean));
        } catch {}

      } catch {
        navigate("/", { replace: true });
      } finally {
        setChecking(false);
      }
    }
    init();
  }, []);

  async function saveSchool() {
    setTriedSave(true);
    setSaveError("");
    if (!schoolForm.name || validateSymbol(schoolForm.symbol)) return;
    if (existingSymbols.includes(schoolForm.symbol)) return;
    if (!schoolStage) return;
    if (canSeeAllUsers && selectedAdvisors.length === 0) return;
    if ((schoolStage === "sheshshnati" || schoolStage === "other") && customDivisions.length === 0) return;
    if (schoolForm.principal_phone    && validateSecretaryPhone(schoolForm.principal_phone))    return;
    if (schoolForm.secretary_phone    && validateSecretaryPhone(schoolForm.secretary_phone))    return;
    if (schoolForm.finance_contact_phone && validateSecretaryPhone(schoolForm.finance_contact_phone)) return;
    if (schoolForm.school_phone       && validateSchoolPhone(schoolForm.school_phone))          return;
    if (!schoolForm.meeting_coordinator) return;

    setSaving(true);
    try {
      const res    = await axios.post("/schools/", { ...schoolForm, stage: schoolStage });
      const newId  = res.data.id;
      const option = SCHOOL_STAGE_OPTIONS.find(s => s.value === schoolStage);

      if (option?.divisionType) {
        await axios.post(`/schools/${newId}/accounts`, { division_type: option.divisionType });
      } else {
        for (const div of customDivisions) {
          if (div.division_type) await axios.post(`/schools/${newId}/accounts`, { division_type: div.division_type });
        }
      }

      // Advisors are auto-assigned by the backend; managers/owners need explicit assignment
      if (canSeeAllUsers) {
        for (const advisorId of selectedAdvisors) {
          await axios.post(`/schools/${newId}/advisors`, { advisor_id: advisorId });
        }
      }

      navigate(`/school/${newId}`);
    } catch {
      setSaveError("שגיאה בשמירה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <div dir="rtl" className="bg-scene min-h-screen">
        <Sidebar dark />
        <div style={{ marginRight: "var(--sidebar-w, 240px)" }} className="flex justify-center py-24">
          <div role="status" aria-label="טוען" className="spinner w-8 h-8" />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">

          {/* Header */}
          <div className="mb-8 flex items-center gap-3">
            <button onClick={() => navigate("/")}
              className="text-slate-400 hover:text-slate-700 transition-colors text-sm"
              aria-label="חזרה לרשימת בתי ספר">← חזרה</button>
            <h1 className="text-2xl font-bold text-slate-900">הוספת בית ספר חדש</h1>
          </div>

          {/* Form card */}
          <div className="glass-card rounded-2xl p-6">
            <p className="text-sm font-semibold text-slate-700 mb-3">פרטי בית הספר</p>

            {/* 3-column grid identical to AdminPage */}
            <div className="grid grid-cols-3 gap-x-8">
              {/* Right: שם | סמל | שלב */}
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                <label htmlFor="school-name" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">שם מוסד:</label>
                <div className="py-0.5">
                  <input id="school-name" className={`input-field ${triedSave && !schoolForm.name ? "border-red-400" : ""}`}
                    autoComplete="off" value={schoolForm.name}
                    onChange={e => setSchoolForm(p => ({ ...p, name: e.target.value }))} />
                  {triedSave && !schoolForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                </div>

                <label htmlFor="school-symbol" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">סמל מוסד:</label>
                <div className="py-0.5">
                  <input id="school-symbol"
                    className={`input-field ${triedSave && symbolError ? "border-red-400" : ""}`}
                    autoComplete="off" value={schoolForm.symbol}
                    onChange={e => setSchoolForm(p => ({ ...p, symbol: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                    dir="ltr" inputMode="numeric" maxLength={6} />
                  {schoolForm.symbol.length > 0 && symbolError && <span className="text-xs text-red-500 block mt-0.5" role="alert">{symbolError}</span>}
                  {triedSave && !schoolForm.symbol && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                  {triedSave && schoolForm.symbol && !symbolError && existingSymbols.includes(schoolForm.symbol) && (
                    <span className="text-xs text-red-500 block mt-0.5" role="alert">סמל זה כבר קיים בארגון</span>
                  )}
                </div>

                <label htmlFor="school-stage" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">שלב מוסד:</label>
                <div className="py-0.5">
                  <select id="school-stage"
                    className={`input-field text-sm ${triedSave && !schoolStage ? "border-red-400" : ""}`}
                    value={schoolStage}
                    onChange={e => {
                      setSchoolStage(e.target.value);
                      if (e.target.value === "sheshshnati" || e.target.value === "other") setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
                    }}>
                    {SCHOOL_STAGE_OPTIONS.map(s => <option key={s.value} value={s.value} disabled={s.value === ""}>{s.label}</option>)}
                  </select>
                  {triedSave && !schoolStage && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                </div>
              </div>

              {/* Middle: עיר | בעלות | מחוז */}
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                <label htmlFor="school-city" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">עיר:</label>
                <div className="py-0.5">
                  <input id="school-city" className="input-field" autoComplete="off" value={schoolForm.city}
                    onChange={e => setSchoolForm(p => ({ ...p, city: e.target.value }))} />
                </div>

                <label htmlFor="school-authority" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">בעלות:</label>
                <div className="py-0.5">
                  <input id="school-authority" className="input-field" autoComplete="off" value={schoolForm.authority}
                    onChange={e => setSchoolForm(p => ({ ...p, authority: e.target.value }))} />
                </div>

                <label htmlFor="school-district" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">מחוז:</label>
                <div className="py-0.5">
                  <select id="school-district" className="input-field text-sm"
                    value={schoolForm.district}
                    onChange={e => setSchoolForm(p => ({ ...p, district: e.target.value }))}>
                    <option value="">בחר</option>
                    {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* Left: תוכנת כספים | טלפון | כתובת */}
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                <label htmlFor="school-finance-software" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">תוכנת כספים:</label>
                <div className="py-0.5">
                  <select id="school-finance-software" className="input-field text-sm"
                    value={schoolForm.finance_software}
                    onChange={e => setSchoolForm(p => ({ ...p, finance_software: e.target.value }))}>
                    {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                <label htmlFor="school-phone" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">טלפון בית הספר:</label>
                <div className="py-0.5">
                  <input id="school-phone"
                    className={`input-field ${schoolForm.school_phone && schoolPhoneError ? "border-red-400" : ""}`}
                    autoComplete="off" value={schoolForm.school_phone}
                    onChange={e => setSchoolForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                    dir="ltr" inputMode="numeric" />
                  {schoolForm.school_phone && schoolPhoneError && (
                    <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>
                  )}
                </div>

                <label htmlFor="school-address" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">כתובת:</label>
                <div className="py-0.5">
                  <input id="school-address" className="input-field" autoComplete="off" value={schoolForm.address}
                    onChange={e => setSchoolForm(p => ({ ...p, address: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Custom divisions for שש שנתי / אחר */}
            {(schoolStage === "sheshshnati" || schoolStage === "other") && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-800 font-medium mb-2">חטיבות</p>
                <div className="flex flex-col gap-2 mb-2">
                  {customDivisions.map((div, idx) => (
                    <div key={div.id} className="flex gap-2 items-center">
                      <label htmlFor={`custom-div-${div.id}`} className="sr-only">סוג חטיבה</label>
                      <select id={`custom-div-${div.id}`} className="input-field text-sm flex-1"
                        value={div.division_type}
                        onChange={e => setCustomDivisions(prev => prev.map((d, i) => i === idx ? { ...d, division_type: e.target.value } : d))}>
                        {DIVISION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      <button type="button"
                        onClick={() => setCustomDivisions(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 text-xl leading-none w-7 flex-shrink-0"
                        aria-label="הסר חטיבה">×</button>
                    </div>
                  ))}
                </div>
                <button type="button"
                  onClick={() => setCustomDivisions(prev => [...prev, { id: Date.now(), division_type: "tikkon" }])}
                  className="btn-ghost text-xs px-3 py-1.5">+ הוסף שורה</button>
                {triedSave && customDivisions.length === 0 && (
                  <p className="text-xs text-red-500 mt-1" role="alert">יש להוסיף לפחות חטיבה אחת</p>
                )}
              </div>
            )}

            {/* Contact table */}
            <div className="mt-16 mb-2">
              <p className="text-sm font-semibold text-slate-700 mb-4">אנשי קשר</p>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="text-right pb-2 text-xs text-slate-500 font-semibold w-28"></th>
                    <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">שם</th>
                    <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">טלפון</th>
                    <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">מייל</th>
                    <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">יום חופשי</th>
                    <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">אחראי תיאום פגישות</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTACT_ROWS.map(row => (
                    <tr key={row.nameField} className="border-t border-slate-100">
                      <td className="py-2 pr-1 text-xs text-slate-700 font-medium whitespace-nowrap">{row.label}</td>
                      <td className="py-2 px-2">
                        <label htmlFor={`cname-${row.nameField}`} className="sr-only">{row.label} שם</label>
                        <input id={`cname-${row.nameField}`} className="input-field text-sm" autoComplete="off"
                          value={schoolForm[row.nameField]}
                          onChange={e => setSchoolForm(p => ({ ...p, [row.nameField]: e.target.value }))}
                          placeholder="שם..." />
                      </td>
                      <td className="py-2 px-2">
                        <label htmlFor={`cphone-${row.phoneField}`} className="sr-only">{row.label} טלפון</label>
                        <input id={`cphone-${row.phoneField}`}
                          className={`input-field text-sm ${schoolForm[row.phoneField] && validateSecretaryPhone(schoolForm[row.phoneField]) ? "border-red-400" : ""}`}
                          autoComplete="off" value={schoolForm[row.phoneField]}
                          onChange={e => setSchoolForm(p => ({ ...p, [row.phoneField]: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                          placeholder="טלפון..." dir="ltr" inputMode="numeric" />
                        {schoolForm[row.phoneField] && validateSecretaryPhone(schoolForm[row.phoneField]) && (
                          <span className="text-xs text-red-500 block mt-0.5" role="alert">{validateSecretaryPhone(schoolForm[row.phoneField])}</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <label htmlFor={`cemail-${row.emailField}`} className="sr-only">{row.label} מייל</label>
                        <input id={`cemail-${row.emailField}`} className="input-field text-sm" autoComplete="off"
                          value={schoolForm[row.emailField]}
                          onChange={e => setSchoolForm(p => ({ ...p, [row.emailField]: e.target.value }))}
                          placeholder="מייל..." dir="ltr" type="email" />
                      </td>
                      <td className="py-2 px-2">
                        <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                          selected={schoolForm[row.dayOffField] || []}
                          onChange={v => setSchoolForm(p => ({ ...p, [row.dayOffField]: v }))} />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <label htmlFor={`add-coord-${row.coordValue}`} className="sr-only">{row.label} אחראי/ת לתיאום פגישות</label>
                        <input id={`add-coord-${row.coordValue}`} type="radio" name="add-meeting-coordinator"
                          className="w-4 h-4 accent-blue-600"
                          checked={schoolForm.meeting_coordinator === row.coordValue}
                          disabled={!schoolForm[row.nameField]}
                          onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: row.coordValue }))} />
                      </td>
                    </tr>
                  ))}

                  {(schoolForm.extra_contacts || []).map((ec, i) => (
                    <tr key={`extra-${i}`} className="border-t border-slate-100">
                      <td className="py-1.5 pr-1">
                        <label htmlFor={`erole-${i}`} className="sr-only">תפקיד</label>
                        <input id={`erole-${i}`} className="input-field text-sm" value={ec.role}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], role: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                          autoComplete="off" placeholder="תפקיד..." />
                      </td>
                      <td className="py-1.5 px-2">
                        <label htmlFor={`ename-${i}`} className="sr-only">שם</label>
                        <input id={`ename-${i}`} className="input-field text-sm" value={ec.name}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], name: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                          autoComplete="off" placeholder="שם..." />
                      </td>
                      <td className="py-1.5 px-2">
                        <label htmlFor={`ephone-${i}`} className="sr-only">טלפון</label>
                        <input id={`ephone-${i}`} className="input-field text-sm" value={ec.phone}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], phone: e.target.value.replace(/\D/g, "").slice(0, 10) }; return { ...p, extra_contacts: ec2 }; })}
                          dir="ltr" inputMode="numeric" autoComplete="off" placeholder="טלפון..." />
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-1">
                          <label htmlFor={`eemail-${i}`} className="sr-only">מייל</label>
                          <input id={`eemail-${i}`} className="input-field text-sm" value={ec.email}
                            onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], email: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                            dir="ltr" type="email" autoComplete="off" placeholder="מייל..." />
                          <button type="button"
                            onClick={() => setSchoolForm(p => {
                              let coord = p.meeting_coordinator;
                              if (coord === `extra:${i}`) coord = null;
                              else if (coord?.startsWith("extra:")) {
                                const j = Number(coord.split(":")[1]);
                                if (j > i) coord = `extra:${j - 1}`;
                              }
                              return { ...p, extra_contacts: (p.extra_contacts || []).filter((_, j) => j !== i), meeting_coordinator: coord };
                            })}
                            className="text-slate-400 hover:text-red-500 flex-shrink-0 mr-1 text-base leading-none"
                            aria-label="הסר שורת איש קשר">✕</button>
                        </div>
                      </td>
                      <td className="py-1.5 px-2">
                        <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                          selected={ec.day_off || []}
                          onChange={v => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], day_off: v }; return { ...p, extra_contacts: ec2 }; })} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <label htmlFor={`add-coord-extra-${i}`} className="sr-only">איש קשר נוסף {i + 1} אחראי/ת לתיאום פגישות</label>
                        <input id={`add-coord-extra-${i}`} type="radio" name="add-meeting-coordinator"
                          className="w-4 h-4 accent-blue-600"
                          checked={schoolForm.meeting_coordinator === `extra:${i}`}
                          disabled={!ec.name}
                          onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: `extra:${i}` }))} />
                      </td>
                    </tr>
                  ))}

                  {(schoolForm.extra_contacts || []).length < 3 && (
                    <tr>
                      <td colSpan={6} className="pt-3 pb-1">
                        <button type="button"
                          onClick={() => setSchoolForm(p => ({ ...p, extra_contacts: [...(p.extra_contacts || []), { role: "", name: "", phone: "", email: "" }] }))}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors">
                          <span aria-hidden="true">+</span> הוסף איש קשר
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {triedSave && !schoolForm.meeting_coordinator && (
                <p className="text-xs text-red-500 mt-1.5" role="alert">יש לבחור אחראי/ת לתיאום פגישות</p>
              )}
            </div>

            {/* ליווי */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-sm font-semibold text-slate-700 mb-4">ליווי</p>
              <div className={`grid gap-6 ${canSeeAllUsers ? "grid-cols-2" : "grid-cols-1"}`}>
                {/* יועצים אחראיים */}
                <div>
                  <p className="text-xs text-slate-800 mb-2 font-medium">
                    יועצים אחראיים {canSeeAllUsers && <span className="text-red-500">*</span>}
                  </p>
                  {canSeeAllUsers ? (
                    <>
                      {loadingUsers ? (
                        <p className="text-sm text-slate-400 py-1" role="status" aria-label="טוען יועצים">טוען...</p>
                      ) : (
                        <div
                          ref={advisorContainerRef}
                          onBlur={e => { if (!advisorContainerRef.current?.contains(e.relatedTarget)) setAdvisorListOpen(false); }}
                          className="relative"
                        >
                          <label htmlFor="new-school-advisor-search" className="sr-only">חיפוש יועץ</label>
                          <div
                            className={`input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-text ${triedSave && selectedAdvisors.length === 0 ? "border-red-400" : ""}`}
                            onClick={() => { setAdvisorListOpen(true); advisorInputRef.current?.focus(); }}
                          >
                            {selectedAdvisors.map(id => {
                              const u = users.find(u => u.id === id);
                              return u ? (
                                <span key={id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                                  {u.full_name || u.email}
                                  <button type="button"
                                    onMouseDown={e => {
                                      e.stopPropagation(); e.preventDefault();
                                      const newList = selectedAdvisors.filter(i => i !== id);
                                      setSelectedAdvisors(newList);
                                      if (newList.length === 0) {
                                        setAccessLinked(false);
                                        setSchoolForm(p => ({ ...p, restrict_access_to: [] }));
                                      }
                                    }}
                                    className="hover:text-red-500 leading-none text-base"
                                    aria-label={`הסר ${u.full_name || u.email}`}>×</button>
                                </span>
                              ) : null;
                            })}
                            <input ref={advisorInputRef} id="new-school-advisor-search" type="search"
                              className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
                              placeholder={selectedAdvisors.length === 0 ? "לחץ לבחירת יועץ..." : ""}
                              value={advisorSearchQuery}
                              onFocus={() => setAdvisorListOpen(true)}
                              onChange={e => setAdvisorSearchQuery(e.target.value)} />
                          </div>
                          {advisorListOpen && (
                            <div className="absolute z-20 right-0 left-0 border border-slate-200 rounded-xl overflow-y-auto max-h-44 bg-white divide-y divide-slate-50 mt-1 shadow-lg">
                              {users.length === 0 && <p className="text-sm text-slate-400 px-3 py-2">אין משתמשים</p>}
                              {sortByRole(users)
                                .filter(u => !advisorSearchQuery.trim() || (u.full_name || u.email || "").toLowerCase().includes(advisorSearchQuery.toLowerCase()))
                                .map(u => (
                                  <button key={u.id} type="button"
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      if (selectedAdvisors.includes(u.id)) {
                                        const newList = selectedAdvisors.filter(id => id !== u.id);
                                        setSelectedAdvisors(newList);
                                        if (newList.length === 0) {
                                          setAccessLinked(false);
                                          setSchoolForm(p => ({ ...p, restrict_access_to: [] }));
                                        }
                                      } else {
                                        setSelectedAdvisors(prev => [...prev, u.id]);
                                        if (selectedAdvisors.length === 0) setAccessLinked(true);
                                      }
                                    }}
                                    className="w-full text-right flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer">
                                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selectedAdvisors.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                                    <span className="text-xs text-slate-700 flex-1">{u.full_name || u.email}</span>
                                    <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                      {triedSave && selectedAdvisors.length === 0 && (
                        <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500 py-1">אתה תוקצה אוטומטית לבית הספר</p>
                  )}
                </div>

                {/* גישה — only for managers/owners */}
                {canSeeAllUsers && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <p className="text-xs text-slate-800 font-medium">גישה</p>
                      <span title="בחר למי תהיה גישה לצפות בנתוני בית הספר."
                        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center flex-shrink-0 cursor-help"
                        aria-label="מידע על הגדרת גישה">?</span>
                    </div>
                    <AccessSelector
                      restrictTo={schoolForm.restrict_access_to}
                      users={users}
                      loadingUsers={loadingUsers}
                      onChange={val => { setAccessLinked(false); setSchoolForm(p => ({ ...p, restrict_access_to: val })); }}
                      onSelectAdvisors={() => setAccessLinked(true)}
                      schoolAdvisors={selectedAdvisors.map(id => users.find(u => u.id === id)).filter(Boolean)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 mt-5">
              <button onClick={saveSchool} disabled={savingSchool} className="btn-blue text-sm px-5 py-2">
                {savingSchool ? "שומר..." : "שמור"}
              </button>
              <button onClick={() => navigate("/")} className="btn-ghost text-sm px-5 py-2">ביטול</button>
              {saveError && <span role="alert" className="text-sm text-red-500">{saveError}</span>}
            </div>
          </div>

        </div>
      </div>

      {blocker.state === "blocked" && (
        <NavigationBlockerModal
          onStay={() => blocker.reset?.()}
          onLeave={() => blocker.proceed?.()}
        />
      )}
    </div>
  );
}
