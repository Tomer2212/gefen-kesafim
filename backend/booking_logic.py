import logging
import os
import time
from datetime import date

from supabase_client import get_admin_client, reset_admin_client
import graph_client

_log = logging.getLogger(__name__)


def _month_bounds(month: str) -> tuple[str, str]:
    """'2026-08' -> ('2026-08-01', '2026-08-31')."""
    year, mon = int(month[:4]), int(month[5:7])
    next_month = date(year + (mon == 12), (mon % 12) + 1, 1)
    last_day = date.fromordinal(next_month.toordinal() - 1)
    return f"{month}-01", last_day.isoformat()


def find_schools_missing_meetings(org_id: str, months: list[str]) -> list[dict]:
    """DB-level query only (Architecture Invariant #7 — no full-table Python scan):
    one bounded query for active schools, one bounded query for meetings in the date
    range, then a reduction over the already-filtered result set (same style as
    compute_upload_comparison in meeting_upload_logic.py)."""
    if not months:
        return []
    range_start, _ = _month_bounds(min(months))
    _, range_end = _month_bounds(max(months))

    for attempt in range(2):
        try:
            db = get_admin_client()
            schools = (
                db.table("schools")
                .select("id, name")
                .eq("org_id", org_id)
                .eq("status", "active")
                .execute()
                .data or []
            )
            school_ids = [s["id"] for s in schools]
            if not school_ids:
                return []
            meetings = (
                db.table("meetings")
                .select("school_id, meeting_date, status")
                .in_("school_id", school_ids)
                .gte("meeting_date", range_start)
                .lte("meeting_date", range_end)
                .in_("status", ["scheduled", "completed"])
                .execute()
                .data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                _log.warning("find_schools_missing_meetings attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("find_schools_missing_meetings failed after 2 attempts: %s", exc, exc_info=True)
                raise

    covered_months: dict[str, set] = {}
    for m in meetings:
        md = m.get("meeting_date")
        if not md:
            continue
        covered_months.setdefault(m["school_id"], set()).add(md[:7])

    results = []
    for s in schools:
        missing = [mo for mo in months if mo not in covered_months.get(s["id"], set())]
        if missing:
            results.append({"school_id": s["id"], "school_name": s["name"], "missing_months": missing})
    return results


def resolve_advisor_candidates(org_id: str, school_id: str) -> list[dict]:
    """advisor_schools + two-step join to profiles (never nested .select() joins —
    PostgREST Query Rules in CLAUDE.md)."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = db.table("advisor_schools").select("advisor_id").eq("school_id", school_id).execute().data or []
            advisor_ids = [r["advisor_id"] for r in rows]
            if not advisor_ids:
                return []
            profiles = (
                db.table("profiles")
                .select("id, full_name, email")
                .eq("org_id", org_id)
                .in_("id", advisor_ids)
                .execute()
                .data or []
            )
            return profiles
        except Exception as exc:
            if attempt == 0:
                _log.warning("resolve_advisor_candidates attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("resolve_advisor_candidates failed after 2 attempts: %s", exc, exc_info=True)
                raise


def get_org_mailbox_capability(org_id: str) -> dict:
    """{"connected": bool, "provider": "microsoft"|None}. Built so future personal-Outlook /
    Gmail-business / Gmail-personal branches can be added without changing callers."""
    try:
        db = get_admin_client()
        conn = graph_client.get_org_connection(db, org_id)
        if conn and conn.get("status") == "connected":
            return {"connected": True, "provider": "microsoft"}
    except Exception as exc:
        _log.warning("get_org_mailbox_capability failed (treated as not-connected): %s", exc)
    return {"connected": False, "provider": None}


_MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def months_label_he(months: list[str]) -> str:
    labels = [f"{_MONTH_HE[int(m[5:7]) - 1]} {m[:4]}" for m in sorted(months)]
    if len(labels) == 1:
        return labels[0]
    return " ,".join(labels[:-1]) + f" ו{labels[-1]}"


def build_booking_request_email_html(recipient_name: str, school_name: str, advisor_name: str,
                                      months: list[str], booking_url: str) -> str:
    first_name = (recipient_name or "").strip().split(" ")[0]
    greeting = f"היי {first_name}," if first_name else "היי,"
    months_label = months_label_he(months)
    advisor_clause = f" עם {advisor_name}" if advisor_name else ""
    return f"""
<html>
<body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b;
                       background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white;
              border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 14px; font-weight: 700;">גפן AI</p>
      <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.8); font-size: 12px;">קביעת פגישה</p>
    </div>
    <div style="padding: 28px 24px;">
      <p style="margin: 0 0 16px 0; font-size: 15px;">{greeting}</p>
      <p style="margin: 0 0 16px 0; color: #334155; line-height: 1.8;">
        לבית הספר <b>{school_name}</b> טרם נקבעה פגישת ליווי{advisor_clause} עבור {months_label}.
        נשמח <b>שתקבעי מועד</b> בקישור המצורף — תוכלי לבחור זמן פנוי ביומן ישירות:
      </p>
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="{booking_url}"
           style="display: inline-block; background: #0070F3; color: white;
                  font-size: 14px; font-weight: 700; padding: 12px 28px;
                  border-radius: 8px; text-decoration: none;">
          קביעת מועד לפגישה
        </a>
      </div>
    </div>
    <div style="background: #f1f5f9; padding: 12px 24px; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">נשלח אוטומטית מגפן AI</p>
    </div>
  </div>
</body>
</html>"""


def send_booking_request_email(org_id: str, advisor_id: str, to_email: str, subject: str, html: str) -> None:
    """Raises on failure (unlike the non-fatal calendar-sync functions in graph_client.py) so
    the queue-processing cron can mark the row 'failed' with the real error."""
    db = get_admin_client()
    graph_client.send_mail_as_advisor(db, org_id, advisor_id, subject, html, to_email)
