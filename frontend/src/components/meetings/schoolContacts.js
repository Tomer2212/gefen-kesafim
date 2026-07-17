export function buildSchoolContacts(school) {
  if (!school) return [];
  const contacts = [];
  if (school.principal_name) contacts.push({ key: "principal", label: "מנהל/ת", name: school.principal_name, email: school.principal_email || "" });
  if (school.secretary_name) contacts.push({ key: "secretary", label: "מנהלנ/ית", name: school.secretary_name, email: school.secretary_email || "" });
  if (school.finance_contact_name) contacts.push({ key: "finance", label: "אחראי/ת כספים", name: school.finance_contact_name, email: school.finance_contact_email || "" });
  (school.extra_contacts || []).forEach((ec, i) => {
    if (ec.name) contacts.push({ key: `extra_${i}`, label: ec.role || "איש קשר נוסף", name: ec.name, email: ec.email || "" });
  });
  return contacts;
}
