"""Regression test: every meeting-related email (day-before reminder, file-upload request)
must go out via Resend — never via the support Gmail mailbox over SMTP — with Reply-To set
to the meeting's advisor.

Fully offline: the Supabase client, Resend and SMTP are all faked, so no real email is sent
and no real school/meeting is touched.
"""
import smtplib
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import task_logic  # noqa: E402
from routers import schools_router  # noqa: E402

SCHOOL_ID = "school-1"
MEETING_ID = "meeting-1"
ADVISOR_ID = "advisor-1"
ADVISOR_EMAIL = "advisor@example.com"
PRINCIPAL_EMAIL = "principal@example.com"
SECRETARY_EMAIL = "secretary@example.com"


class _Result:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class _Query:
    """Accepts any PostgREST builder chain and returns canned rows per table."""

    def __init__(self, db, table):
        self.db, self.table = db, table
        self.is_insert = False

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def insert(self, row):
        self.is_insert = True
        self.db.inserted.append((self.table, row))
        return self

    def execute(self):
        if self.is_insert:
            return _Result([])
        return _Result(self.db.rows.get(self.table, []))


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.inserted = []

    def table(self, name):
        return _Query(self, name)


class _FakeRequest:
    headers = {"X-Cron-Secret": "test-secret"}


@pytest.fixture
def harness(monkeypatch):
    from datetime import date

    due = date(2026, 11, 1)
    db = _FakeDB({
        "meetings": [{
            "id": MEETING_ID, "school_id": SCHOOL_ID, "meeting_date": due.isoformat(),
            "start_time": "10:00", "end_time": "11:00", "status": "scheduled",
            "participants": [{"name": "מנהל", "email": PRINCIPAL_EMAIL, "key": "principal"}],
            "advisor_ids": [ADVISOR_ID], "meeting_service_type": "gefen", "meeting_type": None,
            "reminder_enabled": True, "academic_year": None, "requested_upload_years": None,
        }],
        "schools": [{"id": SCHOOL_ID, "name": "לדוגמא", "org_id": "org-1"}],
        "organizations": [{"id": "org-1", "secretary_upload_request_enabled": True}],
        "profiles": [{"id": ADVISOR_ID, "full_name": "יועץ", "email": ADVISOR_EMAIL}],
        "meeting_reminders": [],
    })

    sent = []

    def fake_resend(to_email, subject, html, reply_to=None, attachments=None):
        sent.append({"to": to_email, "subject": subject, "reply_to": reply_to})

    def no_smtp(*_a, **_k):
        raise AssertionError("meeting email must not be sent via SMTP (support mailbox)")

    monkeypatch.setattr(schools_router, "CRON_SECRET", "test-secret")
    monkeypatch.setattr(schools_router, "get_admin_client", lambda: db)
    monkeypatch.setattr(schools_router, "send_resend_email", fake_resend)
    monkeypatch.setattr(smtplib, "SMTP", no_smtp)
    monkeypatch.setattr(schools_router, "_due_meeting_dates", lambda _today: [due])
    monkeypatch.setattr(schools_router, "_gefen_files_slots_for_meeting", lambda _s, _scope: ["main"])
    monkeypatch.setattr(
        schools_router, "_resolve_gefen_files_responsible_for_slot",
        lambda _s, _slot: {"name": "מזכירה", "email": SECRETARY_EMAIL},
    )
    monkeypatch.setattr(schools_router, "resolve_inherited_year_admin", lambda *_a: {SCHOOL_ID: {"client_status": "active"}})
    monkeypatch.setattr(schools_router, "get_or_create_upload_token", lambda *_a: "tok")
    monkeypatch.setattr(schools_router, "resolve_requested_upload_years", lambda _m: ["תשפ\"ז"])
    monkeypatch.setattr(schools_router, "build_upload_checklist", lambda *_a: {"items": [], "no_baseline_this_year": False})
    monkeypatch.setattr(task_logic, "fetch_opted_out_emails", lambda *_a: set())
    return db, sent


def test_reminder_and_upload_request_both_go_via_resend_with_advisor_reply_to(harness):
    db, sent = harness

    result = schools_router.send_due_reminders(_FakeRequest())

    assert result["sent"] == 2 and result["failed"] == 0
    by_recipient = {s["to"]: s for s in sent}
    assert set(by_recipient) == {PRINCIPAL_EMAIL, SECRETARY_EMAIL}
    assert by_recipient[PRINCIPAL_EMAIL]["subject"].startswith("תזכורת: פגישה")
    assert by_recipient[SECRETARY_EMAIL]["subject"].startswith("בקשת קבצים לפגישה")
    assert all(s["reply_to"] == ADVISOR_EMAIL for s in sent)
    logged = [row for table, row in db.inserted if table == "meeting_reminders"]
    assert {r["status"] for r in logged} == {"sent"}


def test_gmail_reminder_helper_is_gone():
    assert not hasattr(schools_router, "_send_reminder_email")
