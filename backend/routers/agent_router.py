import logging
import os
import time
from datetime import datetime, timezone
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import booking_logic
import booking_token_logic
from auth import get_current_user
from booking_draft_state import _create_draft, _get_draft, _update_draft
from supabase_client import get_admin_client, reset_admin_client

router = APIRouter()
_log = logging.getLogger(__name__)

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-5"
AGENT_PER_USER_DAILY_LIMIT = int(os.getenv("AGENT_PER_USER_DAILY_LIMIT", "20"))
MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_MESSAGES = 16

# --- Column metadata — mirrors the filter-type constants in frontend/src/pages/AdminPage.jsx
# (ADMIN_TEXT_FILTER_COLS / ADMIN_NUMBER_FILTER_COLS / ADMIN_SELECT_FILTER_OPTIONS) and
# frontend/src/pages/AdminMeetingsTab.jsx's filters. Keep these two lists in sync by hand —
# there's no shared source of truth between the Python backend and the JS frontend here.
ADMIN_TEXT_COLUMNS = ["symbol", "city", "authority", "contract_file"]
ADMIN_NUMBER_COLUMNS = [
    "meetings_completed", "meetings_hours", "requested_price", "order_amount_gefen",
    "hours_ordered", "rate", "payment_received", "payment_requests_sent", "receipts_sent",
]
ADMIN_SELECT_COLUMNS = {
    "stage": ["yesodi", "beinayim", "tikkon", "sheshshnati", "other"],
    "service_type": ["gefen", "current", "gefen_current"],
    "order_method": ["gefen", "tnufa", "tkuma", "dokati", "palg", "self_managed"],
    "contract_sent": ["yes", "no"],
    "contract_received": ["yes", "no"],
}
ADMIN_ALL_COLUMN_KEYS = ADMIN_TEXT_COLUMNS + ADMIN_NUMBER_COLUMNS + list(ADMIN_SELECT_COLUMNS.keys())
ADMIN_COLUMN_LABELS = {
    "symbol": "סמל מוסד", "city": "עיר", "authority": "בעלות", "contract_file": "קובץ חוזה",
    "meetings_completed": 'סה"כ פגישות שבוצעו', "meetings_hours": 'סה"כ שעות שבוצעו',
    "requested_price": "מחיר מבוקש", "order_amount_gefen": "גובה הזמנה",
    "hours_ordered": "מספר שעות שהוזמנו", "rate": "תעריף", "payment_received": "תשלום שהתקבל",
    "payment_requests_sent": "דרישות תשלום שנשלחו", "receipts_sent": "אסמכתאות שנשלחו",
    "stage": "שלב מוסד", "service_type": "סוג שירות", "order_method": "אמצעי הזמנה",
    "contract_sent": "חוזה נשלח", "contract_received": "חוזה התקבל",
}
NUMBER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte"}
MEETING_STATUSES = ["scheduled", "completed", "cancelled", "postponed", "other"]

# Booking tools require a second round-trip to Claude (tool_result submitted back) so the
# Hebrew phrasing is produced by the model from structured data, not hard-coded Python strings.
# The two original filter tools stay single-round — unchanged from the first "סוכן ניהול" round.
BOOKING_TOOL_NAMES = {
    "find_schools_missing_meetings", "update_draft_school",
    "set_booking_defaults", "confirm_send_booking_emails",
}


def _today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _check_agent_quota(user_id: str) -> None:
    today = _today_utc()
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("chatbot_usage_daily")
                .select("agent_usage_count")
                .eq("user_id", user_id)
                .eq("usage_date", today)
                .execute()
                .data or []
            )
            count = rows[0].get("agent_usage_count") or 0 if rows else 0
            break
        except Exception as exc:
            if attempt == 0:
                _log.warning("agent quota check attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("agent quota check failed after 2 attempts: %s", exc, exc_info=True)
                # Fail open — a transient DB issue shouldn't block a light-usage internal tool.
                return

    if count >= AGENT_PER_USER_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="הגעת למכסת השימוש היומית בעוזר, נסה שוב מחר")


def _record_agent_usage(user_id: str) -> None:
    """Best-effort atomic increment after a successful Claude response. Never raises."""
    try:
        db = get_admin_client()
        db.rpc("increment_agent_usage", {"p_user_id": user_id}).execute()
    except Exception as exc:
        _log.warning("agent usage increment failed (non-fatal): %s", exc)


