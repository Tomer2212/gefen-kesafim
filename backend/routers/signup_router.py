import hashlib
import hmac
import logging
import os
import smtplib
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

GMAIL_USER = os.getenv("GMAIL_USER", "")
GMAIL_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "")
APP_URL = os.getenv("APP_URL", "http://localhost:5173")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_superadmin(user: dict):
    if not user.get("is_superadmin"):
        raise HTTPException(status_code=403, detail="גישה מוגבלת לסופר-אדמין בלבד")


def _send_simple_email(to: str, subject: str, html: str):
    try:
        msg = MIMEMultipart()
        msg["From"] = f"גפן AI <{GMAIL_USER}>"
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(html, "html", "utf-8"))
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(GMAIL_USER, GMAIL_PASSWORD)
            server.send_message(msg)
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)


def _make_unsub_token(email: str) -> str:
    return hmac.new(SUPABASE_KEY.encode(), email.lower().encode(), hashlib.sha256).hexdigest()[:32]


def _email_footer_html(recipient_email: str) -> str:
    token = _make_unsub_token(recipient_email)
    encoded = urllib.parse.quote(recipient_email)
    unsub_url = f"{APP_URL}/unsubscribe?email={encoded}&token={token}"
    return f"""
    <div style="background: #f1f5f9; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0 0 4px 0; font-size: 12px; color: #475569; font-weight: 700;">גפן AI</p>
      <p style="margin: 0 0 6px 0; font-size: 11px; color: #94a3b8;">כתובת: המלך ג&#39;ורג&#39; 33, תל אביב</p>
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">
        <a href="{unsub_url}" style="color: #94a3b8; text-decoration: underline;">הסרה מרשימת תפוצה</a>
      </p>
    </div>"""


def _superadmin_notification_html(org_name: str, owner_name: str, owner_email: str, owner_phone: str, business_number: str, applicant_ip: str = "", applicant_ua: str = "") -> str:
    footer = _email_footer_html(owner_email)
    ip_row = f'<tr><td style="padding: 8px 0; font-weight: 700; color: #475569; width: 130px;">כתובת IP</td><td style="padding: 8px 0; color: #0f172a; font-family: monospace; font-size: 13px;">{applicant_ip or "לא זמין"}</td></tr>' if applicant_ip else ""
    ua_row = f'<tr><td style="padding: 8px 0; font-weight: 700; color: #475569; vertical-align: top;">דפדפן/מכשיר</td><td style="padding: 8px 0; color: #64748b; font-size: 12px; word-break: break-all;">{applicant_ua or "לא זמין"}</td></tr>' if applicant_ua else ""
    return f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 15px; font-weight: 700;">בקשת הרשמה חדשה</p>
      <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">גפן AI</p>
    </div>
    <div style="padding: 24px;">
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 8px 0; font-weight: 700; color: #475569; width: 130px;">שם ארגון</td><td style="padding: 8px 0; color: #0f172a;">{org_name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 700; color: #475569;">שם בעלים</td><td style="padding: 8px 0; color: #0f172a;">{owner_name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 700; color: #475569;">מייל</td><td style="padding: 8px 0; color: #0070F3;">{owner_email}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 700; color: #475569;">טלפון</td><td style="padding: 8px 0; color: #0f172a;">{owner_phone or "לא צוין"}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 700; color: #475569;">מספר עוסק</td><td style="padding: 8px 0; color: #0f172a;">{business_number}</td></tr>
        {ip_row}
        {ua_row}
      </table>
      <div style="margin-top: 24px;">
        <a href="{APP_URL}/super-admin" style="display: inline-block; background: #0070F3; color: white; font-size: 13px; font-weight: 700; padding: 10px 20px; border-radius: 8px; text-decoration: none;">לאישור / דחיית הבקשה</a>
      </div>
    </div>
    {footer}
  </div>
</body></html>"""


def _confirmation_email_html(owner_name: str, owner_email: str) -> str:
    footer = _email_footer_html(owner_email)
    return f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 15px; font-weight: 700;">קיבלנו את בקשתך!</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 15px;">שלום {owner_name},</p>
      <p style="margin: 0 0 16px 0;">קיבלנו את בקשת ההרשמה שלך למערכת גפן AI.</p>
      <p style="margin: 0 0 16px 0;">צוות גפן AI יבחן את הבקשה ויחזור אליך בהקדם עם עדכון.</p>
      <p style="margin: 0; color: #64748b; font-size: 13px;">אם יש לך שאלות, ניתן לפנות אלינו ב<a href="{APP_URL}/contact" style="color: #0070F3;">טופס יצירת קשר</a>.</p>
    </div>
    {footer}
  </div>
</body></html>"""


