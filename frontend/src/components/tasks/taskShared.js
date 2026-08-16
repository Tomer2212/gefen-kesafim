// Mirrors backend/task_logic.py's label/option constants — kept in sync by hand
// (same convention as agent_router.py's comment about ADMIN_* constants).

// Matches meetings-area MEETING_SERVICE_TYPE_OPTIONS (the "סוג" column) — NOT the
// unrelated meeting_type (physical/remote) field.
export const MEETING_SERVICE_TYPE_LABELS = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף", district: "מחוז" };

// Mirrors backend/task_logic.py's FIELD_LABELS — kept in sync by hand.
export const FIELD_LABELS = {
  symbol: "סמל מוסד", city: "עיר", authority: "בעלות", stage: "שלב מוסד", district: "מחוז",
  finance_software: "תוכנת כספים",
  principal_name: "שם מנהל/ת", principal_phone: "טלפון מנהל/ת", principal_email: "מייל מנהל/ת",
  secretary_name: "שם מזכיר/ה", secretary_phone: "טלפון מזכיר/ה", secretary_email: "מייל מזכיר/ה",
  finance_contact_name: "שם אחראי/ת כספים", finance_contact_phone: "טלפון אחראי/ת כספים",
  finance_contact_email: "מייל אחראי/ת כספים",
  school_phone: "טלפון בית ספר", address: "כתובת", notes: "הערות",
  meeting_coordinator: "אחראי/ת לתיאום פגישות",
  service_type: "סוג שירות", client_status: "סטטוס לקוח", requested_price: "מחיר מבוקש",
  order_method: "אמצעי הזמנה",
  order_amount_gefen: 'מחיר כולל מע"מ', hours_ordered: "מספר שעות שהוזמנו", rate: "תעריף",
  payment_received: "תשלום שהתקבל", payment_requests_sent: "דרישות תשלום שנשלחו",
  contract_sent: "חוזה נשלח", contract_received: "חוזה התקבל", receipts_sent: "אסמכתאות שנשלחו",
  closure_parents_status: "סטטוס סגירה מול הורים", closure_parents_notes: "הערות סגירה מול הורים",
  closure_authority_status: "סטטוס סגירה מול רשות", closure_authority_notes: "הערות סגירה מול רשות",
  meeting_allocation_gefen: "מכסת פגישות — גפן", meeting_allocation_current: "מכסת פגישות — שוטף",
  meeting_allocation_district: "מכסת פגישות — מחוז",
  meeting_duration_gefen: "משך פגישה — גפן", meeting_duration_current: "משך פגישה — שוטף",
  meeting_duration_district: "משך פגישה — מחוז",
  invoice_transaction_status: "סטטוס עסקת חשבונית", payment_method: "אמצעי תשלום",
  amount_paid: "סכום ששולם",
};

export const NUMBER_OP_LABELS = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" };

export const RECIPIENT_ROLE_OPTIONS = [
  { value: "meeting_coordinator", label: "אחראי/ת לתיאום פגישות (לפי הגדרת בית הספר)" },
  { value: "principal", label: "מנהל/ת" },
  { value: "secretary", label: "מנהלנ/ית" },
  { value: "finance_contact", label: "אחראי/ת כספים" },
];

export const CHANNEL_OPTIONS = [
  { value: "email_resend", label: "מייל — דרך המערכת (גפן AI)" },
  { value: "email_outlook", label: "מייל — דרך Outlook הארגוני (יוצג בדואר היוצא של היועץ)" },
  { value: "whatsapp_twilio", label: "וואטסאפ (Twilio)" },
];

// "YYYY-MM-DD" -> "DD/MM/YY" (short form — matches how dates read elsewhere in the app,
// e.g. the meetings table, and avoids widening narrow table columns with a 4-digit year).
export function formatDateDMY(iso) {
  if (!iso) return iso;
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
}

function meetingDateRange(cond) {
  const range = [cond.date_from, cond.date_to].filter(Boolean).map(formatDateDMY).join(" – ") || "כל התאריכים";
  // ⁦/⁩ (LRI/PDI) isolate the LTR date range from the surrounding RTL text so
  // the browser's bidi algorithm can't visually reorder date_from/date_to relative to
  // the Hebrew sentence around them.
  return `⁦${range}⁩`;
}

