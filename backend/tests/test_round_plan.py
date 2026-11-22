"""סבב "לפי תוכנית" — each school's own number of meetings from its card plan (meeting_plan.py +
meeting_rounds.plan_detail). The examples are the ones agreed with the product owner (אלון, ברוש,
גפן): a round for Dec–Feb; a missed meeting from before is offered now or deferred, never dropped.
Fully offline."""
import sys
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_plan  # noqa: E402
import meeting_rounds  # noqa: E402

YEAR = "תשפ\"ז"
NOW = "2026-12-01T08:00:00+00:00"
START, END = "2026-12-01", "2027-02-28"


def school(sid="s1", same=False, stage="yesodi"):
    return {"id": sid, "name": sid, "stage": stage, "advisor_gefen": ["g"], "advisor_current": ["g" if same else "c"],
            "advisor_district": [], "advisor_gefen_current_same": same}


def meeting(day, service_type="gefen", status="completed", mid=None):
    return {"id": mid or f"m-{day}-{service_type}", "school_id": "s1", "meeting_date": day,
            "meeting_service_type": service_type, "status": status, "stage_scope": None,
            "meeting_type": "remote", "booking_token_id": None}


def make_round(school_plan, service_type="by_service"):
    return {"id": "r1", "org_id": "o", "academic_year": YEAR, "start_date": START, "end_date": END,
            "plan_mode": "plan", "school_plan": school_plan,
            "requirement": {"meeting_service_type": service_type, "gefen_current_split": "separate", "count_per_school": 1}}


def snapshot(card, parts, offer=True):
    start, end = date.fromisoformat(START), date.fromisoformat(END)
    out = {}
    for p in parts:
        e = meeting_plan.snapshot_part(card, p, YEAR, start, end)
        e["offer"] = offer
        out[p] = e
    return out


def row(rnd, sch, year_row, meetings=()):
    cond = meeting_rounds.round_condition(rnd)
    plan = meeting_rounds.plan_detail(rnd, cond, sch, list(meetings), year_row)
    return meeting_rounds.school_status(cond, sch, list(meetings), year_row, set(), None, None, None, NOW, None, plan)


def test_alon_missed_september_is_offered_with_the_quarter_meeting():
    card = {"gefen": meeting_plan.spread(4)}  # Sep, Dec, Mar, Jun
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    r = row(rnd, school(), year_row)
    assert r["required_count"] == 2
    part = r["plan"]["parts"]["gefen"]
    assert (part["planned_before"], part["planned_in"], part["held_before"], part["carried"]) == (1, 1, 0, 1)
    assert r["status"] == "untouched"


def test_alon_deferred_missed_meeting_is_not_asked_now_but_stays_missing():
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"], offer=False)})
    r = row(rnd, school(), year_row)
    assert r["required_count"] == 1
    assert r["plan"]["parts"]["gefen"]["carried"] == 1  # still shown as missing


def test_alon_with_september_held_and_december_booked_is_covered():
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    r = row(rnd, school(), year_row, [meeting("2026-09-10"), meeting("2026-12-15", status="scheduled")])
    assert r["required_count"] == 1
    assert r["booked_count"] == 1
    assert r["status"] == "booked"


def test_a_cancelled_meeting_does_not_count():
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    # The fetch only returns scheduled/completed meetings; a cancelled one must not count either way.
    r = row(rnd, school(), year_row, [meeting("2026-09-10", status="cancelled")])
    assert r["plan"]["parts"]["gefen"]["held_before"] == 0
    assert r["required_count"] == 2


def test_brosh_every_two_months_missed_november():
    card = {"gefen": meeting_plan.spread(6)}  # Sep, Nov, Jan, Mar, May, Jul
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    r = row(rnd, school(), year_row, [meeting("2026-09-20")])
    part = r["plan"]["parts"]["gefen"]
    assert (part["planned_before"], part["held_before"], part["carried"], part["planned_in"]) == (2, 1, 1, 1)
    assert r["required_count"] == 2


