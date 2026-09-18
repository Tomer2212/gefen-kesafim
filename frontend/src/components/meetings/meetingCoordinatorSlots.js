// Client-side mirror of schools_router.py's _slots_for_school / _SLOT_LABELS / meeting
// coordinator ref resolution. Keep these three functions in lockstep with the backend —
// see backend/routers/schools_router.py's equivalents.

export const SLOT_LABELS = {
  gefen: "גפן",
  gefen_tichon: "גפן - תיכון",
  gefen_beinayim: 'גפן - חט"ב',
  current: "שוטף",
  current_tichon: "שוטף - תיכון",
  current_beinayim: 'שוטף - חט"ב',
  district: "מחוז",
};

export function slotsForSchool(school, serviceType) {
  if (!school) return [];
  const baseTypes = [];
  if (["gefen", "gefen_current", "takuma"].includes(serviceType)) baseTypes.push("gefen");
  if (["current", "gefen_current"].includes(serviceType)) baseTypes.push("current");
  if (serviceType === "district") baseTypes.push("district");
  const isSixYear = school.stage === "sheshshnati";
  const slots = [];
  for (const t of baseTypes) {
    if (t === "district" || !isSixYear) slots.push(t);
    else slots.push(`${t}_tichon`, `${t}_beinayim`);
  }
  return slots;
}

export const COORDINATOR_ROLE_FIELDS = {
  principal: { name: "principal_name", phone: "principal_phone", email: "principal_email", label: "מנהל/ת" },
  principal_chativa: { name: "principal_chativa_name", phone: "principal_chativa_phone", email: "principal_chativa_email", label: 'מנהל/ת חט"ב' },
  secretary: { name: "secretary_name", phone: "secretary_phone", email: "secretary_email", label: "מנהלנ/ית" },
  secretary_chativa: { name: "secretary_chativa_name", phone: "secretary_chativa_phone", email: "secretary_chativa_email", label: 'מנהלנ/ית חט"ב' },
  finance_contact: { name: "finance_contact_name", phone: "finance_contact_phone", email: "finance_contact_email", label: "אחראי/ת כספים" },
  finance_contact_chativa: { name: "finance_contact_chativa_name", phone: "finance_contact_chativa_phone", email: "finance_contact_chativa_email", label: 'אחראי/ת כספים חט"ב' },
};

export function resolveCoordinatorRef(school, ref) {
  if (!school || !ref) return null;
  const fields = COORDINATOR_ROLE_FIELDS[ref];
  if (fields) {
    const name = school[fields.name];
    if (!name) return null;
    return { role: ref, roleLabel: fields.label, name, email: school[fields.email] || "", phone: school[fields.phone] || "" };
  }
  if (ref.startsWith("extra:")) {
    const idx = parseInt(ref.split(":")[1], 10);
    const ec = (school.extra_contacts || [])[idx];
    if (!ec?.name) return null;
    return { role: ref, roleLabel: ec.role || "איש קשר נוסף", name: ec.name, email: ec.email || "", phone: ec.phone || "" };
  }
  return null;
}

export function resolveMeetingCoordinatorForSlot(school, slot) {
  const ref = school?.meeting_coordinators?.[slot];
  return resolveCoordinatorRef(school, ref);
}

// Mirrors schools_router.py's per-range slot resolution in send_direct_coordination_request:
// one concrete meeting (one range) resolves to exactly one slot. Returns null when a six-year
// school's gefen/current/takuma range hasn't had its division (stageScope) chosen yet.
// gefen_current (a combined meeting, only offered when the גפן and שוטף coordinators already
// match — see DirectCoordinationModal's eligibility check) canonically resolves to the "current"
// slot, matching the backend's choice in send_direct_coordination_request.
export function slotForMeetingServiceType(school, meetingServiceType, stageScope) {
  if (!meetingServiceType) return null;
  const base = meetingServiceType === "takuma" ? "gefen" : meetingServiceType === "gefen_current" ? "current" : meetingServiceType;
  if (base === "district" || school?.stage !== "sheshshnati") return base;
  if (stageScope === "chativa") return `${base}_beinayim`;
  if (stageScope === "tichon") return `${base}_tichon`;
  return null;
}
