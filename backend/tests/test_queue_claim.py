"""Email/message queue rows are claimed (pending → sending) before sending, so two overlapping
cron runs never both send one. Offline: tests/fake_supabase.py stands in for Supabase."""
import sys
import threading
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers.schools_router import claim_queue_row  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402


def test_a_row_is_claimed_once():
    db = FakeDb({"org_task_messages": [{"id": "m1", "status": "pending"}]})
    assert claim_queue_row(db, "org_task_messages", "m1", {"claimed_at": "2026-11-11T10:00:00+00:00"})
    assert not claim_queue_row(db, "org_task_messages", "m1")
    assert db.tables["org_task_messages"][0] == {"id": "m1", "status": "sending", "claimed_at": "2026-11-11T10:00:00+00:00"}


def test_concurrent_runs_claim_each_row_once():
    db = FakeDb({"meeting_booking_email_queue": [{"id": f"q{i}", "status": "pending"} for i in range(20)]}, latency=0.001)
    claims = []

    def run():
        for i in range(20):
            if claim_queue_row(db, "meeting_booking_email_queue", f"q{i}"):
                claims.append(i)

    threads = [threading.Thread(target=run) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claims) == list(range(20))


def test_a_row_that_is_not_pending_is_never_claimed():
    db = FakeDb({"org_task_messages": [{"id": "m1", "status": "sent"}]})
    assert not claim_queue_row(db, "org_task_messages", "m1")
    assert db.tables["org_task_messages"][0]["status"] == "sent"