def _resolve_advisor_id(org_id: str, advisor_name: str) -> tuple[str | None, str | None]:
    """Resolve a free-text advisor name to a profile UUID, scoped to the current org.
    Returns (advisor_id, error_message) — never guesses when the match isn't unique.
    """
    try:
        db = get_admin_client()
        rows = (
            db.table("profiles")
            .select("id, full_name")
            .eq("org_id", org_id)
            .ilike("full_name", f"%{advisor_name.strip()}%")
            .execute()
            .data or []
        )
    except Exception as exc:
        _log.warning("advisor name resolution failed (non-fatal): %s", exc)
        return None, "שגיאה זמנית באיתור היועץ, נסה שוב"

    if not rows:
        return None, f'לא נמצא יועץ בשם "{advisor_name}"'
    if len(rows) > 1:
        names = ", ".join(r["full_name"] for r in rows)
        return None, f'נמצאו כמה יועצים תואמים ל-"{advisor_name}" ({names}) — נסה שם מדויק יותר'
    return rows[0]["id"], None


def _profile_names(ids: list[str]) -> dict[str, str]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    try:
        db = get_admin_client()
        rows = db.table("profiles").select("id, full_name").in_("id", ids).execute().data or []
        return {r["id"]: r["full_name"] for r in rows}
    except Exception as exc:
        _log.warning("_profile_names failed (non-fatal): %s", exc)
        return {}


