""""יומן יעיל" on the public booking link — what freebusy offers and what booking accepts.
Fully offline: the token, Outlook and Supabase are faked."""
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import booking_lock  # noqa: E402
from routers import meeting_booking_router as mbr  # noqa: E402
from routers import schools_router  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402

DAY = "2026-12-01"  # a Tuesday


def token(**range_extra):
    rng = {
        "key": "r1", "service_type": "gefen", "duration_minutes": 60,
        "segments": [{"start_date": DAY, "end_date": DAY}], "advisor_ids": ["a"],
        "allow_time_range_search": True, **range_extra,
    }
    return {
        "id": "t", "org_id": "org", "school_id": "s", "advisor_id": "a", "advisor_ids": ["a"],
        "scheduling_window": {"days_of_week": [0, 1, 2, 3, 4], "start_hour": 8, "end_hour": 16},
        "date_ranges": [rng], "booked_ranges": [],
    }


@contextmanager
def _no_calendar_sync(*_a, **_k):
    yield False


@pytest.fixture
def db():
    return FakeDb({"schools": [{"id": "s", "name": "בית ספר"}], "meeting_booking_tokens": [{"id": "t", "booked_ranges": []}]})


@pytest.fixture
def booking(monkeypatch, db):
    def setup(events_by_advisor, **range_extra):
        tok = token(**range_extra)
        monkeypatch.setattr(mbr, "get_admin_client", lambda: db)
        monkeypatch.setattr(booking_lock, "get_admin_client", lambda: db)
        monkeypatch.setattr(mbr, "_get_valid_token", lambda _db, t: tok)
        monkeypatch.setattr(mbr, "_find_existing_meeting_any_segment", lambda *a, **k: None)
        monkeypatch.setattr(mbr, "_filter_blocked_dates", lambda _db, org, school, dates: dates)
        monkeypatch.setattr(mbr, "_log_booking_activity", lambda *a, **k: None)
        monkeypatch.setattr(mbr.graph_client, "calendar_sync_lock", _no_calendar_sync)
        monkeypatch.setattr(schools_router, "_find_blocking_rule", lambda *a, **k: None)
        monkeypatch.setattr(mbr.graph_client, "reconcile_busy_blocks", lambda _db, blocks: list(blocks))
        monkeypatch.setattr(mbr.graph_client, "get_freebusy", lambda _db, org, aid, s, e: [
            {"start": f"{DAY}T{st}:00", "end": f"{DAY}T{en}:00"} for st, en in events_by_advisor.get(aid, [])
        ])
        return tok
    return setup


def test_regular_offer_follows_the_rule(booking):
    booking({"a": [("12:00", "13:00")]}, min_free_window_minutes=120, start_grid_minutes=60)
    res = mbr.get_booking_freebusy("tok", range_key="r1")
    assert res["days"] == [{"date": DAY, "slots": [{"start_time": "13:00", "end_time": "14:00"}]}]
    assert res["requested_days"] is None


def test_requested_hours_get_the_closest_allowed_time(booking):
    booking({"a": [("10:00", "11:00"), ("13:00", "15:00")]}, duration_minutes=120,
            min_free_window_minutes=120, start_grid_minutes=60)
    res = mbr.get_booking_freebusy("tok", range_key="r1", time_from="12:00", time_to="14:00")
    assert res["days"][0]["slots"] == [{"start_time": "08:00", "end_time": "10:00"}]
    assert res["requested_days"] == [{"date": DAY, "slots": [{"start_time": "11:00", "end_time": "13:00", "near": True}]}]


def test_requested_hours_ignored_when_the_org_did_not_allow_them(booking):
    booking({}, min_free_window_minutes=120, start_grid_minutes=60, allow_time_range_search=False)
    res = mbr.get_booking_freebusy("tok", range_key="r1", time_from="12:00", time_to="14:00")
    assert res["requested_days"] is None


def test_old_links_keep_the_original_behavior(booking):
    booking({"a": [("12:00", "13:00")]})
    res = mbr.get_booking_freebusy("tok", range_key="r1")
    assert res == {"days": [{"date": DAY, "slots": [{"start_time": "08:00", "end_time": "09:00"}]}], "ok": True}


