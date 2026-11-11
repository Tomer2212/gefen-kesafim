""""סבב פגישות" — a folder with a goal: which schools need which meeting(s) in a period, and
where each of them stands. The tasks inside a round (org_tasks.round_id) are ordinary meeting
tasks; this module only reads them.

A school's need is one meeting condition built from the round's requirement (type — including
"לפי סוג שירות", see task_logic.expand_meeting_condition — count, and the round's dates), and
it is evaluated with exactly the code a task's progress uses, so a meeting booked in any way
(link, phone, Outlook, another task) counts. The rest of the status comes from the round's own
tasks: the latest request each school got and whether its link was opened.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import task_logic

_log = logging.getLogger(__name__)

# The order is the funnel's; a school's status is the first that applies.
STATUSES = ("done", "booked", "partial", "opened", "requested", "problem", "untouched", "excluded")
_REQUEST_PROBLEM_SKIPS = {"missing_contact", "incomplete_meeting_config", "opted_out"}
# Card advisor lists each meeting type's advisor comes from (takuma: the גפן list).
_ADVISOR_LISTS = {"gefen": ["gefen"], "current": ["current"], "district": ["district"],
                  "takuma": ["gefen"], "gefen_current": ["gefen", "current"]}


def round_condition(rnd: dict) -> dict:
    """The meeting condition every school of the round must satisfy."""
    req = rnd.get("requirement") or {}
    cond = {
        "type": "meeting",
        "meeting_service_type": req.get("meeting_service_type"),
        "gefen_current_split": req.get("gefen_current_split"),
        "date_segments": [{"date_from": rnd["start_date"], "date_to": rnd["end_date"]}],
        "stage_scope": req.get("stage_scope"),
        "explicit_stage_scope_only": True,
    }
    count = int(req.get("count_per_school") or 1)
    if count > 1:
        cond["required_count"] = count
    return cond


def round_school_ids(rnd: dict) -> list[str]:
    excluded = set(rnd.get("excluded_school_ids") or [])
    return [sid for sid in (rnd.get("school_ids") or []) if sid not in excluded]


def _fetch_round_requests(db, round_id: str) -> tuple[list[dict], dict[str, dict], dict[str, dict], dict[str, dict]]:
    """The round's tasks, each school's latest request message, the tokens of those messages,
    and each school's latest skip note — one query per table."""
    tasks = db.table("org_tasks").select("id, name, status, created_at").eq("round_id", round_id).execute().data or []
    task_ids = [t["id"] for t in tasks]
    latest_msg: dict[str, dict] = {}
    tokens: dict[str, dict] = {}
    notes: dict[str, dict] = {}
    if not task_ids:
        return tasks, latest_msg, tokens, notes
    msgs = (
        db.table("org_task_messages")
        .select("task_id, school_id, status, sent_at, created_at, booking_token_id")
        .in_("task_id", task_ids).order("created_at", desc=True).execute().data or []
    )
    for m in msgs:
        latest_msg.setdefault(m["school_id"], m)
    token_ids = list({m["booking_token_id"] for m in latest_msg.values() if m.get("booking_token_id")})
    if token_ids:
        rows = (
            db.table("meeting_booking_tokens").select("id, first_viewed_at, expires_at")
            .in_("id", token_ids).execute().data or []
        )
        tokens = {t["id"]: t for t in rows}
    note_rows = (
        db.table("org_task_school_notes").select("task_id, school_id, skip_reason, updated_at")
        .in_("task_id", task_ids).execute().data or []
    )
    for n in sorted(note_rows, key=lambda r: r.get("updated_at") or "", reverse=True):
        if n.get("skip_reason"):
            notes.setdefault(n["school_id"], n)
    return tasks, latest_msg, tokens, notes


def _all_token_ids(db, task_ids: list[str]) -> set[str]:
    if not task_ids:
        return set()
    rows = db.table("meeting_booking_tokens").select("id").in_("task_id", task_ids).execute().data or []
    return {r["id"] for r in rows}


def _advisor_ids_for(school: dict, types: list[str]) -> list[str]:
    out: list[str] = []
    for t in types:
        for lst in _ADVISOR_LISTS.get(t, []):
            for aid in school.get(f"advisor_{lst}") or []:
                if aid not in out:
                    out.append(aid)
    return out


def _is_open_request(msg: dict | None, token: dict | None, now_iso: str) -> bool:
    if not msg or msg.get("status") not in ("sent", "pending", "sending", "outlook_pending"):
        return False
    return not token or not token.get("expires_at") or token["expires_at"] > now_iso


