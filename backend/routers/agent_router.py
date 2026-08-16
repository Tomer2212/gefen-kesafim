import json
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
import task_logic
from academic_years import DEFAULT_ACADEMIC_YEAR
from auth import get_current_user
from org_task_draft_state import _create_draft, _get_draft, _update_draft
from routers import tasks_router as _tasks_router
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
    "requested_price": "מחיר מבוקש", "order_amount_gefen": 'מחיר כולל מע"מ',
    "hours_ordered": "מספר שעות שהוזמנו", "rate": "תעריף", "payment_received": "תשלום שהתקבל",
    "payment_requests_sent": "דרישות תשלום שנשלחו", "receipts_sent": "אסמכתאות שנשלחו",
    "stage": "שלב מוסד", "service_type": "סוג שירות", "order_method": "אמצעי הזמנה",
    "contract_sent": "חוזה נשלח", "contract_received": "חוזה התקבל",
}
NUMBER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte"}
MEETING_STATUSES = ["scheduled", "completed", "cancelled", "postponed", "other"]

# Every field usable in a find_schools_by_criteria "field" condition — sourced live from the
# existing Tasks-engine's own field registry (task_logic.py) so the two never drift apart.
_TASK_FIELD_OPTIONS = task_logic.field_options()["fields"]
_TASK_FIELD_KEYS = [f["field"] for f in _TASK_FIELD_OPTIONS]
_TASK_FIELD_DESC = ", ".join(
    f["field"] + f" ({f['label']}"
    + (f": {', '.join(o['value'] for o in f['options'])}" if f.get("options") else "")
    + ")"
    for f in _TASK_FIELD_OPTIONS
)

RECIPIENT_ROLE_LABELS = {
    "principal": "מנהל/ת", "secretary": "מנהלנית", "finance_contact": "איש/אשת קשר פיננסי",
    "meeting_coordinator": "אחראי/ת לתיאום פגישות (לפי הגדרת בית הספר)",
}