def _welcome_email_html(owner_name: str, action_link: str, owner_email: str) -> str:
    footer = _email_footer_html(owner_email)
    return f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 15px; font-weight: 700;">ברוכים הבאים לגפן AI!</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 15px;">שלום {owner_name},</p>
      <p style="margin: 0 0 16px 0;">שמחים לבשר לך שבקשת ההרשמה שלך <strong>אושרה</strong>.</p>
      <p style="margin: 0 0 16px 0;">לחץ על הכפתור למטה כדי להגדיר סיסמה ולהיכנס למערכת.</p>
      <p style="margin: 0 0 24px 0; color: #64748b; font-size: 13px;">הקישור בתוקף ל-24 שעות.</p>
      <a href="{action_link}" style="display: inline-block; background: #0070F3; color: white; font-size: 13px; font-weight: 700; padding: 10px 20px; border-radius: 8px; text-decoration: none;">הגדרת סיסמה וכניסה למערכת</a>
    </div>
    {footer}
  </div>
</body></html>"""


def _rejection_email_html(owner_name: str, note: str | None, owner_email: str) -> str:
    note_block = f'<p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px;">הערה: {note}</p>' if note else ""
    footer = _email_footer_html(owner_email)
    return f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #64748b; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 15px; font-weight: 700;">עדכון על בקשת ההרשמה שלך</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0;">שלום {owner_name},</p>
      <p style="margin: 0 0 16px 0;">לאחר בחינת הבקשה, לצערנו לא נוכל לאשר את ההצטרפות שלך בשלב זה.</p>
      {note_block}
      <p style="margin: 0 0 16px 0;">אם יש לך שאלות, ניתן לפנות אלינו ב<a href="{APP_URL}/contact" style="color: #0070F3;">טופס יצירת קשר</a>.</p>
    </div>
    {footer}
  </div>
</body></html>"""


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SignupApplyIn(BaseModel):
    org_name: str
    business_number: str
    owner_name: str
    owner_email: str
    owner_phone: str
    consent_contact: bool
    consent_contact_at: str
    consent_marketing: bool
    consent_marketing_at: str | None = None


class UnsubscribeIn(BaseModel):
    email: str
    token: str


class ApproveRequestIn(BaseModel):
    trial_days: int = 14


class RejectRequestIn(BaseModel):
    reviewer_note: str | None = None


class UpdateTrialIn(BaseModel):
    trial_days: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/apply")
