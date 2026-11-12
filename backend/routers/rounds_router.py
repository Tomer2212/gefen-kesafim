""""סבבי פגישות" — a folder with a goal for meeting tasks (see backend/meeting_rounds.py).
Owner/manager only, like the tasks area; every endpoint checks the round belongs to the caller's
org. Tasks join a round through org_tasks.round_id (set in tasks_router.create_task)."""
import logging
import time
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import meeting_rounds
import task_logic
from academic_years import DEFAULT_ACADEMIC_YEAR, resolve_inherited_year_admin
from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

_STAGE_SCOPES = {"tichon", "chativa", "both", "separate"}
_TYPES = set(task_logic.MEETING_SERVICE_TYPE_OPTIONS) | {task_logic.BY_SERVICE}
MAX_COUNT_PER_SCHOOL = 10


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


class RequirementIn(BaseModel):
    meeting_service_type: str
    gefen_current_split: str | None = None
    count_per_school: int = 1
    stage_scope: str | None = None


class RoundCreateIn(BaseModel):
    name: str
    academic_year: str = DEFAULT_ACADEMIC_YEAR
    start_date: str
    end_date: str
    criteria: dict | None = None
    manual_school_ids: list[str] | None = None
    requirement: RequirementIn
    physical_school_ids: list[str] = []
    # Who goes to each physical גפן+שוטף school whose גפן and שוטף advisors differ —
    # {school_id: [advisor_id]} from the creation "בעיות" window (POST /rounds/physical-check).
    physical_visitors: dict[str, list[str]] = {}


class PhysicalCheckIn(BaseModel):
    academic_year: str = DEFAULT_ACADEMIC_YEAR
    school_ids: list[str]
    requirement: RequirementIn


class RoundPatchIn(BaseModel):
    name: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = None
    requirement: RequirementIn | None = None
    physical_school_ids: list[str] | None = None
    excluded_school_ids: list[str] | None = None
    # Advisors of physical schools who don't go out to the field (e.g. the שוטף advisor of a
    # גפן+שוטף school when only the גפן advisor visits): no field days are asked of them.
    field_exempt_advisor_ids: list[str] | None = None
    # Editing the round's school list ("עריכת הסבב") — sent only when the filter or selection
    # changed: the list is rebuilt from it (manual_school_ids set = a hand-picked list).
    criteria: dict | None = None
    manual_school_ids: list[str] | None = None
    physical_visitors: dict[str, list[str]] | None = None


class AudienceApplyIn(BaseModel):
    add_ids: list[str] = []
    remove_ids: list[str] = []


def _validate_dates(start: str, end: str) -> None:
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="תאריך לא תקין")
    if s > e:
        raise HTTPException(status_code=422, detail="תאריך הסיום של הסבב מוקדם מתאריך ההתחלה")


def _validate_requirement(req: RequirementIn) -> dict:
    if req.meeting_service_type not in _TYPES:
        raise HTTPException(status_code=422, detail="סוג פגישה לא תקין")
    if req.meeting_service_type == task_logic.BY_SERVICE and req.gefen_current_split not in task_logic.GEFEN_CURRENT_SPLIT_VALUES:
        raise HTTPException(status_code=422, detail="יש לבחור איך לקבוע לבתי ספר גפן+שוטף עם יועצים שונים")
    if not 1 <= req.count_per_school <= MAX_COUNT_PER_SCHOOL:
        raise HTTPException(status_code=422, detail="כמות פגישות לבית ספר לא תקינה")
    if req.stage_scope is not None and req.stage_scope not in _STAGE_SCOPES:
        raise HTTPException(status_code=422, detail="בחירת חטיבה לא תקינה")
    out = req.model_dump()
    if out["meeting_service_type"] != task_logic.BY_SERVICE:
        out["gefen_current_split"] = None
    return out


def _get_round(db, user: dict, round_id: str) -> dict:
    rows = db.table("meeting_rounds").select("*").eq("id", round_id).eq("org_id", user["org_id"]).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="הסבב לא נמצא")
    return rows[0]


def _clean_visitors(db, org_id: str, visitors: dict[str, list[str]], physical_ids: set[str]) -> dict[str, list[str]]:
    """Only the round's physical schools, only this org's advisors."""
    advisor_ids = list({aid for ids in visitors.values() for aid in ids or []})
    allowed = ({r["id"] for r in db.table("profiles").select("id").eq("org_id", org_id).in_("id", advisor_ids).execute().data or []}
               if advisor_ids else set())
    out = {}
    for sid, ids in visitors.items():
        kept = [aid for aid in dict.fromkeys(ids or []) if aid in allowed]
        if sid in physical_ids and kept:
            out[sid] = kept
    return out


