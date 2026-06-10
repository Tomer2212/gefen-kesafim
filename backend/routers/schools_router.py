import io
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait, FIRST_COMPLETED
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from openpyxl import load_workbook
from pydantic import BaseModel

from auth import get_current_user, invalidate_profile_cache
from supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

DIVISION_LABELS = {
    "tikkon": "חטיבה עליונה",
    "beinayim": "חטיבת ביניים",
    "yesodi": "יסודי",
    "other": "אחר",
}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SchoolIn(BaseModel):
    name: str
    symbol: str | None = None
    city: str | None = None
    authority: str | None = None
    stage: str | None = None
    finance_software: str | None = None
    principal_name: str | None = None
    principal_phone: str | None = None
    secretary_name: str | None = None
    secretary_phone: str | None = None
    finance_contact_name: str | None = None
    finance_contact_phone: str | None = None
    finance_contact_email: str | None = None
    principal_email: str | None = None
    secretary_email: str | None = None
    school_phone: str | None = None
    address: str | None = None
    district: str | None = None
    notes: str | None = None
    restrict_access_to: list[str] | None = None
    extra_contacts: list[dict] | None = None


class GefenAccountIn(BaseModel):
    division_type: str
    custom_label: str | None = None
    finance_software: str | None = None
    tmura_model: bool | None = None


class AdvisorAssignIn(BaseModel):
    advisor_id: str


class MeetingIn(BaseModel):
    meeting_date: str | None = None
    status: str | None = "scheduled"
    start_time: str | None = None
    end_time: str | None = None
    advisor_id: str | None = None      # legacy single-advisor field (kept for compat)
    advisor_ids: list[str] | None = None  # multi-advisor array
    participants: list[dict] | None = None
    meeting_type: str | None = None
    actual_duration: str | None = None
    notes: str | None = None
    reminder_enabled: bool | None = False


class UserInviteIn(BaseModel):
    email: str
    full_name: str | None = None
    role: str = "advisor"


class UserRoleIn(BaseModel):
    role: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _require_owner(user: dict):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="פעולה זו מיועדת לבעלים בלבד")


# ---------------------------------------------------------------------------
# Schools
# ---------------------------------------------------------------------------