def test_booking_a_time_the_rule_forbids_is_rejected(booking, db):
    booking({"a": [("12:00", "13:00")]}, min_free_window_minutes=120, start_grid_minutes=60)
    with pytest.raises(HTTPException) as exc:
        mbr._book_range_slot(db, token(min_free_window_minutes=120, start_grid_minutes=60), "r1",
                             {"meeting_date": DAY, "start_time": "09:00", "end_time": "10:00"})
    assert exc.value.status_code == 409


@pytest.mark.parametrize("body", [
    {"meeting_date": DAY, "start_time": "13:00", "end_time": "14:30"},          # wrong length
    {"meeting_date": "2026-12-02", "start_time": "13:00", "end_time": "14:00"},  # outside the range's dates
    {"meeting_date": "garbage", "start_time": "13:00", "end_time": "14:00"},
])
def test_booking_outside_what_was_offered_is_rejected(booking, db, body):
    tok = booking({"a": [("12:00", "13:00")]}, min_free_window_minutes=120, start_grid_minutes=60)
    with pytest.raises(HTTPException) as exc:
        mbr._book_range_slot(db, tok, "r1", body)
    assert exc.value.status_code == 409


def test_booking_an_allowed_time_is_saved(booking, db):
    tok = booking({"a": [("12:00", "13:00")]}, min_free_window_minutes=120, start_grid_minutes=60)
    assert mbr._book_range_slot(db, tok, "r1", {"meeting_date": DAY, "start_time": "13:00", "end_time": "14:00"})["ok"]
    assert [(m["start_time"], m["end_time"]) for m in db.tables["meetings"]] == [("13:00", "14:00")]
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == ["r1"]
    assert db.tables["booking_slot_locks"] == []  # released


# --- days and hours already gone ---

def _clock(monkeypatch, iso):
    from datetime import datetime
    monkeypatch.setattr(mbr, "_now_il", lambda: datetime.fromisoformat(iso).replace(tzinfo=mbr._IL_TZ))


def test_past_days_are_never_offered(booking, monkeypatch):
    booking({}, min_free_window_minutes=0, start_grid_minutes=60)
    _clock(monkeypatch, "2026-12-02T07:00:00")
    assert mbr.get_booking_freebusy("tok", range_key="r1")["days"] == []
    booking({})  # an older link too
    assert mbr.get_booking_freebusy("tok", range_key="r1")["days"] == []


def test_today_starts_from_now(booking, monkeypatch):
    booking({}, min_free_window_minutes=120, start_grid_minutes=60)
    _clock(monkeypatch, f"{DAY}T10:20:00")
    # "Now" rounded up to the round-hour grid (11:00) acts like the start of the working day.
    assert mbr.get_booking_freebusy("tok", range_key="r1")["days"][0]["slots"] == [{"start_time": "11:00", "end_time": "12:00"}]
    booking({})
    assert mbr.get_booking_freebusy("tok", range_key="r1")["days"][0]["slots"] == [{"start_time": "10:30", "end_time": "11:30"}]


def test_booking_a_time_already_gone_is_rejected(booking, monkeypatch, db):
    tok = booking({})
    _clock(monkeypatch, f"{DAY}T12:00:00")
    with pytest.raises(HTTPException) as exc:
        mbr._book_range_slot(db, tok, "r1", {"meeting_date": DAY, "start_time": "09:00", "end_time": "10:00"})
    assert exc.value.status_code == 409


@pytest.mark.parametrize("body", [
    {"meeting_date": DAY, "start_time": "13:00", "end_time": "15:00"},          # not the request's length
    {"meeting_date": "2026-12-05", "start_time": "13:00", "end_time": "14:00"},  # a Saturday, outside the range
    {"meeting_date": DAY, "start_time": "22:00", "end_time": "23:00"},          # outside working hours
])
def test_older_links_also_reject_times_never_offered(booking, db, body):
    tok = booking({})
    with pytest.raises(HTTPException) as exc:
        mbr._book_range_slot(db, tok, "r1", body)
    assert exc.value.status_code == 409
    assert "meetings" not in db.tables


def test_older_links_accept_a_narrowed_off_grid_time(booking, db):
    # "אפשרויות נוספות" on an older link may start at e.g. 14:15 — still a valid booking.
    tok = booking({})
    assert mbr._book_range_slot(db, tok, "r1", {"meeting_date": DAY, "start_time": "14:15", "end_time": "15:15"})["ok"]