SYSTEM_PROMPT = f"""אתה "סוכן ניהול" — עוזר AI בתוך אזור הניהול של מערכת גפן AI, כלי לחברות ליווי כלכלי של בתי ספר.
יש לך שתי יכולות נפרדות:

## 1. סינון טבלאות (תצוגה בלבד)
לעזור למשתמש לסנן ולמיין את טבלת "בתי הספר" ואת טבלת "הפגישות" שרואים על המסך, לפי בקשות בעברית.

עמודות טבלת בתי ספר וסוגן:
- טקסט (מחפש הכלה): {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]})" for k in ADMIN_TEXT_COLUMNS)}
- מספר: {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]})" for k in ADMIN_NUMBER_COLUMNS)}
- בחירה מרשימה סגורה: {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]}: {', '.join(v)})" for k, v in ADMIN_SELECT_COLUMNS.items())}

טבלת פגישות: status (אחד מ-{", ".join(MEETING_STATUSES)}), date_from/date_to (YYYY-MM-DD), advisor_name (שם חופשי של יועץ — ייפתר ל-ID), search (טקסט חופשי לשם/סמל/עיר בית ספר).

## 2. איתור בתי ספר שחסרות להם פגישות ושליחת בקשת שריון דרך Outlook
זרימה רב-שלבית שחייבת לעבור דרך `find_schools_missing_meetings` → (במידת הצורך) `update_draft_school`/`set_booking_defaults` → `confirm_send_booking_emails`. **קרא ל-`find_schools_missing_meetings` מיד בהודעה הראשונה של הבקשה** (גם אם עדיין לא ידוע חלון הזמנים) — אל תשאל על חלון זמנים לפני שפתחת טיוטה; אפשר וצריך לשאול על חלון הזמנים **באותה תשובה** יחד עם תוצאת האיתור. כללים נוספים מחייבים:
- **בית ספר ספציפי**: אם המשתמש מבקש על בית ספר אחד או כמה ספציפיים בשם (ולא "כל בתי הספר"), חובה להעביר את שמותיהם בפרמטר `school_names` של `find_schools_missing_meetings` — אל תסרוק את כל הארגון כשהמשתמש התכוון לבית ספר אחד בלבד.
- **יועץ מלווה**: אם לבית ספר יש יועץ מלווה יחיד — הוא נבחר אוטומטית. אם יש יותר מאחד — עליך לציין בתשובה בעברית את שמות כל המועמדים ולשאול איזה מהם לשלוח, ולחכות לתשובה. המשתמש יכול גם לבקש יועץ אחר במפורש (למשל אם הרשמי בחופשה) — קבל זאת גם ללא עמימות.
- **חלון זמנים להצעה**: לפני ששולחים כל מייל, חובה לדעת אילו ימים בשבוע, אילו שעות, ומשך פגישה להציע (יש חריגים אמיתיים — ימי שישי, בתי ספר גדולים שצריכים פגישה ארוכה יותר). אם `default_scheduling_window` עדיין לא נקבע — שאל על כך מפורשות לפני כל דבר אחר (הצעה סבירה לפתוח בה: א'-ה', 8:00-16:00, פגישה בת שעה עם אופציה לחצי שעה נוספת — אך אל תניח זאת בשקט, המשתמש חייב לאשר או לשנות). ניתן גם לקבוע חריגה לבית ספר ספציפי.
  - **חשוב — זהה הסכמה לפי המשמעות, לא לפי מילים ספציפיות:** אם בהודעה הקודמת שלך הצעת חלון זמנים קונקרטי (ימים/שעות/משך), וההודעה הנוכחית של המשתמש **משמעותה** הסכמה/אישור להצעה — **בכל ניסוח שהוא** (למשל: "כן", "מאשר", "בסדר", "מתאים", "סבבה", "מעולה", "אחלה", "טוב", "נשמע טוב", "בסדר גמור", או כל ביטוי אחר שמביע הסכמה) ובלי שהמשתמש פירט מספרים שונים משלו — התייחס לזה כאישור מדויק להצעה שלך וקרא ל-`set_booking_defaults` עם אותם הערכים בדיוק שהצעת. אל תחפש התאמה למילה ספציפית — הבן את הכוונה. אל תשאיר את `default_scheduling_window` ריק ואל תבקש מהמשתמש לחזור ולפרט את מה שכבר הצעת.
- **אישור סופי — קבע לפי מצב הטיוטה בפועל, לא לפי ניחוש מהשיחה**: תמיד תבדוק את הסטטוס העדכני שמוחזר בתוצאת הכלי האחרון (`default_scheduling_window` ו-`unresolved_school_names`), לא רק את זיכרון השיחה:
  - אם `default_scheduling_window` **עדיין ריק** (או שהמשתמש כרגע נותן פרטי זמנים בפעם הראשונה) → קרא ל-`set_booking_defaults`.
  - אם `default_scheduling_window` **כבר מוגדר** וכל בתי הספר פתורים (`unresolved_school_names` ריק), ואתה כבר שאלת את המשתמש "האם לשלוח בפועל?" בהודעה הקודמת שלך — **כל תגובה חיובית של המשתמש בתור הנוכחי (בכל ניסוח שהוא: "כן", "שלח", "תשלח", "סבבה תשלח", "לשלוח", וכו') פירושה אישור לשליחה בפועל. במקרה הזה קרא ל-`confirm_send_booking_emails` — אסור לקרוא שוב ל-`set_booking_defaults` עם אותם הערכים, זו כבר שאלה שנענתה.**
  - במילים אחרות: לעולם אל תשאל את אותה שאלה פעמיים ברצף. אם חלון הזמנים כבר מוגדר בתוצאת הכלי, אל תחזור לשאול עליו או לקבוע אותו מחדש — התקדם לשאלת השליחה או לשליחה עצמה.
- כל קריאה לכלים מהזרימה הזו (מלבד הראשונה) מחייבת `draft_id` — קח אותו מהתשובה הקודמת של הכלים באותה שיחה.

אם הבקשה של המשתמש לא קשורה לאף אחת מהיכולות — ענה בקצרה בעברית בלי להפעיל tool.
אם חסר מידע ברור — שאל להבהרה בטקסט, אל תנחש.
"""

FILTER_TOOLS = [
    {
        "name": "filter_schools_table",
        "description": "מסנן ו/או ממיין את טבלת בתי הספר בניהול, לפי עמודה אחת או יותר.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filters": {
                    "type": "array",
                    "description": "רשימת תנאי סינון (AND בין כולם).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "column": {"type": "string", "enum": ADMIN_ALL_COLUMN_KEYS},
                            "text_op": {"type": "string", "enum": ["contains", "equals"]},
                            "text_value": {"type": "string"},
                            "number_op": {"type": "string", "enum": sorted(NUMBER_OPS)},
                            "number_value": {"type": "number"},
                            "select_values": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["column"],
                    },
                },
                "sort": {
                    "type": "object",
                    "properties": {
                        "column": {"type": "string", "enum": ADMIN_ALL_COLUMN_KEYS},
                        "direction": {"type": "string", "enum": ["asc", "desc"]},
                    },
                },
                "search": {"type": "string", "description": "חיפוש טקסט חופשי בשם/סמל/עיר בית הספר"},
            },
        },
    },
    {
        "name": "filter_meetings_table",
        "description": "מסנן את טבלת הפגישות בניהול (תצוגה בלבד — לא יוצר/מעדכן/מוחק פגישות).",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": MEETING_STATUSES},
                "date_from": {"type": "string", "description": "YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD"},
                "advisor_name": {"type": "string", "description": "שם חופשי של היועץ לסינון לפיו"},
                "search": {"type": "string", "description": "חיפוש טקסט חופשי בשם/סמל/עיר בית הספר"},
            },
        },
    },
]

