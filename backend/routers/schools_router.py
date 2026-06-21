import io
import logging
import os
import smtplib
import time
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait, FIRST_COMPLETED
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from openpyxl import load_workbook
from pydantic import BaseModel

from auth import get_current_user, invalidate_profile_cache
from supabase_client import get_admin_client, reset_admin_client

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
    is_advisor = user["role"] not in ("owner", "manager")
    schools = []

    for attempt in range(2):
        try:
            db = get_admin_client()

            if is_advisor:
                # Q_pre: fetch only this advisor's assigned school IDs (fast, indexed)
                assigned = db.table("advisor_schools").select("school_id").eq("advisor_id", user["id"]).execute()
                assigned_ids = [r["school_id"] for r in (assigned.data or [])]

                # Q1 (advisor): DB-side filter — only return schools this advisor can see
                filters = [
                    "restrict_access_to.is.null",                    # open to everyone
                    f'restrict_access_to.cs.["{user["id"]}"]',       # advisor explicitly in restrict list
                ]
                if assigned_ids:
                    filters.append(f"id.in.({','.join(assigned_ids)})")  # directly assigned

                all_res = (
                    db.table("schools")
                    .select("*, gefen_accounts(*), advisor_schools(advisor_id)")
                    .eq("org_id", user["org_id"])
                    .or_(",".join(filters))
                    .order("name")
                    .execute()
                )
            else:
                # Q1 (manager/owner): fetch all schools within their org
                all_res = (
                    db.table("schools")
                    .select("*, gefen_accounts(*), advisor_schools(advisor_id)")
                    .eq("org_id", user["org_id"])
                    .order("name")
                    .execute()
                )

            schools = all_res.data or []
            break  # success
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_schools attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_schools failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    # Enrich Q3 (profiles) and Q4 (meetings stats) sequentially — safer with 3s timeout
    db = get_admin_client()
    all_advisor_ids = list({
        row["advisor_id"]
        for s in schools
        for row in (s.get("advisor_schools") or [])
        if row.get("advisor_id")
    })
    school_ids = [s["id"] for s in schools]

    profiles_map: dict = {}
    m_stats: dict = {}

    if all_advisor_ids:
        try:
            p_rows = db.table("profiles").select("id, full_name, email").in_("id", all_advisor_ids).execute()
            profiles_map = {p["id"]: p for p in (p_rows.data or [])}
        except Exception as exc:
            logger.warning("profiles enrichment failed (non-fatal): %s", exc)

    if school_ids:
        try:
            stats_res = db.rpc("get_meetings_stats", {"school_ids": school_ids}).execute()
            m_stats = {
                r["school_id"]: {"completed": r["completed"], "total_minutes": r["total_minutes"]}
                for r in (stats_res.data or [])
            }
        except Exception as exc:
            logger.warning("meetings stats enrichment failed (non-fatal): %s", exc)

    for school in schools:
        for row in (school.get("advisor_schools") or []):
            row["profiles"] = profiles_map.get(row["advisor_id"])
        school["meetings_stats"] = m_stats.get(school["id"])

    return schools


