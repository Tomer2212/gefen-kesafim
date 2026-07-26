"""Criteria engine for the "משימות" (Tasks) feature.

A task's `criteria` is an OR-of-AND tree:
    {"groups": [{"conditions": [...]}, {"conditions": [...]}]}
A school matches the task if it satisfies ALL conditions in AT LEAST ONE group.

Each condition is one of:
    {"type": "meeting", "meeting_service_type": "gefen"|"current"|"gefen_current"|None,
     "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD", "negate": bool}
        -> True if the school has (or, if negate, does NOT have) at least one
           meeting with status in (scheduled, completed) in the date range
           (and matching meeting_service_type — the meetings-area "סוג" column — if given).
    {"type": "field", "field": "<key>", "op": "eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"contains", "value": ...}
        -> Compares a school-level or school_year_admin_data-level field against `value`.

Only two bounded DB queries are ever issued (schools, meetings) — never a per-school
loop — per Architecture Invariant #7 (no Python-side table scans).
"""

import logging
import time

from academic_years import DEFAULT_ACADEMIC_YEAR
from supabase_client import get_admin_client, reset_admin_client

_log = logging.getLogger(__name__)

# Mirrors ADMIN_TEXT_COLUMNS / ADMIN_NUMBER_COLUMNS / ADMIN_SELECT_COLUMNS in
# backend/routers/agent_router.py — kept as a separate list here because task
# field-conditions also need to know which table each field lives on.
SCHOOL_FIELDS = {
    "symbol": "text", "city": "text", "authority": "text", "stage": "select",
    "district": "text",
}
STAGE_OPTIONS = ["yesodi", "beinayim", "tikkon", "sheshshnati", "other"]

YEAR_ADMIN_FIELDS = {
    "service_type": "select", "requested_price": "number", "order_method": "select",
    "order_amount_gefen": "number", "hours_ordered": "number", "rate": "number",
    "payment_received": "number", "payment_requests_sent": "number",
    "contract_sent": "bool", "contract_received": "bool", "receipts_sent": "number",
}
SERVICE_TYPE_OPTIONS = ["gefen", "current", "gefen_current"]
ORDER_METHOD_OPTIONS = ["gefen", "tnufa", "tkuma", "dokati", "palg", "self_managed"]

FIELD_LABELS = {
    "symbol": "סמל מוסד", "city": "עיר", "authority": "בעלות", "stage": "שלב מוסד",
    "district": "מחוז", "service_type": "סוג שירות", "requested_price": "מחיר מבוקש",
    "order_method": "אמצעי הזמנה", "order_amount_gefen": "גובה הזמנה",
    "hours_ordered": "מספר שעות שהוזמנו", "rate": "תעריף",
    "payment_received": "תשלום שהתקבל", "payment_requests_sent": "דרישות תשלום שנשלחו",
    "contract_sent": "חוזה נשלח", "contract_received": "חוזה התקבל",
    "receipts_sent": "אסמכתאות שנשלחו",
}

# Matches meetings.meeting_service_type (see frontend/src/components/meetings/constants.js
# MEETING_SERVICE_TYPE_OPTIONS) — the meetings-area "סוג" column, NOT meeting_type
# (physical/remote), which is a different, unrelated field ("אופן" the meeting happens).
MEETING_SERVICE_TYPE_OPTIONS = ["gefen", "current", "gefen_current"]
NUMBER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte"}


def field_options() -> list[dict]:
    """Flat list describing every field usable in a 'field' condition, for the
    frontend's condition builder (GET /tasks/field-options)."""
    out = []
    for key, ftype in SCHOOL_FIELDS.items():
        out.append({
            "field": key, "type": ftype, "table": "schools", "label": FIELD_LABELS[key],
            "options": STAGE_OPTIONS if key == "stage" else None,
        })
    for key, ftype in YEAR_ADMIN_FIELDS.items():
        options = None
        if key == "service_type":
            options = SERVICE_TYPE_OPTIONS
        elif key == "order_method":
            options = ORDER_METHOD_OPTIONS
        elif ftype == "bool":
            options = ["yes", "no"]
        out.append({
            "field": key, "type": ftype, "table": "school_year_admin_data",
            "label": FIELD_LABELS[key], "options": options,
        })
    return out