def apply_signup(body: SignupApplyIn, request: Request):
    """Public endpoint — no auth required. Submits a new org signup request."""
    if not body.org_name.strip() or not body.owner_email.strip():
        raise HTTPException(status_code=400, detail="שם ארגון ומייל הם שדות חובה")
    if not body.consent_contact:
        raise HTTPException(status_code=400, detail="נדרש אישור לפנייה לצורך השלמת ההרשמה")

    email = body.owner_email.strip().lower()

    x_forwarded = request.headers.get("x-forwarded-for")
    applicant_ip = x_forwarded.split(",")[0].strip() if x_forwarded else (request.client.host if request.client else "unknown")
    applicant_ua = request.headers.get("user-agent", "")

    for attempt in range(2):
        try:
            db = get_admin_client()
            existing = db.table("org_signup_requests").select("id").eq("owner_email", email).eq("status", "pending").execute()
            if existing.data:
                raise HTTPException(status_code=409, detail="כבר קיימת בקשה פתוחה עם מייל זה")
            db.table("org_signup_requests").insert({
                "org_name": body.org_name.strip(),
                "business_number": body.business_number.strip(),
                "owner_name": body.owner_name.strip(),
                "owner_email": email,
                "owner_phone": body.owner_phone.strip(),
                "status": "pending",
                "consent_contact": body.consent_contact,
                "consent_contact_at": body.consent_contact_at,
                "consent_marketing": body.consent_marketing,
                "consent_marketing_at": body.consent_marketing_at,
                "applicant_ip": applicant_ip,
                "applicant_user_agent": applicant_ua,
            }).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("apply_signup attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("apply_signup failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    _send_simple_email(
        SUPPORT_EMAIL,
        f"בקשת הרשמה חדשה — {body.org_name}",
        _superadmin_notification_html(
            body.org_name, body.owner_name, email, body.owner_phone, body.business_number,
            applicant_ip, applicant_ua,
        ),
    )
    _send_simple_email(
        email,
        "קיבלנו את בקשת ההרשמה שלך לגפן AI",
        _confirmation_email_html(body.owner_name.strip(), email),
    )
    return {"ok": True}


@router.get("/requests")
def list_requests(user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = db.table("org_signup_requests").select("*").order("created_at", desc=True).execute()
            data = rows.data or []
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_requests attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_requests failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    try:
        org_ids = [r["org_id"] for r in data if r.get("org_id")]
        if org_ids:
            db = get_admin_client()
            orgs = db.table("organizations").select("id, subscription_status, trial_ends_at").in_("id", org_ids).execute()
            orgs_map = {o["id"]: o for o in (orgs.data or [])}
            for row in data:
                org = orgs_map.get(row.get("org_id"), {})
                row["org_subscription_status"] = org.get("subscription_status")
                row["org_trial_ends_at"] = org.get("trial_ends_at")
    except Exception as exc:
        logger.warning("list_requests org enrichment failed (non-fatal): %s", exc)

    return data


@router.get("/requests/{req_id}")
def get_request(req_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            row = db.table("org_signup_requests").select("*").eq("id", req_id).execute()
            if not row.data:
                raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
            return row.data[0]
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_request attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_request failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.post("/requests/{req_id}/approve")
def approve_request(
    req_id: str,
    body: ApproveRequestIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_superadmin(user)

    # Step 1: fetch the request — with retry to handle cold-start stale connections
    for attempt in range(2):
        try:
            db = get_admin_client()
            req_res = db.table("org_signup_requests").select("*").eq("id", req_id).execute()
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("approve_request fetch failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("approve_request failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not req_res.data:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    req = req_res.data[0]
    if req["status"] != "pending":
        raise HTTPException(status_code=409, detail="הבקשה כבר טופלה")

    # Step 2: write operations — use the same fresh db; no retry to prevent duplicate org creation
    try:
        trial_days = max(1, min(body.trial_days, 365))
        now_utc = datetime.now(timezone.utc)
        trial_ends = now_utc + timedelta(days=trial_days)

        # Idempotency: reuse org if a previous partial attempt already created it
        existing_org = db.table("organizations").select("id").eq("owner_email", req["owner_email"]).execute()
        if existing_org.data:
            org_id = existing_org.data[0]["id"]
        else:
            org_res = db.table("organizations").insert({
                "name": req["org_name"],
                "business_number": req["business_number"],
                "owner_name": req["owner_name"],
                "owner_email": req["owner_email"],
                "owner_phone": req["owner_phone"],
                "subscription_status": "trial",
                "trial_started_at": now_utc.isoformat(),
                "trial_ends_at": trial_ends.isoformat(),
            }).execute()
            org_id = org_res.data[0]["id"]

        link_res = db.auth.admin.generate_link({
            "type": "invite",
            "email": req["owner_email"],
            "options": {
                "data": {"full_name": req["owner_name"], "role": "owner"},
                "redirect_to": f"{APP_URL}/set-password",
            },
        })
        action_link = link_res.properties.action_link
        invited_user_id = str(link_res.user.id)

        db.table("profiles").upsert({
            "id": invited_user_id,
            "email": req["owner_email"],
            "full_name": req["owner_name"],
            "role": "owner",
            "org_id": org_id,
        }).execute()

        db.table("org_signup_requests").update({
            "status": "approved",
            "org_id": org_id,
            "reviewed_at": now_utc.isoformat(),
        }).eq("id", req_id).execute()

        _send_simple_email(
            req["owner_email"],
            "ברוכים הבאים לגפן AI — החשבון שלכם אושר!",
            _welcome_email_html(req["owner_name"], action_link, req["owner_email"]),
        )

        return {"ok": True, "org_id": org_id, "user_id": invited_user_id}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("approve_request Step 2 failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"שגיאה פנימית: {str(exc)[:200]}")


@router.post("/requests/{req_id}/reject")
def reject_request(
    req_id: str,
    body: RejectRequestIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            req_res = db.table("org_signup_requests").select("*").eq("id", req_id).execute()
            if not req_res.data:
                raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
            req = req_res.data[0]
            if req["status"] != "pending":
                raise HTTPException(status_code=409, detail="הבקשה כבר טופלה")
            db.table("org_signup_requests").update({
                "status": "rejected",
                "reviewer_note": body.reviewer_note,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", req_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("reject_request attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("reject_request failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    _send_simple_email(
        req["owner_email"],
        "עדכון על בקשת ההרשמה שלך לגפן AI",
        _rejection_email_html(req["owner_name"], body.reviewer_note, req["owner_email"]),
    )
    return {"ok": True}


@router.post("/orgs/{org_id}/activate")
def activate_org(org_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            result = db.table("organizations").update({
                "subscription_status": "active",
                "trial_started_at": None,
                "trial_ends_at": None,
            }).eq("id", org_id).execute()
            if not result.data:
                raise HTTPException(status_code=404, detail="הארגון לא נמצא")
            return {"ok": True}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("activate_org attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("activate_org failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.patch("/orgs/{org_id}/trial")
def update_trial(org_id: str, body: UpdateTrialIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    trial_days = max(1, min(body.trial_days, 3650))
    trial_ends = datetime.now(timezone.utc) + timedelta(days=trial_days)
    for attempt in range(2):
        try:
            db = get_admin_client()
            result = db.table("organizations").update({
                "subscription_status": "trial",
                "trial_ends_at": trial_ends.isoformat(),
            }).eq("id", org_id).execute()
            if not result.data:
                raise HTTPException(status_code=404, detail="הארגון לא נמצא")
            return {"ok": True, "trial_ends_at": trial_ends.isoformat()}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("update_trial attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("update_trial failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.delete("/requests/{req_id}")
def delete_org_request(req_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Superadmin only. Deletes a signup request; if it has an associated org
    (status=approved), performs a full hard-delete of the org and everything
    that belongs to it (schools, dependent rows, and every user's auth account)."""
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            req = db.table("org_signup_requests").select("id, org_id").eq("id", req_id).execute()
            if not req.data:
                raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
            org_id = req.data[0].get("org_id")

            if not org_id:
                db.table("org_signup_requests").delete().eq("id", req_id).execute()
                return {"ok": True, "deleted_org": False}

            school_ids = [s["id"] for s in (db.table("schools").select("id").eq("org_id", org_id).execute().data or [])]
            profile_ids = [p["id"] for p in (db.table("profiles").select("id").eq("org_id", org_id).execute().data or [])]

            if school_ids:
                for table in ("gefen_accounts", "check_logs", "meetings", "school_update_requests", "partial_row_updates"):
                    db.table(table).delete().in_("school_id", school_ids).execute()
                db.table("advisor_schools").delete().in_("school_id", school_ids).execute()
            if profile_ids:
                db.table("advisor_schools").delete().in_("advisor_id", profile_ids).execute()

            db.table("schools").delete().eq("org_id", org_id).execute()

            failed_user_ids = []
            for pid in profile_ids:
                try:
                    db.auth.admin.delete_user(pid)
                except Exception as exc:
                    logger.warning("delete_org_request: failed deleting user %s: %s", pid, exc)
                    failed_user_ids.append(pid)

            db.table("org_signup_requests").delete().eq("org_id", org_id).execute()
            db.table("organizations").delete().eq("id", org_id).execute()

            return {
                "ok": True,
                "deleted_org": True,
                "org_id": org_id,
                "deleted_schools": len(school_ids),
                "deleted_users": len(profile_ids) - len(failed_user_ids),
                "failed_user_ids": failed_user_ids,
            }
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("delete_org_request attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("delete_org_request failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.patch("/unsubscribe")
def unsubscribe_marketing(body: UnsubscribeIn):
    """Public endpoint — verifies HMAC token and opts the email out of marketing."""
    email = body.email.lower()
    expected = _make_unsub_token(email)
    if not hmac.compare_digest(expected, body.token):
        raise HTTPException(status_code=400, detail="קישור לא תקין")
    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("org_signup_requests").update({
                "consent_marketing": False,
                "consent_marketing_at": datetime.now(timezone.utc).isoformat(),
            }).eq("owner_email", email).execute()
            return {"ok": True}
        except Exception as exc:
            if attempt == 0:
                logger.warning("unsubscribe attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("unsubscribe failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב")