BOOKING_TOOLS = [
    {
        "name": "find_schools_missing_meetings",
        "description": "מזהה בתי ספר שחסרה להם פגישה באחד או יותר מהחודשים שצוינו, ופותח טיוטת אצווה חדשה.",
        "input_schema": {
            "type": "object",
            "properties": {
                "months": {"type": "array", "items": {"type": "string"}, "description": "רשימת חודשים בפורמט YYYY-MM"},
                "school_names": {
                    "type": "array", "items": {"type": "string"},
                    "description": "אופציונלי — אם המשתמש ביקש על בית ספר ספציפי אחד או יותר (לא כל בתי הספר), ציין כאן את שמותיהם (התאמה חלקית). השאר ריק כדי לסרוק את כל בתי הספר בארגון.",
                },
            },
            "required": ["months"],
        },
    },
    {
        "name": "update_draft_school",
        "description": "מעדכן בית ספר בודד בטיוטה קיימת — פתרון/עקיפה של יועץ, ו/או חריגת חלון זמנים לבית ספר הזה בלבד.",
        "input_schema": {
            "type": "object",
            "properties": {
                "draft_id": {"type": "string"},
                "school_id": {"type": "string"},
                "advisor_name": {"type": "string", "description": "שם חופשי של היועץ לשריון עבור בית ספר זה"},
                "days_of_week": {"type": "array", "items": {"type": "integer"}, "description": "0=ראשון..6=שבת"},
                "start_hour": {"type": "integer"},
                "end_hour": {"type": "integer"},
                "duration_minutes": {"type": "integer"},
            },
            "required": ["draft_id", "school_id"],
        },
    },
    {
        "name": "set_booking_defaults",
        "description": "קובע את חלון הזמנים המוצע כברירת מחדל לכל בתי הספר בטיוטה (ימים/שעות/משך פגישה).",
        "input_schema": {
            "type": "object",
            "properties": {
                "draft_id": {"type": "string"},
                "days_of_week": {"type": "array", "items": {"type": "integer"}, "description": "0=ראשון..6=שבת"},
                "start_hour": {"type": "integer"},
                "end_hour": {"type": "integer"},
                "duration_minutes": {"type": "integer"},
            },
            "required": ["draft_id", "days_of_week", "start_hour", "end_hour", "duration_minutes"],
        },
    },
    {
        "name": "confirm_send_booking_emails",
        "description": "שולח בפועל את מיילי בקשת השריון לכל בתי הספר בטיוטה — ורק אחרי אישור מפורש של המשתמש בהודעה הנוכחית.",
        "input_schema": {
            "type": "object",
            "properties": {"draft_id": {"type": "string"}},
            "required": ["draft_id"],
        },
    },
]

TOOLS = FILTER_TOOLS + BOOKING_TOOLS


