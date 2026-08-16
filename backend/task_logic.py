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
    {"type": "goal", "goal_key": "<key>", "division_type": "tikkon"|"beinayim"|"yesodi"|"other",
     "budget_name": "<name>", "value": "yes"|"no"|"unset"}
        -> Compares the school's school_goals row for that exact
           (division_type, budget_name, goal_key) against `value` ("unset" = no row / met is
           NULL — a goal can be genuinely never-evaluated, not just false).
    {"type": "control_letter", "division_type": "tikkon"|"beinayim"|"yesodi"|"other",
     "field": "status"|"received_date"|"days_to_answer"|"notes", "op": "eq"|...|"contains", "value": ...}
        -> Compares the school's control_letters row for that division_type (a school can have
           up to 2 — one per division) against `value`.

Only bounded DB queries are ever issued (schools, meetings, school_goals, control_letters,
per-service-type advisor tables) — never a per-school loop — per Architecture Invariant #7
(no Python-side table scans).
"""

import logging
import time

from academic_years import DEFAULT_ACADEMIC_YEAR
from routers.schools_router import GOAL_DEFINITIONS, DIVISION_LABELS
from supabase_client import get_admin_client, reset_admin_client

_log = logging.getLogger(__name__)

# Mirrors ADMIN_TEXT_COLUMNS / ADMIN_NUMBER_COLUMNS / ADMIN_SELECT_COLUMNS in
# backend/routers/agent_router.py — kept as a separate list here because task
# field-conditions also need to know which table each field lives on.
SCHOOL_FIELDS = {
    "name": "text", "symbol": "text", "city": "text", "authority": "text", "stage": "select",
    "district": "select", "finance_software": "select",
    "principal_name": "text", "principal_phone": "text", "principal_email": "text",
    "secretary_name": "text", "secretary_phone": "text", "secretary_email": "text",
    "finance_contact_name": "text", "finance_contact_phone": "text", "finance_contact_email": "text",
    "school_phone": "text", "address": "text", "notes": "text", "meeting_coordinator": "select",
    # advisor_* and meetings_* aren't real `schools` columns — _fetch_schools_and_meetings
    # attaches them onto each school dict from separate per-service-type advisor tables and a
    # meetings-stats RPC (see there), but from _eval_field_condition's point of view they're
    # indistinguishable from any other school-level field once attached.
    "advisor_gefen": "select", "advisor_current": "select", "advisor_district": "select",
    "meetings_completed": "number", "meetings_hours": "number",
}
# JSONB/array-shaped school fields (restrict_access_to, extra_contacts, *_day_off) are
# deliberately NOT exposed here — _eval_field_condition's eq/ne/gt/contains comparison model
# isn't built for nested membership search inside them.
STAGE_OPTIONS = ["yesodi", "beinayim", "tikkon", "sheshshnati", "other"]
FINANCE_SOFTWARE_OPTIONS = ["kesafim2000", "payscool", "schoolcash"]
MEETING_COORDINATOR_OPTIONS = ["principal", "secretary", "finance_contact"]
# Matches SchoolPage.jsx's DISTRICT_OPTIONS — a closed list edited via <select> on the school
# card, not free text (the raw stored value IS the Hebrew display string, no separate code).
DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"]

# Goals/control-letters are scoped per (school, division_type[, budget_name, academic_year]) —
# not a flat per-school value — so they're separate condition types ("goal"/"control_letter"),
# not entries in SCHOOL_FIELDS/YEAR_ADMIN_FIELDS. See module docstring.
DIVISION_TYPE_OPTIONS = ["tikkon", "beinayim", "yesodi", "other"]
# Every raw budget_name in school_goals/check_metrics passes through
# zihuy_core.normalize_budget_name, which maps to one of these 8 names (or leaves it unchanged
# if nothing matches) — not a DB-enforced enum, but the practical universe of stored values.
BUDGET_NAME_OPTIONS = ["גפן חירום", "גפן", "תנופה", "תקומה", "דוקאטי", "חינוך לסובלנות", "קולות קוראים", 'פל"ג']
# Only "planning"/"reporting" kind goals are trackable per-school (school_goals rows) — "date"
# kind entries in GOAL_DEFINITIONS are read-only informational deadlines, never saved.
GOAL_DEFS = [d for d in GOAL_DEFINITIONS if d["kind"] in ("planning", "reporting")]
GOAL_VALUE_OPTIONS = ["yes", "no", "unset"]
GOAL_VALUE_LABELS = {"yes": "כן", "no": "לא", "unset": "טרם הוגדר"}
CONTROL_LETTER_FIELDS = {"status": "select", "received_date": "text", "days_to_answer": "number", "notes": "text"}
CONTROL_LETTER_STATUS_OPTIONS = ["in_progress", "problem", "handled_1", "further_fix", "handled_2"]
CONTROL_LETTER_STATUS_LABELS = {
    "in_progress": "בתהליך", "problem": "בעיה", "handled_1": "טופל 1",
    "further_fix": "תיקון נוסף", "handled_2": "טופל 2",
}
CONTROL_LETTER_FIELD_LABELS = {
    "status": "סטטוס", "received_date": "תאריך קבלה", "days_to_answer": "ימים למענה", "notes": "הערות",
}

YEAR_ADMIN_FIELDS = {
    "service_type": "select", "client_status": "select", "requested_price": "number",
    "order_method": "select",
    "order_amount_gefen": "number", "hours_ordered": "number", "rate": "number",
    "payment_received": "number", "payment_requests_sent": "number",
    "contract_sent": "bool", "contract_received": "bool", "receipts_sent": "number",
    "closure_parents_status": "bool", "closure_parents_notes": "text",
    "closure_authority_status": "bool", "closure_authority_notes": "text",
    "meeting_allocation_gefen": "number", "meeting_allocation_current": "number",
    "meeting_allocation_district": "number",
    "meeting_duration_gefen": "number", "meeting_duration_current": "number",
    "meeting_duration_district": "number",
    "invoice_transaction_status": "text", "payment_method": "text", "amount_paid": "number",
}
# invoice_numbers / deposit_dates (list[str]) excluded for the same JSONB/array reason as above.
# Matches SchoolPage.jsx's SERVICE_TYPE_OPTIONS/CLIENT_STATUS_OPTIONS and the real
# school_year_admin_data.order_method values (FUNDING_METHOD_OPTIONS there) — these three used
# to be stale/incomplete here (missing "district"/"in_progress"/"former", and order_method had
# entirely fabricated values that don't exist anywhere else in the codebase).
SERVICE_TYPE_OPTIONS = ["gefen", "current", "gefen_current", "district"]
CLIENT_STATUS_OPTIONS = ["active", "inactive", "in_progress", "former"]
ORDER_METHOD_OPTIONS = ["private", "authority", "district"]

# Hebrew display labels for every fixed-choice field's raw stored value, mirroring the label
# maps already duplicated across DashboardPage.jsx/SchoolPage.jsx — centralized here so
# field_options() can hand the frontend {value, label} pairs directly instead of raw values.
STAGE_LABELS = {"yesodi": "יסודי", "beinayim": "חטיבת ביניים", "tikkon": "תיכון", "sheshshnati": "שש שנתי", "other": "אחר"}
FINANCE_SOFTWARE_LABELS = {"kesafim2000": "כספים 2000", "payscool": "פייסקול", "schoolcash": "סקולקאש"}
MEETING_COORDINATOR_LABELS = {"principal": "מנהל/ת", "secretary": "מנהלנ/ית", "finance_contact": "אחראי/ת כספים"}
SERVICE_TYPE_LABELS = {"gefen": "גפן", "current": "שוטף", "gefen_current": "גפן+שוטף", "district": "מחוז"}
CLIENT_STATUS_LABELS = {"active": "פעיל", "inactive": "לא פעיל", "in_progress": "בתהליך", "former": "לקוח עבר"}
ORDER_METHOD_LABELS = {"private": "פרטי", "authority": "רשות", "district": "מחוז"}
BOOL_LABELS = {"yes": "כן", "no": "לא"}

FIELD_LABELS = {
    "name": "שם בית ספר",
    "symbol": "סמל מוסד", "city": "עיר", "authority": "בעלות", "stage": "שלב מוסד",
    "district": "מחוז", "finance_software": "תוכנת כספים",
    "principal_name": "שם מנהל/ת", "principal_phone": "טלפון מנהל/ת", "principal_email": "מייל מנהל/ת",
    "secretary_name": "שם מזכיר/ה", "secretary_phone": "טלפון מזכיר/ה", "secretary_email": "מייל מזכיר/ה",
    "finance_contact_name": "שם אחראי/ת כספים", "finance_contact_phone": "טלפון אחראי/ת כספים",
    "finance_contact_email": "מייל אחראי/ת כספים",
    "school_phone": "טלפון בית ספר", "address": "כתובת", "notes": "הערות",
    "meeting_coordinator": "אחראי/ת לתיאום פגישות",
    "advisor_gefen": "יועץ מלווה [גפן]", "advisor_current": "יועץ מלווה [שוטף]", "advisor_district": "יועץ מלווה [מחוז]",
    "meetings_completed": 'סה"כ פגישות שבוצעו', "meetings_hours": 'סה"כ שעות שבוצעו',
    "service_type": "סוג שירות", "client_status": "סטטוס לקוח", "requested_price": "מחיר מבוקש",
    "order_method": "אמצעי הזמנה", "order_amount_gefen": 'מחיר כולל מע"מ',
    "hours_ordered": "מספר שעות שהוזמנו", "rate": "תעריף",
    "payment_received": "תשלום שהתקבל", "payment_requests_sent": "דרישות תשלום שנשלחו",
    "contract_sent": "חוזה נשלח", "contract_received": "חוזה התקבל",
    "receipts_sent": "אסמכתאות שנשלחו",
    "closure_parents_status": "סטטוס סגירה מול הורים", "closure_parents_notes": "הערות סגירה מול הורים",
    "closure_authority_status": "סטטוס סגירה מול רשות", "closure_authority_notes": "הערות סגירה מול רשות",
    "meeting_allocation_gefen": "מכסת פגישות — גפן", "meeting_allocation_current": "מכסת פגישות — שוטף",
    "meeting_allocation_district": "מכסת פגישות — מחוז",
    "meeting_duration_gefen": "משך פגישה — גפן", "meeting_duration_current": "משך פגישה — שוטף",
    "meeting_duration_district": "משך פגישה — מחוז",
    "invoice_transaction_status": "סטטוס עסקת חשבונית", "payment_method": "אמצעי תשלום",
    "amount_paid": "סכום ששולם",
}

# Matches meetings.meeting_service_type (see frontend/src/components/meetings/constants.js
# MEETING_SERVICE_TYPE_OPTIONS) — the meetings-area "סוג" column, NOT meeting_type
# (physical/remote), which is a different, unrelated field ("אופן" the meeting happens).
MEETING_SERVICE_TYPE_OPTIONS = ["gefen", "current", "gefen_current", "district"]
NUMBER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte"}


def _labeled(values: list[str] | None, labels: dict[str, str]) -> list[dict] | None:
    if values is None:
        return None
    return [{"value": v, "label": labels.get(v, v)} for v in values]


def _fetch_org_advisor_options(org_id: str) -> list[dict]:
    """Bounded query for the org's users, for the advisor_gefen/current/district field
    dropdowns — mirrors schools_router.list_users' query shape."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("profiles").select("id, full_name").eq("org_id", org_id)
                .order("full_name").execute().data or []
            )
            return [{"value": p["id"], "label": p.get("full_name") or p["id"]} for p in rows]
        except Exception as exc:
            if attempt == 0:
                _log.warning("_fetch_org_advisor_options attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("_fetch_org_advisor_options failed after 2 attempts: %s", exc, exc_info=True)
                return []


def field_options(org_id: str | None = None) -> dict:
    """Everything the frontend's condition builder needs (GET /tasks/field-options):
    - "fields": flat list for plain 'field' conditions (as before). `options` (when present)
      is a list of {value, label} pairs — value is the raw stored value, label is the Hebrew
      text shown elsewhere in the app (e.g. the school card).
    - "goal_options"/"division_options"/"budget_name_options"/"control_letter_fields": the
      extra pickers a 'goal'/'control_letter' condition needs (see module docstring) — kept as
      separate top-level keys rather than folded into "fields" because those two condition
      types need dedicated UI (division/budget selectors), not the plain field/op/value form.

    `org_id=None` (used by agent_router.py's module-load-time `_TASK_FIELD_OPTIONS`, which is
    org-agnostic and only needs field names/types/labels for an LLM prompt, not actual advisor
    names) skips the advisor-options DB query entirely — advisor_gefen/current/district simply
    get `options: None` in that case.
    """
    advisor_options = _fetch_org_advisor_options(org_id) if org_id else None
    school_options = {
        "stage": _labeled(STAGE_OPTIONS, STAGE_LABELS),
        "finance_software": _labeled(FINANCE_SOFTWARE_OPTIONS, FINANCE_SOFTWARE_LABELS),
        "meeting_coordinator": _labeled(MEETING_COORDINATOR_OPTIONS, MEETING_COORDINATOR_LABELS),
        "district": _labeled(DISTRICT_OPTIONS, {}),
        "advisor_gefen": advisor_options, "advisor_current": advisor_options, "advisor_district": advisor_options,
    }
    fields = []
    for key, ftype in SCHOOL_FIELDS.items():
        fields.append({
            "field": key, "type": ftype, "table": "schools", "label": FIELD_LABELS[key],
            "options": school_options.get(key),
        })
    for key, ftype in YEAR_ADMIN_FIELDS.items():
        options = None
        if key == "service_type":
            options = _labeled(SERVICE_TYPE_OPTIONS, SERVICE_TYPE_LABELS)
        elif key == "client_status":
            options = _labeled(CLIENT_STATUS_OPTIONS, CLIENT_STATUS_LABELS)
        elif key == "order_method":
            options = _labeled(ORDER_METHOD_OPTIONS, ORDER_METHOD_LABELS)
        elif ftype == "bool":
            options = _labeled(["yes", "no"], BOOL_LABELS)
        fields.append({
            "field": key, "type": ftype, "table": "school_year_admin_data",
            "label": FIELD_LABELS[key], "options": options,
        })

    goal_options = [{"key": d["key"], "label": d["label"], "goal_number": d["goal_number"]} for d in GOAL_DEFS]
    division_options = _labeled(DIVISION_TYPE_OPTIONS, DIVISION_LABELS)
    budget_name_options = _labeled(BUDGET_NAME_OPTIONS, {})
    control_letter_fields = [
        {
            "field": key, "type": ftype, "label": CONTROL_LETTER_FIELD_LABELS[key],
            "options": _labeled(CONTROL_LETTER_STATUS_OPTIONS, CONTROL_LETTER_STATUS_LABELS) if key == "status" else None,
        }
        for key, ftype in CONTROL_LETTER_FIELDS.items()
    ]

    return {
        "fields": fields,
        "goal_options": goal_options,
        "division_options": division_options,
        "budget_name_options": budget_name_options,
        "control_letter_fields": control_letter_fields,
        "goal_value_options": _labeled(GOAL_VALUE_OPTIONS, GOAL_VALUE_LABELS),
    }


_ADVISOR_TABLES = {"gefen": "school_advisors_gefen", "current": "school_advisors_current", "district": "school_advisors_district"}


def _fetch_schools_and_meetings(
    org_id: str, academic_year: str,
) -> tuple[list[dict], list[dict], dict[str, dict], dict[str, list[dict]], dict[str, list[dict]]]:
    """One bounded query for active schools, one for their year-admin-data rows, one for their
    meetings, one per advisor-type table (attached directly onto each school dict), one for
    meetings-stats (RPC, also attached onto each school dict), one for school_goals, one for
    control_letters — mirrors the pattern in booking_logic.find_schools_missing_meetings /
    schools_router.list_schools' enrichment queries. Returns
    (schools, meetings, year_map, goal_map, control_letter_map) — goal_map/control_letter_map
    are {school_id: [rows]}, same shape as _meetings_for_school expects for meetings."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            schools = (
                db.table("schools")
                .select(
                    "id, name, symbol, city, authority, stage, district, finance_software, "
                    "principal_name, principal_phone, principal_email, "
                    "secretary_name, secretary_phone, secretary_email, "
                    "finance_contact_name, finance_contact_phone, finance_contact_email, "
                    "school_phone, address, notes, meeting_coordinator"
                )
                .eq("org_id", org_id)
                .eq("status", "active")
                .execute()
                .data or []
            )
            school_ids = [s["id"] for s in schools]
            if not school_ids:
                return [], [], {}, {}, {}

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

            # advisor_gefen/current/district — attached directly onto each school dict as a
            # list of advisor_ids, so _eval_field_condition's existing "actual is a list ->
            # membership check" branch handles them with zero new eval code.
            advisor_ids_by_school = {t: {} for t in _ADVISOR_TABLES}
            for service_type, table_name in _ADVISOR_TABLES.items():
                rows = db.table(table_name).select("school_id, advisor_id").in_("school_id", school_ids).execute().data or []
                for r in rows:
                    advisor_ids_by_school[service_type].setdefault(r["school_id"], []).append(r["advisor_id"])

            try:
                stats_rows = db.rpc("get_meetings_stats", {"school_ids": school_ids}).execute().data or []
                stats_by_school = {r["school_id"]: r for r in stats_rows}
            except Exception as exc:
                _log.warning("get_meetings_stats RPC failed (non-fatal, meetings_completed/hours will be 0): %s", exc)
                stats_by_school = {}

            for s in schools:
                for service_type in _ADVISOR_TABLES:
                    s[f"advisor_{service_type}"] = advisor_ids_by_school[service_type].get(s["id"], [])
                stats = stats_by_school.get(s["id"])
                s["meetings_completed"] = stats["completed"] if stats else 0
                s["meetings_hours"] = round((stats["total_minutes"] or 0) / 60, 1) if stats else 0

            goal_rows = (
                db.table("school_goals")
                .select("school_id, division_type, budget_name, goal_key, met")
                .eq("academic_year", academic_year)
                .in_("school_id", school_ids)
                .execute()
                .data or []
            )
            goal_map: dict[str, list[dict]] = {}
            for r in goal_rows:
                goal_map.setdefault(r["school_id"], []).append(r)

            cl_rows = (
                db.table("control_letters")
                .select("school_id, division_type, received_date, days_to_answer, status, notes")
                .in_("school_id", school_ids)
                .execute()
                .data or []
            )
            cl_map: dict[str, list[dict]] = {}
            for r in cl_rows:
                cl_map.setdefault(r["school_id"], []).append(r)

            return schools, meetings, year_map, goal_map, cl_map
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


def _rows_for_school(rows_map: dict[str, list[dict]], school_id: str) -> list[dict]:
    return rows_map.get(school_id) or []


def _matching_meetings(cond: dict, school_meetings: list[dict]) -> list[dict]:
    date_from, date_to = cond.get("date_from"), cond.get("date_to")
    meeting_service_type = cond.get("meeting_service_type")
    out = []
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
        out.append(m)
    return out


def _meeting_exists(cond: dict, school_meetings: list[dict]) -> bool:
    """Raw existence check (ignores `negate`) — whether a matching meeting exists at all.
    Exposed separately from _eval_meeting_condition so the UI can show "יש/אין פגישה"
    based on actual meeting existence rather than on condition-satisfied (which flips
    for negated conditions and reads as backwards to a manager)."""
    return len(_matching_meetings(cond, school_meetings)) > 0


def _count_matching_meetings(cond: dict, school_meetings: list[dict]) -> int:
    """Actual count of matching meetings (ignores `negate`) — feeds improvement #5's
    "X of Y required actions" progress metric when a meeting condition has a required_count."""
    return len(_matching_meetings(cond, school_meetings))


def _eval_meeting_condition(cond: dict, school_meetings: list[dict]) -> bool:
    """Raw criteria-match (WITH negate applied) — used only for the creation-time snapshot
    (find_matching_schools/evaluate_tree): "which schools currently match the task's targeting
    criteria". Do NOT use this for progress/success tracking — see _resolve_condition."""
    matched = _meeting_exists(cond, school_meetings)
    return (not matched) if cond.get("negate") else matched


def _coerce_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("yes", "כן", "true", "1")


def _compare(ftype: str | None, op: str, actual, target) -> bool:
    """Shared value comparison — factored out of _eval_field_condition so
    _eval_control_letter_condition can reuse it against a control_letters row instead of a
    school/year_admin row, with identical eq/ne/gt/gte/lt/lte/contains/list-membership rules."""
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
    return _compare(ftype, op, actual, target)


def _goal_row(cond: dict, goal_rows: list[dict]) -> dict | None:
    return next((
        r for r in goal_rows
        if r.get("division_type") == cond.get("division_type")
        and r.get("budget_name") == cond.get("budget_name")
        and r.get("goal_key") == cond.get("goal_key")
    ), None)


def _eval_goal_condition(cond: dict, goal_rows: list[dict]) -> bool:
    """No negate/op concept — `value` ("yes"/"no"/"unset") is the whole comparison. "unset"
    means no school_goals row exists for this exact (division_type, budget_name, goal_key)
    combination, or one exists with met still NULL (never explicitly toggled)."""
    row = _goal_row(cond, goal_rows)
    met = row.get("met") if row else None
    value = cond.get("value") or "unset"
    if value == "yes":
        return met is True
    if value == "no":
        return met is False
    return met is None


def _control_letter_row(cond: dict, cl_rows: list[dict]) -> dict | None:
    return next((r for r in cl_rows if r.get("division_type") == cond.get("division_type")), None)


def _eval_control_letter_condition(cond: dict, cl_rows: list[dict]) -> bool:
    row = _control_letter_row(cond, cl_rows)
    field = cond.get("field")
    ftype = CONTROL_LETTER_FIELDS.get(field)
    if ftype is None:
        return False
    op = cond.get("op") or "eq"
    target = cond.get("value")
    actual = (row or {}).get(field)
    return _compare(ftype, op, actual, target)


def _eval_condition_for_matching(
    cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None,
    goal_rows: list[dict], cl_rows: list[dict],
) -> bool:
    """Dispatch used by evaluate_tree (targeting/audience — negate-aware for meetings)."""
    ctype = cond.get("type")
    if ctype == "meeting":
        return _eval_meeting_condition(cond, school_meetings)
    if ctype == "goal":
        return _eval_goal_condition(cond, goal_rows)
    if ctype == "control_letter":
        return _eval_control_letter_condition(cond, cl_rows)
    return _eval_field_condition(cond, school, year_row)


def evaluate_tree(
    criteria: dict, school: dict, school_meetings: list[dict], year_row: dict | None,
    goal_rows: list[dict] | None = None, cl_rows: list[dict] | None = None,
) -> bool:
    groups = (criteria or {}).get("groups") or []
    if not groups:
        return False
    goal_rows = goal_rows or []
    cl_rows = cl_rows or []
    for group in groups:
        conditions = group.get("conditions") or []
        if not conditions:
            continue
        if all(
            _eval_condition_for_matching(c, school, school_meetings, year_row, goal_rows, cl_rows)
            for c in conditions
        ):
            return True
    return False


def _resolve_condition(
    cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None,
    goal_rows: list[dict] | None = None, cl_rows: list[dict] | None = None,
) -> bool:
    """Plain evaluation of a single condition against current data — used ONLY for walking a
    success tree (either `task.success_criteria` or the auto-derived inverse of `criteria`,
    see invert_criteria/compute_task_progress). Unlike _eval_meeting_condition, this has no
    `negate` semantics for meetings: a success tree is expected to already encode "achieved"
    directly via a meeting condition with negate=False (invert_criteria strips `negate`;
    the meeting-task wizard fast-path's success condition is built the same way), so meeting
    resolution here is always plain `meeting_exists`. Field/goal/control_letter conditions
    have no negate concept to begin with, so their "resolved" state is just whether they
    currently evaluate true — same eval functions used for targeting, reused directly.

    This function replaces the former _condition_resolved (kept the "always meeting_exists,
    regardless of how the condition is phrased" fix from the earlier bug), but is no longer
    the thing that decides *which* tree encodes success — that decision now happens once per
    task (success_criteria vs. auto-inverted criteria vs. track_success=False), not per
    condition. See compute_task_progress."""
    ctype = cond.get("type")
    if ctype == "meeting":
        return _meeting_exists(cond, school_meetings)
    if ctype == "goal":
        return _eval_goal_condition(cond, goal_rows or [])
    if ctype == "control_letter":
        return _eval_control_letter_condition(cond, cl_rows or [])
    return _eval_field_condition(cond, school, year_row)


_OP_INVERSE = {"eq": "ne", "ne": "eq", "gt": "lte", "gte": "lt", "lt": "gte", "lte": "gt"}


def _invert_field_condition(cond: dict) -> dict | None:
    """Returns the logical-inverse field condition, or None if not cleanly invertible
    (op == 'contains', or an unknown/missing op). Used only by invert_criteria."""
    op = cond.get("op") or "eq"
    if op not in _OP_INVERSE:
        return None
    return {**cond, "op": _OP_INVERSE[op]}


def invert_criteria(criteria: dict) -> dict | None:
    """Auto-derives a success tree from targeting criteria — the "success = the opposite of
    what I filtered for" default (option (a) in the wizard's "מה נחשב הצלחה?" step). Returns
    None when no clean logical inverse exists, forcing the caller into explicit
    success_criteria instead:
      - criteria has more than one group (an OR of ANDs) — De Morgan's expansion of that
        shape is a cross-product of groups, not representable in this engine without
        exponential blowup, so multi-group criteria are simply not auto-invertible.
      - any condition uses op == "contains" (no clean inverse — see _invert_field_condition).
    For a single group, each condition is inverted independently: meeting conditions always
    become {"negate": False} (achieving = a matching meeting now exists, regardless of how
    the targeting condition was phrased — same "always meeting_exists" principle as
    _resolve_condition); field conditions go through _invert_field_condition. Note per-
    condition inversion of an AND group is "NOT A AND NOT B", not the strict De Morgan
    "NOT(A AND B)" — this is a deliberate, documented approximation matching what a manager
    reading "success = the opposite of my filter" would expect for each individual test."""
    groups = (criteria or {}).get("groups") or []
    if len(groups) != 1:
        return None
    conditions = groups[0].get("conditions") or []
    if not conditions:
        return None
    inverted = []
    for c in conditions:
        if c.get("type") == "meeting":
            inverted.append({**c, "negate": False})
        elif c.get("type") == "goal":
            # No clean inverse — "value" is yes/no/unset, not an op, so _invert_field_condition
            # doesn't apply (it would silently misinterpret the missing "op" as "eq"). Same
            # treatment as "contains": force explicit success_criteria instead of guessing.
            return None
        else:
            inv = _invert_field_condition(c)
            if inv is None:
                return None
            inverted.append(inv)
    return {"groups": [{"conditions": inverted}]}


def find_matching_schools(
    org_id: str, criteria: dict, academic_year: str = DEFAULT_ACADEMIC_YEAR,
    manual_school_ids: list[str] | None = None,
) -> list[dict]:
    """Creation-time snapshot: returns the schools matching `criteria` right now, UNLESS
    manual_school_ids is given, in which case that explicit list IS the audience (bypasses
    criteria evaluation entirely) — the meeting-task wizard fast-path's "pick schools
    manually" mode."""
    schools, meetings, year_map, goal_map, cl_map = _fetch_schools_and_meetings(org_id, academic_year)
    if manual_school_ids is not None:
        wanted = set(manual_school_ids)
        return [
            {"school_id": s["id"], "school_name": s["name"], "symbol": s.get("symbol"), "authority": s.get("authority")}
            for s in schools if s["id"] in wanted
        ]
    matched = []
    for s in schools:
        school_meetings = _meetings_for_school(meetings, s["id"])
        if evaluate_tree(
            criteria, s, school_meetings, year_map.get(s["id"]),
            _rows_for_school(goal_map, s["id"]), _rows_for_school(cl_map, s["id"]),
        ):
            matched.append({
                "school_id": s["id"], "school_name": s["name"],
                "symbol": s.get("symbol"), "authority": s.get("authority"),
            })
    return matched


def compute_task_progress(org_id: str, task: dict, academic_year: str = DEFAULT_ACADEMIC_YEAR) -> dict:
    """Live re-evaluation, scoped only to the task's frozen `matched_school_ids` snapshot.

    "Success" (is_done/progress_pct/which schools still need a reminder) is now walked over
    an INDEPENDENT tree from the targeting `criteria` used to select matched_school_ids in
    the first place — see the round-2 redesign: task["success_criteria"] if the manager
    defined one explicitly, else invert_criteria(task["criteria"]) if track_success is on
    (the auto-derived "opposite of my filter" default), else no success tracking at all
    (track_success=False — "just track sends" tasks have no done/not-done concept).

    Per-condition status is computed against the FIRST group of the success tree only when
    multiple groups exist, for column display purposes — the group actually satisfied is
    reported per school so the frontend can show which OR-branch a school completed under.
    """
    track_success = task.get("track_success", True)
    schools, meetings, year_map, goal_map, cl_map = _fetch_schools_and_meetings(org_id, academic_year)
    schools_by_id = {s["id"]: s for s in schools}
    matched_ids = set(task.get("matched_school_ids") or [])

    if not track_success:
        rows = []
        for school_id in matched_ids:
            school = schools_by_id.get(school_id)
            if not school:
                continue
            rows.append({
                "school_id": school_id, "school_name": school["name"],
                "symbol": school.get("symbol"), "authority": school.get("authority"),
                "done": None, "condition_results": [],
            })
        return {
            "schools": rows, "total": len(rows), "completed": None, "progress_pct": None,
            "action_progress": None, "track_success": False,
        }

    success_tree = task.get("success_criteria")
    if success_tree is None:
        success_tree = invert_criteria(task.get("criteria") or {})
        if success_tree is None:
            # Data-integrity fallback (should not happen if the wizard enforces the choice —
            # see round-2 plan §"מה נחשב הצלחה?"): degrade to "nobody resolved yet" rather
            # than crash. Logged non-fatally by the caller (get_task), not here, to avoid
            # log spam on every progress computation of an affected task.
            success_tree = {"groups": []}
    groups = success_tree.get("groups") or []

    rows = []
    completed_count = 0
    required_actions_total = 0
    completed_actions_total = 0
    for school_id in matched_ids:
        school = schools_by_id.get(school_id)
        if not school:
            continue
        school_meetings = _meetings_for_school(meetings, school_id)
        year_row = year_map.get(school_id)
        goal_rows = _rows_for_school(goal_map, school_id)
        cl_rows = _rows_for_school(cl_map, school_id)

        satisfied_group_idx = None
        for gi, group in enumerate(groups):
            conditions = group.get("conditions") or []
            if conditions and all(_resolve_condition(c, school, school_meetings, year_row, goal_rows, cl_rows) for c in conditions):
                satisfied_group_idx = gi
                break

        display_group = groups[satisfied_group_idx] if satisfied_group_idx is not None else (groups[0] if groups else {"conditions": []})
        condition_results = [
            (
                {
                    "ok": _resolve_condition(c, school, school_meetings, year_row, goal_rows, cl_rows), "meeting_exists": _meeting_exists(c, school_meetings),
                    "actual_count": _count_matching_meetings(c, school_meetings), "required_count": c.get("required_count"),
                }
                if c.get("type") == "meeting"
                else {"ok": _resolve_condition(c, school, school_meetings, year_row, goal_rows, cl_rows), "meeting_exists": None, "actual_count": None, "required_count": None}
            )
            for c in (display_group.get("conditions") or [])
        ]
        is_done = satisfied_group_idx is not None
        if is_done:
            completed_count += 1

        # Improvement #5: "X of Y required actions" — additive to (not a replacement for) the
        # school-count-based is_done/completed_count model above, since other features
        # (send-status, exclusions) key off `done` at the school level. Only meaningful for
        # meeting conditions where the manager set an explicit required_count (e.g. "3 meetings
        # per school") — accumulated across all matched schools' display-group conditions.
        for res in condition_results:
            if res.get("required_count"):
                required_actions_total += res["required_count"]
                completed_actions_total += min(res["actual_count"] or 0, res["required_count"])

        rows.append({
            "school_id": school_id,
            "school_name": school["name"],
            "symbol": school.get("symbol"),
            "authority": school.get("authority"),
            "done": is_done,
            "condition_results": condition_results,
        })

    total = len(rows)
    progress_pct = round((completed_count / total) * 100, 2) if total else 0.0
    action_progress = None
    if required_actions_total:
        action_progress = {
            "completed": completed_actions_total, "required": required_actions_total,
            "pct": round((completed_actions_total / required_actions_total) * 100, 2),
        }
    return {
        "schools": rows, "total": total, "completed": completed_count, "progress_pct": progress_pct,
        "action_progress": action_progress, "track_success": True,
    }


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
