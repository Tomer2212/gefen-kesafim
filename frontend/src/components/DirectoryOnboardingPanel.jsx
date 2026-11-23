import { AdvisorSearch } from "./AdvisorSearch";

const ONBOARDING_CLIENT_STATUS_OPTIONS = [
  { value: "in_progress", label: "בתהליך" },
  { value: "active", label: "פעיל" },
];

const TYPED_SERVICE_TYPES = [
  { key: "gefen", label: "גפן" },
  { key: "current", label: "שוטף" },
  { key: "district", label: "מחוז" },
];

// Top of the school card in onboarding mode — a directory copy ("מהמאגר") being added to the
// client list. Holds the "פרטי ליווי" that decide the mandatory fields (client status, service
// type) and, for an advisor (who has no "יועצים מלווים" card), the accompanying advisors.
// Everything here is a draft, sent with "שמור והוסף לרשימת הלקוחות" (SchoolPage.saveEdit).
export default function DirectoryOnboardingPanel({
  draft, onChange, serviceType, serviceTypeOptions, requiredAdvisorTypes, showAdvisors,
  advisorIds, onAdvisorsChange, users, loadingUsers, onRetryUsers, triedSave, schoolId,
}) {
  const statusMissing = triedSave && !draft.client_status;
  const selectCls = invalid => `w-full text-sm border rounded-md px-2 py-1 bg-white ${invalid ? "border-red-400" : "border-slate-300"}`;

  return (
    <section aria-labelledby="onboarding-title" className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
      <h2 id="onboarding-title" className="text-base font-bold text-blue-900">השלמת פרטים והוספה לרשימת הלקוחות</h2>
      <p className="text-sm text-blue-800/80 mt-1 mb-4">
        הפרטים מהמאגר כבר מולאו. השלימו את שדות החובה (מסומנים באדום) ולחצו "שמור והוסף לרשימת הלקוחות" בתחתית הדף.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="onboarding-client-status" className="block text-xs font-semibold text-slate-600 mb-1">
            סטטוס לקוח<span className="text-red-500"> *</span>
          </label>
          <select id="onboarding-client-status" className={selectCls(statusMissing)}
            value={draft.client_status || ""}
            onChange={e => onChange({ ...draft, client_status: e.target.value })}>
            <option value="">בחר</option>
            {ONBOARDING_CLIENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {statusMissing && <span role="alert" className="text-xs text-red-500 mt-1 block">יש לבחור סטטוס לקוח</span>}
        </div>
        <div>
          <label htmlFor="onboarding-service-type" className="block text-xs font-semibold text-slate-600 mb-1">סוג שירות</label>
          <select id="onboarding-service-type" className={selectCls(false)}
            value={serviceType || ""}
            onChange={e => onChange({ ...draft, service_type: e.target.value })}>
            <option value="">בחר</option>
            {serviceTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {!showAdvisors && (
          <p className="text-xs text-slate-600 self-end">את היועצים המלווים בוחרים בכרטיס "יועצים מלווים" שבהמשך הדף.</p>
        )}
      </div>
      {showAdvisors && (
        <div className="grid grid-cols-3 gap-4 mt-4">
          {TYPED_SERVICE_TYPES.map(({ key, label }) => {
            const required = draft.client_status === "active" && requiredAdvisorTypes.includes(key);
            const invalid = triedSave && required && advisorIds[key].length === 0;
            return (
              <div key={key} className="min-w-0">
                <span className="block text-xs font-semibold text-slate-600 mb-1">
                  יועץ מלווה {label}{required && <span className="text-red-500"> *</span>}
                </span>
                <AdvisorSearch compact schoolId={schoolId} selectedIds={advisorIds[key]} users={users}
                  loadingUsers={loadingUsers} onRetry={onRetryUsers} invalid={invalid}
                  onChange={ids => onAdvisorsChange({ ...advisorIds, [key]: ids })} />
                {invalid && <span role="alert" className="text-xs text-red-500 mt-1 block">יש לבחור לפחות יועץ אחד</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