def _org_school_ids(db, org_id: str, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    rows = db.table("schools").select("id").eq("org_id", org_id).in_("id", ids).execute().data or []
    return {r["id"] for r in rows}


@router.get("/")
def list_rounds(user: Annotated[dict, Depends(get_current_user)], academic_year: str = DEFAULT_ACADEMIC_YEAR):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rounds = (
                db.table("meeting_rounds").select("*").eq("org_id", user["org_id"]).eq("academic_year", academic_year)
                .order("start_date", desc=True).execute().data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_rounds attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_rounds failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    try:
        ids = [r["id"] for r in rounds]
        task_rows = (db.table("org_tasks").select("round_id").in_("round_id", ids).execute().data or []) if ids else []
        counts: dict[str, int] = {}
        for t in task_rows:
            counts[t["round_id"]] = counts.get(t["round_id"], 0) + 1
        for r in rounds:
            r["task_count"] = counts.get(r["id"], 0)
    except Exception as exc:
        logger.warning("list_rounds task-count enrichment failed (non-fatal): %s", exc)
    return rounds


@router.post("/")
def create_round(body: RoundCreateIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="יש לתת שם לסבב")
    _validate_dates(body.start_date, body.end_date)
    requirement = _validate_requirement(body.requirement)
    matched = task_logic.find_matching_schools(
        user["org_id"], body.criteria or {}, body.academic_year, manual_school_ids=body.manual_school_ids,
    )
    school_ids = [m["school_id"] for m in matched]
    if not school_ids:
        raise HTTPException(status_code=422, detail="אין בתי ספר שעונים על הסינון")
    db = get_admin_client()
    row = {
        "org_id": user["org_id"], "academic_year": body.academic_year, "name": name,
        "start_date": body.start_date, "end_date": body.end_date,
        "criteria": None if body.manual_school_ids is not None else (body.criteria or {}),
        "school_ids": school_ids, "requirement": requirement,
        "physical_school_ids": [sid for sid in body.physical_school_ids if sid in set(school_ids)],
        "physical_visitors": _clean_visitors(db, user["org_id"], body.physical_visitors, set(body.physical_school_ids) & set(school_ids)),
        "cached_total_schools": len(school_ids), "created_by": user["id"],
    }
    return db.table("meeting_rounds").insert(row).execute().data[0]


@router.post("/physical-check")
def physical_check(body: PhysicalCheckIn, user: Annotated[dict, Depends(get_current_user)]):
    """The physical schools of a new round whose meeting is a combined גפן+שוטף one (by card
    service type, or the round's own type) with different גפן and שוטף advisors — the creation
    window asks, per school, which of them goes out to the school."""
    _require_manager(user)
    if body.requirement.meeting_service_type not in (task_logic.BY_SERVICE, "gefen_current"):
        return {"schools": []}
    db = get_admin_client()
    ids = list(_org_school_ids(db, user["org_id"], list(dict.fromkeys(body.school_ids))))
    if not ids:
        return {"schools": []}
    if body.requirement.meeting_service_type == task_logic.BY_SERVICE:
        service = {sid: f.get("service_type") for sid, f in resolve_inherited_year_admin(db, ids, body.academic_year).items()}
        ids = [sid for sid in ids if service.get(sid) == "gefen_current"]
    lists: dict[str, dict[str, list[str]]] = {sid: {"gefen": [], "current": []} for sid in ids}
    for t, table in (("gefen", "school_advisors_gefen"), ("current", "school_advisors_current")):
        for r in (db.table(table).select("school_id, advisor_id").in_("school_id", ids).execute().data or []) if ids else []:
            lists[r["school_id"]][t].append(r["advisor_id"])
    conflicts = [sid for sid, l in lists.items() if l["gefen"] and l["current"] and set(l["gefen"]) != set(l["current"])]
    if not conflicts:
        return {"schools": []}
    advisor_ids = list({a for sid in conflicts for t in ("gefen", "current") for a in lists[sid][t]})
    names = {p["id"]: p.get("full_name") or p.get("email") or ""
             for p in db.table("profiles").select("id, full_name, email").in_("id", advisor_ids).execute().data or []}
    schools = {r["id"]: r for r in db.table("schools").select("id, name, city").in_("id", conflicts).execute().data or []}
    return {"schools": sorted(
        ({"school_id": sid, "school_name": schools.get(sid, {}).get("name"), "city": schools.get(sid, {}).get("city"),
          "gefen": [{"id": a, "name": names.get(a, "")} for a in lists[sid]["gefen"]],
          "current": [{"id": a, "name": names.get(a, "")} for a in lists[sid]["current"]]}
         for sid in conflicts),
        key=lambda x: x["school_name"] or "",
    )}


@router.get("/{round_id}")
def get_round(round_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """The round's dashboard: every school's status, the totals, and the round's tasks."""
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rnd = _get_round(db, user, round_id)
            result = meeting_rounds.compute_round(db, rnd)
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_round attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_round failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    try:
        patch = meeting_rounds.cache_patch(rnd, result)
        if patch:
            db.table("meeting_rounds").update(patch).eq("id", round_id).execute()
            rnd.update(patch)
    except Exception as exc:
        logger.warning("get_round cache write failed (non-fatal): %s", exc)
    advisor_names: dict[str, str] = {}
    try:
        ids = list({aid for s in result["schools"] for aid in s["advisor_ids"]})
        if ids:
            rows = db.table("profiles").select("id, full_name, email").in_("id", ids).execute().data or []
            advisor_names = {p["id"]: p.get("full_name") or p.get("email") or "" for p in rows}
    except Exception as exc:
        logger.warning("get_round advisor-name enrichment failed (non-fatal): %s", exc)
    try:
        if result["tasks"]:
            full = (
                db.table("org_tasks").select("id, name, status, created_at, cached_progress_pct, cached_total_schools, cached_actions_completed, cached_actions_needed")
                .in_("id", [t["id"] for t in result["tasks"]]).execute().data or []
            )
            result["tasks"] = sorted(full, key=lambda t: t.get("created_at") or "", reverse=True)
    except Exception as exc:
        logger.warning("get_round task enrichment failed (non-fatal): %s", exc)
    return {"round": rnd, **result, "advisor_names": advisor_names}


@router.patch("/{round_id}")
def update_round(round_id: str, body: RoundPatchIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    rnd = _get_round(db, user, round_id)
    patch: dict = {}
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="יש לתת שם לסבב")
        patch["name"] = body.name.strip()
    start, end = body.start_date or rnd["start_date"], body.end_date or rnd["end_date"]
    if body.start_date is not None or body.end_date is not None:
        _validate_dates(start, end)
        patch["start_date"], patch["end_date"] = start, end
    if body.status is not None:
        if body.status not in ("active", "closed"):
            raise HTTPException(status_code=422, detail="סטטוס לא תקין")
        patch["status"] = body.status
    if body.requirement is not None:
        patch["requirement"] = _validate_requirement(body.requirement)
    members = set(rnd.get("school_ids") or [])
    if body.criteria is not None or body.manual_school_ids is not None:
        matched = task_logic.find_matching_schools(
            user["org_id"], body.criteria or {}, rnd["academic_year"], manual_school_ids=body.manual_school_ids,
        )
        if not matched:
            raise HTTPException(status_code=422, detail="אין בתי ספר שעונים על הסינון")
        school_ids = [m["school_id"] for m in matched]
        members = set(school_ids)
        patch["school_ids"] = school_ids
        patch["criteria"] = None if body.manual_school_ids is not None else (body.criteria or {})
        # Kept only for schools still in the round.
        patch["excluded_school_ids"] = [sid for sid in rnd.get("excluded_school_ids") or [] if sid in members]
        patch["physical_school_ids"] = [sid for sid in rnd.get("physical_school_ids") or [] if sid in members]
        patch["physical_visitors"] = {sid: v for sid, v in (rnd.get("physical_visitors") or {}).items() if sid in members}
    if body.physical_school_ids is not None:
        patch["physical_school_ids"] = [sid for sid in dict.fromkeys(body.physical_school_ids) if sid in members]
    if body.excluded_school_ids is not None:
        patch["excluded_school_ids"] = [sid for sid in dict.fromkeys(body.excluded_school_ids) if sid in members]
    if body.physical_visitors is not None:
        physical = set(patch.get("physical_school_ids", rnd.get("physical_school_ids") or []))
        patch["physical_visitors"] = _clean_visitors(db, user["org_id"], body.physical_visitors, physical)
    elif body.physical_school_ids is not None:
        physical = set(patch["physical_school_ids"])
        patch["physical_visitors"] = {sid: v for sid, v in (rnd.get("physical_visitors") or {}).items() if sid in physical}
    if body.field_exempt_advisor_ids is not None:
        ids = list(dict.fromkeys(body.field_exempt_advisor_ids))
        allowed = {r["id"] for r in db.table("profiles").select("id").eq("org_id", user["org_id"]).in_("id", ids).execute().data or []} if ids else set()
        patch["field_exempt_advisor_ids"] = [aid for aid in ids if aid in allowed]
    if not patch:
        return rnd
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    return db.table("meeting_rounds").update(patch).eq("id", round_id).execute().data[0]


@router.delete("/{round_id}")
def delete_round(round_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Deletes the folder only: its tasks stay, just no longer in a round (FK ON DELETE SET NULL)."""
    _require_manager(user)
    db = get_admin_client()
    _get_round(db, user, round_id)
    db.table("meeting_rounds").delete().eq("id", round_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}


@router.post("/{round_id}/audience-preview")
def preview_round_audience(round_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Who the round's filter matches today vs the round's list — nothing changes until applied."""
    _require_manager(user)
    db = get_admin_client()
    rnd = _get_round(db, user, round_id)
    if rnd.get("criteria") is None:
        return {"added": [], "removed": [], "manual": True}
    matched = task_logic.find_matching_schools(user["org_id"], rnd["criteria"], rnd["academic_year"])
    current = set(rnd.get("school_ids") or [])
    now_ids = {m["school_id"] for m in matched}
    names = {m["school_id"]: m["school_name"] for m in matched}
    removed_ids = [sid for sid in current if sid not in now_ids]
    if removed_ids:
        for s in db.table("schools").select("id, name").in_("id", removed_ids).execute().data or []:
            names[s["id"]] = s["name"]
    return {
        "added": [{"school_id": sid, "school_name": names.get(sid)} for sid in now_ids - current],
        "removed": [{"school_id": sid, "school_name": names.get(sid)} for sid in removed_ids],
        "manual": False,
    }


@router.post("/{round_id}/audience-apply")
def apply_round_audience(round_id: str, body: AudienceApplyIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    rnd = _get_round(db, user, round_id)
    allowed = _org_school_ids(db, user["org_id"], body.add_ids)
    remove = set(body.remove_ids)
    school_ids = [sid for sid in (rnd.get("school_ids") or []) if sid not in remove]
    school_ids += [sid for sid in body.add_ids if sid in allowed and sid not in school_ids]
    patch = {
        "school_ids": school_ids,
        "physical_school_ids": [sid for sid in (rnd.get("physical_school_ids") or []) if sid in set(school_ids)],
        "excluded_school_ids": [sid for sid in (rnd.get("excluded_school_ids") or []) if sid in set(school_ids)],
        "physical_visitors": {sid: v for sid, v in (rnd.get("physical_visitors") or {}).items() if sid in set(school_ids)},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return db.table("meeting_rounds").update(patch).eq("id", round_id).execute().data[0]


# ---------------------------------------------------------------------------
# ימי שטח — the days an advisor is out visiting schools. A physical meeting of a round's task is
# offered only on its advisor's field days, and on those days the advisor is never offered for a
# remote meeting on any link (meeting_booking_router._field_day_blocks). Stored per advisor, not
# per round, so they hold everywhere; round_id only records where a day was set.
# ---------------------------------------------------------------------------

# Rough planning numbers for the capacity hint (not a rule): an in-person day fits about this
# much meeting time once travel between schools is counted.
FIELD_DAY_MEETING_MINUTES = 360
_DURATION_FIELDS = {"gefen": ["meeting_duration_gefen"], "takuma": ["meeting_duration_gefen"],
                    "current": ["meeting_duration_current"], "district": ["meeting_duration_district"],
                    "gefen_current": ["meeting_duration_gefen", "meeting_duration_current"]}


class FieldDaysIn(BaseModel):
    advisor_id: str
    days: list[str]


@router.get("/{round_id}/field-days")
def get_round_field_days(round_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Per advisor with physical schools in the round: those schools, the meeting time they need,
    a suggested number of field days, and the field days already set (inside the round's dates)."""
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rnd = _get_round(db, user, round_id)
            result = meeting_rounds.compute_round(db, rnd)
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_round_field_days attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_round_field_days failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    physical = [s for s in result["schools"] if s["physical"]]
    durations: dict[str, dict] = {}
    try:
        ids = [s["school_id"] for s in physical]
        if ids:
            rows = (
                db.table("school_year_admin_data").select("school_id, meeting_duration_gefen, meeting_duration_current, meeting_duration_district")
                .eq("academic_year", rnd["academic_year"]).in_("school_id", ids).execute().data or []
            )
            durations = {r["school_id"]: r for r in rows}
    except Exception as exc:
        logger.warning("get_round_field_days duration enrichment failed (non-fatal): %s", exc)

    visitors = rnd.get("physical_visitors") or {}
    advisors: dict[str, dict] = {}
    for s in physical:
        row = durations.get(s["school_id"], {})
        minutes = sum(row.get(f) or 60 for t in s["required_types"] for f in _DURATION_FIELDS.get(t, [])) or 60
        minutes *= max(1, (rnd.get("requirement") or {}).get("count_per_school") or 1)
        # Only the advisors who actually go to this school (when the round recorded who does).
        visiting = [aid for aid in s["advisor_ids"] if aid in visitors[s["school_id"]]] if s["school_id"] in visitors else s["advisor_ids"]
        for aid in visiting or ["__none__"]:
            a = advisors.setdefault(aid, {"advisor_id": aid, "schools": [], "minutes": 0, "days": []})
            a["schools"].append({"school_id": s["school_id"], "school_name": s["school_name"], "city": s.get("city"), "status": s["status"]})
            if s["status"] not in ("done", "booked"):
                a["minutes"] += minutes
    real_ids = [aid for aid in advisors if aid != "__none__"]
    if real_ids:
        days = (
            db.table("advisor_field_days").select("id, advisor_id, day, round_id").eq("org_id", user["org_id"])
            .in_("advisor_id", real_ids).gte("day", rnd["start_date"]).lte("day", rnd["end_date"])
            .order("day").execute().data or []
        )
        for d in days:
            advisors[d["advisor_id"]]["days"].append({"id": d["id"], "day": d["day"]})
        names = {p["id"]: p.get("full_name") or p.get("email") or ""
                 for p in db.table("profiles").select("id, full_name, email").in_("id", real_ids).execute().data or []}
    else:
        names = {}
    exempt = set(rnd.get("field_exempt_advisor_ids") or [])
    out = []
    for a in advisors.values():
        a["name"] = names.get(a["advisor_id"], "")
        a["exempt"] = a["advisor_id"] in exempt
        a["suggested_days"] = -(-a["minutes"] // FIELD_DAY_MEETING_MINUTES) if a["minutes"] else 0
        out.append(a)
    out.sort(key=lambda a: (a["advisor_id"] == "__none__", a["exempt"], -(a["suggested_days"] - len(a["days"]))))
    return {"advisors": out, "start_date": rnd["start_date"], "end_date": rnd["end_date"],
            "field_day_meeting_minutes": FIELD_DAY_MEETING_MINUTES}


@router.post("/{round_id}/field-days")
def add_round_field_days(round_id: str, body: FieldDaysIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    _get_round(db, user, round_id)
    if not db.table("profiles").select("id").eq("id", body.advisor_id).eq("org_id", user["org_id"]).execute().data:
        raise HTTPException(status_code=404, detail="היועץ לא נמצא")
    days = []
    for d in dict.fromkeys(body.days):
        try:
            days.append(date.fromisoformat(d).isoformat())
        except ValueError:
            raise HTTPException(status_code=422, detail="תאריך לא תקין")
    if not days:
        return []
    rows = [{"org_id": user["org_id"], "advisor_id": body.advisor_id, "day": d, "round_id": round_id, "created_by": user["id"]} for d in days]
    # An existing day of the same advisor stays as it is (the meaning is the same).
    return db.table("advisor_field_days").upsert(rows, on_conflict="advisor_id,day", ignore_duplicates=True).execute().data or []


@router.delete("/{round_id}/field-days/{field_day_id}")
def delete_round_field_day(round_id: str, field_day_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    _get_round(db, user, round_id)
    db.table("advisor_field_days").delete().eq("id", field_day_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}
