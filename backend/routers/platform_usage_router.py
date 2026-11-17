"""Superadmin "שימוש ומכסות": Resend / Supabase / Render capacity, a daily automatic check that
alerts before a limit is reached, and the weekly manual check (Supabase egress + log ingestion,
which no API exposes) that Claude records from the owner's screenshots.

Cron: pg_cron `platform-hourly-tick` calls POST /platform/hourly-tick every hour; the code decides
by Israel time what is due (daily check at 07:00 Sun-Thu, manual-check reminders at 09/12/15)."""
import logging
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from routers.signup_router import _require_superadmin, _send_simple_email
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

IL_TZ = ZoneInfo("Asia/Jerusalem")
CRON_SECRET = os.getenv("CRON_SECRET", "")
APP_URL = os.getenv("APP_URL", "http://localhost:5173")
ALERT_EMAIL = "geffen360@gmail.com"
MANUAL_REMINDER_EMAIL = "support@gefenai.co.il"

SUPABASE_PRO_DB_BYTES = 8 * 1024 ** 3
SUPABASE_PRO_STORAGE_BYTES = 100 * 1024 ** 3
SUPABASE_USAGE_URL = "https://supabase.com/dashboard/org/_/usage"
RENDER_OVERAGE_PER_GB = 0.15

WORKDAYS = {6, 0, 1, 2, 3}  # Python weekday(): Sun=6, Mon=0 … Thu=3
DAILY_CHECK_HOUR = 7
MANUAL_REMINDER_HOURS = (9, 12, 15)
RESEND_ALERT_LEVELS = (70, 85, 95)
EMAIL_LOG_RETENTION_DAYS = 400


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _require_cron(request: Request):
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


def _now_il() -> datetime:
    return datetime.now(IL_TZ)


def _settings(db) -> dict:
    rows = db.table("platform_settings").select("*").eq("id", 1).execute().data or []
    return rows[0] if rows else {"id": 1, "resend_monthly_limit": 50000, "resend_cycle_day": 12,
                                 "render_included_bandwidth_gb": 5, "alert_state": {}}


def _cycle_bounds(cycle_day: int, now: datetime) -> tuple[datetime, datetime]:
    """Resend's monthly quota renews on the billing day, not the 1st."""
    start = now.replace(day=cycle_day, hour=0, minute=0, second=0, microsecond=0)
    if now < start:
        start = (start.replace(day=1) - timedelta(days=1)).replace(day=cycle_day)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=cycle_day)
    return start, end


def _week_start(now: datetime) -> date:
    """The Sunday of the current Israeli work week."""
    return now.date() - timedelta(days=(now.weekday() + 1) % 7)


# ---------------------------------------------------------------------------
# Data sources — each returns its own section and never raises (one failing source must not
# hide the others).
# ---------------------------------------------------------------------------

