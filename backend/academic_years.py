from datetime import date

ACADEMIC_YEARS = ["תשפ\"ו", "תשפ\"ז"]
DEFAULT_ACADEMIC_YEAR = "תשפ\"ו"

# Hebrew year label -> Gregorian year the academic year STARTS in (Sep 1). Extend by hand
# whenever ACADEMIC_YEARS grows, same manual-maintenance pattern as that list itself.
_ACADEMIC_YEAR_START_GREGORIAN = {"תשפ\"ו": 2025, "תשפ\"ז": 2026}


def get_academic_year_date_range(academic_year: str) -> tuple[date, date]:
    """Returns (start, end) as Sep 1 of the academic year's first Gregorian year
    through Aug 31 of the next — falls back to DEFAULT_ACADEMIC_YEAR for unknown labels."""
    start_year = _ACADEMIC_YEAR_START_GREGORIAN.get(academic_year) or _ACADEMIC_YEAR_START_GREGORIAN[DEFAULT_ACADEMIC_YEAR]
    return date(start_year, 9, 1), date(start_year + 1, 8, 31)
