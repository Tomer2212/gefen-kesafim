// Mirrors backend/task_logic.py's label/option constants — kept in sync by hand
// (same convention as agent_router.py's comment about ADMIN_* constants).

// Matches meetings-area MEETING_SERVICE_TYPE_OPTIONS (the "סוג" column) — NOT the
// unrelated meeting_type (physical/remote) field.
export const MEETING_SERVICE_TYPE_LABELS = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף" };

export const FIELD_LABELS = {
  symbol: "סמל מוסד", city: "עיר", authority: "בעלות", stage: "שלב מוסד", district: "מחוז",
  service_type: "סוג שירות", requested_price: "מחיר מבוקש", order_method: "אמצעי הזמנה",
  order_amount_gefen: 'מחיר כולל מע"מ', hours_ordered: "מספר שעות שהוזמנו", rate: "תעריף",
  payment_received: "תשלום שהתקבל", payment_requests_sent: "דרישות תשלום שנשלחו",
  contract_sent: "חוזה נשלח", contract_received: "חוזה התקבל", receipts_sent: "אסמכתאות שנשלחו",
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

export function describeCondition(cond) {
  if (!cond) return "";
  if (cond.type === "meeting") {
    const typeLabel = cond.meeting_service_type ? MEETING_SERVICE_TYPE_LABELS[cond.meeting_service_type] || cond.meeting_service_type : "כלשהי";
    const range = [cond.date_from, cond.date_to].filter(Boolean).join(" – ") || "כל התאריכים";
    const prefix = cond.negate ? "אין פגישת" : "יש פגישת";
    return `${prefix} ${typeLabel} (${range})`;
  }
  const label = FIELD_LABELS[cond.field] || cond.field;
  if (cond.type === "field") {
    const opLabel = NUMBER_OP_LABELS[cond.op] || "=";
    const valueLabel = typeof cond.value === "boolean" ? (cond.value ? "כן" : "לא") : cond.value;
    return `${label} ${opLabel} ${valueLabel}`;
  }
  return label;
}

export function firstDisplayGroupConditions(criteria) {
  const groups = criteria?.groups || [];
  return groups[0]?.conditions || [];
}
