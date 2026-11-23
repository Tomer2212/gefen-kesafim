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

import meeting_plan
import task_logic

_log = logging.getLogger(__name__)

# The order is the funnel's; a school's status is the first that applies.
STATUSES = ("done", "booked", "partial", "opened", "requested", "problem", "untouched", "self_scheduled",
            "not_needed", "excluded")
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
    if count > 1 and rnd.get("plan_mode") != "plan":
        cond["required_count"] = count
    if rnd.get("advisor_exclusions"):
        cond["advisor_exclusions"] = rnd["advisor_exclusions"]
    if rnd.get("part_exclusions"):
        cond["school_part_exclusions"] = rnd["part_exclusions"]
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
    by_school: dict[str, list[dict]] = {}
    for m in msgs:
        by_school.setdefault(m["school_id"], []).append(m)
    for sid, rows in by_school.items():
        latest_msg[sid] = school_request_message(rows)
    token_ids = list({m["booking_token_id"] for m in latest_msg.values() if m.get("booking_token_id")})
    if token_ids:
        rows = (
            db.table("meeting_booking_tokens").select("id, first_viewed_at, expires_at, closed_message")
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


# A message never sent (stopped by the last check before sending — e.g. its link asked only for
# what was booked meanwhile — or opted out) isn't the school's request; ranked below every other.
_NOT_A_REQUEST = {"skipped"}
_REQUEST_STATUS_RANK = {"sent": 0, "outlook_pending": 1, "sending": 2, "pending": 3, "failed": 4}


def school_request_message(rows: list[dict]) -> dict:
    """The message that stands for a school's request in the round. A send can create several
    messages for one school at the same instant (one per coordinator — e.g. the גפן request to the
    principal and the שוטף one to the secretary), so "the latest" alone is a coin toss: the newest
    message that was not skipped wins, and among messages of the same moment the one actually sent."""
    candidates = [m for m in rows if m.get("status") not in _NOT_A_REQUEST] or rows
    # max() keeps the first of equal timestamps, so rank the statuses first.
    ranked = sorted(candidates, key=lambda m: _REQUEST_STATUS_RANK.get(m.get("status"), 9))
    return max(ranked, key=lambda m: m.get("created_at") or "")


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


def visiting_advisors(advisor_ids: list[str], exempt: set[str] | None, visitors: list[str] | None) -> list[str]:
    """The advisors of a physical meeting who actually go to the school: not exempted from field
    days in the round, and — when the round recorded who visits this school (a גפן+שוטף school
    with two different advisors, meeting_rounds.physical_visitors) — one of them."""
    return [aid for aid in advisor_ids
            if aid not in (exempt or set()) and (visitors is None or aid in visitors)]


def part_options(cond: dict, school: dict, year_row: dict | None) -> list[dict]:
    """[{part, advisor_ids}] — the parts the round's requirement asks of this school by its card,
    whatever is excluded (the "התאמת פגישות" choices)."""
    plain = {k: v for k, v in cond.items() if k not in ("school_part_exclusions", "advisor_exclusions")}
    expanded = task_logic.expand_meeting_condition(
        plain, (year_row or {}).get("service_type"), bool(school.get("advisor_gefen_current_same")),
    )
    out: list[dict] = []
    for c in expanded:
        for part in task_logic.meeting_parts(c.get("meeting_service_type")):
            if part not in [o["part"] for o in out]:
                out.append({"part": part, "advisor_ids": _advisor_ids_for(school, [part])})
    return out


def _is_open_request(msg: dict | None, token: dict | None, now_iso: str) -> bool:
    if not msg or msg.get("status") not in ("sent", "pending", "sending", "outlook_pending"):
        return False
    if (token or {}).get("closed_message"):
        return False  # closed by the staff (e.g. sent by mistake)
    return not token or not token.get("expires_at") or token["expires_at"] > now_iso


def plan_detail(rnd: dict, cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None) -> dict:
    """A round "לפי תוכנית": this school's numbers per part (meeting_plan) and the condition with
    its own required counts. {cond, parts: {part: {...}}, missing, changed}. missing = a part the
    school is asked has no numbers yet (added to the round later, or no plan) — nothing is counted
    for it until the manager fills it in."""
    expanded, _self = task_logic.expand_for_school_detail(cond, school, year_row)
    parts = meeting_plan.parts_for_types([c["meeting_service_type"] for c in expanded])
    entry = (rnd.get("school_plan") or {}).get(school["id"]) or {}
    start = date.fromisoformat(rnd["start_date"])
    card_plan = (year_row or {}).get("meeting_plan")
    held = {p: meeting_plan.meetings_before(school_meetings, p, rnd["academic_year"], start) for p in parts}
    out_parts: dict[str, dict] = {}
    missing = False
    changed = False
    for p in parts:
        e = entry.get(p)
        if not isinstance(e, dict):
            missing = True
            out_parts[p] = {"missing": True, "has_card_plan": bool(meeting_plan.type_total(card_plan, p))}
            continue
        need = meeting_plan.part_need(e, held[p])
        has_card = p in meeting_plan.PLAN_TYPES and bool(meeting_plan.type_total(card_plan, p))
        if e.get("manual"):
            part_changed = has_card  # a plan was added to the card since the number was typed in
        else:
            part_changed = meeting_plan.plan_source(card_plan, p) != e.get("source")
        changed = changed or part_changed
        out_parts[p] = {
            "planned_before": e.get("planned_before") or 0, "planned_in": e.get("planned_in") or 0,
            "offer": e.get("offer", True), "manual": bool(e.get("manual")), "held_before": held[p],
            **need, "changed": part_changed,
        }
    by_type = None if missing else meeting_plan.required_by_meeting_type({p: entry[p] for p in parts}, held)
    return {"cond": {**cond, "required_count_by_type": by_type} if by_type is not None else cond,
            "parts": out_parts, "missing": missing, "changed": changed}


def school_status(
    cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None, token_ids: set[str],
    msg: dict | None, token: dict | None, note: dict | None, now_iso: str, advisor_choices: dict | None = None,
    plan: dict | None = None, physical: bool = False, visitors: list[str] | None = None,
    exempt: set[str] | None = None,
) -> dict:
    """One school's row in the round: what it needs, what it has, and where its request stands.
    advisor_choices = the round's remembered "which of several card advisors" answers for this
    school (meeting_rounds.advisor_choices[sid]): its advisors are the chosen ones; the advisors
    of a part still to be chosen are also listed in advisor_choice_open_ids.
    plan = plan_detail(...) for a round "לפי תוכנית" (its cond already carries the school's counts).
    physical / visitors / exempt = the round's in-person marking, who visits this school and who is
    exempt from field days — they decide where each still-missing part is held (location_need):
    a physical school's part with no visiting advisor is held remotely (tasks_router._build_meeting_ranges)."""
    if plan is not None:
        cond = plan["cond"]
    res = task_logic._meeting_condition_result(cond, school, school_meetings, year_row, token_ids)
    expanded, nothing_asked = task_logic.expand_for_school_reason(cond, school, year_row)
    self_scheduled = nothing_asked == "self_scheduled"
    not_needed = nothing_asked == "not_needed"
    types = [c["meeting_service_type"] for c in expanded]
    # Advisors who book their own part (round's advisor_exclusions) aren't this school's advisors here.
    removed = {a for c in expanded for a in c.get("exclude_advisor_ids") or []}
    lists = task_logic.school_advisor_lists(school)
    advisor_ids: list[str] = []
    open_ids: set[str] = set()
    # Each meeting asked of the school, with its own advisors and counts — the "by advisor" table
    # credits an advisor only with the meetings they're in.
    parts: list[dict] = []
    for c in expanded:
        part_ids: list[str] = []
        for scope in task_logic.range_split_scopes(school, task_logic.effective_stage_scope(c, school)):
            ids, questions = task_logic.chosen_default_advisors(
                lists, c["meeting_service_type"], c.get("exclude_advisor_ids"), scope, advisor_choices,
            )
            advisor_ids += [a for a in ids if a not in advisor_ids]
            part_ids += [a for a in ids if a not in part_ids]
            open_ids |= {a for q in questions for a in q["advisor_ids"]}
        part_required = task_logic._required_count_for_condition(c, school)
        part_booked = min(task_logic._fulfilled_count_for_meeting_condition(c, school_meetings, token_ids, school),
                          part_required)
        parts.append({
            "type": c["meeting_service_type"], "advisor_ids": part_ids,
            "required": part_required, "booked": part_booked,
            # Held in person only when one of its advisors visits (no advisor yet → as marked).
            "physical": physical and (not part_ids or bool(visiting_advisors(part_ids, exempt, visitors))),
        })
    if not expanded:
        # No service type yet (or self-scheduled) → every advisor on its card, so it still shows
        # under its advisor.
        advisor_ids = [a for a in _advisor_ids_for(school, ["gefen", "current", "district"]) if a not in removed]
    matched: dict[str, dict] = {}
    for c in expanded:
        for m in task_logic._matching_meetings(c, school_meetings, token_ids):
            matched[m["id"]] = m
    meetings = sorted(matched.values(), key=lambda m: m.get("meeting_date") or "")
    # A school still missing its plan numbers has no known need yet — it adds nothing to the totals.
    counted = bool(expanded) and not (plan is not None and plan["missing"])
    required = res["required_count"] if counted else 0
    have = min(res["actual_count"] or 0, required) if counted else 0
    if not counted:
        for p in parts:
            p["required"] = p["booked"] = 0
    missing_parts = [p for p in parts if p["booked"] < p["required"]]

    if not_needed:
        status = "not_needed"  # the round needs none of its meetings ("פגישה לא נדרשת בסבב")
    elif self_scheduled:
        status = "self_scheduled"  # every meeting is booked by its advisors themselves
    elif not expanded:
        status = "problem"
    elif plan is not None and plan["missing"]:
        status = "problem"  # the manager still has to say how many meetings it needs
    elif plan is not None and required == 0:
        status = "not_needed"  # its plan asks nothing in this round
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
        "problem": "missing_service_type" if not expanded and not nothing_asked else "missing_plan" if (
            plan is not None and plan["missing"] and not nothing_asked) else (
            "send_failed" if (msg or {}).get("status") == "failed" else (note or {}).get("skip_reason") if status == "problem" else None),
        "required_types": types,
        # For the dashboard's "by type" breakdown: the card's service type and whether its גפן and
        # שוטף advisors are the same people (one combined meeting) or not.
        "card_service_type": (year_row or {}).get("service_type"),
        "gefen_current_same": bool(school.get("advisor_gefen_current_same")),
        "required_count": required, "booked_count": have,
        # A round "לפי תוכנית": per part — planned before/in the round, held before it, missing from
        # before (carried, asked now only when offer), and whether the card's plan changed since.
        "plan": None if plan is None else {"parts": plan["parts"], "missing": plan["missing"], "changed": plan["changed"]},
        "advisor_ids": advisor_ids,
        "parts": parts,
        # "התאמת פגישות": every part the round could ask of the school (its card, before any
        # exclusion) with its card advisors, and the parts marked "not needed in this round".
        "part_options": part_options(cond, school, year_row),
        "excluded_parts": list(((cond.get("school_part_exclusions") or {}).get(school["id"])) or []),
        # Where the meetings it still lacks are held: "physical" when one of them has a visiting
        # advisor (a physical task asks for all of them, the others as remote ranges), "remote"
        # when none has — even at a school marked physical whose in-person part is already booked.
        "location_need": None if not missing_parts else (
            "physical" if any(p["physical"] for p in missing_parts) else "remote"),
        # Still missing a meeting and no live request asks for it — nothing will happen unless a
        # task is created for it (the dashboard's warning).
        "needs_request": status in ("partial", "untouched") and not _is_open_request(msg, token, now_iso),
        # Advisors of a part with several card advisors not chosen yet (the task's pre-check asks):
        # whether they're needed (e.g. their field days) isn't known until then.
        "advisor_choice_open_ids": sorted(open_ids),
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
    visitors = rnd.get("physical_visitors") or {}
    exempt = set(rnd.get("field_exempt_advisor_ids") or [])

    plan_mode = rnd.get("plan_mode") == "plan"
    rows = []
    for s in schools:
        msg = latest_msg.get(s["id"])
        school_meetings = meetings_by_school.get(s["id"], [])
        plan = plan_detail(rnd, cond, s, school_meetings, year_map.get(s["id"])) if plan_mode else None
        row = school_status(
            cond, s, school_meetings, year_map.get(s["id"]), token_ids,
            msg, tokens.get((msg or {}).get("booking_token_id")), notes.get(s["id"]), now_iso,
            (rnd.get("advisor_choices") or {}).get(s["id"]), plan,
            s["id"] in physical, visitors.get(s["id"]), exempt,
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


# ---------------------------------------------------------------------------
# Tasks of a round "לפי תוכנית" (their meeting conditions carry round_plan): each school gets one
# request per meeting it still needs (plan_request_windows), its progress uses its own counts
# (with_round_plan), and a request stays open until the school's need in the round is met, however
# the meetings were booked (remaining_need — the booking page's rule for such a request).
# ---------------------------------------------------------------------------

def with_round_plan(rnd: dict | None, cond: dict, school: dict, school_meetings: list[dict], year_row: dict | None) -> dict:
    """The task condition with this school's own counts from the round (required_count_by_type).
    Unchanged when it isn't a round-plan condition, or the school has no numbers yet."""
    if not rnd or not cond.get("round_plan") or rnd.get("plan_mode") != "plan":
        return cond
    detail = plan_detail(rnd, round_condition(rnd), school, school_meetings, year_row)
    by_type = detail["cond"].get("required_count_by_type")
    return {**cond, "required_count_by_type": by_type} if by_type is not None else cond


def plan_request_windows(rnd: dict, cond: dict, school: dict, school_meetings: list[dict],
                         year_row: dict | None, today: date) -> list[tuple[date, date]]:
    """The dates of each request still to send to the school for one plain meeting condition.
    A combined גפן+שוטף meeting follows whichever part needs more."""
    entry = (rnd.get("school_plan") or {}).get(school["id"]) or {}
    start, end = date.fromisoformat(rnd["start_date"]), date.fromisoformat(rnd["end_date"])
    in_round = [m["meeting_date"] for m in task_logic._matching_meetings(cond, school_meetings, None)
                if rnd["start_date"] <= (m.get("meeting_date") or "")[:10] <= rnd["end_date"]]
    best: list[tuple[date, date]] = []
    for part in meeting_plan.MEETING_TYPE_PARTS.get(cond.get("meeting_service_type"), []):
        e = entry.get(part)
        if not isinstance(e, dict):
            continue
        held = meeting_plan.meetings_before(school_meetings, part, rnd["academic_year"], start)
        windows = meeting_plan.request_windows(
            (year_row or {}).get("meeting_plan"), e, part, rnd["academic_year"], start, end, held, in_round, today,
        )
        if len(windows) > len(best):
            best = windows
    return best


def remaining_need(db, rnd: dict, school_id: str, service_type: str) -> tuple[int, dict | None]:
    """(meetings of this type the school still needs in the round, its latest meeting there) —
    read live. A request of a round-plan task stays open only while this is above 0."""
    schools, meetings, year_map, _g, _c = task_logic._fetch_schools_and_meetings(
        rnd["org_id"], rnd["academic_year"], only_school_ids=[school_id],
    )
    if not schools:
        return 0, None
    school = schools[0]
    school_meetings = [m for m in meetings if m["school_id"] == school_id]
    detail = plan_detail(rnd, round_condition(rnd), school, school_meetings, year_map.get(school_id))
    if detail["missing"]:
        return 1, None  # no numbers yet — never block the school's own request
    expanded, _self = task_logic.expand_for_school_detail(detail["cond"], school, year_map.get(school_id))
    for c in expanded:
        if c["meeting_service_type"] != service_type:
            continue
        matched = task_logic._matching_meetings(c, school_meetings, None)
        left = (task_logic._required_count_for_condition(c, school)
                - task_logic._fulfilled_count_for_meeting_condition(c, school_meetings, None, school))
        latest = max(matched, key=lambda m: m.get("meeting_date") or "", default=None)
        return max(0, left), latest
    return 1, None  # the type isn't asked of the school anymore — leave the request as it is
