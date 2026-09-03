import logging
from datetime import date

logger = logging.getLogger(__name__)

ACADEMIC_YEARS = ["תשפ\"ו", "תשפ\"ז"]

# The academic year the app opens on by default and every API endpoint falls back to.
# תשפ"ו ended and is kept only for protocol/viewing — the live operational year is תשפ"ז.
DEFAULT_ACADEMIC_YEAR = "תשפ\"ז"

# The academic year the hard-coded goal templates in schools_router (_DEFAULT_GOALS /
# _shift_goal_date / important-date labels) were authored for. Their literal target_date
# values and "תשפ\"ו" label text assume this year; the shift math is relative to it.
# This is deliberately NOT DEFAULT_ACADEMIC_YEAR — moving the landing year must not shift
# every goal's target date by a year. Bump only when the goal template literals are re-authored.
GOAL_TEMPLATE_BASE_YEAR = "תשפ\"ו"

# Hebrew year label -> Gregorian year the academic year STARTS in (Sep 1). Extend by hand
# whenever ACADEMIC_YEARS grows, same manual-maintenance pattern as that list itself.
_ACADEMIC_YEAR_START_GREGORIAN = {"תשפ\"ו": 2025, "תשפ\"ז": 2026}


def get_academic_year_date_range(academic_year: str) -> tuple[date, date]:
    """Returns (start, end) as Sep 1 of the academic year's first Gregorian year
    through Aug 31 of the next — falls back to DEFAULT_ACADEMIC_YEAR for unknown labels."""
    start_year = _ACADEMIC_YEAR_START_GREGORIAN.get(academic_year) or _ACADEMIC_YEAR_START_GREGORIAN[DEFAULT_ACADEMIC_YEAR]
    return date(start_year, 9, 1), date(start_year + 1, 8, 31)


def get_academic_year_for_date(d: date) -> str | None:
    """Reverse lookup: which known academic year (if any) contains date `d`.

    Returns None when `d` predates the earliest known academic year's start —
    callers MUST treat None as a condition requiring explicit user resolution,
    never silently default it to DEFAULT_ACADEMIC_YEAR."""
    for year in ACADEMIC_YEARS:
        start, end = get_academic_year_date_range(year)
        if start <= d <= end:
            return year
    return None


# ---------------------------------------------------------------------------
# Year-scoped admin data inheritance (school_year_admin_data)
# ---------------------------------------------------------------------------
# A school's client_status / service_type carry forward from one academic year to the
# next automatically. There is NO per-year data copy: a year simply has no row until the
# org explicitly sets something for it. When reading these fields for year N, fall back
# (per field) to the most recent EARLIER year that has a non-empty value. Writing any
# value for year N (upsert_year_admin_data) creates that year's row and from then on it
# overrides — per field, so an inherited field stays inherited until year N's own row
# carries a non-empty value for it.
INHERITED_YEAR_ADMIN_FIELDS = ("client_status", "service_type")


def resolve_inherited_year_admin(db, school_ids, academic_year: str) -> dict[str, dict]:
    """Returns {school_id: {field: value}} for INHERITED_YEAR_ADMIN_FIELDS, resolved with
    the carry-forward rule above. Only years up to and including `academic_year` (in
    ACADEMIC_YEARS order) are considered. Non-fatal: on any query failure returns {} and
    callers keep whatever they read directly from the target year."""
    school_ids = [s for s in dict.fromkeys(school_ids)]  # dedupe, keep order
    if not school_ids:
        return {}
    try:
        idx = ACADEMIC_YEARS.index(academic_year)
        years_oldest_first = ACADEMIC_YEARS[: idx + 1]
    except ValueError:
        years_oldest_first = [academic_year]
    try:
        rows = (
            db.table("school_year_admin_data")
            .select("school_id, academic_year, " + ", ".join(INHERITED_YEAR_ADMIN_FIELDS))
            .in_("school_id", school_ids)
            .in_("academic_year", years_oldest_first)
            .execute()
            .data
        ) or []
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("resolve_inherited_year_admin query failed (non-fatal): %s", exc)
        return {}

    by_school: dict[str, dict[str, dict]] = {}
    for r in rows:
        by_school.setdefault(r["school_id"], {})[r["academic_year"]] = r

    resolved: dict[str, dict] = {}
    for sid in school_ids:
        yr_rows = by_school.get(sid, {})
        out: dict = {}
        for field in INHERITED_YEAR_ADMIN_FIELDS:
            value = None
            for y in reversed(years_oldest_first):  # newest -> oldest
                cand = yr_rows.get(y, {}).get(field)
                if cand not in (None, ""):
                    value = cand
                    break
            out[field] = value
        resolved[sid] = out
    return resolved


def merge_inherited_year_admin(target_map: dict, resolved: dict, academic_year: str) -> dict:
    """Merges `resolved` (from resolve_inherited_year_admin) into `target_map`
    ({school_id: row}). For each school, fills only INHERITED_YEAR_ADMIN_FIELDS that are
    missing/empty in the existing row; creates a minimal synthetic row for a school that
    has no target-year row at all. Mutates and returns `target_map`."""
    for sid, fields in resolved.items():
        entry = target_map.get(sid)
        if entry is None:
            entry = {"school_id": sid, "academic_year": academic_year}
            target_map[sid] = entry
        for f in INHERITED_YEAR_ADMIN_FIELDS:
            if entry.get(f) in (None, "") and fields.get(f) not in (None, ""):
                entry[f] = fields[f]
    return target_map