@router.get("/")
def list_schools(user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    is_advisor = user["role"] not in ("owner", "manager")
    schools = []

    for attempt in range(2):
        try:
            # Fetch schools + (for advisors) advisor assignment in parallel
            with ThreadPoolExecutor(max_workers=2) as pool:
                schools_future = pool.submit(
                    lambda: db.table("schools").select("*, gefen_accounts(*), advisor_schools(advisor_id)").order("name").execute()
                )
                if is_advisor:
                    assigned_future = pool.submit(
                        lambda: db.table("advisor_schools").select("school_id").eq("advisor_id", user["id"]).execute()
                    )
                else:
                    assigned_future = None

                all_res = schools_future.result()
                schools = all_res.data or []

                if is_advisor and assigned_future:
                    assigned = assigned_future.result()
                    advisor_school_ids = {r["school_id"] for r in (assigned.data or [])}
                    filtered = []
                    for s in schools:
                        rat = s.get("restrict_access_to")
                        if rat is None or user["id"] in (rat or []) or s["id"] in advisor_school_ids:
                            filtered.append(s)
                    schools = filtered
            break  # success
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_schools attempt 1 failed: %s — retrying", exc)
                time.sleep(0.3)
            else:
                logger.error("list_schools failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    # Enrich advisor_schools entries with profile data via separate query
    all_advisor_ids = list({
        row["advisor_id"]
        for s in schools
        for row in (s.get("advisor_schools") or [])
        if row.get("advisor_id")
    })
    if all_advisor_ids:
        try:
            p_rows = db.table("profiles").select("id, full_name, email").in_("id", all_advisor_ids).execute()
            profiles_map = {p["id"]: p for p in (p_rows.data or [])}
            for school in schools:
                for row in (school.get("advisor_schools") or []):
                    row["profiles"] = profiles_map.get(row["advisor_id"])
        except Exception as exc:
            logger.warning("profiles enrichment failed (non-fatal): %s", exc)

    # Embed meetings stats directly so the frontend needs no separate request
    school_ids = [s["id"] for s in schools]
    if school_ids:
        try:
            stats_res = db.rpc("get_meetings_stats", {"school_ids": school_ids}).execute()
            m_stats = {
                r["school_id"]: {"completed": r["completed"], "total_minutes": r["total_minutes"]}
                for r in (stats_res.data or [])
            }
            for school in schools:
                school["meetings_stats"] = m_stats.get(school["id"])
        except Exception as exc:
            logger.warning("meetings stats enrichment failed (non-fatal): %s", exc)

    return schools


@router.post("/")
def create_school(
    body: SchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    row = db.table("schools").insert(body.model_dump(exclude_none=True)).execute()
    return row.data[0]


@router.put("/{school_id}")
def update_school(
    school_id: str,
    body: SchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    update_data = body.model_dump(exclude_none=True)
    # Allow explicitly clearing restrict_access_to (null = כולם)
    if "restrict_access_to" in body.model_fields_set and body.restrict_access_to is None:
        update_data["restrict_access_to"] = None
    row = (
        db.table("schools")
        .update(update_data)
        .eq("id", school_id)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    return row.data[0]


@router.delete("/{school_id}")
def delete_school(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    db.table("schools").delete().eq("id", school_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Gefen accounts (divisions)
# ---------------------------------------------------------------------------

@router.get("/{school_id}/accounts")
def list_accounts(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    for attempt in range(2):
        try:
            rows = (
                db.table("gefen_accounts")
                .select("*")
                .eq("school_id", school_id)
                .order("division_type")
                .execute()
            )
            return rows.data
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_accounts attempt 1 failed: %s — retrying", exc)
                time.sleep(0.3)
            else:
                logger.error("list_accounts failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.post("/{school_id}/accounts")
def create_account(
    school_id: str,
    body: GefenAccountIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    if body.division_type not in DIVISION_LABELS:
        raise HTTPException(status_code=400, detail="סוג חטיבה לא חוקי")
    db = get_admin_client()
    row = (
        db.table("gefen_accounts")
        .insert({"school_id": school_id, **body.model_dump(exclude_none=True)})
        .execute()
    )
    return row.data[0]


@router.put("/{school_id}/accounts/{account_id}")
def update_account(
    school_id: str,
    account_id: str,
    body: GefenAccountIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    data = {k: v for k, v in body.model_dump().items() if k != "division_type" and v is not None}
    row = (
        db.table("gefen_accounts")
        .update(data)
        .eq("id", account_id)
        .eq("school_id", school_id)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="החטיבה לא נמצאה")
    return row.data[0]


@router.delete("/{school_id}/accounts/{account_id}")
def delete_account(
    school_id: str,
    account_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    db.table("gefen_accounts").delete().eq("id", account_id).eq("school_id", school_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Advisor assignments
# ---------------------------------------------------------------------------

@router.get("/{school_id}/advisors")
def list_advisors(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    rows = (
        db.table("advisor_schools")
        .select("advisor_id, profiles(id, email, full_name, role)")
        .eq("school_id", school_id)
        .execute()
    )
    return [r["profiles"] for r in rows.data if r.get("profiles")]


@router.post("/{school_id}/advisors")
def assign_advisor(
    school_id: str,
    body: AdvisorAssignIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    db.table("advisor_schools").upsert(
        {"advisor_id": body.advisor_id, "school_id": school_id}
    ).execute()
    return {"ok": True}


@router.delete("/{school_id}/advisors/{advisor_id}")
def unassign_advisor(
    school_id: str,
    advisor_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    db.table("advisor_schools").delete().eq("advisor_id", advisor_id).eq("school_id", school_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Update requests (advisors submit → owner/manager approve)
# ---------------------------------------------------------------------------

class UpdateRequestIn(BaseModel):
    proposed_changes: dict


class ReviewRequestIn(BaseModel):
    status: str  # "approved" | "rejected"
    reviewer_note: str | None = None


_approver_ids_cache: tuple[list[str], float] | None = None
_APPROVER_TTL = 300  # 5 minutes


def invalidate_approver_ids_cache() -> None:
    global _approver_ids_cache
    _approver_ids_cache = None


def _get_approver_ids(db) -> list[str]:
    """Return IDs of who should receive approval notifications.
    If any owner has delegate_approvals_to_managers=True, include managers too.
    Result cached for 5 minutes; single query instead of two.
    """
    global _approver_ids_cache
    now = time.monotonic()
    if _approver_ids_cache and (now - _approver_ids_cache[1]) < _APPROVER_TTL:
        return _approver_ids_cache[0]

    all_candidates = (
        db.table("profiles")
        .select("id, role, delegate_approvals_to_managers")
        .in_("role", ["owner", "manager"])
        .execute()
    )
    candidates = all_candidates.data or []
    owners = [r for r in candidates if r["role"] == "owner"]
    managers = [r for r in candidates if r["role"] == "manager"]
    ids = [r["id"] for r in owners]
    if any(r.get("delegate_approvals_to_managers") for r in owners):
        ids += [r["id"] for r in managers]
    _approver_ids_cache = (ids, now)
    return ids


@router.post("/{school_id}/update-requests")
def submit_update_request(
    school_id: str,
    body: UpdateRequestIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    row = db.table("school_update_requests").insert({
        "school_id": school_id,
        "requester_id": user["id"],
        "proposed_changes": body.proposed_changes,
        "status": "pending",
    }).execute()
    return row.data[0]


@router.get("/update-requests")
def list_update_requests(user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    if user["role"] in ("owner", "manager"):
        rows = (
            db.table("school_update_requests")
            .select("*, schools(name), requester:profiles!requester_id(full_name, email)")
            .order("created_at", desc=True)
            .execute()
        )
    else:
        rows = (
            db.table("school_update_requests")
            .select("*, schools(name), requester:profiles!requester_id(full_name, email)")
            .eq("requester_id", user["id"])
            .order("created_at", desc=True)
            .execute()
        )
    return rows.data


@router.patch("/update-requests/{req_id}")
def review_update_request(
    req_id: str,
    body: ReviewRequestIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="סטטוס לא חוקי")
    db = get_admin_client()
    req_row = db.table("school_update_requests").select("*").eq("id", req_id).execute()
    if not req_row.data:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    req = req_row.data[0]
    # Apply changes if approved
    if body.status == "approved" and req.get("proposed_changes"):
        changes = dict(req["proposed_changes"])
        if "add_advisor_to_school" in changes:
            advisor_id = changes.pop("add_advisor_to_school")
            db.table("advisor_schools").upsert({"advisor_id": advisor_id, "school_id": req["school_id"]}).execute()
        if changes:
            db.table("schools").update(changes).eq("id", req["school_id"]).execute()
    from datetime import datetime, timezone
    db.table("school_update_requests").update({
        "status": body.status,
        "reviewer_id": user["id"],
        "reviewer_note": body.reviewer_note,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", req_id).execute()
    return {"ok": True}


@router.get("/notifications")
def get_notifications(user: Annotated[dict, Depends(get_current_user)]):
    """Return pending items relevant to the current user."""
    db = get_admin_client()
    items = []

    # Approval requests (for approvers)
    if user["role"] in ("owner", "manager"):
        approver_ids = _get_approver_ids(db)
        if user["id"] in approver_ids:
            rows = (
                db.table("school_update_requests")
                .select("*, schools(name), requester:profiles!requester_id(full_name, email)")
                .eq("status", "pending")
                .order("created_at", desc=True)
                .execute()
            )
            for r in (rows.data or []):
                r["_type"] = "update_request"
            items.extend(rows.data or [])
    else:
        # Status updates on advisor's own requests
        rows = (
            db.table("school_update_requests")
            .select("*, schools(name)")
            .eq("requester_id", user["id"])
            .neq("status", "pending")
            .order("resolved_at", desc=True)
            .limit(20)
            .execute()
        )
        for r in (rows.data or []):
            r["_type"] = "update_request"
        items.extend(rows.data or [])

    # Mention notifications (for everyone)
    mentions = (
        db.table("mention_notifications")
        .select("*, schools(name), sender:profiles!sender_id(full_name, email)")
        .eq("recipient_id", user["id"])
        .is_("read_at", "null")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    for m in (mentions.data or []):
        m["_type"] = "mention"
    items.extend(mentions.data or [])

    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"count": len(items), "items": items}


# ---------------------------------------------------------------------------
# Meetings stats (aggregate per school — used by dashboard columns)
# ---------------------------------------------------------------------------

@router.get("/meetings-stats")
def get_meetings_stats(user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()

    try:
        if user["role"] in ("owner", "manager"):
            # Owners/managers see all schools — skip the schools filter query entirely
            meetings_res = db.table("meetings").select("school_id, status, start_time, end_time").execute()
        else:
            # Advisors: fetch schools + assignments in parallel, then meetings
            with ThreadPoolExecutor(max_workers=2) as pool:
                schools_future = pool.submit(
                    lambda: db.table("schools").select("id, restrict_access_to").execute()
                )
                assigned_future = pool.submit(
                    lambda: db.table("advisor_schools").select("school_id").eq("advisor_id", user["id"]).execute()
                )
                all_schools = schools_future.result().data or []
                advisor_ids = {r["school_id"] for r in (assigned_future.result().data or [])}

            accessible = [
                s["id"] for s in all_schools
                if s.get("restrict_access_to") is None
                or user["id"] in (s.get("restrict_access_to") or [])
                or s["id"] in advisor_ids
            ]
            if not accessible:
                return {}
            meetings_res = db.table("meetings").select("school_id, status, start_time, end_time").in_("school_id", accessible).execute()
    except Exception as exc:
        logger.warning("get_meetings_stats failed: %s", exc)
        return {}
    stats: dict = {}
    for m in (meetings_res.data or []):
        sid = m["school_id"]
        if sid not in stats:
            stats[sid] = {"completed": 0, "total_minutes": 0}
        if m.get("status") == "completed":
            stats[sid]["completed"] += 1
            st, et = m.get("start_time"), m.get("end_time")
            if st and et:
                try:
                    sh, sm = map(int, st.split(":"))
                    eh, em = map(int, et.split(":"))
                    diff = (eh * 60 + em) - (sh * 60 + sm)
                    if diff > 0:
                        stats[sid]["total_minutes"] += diff
                except Exception:
                    pass
    return stats


# ---------------------------------------------------------------------------
# Users (owner/manager only)
# ---------------------------------------------------------------------------

class DelegationSettingIn(BaseModel):
    delegate_approvals_to_managers: bool


@router.get("/users/me")
def get_me(user: Annotated[dict, Depends(get_current_user)]):
    result = dict(user)
    db = get_admin_client()
    if user["role"] == "owner":
        result["managers_can_delete"] = True
    elif user["role"] == "manager":
        owners = db.table("profiles").select("delegate_approvals_to_managers").eq("role", "owner").execute()
        result["managers_can_delete"] = any(r.get("delegate_approvals_to_managers") for r in (owners.data or []))
    else:
        result["managers_can_delete"] = False
    return result


@router.patch("/users/me/settings")
def update_my_settings(
    body: DelegationSettingIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="רק בעלים יכולים לשנות הגדרה זו")
    db = get_admin_client()
    db.table("profiles").update({"delegate_approvals_to_managers": body.delegate_approvals_to_managers}).eq("id", user["id"]).execute()
    invalidate_approver_ids_cache()
    return {"ok": True}


class MyProfileIn(BaseModel):
    full_name: str


@router.patch("/users/me/profile")
def update_my_profile(
    body: MyProfileIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    name = body.full_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="שם לא יכול להיות ריק")
    db = get_admin_client()
    db.table("profiles").update({"full_name": name}).eq("id", user["id"]).execute()
    invalidate_profile_cache(user["id"])
    return {"ok": True}


@router.get("/users/all")
def list_users(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    rows = db.table("profiles").select("*").order("full_name").execute()
    return rows.data


@router.post("/users/invite")
def invite_user(
    body: UserInviteIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    app_url = os.getenv("APP_URL", "http://localhost:5173")
    result = db.auth.admin.invite_user_by_email(
        body.email,
        {
            "data": {"full_name": body.full_name or "", "role": body.role},
            "redirect_to": f"{app_url}/set-password",
        },
    )
    user_id = str(result.user.id)
    db.table("profiles").update({"status": "pending"}).eq("id", user_id).execute()
    return {"ok": True, "user_id": user_id}


@router.post("/users/me/setup-complete")
def setup_complete(user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    db.table("profiles").update({"status": "active"}).eq("id", user["id"]).execute()
    return {"ok": True}


@router.patch("/users/{user_id}/role")
def update_role(
    user_id: str,
    body: UserRoleIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_owner(user)
    if body.role not in ("owner", "manager", "advisor"):
        raise HTTPException(status_code=400, detail="תפקיד לא חוקי")
    db = get_admin_client()
    db.table("profiles").update({"role": body.role}).eq("id", user_id).execute()
    invalidate_profile_cache(user_id)
    invalidate_approver_ids_cache()
    return {"ok": True}


class UserProfileUpdateIn(BaseModel):
    full_name: str | None = None


@router.patch("/users/{user_id}")
def update_user_profile(
    user_id: str,
    body: UserProfileUpdateIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if data:
        db.table("profiles").update(data).eq("id", user_id).execute()
        invalidate_profile_cache(user_id)
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_owner(user)
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="לא ניתן למחוק את המשתמש הנוכחי")
    db = get_admin_client()
    db.auth.admin.delete_user(user_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Check logs
# ---------------------------------------------------------------------------

@router.get("/{school_id}/logs")
def list_logs(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    logs = []
    for attempt in range(2):
        try:
            rows = (
                db.table("check_logs")
                .select("*")
                .eq("school_id", school_id)
                .order("run_at", desc=True)
                .execute()
            )
            logs = rows.data or []
            break  # success
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_logs attempt 1 failed: %s — retrying", exc)
                time.sleep(0.3)
            else:
                logger.error("list_logs failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not logs:
        return []
    # Enrich with profile data via a separate simple query (avoids PostgREST join issues)
    user_ids = list({r["run_by"] for r in logs if r.get("run_by")})
    if user_ids:
        p_rows = (
            db.table("profiles")
            .select("id, full_name, email")
            .in_("id", user_ids)
            .execute()
        )
        profiles_map = {p["id"]: p for p in (p_rows.data or [])}
        for row in logs:
            row["profiles"] = profiles_map.get(row.get("run_by"))
    return logs


@router.get("/{school_id}/logs/{log_id}")
def get_log(
    school_id: str,
    log_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    row = db.table("check_logs").select("*").eq("id", log_id).eq("school_id", school_id).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="הבדיקה לא נמצאה")
    return row.data[0]


def _can_delete_check_log(user: dict, db) -> bool:
    if user["role"] == "owner":
        return True
    if user["role"] == "manager":
        owners = db.table("profiles").select("delegate_approvals_to_managers").eq("role", "owner").execute()
        return any(r.get("delegate_approvals_to_managers") for r in (owners.data or []))
    return False


@router.delete("/{school_id}/logs/{log_id}")
def delete_log(
    school_id: str,
    log_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    db = get_admin_client()
    if not _can_delete_check_log(user, db):
        raise HTTPException(status_code=403, detail="אין הרשאה למחיקת בדיקות")
    # Delete stored files from Supabase Storage before removing the DB record
    log_row = db.table("check_logs").select("summary").eq("id", log_id).single().execute()
    if log_row.data:
        stored_paths = (log_row.data.get("summary") or {}).get("stored_file_paths") or []
        if stored_paths:
            try:
                keys = [sp["path"] if isinstance(sp, dict) else sp for sp in stored_paths]
                db.storage.from_("check-files").remove(keys)
            except Exception as exc:
                logger.warning("Storage cleanup failed for log %s: %s", log_id, exc)
    db.table("check_logs").delete().eq("id", log_id).eq("school_id", school_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Bulk import from Excel
# ---------------------------------------------------------------------------

DIVISION_HEB_MAP = {
    "חטיבה עליונה": "tikkon", "תיכון": "tikkon", "tikkon": "tikkon",
    "חטיבת ביניים": "beinayim", "ביניים": "beinayim", "beinayim": "beinayim",
    "יסודי": "yesodi", "yesodi": "yesodi",
    "אחר": "other", "other": "other",
}


@router.post("/import")
async def import_schools(
    file: UploadFile,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    if not (file.filename or "").lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "יש להעלות קובץ Excel בלבד (.xlsx)")

    content = await file.read()
    wb = load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"imported": 0, "errors": ["הקובץ ריק"]}

    # Skip header row if first cell looks like a column title
    first_cell = str(rows[0][0] or "").strip()
    start = 1 if first_cell in ("שם בית ספר", "שם", "name", "Name") else 0

    db = get_admin_client()
    imported = 0
    errors = []

    for i, row in enumerate(rows[start:], start=start + 2):
        name = str(row[0] or "").strip() if len(row) > 0 else ""
        symbol = str(row[1] or "").strip().split(".")[0] if len(row) > 1 else ""
        city = str(row[2] or "").strip() if len(row) > 2 else ""
        notes = str(row[3] or "").strip() if len(row) > 3 else ""
        divisions_raw = str(row[4] or "").strip() if len(row) > 4 else ""

        if not name:
            continue

        if not symbol or not symbol.isdigit() or len(symbol) not in (5, 6):
            errors.append(f"שורה {i}: סמל מוסד לא תקין — '{symbol}'")
            continue

        try:
            school_data: dict = {"name": name, "symbol": symbol}
            if city:
                school_data["city"] = city
            if notes:
                school_data["notes"] = notes

            res = db.table("schools").insert(school_data).execute()
            school_id = res.data[0]["id"]

            if divisions_raw:
                for div_str in divisions_raw.split(","):
                    div_type = DIVISION_HEB_MAP.get(div_str.strip())
                    if div_type:
                        try:
                            db.table("gefen_accounts").insert(
                                {"school_id": school_id, "division_type": div_type}
                            ).execute()
                        except Exception:
                            pass

            imported += 1
        except Exception as exc:
            errors.append(f"שורה {i}: {str(exc)[:80]}")

    return {"imported": imported, "errors": errors}


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

@router.get("/{school_id}/meetings")
def list_meetings(school_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    res = db.table("meetings").select("*").eq("school_id", school_id).order("created_at", desc=True).execute()
    meetings = res.data or []

    # Collect all referenced advisor IDs (new array field + legacy single field)
    all_ids: set[str] = set()
    for m in meetings:
        for uid in (m.get("advisor_ids") or []):
            all_ids.add(uid)
        if m.get("advisor_id"):
            all_ids.add(m["advisor_id"])

    if all_ids:
        profiles = db.table("profiles").select("id, full_name, email").in_("id", list(all_ids)).execute().data or []
        profiles_map = {p["id"]: p for p in profiles}
        for m in meetings:
            ids = m.get("advisor_ids") or []
            if not ids and m.get("advisor_id"):  # backward compat: single advisor
                ids = [m["advisor_id"]]
            m["advisor_profiles"] = [profiles_map[uid] for uid in ids if uid in profiles_map]
    else:
        for m in meetings:
            m["advisor_profiles"] = []

    return meetings


@router.post("/{school_id}/meetings")
def create_meeting(school_id: str, body: MeetingIn, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    data = {
        "school_id": school_id,
        "created_by": user["id"],
        "status": body.status or "scheduled",
        "reminder_enabled": body.reminder_enabled if body.reminder_enabled is not None else False,
        "participants": body.participants if body.participants is not None else [],
    }
    if body.meeting_date: data["meeting_date"] = body.meeting_date
    if body.start_time: data["start_time"] = body.start_time
    if body.end_time: data["end_time"] = body.end_time
    if body.meeting_type: data["meeting_type"] = body.meeting_type
    if body.actual_duration: data["actual_duration"] = body.actual_duration
    if body.notes: data["notes"] = body.notes
    # advisor_ids takes precedence; fall back to legacy advisor_id
    if body.advisor_ids is not None:
        data["advisor_ids"] = body.advisor_ids
    elif body.advisor_id:
        data["advisor_ids"] = [body.advisor_id]
    else:
        data["advisor_ids"] = []
    try:
        res = db.table("meetings").insert(data).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"שגיאת DB: {str(e)}")


@router.put("/{school_id}/meetings/{meeting_id}")
def update_meeting(school_id: str, meeting_id: str, body: MeetingIn, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    data = {
        "status": body.status or "scheduled",
        "reminder_enabled": body.reminder_enabled if body.reminder_enabled is not None else False,
        "participants": body.participants if body.participants is not None else [],
    }
    if body.meeting_date: data["meeting_date"] = body.meeting_date
    if body.start_time: data["start_time"] = body.start_time
    if body.end_time: data["end_time"] = body.end_time
    if body.meeting_type: data["meeting_type"] = body.meeting_type
    if body.actual_duration: data["actual_duration"] = body.actual_duration
    if body.notes: data["notes"] = body.notes
    # advisor_ids takes precedence; fall back to legacy advisor_id
    if body.advisor_ids is not None:
        data["advisor_ids"] = body.advisor_ids
    elif body.advisor_id:
        data["advisor_ids"] = [body.advisor_id]
    else:
        data["advisor_ids"] = []
    try:
        res = db.table("meetings").update(data).eq("id", meeting_id).eq("school_id", school_id).execute()
        return res.data[0] if res.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"שגיאת DB: {str(e)}")


@router.delete("/{school_id}/meetings/{meeting_id}")
def delete_meeting(school_id: str, meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    db.table("meetings").delete().eq("id", meeting_id).eq("school_id", school_id).execute()
    return {"ok": True}


class MentionIn(BaseModel):
    mentioned_user_ids: list[str]
    note_preview: str | None = None


@router.post("/{school_id}/meetings/{meeting_id}/mentions")
def create_mentions(school_id: str, meeting_id: str, body: MentionIn, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    rows = [
        {
            "recipient_id": uid,
            "sender_id": user["id"],
            "school_id": school_id,
            "meeting_id": meeting_id,
            "note_preview": body.note_preview,
        }
        for uid in body.mentioned_user_ids
        if uid != user["id"]
    ]
    if rows:
        db.table("mention_notifications").insert(rows).execute()
    return {"ok": True, "sent": len(rows)}
