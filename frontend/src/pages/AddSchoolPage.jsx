import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import axios from "axios";
import { Building2, Phone, Handshake, UsersRound } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { AdvisorSearch } from "../components/AdvisorSearch";
import HourMinuteInput from "../components/HourMinuteInput";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { useFocusTrap } from "../hooks/useFocusTrap";

// ── Shared visual language with SchoolPage.jsx's "פרטי בית הספר" tab ──
const SECTION_TITLE_CLS = "text-[23px] font-bold text-black flex items-center gap-2";
function sectionIcon(Icon, accentCls) {
  return (
    <span aria-hidden="true" className={`inline-flex items-center justify-center p-2 rounded-xl flex-shrink-0 ${accentCls}`}>
      <Icon className="w-4 h-4" strokeWidth={2} />
    </span>
  );
}
function sectionTitle(Icon, text, accentCls) {
  return <p className={SECTION_TITLE_CLS}>{text}{sectionIcon(Icon, accentCls)}</p>;
}
const SECTION_HEADER_CLS = "flex items-center justify-between pb-3 mb-4 border-b border-slate-200/60";
const TILE_CLS = "bg-slate-100/70 border border-slate-200/90 rounded-xl py-3.5 px-3 min-h-[76px]";
const TILE_LABEL_CLS = "text-[13px] font-medium text-gray-500 mb-1 block";
const OUTLINE_BTN_CLS = "border border-slate-300 hover:border-slate-400 text-slate-700 bg-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-all";

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

const PRINCIPAL_TICHON_ROW  = { label: "מנהל/ת חט\"ע", nameField: "principal_name",         phoneField: "principal_phone",         emailField: "principal_email",         dayOffField: "principal_day_off",         coordValue: "principal" };
const PRINCIPAL_SINGLE_ROW  = { label: "מנהל/ת",       nameField: "principal_name",         phoneField: "principal_phone",         emailField: "principal_email",         dayOffField: "principal_day_off",         coordValue: "principal" };
const PRINCIPAL_CHATIVA_ROW = { label: "מנהל/ת חט\"ב", nameField: "principal_chativa_name", phoneField: "principal_chativa_phone", emailField: "principal_chativa_email", dayOffField: "principal_chativa_day_off", coordValue: "principal_chativa" };

const CONTACT_ROWS = [
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

const STUDY_DAY_OPTIONS = [
  ...WEEKDAY_OPTIONS,
  { value: "sat", label: "ש" },
];

const SECTOR_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "יהודי", label: "יהודי" },
  { value: "ערבי", label: "ערבי" },
  { value: "צ'רקסי", label: "צ'רקסי" },
  { value: "בדואי", label: "בדואי" },
  { value: "דרוזי", label: "דרוזי" },
];

const SUPERVISION_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "ממלכתי", label: "ממלכתי" },
  { value: "ממלכתי דתי", label: "ממלכתי דתי" },
  { value: "חרדי", label: "חרדי" },
];

const GRADE_LEVEL_OPTIONS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "יא", "יב"].map(
  (label) => ({ value: label, label })
);

const ROLE_LABELS    = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

// "ליווי" section fields — mirrored from SchoolPage.jsx (same project convention: no shared
// constants source for these label maps, duplicated per page like everything else here).
const SERVICE_TYPE_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district", label: "מחוז" },
];

const FUNDING_METHOD_OPTIONS = [
  { value: "private", label: "פרטי" },
  { value: "authority", label: "רשות" },
  { value: "district", label: "מחוז" },
];

const TYPED_SERVICE_TYPES = [
  { key: "gefen", label: "גפן" },
  { key: "current", label: "שוטף" },
  { key: "district", label: "מחוז" },
];