def _fetch_schools_and_meetings(org_id: str, academic_year: str) -> tuple[list[dict], list[dict], dict[str, dict]]:
    """One bounded query for active schools, one for their year-admin-data rows, one for
    their meetings — mirrors the pattern in booking_logic.find_schools_missing_meetings."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            schools = (
                db.table("schools")
                .select("id, name, symbol, city, authority, stage, district")
                .eq("org_id", org_id)
                .eq("status", "active")
                .execute()
                .data or []
            )
            school_ids = [s["id"] for s in schools]
            if not school_ids:
                return [], [], {}

            year_rows = (
                db.table("school_year_admin_data")
                .select("*")
                .eq("academic_year", academic_year)
                .in_("school_id", school_ids)
                .execute()
                .data or []
            )
            year_map = {r["school_id"]: r for r in year_rows}

            meetings = (
                db.table("meetings")
                .select("school_id, meeting_date, meeting_service_type, status")
                .in_("school_id", school_ids)
                .in_("status", ["scheduled", "completed"])
                .execute()
                .data or []
            )
            return schools, meetings, year_map
        except Exception as exc:
            if attempt == 0:
                _log.warning("_fetch_schools_and_meetings attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("_fetch_schools_and_meetings failed after 2 attempts: %s", exc, exc_info=True)
                raise


def _meetings_for_school(meetings: list[dict], school_id: str) -> list[dict]:
    return [m for m in meetings if m["school_id"] == school_id]


def _eval_meeting_condition(cond: dict, school_meetings: list[dict]) -> bool:
    date_from, date_to = cond.get("date_from"), cond.get("date_to")
    meeting_service_type = cond.get("meeting_service_type")
    matched = False
    for m in school_meetings:
        md = m.get("meeting_date")
        if not md:
            continue
        if date_from and md < date_from:
            continue
        if date_to and md > date_to:
            continue
        if meeting_service_type and m.get("meeting_service_type") != meeting_service_type:
            continue
        matched = True
        break
    return (not matched) if cond.get("negate") else matched


def _coerce_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("yes", "כן", "true", "1")


def _eval_field_condition(cond: dict, school: dict, year_row: dict | None) -> bool:
    field = cond.get("field")
    op = cond.get("op") or "eq"
    target = cond.get("value")

    if field in SCHOOL_FIELDS:
        actual = school.get(field)
    elif field in YEAR_ADMIN_FIELDS:
        actual = (year_row or {}).get(field)
    else:
        return False

    ftype = SCHOOL_FIELDS.get(field) or YEAR_ADMIN_FIELDS.get(field)

    if ftype == "bool":
        return _coerce_bool(actual) == _coerce_bool(target)
    if ftype == "number":
        try:
            actual_n, target_n = float(actual), float(target)
        except (TypeError, ValueError):
            return False
        if op not in NUMBER_OPS:
            op = "eq"
        return {
            "eq": actual_n == target_n, "ne": actual_n != target_n,
            "gt": actual_n > target_n, "gte": actual_n >= target_n,
            "lt": actual_n < target_n, "lte": actual_n <= target_n,
        }[op]
    if op == "contains":
        return str(target or "").strip().lower() in str(actual or "").lower()
    if isinstance(actual, list):
        return target in actual
    return str(actual or "").strip() == str(target or "").strip()


def evaluate_tree(criteria: dict, school: dict, school_meetings: list[dict], year_row: dict | None) -> bool:
    groups = (criteria or {}).get("groups") or []
    if not groups:
        return False
    for group in groups:
        conditions = group.get("conditions") or []
        if not conditions:
            continue
        if all(
            _eval_meeting_condition(c, school_meetings) if c.get("type") == "meeting"
            else _eval_field_condition(c, school, year_row)
            for c in conditions
        ):
            return True
    return False


def find_matching_schools(org_id: str, criteria: dict, academic_year: str = DEFAULT_ACADEMIC_YEAR) -> list[dict]:
    """Creation-time snapshot: returns the schools matching `criteria` right now."""
    schools, meetings, year_map = _fetch_schools_and_meetings(org_id, academic_year)
    matched = []
    for s in schools:
        school_meetings = _meetings_for_school(meetings, s["id"])
        if evaluate_tree(criteria, s, school_meetings, year_map.get(s["id"])):
            matched.append({"school_id": s["id"], "school_name": s["name"]})
    return matched


def compute_task_progress(org_id: str, task: dict, academic_year: str = DEFAULT_ACADEMIC_YEAR) -> dict:
    """Live re-evaluation, scoped only to the task's frozen `matched_school_ids` snapshot.
    Per-condition status is computed against the FIRST group only when multiple groups exist,
    for column display purposes — the group actually satisfied is reported per school so the
    frontend can show which OR-branch a school completed under."""
    schools, meetings, year_map = _fetch_schools_and_meetings(org_id, academic_year)
    schools_by_id = {s["id"]: s for s in schools}
    matched_ids = set(task.get("matched_school_ids") or [])
    groups = (task.get("criteria") or {}).get("groups") or []

    rows = []
    completed_count = 0
    for school_id in matched_ids:
        school = schools_by_id.get(school_id)
        if not school:
            continue
        school_meetings = _meetings_for_school(meetings, school_id)
        year_row = year_map.get(school_id)

        satisfied_group_idx = None
        for gi, group in enumerate(groups):
            conditions = group.get("conditions") or []
            if conditions and all(
                _eval_meeting_condition(c, school_meetings) if c.get("type") == "meeting"
                else _eval_field_condition(c, school, year_row)
                for c in conditions
            ):
                satisfied_group_idx = gi
                break

        display_group = groups[satisfied_group_idx] if satisfied_group_idx is not None else (groups[0] if groups else {"conditions": []})
        condition_results = [
            (_eval_meeting_condition(c, school_meetings) if c.get("type") == "meeting"
             else _eval_field_condition(c, school, year_row))
            for c in (display_group.get("conditions") or [])
        ]
        is_done = satisfied_group_idx is not None
        if is_done:
            completed_count += 1

        rows.append({
            "school_id": school_id,
            "school_name": school["name"],
            "done": is_done,
            "condition_results": condition_results,
        })

    total = len(rows)
    progress_pct = round((completed_count / total) * 100, 2) if total else 0.0
    return {"schools": rows, "total": total, "completed": completed_count, "progress_pct": progress_pct}


_CONTACT_NAME_FIELDS = {
    "principal": "principal_name",
    "secretary": "secretary_name",
    "finance_contact": "finance_contact_name",
}


def find_schools_by_contact_name(org_id: str, name: str) -> list[dict]:
    """Reverse lookup — given a person's (partial) name, finds which school(s) they're the
    contact for, and which fixed role they match. Does NOT search extra_contacts (JSONB) —
    a documented limitation, not a blocking one. One bounded query (Invariant #7)."""
    name = (name or "").strip()
    if not name:
        return []
    for attempt in range(2):
        try:
            db = get_admin_client()
            filters = ",".join(f"{field}.ilike.%{name}%" for field in _CONTACT_NAME_FIELDS.values())
            rows = (
                db.table("schools")
                .select("id, name, principal_name, secretary_name, finance_contact_name")
                .eq("org_id", org_id)
                .eq("status", "active")
                .or_(filters)
                .execute()
                .data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                _log.warning("find_schools_by_contact_name attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("find_schools_by_contact_name failed after 2 attempts: %s", exc, exc_info=True)
                raise

    results = []
    needle = name.lower()
    for s in rows:
        for role, field in _CONTACT_NAME_FIELDS.items():
            value = s.get(field)
            if value and needle in value.lower():
                results.append({
                    "school_id": s["id"], "school_name": s["name"],
                    "matched_role": role, "matched_name": value,
                })
    return results