def _resend_section(db, settings: dict, now: datetime) -> dict:
    limit = int(settings.get("resend_monthly_limit") or 50000)
    start, end = _cycle_bounds(int(settings.get("resend_cycle_day") or 12), now)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    out: dict = {"limit": limit, "cycle_start": start.date().isoformat(), "renews_on": end.date().isoformat(),
                 "days_left": max((end.date() - now.date()).days, 0), "orgs": []}
    try:
        rows = db.rpc("platform_email_usage", {"p_cycle_start": start.isoformat(),
                                               "p_today_start": today_start.isoformat()}).execute().data or []
        counted = sum(r["cycle_count"] for r in rows)
        latest = (db.table("email_send_log").select("resend_monthly_used, sent_at")
                  .gte("sent_at", start.isoformat()).not_.is_("resend_monthly_used", "null")
                  .order("sent_at", desc=True).limit(1).execute().data or [])
        # Resend's own number covers every sender on the account; ours covers what we logged.
        used = max(counted, latest[0]["resend_monthly_used"]) if latest else counted
        days_elapsed = max((now - start).total_seconds() / 86400, 1)
        days_total = (end - start).total_seconds() / 86400
        daily_rate = used / days_elapsed
        projected = round(daily_rate * days_total)
        org_names = {}
        org_ids = list({r["org_id"] for r in rows if r.get("org_id")})
        if org_ids:
            org_names = {o["id"]: o.get("name") for o in
                         (db.table("organizations").select("id, name").in_("id", org_ids).execute().data or [])}
        by_org: dict = {}
        for r in rows:
            o = by_org.setdefault(r.get("org_id"), {"org_id": r.get("org_id"),
                                                    "name": org_names.get(r.get("org_id")) or "ללא ארגון",
                                                    "cycle": 0, "today": 0, "week": 0, "by_kind": {}})
            o["cycle"] += r["cycle_count"]
            o["today"] += r["today_count"]
            o["week"] += r["week_count"]
            o["by_kind"][r.get("kind") or "other"] = o["by_kind"].get(r.get("kind") or "other", 0) + r["cycle_count"]
        out.update({
            "used": used, "counted": counted,
            "resend_reported": latest[0]["resend_monthly_used"] if latest else None,
            "pct": round(used * 100 / limit, 1) if limit else 0,
            "daily_rate": round(daily_rate, 1), "projected": projected,
            "orgs": sorted(by_org.values(), key=lambda o: -o["cycle"]),
        })
    except Exception as exc:
        logger.warning("platform usage: resend section failed (non-fatal): %s", exc)
        out["error"] = "שגיאה בטעינת נתוני המיילים"
    return out


_METRIC_RE = re.compile(r"^(node_memory_(?:MemTotal|MemAvailable|SwapTotal|SwapFree|Committed_AS)_bytes)\{[^}]*\}\s+(\S+)", re.M)


def _supabase_section(db) -> dict:
    out: dict = {"usage_url": SUPABASE_USAGE_URL}
    try:
        stats = db.rpc("platform_resource_stats", {}).execute().data or {}
        out.update({
            "db_bytes": stats.get("db_bytes"), "db_limit_bytes": SUPABASE_PRO_DB_BYTES,
            "storage_bytes": stats.get("storage_bytes"), "storage_limit_bytes": SUPABASE_PRO_STORAGE_BYTES,
            "connections": stats.get("connections"), "max_connections": stats.get("max_connections"),
        })
    except Exception as exc:
        logger.warning("platform usage: supabase stats failed (non-fatal): %s", exc)
        out["stats_error"] = True
    # Database server memory (the same numbers as the dashboard's "Memory commitment" chart).
    try:
        url, key = _env("SUPABASE_URL"), _env("SUPABASE_SERVICE_ROLE_KEY")
        resp = httpx.get(f"{url}/customer/v1/privileged/metrics", auth=("service_role", key), timeout=15)
        resp.raise_for_status()
        m = {name: float(val) for name, val in _METRIC_RE.findall(resp.text)}
        total = m.get("node_memory_MemTotal_bytes")
        committed = m.get("node_memory_Committed_AS_bytes")
        if total and committed is not None:
            # Supabase marks SEVERE above 90% of physical RAM plus 1 GiB.
            severe_at = 0.9 * total + 1024 ** 3
            out["memory"] = {
                "total_bytes": total,
                "available_bytes": m.get("node_memory_MemAvailable_bytes"),
                "swap_used_bytes": (m.get("node_memory_SwapTotal_bytes") or 0) - (m.get("node_memory_SwapFree_bytes") or 0),
                "committed_bytes": committed, "severe_at_bytes": severe_at,
                "commit_pct_of_severe": round(committed * 100 / severe_at, 1),
            }
    except Exception as exc:
        logger.warning("platform usage: supabase memory metrics failed (non-fatal): %s", exc)
    # API requests per day — a proxy for how fast log ingestion grows.
    try:
        ref = re.sub(r"^https://([^.]+)\..*$", r"\1", _env("SUPABASE_URL"))
        pat = _env("SUPABASE_PAT")
        if pat:
            resp = httpx.get(f"https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/usage.api-counts",
                             params={"interval": "7day"}, headers={"Authorization": f"Bearer {pat}"}, timeout=20)
            resp.raise_for_status()
            out["requests_per_day"] = [
                {"date": (r.get("timestamp") or "")[:10],
                 "total": sum(int(r.get(k) or 0) for k in ("total_auth_requests", "total_rest_requests",
                                                          "total_storage_requests", "total_realtime_requests"))}
                for r in (resp.json().get("result") or [])
            ]
    except Exception as exc:
        logger.warning("platform usage: supabase api counts failed (non-fatal): %s", exc)
    return out


