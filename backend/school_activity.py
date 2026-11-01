"""School-card activity log ("תיעוד פעולות" in the "פרטי בית הספר" tab) — who changed which
school field, from what to what, when and from which screen.

Every write path to the tab's data (`schools` columns, the tab's `school_year_admin_data`
fields, and the typed advisor lists) calls `log_school_activity` AFTER its own write
succeeded. Logging is strictly non-fatal: a failure only logs a warning and never affects
the write itself. Changes that go through an update request are shown from
`school_update_requests` (original_values + field_decisions); the resulting applied change is
still logged here with `request_id` set, so the read endpoint can fold it into the request.
"""
import logging

logger = logging.getLogger(__name__)

_CONTACT_ROLES = ("principal", "secretary", "finance_contact")
_CONTACT_SUFFIXES = ("name", "phone", "email", "day_off")

# `schools` columns shown in the "פרטי בית הספר" tab. `notes` has its own signed thread and
# the deprecated single `meeting_coordinator` mirror is derived — both deliberately excluded.
TRACKED_SCHOOL_FIELDS = (
    "name", "symbol", "city", "authority", "stage", "district", "address", "school_phone",
    "finance_software", "finance_software_other_text",
    "education_authority", "sector", "supervision", "grade_levels", "study_days", "student_count",
    *[f"{r}_{s}" for r in _CONTACT_ROLES for s in _CONTACT_SUFFIXES],
    *[f"{r}_chativa_{s}" for r in _CONTACT_ROLES for s in _CONTACT_SUFFIXES],
    "principal_same_person", "secretary_same_person", "finance_same_person",
    "extra_contacts", "meeting_coordinators", "gefen_files_responsible", "restrict_access_to",
)
TRACKED_SCHOOL_SELECT = "id, org_id, " + ", ".join(TRACKED_SCHOOL_FIELDS)

# Year-scoped (school_year_admin_data) fields shown in the tab's "פרטי ליווי" / advisors cards.
TRACKED_YEAR_FIELDS = (
    "client_status", "service_type", "order_amount_gefen", "order_method", "order_method_other_text",
    "meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
    "meeting_duration_gefen", "meeting_duration_current", "meeting_duration_district",
)

# Typed advisor lists (school_advisors_<type>) — logged as virtual list fields.
ADVISOR_FIELDS = ("advisors_gefen", "advisors_current", "advisors_district")

_NUMERIC_FIELDS = {
    "student_count", "order_amount_gefen",
    "meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
    "meeting_duration_gefen", "meeting_duration_current", "meeting_duration_district",
}
# Lists whose order carries no meaning.
_SET_FIELDS = {"restrict_access_to", "order_method", *ADVISOR_FIELDS}
_SAME_PERSON_FLAG = {"principal": "principal_same_person", "secretary": "secretary_same_person",
                     "finance_contact": "finance_same_person"}

# Screens allowed in the X-Client-Surface header (anything else is stored as None).
CLIENT_SURFACES = {
    "school_card", "add_school", "admin_modal", "admin_grid", "admin_bulk", "admin_undo",
    "import", "dashboard", "task_resolution", "collection",
}


def client_surface(value: str | None) -> str | None:
    return value if value in CLIENT_SURFACES else None


def _empty(value) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _norm(field: str, value):
    """Normalizes values so cosmetic differences (None vs "" vs [], "5" vs 5.0, list order of
    set-like fields, empty entries in slot maps) don't register as a change."""
    if isinstance(value, dict):
        value = {k: v for k, v in value.items() if not _empty(v)}
    if isinstance(value, list) and value and isinstance(value[0], dict):
        value = [{k: v for k, v in d.items() if not _empty(v)} for d in value]
        value = [d for d in value if d]
    if _empty(value):
        return None
    if field in _NUMERIC_FIELDS:
        try:
            return float(value)
        except (TypeError, ValueError):
            return value
    if field in _SET_FIELDS and isinstance(value, list):
        return sorted(str(v) for v in value)
    if field.endswith("_same_person"):
        return bool(value)
    return value


