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
    {"type": "goal", "goal_key": "<key>", "budget_names": ["<name>", ...], "value": "yes"|"no"|"unset",
     "division_type": "tikkon"|"beinayim"|"yesodi"|"other"}  # division_type: legacy only, see below
        -> Compares the school's school_goals row(s) for (budget_name, goal_key) against `value`
           ("unset" = no row / met is NULL). `budget_names` is AND'd — every listed budget must
           independently satisfy `value`. `division_type` is a legacy field: if a condition still
           has it set (saved before the per-school auto-detected division split existed), it's
           evaluated against that ONE division_type exactly, unchanged, for backward
           compatibility. New conditions never set it — the UI no longer offers a division
           picker, since which division_type(s) apply is inherently per-school (a six-year
           school has two) — instead the check is evaluated across ALL division_type rows that
           exist for the school for that budget/goal, ANDed together.
    {"type": "control_letter", "field": "status"|"received_date"|"days_to_answer"|"notes",
     "op": "eq"|...|"contains", "value": ..., "division_type": "tikkon"|"beinayim"|"yesodi"|"other"}
        -> Compares the school's control_letters row(s) against `value`. Same division_type
           legacy/auto-detect split as "goal" above (a school can have up to 2 rows — one per
           division — ANDed together when division_type isn't set on the condition).

Only bounded DB queries are ever issued (schools, meetings, school_goals, control_letters,
per-service-type advisor tables) — never a per-school loop — per Architecture Invariant #7
(no Python-side table scans).
"""

import hashlib
import hmac
import logging
import os
import time

from academic_years import DEFAULT_ACADEMIC_YEAR
from routers.schools_router import GOAL_DEFINITIONS, DIVISION_LABELS
from supabase_client import get_admin_client, reset_admin_client

_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

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


def make_optout_token(email: str) -> str:
    """Same HMAC-token convention as signup_router._make_unsub_token, kept independent since
    this opts a contact out of task/school messages specifically, not the unrelated
    marketing-leads list signup_router manages. Shared (moved from tasks_router) so
    schools_router's non-task send paths (direct coordination, booking-agent emails, due
    reminders) can build/verify the same opt-out links and _opted_out_recipients below."""
    return hmac.new(_SUPABASE_KEY.encode(), email.lower().encode(), hashlib.sha256).hexdigest()[:32]


def fetch_opted_out_emails(db, emails: list[str]) -> set[str]:
    if not emails:
        return set()
    rows = db.table("task_opted_out_contacts").select("email").in_("email", emails).execute().data or []
    return {r["email"] for r in rows}


def opted_out_recipients(
    db, academic_year: str, resolved_emails_by_school_id: dict[str, str | None],
) -> dict[str, str]:
    """Returns {school_id: email} for every school whose resolved recipient email is on the
    global opt-out list AND whose CURRENT client_status isn't 'active' — i.e. genuinely
    suppressed right now. Re-evaluated fresh on every call (no caching, no separate
    "reactivated" state) so a school becomes sendable again automatically the instant its
    status flips back to 'active', with zero manual list-management. The opt-out row itself is
    never deleted — if the school later goes inactive again, suppression resumes immediately."""
    school_ids = [sid for sid, email in resolved_emails_by_school_id.items() if email]
    if not school_ids:
        return {}
    emails = list({(email or "").strip().lower() for email in resolved_emails_by_school_id.values() if email})
    opted_out_emails = fetch_opted_out_emails(db, emails)
    if not opted_out_emails:
        return {}
    year_rows = (
        db.table("school_year_admin_data").select("school_id, client_status")
        .eq("academic_year", academic_year).in_("school_id", school_ids).execute().data or []
    )
    client_status_map = {r["school_id"]: r.get("client_status") for r in year_rows}
    return {
        sid: email.strip().lower()
        for sid, email in resolved_emails_by_school_id.items()
        if email and email.strip().lower() in opted_out_emails and client_status_map.get(sid) != "active"
    }

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

    # "kind" ("planning"/"reporting") lets the frontend build a short title like "תכנון 70%"
    # without hardcoding a second copy of GOAL_DEFS' planning/reporting split (see
    # FieldMetricEditor.jsx's goalTitle).
    goal_options = [{"key": d["key"], "label": d["label"], "goal_number": d["goal_number"], "kind": d["kind"]} for d in GOAL_DEFS]
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
                .select("school_id, meeting_date, meeting_service_type, status, stage_scope, meeting_type")
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
    # status/meeting_type are optional filters added for audience-filtering condition cards
    # (ConditionGroupsEditor.jsx) — a condition dict missing these keys (e.g. every audience
    # saved before this round) reads back None/falsy here, so the check is skipped exactly like
    # today, preserving old saved criteria unchanged.
    status = cond.get("status")
    meeting_type = cond.get("meeting_type")
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
        if status and m.get("status") != status:
            continue
        if meeting_type and m.get("meeting_type") != meeting_type:
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


def _required_count_for_condition(cond: dict) -> int:
    """Round 17 — default required count for a meeting condition. A stage_scope="separate"
    requirement always needs exactly 2 (one per principal) regardless of any manually-set
    required_count (a split requirement can't sensibly ask for a different number — there are
    only ever two slots). Every other meeting condition uses the manager's required_count if
    set, otherwise 1 — matching _meeting_exists's original ">=1 match" behavior exactly, so this
    is a no-op for every condition that doesn't use these new features."""
    if cond.get("type") == "meeting" and cond.get("stage_scope") == "separate":
        return 2
    return cond.get("required_count") or 1