def _render_ts(dt: datetime) -> str:
    # Render's metrics API rejects "+00:00" offsets (400) and accepts only the "Z" form.
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _render_metric_total(path: str, params: dict, key: str) -> list:
    resp = httpx.get(f"https://api.render.com/v1/metrics/{path}", params=params,
                     headers={"Authorization": f"Bearer {key}", "Accept": "application/json"}, timeout=20)
    resp.raise_for_status()
    return resp.json() or []


def _render_section(settings: dict, now: datetime) -> dict:
    key, ids = _env("RENDER_API_KEY"), [s.strip() for s in _env("RENDER_SERVICE_IDS").split(",") if s.strip()]
    included = float(settings.get("render_included_bandwidth_gb") or 5)
    out: dict = {"configured": bool(key and ids), "included_gb": included}
    if not out["configured"]:
        return out
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    try:
        series = _render_metric_total("bandwidth", [("startTime", _render_ts(month_start)),
                                                     ("endTime", _render_ts(datetime.now(timezone.utc)))]
                                      + [("resource", i) for i in ids], key)
        # Render reports bandwidth points in MB.
        mb = sum(float(v.get("value") or 0) for s in series for v in (s.get("values") or []))
        used_gb = mb / 1024
        days_elapsed = max((now - month_start).total_seconds() / 86400, 1)
        next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
        projected_gb = used_gb / days_elapsed * (next_month - month_start).days
        out.update({"bandwidth_gb": round(used_gb, 2), "projected_gb": round(projected_gb, 1),
                    "projected_overage_usd": round(max(projected_gb - included, 0) * RENDER_OVERAGE_PER_GB, 2)})
    except Exception as exc:
        logger.warning("platform usage: render bandwidth failed (non-fatal): %s", exc)
        out["bandwidth_error"] = True
    # 7 days, not 24 h: Render is read only in the Sunday weekly check, and the last 24 h would be the quiet weekend.
    for metric in ("cpu", "memory"):
        try:
            series = _render_metric_total(metric, [("startTime", _render_ts(datetime.now(timezone.utc) - timedelta(days=7))),
                                                   ("resolutionSeconds", 3600), ("aggregationMethod", "MAX")]
                                          + [("resource", i) for i in ids], key)
            vals = [float(v.get("value") or 0) for s in series for v in (s.get("values") or [])]
            if vals:
                out[f"{metric}_max_7d"] = max(vals)
        except Exception as exc:
            logger.info("platform usage: render %s metric unavailable: %s", metric, exc)
    try:
        series = _render_metric_total("memory-limit", [("startTime", _render_ts(datetime.now(timezone.utc) - timedelta(hours=1)))]
                                      + [("resource", i) for i in ids], key)
        limits = [float(v.get("value") or 0) for s in series for v in (s.get("values") or [])]
        if limits:
            out["memory_limit_bytes"] = max(limits)
    except Exception as exc:
        logger.info("platform usage: render memory limit unavailable: %s", exc)
    return out


def _manual_checks(db, limit: int = 8) -> list:
    try:
        return (db.table("platform_manual_checks").select("*")
                .order("week_start", desc=True).limit(limit).execute().data or [])
    except Exception as exc:
        logger.warning("platform usage: manual checks read failed (non-fatal): %s", exc)
        return []


# ---------------------------------------------------------------------------
# Superadmin screen
# ---------------------------------------------------------------------------