def diff_fields(before: dict | None, after: dict | None, fields) -> dict:
    """{field: {from, to}} for every field in `fields` that is present in `after` and differs."""
    before = before or {}
    changes = {}
    for f in fields:
        if after is None or f not in after:
            continue
        old, new = before.get(f), after.get(f)
        if _norm(f, old) != _norm(f, new):
            changes[f] = {"from": old, "to": new}
    return changes


def _drop_mirrored_chativa(changes: dict, after: dict) -> dict:
    """When a role's "same person" box is on, its חט"ב fields are an automatic copy of the main
    contact — showing them as separate changes would only duplicate rows."""
    for role, flag in _SAME_PERSON_FLAG.items():
        if (after or {}).get(flag):
            for s in _CONTACT_SUFFIXES:
                changes.pop(f"{role}_chativa_{s}", None)
    return changes


def build_event(*, school_id: str, org_id: str | None, actor_id: str | None, source: str | None,
                action: str, before: dict | None = None, after: dict | None = None,
                fields=None, academic_year: str | None = None, request_id: str | None = None,
                actor_type: str | None = None) -> dict | None:
    """Builds one school_activity row, or None when an "updated" event has no real change."""
    fields = fields or TRACKED_SCHOOL_FIELDS
    if action == "updated":
        if before is None:
            return None  # before-state read failed — every field would look "changed"
        changes = _drop_mirrored_chativa(diff_fields(before, after, fields), {**before, **(after or {})})
        if not changes:
            return None
    elif action == "created":
        changes = _drop_mirrored_chativa(diff_fields({}, after, fields), after or {})
    else:
        changes = {}  # deleted / restored
    return {
        "school_id": school_id,
        "org_id": org_id,
        "academic_year": academic_year,
        "actor_id": actor_id,
        "actor_type": actor_type or ("user" if actor_id else "system"),
        "source": source,
        "action": action,
        "changes": changes or None,
        "request_id": request_id,
    }


def fetch_school(db, school_id: str) -> dict | None:
    """Reads the tracked school columns (the "before" state). Non-fatal: None on failure."""
    try:
        rows = db.table("schools").select(TRACKED_SCHOOL_SELECT).eq("id", school_id).execute().data
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("school activity: before-state read failed for %s (non-fatal): %s", school_id, exc)
        return None


def fetch_schools(db, school_ids: list[str]) -> dict[str, dict]:
    if not school_ids:
        return {}
    try:
        rows = db.table("schools").select(TRACKED_SCHOOL_SELECT).in_("id", school_ids).execute().data or []
        return {r["id"]: r for r in rows}
    except Exception as exc:
        logger.warning("school activity: bulk before-state read failed (non-fatal): %s", exc)
        return {}


def fetch_typed_advisors(db, table: str, school_ids: list[str]) -> dict[str, list[str]] | None:
    """{school_id: [advisor_id, ...]} for one typed advisor table. None on failure."""
    if not school_ids:
        return {}
    try:
        rows = db.table(table).select("school_id, advisor_id").in_("school_id", school_ids).execute().data or []
        out: dict[str, list[str]] = {sid: [] for sid in school_ids}
        for r in rows:
            out.setdefault(r["school_id"], []).append(r["advisor_id"])
        return out
    except Exception as exc:
        logger.warning("school activity: typed advisors read failed (non-fatal): %s", exc)
        return None


def log_school_activity(db, **kwargs) -> None:
    """Records one activity event. Never raises."""
    try:
        event = build_event(**kwargs)
        if event:
            db.table("school_activity").insert(event).execute()
    except Exception as exc:
        logger.warning("school activity log failed for %s (non-fatal): %s", kwargs.get("school_id"), exc)


def log_school_activity_bulk(db, events: list[dict]) -> None:
    """Records many events (each a kwargs dict for build_event) in chunked inserts. Never raises."""
    try:
        rows = [e for e in (build_event(**kw) for kw in events) if e]
        for i in range(0, len(rows), 500):
            db.table("school_activity").insert(rows[i:i + 500]).execute()
    except Exception as exc:
        logger.warning("school activity bulk log failed (non-fatal): %s", exc)