def test_gefen_school_two_parts_each_counted_on_its_own():
    card = {"gefen": meeting_plan.spread(4), "current": meeting_plan.spread(12)}
    year_row = {"service_type": "gefen_current", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen", "current"])})
    held = [meeting("2026-09-05", "gefen"), meeting("2026-09-06", "current"),
            meeting("2026-10-06", "current"), meeting("2026-11-06", "current")]
    r = row(rnd, school(same=False), year_row, held)
    assert r["plan"]["parts"]["gefen"]["required"] == 1
    assert r["plan"]["parts"]["current"]["required"] == 3
    assert r["required_count"] == 4


def test_combined_meeting_counts_for_both_parts():
    card = {"gefen": {"09": 1}, "current": {"09": 1}}
    assert meeting_plan.meetings_before([meeting("2026-09-05", "gefen_current")], "gefen", YEAR, date(2026, 12, 1)) == 1
    assert meeting_plan.meetings_before([meeting("2026-09-05", "gefen_current")], "current", YEAR, date(2026, 12, 1)) == 1
    # Same advisors → one combined meeting asks as many as the larger part.
    by_type = meeting_plan.required_by_meeting_type(
        {"gefen": {"planned_before": 0, "planned_in": 1}, "current": {"planned_before": 0, "planned_in": 3}}, {})
    assert by_type["gefen_current"] == 3
    assert card  # (fixture kept for readability)


def test_meetings_ahead_of_the_plan_reduce_the_round():
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    r = row(rnd, school(), year_row, [meeting("2026-09-10"), meeting("2026-11-10")])
    assert r["required_count"] == 0
    assert r["status"] == "not_needed"


def test_school_without_numbers_is_a_problem_and_adds_nothing():
    year_row = {"service_type": "gefen", "meeting_plan": None}
    rnd = make_round({})
    r = row(rnd, school(), year_row)
    assert r["status"] == "problem"
    assert r["problem"] == "missing_plan"
    assert r["required_count"] == 0
    assert r["plan"]["parts"]["gefen"]["missing"] is True


def test_manual_number_for_a_school_without_plan():
    year_row = {"service_type": "gefen", "meeting_plan": None}
    rnd = make_round({"s1": {"gefen": {"planned_before": 0, "planned_in": 2, "offer": True, "manual": True,
                                       "source": meeting_plan.plan_source(None, "gefen")}}})
    r = row(rnd, school(), year_row)
    assert r["required_count"] == 2
    assert r["plan"]["changed"] is False


def test_card_change_after_the_snapshot_is_reported():
    card = {"gefen": meeting_plan.spread(4)}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    r = row(rnd, school(), {"service_type": "gefen", "meeting_plan": card})
    assert r["plan"]["changed"] is False
    r = row(rnd, school(), {"service_type": "gefen", "meeting_plan": {"gefen": meeting_plan.spread(12)}})
    assert r["plan"]["changed"] is True
    # A physical mark added on the card is a change too.
    r = row(rnd, school(), {"service_type": "gefen", "meeting_plan": {**card, "physical": {"gefen": ["12"]}}})
    assert r["plan"]["changed"] is True


def test_a_plan_added_to_the_card_after_a_manual_number_is_a_change():
    rnd = make_round({"s1": {"gefen": {"planned_before": 0, "planned_in": 1, "offer": True, "manual": True, "source": "|"}}})
    r = row(rnd, school(), {"service_type": "gefen", "meeting_plan": {"gefen": {"12": 1}}})
    assert r["plan"]["changed"] is True


def test_fixed_count_rounds_are_unchanged():
    rnd = {**make_round(None), "plan_mode": None, "requirement": {"meeting_service_type": "gefen", "count_per_school": 2}}
    cond = meeting_rounds.round_condition(rnd)
    assert cond["required_count"] == 2
    r = meeting_rounds.school_status(cond, school(), [], {"service_type": "gefen"}, set(), None, None, None, NOW)
    assert r["plan"] is None
    assert r["required_count"] == 2


def test_physical_months_inside_the_round():
    card = {"gefen": {"09": 1, "12": 1, "03": 1}, "physical": {"gefen": ["09", "12"]}}
    assert meeting_plan.physical_in(card, "gefen", YEAR, date(2026, 12, 1), date(2027, 2, 28)) == ["12"]


def test_overlap_only_between_rounds_that_can_count_the_same_meeting():
    from routers.rounds_router import _round_parts
    assert not (_round_parts("current") & _round_parts("gefen"))
    assert _round_parts("gefen_current") & _round_parts("gefen")
    assert _round_parts("by_service") & _round_parts("district")
    assert not (_round_parts("district") & _round_parts("takuma"))


# --- Phase ג: a task of the round sends one request per missing meeting, each with its dates ---

D = date.fromisoformat


def windows_for(card, part="gefen", meetings=(), today=START, offer=True, entry=None):
    s, e = D(START), D(END)
    entry = entry or {**meeting_plan.snapshot_part(card, part, YEAR, s, e), "offer": offer}
    held = meeting_plan.meetings_before(list(meetings), part, YEAR, s)
    in_round = [m["meeting_date"] for m in meetings if START <= m["meeting_date"] <= END]
    return meeting_plan.request_windows(card, entry, part, YEAR, s, e, held, in_round, D(today))


def test_alon_gets_a_december_request_and_a_whole_round_one():
    w = windows_for({"gefen": meeting_plan.spread(4)})
    assert w == [(D("2026-12-01"), D("2026-12-31")), (D("2026-12-01"), D("2027-02-28"))]


def test_alon_deferred_gets_only_december():
    assert windows_for({"gefen": meeting_plan.spread(4)}, offer=False) == [(D("2026-12-01"), D("2026-12-31"))]


def test_a_meeting_already_in_december_takes_the_december_request():
    w = windows_for({"gefen": meeting_plan.spread(4)}, meetings=[meeting("2026-12-10", status="scheduled")])
    assert w == [(D("2026-12-01"), D("2027-02-28"))]


def test_monthly_plan_gets_one_request_per_month():
    card = {"current": meeting_plan.spread(12)}
    held = [meeting(d, "current") for d in ("2026-09-05", "2026-10-05", "2026-11-05")]
    w = windows_for(card, "current", held)
    assert [a.month for a, _b in w] == [12, 1, 2]


def test_a_month_already_over_moves_to_the_rest_of_the_round():
    card = {"current": meeting_plan.spread(12)}
    held = [meeting(d, "current") for d in ("2026-09-05", "2026-10-05", "2026-11-05")]
    w = windows_for(card, "current", held, today="2027-01-10")
    assert w == [(D("2027-01-10"), D("2027-01-31")), (D("2027-01-10"), D("2027-02-28")), (D("2027-02-01"), D("2027-02-28"))]


def test_nothing_is_sent_after_the_round_ended():
    assert windows_for({"gefen": meeting_plan.spread(4)}, today="2027-03-01") == []


def test_meetings_ahead_of_the_plan_drop_requests():
    card = {"gefen": meeting_plan.spread(4)}
    assert windows_for(card, meetings=[meeting("2026-09-10"), meeting("2026-11-10")]) == []


def test_typed_in_number_is_spread_over_the_round():
    entry = {"planned_before": 0, "planned_in": 2, "offer": True, "manual": True, "source": "|"}
    w = windows_for(None, entry=entry)
    assert len(w) == 2 and w[0][0] == D(START) and w[-1][1] == D(END) and w[0][1] < w[1][0]


def test_card_changed_after_the_snapshot_spreads_evenly():
    card = {"gefen": meeting_plan.spread(4)}
    s, e = D(START), D(END)
    entry = {**meeting_plan.snapshot_part(card, "gefen", YEAR, s, e), "planned_in": 2}  # manager raised it
    w = meeting_plan.request_windows(card, entry, "gefen", YEAR, s, e, 1, [], s)
    assert len(w) == 2


def test_split_evenly_covers_the_period_without_gaps():
    w = meeting_plan.split_evenly(D("2026-12-01"), D("2027-02-28"), 3)
    assert w[0][0] == D("2026-12-01") and w[-1][1] == D("2027-02-28")
    assert all(w[i][1].toordinal() + 1 == w[i + 1][0].toordinal() for i in range(2))


def test_task_send_expands_a_round_plan_condition_into_requests():
    from routers.tasks_router import _round_plan_requests
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    cond = {"type": "meeting", "meeting_service_type": "gefen", "round_plan": True,
            "date_segments": [{"date_from": START, "date_to": END}]}
    out = _round_plan_requests(rnd, [cond], school(), [], year_row, D(START))
    assert len(out) == 2
    assert all(c["round_plan_request"] and c["round_id"] == "r1" for c in out)
    assert out[0]["label_suffix"] == "דצמבר"
    assert out[1]["date_segments"] == [{"date_from": START, "date_to": END}]
    # A plain condition passes through; a school with no numbers gets nothing.
    plain = {"type": "meeting", "meeting_service_type": "current"}
    assert _round_plan_requests(rnd, [plain], school(), [], year_row, D(START)) == [plain]
    assert _round_plan_requests(make_round({}), [cond], school(), [], year_row, D(START)) == []


def test_task_progress_uses_the_schools_own_count():
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    cond = {"type": "meeting", "meeting_service_type": "gefen", "round_plan": True,
            "date_segments": [{"date_from": START, "date_to": END}]}
    c = meeting_rounds.with_round_plan(rnd, cond, school(), [], year_row)
    import task_logic
    assert task_logic._required_count_for_condition(c, school()) == 2
    # Not a round-plan condition / not a plan round → untouched.
    assert meeting_rounds.with_round_plan(rnd, {**cond, "round_plan": None}, school(), [], year_row) == {**cond, "round_plan": None}
    assert meeting_rounds.with_round_plan({**rnd, "plan_mode": None}, cond, school(), [], year_row) == cond


def test_remaining_need_closes_requests_once_the_school_has_enough(monkeypatch):
    import task_logic
    card = {"gefen": meeting_plan.spread(4)}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    sch = school()
    state = {"meetings": []}
    monkeypatch.setattr(task_logic, "_fetch_schools_and_meetings", lambda *a, **k: (
        [sch], state["meetings"], {"s1": {"service_type": "gefen", "meeting_plan": card}}, {}, {}))
    assert meeting_rounds.remaining_need(None, rnd, "s1", "gefen")[0] == 2
    state["meetings"] = [meeting("2026-12-10", status="scheduled")]
    assert meeting_rounds.remaining_need(None, rnd, "s1", "gefen")[0] == 1
    state["meetings"] = [meeting("2026-12-10", status="scheduled", mid="a"), meeting("2027-01-10", mid="b")]
    left, latest = meeting_rounds.remaining_need(None, rnd, "s1", "gefen")
    assert left == 0 and latest["meeting_date"] == "2027-01-10"


def test_booking_page_keeps_a_round_plan_request_open_until_the_need_is_met(monkeypatch):
    from fake_supabase import FakeDb
    from routers import meeting_booking_router as mbr
    db = FakeDb({"meeting_rounds": [{**make_round({}), "org_id": "o"}]})
    token = {"id": "t1", "org_id": "o", "school_id": "s1"}
    rng = {"key": "r0", "service_type": "gefen", "round_plan_request": True, "round_id": "r1"}
    need = {"left": 1}
    monkeypatch.setattr(mbr.meeting_rounds, "remaining_need",
                        lambda _db, _r, _s, _t: (need["left"], {"meeting_date": "2027-01-10", "start_time": "10:00"}))
    assert mbr._range_blocking_meeting(db, token, rng) is None
    need["left"] = 0
    assert mbr._range_blocking_meeting(db, token, rng)["meeting_date"] == "2027-01-10"
    # Another org's round is never read.
    assert mbr._range_blocking_meeting(db, {**token, "org_id": "x"}, rng) is None


def test_six_year_separate_condition_is_not_split_by_month():
    from routers.tasks_router import _round_plan_requests
    card = {"gefen": meeting_plan.spread(4)}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    six = {**school(stage="sheshshnati"), "principal_same_person": False}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    cond = {"type": "meeting", "meeting_service_type": "gefen", "round_plan": True, "stage_scope": "separate",
            "date_segments": [{"date_from": START, "date_to": END}]}
    assert _round_plan_requests(rnd, [cond], six, [], year_row, D(START)) == [cond]


def test_physical_request_without_field_days_in_its_month_uses_the_rest_of_the_round():
    from routers.tasks_router import _build_meeting_ranges, _round_plan_requests
    card = {"gefen": {"12": 1}}
    year_row = {"service_type": "gefen", "meeting_plan": card}
    sch = {**school(), "principal_name": "מנהלת", "principal_email": "p@example.com", "principal_phone": "050"}
    rnd = make_round({"s1": snapshot(card, ["gefen"])})
    cond = {"type": "meeting", "meeting_service_type": "gefen", "round_plan": True, "use_field_days": True,
            "meeting_type": "physical", "participant_roles": ["principal"], "advisor_mode": "default",
            "duration_mode": "manual", "duration_minutes": 60,
            "date_segments": [{"date_from": START, "date_to": END}]}
    reqs = _round_plan_requests(rnd, [cond], sch, [], year_row, D(START))
    assert len(reqs) == 1 and reqs[0]["label_suffix"] == "דצמבר"
    ranges = _build_meeting_ranges(sch, reqs, {"gefen": ["g"]}, {}, None, {"g": ["2027-01-12"]}, set(), None, None)
    assert ranges and len(ranges) == 1
    assert ranges[0]["segments"][0]["start_date"] == "2027-01-12"
    assert ranges[0]["label"].endswith("עד 28/02")
    assert ranges[0]["round_plan_request"] is True
