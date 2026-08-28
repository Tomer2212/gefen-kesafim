"""משימות על אנשי הארגון — parallel to the school-targeted Tasks feature (tasks_router.py),
but the audience is org staff (owner/manager/advisor) directly, or resolved automatically from
a school's typed advisor assignment (school_advisors_gefen/current/district). Kept in its own
router (not folded into tasks_router.py, which is already large and exclusively school-focused)
but reuses task_logic's condition engine and schools_router's helpers wherever possible instead
of duplicating them.

Data model (see CLAUDE.md's Supabase migration checklist — already run, verified):
- org_person_tasks: the task definition (name/description/due_date/urgency/success_metric).
- org_person_task_targets: one row per unit-of-completion — either a single directly-assigned
  user, or a school (whose 1-2 resolved advisors share that one completion row, per the
  explicit product decision that co-assigned advisors for the same school+division are a
  SHARED target, not independent copies — whoever completes it first completes it for both).
- person_task_pins: personal per-manager pin, identical shape to tasks_router.py's task_pins.
"""
import logging
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import task_logic
from academic_years import DEFAULT_ACADEMIC_YEAR
from auth import get_current_user
from routers import schools_router as _schools_router
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

CRON_SECRET = _schools_router.CRON_SECRET


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _can_assign_task_to(assigner_role: str, target_role: str) -> bool:
    """owner -> anyone; manager -> manager/advisor only (never owner); advisor can never assign."""
    if assigner_role == "owner":
        return True
    if assigner_role == "manager":
        return target_role in ("manager", "advisor")
    return False