# General-task tools require a second round-trip to Claude (tool_result submitted back) so
# the Hebrew phrasing is produced by the model from structured data (e.g. naming ambiguous
# advisors/contacts), not hard-coded Python strings. The two filter tools stay single-round.
GENERAL_TASK_TOOL_NAMES = {
    "find_schools_by_criteria", "find_schools_by_contact_name", "start_task_for_schools",
    "set_task_message", "resolve_task_advisor", "set_task_scheduling_window",
    "create_and_send_task", "get_task_status",
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


def _resolve_school_names(org_id: str, names: list[str]) -> tuple[list[dict], list[str]]:
    """Fuzzy-resolve free-text school names to real rows, scoped to the org. Deduplicates
    across multiple input names that happen to match the same school."""
    db = get_admin_client()
    rows = db.table("schools").select("id, name").eq("org_id", org_id).eq("status", "active").execute().data or []
    found_ids: set[str] = set()
    found: list[dict] = []
    not_found: list[str] = []
    for name in names:
        needle = (name or "").strip().lower()
        if not needle:
            continue
        matches = [r for r in rows if needle in r["name"].lower()]
        if not matches:
            not_found.append(name)
            continue
        for m in matches:
            if m["id"] not in found_ids:
                found_ids.add(m["id"])
                found.append({"school_id": m["id"], "school_name": m["name"]})
    return found, not_found


def _build_draft_schools(org_id: str, found: list[dict]) -> list[dict]:
    """Attaches candidate/resolved-advisor info to a list of {school_id, school_name} —
    shared by every tool that seeds a new draft (criteria match, contact-name match, direct
    school-name match)."""
    schools = []
    for f in found:
        candidates = booking_logic.resolve_advisor_candidates(org_id, f["school_id"])
        candidate_ids = [c["id"] for c in candidates]
        resolved_id, source = (candidate_ids[0], "auto_single") if len(candidate_ids) == 1 else (None, None)
        schools.append({
            "school_id": f["school_id"],
            "school_name": f["school_name"],
            "candidate_advisor_ids": candidate_ids,
            "resolved_advisor_id": resolved_id,
            "resolution_source": source,
            "scheduling_window_override": None,
        })
    return schools


SYSTEM_PROMPT = f"""אתה "סוכן ניהול" — עוזר AI בתוך אזור הניהול של מערכת גפן AI, כלי לחברות ליווי כלכלי של בתי ספר.
יש לך שתי יכולות נפרדות:

## 1. סינון טבלאות (תצוגה בלבד)
לעזור למשתמש לסנן ולמיין את טבלת "בתי הספר" ואת טבלת "הפגישות" שרואים על המסך, לפי בקשות בעברית.

עמודות טבלת בתי ספר וסוגן:
- טקסט (מחפש הכלה): {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]})" for k in ADMIN_TEXT_COLUMNS)}
- מספר: {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]})" for k in ADMIN_NUMBER_COLUMNS)}
- בחירה מרשימה סגורה: {", ".join(f"{k} ({ADMIN_COLUMN_LABELS[k]}: {', '.join(v)})" for k, v in ADMIN_SELECT_COLUMNS.items())}

טבלת פגישות: status (אחד מ-{", ".join(MEETING_STATUSES)}), date_from/date_to (YYYY-MM-DD), advisor_name (שם חופשי של יועץ — ייפתר ל-ID), search (טקסט חופשי לשם/סמל/עיר בית ספר).

## 2. איתור בתי ספר, שליחת הודעות, ומעקב משימות
זרימה כללית: `find_schools_by_criteria` / `find_schools_by_contact_name` / `start_task_for_schools` (איתור בתי הספר) → `set_task_message` (מה לשלוח, למי, באיזה ערוץ) → אם ההודעה מכילה {{booking_link}}: `resolve_task_advisor`/`set_task_scheduling_window` (רק אז נדרש) → `create_and_send_task` (שליחה בפועל, רק אחרי אישור מפורש). מעקב אחר משימות שכבר נוצרו: `get_task_status`.

**איסור מוחלט וללא יוצא מן הכלל: אין לך אף כלי שמסוגל למחוק דבר** (בית ספר, פגישה, משימה, משתמש, כל נתון אחר). לעולם אל תמציא דרך למחוק ואל תרמוז שביכולתך לעשות זאת — אם המשתמש מבקש מפורשות למחוק משהו, סרב בנימוס והפנה אותו לבצע זאת ידנית במערכת עצמה.

**איתור בתי ספר — שלוש דרכים, לפי מה שהמשתמש ביקש:**
- **`find_schools_by_criteria`** — כשהבקשה מתארת תנאי/תנאים (לא בית ספר ספציפי בשם). מבנה `groups` של קבוצות `conditions` (OR בין קבוצות, AND בין תנאים בתוך קבוצה). כל תנאי הוא `type:"meeting"` (יש/אין פגישה בטווח תאריכים, עם `meeting_service_type` אופציונלי מתוך gefen/current/gefen_current, ו-`negate:true` להיפוך ל"אין") או `type:"field"` (עמודה מתוך: {_TASK_FIELD_DESC}, עם `op` מתוך eq/ne/gt/gte/lt/lte/contains).
- **`find_schools_by_contact_name`** — כשהמשתמש נוקב בשם של אדם ("מי המנהלנית ששמה רותי?", "שלח לרותי..."). אם יש כמה התאמות — חובה לשאול איזו מהן רלוונטית לפני שממשיכים, אל תנחש.
- **`start_task_for_schools`** — כשהמשתמש נוקב בשם/שמות בית ספר ספציפיים ישירות ("לבית ספר X").

**הרכבת הודעה (`set_task_message`)**:
- `recipient_role` אחד מ: principal (מנהל/ת), secretary (מנהלנית), finance_contact (איש/אשת קשר פיננסי), meeting_coordinator (אחראי/ת לתיאום פגישות, כפי שהוגדר לכל בית ספר בנפרד).
- `channel`: כרגע **Outlook (email_outlook) חסום זמנית** עקב הגבלת שליחה שהטילה Microsoft על הטננט (בטיפול מול התמיכה) — **העדף `email_resend` כברירת מחדל** אלא אם המשתמש מבקש Outlook במפורש ומודע למגבלה. `whatsapp_twilio` עדיין לא זמין בפועל (תשתית בלבד).
- גוף ההודעה תומך ב-`{{school_name}}` (שם בית הספר) ו-`{{booking_link}}` (לינק אמיתי לקביעת פגישה מהיומן של היועץ הפתור — רק אם צריך).

**אם ובאם ההודעה מכילה `{{booking_link}}`** — לפני שליחה, לכל בית ספר צריך יועץ מלווה פתור וחלון זמנים מוגדר:
- יועץ מלווה יחיד → נבחר אוטומטית. יותר מאחד → ציין בעברית את שמות כל המועמדים ושאל איזה מהם, וחכה לתשובה. אפשר גם override מפורש (`resolve_task_advisor`) גם כשאין עמימות.
- חלון זמנים (`set_task_scheduling_window`) — ימים בשבוע, שעות, משך פגישה, **ואילו חודשים קלנדריים להציע לשריון** — אין ברירת מחדל שקטה, חובה לשאול ולקבל אישור/פירוט מפורש לפני שממשיכים (הצעה סבירה לפתוח בה: א'-ה', 8:00-16:00, שעה).
- **זהה הסכמה לפי משמעות, לא לפי מילים ספציפיות** — "כן"/"מתאים"/"סבבה"/"מעולה"/כל ביטוי הסכמה אחר שמגיע מיד אחרי שהצעת ערכים קונקרטיים = אישור לאותם ערכים בדיוק.

**אישור סופי לשליחה**: לעולם אל תקרא ל-`create_and_send_task` בלי הודעה חיובית מפורשת של המשתמש בתור הנוכחי. קבע איזו שאלה בדיוק המשתמש עונה עליה לפי **מצב הטיוטה בפועל** שחוזר מהכלי האחרון (לא לפי ניחוש מזיכרון השיחה):
- אם `message_config` **כבר מוגדר** (נמען/ערוץ/תוכן קיימים בתוצאת הכלי), ואם `needs_booking_link` — גם חלון הזמנים כבר מוגדר וכל בתי הספר פתורים, ואתה כבר שאלת "לאשר שליחה בפועל?" — **אישור נוסף מהמשתמש (בכל ניסוח) פירושו קריאה ל-`create_and_send_task` עכשיו, מיד. אל תקרא שוב ל-`set_task_message`/`set_task_scheduling_window` עם אותם ערכים בדיוק — זו שאלה שכבר נענתה.**
- לעולם אל תשאל את אותה שאלה פעמיים ברצף. אם משהו כבר מוגדר בתוצאת הכלי האחרון, אל תחזור לבקש אותו מחדש — התקדם לשלב הבא בזרימה.

**דוגמה מדויקת (חובה לפעול בדיוק כך במקרה הזה)**: קראת ל-`set_task_message`, קיבלת בחזרה `message_config` מלא (עם recipient_role/channel/subject/body), ושאלת בעצמך "לאשר שליחה בפועל?". המשתמש עונה "כן, תשלח" (או כל ניסוח חיובי דומה). **הפעולה הנכונה היחידה כאן היא לקרוא ל-`create_and_send_task` עם אותו draft_id — לא לקרוא שוב ל-`set_task_message`, לא לשאול שאלה נוספת.**

כל קריאה לכלים האלה (מלבד זו שפותחת טיוטה) מחייבת `draft_id` — קח אותו מהתשובה הקודמת של הכלים באותה שיחה.

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

_CONDITION_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["meeting", "field"]},
        "meeting_service_type": {"type": "string", "enum": task_logic.MEETING_SERVICE_TYPE_OPTIONS},
        "date_from": {"type": "string", "description": "YYYY-MM-DD"},
        "date_to": {"type": "string", "description": "YYYY-MM-DD"},
        "negate": {"type": "boolean", "description": "true = 'אין פגישה' במקום 'יש פגישה'"},
        "field": {"type": "string", "enum": _TASK_FIELD_KEYS},
        "op": {"type": "string", "enum": ["eq", "ne", "gt", "gte", "lt", "lte", "contains"]},
        "value": {},
    },
    "required": ["type"],
}

GENERAL_TASK_TOOLS = [
    {
        "name": "find_schools_by_criteria",
        "description": "מאתר בתי ספר לפי קריטריון אחד או ריבוי תנאים (AND/OR) על שדות בתי ספר ו/או תנאי פגישה, ופותח טיוטת משימה חדשה.",
        "input_schema": {
            "type": "object",
            "properties": {
                "groups": {
                    "type": "array",
                    "description": "OR בין קבוצות, AND בין תנאים בכל קבוצה",
                    "items": {
                        "type": "object",
                        "properties": {"conditions": {"type": "array", "items": _CONDITION_SCHEMA}},
                        "required": ["conditions"],
                    },
                },
            },
            "required": ["groups"],
        },
    },
    {
        "name": "find_schools_by_contact_name",
        "description": "מחפש בתי ספר לפי שם פרטי/מלא של איש קשר (מנהל/ת, מנהלנית, איש קשר פיננסי). מחזיר התאמות בלבד, לא פותח טיוטה.",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "start_task_for_schools",
        "description": "פותח טיוטת משימה עבור בית ספר אחד או יותר, לפי שם ישיר (לא לפי קריטריון).",
        "input_schema": {
            "type": "object",
            "properties": {
                "school_names": {"type": "array", "items": {"type": "string"}},
                "request_text": {"type": "string", "description": "תיאור קצר של הבקשה המקורית, לתיעוד"},
            },
            "required": ["school_names", "request_text"],
        },
    },
    {
        "name": "set_task_message",
        "description": "קובע/מעדכן את תוכן ההודעה לשליחה — נמען, ערוץ, נושא, גוף ההודעה, צרופות.",
        "input_schema": {
            "type": "object",
            "properties": {
                "draft_id": {"type": "string"},
                "recipient_role": {"type": "string", "enum": list(RECIPIENT_ROLE_LABELS.keys())},
                "channel": {"type": "string", "enum": ["email_resend", "email_outlook", "whatsapp_twilio"]},
                "subject": {"type": "string"},
                "body": {"type": "string", "description": "תומך ב-{school_name} וב-{booking_link}"},
                "attachment_keys": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["draft_id", "recipient_role", "channel", "body"],
        },
    },
    {
        "name": "resolve_task_advisor",
        "description": "פותר/עוקף את היועץ המלווה לבית ספר בודד בטיוטה — רלוונטי רק כשההודעה מכילה {booking_link}.",
        "input_schema": {
            "type": "object",
            "properties": {
                "draft_id": {"type": "string"},
                "school_id": {"type": "string"},
                "advisor_name": {"type": "string"},
            },
            "required": ["draft_id", "school_id", "advisor_name"],
        },
    },
    {
        "name": "set_task_scheduling_window",
        "description": "קובע את חלון הזמנים (ימים/שעות/משך) ואת החודשים להצעה בלינק השריון — רלוונטי רק כשההודעה מכילה {booking_link}.",
        "input_schema": {
            "type": "object",
            "properties": {
                "draft_id": {"type": "string"},
                "days_of_week": {"type": "array", "items": {"type": "integer"}, "description": "0=ראשון..6=שבת"},
                "start_hour": {"type": "integer"},
                "end_hour": {"type": "integer"},
                "duration_minutes": {"type": "integer"},
                "months": {"type": "array", "items": {"type": "string"}, "description": "חודשים בפורמט YYYY-MM להצעה בעמוד השריון"},
            },
            "required": ["draft_id", "days_of_week", "start_hour", "end_hour", "duration_minutes", "months"],
        },
    },
    {
        "name": "create_and_send_task",
        "description": "יוצר משימה אמיתית במערכת ומכניס את ההודעות לתור השליחה — ורק אחרי אישור מפורש של המשתמש בהודעה הנוכחית.",
        "input_schema": {
            "type": "object",
            "properties": {"draft_id": {"type": "string"}},
            "required": ["draft_id"],
        },
    },
    {
        "name": "get_task_status",
        "description": "בודק את ההתקדמות של משימה קיימת (אם ניתן task_id), או מציג רשימת משימות אחרונות של הארגון.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
        },
    },
]

TOOLS = FILTER_TOOLS + GENERAL_TASK_TOOLS


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
# General-task tool execution — each returns a JSON-able dict fed back to
# Claude as a tool_result, plus the (possibly new/updated) draft_id.
# ---------------------------------------------------------------------------

def _task_draft_summary(draft: dict) -> dict:
    """Structured, display-ready summary — used both as the tool_result content sent back
    to Claude and as the `task_summary` echoed to the frontend widget."""
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
            "candidate_advisor_names": [names.get(a, a) for a in (s.get("candidate_advisor_ids") or [])],
            "resolved_advisor_name": names.get(s["resolved_advisor_id"], s["resolved_advisor_id"]) if s.get("resolved_advisor_id") else None,
            "resolution_source": s.get("resolution_source"),
            "scheduling_window_override": s.get("scheduling_window_override"),
        })

    needs_booking_link = bool(draft.get("needs_booking_link"))
    return {
        "draft_id": draft["id"],
        "status": draft["status"],
        "school_count": len(schools_out),
        "needs_booking_link": needs_booking_link,
        "default_scheduling_window": draft.get("default_scheduling_window"),
        "message_config": draft.get("message_config"),
        "schools": schools_out,
        "unresolved_school_names": (
            [s["school_name"] for s in draft["schools"] if not s.get("resolved_advisor_id")]
            if needs_booking_link else []
        ),
        "created_org_task_id": draft.get("created_org_task_id"),
    }


def _exec_find_schools_by_criteria(org_id: str, user_id: str, request_text: str, tool_input: dict) -> tuple[dict, str | None]:
    criteria = {"groups": tool_input.get("groups") or []}
    found = task_logic.find_matching_schools(org_id, criteria)
    if not found:
        return {"message": "לא נמצאו בתי ספר התואמים לקריטריונים.", "schools": []}, None

    schools = _build_draft_schools(org_id, found)
    draft = _create_draft(org_id, user_id, request_text, schools, criteria=criteria)
    return _task_draft_summary(draft), draft["id"]


def _exec_find_schools_by_contact_name(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    matches = task_logic.find_schools_by_contact_name(org_id, tool_input.get("name") or "")
    return {
        "matches": [
            {
                "school_id": m["school_id"], "school_name": m["school_name"],
                "role": RECIPIENT_ROLE_LABELS.get(m["matched_role"], m["matched_role"]),
                "matched_name": m["matched_name"],
            }
            for m in matches
        ],
    }, None


def _exec_start_task_for_schools(org_id: str, user_id: str, tool_input: dict) -> tuple[dict, str | None]:
    names = tool_input.get("school_names") or []
    found, not_found = _resolve_school_names(org_id, names)
    if not found:
        detail = f' ({", ".join(not_found)})' if not_found else ""
        return {"error": f"לא נמצאו בתי ספר תואמים{detail}"}, None

    schools = _build_draft_schools(org_id, found)
    draft = _create_draft(org_id, user_id, tool_input.get("request_text") or "", schools)
    summary = _task_draft_summary(draft)
    if not_found:
        summary["not_found_school_names"] = not_found
    return summary, draft["id"]


def _exec_set_task_message(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    body = tool_input.get("body") or ""
    needs_booking_link = "{booking_link}" in body
    message_config = {
        "recipient_role": tool_input.get("recipient_role"),
        "channel": tool_input.get("channel") or "email_resend",
        "subject": tool_input.get("subject") or "",
        "body_template": body,
        "attachment_keys": tool_input.get("attachment_keys") or [],
    }
    draft = _update_draft(draft_id, org_id, {"message_config": message_config, "needs_booking_link": needs_booking_link})
    summary = _task_draft_summary(draft)
    if needs_booking_link and not draft.get("default_scheduling_window"):
        summary["scheduling_window_required"] = True
    return summary, draft_id


def _exec_resolve_task_advisor(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    school_id = tool_input.get("school_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    schools = draft["schools"]
    entry = next((s for s in schools if s["school_id"] == school_id), None)
    if not entry:
        return {"error": "בית ספר לא נמצא בטיוטה זו"}, draft_id

    advisor_id, error = _resolve_advisor_id(org_id, tool_input.get("advisor_name") or "")
    if error:
        return {"error": error}, draft_id
    entry["resolved_advisor_id"] = advisor_id
    entry["resolution_source"] = "manager_choice" if advisor_id in (entry.get("candidate_advisor_ids") or []) else "manager_override"

    draft = _update_draft(draft_id, org_id, {"schools": schools})
    return _task_draft_summary(draft), draft_id


def _exec_set_task_scheduling_window(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    window = {
        "days_of_week": tool_input["days_of_week"],
        "start_hour": tool_input["start_hour"],
        "end_hour": tool_input["end_hour"],
        "duration_minutes": tool_input["duration_minutes"],
        "months": tool_input.get("months") or [],
    }
    draft = _update_draft(draft_id, org_id, {"default_scheduling_window": window})
    return _task_draft_summary(draft), draft_id


def _exec_create_and_send_task(org_id: str, user_id: str, tool_input: dict) -> tuple[dict, str | None]:
    draft_id = tool_input.get("draft_id")
    draft = _get_draft(draft_id, org_id)
    if not draft:
        return {"error": "טיוטה לא נמצאה או שפגה"}, None

    message_config = draft.get("message_config")
    if not message_config:
        summary = _task_draft_summary(draft)
        summary["error"] = "עדיין לא הוגדרה הודעה לשליחה (נמען/ערוץ/תוכן) — יש להגדיר לפני שליחה"
        return summary, draft_id

    needs_booking_link = bool(draft.get("needs_booking_link"))
    if needs_booking_link:
        if not draft.get("default_scheduling_window"):
            summary = _task_draft_summary(draft)
            summary["error"] = "עדיין לא נקבע חלון זמנים/חודשים לשריון — יש לקבוע לפני שליחה"
            return summary, draft_id
        unresolved = [s["school_name"] for s in draft["schools"] if not s.get("resolved_advisor_id")]
        if unresolved:
            summary = _task_draft_summary(draft)
            summary["error"] = "יש בתי ספר ללא יועץ פתור — לא ניתן לשלוח"
            return summary, draft_id

    db = get_admin_client()
    school_ids = [s["school_id"] for s in draft["schools"]]

    task_row = (
        db.table("org_tasks")
        .insert({
            "org_id": org_id,
            "created_by": user_id,
            "name": (draft.get("request_text") or "משימה מהסוכן")[:120],
            "status": "active",
            "criteria": draft.get("criteria") or {"groups": []},
            "matched_school_ids": school_ids,
            "message_config": message_config,
            "academic_year": DEFAULT_ACADEMIC_YEAR,
        })
        .execute()
    ).data[0]

    missing_names: list[str] = []
    if needs_booking_link:
        # Bypasses _tasks_router._build_booking_link (which auto-picks the first advisor and a
        # hardcoded window) — this flow already resolved advisor+window per-school with the
        # manager's explicit input, so it calls the token machinery directly with those values.
        schools_full = {s["id"]: s for s in db.table("schools").select("*").in_("id", school_ids).execute().data or []}
        recipient_role = message_config.get("recipient_role")
        channel = message_config.get("channel")
        body_template = message_config.get("body_template") or ""
        queue_rows = []
        for entry in draft["schools"]:
            school = schools_full.get(entry["school_id"])
            if not school:
                continue
            recipient = _tasks_router._resolve_recipient(school, recipient_role)
            if _tasks_router._channel_missing_contact(channel, recipient):
                missing_names.append(entry["school_name"])
                continue
            window = entry.get("scheduling_window_override") or draft["default_scheduling_window"]
            months = window.get("months") or []
            token_row = booking_token_logic.get_or_create_booking_token(
                db, org_id, entry["school_id"], entry["resolved_advisor_id"], None, months, window,
            )
            booking_link = f"{os.getenv('APP_URL', '')}/book/{token_row['token']}"
            queue_rows.append({
                "task_id": task_row["id"],
                "school_id": entry["school_id"],
                "recipient_name": recipient.get("name"),
                "recipient_email": recipient.get("email"),
                "recipient_phone": recipient.get("phone"),
                "recipient_role": recipient_role,
                "channel": channel,
                "subject": _tasks_router._render_template(message_config.get("subject") or "", school),
                "body": _tasks_router._render_template(body_template, school, booking_link),
                "attachment_keys": message_config.get("attachment_keys") or [],
                "status": "pending",
            })
        if queue_rows:
            db.table("org_task_messages").insert(queue_rows).execute()
    else:
        missing_ids = _tasks_router._queue_messages_for_schools(db, task_row, org_id, school_ids)
        name_by_id = {s["school_id"]: s["school_name"] for s in draft["schools"]}
        missing_names = [name_by_id.get(i, i) for i in missing_ids]

    draft = _update_draft(draft_id, org_id, {"status": "created", "created_org_task_id": task_row["id"]})
    summary = _task_draft_summary(draft)
    summary["queued_count"] = len(school_ids) - len(missing_names)
    if missing_names:
        summary["missing_contact_school_names"] = missing_names
    return summary, draft_id


def _exec_get_task_status(org_id: str, tool_input: dict) -> tuple[dict, str | None]:
    db = get_admin_client()
    task_id = tool_input.get("task_id")
    if task_id:
        rows = db.table("org_tasks").select("*").eq("id", task_id).eq("org_id", org_id).execute().data or []
        if not rows:
            return {"error": "משימה לא נמצאה"}, None
        task = rows[0]
        progress = task_logic.compute_task_progress(org_id, task)
        return {"task_id": task_id, "name": task.get("name"), "status": task.get("status"), **progress}, None

    rows = (
        db.table("org_tasks")
        .select("id, name, status, created_at, matched_school_ids")
        .eq("org_id", org_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data or []
    )
    return {
        "recent_tasks": [
            {
                "task_id": r["id"], "name": r["name"], "status": r["status"],
                "school_count": len(r.get("matched_school_ids") or []), "created_at": r["created_at"],
            }
            for r in rows
        ],
    }, None


def _exec_task_tool(org_id: str, user_id: str, request_text: str, tool_name: str, tool_input: dict) -> tuple[dict, str | None]:
    if tool_name == "find_schools_by_criteria":
        return _exec_find_schools_by_criteria(org_id, user_id, request_text, tool_input)
    if tool_name == "find_schools_by_contact_name":
        return _exec_find_schools_by_contact_name(org_id, tool_input)
    if tool_name == "start_task_for_schools":
        return _exec_start_task_for_schools(org_id, user_id, tool_input)
    if tool_name == "set_task_message":
        return _exec_set_task_message(org_id, tool_input)
    if tool_name == "resolve_task_advisor":
        return _exec_resolve_task_advisor(org_id, tool_input)
    if tool_name == "set_task_scheduling_window":
        return _exec_set_task_scheduling_window(org_id, tool_input)
    if tool_name == "create_and_send_task":
        return _exec_create_and_send_task(org_id, user_id, tool_input)
    if tool_name == "get_task_status":
        return _exec_get_task_status(org_id, tool_input)
    return {"error": "unknown tool"}, None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class AgentRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE_CHARS)
    # Free-text, not a closed Literal: this is purely a descriptive hint folded into the
    # system prompt (never branched on), and the set of admin tabs (e.g. "calls"/"שיחות")
    # keeps growing independently of this file — a Literal here would 422 on any new tab.
    active_tab: str | None = None
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
    task_summary = None
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

    elif tool_use_block and tool_use_block.name in GENERAL_TASK_TOOL_NAMES:
        tool_result, new_draft_id = _exec_task_tool(
            user["org_id"], user["id"], request.message, tool_use_block.name, tool_use_block.input
        )
        if new_draft_id:
            draft_id = new_draft_id
        if "schools" in tool_result:  # a _task_draft_summary shape — expose it to the widget
            task_summary = tool_result

        # Second round-trip: submit the tool_result so Claude phrases the Hebrew reply
        # from the structured data (e.g. naming ambiguous advisors/contacts), not
        # hard-coded strings. Deliberately omits `tools`/`tool_choice` — this call must
        # always produce text (the next question or a summary), never another tool_use.
        # Passing tools here let Claude sometimes choose to call the next tool instead of
        # asking in text; that tool_use was silently dropped (only text blocks were read
        # below), leaving the user with no real next step and a bland fallback message.
        messages.append({"role": "assistant", "content": response.content})
        messages.append({
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_use_block.id, "content": json.dumps(tool_result, ensure_ascii=False)}],
        })
        try:
            response2 = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=2048,
                system=SYSTEM_PROMPT + context_hint,
                messages=messages,
            )
            reply_text = "".join(b.text for b in response2.content if b.type == "text").strip()
        except Exception as exc:
            _log.error("agent Claude second-round call failed: %s", exc, exc_info=True)
            reply_text = ""

        # Never fall back to a bare "בוצע." — that implies an action (e.g. emails sent)
        # completed, which is only true for create_and_send_task, and even then only when it
        # actually queued something. For the informational tools a vague "done" is actively
        # misleading — nothing was sent.
        if not reply_text:
            if "error" in tool_result:
                reply_text = tool_result["error"]
            elif tool_use_block.name == "create_and_send_task" and "queued_count" in tool_result:
                reply_text = f"נשלחו הודעות ל-{tool_result['queued_count']} בתי ספר (השליחה בפועל תתבצע בתור, בהדרגה)."
            else:
                reply_text = "הסיכום המעודכן מוצג למטה. לא נשלח שום דבר בשלב זה."

    if not reply_text and not filter_instruction and not task_summary:
        reply_text = "לא הבנתי את הבקשה — אפשר לנסח מחדש?"

    _record_agent_usage(user["id"])

    return {
        "reply_text": reply_text,
        "filter_instruction": filter_instruction,
        "draft_id": draft_id,
        "task_summary": task_summary,
    }