@router.get("/usage")
def get_usage(user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            settings = _settings(db)
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_usage attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_usage failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    now = _now_il()
    return {
        "resend": _resend_section(db, settings, now),
        "supabase": _supabase_section(db),
        "render": _render_section(settings, now),
        "manual_checks": _manual_checks(db),
        "current_week_start": _week_start(now).isoformat(),
        "last_daily_check_at": settings.get("last_daily_check_at"),
        "last_daily_check_result": settings.get("last_daily_check_result"),
        "settings": {k: settings.get(k) for k in ("resend_monthly_limit", "resend_cycle_day", "render_included_bandwidth_gb")},
    }


class PlatformSettingsIn(BaseModel):
    resend_monthly_limit: int | None = Field(None, ge=100, le=10_000_000)
    resend_cycle_day: int | None = Field(None, ge=1, le=28)
    render_included_bandwidth_gb: float | None = Field(None, ge=0, le=100_000)


@router.put("/settings")
def update_settings(body: PlatformSettingsIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="לא נשלחו שינויים")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    get_admin_client().table("platform_settings").update(patch).eq("id", 1).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Daily automatic check
# ---------------------------------------------------------------------------

def _evaluate(resend: dict, supabase: dict, render: dict) -> list[dict]:
    """Each issue: {key, level, text}. `key` + `level` dedupe alerts (see _run_daily_check)."""
    issues = []
    pct = resend.get("pct")
    if pct is not None:
        reached = [lvl for lvl in RESEND_ALERT_LEVELS if pct >= lvl]
        if reached:
            issues.append({"key": f"resend:{resend['cycle_start']}", "level": reached[-1],
                           "text": f"Resend: נוצלו {resend['used']:,} מתוך {resend['limit']:,} מיילים ({pct}%). המכסה מתחדשת ב-{resend['renews_on']}."})
        elif resend.get("projected", 0) >= resend["limit"]:
            issues.append({"key": f"resend-projection:{resend['cycle_start']}", "level": 1,
                           "text": f"Resend: לפי הקצב הנוכחי ({resend['daily_rate']} ביום) יישלחו כ-{resend['projected']:,} מיילים עד {resend['renews_on']} — יותר מהמכסה ({resend['limit']:,})."})
    if supabase.get("db_bytes") and supabase["db_bytes"] >= 0.7 * SUPABASE_PRO_DB_BYTES:
        issues.append({"key": "supabase-db", "level": 70, "text": f"Supabase: מסד הנתונים הגיע ל-{supabase['db_bytes'] / 1024 ** 3:.1f}GB מתוך 8GB."})
    if supabase.get("storage_bytes") and supabase["storage_bytes"] >= 0.7 * SUPABASE_PRO_STORAGE_BYTES:
        issues.append({"key": "supabase-storage", "level": 70, "text": f"Supabase: נפח הקבצים הגיע ל-{supabase['storage_bytes'] / 1024 ** 3:.1f}GB מתוך 100GB."})
    if supabase.get("connections") and supabase.get("max_connections") and supabase["connections"] >= 0.8 * supabase["max_connections"]:
        issues.append({"key": "supabase-connections", "level": 80, "text": f"Supabase: {supabase['connections']} חיבורים פתוחים מתוך {supabase['max_connections']}."})
    mem = supabase.get("memory")
    if mem and mem["committed_bytes"] >= mem["severe_at_bytes"]:
        issues.append({"key": "supabase-memory", "level": 100,
                       "text": f"Supabase: הזיכרון של שרת המסד במצב SEVERE ({mem['committed_bytes'] / 1024 ** 3:.2f}GB מובטחים, הסף {mem['severe_at_bytes'] / 1024 ** 3:.2f}GB) — סיכון לקריסה. יש לשדרג את ה-Compute."})
    elif mem and mem["committed_bytes"] >= 0.85 * mem["severe_at_bytes"]:
        issues.append({"key": "supabase-memory", "level": 85,
                       "text": f"Supabase: הזיכרון של שרת המסד מתקרב לסף SEVERE ({mem['commit_pct_of_severe']}% מהסף)."})
    if render.get("projected_overage_usd", 0) > 10:
        issues.append({"key": f"render-bandwidth:{date.today().strftime('%Y-%m')}", "level": 1,
                       "text": f"Render: צפי תעבורה {render['projected_gb']}GB החודש — חריגה צפויה בעלות כ-${render['projected_overage_usd']} (לא משבית)."})
    return issues


def _run_daily_check(db) -> dict:
    settings = _settings(db)
    now = _now_il()
    resend, supabase, render = _resend_section(db, settings, now), _supabase_section(db), _render_section(settings, now)
    issues = _evaluate(resend, supabase, render)
    state = dict(settings.get("alert_state") or {})
    new_issues = [i for i in issues if state.get(i["key"], 0) < i["level"]]
    for i in issues:
        state[i["key"]] = max(state.get(i["key"], 0), i["level"])
    # A resolved memory/connection issue may alert again if it comes back.
    for k in ("supabase-memory", "supabase-connections"):
        if k in state and not any(i["key"] == k for i in issues):
            state.pop(k)
    if new_issues:
        lines = "".join(f"<li style='margin-bottom:6px'>{i['text']}</li>" for i in new_issues)
        html = (f"<div dir='rtl' style='font-family:Arial,sans-serif;font-size:14px;color:#1e293b'>"
                f"<p><b>הבדיקה היומית של גפן AI מצאה דברים שדורשים תשומת לב:</b></p><ul>{lines}</ul>"
                f"<p><a href='{APP_URL}/super-admin?tab=usage'>למסך שימוש ומכסות</a></p></div>")
        # Raises on failure: nothing is recorded, so hourly-tick retries within the hour.
        _send_simple_email(ALERT_EMAIL, "⚠️ גפן AI — התראת קיבולת", html, raise_errors=True)
        try:
            admins = db.table("profiles").select("id").eq("is_superadmin", True).execute().data or []
            if admins:
                db.table("notifications").insert([{
                    "recipient_id": a["id"], "type": "platform_usage_alert",
                    "data": {"title": "התראת קיבולת: " + new_issues[0]["text"]
                             + (f" (ועוד {len(new_issues) - 1})" if len(new_issues) > 1 else ""),
                             "deeplink": "/super-admin?tab=usage"},
                } for a in admins]).execute()
        except Exception as exc:
            logger.warning("platform daily check: notification insert failed (non-fatal): %s", exc)
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=EMAIL_LOG_RETENTION_DAYS)).isoformat()
        db.table("email_send_log").delete().lt("sent_at", cutoff).execute()
    except Exception as exc:
        logger.warning("platform daily check: email_send_log prune failed (non-fatal): %s", exc)
    result = {"issues": issues, "alerted": [i["key"] for i in new_issues], "at": datetime.now(timezone.utc).isoformat()}
    db.table("platform_settings").update({
        "alert_state": state, "last_daily_check_at": result["at"], "last_daily_check_result": result,
    }).eq("id", 1).execute()
    return result


