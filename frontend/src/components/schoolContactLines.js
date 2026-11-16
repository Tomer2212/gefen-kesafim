// Contact-column helpers shared by the home screen (DashboardPage.jsx) and ניהול → בתי ספר
// (AdminPage.jsx) "אנשי קשר" columns — keep both screens reading contacts the same way.

// A שש-שנתי school with a separate חט"ב principal (principal_same_person === false) has two
// principals; every other school has at most one. Mirrors buildSchoolContacts' "principal"/
// "principal_chativa" entries (components/meetings/schoolContacts.js).
export function principalNames(school) {
  return [
    school.principal_name || null,
    (school.stage === "sheshshnati" && school.principal_same_person === false) ? school.principal_chativa_name : null,
  ].filter(Boolean);
}

// "מתאם פגישות" / "אחראי/ת קבצי גפן" columns — built from the per-slot display dicts the
// backend attaches to each school (meeting_coordinators_display /
// gefen_files_responsible_display, see schools_router.py's _resolve_slot_display). A slot
// with no ref chosen is omitted entirely; a slot with a ref chosen but missing_email=true
// (no valid email for that contact, backend-checked) shows a warning line instead of the
// role, so an org can spot who still needs real contact info to actually be coordinated with.
const GEFEN_FILES_SLOT_PREFIX = { default: null, tichon: "תיכון", beinayim: 'חט"ב' };
const MISSING_EMAIL_TEXT = "חסר מייל של איש הקשר המוגדר";

export function gefenFilesResponsibleLines(school) {
  const data = school.gefen_files_responsible_display || {};
  return Object.entries(data).filter(([, v]) => v).map(([slot, v]) => {
    const prefix = GEFEN_FILES_SLOT_PREFIX[slot];
    const text = v.missing_email ? MISSING_EMAIL_TEXT : v.role_label;
    return { text: prefix ? `${prefix} - ${text}` : text, missingEmail: !!v.missing_email };
  });
}

export function meetingCoordinatorLines(school) {
  const data = school.meeting_coordinators_display || {};
  return Object.entries(data).filter(([, v]) => v).map(([slot, v]) => {
    const text = v.missing_email ? MISSING_EMAIL_TEXT : v.role_label;
    return { text: `${v.slot_label}: ${text}`, missingEmail: !!v.missing_email };
  });
}