def _build_filter_instruction(org_id: str, tool_name: str, tool_input: dict) -> tuple[dict | None, str | None]:
    """Executes tenancy-aware validation for the requested tool and returns
    (filter_instruction, clarification_needed). Only filter_meetings_table needs an actual
    DB round-trip (resolving an advisor name) — filter_schools_table only needs structural
    validation, since it never fetches raw data itself (the already org-scoped data already
    loaded client-side is what actually gets filtered).
    """
    if tool_name == "filter_schools_table":
        filters = {}
        for f in tool_input.get("filters") or []:
            col = f.get("column")
            if col not in ADMIN_ALL_COLUMN_KEYS:
                continue
            if col in ADMIN_TEXT_COLUMNS:
                if not f.get("text_value"):
                    continue
                filters[col] = {"op": f.get("text_op") or "contains", "value": f["text_value"]}
            elif col in ADMIN_NUMBER_COLUMNS:
                if f.get("number_value") is None:
                    continue
                op = f.get("number_op") if f.get("number_op") in NUMBER_OPS else "eq"
                filters[col] = {"op": op, "value": f["number_value"]}
            elif col in ADMIN_SELECT_COLUMNS:
                values = [v for v in (f.get("select_values") or []) if v in ADMIN_SELECT_COLUMNS[col]]
                if not values:
                    continue
                filters[col] = {"op": "in", "values": values}

        sort = None
        raw_sort = tool_input.get("sort")
        if raw_sort and raw_sort.get("column") in ADMIN_ALL_COLUMN_KEYS:
            sort = {"key": raw_sort["column"], "dir": raw_sort.get("direction") or "asc"}

        return {
            "target": "schools",
            "filters": filters,
            "sort": sort,
            "search": tool_input.get("search") or None,
        }, None

    if tool_name == "filter_meetings_table":
        filters = {}
        if tool_input.get("status") in MEETING_STATUSES:
            filters["status"] = tool_input["status"]
        if tool_input.get("date_from"):
            filters["date_from"] = tool_input["date_from"]
        if tool_input.get("date_to"):
            filters["date_to"] = tool_input["date_to"]
        if tool_input.get("search"):
            filters["search"] = tool_input["search"]
        if tool_input.get("advisor_name"):
            advisor_id, error = _resolve_advisor_id(org_id, tool_input["advisor_name"])
            if error:
                return None, error
            filters["advisor_id"] = advisor_id

        return {"target": "meetings", "filters": filters, "sort": None, "search": None}, None

    return None, None


# ---------------------------------------------------------------------------
# Booking-tool execution — each returns a JSON-able dict fed back to Claude as
# a tool_result, plus the (possibly new/updated) draft_id.
# ---------------------------------------------------------------------------

def _draft_summary(draft: dict) -> dict:
    """Structured, display-ready summary — used both as the tool_result content sent back
    to Claude and as the `booking_summary` echoed to the frontend widget."""
    advisor_ids = []
    for s in draft["schools"]:
        advisor_ids.extend(s.get("candidate_advisor_ids") or [])
        if s.get("resolved_advisor_id"):
            advisor_ids.append(s["resolved_advisor_id"])
    names = _profile_names(advisor_ids)

    schools_out = []
    for s in draft["schools"]:
        schools_out.append({
            "school_id": s["school_id"],
            "school_name": s["school_name"],
            "missing_months": s["missing_months"],
            "candidate_advisor_names": [names.get(a, a) for a in (s.get("candidate_advisor_ids") or [])],
            "resolved_advisor_name": names.get(s["resolved_advisor_id"], s["resolved_advisor_id"]) if s.get("resolved_advisor_id") else None,
            "resolution_source": s.get("resolution_source"),
            "scheduling_window_override": s.get("scheduling_window_override"),
        })

    return {
        "draft_id": draft["id"],
        "status": draft["status"],
        "months": draft["months"],
        "default_scheduling_window": draft.get("default_scheduling_window"),
        "schools": schools_out,
        "unresolved_school_names": [s["school_name"] for s in draft["schools"] if not s.get("resolved_advisor_id")],
    }


def _exec_find_schools_missing_meetings(org_id: str, user_id: str, criteria_text: str, tool_input: dict) -> tuple[dict, str | None]:
    months = tool_input.get("months") or []
    found = booking_logic.find_schools_missing_meetings(org_id, months)

    name_filters = [n.strip().lower() for n in (tool_input.get("school_names") or []) if n.strip()]
    if name_filters:
        found = [f for f in found if any(nf in f["school_name"].lower() for nf in name_filters)]

    schools = []
    for f in found:
        candidates = booking_logic.resolve_advisor_candidates(org_id, f["school_id"])
        candidate_ids = [c["id"] for c in candidates]
        resolved_id, source = (candidate_ids[0], "auto_single") if len(candidate_ids) == 1 else (None, None)
        schools.append({
            "school_id": f["school_id"],
            "school_name": f["school_name"],
            "missing_months": f["missing_months"],
            "candidate_advisor_ids": candidate_ids,
            "resolved_advisor_id": resolved_id,
            "resolution_source": source,
            "scheduling_window_override": None,
        })

    if not schools:
        return {"message": "לא נמצאו בתי ספר עם פגישות חסרות בחודשים שצוינו.", "schools": []}, None

    draft = _create_draft(org_id, user_id, criteria_text, months, schools)
    summary = _draft_summary(draft)
    summary["scheduling_window_required"] = True
    return summary, draft["id"]