@router.post("/daily-check")
def daily_check(request: Request):
    """Runs the automatic check now (testing / manual trigger). The cron path is hourly-tick."""
    _require_cron(request)
    return _run_daily_check(get_admin_client())


# ---------------------------------------------------------------------------
# Weekly manual check (screenshots → Claude → POST /platform/manual-check)
# ---------------------------------------------------------------------------

def _ensure_week_row(db, week: date) -> dict:
    rows = db.table("platform_manual_checks").select("*").eq("week_start", week.isoformat()).execute().data or []
    if rows:
        return rows[0]
    # Only week_start is sent, so a row another worker created meanwhile is left as it is.
    db.table("platform_manual_checks").upsert({"week_start": week.isoformat()}, on_conflict="week_start").execute()
    return db.table("platform_manual_checks").select("*").eq("week_start", week.isoformat()).execute().data[0]


def _manual_reminder_html() -> str:
    return f"""<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">
<p><b>הבדיקה הידנית השבועית של הקיבולת עדיין לא בוצעה.</b></p>
<ol>
<li>להיכנס ל-<a href="https://supabase.com/dashboard">supabase.com</a>.</li>
<li>ללחוץ בתפריט השמאלי על אייקון הגרף (Usage).</li>
<li>לצלם את האזור "Usage Summary" (רואים בו Egress ו-Log Ingestion).</li>
<li>לשלוח את הצילום ל-Claude ב-Claude Code ולכתוב "בדיקה שבועית".</li>
</ol>
<p>התזכורת תפסיק להישלח אחרי ש-Claude ירשום את הבדיקה.
<a href="{APP_URL}/super-admin?tab=usage">למסך שימוש ומכסות</a></p></div>"""


