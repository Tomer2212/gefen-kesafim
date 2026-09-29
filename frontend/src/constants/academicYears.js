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

// Reverse lookup mirroring backend's get_academic_year_for_date: which academic year (if
// any) a "YYYY-MM-DD" date falls within (Sep 1 -> Aug 31). Returns null for a date outside
// every known year's range — callers should fall back to DEFAULT_ACADEMIC_YEAR themselves.
export function getAcademicYearForDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  for (const year of ACADEMIC_YEARS) {
    const startY = ACADEMIC_YEAR_START_GREGORIAN[year];
    if (!startY) continue;
    const start = new Date(`${startY}-09-01T00:00:00`);
    const end = new Date(`${startY + 1}-08-31T23:59:59`);
    if (d >= start && d <= end) return year;
  }
  return null;
}

// The academic-year "seam" (01.08–31.10) — a meeting scheduled in this window might
// reasonably need files from both the outgoing and the incoming academic year. Used to
// decide whether MeetingRow's date picker should offer the multi-year request prompt.
export function isAcademicYearSeam(dateStr) {
  if (!dateStr) return false;
  const month = Number(dateStr.slice(5, 7));
  return month === 8 || month === 9 || month === 10;
}
