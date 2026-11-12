"""Large task sends (2026-11-12 incident): a 472-school send ran inside the create request for ~2
minutes, the browser timed out at 45 s and the manager created the task twice; Resend's free
quota then failed every remaining message. Covers: quota vs rate-limit 429s, the background
drain stopping at quota (rows stay pending), "שלח שוב לנכשלים" never re-emailing a reached
recipient, and create_task's client_request_id. Fully offline."""
import sys
from pathlib import Path

import httpx
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import email_resend  # noqa: E402
from fake_supabase import FakeDb  # noqa: E402
from routers import tasks_router  # noqa: E402


# --- Resend client ---

class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=httpx.Request("POST", "https://x"), response=None)


@pytest.fixture
def resend(monkeypatch):
    monkeypatch.setattr(email_resend, "RESEND_API_KEY", "k")
    monkeypatch.setattr(email_resend.time, "sleep", lambda _s: None)
    calls = []

    def install(*responses):
        it = iter(responses)
        monkeypatch.setattr(email_resend.httpx, "post", lambda *a, **k: calls.append(1) or next(it))
    return install, calls


def test_quota_429_raises_quota_error_without_retrying(resend):
    install, calls = resend
    install(_Resp(429, {"name": "daily_quota_exceeded"}))
    with pytest.raises(email_resend.ResendQuotaExceeded):
        email_resend.send_resend_email("a@x.com", "s", "h")
    assert len(calls) == 1


def test_rate_limit_429_is_retried(resend):
    install, calls = resend
    install(_Resp(429, {"name": "rate_limit_exceeded"}), _Resp(200))
    email_resend.send_resend_email("a@x.com", "s", "h")
    assert len(calls) == 2


# --- background drain ---

def _msg(i, status="pending", school="s1", email=None, created=None, channel="email_resend"):
    return {"id": f"m{i}", "task_id": "t1", "school_id": school, "channel": channel, "status": status,
            "recipient_email": email or f"r{i}@x.com", "subject": "s", "body": "b",
            "scheduled_at": "2000-01-01T00:00:00+00:00", "created_at": created or f"2026-11-12T10:00:0{i}"}


@pytest.fixture
def drain_env(monkeypatch):
    def setup(messages, send):
        db = FakeDb({"org_tasks": [{"id": "t1", "org_id": "o1", "created_by": "u1"}], "org_task_messages": messages})
        monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(tasks_router, "BACKGROUND_SEND_MIN_INTERVAL_SECONDS", 0)
        monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *_a: set())
        monkeypatch.setattr(tasks_router, "send_resend_email", send)
        return db
    return setup


def test_drain_sends_everything_and_skips_outlook_rows(drain_env):
    sent = []
    db = drain_env([_msg(1), _msg(2), _msg(3, channel="email_outlook")], lambda to, *_a, **_k: sent.append(to))
    tasks_router._drain_task_messages("t1")
    status = {m["id"]: m["status"] for m in db.tables["org_task_messages"]}
    assert status == {"m1": "sent", "m2": "sent", "m3": "pending"}
    assert sent == ["r1@x.com", "r2@x.com"]


def test_drain_stops_at_quota_and_keeps_the_rest_pending(drain_env):
    def send(to, *_a, **_k):
        if to != "r1@x.com":
            raise email_resend.ResendQuotaExceeded("Resend daily_quota_exceeded")
    db = drain_env([_msg(1), _msg(2), _msg(3)], send)
    tasks_router._drain_task_messages("t1")
    rows = {m["id"]: m for m in db.tables["org_task_messages"]}
    assert rows["m1"]["status"] == "sent"
    assert rows["m2"]["status"] == "pending" and rows["m2"]["error"] == tasks_router.QUOTA_PENDING_NOTE
    assert rows["m3"]["status"] == "pending" and not rows["m3"].get("error")  # never attempted


# --- "שלח שוב לנכשלים" ---