def recompute_person_task_cache(db, task_id: str) -> None:
    """Single source of truth for the 2-state status (active <-> archived) and the cached
    progress columns list_person_tasks reads — same self-healing convention as tasks_router.py's
    recompute_task_status_and_cache. Non-fatal: never raises."""
    try:
        targets = db.table("org_person_task_targets").select("completed").eq("task_id", task_id).execute().data or []
        total = len(targets)
        completed = sum(1 for t in targets if t.get("completed"))
        pct = round(100 * completed / total, 2) if total else 0.0
        is_complete = total > 0 and completed == total

        task_rows = db.table("org_person_tasks").select("status").eq("id", task_id).execute().data or []
        current_status = task_rows[0]["status"] if task_rows else "active"
        new_status = current_status
        if is_complete and current_status != "archived":
            new_status = "archived"
        elif not is_complete and current_status == "archived":
            new_status = "active"

        db.table("org_person_tasks").update({
            "status": new_status,
            "cached_total_targets": total,
            "cached_completed": completed,
            "cached_progress_pct": pct,
            "cache_updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", task_id).execute()
    except Exception as exc:
        logger.warning("recompute_person_task_cache failed (non-fatal) for task %s: %s", task_id, exc)


def _enrich_profile_names(db, ids: set[str]) -> dict:
    if not ids:
        return {}
    rows = db.table("profiles").select("id, full_name, email").in_("id", list(ids)).execute().data or []
    return {r["id"]: (r.get("full_name") or r.get("email")) for r in rows}


# ---------------------------------------------------------------------------
# Shared school/advisor resolution — schools-mode only
# ---------------------------------------------------------------------------

# A school's OWN school_year_admin_data.service_type (not a single chosen "division" param)
# determines which typed-advisor table(s) apply — "gefen_current" means the task must reach
# BOTH the gefen advisor and the current advisor for that school (deduped into one shared
# completion target if it's the same person), per the explicit product decision.
_SERVICE_TYPE_TO_DIVISIONS = {
    "gefen": ["gefen"], "current": ["current"],
    "gefen_current": ["gefen", "current"], "district": ["district"],
}
_DIVISION_LABELS = {"gefen": "גפן", "current": "שוטף", "district": "מחוז"}


def _resolve_school_advisor_candidates(db, org_id: str, criteria: dict, academic_year: str):
    """Runs the audience filter (task_logic.find_matching_schools — same engine school-tasks'
    audience criteria already uses) and, for every matched school, batches the 3 typed-advisor-
    table lookups ONCE each (never per-school — Architecture Invariant #7) to build:
    divisions_by_school[school_id] -> which division(s) that school's service_type requires,
    candidates_by_school[school_id][division] -> the advisor_ids currently assigned there
    (0, 1, or 2+ — school_advisors_gefen/current/district is NOT 1:1)."""
    matched = task_logic.find_matching_schools(org_id, criteria, academic_year)
    matched_school_ids = [m["school_id"] for m in matched]
    if not matched_school_ids:
        return [], {}, {}, {}

    schools_rows = db.table("schools").select("id, name, symbol, authority, stage").in_("id", matched_school_ids).execute().data or []
    schools_map = {s["id"]: s for s in schools_rows}

    year_rows = (
        db.table("school_year_admin_data").select("school_id, service_type")
        .eq("academic_year", academic_year).in_("school_id", matched_school_ids).execute().data or []
    )
    service_type_map = {r["school_id"]: r.get("service_type") for r in year_rows}

    candidates_by_division: dict[str, dict[str, list[str]]] = {}
    for division, table in _schools_router._TYPED_ADVISOR_TABLES.items():
        rows = db.table(table).select("school_id, advisor_id").in_("school_id", matched_school_ids).execute().data or []
        by_school: dict[str, list[str]] = {}
        for r in rows:
            by_school.setdefault(r["school_id"], []).append(r["advisor_id"])
        candidates_by_division[division] = by_school

    divisions_by_school = {}
    candidates_by_school = {}
    for school_id in matched_school_ids:
        divisions = _SERVICE_TYPE_TO_DIVISIONS.get(service_type_map.get(school_id), [])
        divisions_by_school[school_id] = divisions
        candidates_by_school[school_id] = {
            div: candidates_by_division.get(div, {}).get(school_id, []) for div in divisions
        }

    return matched_school_ids, schools_map, divisions_by_school, candidates_by_school


# ---------------------------------------------------------------------------
# Pre-creation "בעיות" check — schools-mode only
# ---------------------------------------------------------------------------

class SchoolsCheckIn(BaseModel):
    criteria: dict  # {"groups": [...]} — same audience-criteria shape as school-tasks, expected
    # (though not server-enforced) to include a service_type condition, since that's what
    # determines routing per point above.
    academic_year: str | None = None


def _build_check_rows(db, org_id: str, criteria: dict, academic_year: str):
    """Shared by check_person_task_schools (live preview + pre-creation block) and
    _try_activate_scheduled_person_task (re-validation on activation) — one row per (school,
    required division), 'ok' rows carry the resolved advisor, others describe the problem.
    Also returns the raw resolution maps so callers that need to build target rows don't have
    to re-fetch them."""
    matched_school_ids, schools_map, divisions_by_school, candidates_by_school = (
        _resolve_school_advisor_candidates(db, org_id, criteria, academic_year)
    )
    advisor_ids = {aid for cands in candidates_by_school.values() for ids in cands.values() for aid in ids}
    names_map = _enrich_profile_names(db, advisor_ids)

    rows = []
    for school_id in matched_school_ids:
        school = schools_map.get(school_id, {})
        base = {"school_id": school_id, "school_name": school.get("name"), "symbol": school.get("symbol"), "authority": school.get("authority")}
        divisions = divisions_by_school.get(school_id, [])
        if not divisions:
            rows.append({**base, "division": None, "division_label": None, "kind": "no_service_type", "advisor_id": None, "advisor_name": None, "candidates": []})
            continue
        for division in divisions:
            ids = candidates_by_school[school_id].get(division, [])
            label = _DIVISION_LABELS[division]
            if len(ids) == 0:
                rows.append({**base, "division": division, "division_label": label, "kind": "missing", "advisor_id": None, "advisor_name": None, "candidates": []})
            elif len(ids) == 1:
                rows.append({**base, "division": division, "division_label": label, "kind": "ok", "advisor_id": ids[0], "advisor_name": names_map.get(ids[0], ids[0]), "candidates": []})
            else:
                rows.append({
                    **base, "division": division, "division_label": label, "kind": "multiple", "advisor_id": None, "advisor_name": None,
                    "candidates": [{"id": aid, "name": names_map.get(aid, aid)} for aid in ids],
                })

    return rows, matched_school_ids, schools_map, divisions_by_school, candidates_by_school


@router.post("/schools/check")
def check_person_task_schools(body: SchoolsCheckIn, user: Annotated[dict, Depends(get_current_user)]):
    """Live preview + pre-creation check for assignment_mode='schools' — one call doubles as the
    wizard's audience-preview table AND its blocking 'בעיות' pre-creation check (mirrors
    /tasks/meetings/check's blocking-problems pattern, TaskMeetingResolutionModal's precedent).
    `rows` has one entry per (school, required division): 'ok' rows already carry the resolved
    advisor for display; 'missing' (no advisor assigned at all — fix on the school card),
    'multiple' (2+ advisors — the creator must pick one or both), or 'no_service_type' (matched
    school with no service_type set at all — can't be routed anywhere) describe what's blocking."""
    _require_manager(user)
    db = get_admin_client()
    academic_year = body.academic_year or DEFAULT_ACADEMIC_YEAR
    rows, matched_school_ids, _schools_map, _divisions_by_school, _candidates_by_school = (
        _build_check_rows(db, user["org_id"], body.criteria, academic_year)
    )
    problem_school_ids = {r["school_id"] for r in rows if r["kind"] != "ok"}
    return {
        "rows": rows,
        "matched_school_ids": matched_school_ids,
        "total_schools": len(matched_school_ids),
        "ok_schools": len(matched_school_ids) - len(problem_school_ids),
    }


# ---------------------------------------------------------------------------
# Per-stage target splitting — structural, based on the school's OWN stage (schools.stage),
# never on which success-metric data happens to already exist. A six-year school
# (stage='sheshshnati') genuinely has two separate administrations (תיכון + חטיבת ביניים) — the
# work a person-task represents needs doing once per stage regardless of success-metric kind
# (checkbox/number/field alike), so it must ALWAYS split into 2 independently-tracked targets,
# never conditionally on whether goal/control_letter data happens to exist yet for both. The
# earlier data-driven heuristic (split only when school_goals/control_letters rows existed for
# 2+ divisions) was wrong exactly because of this: a six-year school missing data for one stage
# silently collapsed to a single target and could show 100% complete after only ONE stage's
# work was actually done — a real false-positive a manager would rightly get called out for.
# ---------------------------------------------------------------------------

_STAGE_TO_DIVISIONS = {
    "sheshshnati": ["tikkon", "beinayim"],
    "tikkon": ["tikkon"],
    "beinayim": ["beinayim"],
    "yesodi": ["yesodi"],
    "other": ["other"],
}


def _divisions_for_school_stage(stage: str | None) -> list[str]:
    return _STAGE_TO_DIVISIONS.get(stage, ["other"])


def _build_school_targets(db, task_id: str, org_id: str, matched_school_ids: list[str], schools_map: dict,
                           divisions_by_school: dict, candidates_by_school: dict,
                           resolved_school_assignees: dict) -> list[dict]:
    """Builds org_person_task_targets rows for assignment_mode='schools' — one row per school,
    UNLESS the school is six-year (stage='sheshshnati'), in which case it splits into one target
    per stage (תיכון + חטיבת ביניים), each with the same resolved advisor assignee_ids (advisor
    routing is by service_type, an orthogonal axis to the school's internal stage), but
    tracked/completed independently — mirrors the meeting-task's 'שתי פגישות נפרדות' stage
    split, except here it's automatic (not a creator choice) since the underlying work always
    needs doing once per stage."""
    resolved = resolved_school_assignees or {}
    targets = []
    for school_id in matched_school_ids:
        assignee_ids: set[str] = set()
        for division in divisions_by_school.get(school_id, []):
            ids = candidates_by_school[school_id].get(division, [])
            if len(ids) == 1:
                assignee_ids.add(ids[0])
            elif len(ids) > 1:
                assignee_ids.update(resolved.get(f"{school_id}:{division}") or [])
            # len == 0 (missing) contributes nothing — defensive, /schools/check should have
            # blocked creation/activation until fixed.
        if not assignee_ids:
            continue

        stage = (schools_map.get(school_id) or {}).get("stage")
        for dt in _divisions_for_school_stage(stage):
            targets.append({"task_id": task_id, "school_id": school_id, "assignee_ids": sorted(assignee_ids), "target_division_type": dt})

    return targets


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

class PersonTaskCreateIn(BaseModel):
    name: str
    description: str | None = None
    due_date: str | None = None  # "YYYY-MM-DD"
    urgency: int = 1  # 1-4
    assignment_mode: str  # 'users' | 'schools'
    target_user_ids: list[str] | None = None
    target_criteria: dict | None = None  # schools mode: the audience-filter tree (must resolve
    # via schools' own service_type — see _resolve_school_advisor_candidates)
    academic_year: str | None = None
    success_metric: dict  # {"kind": "field"|"checkbox"|"number"|"file", ...}
    # "{school_id}:{division}" -> chosen assignee_ids, filled in by the creator when
    # /schools/check reported a 'multiple' problem for that specific (school, division) pair —
    # every other division for that school still auto-resolves from its single advisor.
    resolved_school_assignees: dict[str, list[str]] | None = None
    scheduled_for: str | None = None  # ISO datetime; future date -> created as 'scheduled'
    # (same principle as tasks_router.TaskCreateIn.scheduled_for)


@router.post("/")
def create_person_task(body: PersonTaskCreateIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()

    if body.assignment_mode not in ("users", "schools"):
        raise HTTPException(status_code=400, detail="מצב הטלה לא תקין")
    if body.assignment_mode == "users" and body.success_metric.get("kind") == "field":
        # Field-based metrics evaluate against a SCHOOL's data (task_logic.evaluate_tree) — there
        # is no school context for a directly-assigned user, so this combination is meaningless.
        raise HTTPException(status_code=400, detail="מדד הצלחה מבוסס שדה קיים אפשרי רק במשימה המבוססת על בתי ספר")

    academic_year = body.academic_year or DEFAULT_ACADEMIC_YEAR
    scheduled_for_dt = _parse_dt(body.scheduled_for)
    is_future_scheduled = bool(scheduled_for_dt and scheduled_for_dt > datetime.now(timezone.utc))

    matched_school_ids: list[str] = []
    divisions_by_school: dict[str, list[str]] = {}
    candidates_by_school: dict[str, dict[str, list[str]]] = {}

    if body.assignment_mode == "users":
        if not body.target_user_ids:
            raise HTTPException(status_code=400, detail="יש לבחור לפחות משתמש אחד")
        target_profiles = (
            db.table("profiles").select("id, role").in_("id", body.target_user_ids)
            .eq("org_id", user["org_id"]).execute().data or []
        )
        if len(target_profiles) != len(set(body.target_user_ids)):
            raise HTTPException(status_code=400, detail="אחד או יותר מהמשתמשים שנבחרו אינם תקינים")
        for p in target_profiles:
            if not _can_assign_task_to(user["role"], p["role"]):
                raise HTTPException(status_code=403, detail="אין הרשאה להטיל משימה על אחד מהמשתמשים שנבחרו")
    else:
        if not body.target_criteria:
            raise HTTPException(status_code=400, detail="יש להגדיר סינון בתי ספר")
        if not is_future_scheduled:
            # A scheduled task defers ALL matching/routing to activation time (same principle as
            # tasks_router.create_task) — no point resolving advisors against data that will be
            # stale by the time it actually matters.
            matched_school_ids, schools_map, divisions_by_school, candidates_by_school = (
                _resolve_school_advisor_candidates(db, user["org_id"], body.target_criteria, academic_year)
            )
            if not matched_school_ids:
                raise HTTPException(status_code=400, detail="לא נמצאו בתי ספר התואמים לסינון")

    task_row = db.table("org_person_tasks").insert({
        "org_id": user["org_id"], "created_by": user["id"], "name": body.name,
        "description": body.description, "due_date": body.due_date, "urgency": body.urgency,
        "status": "scheduled" if is_future_scheduled else "active", "assignment_mode": body.assignment_mode,
        "target_user_ids": body.target_user_ids,
        "target_school_ids": matched_school_ids if (body.assignment_mode == "schools" and not is_future_scheduled) else None,
        "target_criteria": body.target_criteria if body.assignment_mode == "schools" else None,
        "academic_year": academic_year,
        "success_metric": body.success_metric,
        "scheduled_for": scheduled_for_dt.isoformat() if is_future_scheduled else None,
    }).execute().data[0]
    task_id = task_row["id"]

    if is_future_scheduled:
        # Targets/notifications are created later, at activation — see
        # _try_activate_scheduled_person_task (mirrors tasks_router's process-scheduled-tasks).
        return task_row

    targets = []
    if body.assignment_mode == "users":
        for uid in body.target_user_ids:
            targets.append({"task_id": task_id, "school_id": None, "assignee_ids": [uid], "target_division_type": None})
    else:
        targets = _build_school_targets(
            db, task_id, user["org_id"], matched_school_ids, schools_map, divisions_by_school, candidates_by_school,
            body.resolved_school_assignees,
        )

    if targets:
        db.table("org_person_task_targets").insert(targets).execute()

    all_assignee_ids = {aid for t in targets for aid in t["assignee_ids"]}
    try:
        _schools_router._create_notifications(db, [
            {
                "recipient_id": uid, "type": "person_task_assigned",
                "data": {
                    "title": f'הוטלה עליך משימה חדשה: "{body.name}"',
                    "task_id": task_id, "task_name": body.name,
                    "due_date": body.due_date, "urgency": body.urgency,
                },
            }
            for uid in all_assignee_ids
        ], pref_key="notify_task_assigned")
    except Exception as exc:
        logger.warning("create_person_task: notification failed (non-fatal): %s", exc)

    recompute_person_task_cache(db, task_id)
    fresh = db.table("org_person_tasks").select("*").eq("id", task_id).execute().data[0]
    return fresh


def _parse_dt(value: str | None):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _try_activate_scheduled_person_task(db, task: dict) -> dict:
    """Re-validates and activates a single 'scheduled' person-task whose scheduled_for has
    arrived — mirrors tasks_router._try_activate_scheduled_task's principle exactly: routing is
    re-checked against CURRENT data (not a stale creation-time snapshot), and if any matched
    school currently has a routing problem, activation is held back entirely (status stays
    'scheduled') with a single notification to the creator on the false->true transition of
    has_routing_problems (avoids re-notifying every cron tick)."""
    org_id = task["org_id"]
    academic_year = task.get("academic_year") or DEFAULT_ACADEMIC_YEAR
    rows, matched_school_ids, schools_map, divisions_by_school, candidates_by_school = (
        _build_check_rows(db, org_id, task.get("target_criteria") or {}, academic_year)
    )
    has_problems = any(r["kind"] != "ok" for r in rows)

    if has_problems:
        if not task.get("has_routing_problems"):
            db.table("org_person_tasks").update({"has_routing_problems": True}).eq("id", task["id"]).execute()
            try:
                _schools_router._create_notifications(db, [{
                    "recipient_id": task["created_by"], "type": "person_task_routing_problem",
                    "data": {"title": f'למשימה המתוזמנת "{task.get("name")}" יש בעיית ניתוב שדורשת טיפול', "task_id": task["id"], "task_name": task.get("name")},
                }], pref_key="notify_task_assigned")
            except Exception as exc:
                logger.warning("_try_activate_scheduled_person_task: notification failed (non-fatal) for task %s: %s", task["id"], exc)
        return {"activated": False, "has_problems": True}

    if task.get("has_routing_problems"):
        db.table("org_person_tasks").update({"has_routing_problems": False}).eq("id", task["id"]).execute()

    targets = _build_school_targets(
        db, task["id"], org_id, matched_school_ids, schools_map, divisions_by_school, candidates_by_school, None,
    )
    if targets:
        db.table("org_person_task_targets").insert(targets).execute()

    all_assignee_ids = {aid for t in targets for aid in t["assignee_ids"]}
    try:
        _schools_router._create_notifications(db, [
            {
                "recipient_id": uid, "type": "person_task_assigned",
                "data": {
                    "title": f'הוטלה עליך משימה חדשה: "{task.get("name")}"',
                    "task_id": task["id"], "task_name": task.get("name"),
                    "due_date": task.get("due_date"), "urgency": task.get("urgency"),
                },
            }
            for uid in all_assignee_ids
        ], pref_key="notify_task_assigned")
    except Exception as exc:
        logger.warning("_try_activate_scheduled_person_task: assignment notification failed (non-fatal): %s", exc)

    db.table("org_person_tasks").update({
        "status": "active", "target_school_ids": matched_school_ids,
    }).eq("id", task["id"]).execute()
    recompute_person_task_cache(db, task["id"])
    return {"activated": True, "has_problems": False}


# ---------------------------------------------------------------------------
# List / detail / edit / delete
# ---------------------------------------------------------------------------

@router.get("/")
def list_person_tasks(
    user: Annotated[dict, Depends(get_current_user)],
    status: str | None = None,
    assignment_mode: str | None = None,
    created_by: str | None = None,
    academic_year: str | None = None,
):
    """Admin table (ניהול -> משימות -> אנשי הארגון). Unlike tasks_router.list_tasks, this DOES
    run a live recompute loop first (see _recompute_field_person_tasks) — person-tasks have no
    "send" action to piggyback a trigger on, so without this every load would show whatever the
    30-minute cron last computed (up to 30 minutes stale, or never in local dev where the cron
    doesn't run). Non-fatal: a failure here must never block the table from loading."""
    _require_manager(user)
    try:
        _recompute_field_person_tasks(get_admin_client(), user["org_id"])
    except Exception as exc:
        logger.warning("list_person_tasks: live recompute failed (non-fatal): %s", exc)

    for attempt in range(2):
        try:
            db = get_admin_client()
            query = db.table("org_person_tasks").select("*").eq("org_id", user["org_id"])
            if status:
                query = query.eq("status", status)
            if assignment_mode:
                query = query.eq("assignment_mode", assignment_mode)
            if created_by:
                query = query.eq("created_by", created_by)
            if academic_year:
                query = query.eq("academic_year", academic_year)
            rows = query.order("created_at", desc=True).execute().data or []
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_person_tasks attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
            else:
                logger.error("list_person_tasks failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    try:
        db = get_admin_client()
        creator_ids = {r["created_by"] for r in rows if r.get("created_by")}
        names_map = _enrich_profile_names(db, creator_ids)
        for r in rows:
            r["created_by_name"] = names_map.get(r.get("created_by"))
    except Exception as exc:
        logger.warning("list_person_tasks creator-name enrichment failed (non-fatal): %s", exc)

    try:
        db = get_admin_client()
        task_ids = [r["id"] for r in rows]
        assignee_ids_by_task: dict[str, set] = {}
        if task_ids:
            target_rows = db.table("org_person_task_targets").select("task_id, assignee_ids").in_("task_id", task_ids).execute().data or []
            for t in target_rows:
                assignee_ids_by_task.setdefault(t["task_id"], set()).update(t.get("assignee_ids") or [])
        all_assignee_ids = {aid for ids in assignee_ids_by_task.values() for aid in ids}
        assignee_names_map = _enrich_profile_names(db, all_assignee_ids)
        for r in rows:
            r["assignee_names"] = sorted({assignee_names_map.get(aid, aid) for aid in assignee_ids_by_task.get(r["id"], set())})
    except Exception as exc:
        logger.warning("list_person_tasks assignee-name enrichment failed (non-fatal): %s", exc)

    try:
        db = get_admin_client()
        task_ids = [r["id"] for r in rows]
        pins_map = {}
        if task_ids:
            pin_rows = (
                db.table("person_task_pins").select("task_id, pinned_at")
                .eq("user_id", user["id"]).in_("task_id", task_ids).execute().data or []
            )
            pins_map = {p["task_id"]: p["pinned_at"] for p in pin_rows}
        for r in rows:
            r["pinned_at"] = pins_map.get(r["id"])
    except Exception as exc:
        logger.warning("list_person_tasks pin enrichment failed (non-fatal): %s", exc)

    return rows


@router.get("/mine")
def list_my_person_tasks(user: Annotated[dict, Depends(get_current_user)]):
    """אזור אישי — same rows/shape as list_person_tasks, filtered to tasks where the current
    user is an assignee on at least one target. No _require_manager — every role (including
    advisor) can see their own assigned tasks.

    status/cached_completed/cached_total_targets/cached_progress_pct are OVERWRITTEN here with
    this user's own personal numbers (personal_status/personal_completed/personal_total_targets/
    personal_progress_pct — also kept under their own names in case a caller wants the org-wide
    figure too) — explicit product decision: אזור אישי must let a user tell at a glance whether
    THEY are done, not whether the whole org-wide task is done. A task can show "פעילה"
    org-wide (other assignees still have open targets) while this user's own slice is 100%
    complete, and vice versa — the org-wide cached_* columns would be actively misleading here."""
    db = get_admin_client()
    rows = db.table("org_person_tasks").select("*").eq("org_id", user["org_id"]).execute().data or []
    if not rows:
        return []
    task_ids = [r["id"] for r in rows]
    targets = db.table("org_person_task_targets").select("task_id, assignee_ids, completed").in_("task_id", task_ids).execute().data or []

    my_targets_by_task: dict[str, list[dict]] = {}
    for t in targets:
        if user["id"] in (t.get("assignee_ids") or []):
            my_targets_by_task.setdefault(t["task_id"], []).append(t)

    mine = [r for r in rows if r["id"] in my_targets_by_task]
    for r in mine:
        my_targets = my_targets_by_task[r["id"]]
        total = len(my_targets)
        completed = sum(1 for t in my_targets if t.get("completed"))
        pct = round(100 * completed / total, 2) if total else 0.0
        r["personal_total_targets"] = total
        r["personal_completed"] = completed
        r["personal_progress_pct"] = pct
        r["personal_status"] = "archived" if total > 0 and completed == total else "active"
        r["status"] = r["personal_status"]
        r["cached_completed"] = r["personal_completed"]
        r["cached_total_targets"] = r["personal_total_targets"]
        r["cached_progress_pct"] = r["personal_progress_pct"]

    try:
        db2 = get_admin_client()
        creator_ids = {r["created_by"] for r in mine if r.get("created_by")}
        names_map = _enrich_profile_names(db2, creator_ids)
        for r in mine:
            r["created_by_name"] = names_map.get(r.get("created_by"))
    except Exception as exc:
        logger.warning("list_my_person_tasks creator-name enrichment failed (non-fatal): %s", exc)

    try:
        db3 = get_admin_client()
        task_ids2 = [r["id"] for r in mine]
        override_rows = (
            db3.table("person_task_name_overrides").select("task_id, custom_name")
            .eq("user_id", user["id"]).in_("task_id", task_ids2).execute().data or []
        )
        overrides_map = {o["task_id"]: o["custom_name"] for o in override_rows}
        for r in mine:
            r["display_name"] = overrides_map.get(r["id"], r["name"])
            r["has_name_override"] = r["id"] in overrides_map
    except Exception as exc:
        logger.warning("list_my_person_tasks name-override enrichment failed (non-fatal): %s", exc)
        for r in mine:
            r["display_name"] = r["name"]
            r["has_name_override"] = False

    return mine


@router.get("/active-for-schools")
def active_person_tasks_for_schools(school_ids: str, user: Annotated[dict, Depends(get_current_user)]):
    """Sidebar.jsx's meeting-reminder poller — 'you also have an active task here' toast, fired
    alongside the existing meeting reminder (never on its own schedule). Returns
    {school_id: [task_name, ...]}, one entry per school where the CURRENT user has at least one
    NOT-YET-COMPLETED target on an ACTIVE person-task — schools with none are simply absent from
    the response (not an empty list), so the caller's `if (taskNames?.length)` check works
    unchanged. No _require_manager: any org member (including advisors) can check their own
    tasks. Two bounded queries, never a per-school loop (Architecture Invariant #7) — verified
    live that assignee_ids' .contains() filter matches correctly."""
    ids = [s for s in school_ids.split(",") if s]
    if not ids:
        return {}
    db = get_admin_client()
    targets = (
        db.table("org_person_task_targets").select("task_id, school_id")
        .in_("school_id", ids).contains("assignee_ids", [user["id"]]).eq("completed", False)
        .execute().data or []
    )
    if not targets:
        return {}
    task_ids = list({t["task_id"] for t in targets})
    active_tasks = (
        db.table("org_person_tasks").select("id, name").in_("id", task_ids).eq("status", "active")
        .execute().data or []
    )
    active_names = {t["id"]: t["name"] for t in active_tasks}

    result: dict[str, list[str]] = {}
    for t in targets:
        name = active_names.get(t["task_id"])
        if name:
            result.setdefault(t["school_id"], []).append(name)
    return result


@router.get("/for-school/{school_id}")
def list_person_tasks_for_school(school_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """כרטיס בית ספר -> טאב 'משימות' — tasks (assignment_mode='schools') whose target_school_ids
    includes this school. No _require_manager: any org member who can already view the school
    card (access to school_id is checked at the school-fetch level elsewhere, same trust
    boundary this endpoint relies on) can see this. Each returned target row also gets an
    'אחראי לביצוע' name — the school can have its own advisor distinct from other schools on
    the same multi-school task, so this must be resolved per-school, not task-wide."""
    db = get_admin_client()
    rows = (
        db.table("org_person_tasks").select("*")
        .eq("org_id", user["org_id"]).eq("assignment_mode", "schools")
        .execute().data or []
    )
    rows = [r for r in rows if school_id in (r.get("target_school_ids") or [])]
    if not rows:
        return []

    task_ids = [r["id"] for r in rows]
    targets = (
        db.table("org_person_task_targets").select("*")
        .in_("task_id", task_ids).eq("school_id", school_id).execute().data or []
    )
    # A task can now have MORE THAN ONE target row for this school (goal/control_letter success
    # metrics split per division — see _build_school_targets), so group rather than assume 1:1.
    targets_by_task: dict[str, list[dict]] = {}
    for t in targets:
        targets_by_task.setdefault(t["task_id"], []).append(t)

    assignee_ids = {aid for t in targets for aid in (t.get("assignee_ids") or [])}
    creator_ids = {r["created_by"] for r in rows if r.get("created_by")}
    names_map = _enrich_profile_names(db, assignee_ids | creator_ids)

    for r in rows:
        r["created_by_name"] = names_map.get(r.get("created_by"))
        task_targets = targets_by_task.get(r["id"], [])
        # `school_targets`: one entry per division-split target (or a single entry when not
        # split) — the detailed shape the frontend should render. `responsible_names`/
        # `school_target_completed`/`school_target_id` are kept as best-effort aggregates
        # (union of names, AND of completed, first id) for any caller still using the old shape.
        r["school_targets"] = [
            {
                "id": t["id"], "target_division_type": t.get("target_division_type"),
                "completed": bool(t.get("completed")),
                "responsible_names": [names_map.get(aid, aid) for aid in (t.get("assignee_ids") or [])],
            }
            for t in task_targets
        ]
        r["responsible_names"] = sorted({n for t in r["school_targets"] for n in t["responsible_names"]})
        r["school_target_completed"] = bool(task_targets) and all(t.get("completed") for t in task_targets)
        r["school_target_id"] = task_targets[0]["id"] if task_targets else None

    return rows


def _get_person_task_or_404(db, task_id: str, org_id: str) -> dict:
    rows = db.table("org_person_tasks").select("*").eq("id", task_id).eq("org_id", org_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="משימה לא נמצאה")
    return rows[0]


@router.get("/{task_id}")
def get_person_task(task_id: str, user: Annotated[dict, Depends(get_current_user)], mine_only: bool = False):
    # Standard 2-attempt retry (Architecture Invariant #5) — was previously missing here, unlike
    # every list_* endpoint in this file: a single transient connection hiccup (more likely now
    # that list_person_tasks/polling put more concurrent load on the shared httpx client, see
    # _recompute_field_person_tasks) went straight to the global 503 handler with no self-heal
    # attempt, instead of quietly retrying on a fresh client like everywhere else does.
    for attempt in range(2):
        try:
            db = get_admin_client()
            task_rows = db.table("org_person_tasks").select("*").eq("id", task_id).eq("org_id", user["org_id"]).execute().data
            if not task_rows:
                raise HTTPException(status_code=404, detail="משימה לא נמצאה")
            # Field-kind metrics are re-evaluated right here too (not just inside the 30-minute
            # cron / list_person_tasks' org-wide sweep) — an inline goal/control_letter/field
            # edit made from THIS task's own "מדד הצלחה" column must be reflected the instant the
            # user reloads this one task, not only after the next full-table load.
            try:
                _recompute_single_person_task(db, task_rows[0])
            except Exception as exc:
                logger.warning("get_person_task: single-task recompute failed (non-fatal) for %s: %s", task_id, exc)
            # Self-heal (refreshes the cached summary columns from current target rows, same
            # "recompute on every open" pattern as tasks_router.get_task).
            recompute_person_task_cache(db, task_id)
            task = db.table("org_person_tasks").select("*").eq("id", task_id).execute().data[0]
            # Ordered by school_id first (then division, then created_at as a final tie-break) —
            # NOT just created_at — so a six-year school's two split targets (see
            # _build_school_targets) always land as adjacent rows, regardless of insert-order
            # quirks (a single bulk insert() can give every row in the batch the identical
            # created_at, in which case tie-break order isn't guaranteed to match insertion
            # order at all).
            targets = (
                db.table("org_person_task_targets").select("*").eq("task_id", task_id)
                .order("school_id").order("target_division_type").order("created_at").execute().data or []
            )
            # אזור אישי — enforced server-side, not just hidden in the UI: a task can span many
            # people's schools well beyond the one asking, and the frontend filter alone would
            # still leak the full payload to anyone inspecting the network response.
            if mine_only:
                targets = [t for t in targets if user["id"] in (t.get("assignee_ids") or [])]
                # Same overwrite list_my_person_tasks does — without this, expanding the row
                # after the list already showed personal numbers would silently snap back to
                # the org-wide status/cached_* the instant this response merges into local
                # state (PersonalTasksSection.jsx's patchTaskLocally), which is exactly the bug
                # that was reported: right numbers on load, wrong numbers after one click.
                total = len(targets)
                completed = sum(1 for t in targets if t.get("completed"))
                pct = round(100 * completed / total, 2) if total else 0.0
                task["personal_total_targets"] = total
                task["personal_completed"] = completed
                task["personal_progress_pct"] = pct
                task["personal_status"] = "archived" if total > 0 and completed == total else "active"
                task["status"] = task["personal_status"]
                task["cached_completed"] = task["personal_completed"]
                task["cached_total_targets"] = task["personal_total_targets"]
                task["cached_progress_pct"] = task["personal_progress_pct"]
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_person_task attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
            else:
                logger.error("get_person_task failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    try:
        db = get_admin_client()
        assignee_ids = {aid for t in targets for aid in (t.get("assignee_ids") or [])}
        completed_by_ids = {t["completed_by"] for t in targets if t.get("completed_by")}
        names_map = _enrich_profile_names(db, assignee_ids | completed_by_ids)

        school_ids = [t["school_id"] for t in targets if t.get("school_id")]
        schools_map = {}
        ya_map = {}
        if school_ids:
            s_rows = db.table("schools").select("id, name, symbol, authority, city, district, stage").in_("id", school_ids).execute().data or []
            schools_map = {s["id"]: s for s in s_rows}
            # Year-scoped fields (client_status / service_type) for the per-assignee school
            # table's "סינון מתקדם" — same academic year the task itself targets.
            ay = task.get("academic_year") or DEFAULT_ACADEMIC_YEAR
            ya_rows = (
                db.table("school_year_admin_data").select("school_id, client_status, service_type")
                .eq("academic_year", ay).in_("school_id", school_ids).execute().data or []
            )
            ya_map = {r["school_id"]: r for r in ya_rows}

        for t in targets:
            t["assignee_names"] = [names_map.get(aid, aid) for aid in (t.get("assignee_ids") or [])]
            t["completed_by_name"] = names_map.get(t.get("completed_by")) if t.get("completed_by") else None
            if t.get("school_id"):
                sc = schools_map.get(t["school_id"], {})
                ya = ya_map.get(t["school_id"], {})
                t["school_name"] = sc.get("name")
                t["symbol"] = sc.get("symbol")
                t["authority"] = sc.get("authority")
                t["city"] = sc.get("city")
                t["district"] = sc.get("district")
                t["school_stage"] = sc.get("stage")
                t["client_status"] = ya.get("client_status")
                t["service_type"] = ya.get("service_type")
    except Exception as exc:
        logger.warning("get_person_task: name/school enrichment failed (non-fatal): %s", exc)

    return {**task, "targets": targets}


class PersonTaskPatchIn(BaseModel):
    name: str | None = None
    description: str | None = None
    due_date: str | None = None
    urgency: int | None = None


_URGENCY_LABELS_HE = {1: "נמוכה", 2: "בינונית", 3: "גבוהה", 4: "דחופה"}
_PATCH_FIELD_LABELS_HE = {"name": "שם המשימה", "description": "תיאור", "due_date": "תאריך יעד", "urgency": "רמת דחיפות"}


def _describe_patch_changes(old: dict, patch: dict) -> str:
    """Human-readable Hebrew summary of what an edit actually changed — sent verbatim to
    assignees' notifications (see patch_person_task) so a bare 'המשימה עודכנה' ping isn't the
    only information they get; they need to know WHAT changed without opening the task first."""
    parts = []
    for key, new_val in patch.items():
        old_val = old.get(key)
        if old_val == new_val:
            continue
        label = _PATCH_FIELD_LABELS_HE.get(key, key)
        if key == "urgency":
            old_disp = _URGENCY_LABELS_HE.get(old_val, old_val)
            new_disp = _URGENCY_LABELS_HE.get(new_val, new_val)
            parts.append(f'{label} שונתה מ-"{old_disp}" ל-"{new_disp}"')
        elif key == "description":
            parts.append(f"{label} עודכן")
        else:
            parts.append(f'{label} עודכן ל-"{new_val}"')
    return "; ".join(parts)


@router.patch("/{task_id}")
def patch_person_task(task_id: str, body: PersonTaskPatchIn, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    task = _get_person_task_or_404(db, task_id, user["org_id"])
    # Editing is creator-only (not just any manager/owner) — explicit product decision, since an
    # owner overriding someone else's task via this path would be surprising and unannounced to
    # the actual creator.
    if user["id"] != task.get("created_by"):
        raise HTTPException(status_code=403, detail="רק יוצר המשימה יכול לערוך אותה")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return task

    changes_text = _describe_patch_changes(task, patch)
    row = db.table("org_person_tasks").update(patch).eq("id", task_id).eq("org_id", user["org_id"]).execute()
    updated = row.data[0]

    if changes_text:
        try:
            target_rows = db.table("org_person_task_targets").select("assignee_ids").eq("task_id", task_id).execute().data or []
            assignee_ids = {aid for t in target_rows for aid in (t.get("assignee_ids") or []) if aid != user["id"]}
            if assignee_ids:
                editor_name = user.get("full_name") or "יוצר המשימה"
                _schools_router._create_notifications(db, [
                    {
                        "recipient_id": uid, "type": "person_task_updated",
                        "data": {
                            # The change summary is embedded directly in the title (not a
                            # separate expandable body) so it's visible in the notification list
                            # itself, before any click — a bare "המשימה עודכנה" ping gives the
                            # assignee no way to know what actually changed without opening it.
                            "title": f'המשימה "{updated.get("name")}" עודכנה על ידי {editor_name}: {changes_text}',
                            "task_id": task_id, "task_name": updated.get("name"), "changes": changes_text,
                        },
                    }
                    for uid in assignee_ids
                ], pref_key="notify_task_assigned")
        except Exception as exc:
            logger.warning("patch_person_task: update notification failed (non-fatal): %s", exc)

    return updated


@router.delete("/{task_id}")
def delete_person_task(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    task = _get_person_task_or_404(db, task_id, user["org_id"])
    # Creator-or-owner only (not "any manager") — explicit product decision, same reasoning as
    # patch_person_task's edit restriction: an owner can do anything, but a manager who didn't
    # create this task shouldn't be able to delete someone else's without them knowing.
    if user["role"] != "owner" and user["id"] != task.get("created_by"):
        raise HTTPException(status_code=403, detail="רק יוצר המשימה או בעלים יכולים למחוק אותה")
    db.table("org_person_tasks").delete().eq("id", task_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}


@router.post("/{task_id}/pin")
def pin_person_task(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    _get_person_task_or_404(db, task_id, user["org_id"])
    db.table("person_task_pins").upsert({"task_id": task_id, "user_id": user["id"]}, on_conflict="task_id,user_id").execute()
    return {"ok": True}


@router.delete("/{task_id}/pin")
def unpin_person_task(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    db.table("person_task_pins").delete().eq("task_id", task_id).eq("user_id", user["id"]).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Personal display-name override (אזור אישי only) — a purely cosmetic per-user nickname, never
# touches org_person_tasks.name (what the creator set, what every other assignee/admin sees).
# Deliberately NOT creator-gated like patch_person_task — any assignee (or anyone, really; this
# has zero effect on anyone else) can rename how the task appears in their OWN personal view.
# ---------------------------------------------------------------------------

class PersonTaskNameOverrideIn(BaseModel):
    name: str


@router.put("/{task_id}/my-name")
def set_my_person_task_name(task_id: str, body: PersonTaskNameOverrideIn, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    _get_person_task_or_404(db, task_id, user["org_id"])
    trimmed = body.name.strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="שם לא יכול להיות ריק")
    db.table("person_task_name_overrides").upsert(
        {"task_id": task_id, "user_id": user["id"], "custom_name": trimmed, "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="task_id,user_id",
    ).execute()
    return {"ok": True, "display_name": trimmed}


@router.delete("/{task_id}/my-name")
def clear_my_person_task_name(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    db.table("person_task_name_overrides").delete().eq("task_id", task_id).eq("user_id", user["id"]).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Completion (assignee-side action for ad-hoc checkbox/number/file metrics — field-based
# metrics are never completed this way, only by the recompute-all cron detecting the live
# field value)
# ---------------------------------------------------------------------------

class TargetCompleteIn(BaseModel):
    metric_value: dict | None = None  # {"checked": true} | {"value": 12} | {"file_key": "..."}


@router.post("/{task_id}/targets/{target_id}/complete")
def complete_person_task_target(
    task_id: str, target_id: str, body: TargetCompleteIn, user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    rows = db.table("org_person_task_targets").select("*").eq("id", target_id).eq("task_id", task_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לסמן משימה זו כהושלמה")

    update = {
        "completed": True, "completed_by": user["id"],
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    # Only overwrite metric_value if the caller actually sent one — "שליחה" on a number/file kind
    # that already has a draft value/uploaded file saved (see the draft/upload endpoints below)
    # must preserve it, not wipe it back to null just because the final submit call omits it.
    if "metric_value" in body.model_fields_set:
        update["metric_value"] = body.metric_value
    db.table("org_person_task_targets").update(update).eq("id", target_id).execute()
    recompute_person_task_cache(db, task_id)
    return {"ok": True}


class TargetDraftIn(BaseModel):
    metric_value: dict


@router.patch("/{task_id}/targets/{target_id}/draft")
def draft_person_task_target(
    task_id: str, target_id: str, body: TargetDraftIn, user: Annotated[dict, Depends(get_current_user)],
):
    """Number-kind 'שמירה זמנית' — saves a value on the target WITHOUT completing it, so a user
    can save partial work and come back later. Only 'שליחה' (complete_person_task_target) marks
    the target done."""
    db = get_admin_client()
    rows = db.table("org_person_task_targets").select("assignee_ids, completed").eq("id", target_id).eq("task_id", task_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לעדכן יעד זה")
    if target.get("completed"):
        raise HTTPException(status_code=400, detail="היעד כבר הושלם")
    db.table("org_person_task_targets").update({"metric_value": body.metric_value}).eq("id", target_id).execute()
    return {"ok": True}


@router.post("/{task_id}/targets/{target_id}/upload")
async def upload_person_task_target_file(
    task_id: str, target_id: str, user: Annotated[dict, Depends(get_current_user)], file: UploadFile = File(...),
):
    """File-kind '+' — uploads a file onto the target WITHOUT completing it (mirrors the
    draft/number split above); only 'שליחה' (complete_person_task_target, called with no
    metric_value so the just-uploaded one is preserved — see the exclude_unset fix above) marks
    the target done. Same tempfile.mkdtemp() -> Storage -> cleanup shape as every other upload in
    this codebase (e.g. tasks_router.upload_task_attachment), bucket 'check-files'."""
    db = get_admin_client()
    rows = (
        db.table("org_person_task_targets").select("assignee_ids, completed, metric_value")
        .eq("id", target_id).eq("task_id", task_id).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []):
        raise HTTPException(status_code=403, detail="אין לך הרשאה להעלות קובץ ליעד זה")
    if target.get("completed"):
        raise HTTPException(status_code=400, detail="היעד כבר הושלם")

    old_key = (target.get("metric_value") or {}).get("file_key")

    run_dir = Path(tempfile.mkdtemp(prefix=f"ptask_{target_id}_"))
    try:
        suffix = Path(file.filename or "").suffix
        dest = run_dir / f"file{suffix}"
        dest.write_bytes(await file.read())
        storage_key = f"person-tasks/{task_id}/{target_id}/{secrets.token_hex(8)}{suffix}"
        db.storage.from_("check-files").upload(storage_key, dest.read_bytes())
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    if old_key:
        # Re-uploading replaces the previous file — clean it up instead of leaving it orphaned
        # in Storage (the existing tasks_router precedent doesn't bother; doing it right here
        # since this is new code, not a place we're matching legacy behavior).
        try:
            db.storage.from_("check-files").remove([old_key])
        except Exception as exc:
            logger.warning("upload_person_task_target_file: failed to remove old file (non-fatal): %s", exc)

    metric_value = {"file_key": storage_key, "filename": file.filename}
    db.table("org_person_task_targets").update({"metric_value": metric_value}).eq("id", target_id).execute()
    return metric_value


@router.delete("/{task_id}/targets/{target_id}/upload")
def delete_person_task_target_file(task_id: str, target_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    rows = (
        db.table("org_person_task_targets").select("assignee_ids, completed, metric_value")
        .eq("id", target_id).eq("task_id", task_id).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []):
        raise HTTPException(status_code=403, detail="אין לך הרשאה למחוק קובץ מיעד זה")
    if target.get("completed"):
        raise HTTPException(status_code=400, detail="היעד כבר הושלם")

    file_key = (target.get("metric_value") or {}).get("file_key")
    if file_key:
        try:
            db.storage.from_("check-files").remove([file_key])
        except Exception as exc:
            logger.warning("delete_person_task_target_file: failed to remove file (non-fatal): %s", exc)
    db.table("org_person_task_targets").update({"metric_value": None}).eq("id", target_id).execute()
    return {"ok": True}


@router.get("/{task_id}/targets/{target_id}/file")
def download_person_task_target_file(task_id: str, target_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    rows = (
        db.table("org_person_task_targets").select("assignee_ids, metric_value")
        .eq("id", target_id).eq("task_id", task_id).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []) and user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לצפות בקובץ זה")

    metric_value = target.get("metric_value") or {}
    file_key = metric_value.get("file_key")
    if not file_key:
        raise HTTPException(status_code=404, detail="לא הועלה קובץ")
    filename = metric_value.get("filename") or "file"
    content = db.storage.from_("check-files").download(file_key)
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{task_id}/targets/{target_id}/uncomplete")
def uncomplete_person_task_target(task_id: str, target_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Undo a checkbox/number completion — mistakes happen (e.g. clicked the wrong school's
    row). Any assignee on the target can undo it, not just whoever originally completed it
    (same trust boundary as completing it in the first place — a shared target is shared both
    ways). Field-kind metrics are never completed this way to begin with, so there's nothing to
    undo for them; the checkbox/number-only UI gating on the frontend already reflects that."""
    db = get_admin_client()
    rows = db.table("org_person_task_targets").select("*").eq("id", target_id).eq("task_id", task_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    target = rows[0]
    if user["id"] not in (target.get("assignee_ids") or []):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לבטל את הסימון במשימה זו")

    db.table("org_person_task_targets").update({
        "completed": False, "completed_by": None, "completed_at": None, "metric_value": None,
    }).eq("id", target_id).execute()
    recompute_person_task_cache(db, task_id)
    return {"ok": True}


class TargetNoteIn(BaseModel):
    note: str | None = None


@router.put("/{task_id}/targets/{target_id}/note")
def put_person_task_target_note(task_id: str, target_id: str, body: TargetNoteIn, user: Annotated[dict, Depends(get_current_user)]):
    """Free-text per-target note — mirrors tasks_router.put_task_school_note's shape, scoped to
    the target row (not just the school) since a six-year school now has 2 independent targets
    that may need different notes. Assignee on the target, or a manager/owner, can write it."""
    db = get_admin_client()
    rows = db.table("org_person_task_targets").select("assignee_ids").eq("id", target_id).eq("task_id", task_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="יעד לא נמצא")
    if user["id"] not in (rows[0].get("assignee_ids") or []) and user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין לך הרשאה להוסיף הערה ליעד זה")
    db.table("org_person_task_targets").update({"notes": body.note}).eq("id", target_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Cron — field-based auto-detect (no "send" action exists here to piggyback recompute on, so a
# dedicated periodic tick is the only reliable way to keep the admin list table fresh without
# requiring someone to open every task)
# ---------------------------------------------------------------------------

def _with_division_override(criteria: dict, division_type: str | None) -> dict:
    """Clones `criteria`, forcing `division_type` onto every goal/control_letter condition that
    doesn't already have one — used to evaluate a SPLIT target row (see _build_school_targets)
    against only its own division, instead of task_logic's default "AND across every division
    the school has" behavior. A no-op (returns criteria as-is) when division_type is None."""
    if not division_type:
        return criteria
    groups = []
    for group in (criteria or {}).get("groups") or []:
        conditions = []
        for cond in group.get("conditions") or []:
            if cond.get("type") in ("goal", "control_letter") and not cond.get("division_type"):
                conditions.append({**cond, "division_type": division_type})
            else:
                conditions.append(cond)
        groups.append({"conditions": conditions})
    return {"groups": groups}


def _recompute_single_person_task(db, task: dict) -> None:
    """Same re-evaluation as _recompute_field_person_tasks, scoped to ONE already-fetched task —
    used by get_person_task so an inline goal/control_letter/field edit made from this task's own
    'מדד הצלחה' column shows up the instant this task is reloaded, without waiting for the next
    org-wide sweep (list_person_tasks) or the 30-minute cron. No-op for non-field, non-schools, or
    non-active tasks (nothing to recompute)."""
    if task.get("assignment_mode") != "schools" or (task.get("success_metric") or {}).get("kind") != "field" or task.get("status") != "active":
        return
    targets = (
        db.table("org_person_task_targets").select("id, school_id, target_division_type, completed")
        .eq("task_id", task["id"]).execute().data or []
    )
    targets = [t for t in targets if t.get("school_id")]
    if not targets:
        return
    academic_year = task.get("academic_year") or DEFAULT_ACADEMIC_YEAR
    schools, meetings, year_map, goal_map, cl_map = task_logic._fetch_schools_and_meetings(task["org_id"], academic_year)
    schools_by_id = {s["id"]: s for s in schools}
    criteria = (task.get("success_metric") or {}).get("criteria") or {}
    for t in targets:
        school = schools_by_id.get(t["school_id"])
        if not school:
            continue
        school_meetings = task_logic._meetings_for_school(meetings, t["school_id"])
        year_row = year_map.get(t["school_id"])
        goal_rows = goal_map.get(t["school_id"], [])
        cl_rows = cl_map.get(t["school_id"], [])
        row_criteria = _with_division_override(criteria, t.get("target_division_type"))
        now_met = task_logic.evaluate_tree(row_criteria, school, school_meetings, year_row, goal_rows, cl_rows)
        if now_met == t.get("completed"):
            continue
        db.table("org_person_task_targets").update(
            {"completed": True, "completed_at": datetime.now(timezone.utc).isoformat()} if now_met
            else {"completed": False, "completed_at": None, "completed_by": None},
        ).eq("id", t["id"]).execute()


def _recompute_field_person_tasks(db, org_id: str) -> dict:
    """Re-evaluates every active, schools-mode, field-kind person-task's targets for ONE org
    against CURRENT data — the shared core of both the 30-minute cron (recompute_all_person_
    tasks, all orgs) and the on-demand call from list_person_tasks (this org only, on every
    table load — see that function's docstring for why: no 'send' action exists to piggyback a
    live trigger on, so a periodic tick alone left the admin table stale for up to 30 minutes,
    longer in local dev where the cron doesn't run at all).

    Re-checks EVERY target, not just incomplete ones: for field-kind metrics the underlying
    value is a live database field someone can toggle back and forth (e.g. a "יעד תכנון" goal
    flipped from "כן" back to "לא") — completion here is never a manual one-way action (unlike
    checkbox/number kinds), so it must track the field's current state in both directions,
    exactly like it does for detecting completion in the first place.

    Batched, not per-task: an earlier version called task_logic._fetch_schools_and_meetings (a
    whole-org fetch — schools, a meetings-stats RPC, goals, control letters) separately INSIDE
    the per-task loop, so 2+ field-kind tasks sharing an academic_year repeated the same
    expensive fetch redundantly. Since this endpoint is now hit by list_person_tasks on every
    table load AND by 20-second polling (see AdminPersonTasksTab.jsx), that redundant work was
    landing concurrently with other requests (e.g. opening a task row) on the same shared httpx
    client, causing intermittent slowness/503s (Architecture Invariant #8's exact concern) —
    fetching once per DISTINCT academic_year instead of once per task fixes that."""
    tasks = (
        db.table("org_person_tasks").select("*")
        .eq("org_id", org_id).eq("status", "active").eq("assignment_mode", "schools").execute().data or []
    )
    field_tasks = [t for t in tasks if (t.get("success_metric") or {}).get("kind") == "field"]
    if not field_tasks:
        return {"tasks_checked": 0, "targets_completed": 0}

    task_ids = [t["id"] for t in field_tasks]
    all_targets = (
        db.table("org_person_task_targets").select("id, task_id, school_id, target_division_type, completed")
        .in_("task_id", task_ids).execute().data or []
    )
    targets_by_task: dict[str, list[dict]] = {}
    for t in all_targets:
        if t.get("school_id"):
            targets_by_task.setdefault(t["task_id"], []).append(t)

    tasks_by_year: dict[str, list[dict]] = {}
    for task in field_tasks:
        if task["id"] in targets_by_task:
            tasks_by_year.setdefault(task.get("academic_year") or DEFAULT_ACADEMIC_YEAR, []).append(task)

    tasks_checked, targets_changed = 0, 0
    for academic_year, year_tasks in tasks_by_year.items():
        try:
            schools, meetings, year_map, goal_map, cl_map = task_logic._fetch_schools_and_meetings(org_id, academic_year)
        except Exception as exc:
            logger.warning("_recompute_field_person_tasks: fetch failed for academic_year %s (non-fatal): %s", academic_year, exc)
            continue
        schools_by_id = {s["id"]: s for s in schools}

        for task in year_tasks:
            tasks_checked += 1
            try:
                criteria = (task.get("success_metric") or {}).get("criteria") or {}
                for t in targets_by_task[task["id"]]:
                    school = schools_by_id.get(t["school_id"])
                    if not school:
                        continue
                    school_meetings = task_logic._meetings_for_school(meetings, t["school_id"])
                    year_row = year_map.get(t["school_id"])
                    goal_rows = goal_map.get(t["school_id"], [])
                    cl_rows = cl_map.get(t["school_id"], [])
                    row_criteria = _with_division_override(criteria, t.get("target_division_type"))
                    now_met = task_logic.evaluate_tree(row_criteria, school, school_meetings, year_row, goal_rows, cl_rows)
                    if now_met == t.get("completed"):
                        continue
                    db.table("org_person_task_targets").update(
                        {"completed": True, "completed_at": datetime.now(timezone.utc).isoformat()} if now_met
                        else {"completed": False, "completed_at": None, "completed_by": None},
                    ).eq("id", t["id"]).execute()
                    targets_changed += 1
                recompute_person_task_cache(db, task["id"])
            except Exception as exc:
                logger.warning("_recompute_field_person_tasks: failed for task %s (non-fatal): %s", task["id"], exc)

    return {"tasks_checked": tasks_checked, "targets_completed": targets_changed}


@router.post("/recompute-all")
def recompute_all_person_tasks(request: Request):
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    db = get_admin_client()

    activated, activation_holds = 0, 0
    now_iso = datetime.now(timezone.utc).isoformat()
    due = (
        db.table("org_person_tasks").select("*")
        .eq("status", "scheduled").lte("scheduled_for", now_iso).execute().data or []
    )
    for task in due:
        try:
            result = _try_activate_scheduled_person_task(db, task)
            activated += 1 if result["activated"] else 0
            activation_holds += 1 if result["has_problems"] else 0
        except Exception as exc:
            logger.warning("recompute_all_person_tasks: failed to activate scheduled task %s: %s", task["id"], exc)

    # Global cron sweep — every org, not scoped (the per-org helper is also called on-demand
    # from list_person_tasks, see there).
    org_ids = {r["org_id"] for r in db.table("org_person_tasks").select("org_id").eq("status", "active").eq("assignment_mode", "schools").execute().data or []}
    tasks_checked, targets_completed = 0, 0
    for org_id in org_ids:
        result = _recompute_field_person_tasks(db, org_id)
        tasks_checked += result["tasks_checked"]
        targets_completed += result["targets_completed"]

    return {
        "ok": True, "tasks_checked": tasks_checked, "targets_completed": targets_completed,
        "scheduled_activated": activated, "scheduled_holds": activation_holds,
    }