def _exec_update_draft_school(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    school_id = tool_input.get("school_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    schools = draft["schools"]
    entry = next((s for s in schools if s["school_id"] == school_id), None)
    if not entry:
        return {"error": "בית ספר לא נמצא בטיוטה זו"}, draft_id

    if tool_input.get("advisor_name"):
        advisor_id, error = _resolve_advisor_id(org_id, tool_input["advisor_name"])
        if error:
            return {"error": error}, draft_id
        entry["resolved_advisor_id"] = advisor_id
        entry["resolution_source"] = "manager_choice" if advisor_id in (entry.get("candidate_advisor_ids") or []) else "manager_override"

    window_fields = {k: tool_input[k] for k in ("days_of_week", "start_hour", "end_hour", "duration_minutes") if tool_input.get(k) is not None}
    if window_fields:
        override = entry.get("scheduling_window_override") or {}
        override.update(window_fields)
        entry["scheduling_window_override"] = override

    draft = _update_draft(draft_id, org_id, {"schools": schools})
    return _draft_summary(draft), draft_id


def _exec_set_booking_defaults(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    window = {
        "days_of_week": tool_input["days_of_week"],
        "start_hour": tool_input["start_hour"],
        "end_hour": tool_input["end_hour"],
        "duration_minutes": tool_input["duration_minutes"],
    }
    draft = _update_draft(draft_id, org_id, {"default_scheduling_window": window})
    return _draft_summary(draft), draft_id


def _exec_confirm_send_booking_emails(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    if not draft.get("default_scheduling_window"):
        summary = _draft_summary(draft)
        summary["error"] = "עדיין לא נקבע חלון זמנים (ימים/שעות/משך) לאצווה — יש לקבוע לפני שליחה"
        return summary, draft_id

    unresolved = [s["school_name"] for s in draft["schools"] if not s.get("resolved_advisor_id")]
    if unresolved:
        summary = _draft_summary(draft)
        summary["error"] = "יש בתי ספר ללא יועץ פתור — לא ניתן לשלוח"
        return summary, draft_id

    capability = booking_logic.get_org_mailbox_capability(org_id)
    if not capability["connected"]:
        return {"error": "הארגון אינו מחובר ל-Outlook. יש להתחבר באזור ניהול → אינטגרציות לפני שליחת בקשות שריון."}, draft_id

    db = get_admin_client()
    queued = 0
    for entry in draft["schools"]:
        window = entry.get("scheduling_window_override") or draft["default_scheduling_window"]
        token_row = booking_token_logic.get_or_create_booking_token(
            db, org_id, entry["school_id"], entry["resolved_advisor_id"], draft_id,
            entry["missing_months"], window,
        )
        db.table("meeting_booking_email_queue").insert({
            "org_id": org_id,
            "draft_id": draft_id,
            "school_id": entry["school_id"],
            "advisor_id": entry["resolved_advisor_id"],
            "token_id": token_row["id"],
            "status": "pending",
        }).execute()
        queued += 1

    draft = _update_draft(draft_id, org_id, {"status": "sending"})
    summary = _draft_summary(draft)
    summary["queued_count"] = queued
    return summary, draft_id


def _exec_booking_tool(org_id: str, user_id: str, criteria_text: str, tool_name: str, tool_input: dict) -> tuple[dict, str | None]:
    if tool_name == "find_schools_missing_meetings":
        return _exec_find_schools_missing_meetings(org_id, user_id, criteria_text, tool_input)
    if tool_name == "update_draft_school":
        return _exec_update_draft_school(org_id, tool_input)
    if tool_name == "set_booking_defaults":
        return _exec_set_booking_defaults(org_id, tool_input)
    if tool_name == "confirm_send_booking_emails":
        return _exec_confirm_send_booking_emails(org_id, tool_input)
    return {"error": "unknown tool"}, None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class AgentRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE_CHARS)
    active_tab: Literal["schools", "meetings"] | None = None
    history: list[ChatMessage] = []
    draft_id: str | None = None


@router.post("/ask")
def ask(request: AgentRequest, user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=503, detail="שירות העוזר אינו מוגדר כרגע")

    _check_agent_quota(user["id"])

    client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    context_hint = f"\n\n(התאריך היום: {_today_utc()}. חשב חודשים/תאריכים יחסית לתאריך הזה, לא לפי ניחוש."
    context_hint += f' המשתמש נמצא כרגע בטאב "{request.active_tab}".' if request.active_tab else ""
    context_hint += f' draft_id פעיל בשיחה זו: {request.draft_id})' if request.draft_id else " אין draft_id פעיל כרגע.)"

    bounded_history = request.history[-MAX_HISTORY_MESSAGES:]
    messages = [{"role": m.role, "content": m.content} for m in bounded_history]
    messages.append({"role": "user", "content": request.message})

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT + context_hint,
            tools=TOOLS,
            # This code only ever executes ONE tool_use block per turn (the dispatch below
            # picks the first one via next(...)). Claude's default parallel tool use can emit
            # several tool_use blocks in one response — any left unanswered makes the very next
            # API call fail outright ("tool_use ids were found without tool_result blocks"),
            # which silently degraded to a vague fallback reply. Disabling it keeps every
            # response to exactly one tool call, matching what the rest of this file assumes.
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            messages=messages,
        )
    except Exception as exc:
        _log.error("agent Claude call failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בפנייה לעוזר, נסה שוב")

    tool_use_block = next((b for b in response.content if b.type == "tool_use"), None)
    reply_text = "".join(b.text for b in response.content if b.type == "text").strip()

    filter_instruction = None
    booking_summary = None
    draft_id = request.draft_id

    if tool_use_block and tool_use_block.name in ("filter_schools_table", "filter_meetings_table"):
        filter_instruction, clarification = _build_filter_instruction(
            user["org_id"], tool_use_block.name, tool_use_block.input
        )
        if clarification:
            reply_text = clarification
            filter_instruction = None
        elif not reply_text:
            reply_text = "סיננתי את הטבלה לפי הבקשה שלך."

    elif tool_use_block and tool_use_block.name in BOOKING_TOOL_NAMES:
        tool_result, new_draft_id = _exec_booking_tool(
            user["org_id"], user["id"], request.message, tool_use_block.name, tool_use_block.input
        )
        if new_draft_id:
            draft_id = new_draft_id
        if "schools" in tool_result:  # a _draft_summary shape — expose it to the widget
            booking_summary = tool_result

        # Second round-trip: submit the tool_result so Claude phrases the Hebrew reply
        # from the structured data (e.g. naming ambiguous advisors), not hard-coded strings.
        import json as _json
        messages.append({"role": "assistant", "content": response.content})
        messages.append({
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_use_block.id, "content": _json.dumps(tool_result, ensure_ascii=False)}],
        })
        try:
            response2 = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=2048,
                system=SYSTEM_PROMPT + context_hint,
                tools=TOOLS,
                tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                messages=messages,
            )
            reply_text = "".join(b.text for b in response2.content if b.type == "text").strip()
        except Exception as exc:
            _log.error("agent Claude second-round call failed: %s", exc, exc_info=True)
            reply_text = ""

        # Never fall back to a bare "בוצע." — that implies an action (e.g. emails sent)
        # completed, which is only true for confirm_send_booking_emails, and even then only
        # when it actually queued something. For the informational tools (find/update/set
        # defaults) a vague "done" is actively misleading — nothing was sent.
        if not reply_text:
            if "error" in tool_result:
                reply_text = tool_result["error"]
            elif tool_use_block.name == "confirm_send_booking_emails" and "queued_count" in tool_result:
                reply_text = f"נשלחו בקשות שריון ל-{tool_result['queued_count']} בתי ספר (השליחה בפועל תתבצע בתור, בהדרגה)."
            else:
                reply_text = "הסיכום המעודכן מוצג למטה. לא נשלח שום מייל בשלב זה."

    if not reply_text and not filter_instruction and not booking_summary:
        reply_text = "לא הבנתי את הבקשה — אפשר לנסח מחדש?"

    _record_agent_usage(user["id"])

    return {
        "reply_text": reply_text,
        "filter_instruction": filter_instruction,
        "draft_id": draft_id,
        "booking_summary": booking_summary,
    }