def test_retry_failed_never_re_emails_a_reached_recipient(monkeypatch):
    messages = [
        _msg(1, "failed", school="a", email="x@a.com", created="2026-11-12T10:00:01"),
        _msg(2, "sent", school="a", email="x@a.com", created="2026-11-12T10:00:02"),   # reached later
        _msg(3, "failed", school="b", email="y@b.com", created="2026-11-12T10:00:03"),
        _msg(4, "failed", school="b", email="y@b.com", created="2026-11-12T10:00:04"),  # the newest one
        _msg(5, "sent", school="b", email="z@b.com", created="2026-11-12T10:00:05"),    # other recipient
        _msg(6, "failed", school="c", email="w@c.com", created="2026-11-12T10:00:06"),  # school done
    ]
    db = FakeDb({"org_task_messages": messages})
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
    monkeypatch.setattr(tasks_router, "_get_task_or_404", lambda *_a: {"id": "t1", "track_success": True})
    monkeypatch.setattr(tasks_router.task_logic, "compute_task_progress", lambda *_a: {
        "schools": [{"school_id": "a", "done": False}, {"school_id": "b", "done": False}, {"school_id": "c", "done": True}]})
    started = []
    monkeypatch.setattr(tasks_router, "_send_in_background", lambda *a, **k: started.append(a))
    out = tasks_router.retry_failed_messages("t1", {"role": "owner", "org_id": "o1"})
    status = {m["id"]: m["status"] for m in db.tables["org_task_messages"]}
    assert out == {"retried": 1}
    assert status == {"m1": "failed", "m2": "sent", "m3": "failed", "m4": "pending", "m5": "sent", "m6": "failed"}
    assert len(started) == 1


# --- create_task idempotency ---

def test_repeated_create_returns_the_existing_task(monkeypatch):
    rid = "2b1f6b0e-6a8e-4a4f-9a52-1f4d1b7d1a11"
    db = FakeDb({"org_tasks": [{"id": "t1", "org_id": "o1", "name": "x", "client_request_id": rid}]})
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
    body = tasks_router.TaskCreateIn(
        name="x", criteria={"groups": []}, message_config={"recipient_role": "principal", "channel": "email_resend"},
        manual_school_ids=["s1"], client_request_id=rid,
    )
    out = tasks_router.create_task(body, {"role": "owner", "org_id": "o1", "id": "u1"})
    assert out["id"] == "t1"
    assert len(db.tables["org_tasks"]) == 1
    # Another org's task with the same id is never returned.
    out_other = tasks_router._task_by_client_request_id("o2", rid)
    assert out_other is None


# --- no second bulk send while one is still going ---

def test_bulk_send_is_blocked_while_a_send_is_in_progress(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from fastapi import HTTPException
    now = datetime.now(timezone.utc)
    recent = {**_msg(1), "scheduled_at": (now - timedelta(seconds=5)).isoformat(), "created_at": now.isoformat()}
    db = FakeDb({"org_task_messages": [recent]})
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
    monkeypatch.setattr(tasks_router, "_get_task_or_404", lambda *_a: {"id": "t1", "matched_school_ids": ["s1"], "message_config": {}})
    with pytest.raises(HTTPException) as exc:
        tasks_router.send_task_bulk("t1", tasks_router.SendIn(only_school_ids=["s1"]), {"role": "owner", "org_id": "o1"})
    assert exc.value.status_code == 409 and exc.value.detail["send_in_progress"]

    # Held for a future time, or pending since long ago (e.g. quota) — not "in progress".
    row = db.tables["org_task_messages"][0]
    row["scheduled_at"] = (now + timedelta(days=1)).isoformat()
    assert not tasks_router._send_in_running(db, "t1")
    row["scheduled_at"], row["created_at"] = "2000-01-01T00:00:00+00:00", "2000-01-01T00:00:00+00:00"
    assert not tasks_router._send_in_running(db, "t1")