def _run_manual_reminder(db, now: datetime, force: bool = False) -> dict:
    if not force and (now.weekday() not in WORKDAYS or now.hour not in MANUAL_REMINDER_HOURS):
        return {"sent": False, "reason": "not_due"}
    row = _ensure_week_row(db, _week_start(now))
    if (row.get("status") or "pending") != "pending":
        return {"sent": False, "reason": "done"}
    slot = now.strftime("%Y-%m-%dT%H")
    sent_slots = list(row.get("reminders_sent") or [])
    if slot in sent_slots and not force:
        return {"sent": False, "reason": "already_sent"}
    _send_simple_email(MANUAL_REMINDER_EMAIL, "⏰ גפן AI — הבדיקה השבועית של הקיבולת ממתינה", _manual_reminder_html(),
                       raise_errors=True)
    db.table("platform_manual_checks").update({"reminders_sent": sent_slots + [slot]}).eq("id", row["id"]).execute()
    return {"sent": True}


@router.post("/manual-check-reminder")
def manual_check_reminder(request: Request, force: bool = False):
    _require_cron(request)
    return _run_manual_reminder(get_admin_client(), _now_il(), force=force)


class ManualCheckIn(BaseModel):
    status: str = Field(pattern="^(ok|attention)$")
    values: dict
    verdict: str = Field(min_length=1, max_length=4000)
    week_start: date | None = None


@router.post("/manual-check")
def record_manual_check(body: ManualCheckIn, request: Request):
    """Recorded by Claude after reading the owner's Supabase Usage screenshots (CLAUDE.md →
    "בדיקה שבועית"). Only `ok` when every value is fine; `attention` also stops the reminders."""
    _require_cron(request)
    db = get_admin_client()
    row = _ensure_week_row(db, body.week_start or _week_start(_now_il()))
    db.table("platform_manual_checks").update({
        "status": body.status, "values": body.values, "verdict": body.verdict,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", row["id"]).execute()
    return {"ok": True, "week_start": row["week_start"], "status": body.status}


# ---------------------------------------------------------------------------
# Hourly cron entry point
# ---------------------------------------------------------------------------

@router.post("/hourly-tick")
def hourly_tick(request: Request):
    _require_cron(request)
    db = get_admin_client()
    now = _now_il()
    out: dict = {}
    # From 07:00 on, until it has run today — a tick missed (deploy) or failed (email) is retried.
    if now.weekday() in WORKDAYS and now.hour >= DAILY_CHECK_HOUR:
        settings = _settings(db)
        last = settings.get("last_daily_check_at")
        if not last or datetime.fromisoformat(last).astimezone(IL_TZ).date() != now.date():
            try:
                out["daily_check"] = _run_daily_check(db)
            except Exception as exc:
                logger.error("platform hourly tick: daily check failed: %s", exc, exc_info=True)
                out["daily_check"] = {"error": str(exc)}
    try:
        out["manual_reminder"] = _run_manual_reminder(db, now)
    except Exception as exc:
        logger.error("platform hourly tick: manual reminder failed: %s", exc, exc_info=True)
        out["manual_reminder"] = {"error": str(exc)}
    return out