def _fulfilled_count_for_meeting_condition(cond: dict, school_meetings: list[dict]) -> int:
    """Round 17 — for stage_scope="separate", counts DISTINCT principal slots fulfilled (0-2)
    via each matching meeting's own stage_scope, not the raw row count — booking only the
    tichon principal's meeting must not count as 2/2. A "both"-scoped (or legacy/unscoped)
    meeting counts toward either slot, since it covers both principals at once. Every other
    condition keeps the original raw match count (identical to _count_matching_meetings)."""
    matches = _matching_meetings(cond, school_meetings)
    if cond.get("stage_scope") == "separate":
        has_tichon = any(m.get("stage_scope") in ("tichon", "both") for m in matches)
        has_chativa = any(m.get("stage_scope") in ("chativa", "both") for m in matches)
        return int(has_tichon) + int(has_chativa)
    return len(matches)


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
        is_member = target in actual
        return not is_member if op == "ne" else is_member
    is_equal = str(actual or "").strip() == str(target or "").strip()
    return not is_equal if op == "ne" else is_equal


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


def _goal_budget_names(cond: dict) -> list[str]:
    """budget_names (new, list) with a fallback to the legacy singular budget_name for
    conditions saved before the multi-select UI existed."""
    names = cond.get("budget_names")
    if names:
        return names
    legacy = cond.get("budget_name")
    return [legacy] if legacy else [None]


def _eval_single_goal(division_type, budget_name, goal_key: str, value: str, goal_rows: list[dict]) -> bool:
    row = next((
        r for r in goal_rows
        if r.get("division_type") == division_type
        and r.get("budget_name") == budget_name
        and r.get("goal_key") == goal_key
    ), None)
    met = row.get("met") if row else None
    if value == "yes":
        return met is True
    if value == "no":
        return met is False
    return met is None


def _eval_goal_condition(cond: dict, goal_rows: list[dict]) -> bool:
    """No negate/op concept — `value` ("yes"/"no"/"unset") is the whole comparison. "unset"
    means no school_goals row exists for the relevant (division_type, budget_name, goal_key)
    combination, or one exists with met still NULL (never explicitly toggled).

    `division_type`: legacy exact-match path when a condition still has one saved (old data) —
    unchanged single-row check. New conditions never set it: instead every division_type that
    actually has a school_goals row for this goal_key is checked (a six-year school naturally
    has two), ANDed together — a division the school doesn't have simply contributes nothing.
    `budget_names` is always ANDed across every listed budget (see _goal_budget_names)."""
    goal_key = cond.get("goal_key")
    value = cond.get("value") or "unset"
    budget_names = _goal_budget_names(cond)
    division_type = cond.get("division_type")
    if division_type:
        divisions = [division_type]
    else:
        divisions = sorted({r["division_type"] for r in goal_rows if r.get("goal_key") == goal_key}) or [None]
    return all(
        _eval_single_goal(d, b, goal_key, value, goal_rows)
        for d in divisions for b in budget_names
    )


def _eval_single_control_letter(division_type, field: str, op: str, target, cl_rows: list[dict]) -> bool:
    row = next((r for r in cl_rows if r.get("division_type") == division_type), None)
    ftype = CONTROL_LETTER_FIELDS.get(field)
    if ftype is None:
        return False
    actual = (row or {}).get(field)
    return _compare(ftype, op, actual, target)


