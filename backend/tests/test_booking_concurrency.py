"""Public booking links under real concurrency: many schools confirming the same advisor's time
at once must end with exactly one meeting. Threads + an in-memory DB whose statements are atomic
(tests/fake_supabase.py), with latency so the requests really interleave."""
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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

DAY = "2026-12-01"


def token(i, advisor="a", **range_extra):
    rng = {"key": "r1", "service_type": "gefen", "duration_minutes": 60,
           "segments": [{"start_date": DAY, "end_date": DAY}], "advisor_ids": [advisor], **range_extra}
    return {"id": f"t{i}", "org_id": "org", "school_id": f"s{i}", "advisor_id": advisor, "advisor_ids": [advisor],
            "scheduling_window": {"days_of_week": [0, 1, 2, 3, 4], "start_hour": 8, "end_hour": 16},
            "date_ranges": [rng], "booked_ranges": []}


@contextmanager
def _no_calendar_sync(*_a, **_k):
    yield False


@pytest.fixture
def env(monkeypatch):
    db = FakeDb({
        "schools": [{"id": f"s{i}", "name": f"school {i}"} for i in range(20)],
        "meeting_booking_tokens": [{"id": f"t{i}", "booked_ranges": []} for i in range(20)],
    }, latency=0.002)
    monkeypatch.setattr(mbr, "get_admin_client", lambda: db)
    monkeypatch.setattr(booking_lock, "get_admin_client", lambda: db)
    monkeypatch.setattr(mbr, "_find_existing_meeting_any_segment", lambda *a, **k: None)
    monkeypatch.setattr(mbr, "_log_booking_activity", lambda *a, **k: None)
    monkeypatch.setattr(mbr.graph_client, "calendar_sync_lock", _no_calendar_sync)
    monkeypatch.setattr(mbr.graph_client, "get_freebusy", lambda *a, **k: [])
    monkeypatch.setattr(mbr.graph_client, "reconcile_busy_blocks", lambda _db, blocks: list(blocks))
    monkeypatch.setattr(schools_router, "_find_blocking_rule", lambda *a, **k: None)
    monkeypatch.setattr(booking_lock, "LOCK_POLL_INTERVAL", 0.005)
    return db


def race(db, calls):
    """Runs every (token_row, body) at the same instant; returns the status of each."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def run(i, tok, body):
        barrier.wait()
        try:
            mbr._book_range_slot(db, tok, "r1", body)
            results[i] = 200
        except HTTPException as exc:
            results[i] = exc.status_code

    threads = [threading.Thread(target=run, args=(i, tok, body)) for i, (tok, body) in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


SLOT = {"meeting_date": DAY, "start_time": "10:00", "end_time": "11:00"}


def test_ten_schools_same_time_one_meeting(env):
    results = race(env, [(token(i), SLOT) for i in range(10)])
    assert results.count(200) == 1
    assert set(results) <= {200, 409}
    assert len(env.tables["meetings"]) == 1
    assert env.tables.get("booking_slot_locks") == []


def test_overlapping_but_different_times_still_one_meeting(env):
    bodies = [{"meeting_date": DAY, "start_time": f"10:{m:02d}", "end_time": f"11:{m:02d}"} for m in (0, 15, 30, 45)]
    results = race(env, [(token(i), b) for i, b in enumerate(bodies)])
    assert results.count(200) == 1 and len(env.tables["meetings"]) == 1


def test_efficient_calendar_links_race_too(env):
    calls = [(token(i, min_free_window_minutes=120, start_grid_minutes=60), {"meeting_date": DAY, "start_time": "08:00", "end_time": "09:00"})
             for i in range(8)]
    results = race(env, calls)
    assert results.count(200) == 1 and len(env.tables["meetings"]) == 1


def test_other_advisors_are_not_blocked(env):
    results = race(env, [(token(i, advisor=f"adv{i}"), SLOT) for i in range(6)])
    assert results == [200] * 6 and len(env.tables["meetings"]) == 6


def test_same_school_double_click_books_once(env):
    tok = token(0)
    bodies = [{"meeting_date": DAY, "start_time": f"{h:02d}:00", "end_time": f"{h + 1:02d}:00"} for h in (9, 11, 13, 14)]
    results = race(env, [(tok, b) for b in bodies])
    assert results.count(200) == 1 and len(env.tables["meetings"]) == 1


def test_second_layer_alone_still_keeps_one(env, monkeypatch):
    # Even if the lock layer failed open, the post-insert verification leaves exactly one.
    @contextmanager
    def no_lock(_keys, **_k):
        yield
    monkeypatch.setattr(booking_lock, "booking_locks", no_lock)
    results = race(env, [(token(i), SLOT) for i in range(10)])
    assert results.count(200) == 1 and len(env.tables["meetings"]) == 1


# --- the lock itself ---

def test_lock_waits_for_the_holder_and_times_out(env):
    with booking_lock.booking_locks(["adv:a:d"]):
        with pytest.raises(HTTPException) as exc:
            with booking_lock.booking_locks(["adv:a:d"], max_wait=0.05):
                pass
    assert exc.value.status_code == 503
    with booking_lock.booking_locks(["adv:a:d"], max_wait=0.05):  # free again
        pass


def test_stale_lock_is_taken_over(env):
    old = (datetime.now(timezone.utc) - timedelta(seconds=booking_lock.LOCK_STALE_SECONDS + 5)).isoformat()
    env.tables["booking_slot_locks"] = [{"lock_key": "adv:a:d", "locked_by": "dead", "locked_at": old}]
    with booking_lock.booking_locks(["adv:a:d"], max_wait=0.5):
        assert env.tables["booking_slot_locks"][0]["locked_by"] != "dead"
    assert env.tables["booking_slot_locks"] == []


def test_keys_are_taken_in_sorted_order(env, monkeypatch):
    taken = []
    original = booking_lock._try_acquire
    monkeypatch.setattr(booking_lock, "_try_acquire", lambda key, holder: taken.append(key) or original(key, holder))
    with booking_lock.booking_locks(["range:t:r1", "adv:b:d", "adv:a:d"]):
        pass
    assert taken == ["adv:a:d", "adv:b:d", "range:t:r1"]


def test_first_created_meeting_wins(env):
    first = {"id": "m1", "meeting_date": DAY, "start_time": "10:00", "end_time": "11:00", "advisor_ids": ["a"],
             "status": "scheduled", "created_at": "2026-11-11T10:00:00.000001+00:00"}
    second = {**first, "id": "m2", "created_at": "2026-11-11T10:00:00.000002+00:00"}
    env.tables["meetings"] = [dict(first), dict(second)]
    assert booking_lock.keep_or_discard_booking(env, first, ["a"]) is True
    assert booking_lock.keep_or_discard_booking(env, second, ["a"]) is False
    assert [m["id"] for m in env.tables["meetings"]] == ["m1"]


def test_month_links_race_too(env, monkeypatch):
    tokens = {f"tok{i}": {**token(i), "date_ranges": None, "months": ["2026-12"], "booked_months": []} for i in range(6)}
    monkeypatch.setattr(mbr, "_get_valid_token", lambda _db, tok: tokens[tok])
    barrier = threading.Barrier(len(tokens))
    results = []

    def run(tok):
        barrier.wait()
        try:
            mbr.book_meeting_slot(tok, {"month": "2026-12", **SLOT})
            results.append(200)
        except HTTPException as exc:
            results.append(exc.status_code)

    threads = [threading.Thread(target=run, args=(tok,)) for tok in tokens]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(200) == 1 and len(env.tables["meetings"]) == 1
