"""Calls between colleagues: one conversation is counted once per school, and a call doesn't
wander between a school's same-day meetings (school 460030, 2026-11-23). Fully offline."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import call_conversations as cc  # noqa: E402
import meeting_activity  # noqa: E402
import meeting_overlaps as mo  # noqa: E402
from routers import schools_router as sr  # noqa: E402
from tests import fake_supabase  # noqa: E402

DAY = "2026-11-23"


def call(cid, own, other, start, seconds, direction="outgoing"):
    def side(k):
        return k if ":" in k else f"user:{k}"
    return {"call_id": cid, "own_key": side(own), "other_key": side(other), "advisor_id": None if ":" in own else own,
            "counterpart_user_id": None if ":" in other else other, "counterpart_phone": "0500000000",
            "start_time": f"{DAY}T{start}Z", "duration_seconds": seconds, "direction": direction}


def mirror(c, cid, shift=1, dur=0):
    base = c["start_time"]
    sec = int(base[17:19]) + shift
    return {**c, "call_id": cid, "own_key": c["other_key"], "other_key": c["own_key"], "advisor_id": c["counterpart_user_id"],
            "counterpart_user_id": c["advisor_id"], "direction": "incoming" if c["direction"] == "outgoing" else "outgoing",
            "start_time": f"{base[:17]}{sec:02d}Z", "duration_seconds": c["duration_seconds"] + dur}


# --- mirrors ---------------------------------------------------------------------------------

def test_mirror_with_a_second_of_difference_counts_once_in_either_order():
    a = call("a", "shosh", "tal", "13:00:20", 7200)
    b = mirror(a, "b", shift=1, dur=-1)
    for calls in ([a, b], [b, a]):
        assert sum(cc.counted_seconds(calls).values()) == 7200
        kept, dropped = cc.collapse_mirrors(calls)
        assert [c["call_id"] for c in kept] == ["a"] and dropped == {"a": ["b"]}
    assert cc.collapse_mirrors([a, b], preferred_ids={"b"})[0] == [b]


def test_not_a_mirror():
    a = call("a", "shosh", "tal", "13:00:20", 600)
    assert cc.is_mirror(a, mirror(a, "b"))
    assert not cc.is_mirror(a, {**mirror(a, "b"), "direction": "outgoing"})  # each called the other
    assert not cc.is_mirror(a, mirror(a, "b", shift=20))
    assert not cc.is_mirror(a, {**mirror(a, "b"), "duration_seconds": 10})
    assert not cc.is_mirror(a, {**mirror(a, "b"), "own_key": "user:dasi"})
    assert not cc.is_mirror({**a, "own_key": None}, {**mirror(a, "b"), "other_key": None})


def test_two_short_calls_in_a_row_pair_one_to_one():
    a1, a2 = call("a1", "x", "y", "10:00:00", 0), call("a2", "x", "y", "10:00:03", 0)
    kept, dropped = cc.collapse_mirrors([a1, a2, mirror(a1, "b1"), mirror(a2, "b2")])
    assert [c["call_id"] for c in kept] == ["a1", "a2"] and sorted(sum(dropped.values(), [])) == ["b1", "b2"]


# --- conference / real parallel work -----------------------------------------------------------

def test_conference_of_three_counts_the_time_that_passed():
    ab = call("ab", "a", "b", "10:00:00", 3600)
    bc = call("bc", "b", "c", "10:10:00", 3600)
    calls = [ab, mirror(ab, "ab2"), bc, mirror(bc, "bc2")]
    assert sum(cc.counted_seconds(calls).values()) == 70 * 60
    assert cc.counted_seconds([ab, call("in", "b", "c", "10:10:00", 60)])["in"] == 0


def test_parallel_calls_of_different_users_count_in_full():
    calls = [call("1", "a", "tel:501111111", "10:00:00", 600), call("2", "b", "tel:501111111", "10:00:00", 600)]
    assert sum(cc.counted_seconds(calls).values()) == 1200


def test_links_saved_before_side_keys_count_as_before():
    rows = [{"call_id": x, "call_time": f"{DAY}T10:00:00Z", "duration_seconds": 600, "advisor_id": "a"} for x in ("1", "2")]
    assert sum(cc.counted_seconds([cc.link_as_call(r, lambda p: p) for r in rows]).values()) == 1200


# --- attribution -------------------------------------------------------------------------------

def m(mid, start=None, end=None, advisors=(), status="scheduled", **over):
    return {"id": mid, "start_time": start, "end_time": end, "advisor_ids": list(advisors), "status": status, **over}


SHOSH, DASI = m("m1", advisors=["shosh"]), m("m2", "13:00", "18:00", ["dasi"])
CALL = call("a", "shosh", "tal", "13:00:20", 7200)  # 15:00 in Israel


def test_call_stays_with_the_advisor_who_spoke():
    assert sr._attribute_calls_to_meetings([CALL], [SHOSH, DASI], {"a": "m1"}) == {"a": "m1"}
    assert sr._attribute_calls_to_meetings([CALL], [SHOSH, DASI]) == {"a": "m1"}
    # ...also when the performing advisor is the call's other side.
    assert sr._attribute_calls_to_meetings([CALL], [m("m1", advisors=["tal"]), DASI]) == {"a": "m1"}


def test_hours_that_cannot_decide_do_not_move_a_call():
    mine = {**DASI, "advisor_ids": ["shosh"]}
    assert sr._attribute_calls_to_meetings([CALL], [SHOSH, mine], {"a": "m1"}) == {"a": "m1"}
    both = [m("m1", "14:00", "16:00", ["shosh"]), m("m2", "14:30", "15:30", ["shosh"])]
    assert sr._attribute_calls_to_meetings([CALL], both, {"a": "m1"}) == {"a": "m1"}


def test_a_better_meeting_logged_later_gets_the_call():
    morning, later = m("m1", "08:00", "09:00", ["shosh"]), m("m2", "14:30", "16:00", ["shosh"])
    assert sr._attribute_calls_to_meetings([CALL], [morning], {}) == {"a": "m1"}
    assert sr._attribute_calls_to_meetings([CALL], [morning, later], {"a": "m1"}) == {"a": "m2"}


def test_cancelled_meeting_does_not_compete():
    cancelled = m("m1", "14:00", "16:00", ["shosh"], status="cancelled")
    assert sr._attribute_calls_to_meetings([CALL], [cancelled, DASI], {"a": "m1"}) == {"a": "m1"}
    other_cancelled, mine = {**cancelled, "advisor_ids": ["dasi"]}, m("m2", "14:00", "18:00", ["shosh"])
    assert sr._attribute_calls_to_meetings([CALL], [other_cancelled, DASI], {"a": "m1"}) == {"a": "m2"}
    assert sr._attribute_calls_to_meetings([CALL], [cancelled, mine], {"a": "m1"}) == {"a": "m2"}
    assert sr._attribute_calls_to_meetings([CALL], [cancelled]) == {"a": "m1"}


def _db(*meetings):
    db = fake_supabase.FakeDb()
    for x in meetings:
        db.table("meetings").insert({"school_id": "s", "meeting_date": DAY, **x}).execute()
    return db


def _recompute(db, calls, monkeypatch):
    monkeypatch.setattr(meeting_activity, "log_meeting_activity", lambda *a, **k: None)
    sr._recompute_meeting_call_activity(db, "org", "s", DAY, calls)
    return {r["id"]: r.get("calls_duration_seconds") for r in db.table("meetings").select("*").execute().data}


def _links(db):
    return db.table("meeting_call_links").select("*").execute().data


def test_incident_and_the_other_side_linking_later(monkeypatch):
    db = _db(SHOSH)
    assert _recompute(db, [CALL], monkeypatch) == {"m1": 7200}
    db.table("meeting_call_links").update({"notes": "note"}).eq("call_id", "a").execute()
    db.table("meetings").insert({"school_id": "s", "meeting_date": DAY, **DASI}).execute()
    assert _recompute(db, [CALL], monkeypatch) == {"m1": 7200, "m2": 0}  # the nightly run
    twin = mirror(CALL, "b")
    for calls in ([twin], [twin, CALL]):
        assert _recompute(db, calls, monkeypatch) == {"m1": 7200, "m2": 0}
    assert [(r["call_id"], r.get("notes")) for r in _links(db)] == [("a", "note")]


def test_twin_of_a_link_saved_before_side_keys_is_not_added(monkeypatch):
    for source in ("auto", "manual"):
        db = _db(SHOSH)
        db.table("meeting_call_links").insert({
            "org_id": "org", "meeting_id": "m1", "call_id": "a", "call_time": CALL["start_time"],
            "duration_seconds": 7200, "advisor_id": "shosh", "source": source}).execute()
        assert _recompute(db, [CALL, mirror(CALL, "b")], monkeypatch) == {"m1": 7200}


def test_manual_move_wins(monkeypatch):
    db = _db(SHOSH, DASI)
    _recompute(db, [CALL], monkeypatch)
    db.table("meeting_call_links").update({"meeting_id": "m2", "source": "manual"}).eq("call_id", "a").execute()
    assert _recompute(db, [CALL, mirror(CALL, "b")], monkeypatch) == {"m1": 0, "m2": 7200}


def test_deleting_a_meeting_keeps_its_calls(monkeypatch):
    db = _db(SHOSH, DASI)
    _recompute(db, [CALL], monkeypatch)
    assert sr._rehome_call_links(db, "m1", "s", DAY) == ["m2"]
    assert _links(db)[0]["meeting_id"] == "m2"
    assert sr._rehome_call_links(_db(SHOSH, {**DASI, "status": "cancelled"}), "m1", "s", DAY) == []


# --- overlaps ----------------------------------------------------------------------------------

def test_overlap_rules():
    a = m("a", "10:00", "11:00")
    assert mo.may_be_same(a, m("b", "10:30", "12:00"))
    assert not mo.may_be_same(a, m("b", "11:00", "12:00"))
    assert mo.may_be_same(a, m("b"))
    assert not mo.may_be_same(a, m("b", calls_start_time="15:00", calls_duration_seconds=600))
    assert mo.may_be_same(DASI, m("b", calls_start_time="15:00", calls_duration_seconds=8021))
    # Calls outside the planned hours count too.
    assert mo.may_be_same(DASI, m("b", "09:00", "10:00", calls_start_time="15:00", calls_duration_seconds=8021))
    for status in ("cancelled", "cancelled_reviewed", "postponed"):
        assert not mo.may_be_same(a, m("b", "10:00", "11:00", status=status))
    assert not mo.may_be_same({**a, "stage_scope": "tichon"}, m("b", "10:00", "11:00", stage_scope="chativa"))
    assert not mo.may_be_same(a, m("b", "10:00", "11:00", separate_from_ids=["a"]))


def test_hours_echoed_from_outlook_count_as_no_hours():
    db = _db(m("m1", "09:00", "10:00", ["shosh"]), m("m3", "09:00", "10:00", ["shosh"]))
    db.table("meeting_activity").insert({"meeting_id": "m1", "source": "outlook", "changes": {
        "start_time": {"from": None, "to": "09:00"}, "end_time": {"from": None, "to": "10:00"}}}).execute()
    mine = {**DASI, "school_id": "s", "meeting_date": DAY}
    hits = mo.overlapping_meetings(db, mine, None)
    assert [(h["id"], h["start_time"]) for h in hits] == [("m1", None)]  # m3's 09:00-10:00 is real


def test_when_to_ask():
    base = {"meeting_date": DAY, "status": "scheduled"}
    timed = {**base, "start_time": "10:00", "end_time": "11:00"}
    assert mo.should_check(None, timed) and mo.should_check(base, timed)
    assert not mo.should_check(timed, {**timed, "notes": "x"})
    assert not mo.should_check(None, base)
    assert mo.should_check(base, {**base, "status": "completed"})
    assert mo.should_check(timed, {**timed, "status": "completed"})
    assert not mo.should_check({**base, "status": "completed"}, {**base, "status": "completed"})
    assert not mo.should_check(base, {**timed, "status": "cancelled"})