const GOAL_VALUE_LABELS = { yes: "כן", no: "לא", unset: "טרם הוגדר" };

// `meta` (optional) is a bag of the GET /tasks/field-options payload's pieces —
// {fieldOptions, goalOptions, divisionOptions, controlLetterFields} — used to resolve raw
// stored values (e.g. "gefen", a goal_key, a division_type) to their Hebrew labels. Callers
// without easy access to `meta` still get a readable (if untranslated) fallback.
export function describeCondition(cond, meta) {
  if (!cond) return "";
  const fieldOptions = meta?.fieldOptions || [];
  if (cond.type === "meeting") {
    const typeLabel = cond.meeting_service_type ? MEETING_SERVICE_TYPE_LABELS[cond.meeting_service_type] || cond.meeting_service_type : "כלשהי";
    const prefix = cond.negate ? "אין פגישת" : "יש פגישת";
    return `${prefix} ${typeLabel} (${meetingDateRange(cond)})`;
  }
  if (cond.type === "goal") {
    const goalOptions = meta?.goalOptions || [];
    const divisionOptions = meta?.divisionOptions || [];
    const goalLabel = goalOptions.find(g => g.key === cond.goal_key)?.label || cond.goal_key || "—";
    const divisionLabel = divisionOptions.find(d => d.value === cond.division_type)?.label || cond.division_type || "—";
    const valueLabel = GOAL_VALUE_LABELS[cond.value] || cond.value || "—";
    return `יעד: ${goalLabel} — ${divisionLabel} / ${cond.budget_name || "—"} = ${valueLabel}`;
  }
  if (cond.type === "control_letter") {
    const divisionOptions = meta?.divisionOptions || [];
    const controlLetterFields = meta?.controlLetterFields || [];
    const divisionLabel = divisionOptions.find(d => d.value === cond.division_type)?.label || cond.division_type || "—";
    const fieldDef = controlLetterFields.find(f => f.field === cond.field);
    const opLabel = NUMBER_OP_LABELS[cond.op] || "=";
    const valueLabel = fieldDef?.options?.find(o => o.value === cond.value)?.label ?? cond.value;
    return `מכתב בקרה (${divisionLabel}): ${fieldDef?.label || cond.field} ${opLabel} ${valueLabel}`;
  }
  const label = FIELD_LABELS[cond.field] || cond.field;
  if (cond.type === "field") {
    const opLabel = NUMBER_OP_LABELS[cond.op] || "=";
    const opt = fieldOptions.find(f => f.field === cond.field);
    const optionLabel = opt?.options?.find(o => o.value === cond.value)?.label;
    const valueLabel = optionLabel ?? (typeof cond.value === "boolean" ? (cond.value ? "כן" : "לא") : cond.value);
    return `${label} ${opLabel} ${valueLabel}`;
  }
  return label;
}

// Two-line variant for TaskPanel's results-table column headers: the יש/אין distinction is
// dropped here (unlike describeCondition) because the cell values below the header already
// show "יש"/"אין" (or an X/Y count) unambiguously — repeating it in the header just duplicates
// the same fact and, worse, reads as contradictory once #4c stopped tying the cell's יש/אין to
// `negate`. title = "פגישת <type>"; range = short date range, rendered on its own line by the
// caller (title/range are separate strings specifically so the caller can put a line break
// between them instead of cramming both into one wide row).
export function describeConditionColumn(cond, meta) {
  if (!cond) return { title: "", range: null };
  if (cond.type === "meeting") {
    const typeLabel = cond.meeting_service_type ? MEETING_SERVICE_TYPE_LABELS[cond.meeting_service_type] || cond.meeting_service_type : "כלשהי";
    return { title: `פגישת ${typeLabel}`, range: meetingDateRange(cond) };
  }
  return { title: describeCondition(cond, meta), range: null };
}

export function firstDisplayGroupConditions(criteria) {
  const groups = criteria?.groups || [];
  return groups[0]?.conditions || [];
}
