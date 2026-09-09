export const ACADEMIC_YEARS = ["תשפ\"ו", "תשפ\"ז"];
// The year the app opens on by default. תשפ"ו ended and is kept only for viewing;
// the live operational year is תשפ"ז. (Backend mirror: academic_years.DEFAULT_ACADEMIC_YEAR.)
export const DEFAULT_ACADEMIC_YEAR = "תשפ\"ז";

// Hebrew year label -> Gregorian year the academic year STARTS in (Sep 1). Extend by hand
// whenever ACADEMIC_YEARS grows — exact mirror of _ACADEMIC_YEAR_START_GREGORIAN in
// backend/academic_years.py, same manual-maintenance pattern as that list itself.
export const ACADEMIC_YEAR_START_GREGORIAN = { "תשפ\"ו": 2025, "תשפ\"ז": 2026 };

// Used to default meeting-list "מתאריך" filters to the start of a given academic year
// (AdminMeetingsTab.jsx / PersonalMeetingsTab.jsx) — falls back to DEFAULT_ACADEMIC_YEAR
// for an unrecognized label, same as the backend's get_academic_year_date_range.
export function getAcademicYearStartDate(academicYear) {
  const y = ACADEMIC_YEAR_START_GREGORIAN[academicYear] ?? ACADEMIC_YEAR_START_GREGORIAN[DEFAULT_ACADEMIC_YEAR];
  return `${y}-09-01`;
}