// Which of the 3 typed advisor lists are mandatory, given the school's own "סוג שירות" value —
// gefen_current requires both גפן and שוטף advisors to be set.
function activeServiceTypes(serviceType) {
  if (serviceType === "gefen") return ["gefen"];
  if (serviceType === "current") return ["current"];
  if (serviceType === "district") return ["district"];
  if (serviceType === "gefen_current") return ["gefen", "current"];
  return [];
}

const CLIENT_STATUS_OPTIONS = [
  { value: "active", label: "פעיל" },
  { value: "inactive", label: "לא פעיל" },
  { value: "in_progress", label: "בתהליך" },
  { value: "former", label: "לקוח עבר" },
];

// Thousands-separated (no decimal) display for "מחיר כולל מע\"מ" — "" for empty.
function formatAmount(v) {
  return v === null || v === undefined || v === "" ? "" : Math.round(Number(v)).toLocaleString("he-IL");
}

// Strips thousands separators back to a plain number (or null if empty) for saving.
function parseAmount(raw) {
  const stripped = String(raw).replace(/,/g, "").trim();
  return stripped === "" ? null : Number(stripped);
}

const EMPTY_FORM = {
  name: "", symbol: "", city: "", authority: "", stage: "",
  finance_software: "", principal_name: "", principal_phone: "",
  principal_email: "", secretary_name: "", secretary_phone: "",
  secretary_email: "", finance_contact_name: "", finance_contact_phone: "",
  finance_contact_email: "", school_phone: "", address: "", district: "",
  restrict_access_to: [], extra_contacts: [],
  principal_day_off: [], secretary_day_off: [], finance_contact_day_off: [],
  meeting_coordinator: null,
  principal_chativa_name: "", principal_chativa_phone: "", principal_chativa_email: "",
  principal_chativa_day_off: [], principal_same_person: true,
  education_authority: "", sector: "", supervision: "",
  grade_levels: [], study_days: [], student_count: "",
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
  const [typedAdvisorIds, setTypedAdvisorIds] = useState({ gefen: [], current: [], district: [] });
  const [yearAdminForm, setYearAdminForm] = useState({
    client_status: null, service_type: null, order_method: [], order_amount_gefen: null,
    meeting_allocation_gefen: null, meeting_allocation_current: null, meeting_allocation_district: null,
    meeting_duration_gefen: null, meeting_duration_current: null, meeting_duration_district: null,
  });
  const [accessLinkedToAdvisors, setAccessLinked]   = useState(false);
  const [triedSave, setTriedSave]   = useState(false);
  const [savingSchool, setSaving]   = useState(false);
  const [saveError, setSaveError]   = useState("");

  // Data
  const [users, setUsers]                   = useState([]);
  const [loadingUsers, setLoadingUsers]     = useState(false);
  const [existingSymbols, setExistingSymbols] = useState([]);

  // Union of the 3 typed advisor lists — source for "גישה" when linked to "היועצים המלווים".
  const draftLinkedAdvisorIds = [...new Set([...typedAdvisorIds.gefen, ...typedAdvisorIds.current, ...typedAdvisorIds.district])];

  const symbolError      = validateSymbol(schoolForm.symbol);
  const schoolPhoneError = validateSchoolPhone(schoolForm.school_phone);

  const isDirty = !!(schoolForm.name || schoolForm.symbol || schoolStage || draftLinkedAdvisorIds.length > 0);
  const blocker = useBlocker(isDirty && !savingSchool);

  // Keep restrict_access_to in sync when "היועצים המלווים" is selected
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    setSchoolForm(p => ({ ...p, restrict_access_to: draftLinkedAdvisorIds.length > 0 ? draftLinkedAdvisorIds : [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedAdvisorIds, accessLinkedToAdvisors]);

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
    if (canSeeAllUsers) {
      const requiredTypes = activeServiceTypes(yearAdminForm.service_type);
      if (yearAdminForm.client_status === "active" && requiredTypes.some(t => typedAdvisorIds[t].length === 0)) {
        setSaveError("יש לבחור לפחות יועץ מלווה אחד עבור כל סוג שירות פעיל (גפן/שוטף/מחוז).");
        return;
      }
    }
    if ((schoolStage === "sheshshnati" || schoolStage === "other") && customDivisions.length === 0) return;
    if (schoolForm.principal_phone    && validateSecretaryPhone(schoolForm.principal_phone))    return;
    if (schoolForm.secretary_phone    && validateSecretaryPhone(schoolForm.secretary_phone))    return;
    if (schoolForm.finance_contact_phone && validateSecretaryPhone(schoolForm.finance_contact_phone)) return;
    if (schoolStage === "sheshshnati" && !schoolForm.principal_same_person
        && schoolForm.principal_chativa_phone && validateSecretaryPhone(schoolForm.principal_chativa_phone)) return;
    if (schoolForm.school_phone       && validateSchoolPhone(schoolForm.school_phone))          return;
    if (!schoolForm.meeting_coordinator) return;

    setSaving(true);
    try {
      // "אותו מנהל/ת לשתי החטיבות" — the חט"ב fields are hidden in the UI, so keep them
      // in sync with the חט"ע ones rather than sending stale/blank data.
      const chativaSync = (schoolStage === "sheshshnati" && schoolForm.principal_same_person)
        ? {
            principal_chativa_name: schoolForm.principal_name,
            principal_chativa_phone: schoolForm.principal_phone,
            principal_chativa_email: schoolForm.principal_email,
            principal_chativa_day_off: schoolForm.principal_day_off,
          }
        : {};
      const studentCountValue = schoolForm.student_count === "" || schoolForm.student_count == null
        ? null
        : parseInt(schoolForm.student_count, 10);
      const res    = await axios.post("/schools/", { ...schoolForm, ...chativaSync, stage: schoolStage, student_count: studentCountValue });
      const newId  = res.data.id;
      const option = SCHOOL_STAGE_OPTIONS.find(s => s.value === schoolStage);

      if (option?.divisionType) {
        await axios.post(`/schools/${newId}/accounts`, { division_type: option.divisionType });
      } else {
        for (const div of customDivisions) {
          if (div.division_type) await axios.post(`/schools/${newId}/accounts`, { division_type: div.division_type });
        }
      }

      // Advisors are auto-assigned by the backend for the advisor role; managers/owners assign
      // explicitly, per service type — the typed endpoint also upserts the general access row.
      if (canSeeAllUsers) {
        for (const type of ["gefen", "current", "district"]) {
          for (const advisorId of typedAdvisorIds[type]) {
            await axios.post(`/schools/${newId}/advisors/${type}`, { advisor_id: advisorId });
          }
        }
        await axios.put(`/schools/${newId}/year-admin-data`, { ...yearAdminForm, academic_year: DEFAULT_ACADEMIC_YEAR });
      } else if (yearAdminForm.order_amount_gefen != null) {
        // Advisor role: only "מחיר כולל מע\"מ" is editable, matching the backend's allowlist
        // for non-manager callers of PUT .../year-admin-data.
        await axios.put(`/schools/${newId}/year-admin-data`, { order_amount_gefen: yearAdminForm.order_amount_gefen, academic_year: DEFAULT_ACADEMIC_YEAR });
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
        <div className="max-w-[100rem] mx-auto px-6 py-10">

          {/* Header */}
          <div className="mb-8 flex items-center gap-3">
            <button onClick={() => navigate("/")}
              className="text-slate-400 hover:text-slate-700 transition-colors text-sm"
              aria-label="חזרה לרשימת בתי ספר">← חזרה</button>
            <h1 className="text-2xl font-bold text-slate-900">הוספת בית ספר חדש</h1>
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm px-6 py-5">
            <div className={SECTION_HEADER_CLS}>
              {sectionTitle(Building2, "פרטי בית הספר", "bg-blue-50 text-blue-600")}
            </div>

            {/* 3×3 tile grid — same visual language as SchoolPage.jsx's פרטי מוסד */}
            <div className="grid grid-cols-3 gap-3">
              <div className={TILE_CLS}>
                <label htmlFor="school-name" className={TILE_LABEL_CLS}>שם מוסד</label>
                <input id="school-name" className={`input-field ${triedSave && !schoolForm.name ? "border-red-400" : ""}`}
                  autoComplete="off" value={schoolForm.name}
                  onChange={e => setSchoolForm(p => ({ ...p, name: e.target.value }))} />
                {triedSave && !schoolForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-city" className={TILE_LABEL_CLS}>עיר</label>
                <input id="school-city" className="input-field" autoComplete="off" value={schoolForm.city}
                  onChange={e => setSchoolForm(p => ({ ...p, city: e.target.value }))} />
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-finance-software" className={TILE_LABEL_CLS}>תוכנת כספים</label>
                <select id="school-finance-software" className="input-field text-sm"
                  value={schoolForm.finance_software}
                  onChange={e => setSchoolForm(p => ({ ...p, finance_software: e.target.value }))}>
                  {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-symbol" className={TILE_LABEL_CLS}>סמל מוסד</label>
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

              <div className={TILE_CLS}>
                <label htmlFor="school-authority" className={TILE_LABEL_CLS}>בעלות</label>
                <input id="school-authority" className="input-field" autoComplete="off" value={schoolForm.authority}
                  onChange={e => setSchoolForm(p => ({ ...p, authority: e.target.value }))} />
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-phone" className={TILE_LABEL_CLS}>טלפון בית הספר</label>
                <input id="school-phone"
                  className={`input-field ${schoolForm.school_phone && schoolPhoneError ? "border-red-400" : ""}`}
                  autoComplete="off" value={schoolForm.school_phone}
                  onChange={e => setSchoolForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                  dir="ltr" inputMode="numeric" />
                {schoolForm.school_phone && schoolPhoneError && (
                  <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>
                )}
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-stage" className={TILE_LABEL_CLS}>שלב מוסד</label>
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

              <div className={TILE_CLS}>
                <label htmlFor="school-district" className={TILE_LABEL_CLS}>מחוז</label>
                <select id="school-district" className="input-field text-sm"
                  value={schoolForm.district}
                  onChange={e => setSchoolForm(p => ({ ...p, district: e.target.value }))}>
                  <option value="">בחר</option>
                  {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-address" className={TILE_LABEL_CLS}>כתובת</label>
                <input id="school-address" className="input-field" autoComplete="off" value={schoolForm.address}
                  onChange={e => setSchoolForm(p => ({ ...p, address: e.target.value }))} />
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-education-authority" className={TILE_LABEL_CLS}>רשות חינוך</label>
                <input id="school-education-authority" className="input-field" autoComplete="off" value={schoolForm.education_authority}
                  onChange={e => setSchoolForm(p => ({ ...p, education_authority: e.target.value }))} />
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-sector" className={TILE_LABEL_CLS}>מגזר</label>
                <select id="school-sector" className="input-field text-sm"
                  value={schoolForm.sector}
                  onChange={e => setSchoolForm(p => ({ ...p, sector: e.target.value }))}>
                  {SECTOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-supervision" className={TILE_LABEL_CLS}>פיקוח</label>
                <select id="school-supervision" className="input-field text-sm"
                  value={schoolForm.supervision}
                  onChange={e => setSchoolForm(p => ({ ...p, supervision: e.target.value }))}>
                  {SUPERVISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className={TILE_CLS}>
                <span className={TILE_LABEL_CLS}>שכבות לימוד</span>
                <MultiSelectChips compact options={GRADE_LEVEL_OPTIONS}
                  selected={schoolForm.grade_levels || []}
                  onChange={v => setSchoolForm(p => ({ ...p, grade_levels: v }))} />
              </div>

              <div className={TILE_CLS}>
                <span className={TILE_LABEL_CLS}>ימי לימוד</span>
                <MultiSelectChips compact options={STUDY_DAY_OPTIONS}
                  selected={schoolForm.study_days || []}
                  onChange={v => setSchoolForm(p => ({ ...p, study_days: v }))} />
              </div>

              <div className={TILE_CLS}>
                <label htmlFor="school-student-count" className={TILE_LABEL_CLS}>מס' תלמידים</label>
                <input id="school-student-count" className="input-field" autoComplete="off" value={schoolForm.student_count}
                  onChange={e => setSchoolForm(p => ({ ...p, student_count: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric" />
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
                  className={OUTLINE_BTN_CLS}>+ הוסף שורה</button>
                {triedSave && customDivisions.length === 0 && (
                  <p className="text-xs text-red-500 mt-1" role="alert">יש להוסיף לפחות חטיבה אחת</p>
                )}
              </div>
            )}

            {/* Contact table */}
            <div className="mt-10 mb-2 pt-6 border-t border-slate-200/60">
              <div className={SECTION_HEADER_CLS}>
                {sectionTitle(Phone, "אנשי קשר", "bg-indigo-50 text-indigo-600")}
              </div>
              <table className="w-full text-sm border border-slate-200 border-collapse font-sans">
                <thead>
                  <tr className="bg-slate-100 divide-x divide-slate-200">
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 whitespace-nowrap w-28"></th>
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">שם</th>
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">טלפון</th>
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מייל</th>
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">יום חופשי</th>
                    <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מתאם פגישות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {[
                    schoolStage === "sheshshnati" ? PRINCIPAL_TICHON_ROW : PRINCIPAL_SINGLE_ROW,
                    ...(schoolStage === "sheshshnati" && !schoolForm.principal_same_person ? [PRINCIPAL_CHATIVA_ROW] : []),
                    ...CONTACT_ROWS,
                  ].map(row => (
                    <tr key={row.nameField} className="divide-x divide-slate-200">
                      <td className="py-3 pr-1 text-sm font-normal text-gray-900 align-top">{row.label}</td>
                      <td className="py-3 px-2">
                        <label htmlFor={`cname-${row.nameField}`} className="sr-only">{row.label} שם</label>
                        <input id={`cname-${row.nameField}`} className="input-field text-sm" autoComplete="off"
                          value={schoolForm[row.nameField]}
                          onChange={e => setSchoolForm(p => ({ ...p, [row.nameField]: e.target.value }))}
                          placeholder="שם..." />
                      </td>
                      <td className="py-3 px-2">
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
                      <td className="py-3 px-2">
                        <label htmlFor={`cemail-${row.emailField}`} className="sr-only">{row.label} מייל</label>
                        <input id={`cemail-${row.emailField}`} className="input-field text-sm" autoComplete="off"
                          value={schoolForm[row.emailField]}
                          onChange={e => setSchoolForm(p => ({ ...p, [row.emailField]: e.target.value }))}
                          placeholder="מייל..." dir="ltr" type="email" />
                      </td>
                      <td className="py-3 px-2">
                        <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                          selected={schoolForm[row.dayOffField] || []}
                          onChange={v => setSchoolForm(p => ({ ...p, [row.dayOffField]: v }))} />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <label htmlFor={`add-coord-${row.coordValue}`} className="sr-only">{row.label} אחראי/ת לתיאום פגישות</label>
                        <input id={`add-coord-${row.coordValue}`} type="radio" name="add-meeting-coordinator"
                          className="w-4 h-4 accent-blue-600"
                          checked={schoolForm.meeting_coordinator === row.coordValue}
                          disabled={!schoolForm[row.nameField]}
                          onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: row.coordValue }))} />
                      </td>
                    </tr>
                  ))}

                  {schoolStage === "sheshshnati" && (
                    <tr className="divide-x divide-slate-200">
                      <td></td>
                      <td colSpan={5} className="py-3 px-2">
                        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-blue-600"
                            checked={!!schoolForm.principal_same_person}
                            onChange={e => setSchoolForm(p => ({ ...p, principal_same_person: e.target.checked }))} />
                          אותו מנהל/ת לשתי החטיבות
                        </label>
                      </td>
                    </tr>
                  )}

                  {(schoolForm.extra_contacts || []).map((ec, i) => (
                    <tr key={`extra-${i}`} className="divide-x divide-slate-200">
                      <td className="py-3 pr-1">
                        <label htmlFor={`erole-${i}`} className="sr-only">תפקיד</label>
                        <input id={`erole-${i}`} className="input-field text-sm" value={ec.role}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], role: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                          autoComplete="off" placeholder="תפקיד..." />
                      </td>
                      <td className="py-3 px-2">
                        <label htmlFor={`ename-${i}`} className="sr-only">שם</label>
                        <input id={`ename-${i}`} className="input-field text-sm" value={ec.name}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], name: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                          autoComplete="off" placeholder="שם..." />
                      </td>
                      <td className="py-3 px-2">
                        <label htmlFor={`ephone-${i}`} className="sr-only">טלפון</label>
                        <input id={`ephone-${i}`} className="input-field text-sm" value={ec.phone}
                          onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], phone: e.target.value.replace(/\D/g, "").slice(0, 10) }; return { ...p, extra_contacts: ec2 }; })}
                          dir="ltr" inputMode="numeric" autoComplete="off" placeholder="טלפון..." />
                      </td>
                      <td className="py-3 px-2">
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
                      <td className="py-3 px-2">
                        <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                          selected={ec.day_off || []}
                          onChange={v => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], day_off: v }; return { ...p, extra_contacts: ec2 }; })} />
                      </td>
                      <td className="py-3 px-2 text-center">
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
                          className={`${OUTLINE_BTN_CLS} inline-flex items-center gap-1`}>
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

            {/* ליווי — mirrors SchoolPage.jsx's ליווי section (school_year_admin_data fields) */}
            <div className="mt-10 pt-6 border-t border-slate-200/60">
              <div className={SECTION_HEADER_CLS}>
                {sectionTitle(Handshake, "פרטי ליווי", "bg-emerald-50 text-emerald-600")}
              </div>
              <div className={`grid gap-3 ${canSeeAllUsers ? "grid-cols-3" : "grid-cols-1"}`}>
                {canSeeAllUsers && (
                  <div className={TILE_CLS}>
                    <label htmlFor="ys-client-status" className={TILE_LABEL_CLS}>סטטוס לקוח</label>
                    <select id="ys-client-status" className="input-field text-sm"
                      value={yearAdminForm.client_status || ""}
                      onChange={e => setYearAdminForm(p => ({ ...p, client_status: e.target.value || null }))}>
                      <option value="">בחר</option>
                      {CLIENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}

                {canSeeAllUsers && (
                  <div className={TILE_CLS}>
                    <label htmlFor="ys-service-type" className={TILE_LABEL_CLS}>סוג שירות</label>
                    <select id="ys-service-type" className="input-field text-sm"
                      value={yearAdminForm.service_type || ""}
                      onChange={e => setYearAdminForm(p => ({ ...p, service_type: e.target.value || null }))}>
                      <option value="">בחר</option>
                      {SERVICE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}

                <div className={TILE_CLS}>
                  <label htmlFor="ys-order-amount" className={TILE_LABEL_CLS}>מחיר כולל מע"מ</label>
                  <input id="ys-order-amount" className="input-field text-sm" type="text" inputMode="numeric" autoComplete="off"
                    defaultValue={formatAmount(yearAdminForm.order_amount_gefen)}
                    onBlur={e => {
                      const v = parseAmount(e.target.value);
                      e.target.value = formatAmount(v);
                      setYearAdminForm(p => ({ ...p, order_amount_gefen: v }));
                    }} />
                </div>

                {canSeeAllUsers && (
                  <div className={TILE_CLS}>
                    <span className={TILE_LABEL_CLS}>אמצעי הזמנה</span>
                    <MultiSelectChips compact options={FUNDING_METHOD_OPTIONS}
                      selected={yearAdminForm.order_method || []}
                      onChange={v => setYearAdminForm(p => ({ ...p, order_method: v.length ? v : [] }))} />
                  </div>
                )}

                {canSeeAllUsers && (
                  <div className={`${TILE_CLS} col-span-2`}>
                    <span className={`${TILE_LABEL_CLS} inline-flex items-center gap-1.5`}>
                      גישה
                      <span title="בחר למי תהיה גישה לצפות בנתוני בית הספר."
                        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center flex-shrink-0 cursor-help"
                        aria-label="מידע על הגדרת גישה">?</span>
                    </span>
                    <AccessSelector
                      restrictTo={schoolForm.restrict_access_to}
                      users={users}
                      loadingUsers={loadingUsers}
                      onChange={val => { setAccessLinked(false); setSchoolForm(p => ({ ...p, restrict_access_to: val })); }}
                      onSelectAdvisors={() => setAccessLinked(true)}
                      schoolAdvisors={draftLinkedAdvisorIds.map(id => users.find(u => u.id === id)).filter(Boolean)}
                    />
                  </div>
                )}
              </div>

              {!canSeeAllUsers && (
                <p className="text-sm text-slate-500 py-1 mt-2">אתה תוקצה אוטומטית לבית הספר</p>
              )}

              {/* Per-service-type sub-sections: יועץ מלווה / הקצאת פגישות / זמן לפגישה, per
                  גפן/שוטף/מחוז — replaces the old single flat "יועצים אחראיים" field. */}
              {canSeeAllUsers && (
                <div className="mt-6 pt-6 border-t border-slate-200/60">
                  <div className={SECTION_HEADER_CLS}>
                    {sectionTitle(UsersRound, "יועצים מלווים", "bg-violet-50 text-violet-600")}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                  {TYPED_SERVICE_TYPES.map(({ key, label }) => {
                    const isRequired = activeServiceTypes(yearAdminForm.service_type).includes(key);
                    const invalid = triedSave && isRequired && typedAdvisorIds[key].length === 0;
                    return (
                      <div key={key} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-3">
                        <p className="text-sm font-semibold text-slate-700 text-center mb-3">
                          {label}{isRequired && <span className="text-red-500"> *</span>}
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                          <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">יועץ מלווה:</span>
                          <div className="py-0.5">
                            <AdvisorSearch compact schoolId="new" selectedIds={typedAdvisorIds[key]} users={users} loadingUsers={loadingUsers}
                              onChange={ids => setTypedAdvisorIds(p => ({ ...p, [key]: ids }))}
                              invalid={invalid} />
                            {invalid && (
                              <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                            )}
                          </div>

                          <label htmlFor={`ys-alloc-${key}`} className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">הקצאת פגישות:</label>
                          <div className="py-0.5">
                            <input id={`ys-alloc-${key}`} type="number" min="0" className="input-field text-sm"
                              value={yearAdminForm[`meeting_allocation_${key}`] ?? ""}
                              onChange={e => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                setYearAdminForm(p => ({ ...p, [`meeting_allocation_${key}`]: v }));
                              }} />
                          </div>

                          <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">זמן לפגישה:</span>
                          <div className="py-0.5">
                            <HourMinuteInput idPrefix={`ys-duration-${key}`} label={`זמן לפגישה [${label}]`}
                              minutes={yearAdminForm[`meeting_duration_${key}`] ?? null}
                              onChange={v => setYearAdminForm(p => ({ ...p, [`meeting_duration_${key}`]: v }))} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
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
