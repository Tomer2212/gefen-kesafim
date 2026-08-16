export function buildSchoolContacts(school) {
  if (!school) return [];
  const contacts = [];
  const isSheshsSnati = school.stage === "sheshshnati";
  if (school.principal_name) {
    contacts.push({ key: "principal", label: isSheshsSnati ? "מנהל/ת חט\"ע" : "מנהל/ת", name: school.principal_name, email: school.principal_email || "", phone: school.principal_phone || "" });
  }
  if (isSheshsSnati && school.principal_same_person === false && school.principal_chativa_name) {
    contacts.push({ key: "principal_chativa", label: "מנהל/ת חט\"ב", name: school.principal_chativa_name, email: school.principal_chativa_email || "", phone: school.principal_chativa_phone || "" });
  }
  if (school.secretary_name) contacts.push({ key: "secretary", label: "מנהלנ/ית", name: school.secretary_name, email: school.secretary_email || "", phone: school.secretary_phone || "" });
  if (school.finance_contact_name) contacts.push({ key: "finance", label: "אחראי/ת כספים", name: school.finance_contact_name, email: school.finance_contact_email || "", phone: school.finance_contact_phone || "" });
  (school.extra_contacts || []).forEach((ec, i) => {
    if (ec.name) contacts.push({ key: `extra_${i}`, label: ec.role || "איש קשר נוסף", name: ec.name, email: ec.email || "", phone: ec.phone || "" });
  });
  return contacts;
}

// Round 10 — client-side mirror of schools_router.py's _resolve_meeting_coordinator, so
// DirectCoordinationModal/DirectCoordinationResolutionModal can check "who receives the
// scheduling email" without a server round-trip (the full school row is already in props).
// Ref key convention matches the backend exactly: "principal" | "principal_chativa" |
// "secretary" | "finance_contact" | "extra:<index>" — note "finance_contact" here, NOT
// buildSchoolContacts' "finance" participant key; these are deliberately separate key spaces
// (matches the existing backend convention, not a bug to unify).
const COORDINATOR_ROLE_FIELDS = {
  principal: { name: "principal_name", phone: "principal_phone", email: "principal_email" },
  principal_chativa: { name: "principal_chativa_name", phone: "principal_chativa_phone", email: "principal_chativa_email" },
  secretary: { name: "secretary_name", phone: "secretary_phone", email: "secretary_email" },
  finance_contact: { name: "finance_contact_name", phone: "finance_contact_phone", email: "finance_contact_email" },
};

export function resolveMeetingCoordinator(school) {
  const ref = school?.meeting_coordinator;
  if (!ref) return null;
  const fields = COORDINATOR_ROLE_FIELDS[ref];
  if (fields) {
    const name = school[fields.name];
    if (!name) return null;
    return { role: ref, name, email: school[fields.email] || "", phone: school[fields.phone] || "" };
  }
  if (ref.startsWith("extra:")) {
    const idx = parseInt(ref.split(":")[1], 10);
    const ec = (school.extra_contacts || [])[idx];
    if (!ec?.name) return null;
    return { role: ref, name: ec.name, email: ec.email || "", phone: ec.phone || "" };
  }
  return null;
}