def _eval_control_letter_condition(cond: dict, cl_rows: list[dict]) -> bool:
    """Same legacy-vs-auto-detect division_type split as _eval_goal_condition — a school can
    have up to 2 control_letters rows (one per division); new conditions check all of them,
    ANDed together, instead of forcing a single pre-chosen division."""
    field = cond.get("field")
    op = cond.get("op") or "eq"
    target = cond.get("value")
    division_type = cond.get("division_type")
    if division_type:
        divisions = [division_type]
    else:
        divisions = sorted({r["division_type"] for r in cl_rows if r.get("division_type")}) or [None]
    return all(_eval_single_control_letter(d, field, op, target, cl_rows) for d in divisions)


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
        # Round 17 — now required-count-aware (was a plain >=1 existence check). Defaults to
        # requiring exactly 1 match for every condition that doesn't set required_count or
        # stage_scope="separate", so this is behavior-identical to the old _meeting_exists check
        # for the vast majority of existing conditions (confirmed against the regression task,
        # which has no explicit required_count on any condition).
        return _fulfilled_count_for_meeting_condition(cond, school_meetings) >= _required_count_for_condition(cond)
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
                "district": school.get("district"), "city": school.get("city"),
                "done": None, "condition_results": [],
                "stage_label": STAGE_LABELS.get(school.get("stage"), school.get("stage")), "stage_rows": None,
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
        conds = display_group.get("conditions") or []
        condition_results = [
            (
                {
                    "ok": _resolve_condition(c, school, school_meetings, year_row, goal_rows, cl_rows), "meeting_exists": _meeting_exists(c, school_meetings),
                    # Round 17: required-count-aware — always >=1 for a meeting condition now
                    # (was raw match count / manager-set-or-None), so a "separate" split
                    # condition shows 0-2 distinct-slot progress instead of a raw row count that
                    # could misleadingly read "1/1" after only one of two principals was booked.
                    "actual_count": _fulfilled_count_for_meeting_condition(c, school_meetings), "required_count": _required_count_for_condition(c),
                }
                if c.get("type") == "meeting"
                else {"ok": _resolve_condition(c, school, school_meetings, year_row, goal_rows, cl_rows), "meeting_exists": None, "actual_count": None, "required_count": None}
            )
            for c in conds
        ]
        is_done = satisfied_group_idx is not None
        if is_done:
            completed_count += 1

        # Improvement #5: "X of Y required actions" — additive to (not a replacement for) the
        # school-count-based is_done/completed_count model above, since other features
        # (send-status, exclusions) key off `done` at the school level. Round 17: now runs for
        # EVERY meeting condition (required_count is always populated, >=1, never None anymore)
        # instead of only ones with an explicit manager-set required_count — non-meeting
        # conditions still don't contribute (required_count stays None for them), so this has
        # zero effect on tasks with no meeting conditions at all.
        for res in condition_results:
            if res.get("required_count"):
                required_actions_total += res["required_count"]
                completed_actions_total += min(res["actual_count"] or 0, res["required_count"])

        # Round 17 — per-stage row breakdown for TaskPanel.jsx: only when this school is
        # six-year (two real principals) AND the display group has at least one stage-specific
        # meeting condition (tichon/chativa/separate). Reuses condition_results' already-computed
        # `ok` for merged (non-split) conditions and the matching-stage case, so this never
        # re-derives anything the main condition_results didn't already establish — only
        # "separate" needs a fresh per-stage (single-slot, not both-required) check, since
        # condition_results' `ok` for it reflects the combined 2-of-2 requirement.
        stage_rows = None
        is_six_year_split = (
            school.get("stage") == "sheshshnati" and not school.get("principal_same_person")
            and any(c.get("type") == "meeting" and c.get("stage_scope") in ("tichon", "chativa", "separate") for c in conds)
        )
        if is_six_year_split:
            stage_rows = []
            for row_stage, row_label in (("tichon", "תיכון"), ("chativa", "חטיבת ביניים")):
                row_results = []
                for c, base_res in zip(conds, condition_results):
                    cond_stage_scope = c.get("stage_scope")
                    if c.get("type") == "meeting" and cond_stage_scope in ("tichon", "chativa", "separate"):
                        if cond_stage_scope == "separate":
                            matches = _matching_meetings(c, school_meetings)
                            ok = any(m.get("stage_scope") in (row_stage, "both") for m in matches)
                            row_results.append({"ok": ok, "merged": False, "not_applicable": False})
                        elif cond_stage_scope == row_stage:
                            row_results.append({"ok": base_res["ok"], "merged": False, "not_applicable": False})
                        else:
                            row_results.append({"ok": None, "merged": False, "not_applicable": True})
                    else:
                        row_results.append({"ok": base_res["ok"], "merged": True, "not_applicable": False})
                stage_rows.append({"stage_label": row_label, "condition_results": row_results})

        rows.append({
            "school_id": school_id,
            "school_name": school["name"],
            "symbol": school.get("symbol"),
            "authority": school.get("authority"),
            "district": school.get("district"),
            "city": school.get("city"),
            "done": is_done,
            "condition_results": condition_results,
            "stage_label": STAGE_LABELS.get(school.get("stage"), school.get("stage")),
            "stage_rows": stage_rows,
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


_OK_SKIP_REASONS_FOR_COMPLETION = {"already_done", "opted_out"}


def recompute_task_status_and_cache(db, org_id: str, task: dict) -> dict | None:
    """Single source of truth for the 3-state status transition (active <-> archived, i.e.
    open <-> closed/"סגורה") AND the cached progress columns (cached_total_schools/
    cached_actions_needed/cached_actions_completed/cached_progress_pct) — computed together so
    they can never drift apart. Mirrors has_meeting_send_problems' established convention:
    written at specific mutation touchpoints in tasks_router.py, never computed live inside
    list_tasks, so the tasks list stays a cheap read of stored columns regardless of org size.
    Self-healing both directions — a task can reopen (archived -> active) if it later becomes
    incomplete again (e.g. a newly-matched school, or a message needing resend). No-ops for
    'scheduled' tasks (nothing to evaluate before activation). Non-fatal: never raises."""
    if task.get("status") == "scheduled":
        return None
    try:
        academic_year = task.get("academic_year") or DEFAULT_ACADEMIC_YEAR
        progress = compute_task_progress(org_id, task, academic_year)
        matched_ids = [r["school_id"] for r in progress["schools"]]
        total = len(matched_ids)

        if progress["track_success"]:
            completed = progress["completed"]
            is_complete = total > 0 and completed == total
            # "actions" here must mean the exact same thing the live detail view's own
            # action_progress does (get_task/TaskDetailContent's "פעולות: X מתוך Y") — a
            # required-count-aware aggregate (e.g. 2 stage-split meetings counted as 2 actions
            # for one school), NOT a re-labeling of the school total/completed counts. Falls
            # back to the school-level counts only when the success tree has no required_count-
            # bearing meeting condition at all (action_progress is None then), since in that case
            # "the school reaching the condition" IS the only unit of "action" that exists.
            if progress["action_progress"]:
                actions_needed = progress["action_progress"]["required"]
                actions_completed = progress["action_progress"]["completed"]
                progress_pct = progress["action_progress"]["pct"]
            else:
                actions_needed, actions_completed = total, completed
                progress_pct = progress["progress_pct"]
        elif not matched_ids:
            is_complete, actions_needed, actions_completed, progress_pct = False, 0, 0, 0.0
        else:
            # No done/not-done concept from compute_task_progress for track_success=False —
            # completion is instead about actual send outcomes: a school counts as "handled"
            # only via a confirmed 'sent' message (not 'outlook_pending', still unconfirmed) or a
            # skip the MANAGER deliberately chose (already_done / opted_out / their own
            # excluded_emails) — never a 'failed' send or a missing-contact/config problem, so a
            # real unresolved issue can never silently read as "task complete". A note's
            # skip_reason is only trusted if it's at least as recent as the school's latest
            # message attempt — org_task_school_notes is never cleared after a skip, so a STALE
            # skip_reason (e.g. the school was opted-out once, later reactivated, resent, and
            # THAT later attempt failed) must not keep masking a genuinely newer failure.
            # excluded_emails is different: it's a standing manager decision re-checked LIVE at
            # every future send attempt (_queue_messages_for_schools), not a one-time snapshot —
            # so it's trusted regardless of recency, same as it already behaves at send-time.
            msg_rows = (
                db.table("org_task_messages").select("school_id, status, created_at")
                .eq("task_id", task["id"]).order("created_at", desc=True).execute().data or []
            )
            latest_by_school = {}
            for m in msg_rows:
                latest_by_school.setdefault(m["school_id"], m)
            notes_map = {
                r["school_id"]: r for r in (
                    db.table("org_task_school_notes").select("school_id, skip_reason, excluded_emails, updated_at")
                    .eq("task_id", task["id"]).in_("school_id", matched_ids).execute().data or []
                )
            }
            completed = 0
            for school_id in matched_ids:
                latest = latest_by_school.get(school_id)
                note = notes_map.get(school_id) or {}
                note_is_current = not latest or not note.get("updated_at") or note["updated_at"] >= latest["created_at"]
                if (
                    (latest and latest.get("status") == "sent")
                    or (note_is_current and note.get("skip_reason") in _OK_SKIP_REASONS_FOR_COMPLETION)
                    or note.get("excluded_emails")
                ):
                    completed += 1
            is_complete = completed == total
            actions_needed, actions_completed = total, completed
            progress_pct = round((completed / total) * 100, 2) if total else 0.0

        current_status = task.get("status")
        new_status = current_status
        if is_complete and current_status != "archived":
            new_status = "archived"
        elif not is_complete and current_status == "archived":
            new_status = "active"

        patch = {
            "status": new_status,
            "cached_total_schools": total,
            "cached_actions_needed": actions_needed,
            "cached_actions_completed": actions_completed,
            "cached_progress_pct": progress_pct,
            "cache_updated_at": "now()",
        }
        db.table("org_tasks").update(patch).eq("id", task["id"]).execute()
        return patch
    except Exception as exc:
        _log.warning("recompute_task_status_and_cache failed (non-fatal) for task %s: %s", task.get("id"), exc)
        return None


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