@router.post("/")
def create_school(
    body: SchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    payload = body.model_dump(exclude_none=True)
    payload["org_id"] = user["org_id"]
    row = db.table("schools").insert(payload).execute()
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
        .eq("org_id", user["org_id"])
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
    db.table("schools").delete().eq("id", school_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Gefen accounts (divisions)
# ---------------------------------------------------------------------------

@router.get("/{school_id}/accounts")
def list_accounts(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    for attempt in range(2):
        try:
            db = get_admin_client()
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
                logger.warning("list_accounts attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
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
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("advisor_schools")
                .select("advisor_id, profiles(id, email, full_name, role)")
                .eq("school_id", school_id)
                .execute()
            )
            return [r["profiles"] for r in rows.data if r.get("profiles")]
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_advisors attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_advisors failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


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


_approver_ids_cache: dict[str, tuple[list[str], float]] = {}
_APPROVER_TTL = 300  # 5 minutes


def invalidate_approver_ids_cache() -> None:
    global _approver_ids_cache
    _approver_ids_cache = {}


def _get_approver_ids(db, org_id: str) -> list[str]:
    """Return IDs of who should receive approval notifications within an org.
    If any owner has delegate_approvals_to_managers=True, include managers too.
    Result cached per org for 5 minutes.
    """
    global _approver_ids_cache
    now = time.monotonic()
    cached = _approver_ids_cache.get(org_id)
    if cached and (now - cached[1]) < _APPROVER_TTL:
        return cached[0]

    all_candidates = (
        db.table("profiles")
        .select("id, role, delegate_approvals_to_managers")
        .in_("role", ["owner", "manager"])
        .eq("org_id", org_id)
        .execute()
    )
    candidates = all_candidates.data or []
    owners = [r for r in candidates if r["role"] == "owner"]
    managers = [r for r in candidates if r["role"] == "manager"]
    ids = [r["id"] for r in owners]
    if any(r.get("delegate_approvals_to_managers") for r in owners):
        ids += [r["id"] for r in managers]
    _approver_ids_cache[org_id] = (ids, now)
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
    for attempt in range(2):
        try:
            db = get_admin_client()
            if user["role"] in ("owner", "manager"):
                school_ids_res = db.table("schools").select("id").eq("org_id", user["org_id"]).execute()
                school_ids = [r["id"] for r in (school_ids_res.data or [])]
                if not school_ids:
                    return []
                rows = (
                    db.table("school_update_requests")
                    .select("*, schools(name), requester:profiles!requester_id(full_name, email)")
                    .in_("school_id", school_ids)
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
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_update_requests attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_update_requests failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


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
    items = []

    for attempt in range(2):
        try:
            db = get_admin_client()
            items = []

            # Approval requests (for approvers)
            if user["role"] in ("owner", "manager"):
                approver_ids = _get_approver_ids(db, user["org_id"])
                if user["id"] in approver_ids:
                    school_ids_res = db.table("schools").select("id").eq("org_id", user["org_id"]).execute()
                    org_school_ids = [r["id"] for r in (school_ids_res.data or [])]
                    if org_school_ids:
                        rows = (
                            db.table("school_update_requests")
                            .select("*, schools(name), requester:profiles!requester_id(full_name, email)")
                            .in_("school_id", org_school_ids)
                            .eq("status", "pending")
                            .order("created_at", desc=True)
                            .execute()
                        )
                    else:
                        rows = type("_empty", (), {"data": []})()

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
            break  # success
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_notifications attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("get_notifications failed after 2 attempts: %s", exc)
                return {"count": 0, "items": []}  # silent fallback — not critical

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

    # managers_can_delete — DB call only for manager role
    if user["role"] == "owner":
        result["managers_can_delete"] = True
    elif user["role"] == "manager":
        for attempt in range(2):
            try:
                db = get_admin_client()
                owners = (
                    db.table("profiles")
                    .select("delegate_approvals_to_managers")
                    .eq("role", "owner")
                    .eq("org_id", user["org_id"])
                    .execute()
                )
                result["managers_can_delete"] = any(r.get("delegate_approvals_to_managers") for r in (owners.data or []))
                break
            except Exception as exc:
                if attempt == 0:
                    logger.warning("get_me managers_can_delete attempt 1 failed: %s — resetting", exc)
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.warning("get_me managers_can_delete failed after 2 attempts: %s", exc)
                    result["managers_can_delete"] = False
    else:
        result["managers_can_delete"] = False

    # org subscription info
    if user.get("org_id"):
        for attempt in range(2):
            try:
                db = get_admin_client()
                org_res = (
                    db.table("organizations")
                    .select("subscription_status, trial_started_at, trial_ends_at, name")
                    .eq("id", user["org_id"])
                    .single()
                    .execute()
                )
                result["org"] = org_res.data or {}
                break
            except Exception as exc:
                if attempt == 0:
                    logger.warning("get_me org fetch attempt 1 failed: %s — resetting", exc)
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.warning("get_me org fetch failed after 2 attempts: %s", exc)
                    result["org"] = {}

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


class OnboardingDismissIn(BaseModel):
    key: str  # "add_school" | "add_user"


@router.patch("/users/me/onboarding")
def dismiss_onboarding(
    body: OnboardingDismissIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    if body.key not in {"add_school", "add_user"}:
        raise HTTPException(status_code=400, detail="מפתח לא חוקי")
    db = get_admin_client()
    merged = {**(user.get("onboarding_dismissed") or {}), body.key: True}
    db.table("profiles").update({"onboarding_dismissed": merged}).eq("id", user["id"]).execute()
    invalidate_profile_cache(user["id"])
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
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = db.table("profiles").select("*").eq("org_id", user["org_id"]).order("full_name").execute()
            return rows.data
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_users attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_users failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.post("/users/invite")
def invite_user(
    body: UserInviteIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    app_url = os.getenv("APP_URL", "https://gefenai.co.il")
    for attempt in range(2):
        try:
            db = get_admin_client()
            result = db.auth.admin.invite_user_by_email(
                body.email,
                {
                    "data": {"full_name": body.full_name or "", "role": body.role},
                    "redirect_to": f"{app_url}/set-password",
                },
            )
            user_id = str(result.user.id)
            db.table("profiles").upsert({
                "id": user_id,
                "email": body.email,
                "full_name": body.full_name or "",
                "role": body.role,
                "org_id": user["org_id"],
                "status": "pending",
            }).execute()
            return {"ok": True, "user_id": user_id}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("invite_user attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("invite_user failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


def _send_reinvite_email(to_email: str, full_name: str, action_link: str):
    gmail_user = os.getenv("GMAIL_USER", "")
    gmail_password = os.getenv("GMAIL_APP_PASSWORD", "")
    if not gmail_user or not gmail_password:
        logger.warning("Gmail not configured — skipping reinvite email to %s", to_email)
        return
    greeting = f"שלום {full_name}," if full_name else "שלום,"
    html = f"""
<html>
<body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b;
                       background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 520px; margin: 0 auto; background: white;
              border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 14px; font-weight: 700;">גפן AI</p>
      <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.8); font-size: 12px;">הזמנה למערכת</p>
    </div>
    <div style="padding: 28px 24px;">
      <p style="margin: 0 0 16px 0; font-size: 15px;">{greeting}</p>
      <p style="margin: 0 0 24px 0; color: #334155; line-height: 1.6;">
        קיבלת הזמנה להצטרף למערכת גפן AI.<br>
        לחץ על הכפתור למטה כדי להגדיר סיסמה ולהשלים את הרישום.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="{action_link}"
           style="display: inline-block; background: #0070F3; color: white;
                  font-size: 14px; font-weight: 700; padding: 12px 28px;
                  border-radius: 8px; text-decoration: none;">
          הגדרת סיסמה וכניסה למערכת
        </a>
      </div>
      <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">
        הקישור תקף ל-24 שעות. אם לא ביקשת הזמנה זו, ניתן להתעלם ממייל זה.
      </p>
    </div>
    <div style="background: #f1f5f9; padding: 12px 24px; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">נשלח מגפן AI</p>
    </div>
  </div>
</body>
</html>"""
    msg = MIMEMultipart()
    msg["From"] = f"גפן AI <{gmail_user}>"
    msg["To"] = to_email
    msg["Subject"] = "הזמנה למערכת גפן AI"
    msg.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.login(gmail_user, gmail_password)
        server.send_message(msg)


@router.post("/users/{user_id}/resend-invite")
def resend_invite(
    user_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    app_url = os.getenv("APP_URL", "http://localhost:5173")
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = db.table("profiles").select("email, org_id, full_name, role, status").eq("id", user_id).execute()
            if not target.data or target.data[0].get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            profile = target.data[0]
            if profile.get("status") != "pending":
                raise HTTPException(status_code=400, detail="המשתמש כבר פעיל — לא ניתן לשלוח הזמנה מחדש")
            # Use REST API directly — works even when the user already confirmed
            # their email (invite_user_by_email fails with "User already registered")
            supabase_url = os.getenv("SUPABASE_URL", "")
            service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
            resp = httpx.post(
                f"{supabase_url}/auth/v1/admin/generate_link",
                headers={
                    "apikey": service_key,
                    "Authorization": f"Bearer {service_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "type": "recovery",
                    "email": profile["email"],
                    "redirect_to": f"{app_url}/set-password",
                },
                timeout=10,
            )
            resp.raise_for_status()
            action_link = resp.json()["action_link"]
            _send_reinvite_email(profile["email"], profile.get("full_name") or "", action_link)
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("resend_invite attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("resend_invite failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    return {"ok": True}


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
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = db.table("profiles").select("org_id").eq("id", user_id).execute()
            if not target.data or target.data[0].get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            db.table("profiles").update({"role": body.role}).eq("id", user_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("update_role attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("update_role failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
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
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        return {"ok": True}
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = db.table("profiles").select("org_id").eq("id", user_id).execute()
            if not target.data or target.data[0].get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            db.table("profiles").update(data).eq("id", user_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("update_user_profile attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("update_user_profile failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
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
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = db.table("profiles").select("org_id").eq("id", user_id).execute()
            if not target.data or target.data[0].get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            db.auth.admin.delete_user(user_id)
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("delete_user attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("delete_user failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Check logs
# ---------------------------------------------------------------------------

@router.get("/{school_id}/logs")
def list_logs(
    school_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    logs = []
    for attempt in range(2):
        try:
            db = get_admin_client()
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
                logger.warning("list_logs attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_logs failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not logs:
        return []
    # Enrich with profile data (non-fatal — logs returned even if enrichment fails)
    user_ids = list({r["run_by"] for r in logs if r.get("run_by")})
    if user_ids:
        try:
            db = get_admin_client()
            p_rows = (
                db.table("profiles")
                .select("id, full_name, email")
                .in_("id", user_ids)
                .execute()
            )
            profiles_map = {p["id"]: p for p in (p_rows.data or [])}
            for row in logs:
                row["profiles"] = profiles_map.get(row.get("run_by"))
        except Exception as exc:
            logger.warning("list_logs profile enrichment failed (non-fatal): %s", exc)
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
    log_row = db.table("check_logs").select("summary").eq("id", log_id).eq("school_id", school_id).execute()
    if log_row.data:
        stored_paths = (log_row.data[0].get("summary") or {}).get("stored_file_paths") or []
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
            school_data: dict = {"name": name, "symbol": symbol, "org_id": user["org_id"]}
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
    meetings = []
    for attempt in range(2):
        try:
            db = get_admin_client()
            res = db.table("meetings").select("*").eq("school_id", school_id).order("created_at", desc=True).execute()
            meetings = res.data or []
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_meetings attempt 1 failed: %s — resetting client and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_meetings failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    # Collect all referenced advisor IDs (new array field + legacy single field)
    all_ids: set[str] = set()
    for m in meetings:
        for uid in (m.get("advisor_ids") or []):
            all_ids.add(uid)
        if m.get("advisor_id"):
            all_ids.add(m["advisor_id"])

    if all_ids:
        try:
            db = get_admin_client()
            profiles = db.table("profiles").select("id, full_name, email").in_("id", list(all_ids)).execute().data or []
            profiles_map = {p["id"]: p for p in profiles}
            for m in meetings:
                ids = m.get("advisor_ids") or []
                if not ids and m.get("advisor_id"):  # backward compat: single advisor
                    ids = [m["advisor_id"]]
                m["advisor_profiles"] = [profiles_map[uid] for uid in ids if uid in profiles_map]
        except Exception as exc:
            logger.warning("list_meetings profile enrichment failed (non-fatal): %s", exc)
            for m in meetings:
                m["advisor_profiles"] = []
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