def school_status(
    cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None, token_ids: set[str],
    msg: dict | None, token: dict | None, note: dict | None, now_iso: str,
) -> dict:
    """One school's row in the round: what it needs, what it has, and where its request stands."""
    res = task_logic._meeting_condition_result(cond, school, school_meetings, year_row, token_ids)
    expanded = task_logic._expand_for_school(cond, school, year_row)
    types = [c["meeting_service_type"] for c in expanded]
    matched: dict[str, dict] = {}
    for c in expanded:
        for m in task_logic._matching_meetings(c, school_meetings, token_ids):
            matched[m["id"]] = m
    meetings = sorted(matched.values(), key=lambda m: m.get("meeting_date") or "")
    required = res["required_count"] if expanded else 0
    have = min(res["actual_count"] or 0, required) if expanded else 0

    if not expanded:
        status = "problem"
    elif res["ok"]:
        status = "done" if meetings and all(m.get("status") == "completed" for m in meetings) else "booked"
    elif have > 0:
        status = "partial"
    elif msg and msg.get("status") == "failed":
        status = "problem"
    elif msg and msg.get("status") in ("sent", "pending", "sending", "outlook_pending"):
        status = "opened" if (token or {}).get("first_viewed_at") else "requested"
    elif note and note.get("skip_reason") in _REQUEST_PROBLEM_SKIPS:
        status = "problem"
    else:
        status = "untouched"

    return {
        "school_id": school["id"], "school_name": school.get("name"), "symbol": school.get("symbol"),
        "authority": school.get("authority"), "district": school.get("district"), "city": school.get("city"),
        "stage": school.get("stage"),
        "status": status,
        "problem": "missing_service_type" if not expanded else (
            "send_failed" if (msg or {}).get("status") == "failed" else (note or {}).get("skip_reason") if status == "problem" else None),
        "required_types": types,
        # For the dashboard's "by type" breakdown: the card's service type and whether its גפן and
        # שוטף advisors are the same people (one combined meeting) or not.
        "card_service_type": (year_row or {}).get("service_type"),
        "gefen_current_same": bool(school.get("advisor_gefen_current_same")),
        "required_count": required, "booked_count": have,
        # No service type yet → every advisor on its card, so it still shows under its advisor.
        "advisor_ids": _advisor_ids_for(school, types or ["gefen", "current", "district"]),
        "meetings": [{"id": m["id"], "date": m.get("meeting_date"), "service_type": m.get("meeting_service_type"),
                      "status": m.get("status"), "via_link": bool(m.get("booking_token_id"))} for m in meetings],
        "request": None if not msg else {
            "task_id": msg.get("task_id"), "status": msg.get("status"),
            "sent_at": msg.get("sent_at") or msg.get("created_at"),
            "link_viewed_at": (token or {}).get("first_viewed_at"),
            "open": _is_open_request(msg, token, now_iso),
        },
    }


def compute_round(db, rnd: dict) -> dict:
    """Every school's status in the round, plus the totals the dashboard and the cache show."""
    school_ids = round_school_ids(rnd)
    schools, meetings, year_map, _goals, _cl = task_logic._fetch_schools_and_meetings(
        rnd["org_id"], rnd["academic_year"], only_school_ids=school_ids,
    )
    tasks, latest_msg, tokens, notes = _fetch_round_requests(db, rnd["id"])
    token_ids = _all_token_ids(db, [t["id"] for t in tasks])
    cond = round_condition(rnd)
    now_iso = datetime.now(timezone.utc).isoformat()
    meetings_by_school: dict[str, list[dict]] = {}
    for m in meetings:
        meetings_by_school.setdefault(m["school_id"], []).append(m)
    physical = set(rnd.get("physical_school_ids") or [])

    rows = []
    for s in schools:
        msg = latest_msg.get(s["id"])
        row = school_status(
            cond, s, meetings_by_school.get(s["id"], []), year_map.get(s["id"]), token_ids,
            msg, tokens.get((msg or {}).get("booking_token_id")), notes.get(s["id"]), now_iso,
        )
        row["physical"] = s["id"] in physical
        rows.append(row)
    # Schools of the round that are no longer active don't come back from the fetch above.
    known = {r["school_id"] for r in rows}
    inactive = [sid for sid in school_ids if sid not in known]

    excluded = [sid for sid in (rnd.get("excluded_school_ids") or []) if sid in set(rnd.get("school_ids") or [])]
    counts = {s: 0 for s in STATUSES}
    for r in rows:
        counts[r["status"]] += 1
    counts["excluded"] = len(excluded)
    totals = {
        "schools": len(rows),
        "required": sum(r["required_count"] for r in rows),
        "booked": sum(r["booked_count"] for r in rows),
        "done_meetings": sum(min(r["required_count"], sum(1 for m in r["meetings"] if m["status"] == "completed")) for r in rows),
        "counts": counts,
    }
    return {"schools": rows, "totals": totals, "tasks": tasks, "inactive_school_ids": inactive,
            "excluded_school_ids": excluded}


def cache_patch(rnd: dict, result: dict) -> dict | None:
    """The round's cached columns, or None when nothing changed."""
    t = result["totals"]
    patch = {
        "cached_total_schools": t["schools"], "cached_required": t["required"],
        "cached_booked": t["booked"], "cached_untouched": t["counts"]["untouched"],
    }
    if all(rnd.get(k) == v for k, v in patch.items()):
        return None
    return {**patch, "cache_updated_at": datetime.now(timezone.utc).isoformat()}


def refresh_round_caches(db, org_id: str | None = None) -> int:
    """Recomputes the cached totals of every active round (the tasks-recompute-progress cron).
    One failing round never stops the others. Returns how many rounds changed."""
    q = db.table("meeting_rounds").select("*").eq("status", "active")
    if org_id:
        q = q.eq("org_id", org_id)
    changed = 0
    for rnd in q.execute().data or []:
        if rnd.get("cache_updated_at") and rnd["end_date"] < (date.today() - timedelta(days=30)).isoformat():
            continue  # over for a month — its numbers no longer move
        try:
            patch = cache_patch(rnd, compute_round(db, rnd))
            if patch:
                db.table("meeting_rounds").update(patch).eq("id", rnd["id"]).execute()
                changed += 1
        except Exception as exc:
            _log.warning("round cache refresh failed for %s (non-fatal): %s", rnd.get("id"), exc)
    return changed


def open_request_school_ids(db, round_id: str) -> set[str]:
    """Schools whose latest request in one of the round's tasks is still live (sent or about to
    be, link not expired). A new task of the round leaves them out unless asked to include them,
    so a school never gets the same request twice — whatever filter the new task uses."""
    _tasks, latest_msg, tokens, _notes = _fetch_round_requests(db, round_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    return {sid for sid, m in latest_msg.items() if _is_open_request(m, tokens.get(m.get("booking_token_id")), now_iso)}
