"""Meeting-messages popover: open tracking, stored email content, and who "בקש מחדש" may reach.

Fully offline: the Supabase client and Resend are faked, so no real email is sent.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import email_tracking  # noqa: E402
from meeting_upload_logic import file_type_label  # noqa: E402
from routers import meeting_upload_router as router  # noqa: E402
from routers.schools_router import _participant_role_label  # noqa: E402

MEETING_ID = "meeting-1"
RESPONSIBLE_EMAIL = "responsible@example.com"
OTHER_RESPONSIBLE_EMAIL = "other@example.com"
USER = {"id": "user-1", "email": "advisor@example.com", "role": "owner", "org_id": "org-1"}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Accepts any PostgREST builder chain and returns canned rows per table."""

    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.op = "select"

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def insert(self, row):
        self.op = "insert"
        self.db.inserted.append((self.table_name, row))
        return self

    def update(self, row):
        self.op = "update"
        self.db.updated.append((self.table_name, row))
        return self

    def execute(self):
        return _Result([] if self.op != "select" else self.db.rows.get(self.table_name, []))


class _FakeDB:
    def __init__(self, rows):
        self.rows, self.inserted, self.updated = rows, [], []

    def table(self, name):
        return _Query(self, name)


def _sent_row(**overrides):
    return {"id": "r1", "status": "sent", "opened_at": None, "sent_at": "2020-01-01T10:00:00+00:00", **overrides}


# ---------------------------------------------------------------------------
# Open tracking
# ---------------------------------------------------------------------------

def test_pixel_added_only_to_the_sent_copy(monkeypatch):
    monkeypatch.setenv("BACKEND_PUBLIC_URL", " https://api.example.com/\n")
    original = "<html><body>שלום</body></html>"
    tracked, token = email_tracking.add_open_pixel(original)
    assert token and f"https://api.example.com/public/email-open/{token}.gif" in tracked
    assert tracked.index("email-open") < tracked.index("</body>")


def test_no_backend_url_means_not_tracked(monkeypatch):
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    assert email_tracking.add_open_pixel("<body></body>") == ("<body></body>", None)


def test_first_open_is_recorded():
    db = _FakeDB({"meeting_reminders": [_sent_row()]})
    email_tracking.record_email_open(db, "tok")
    assert [t for t, _ in db.updated] == ["meeting_reminders"]


@pytest.mark.parametrize("row", [
    _sent_row(opened_at="2020-01-02T10:00:00+00:00"),
    _sent_row(status="failed"),
])
def test_opens_that_do_not_count(row):
    db = _FakeDB({"meeting_reminders": [row]})
    email_tracking.record_email_open(db, "tok")
    assert db.updated == []


def test_mail_scanner_hit_right_after_sending_does_not_count():
    # Built here, not in parametrize: that runs at collection, long before the test in a full run.
    db = _FakeDB({"meeting_reminders": [_sent_row(sent_at=datetime.now(timezone.utc).isoformat())]})
    email_tracking.record_email_open(db, "tok")
    assert db.updated == []


def test_unknown_token_changes_nothing():
    db = _FakeDB({})
    email_tracking.record_email_open(db, "nope")
    assert db.updated == []


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

def test_file_type_labels():
    assert file_type_label("gefen", None, ["גפן"]) == "דיווח ביצוע גפן"
    assert file_type_label("gefen", "tikkon", ["גפן"]) == "דיווח ביצוע גפן - חטיבה עליונה"
    assert file_type_label("gefen", None, None) == "דיווח ביצוע"
    assert file_type_label("kesafim2000", None, None) == "קובץ פירוט הוצאות מכספים2000"
    assert file_type_label("tikhnun", None, None) == "תכנון"


@pytest.mark.parametrize("participant,expected", [
    ({"key": "secretary", "label": "מנהלת"}, "מנהלת"),
    ({"key": "finance"}, "אחראי/ת כספים"),
    ({"key": "extra_0"}, "סגנית"),
    ({"key": "extra_9"}, "איש קשר נוסף"),
    ({"key": "gefen_files_responsible"}, "אחראי/ת קבצי גפן"),
    ({"key": "unknown"}, None),
])
def test_participant_role_label(participant, expected):
    assert _participant_role_label(participant, {"extra_contacts": [{"role": "סגנית"}]}) == expected


# ---------------------------------------------------------------------------
# "בקש מחדש"
# ---------------------------------------------------------------------------

@pytest.fixture
def harness(monkeypatch):
    future = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    meeting = {
        "id": MEETING_ID, "school_id": "school-1", "meeting_date": future, "advisor_ids": [],
        "participants": [{"key": "secretary", "name": "מזכירה", "email": "secretary@example.com"}],
    }
    db = _FakeDB({
        "schools": [{"id": "school-1", "name": "לדוגמא"}],
        "meeting_upload_files": [],
        "meeting_reminders": [
            {"recipient_email": RESPONSIBLE_EMAIL, "recipient_name": "אחראית", "recipient_role": "מנהלנ/ית", "status": "sent"},
            {"recipient_email": OTHER_RESPONSIBLE_EMAIL, "recipient_name": "אחר", "recipient_role": None, "status": "failed"},
        ],
    })
    sent = []
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "https://api.example.com")
    monkeypatch.setattr(router, "get_admin_client", lambda: db)
    monkeypatch.setattr(router, "_require_meeting_access", lambda *_a: meeting)
    monkeypatch.setattr(router, "resolve_requested_upload_years", lambda _m: ['תשפ"ז'])
    monkeypatch.setattr(router, "build_upload_checklist", lambda *_a: {
        "items": [{"label": "תכנון", "kind": "tikhnun"}], "no_baseline_this_year": False, "divisions": [],
    })
    monkeypatch.setattr(router, "get_or_create_upload_token", lambda *_a, **_k: "tok")
    monkeypatch.setattr(router, "_opted_out_recipients", lambda *_a: set())
    monkeypatch.setattr(router, "send_resend_email", lambda to, subject, html, reply_to=None: sent.append((to, html)))
    return db, sent, meeting, monkeypatch


def test_request_goes_only_to_the_chosen_recipient_and_stores_clean_copy(harness):
    db, sent, _meeting, _mp = harness
    body = router.RequestMissingFilesIn(recipient_email=RESPONSIBLE_EMAIL.upper())

    result = router.request_missing_files(MEETING_ID, USER, body)

    assert result["sent"] == 1
    assert [to for to, _ in sent] == [RESPONSIBLE_EMAIL]
    assert "email-open" in sent[0][1]
    logged = next(row for table, row in db.inserted if table == "meeting_upload_followups")
    assert logged["message_type"] == "upload_followup"
    assert logged["recipient_name"] == "אחראית" and logged["recipient_role"] == "מנהלנ/ית"
    assert logged["open_token"] and "email-open" not in logged["body_html"]


def test_without_recipient_every_request_recipient_gets_it(harness):
    _db, sent, _meeting, _mp = harness
    router.request_missing_files(MEETING_ID, USER)
    assert {to for to, _ in sent} == {RESPONSIBLE_EMAIL, OTHER_RESPONSIBLE_EMAIL}


def test_address_not_on_the_request_is_rejected(harness):
    _db, sent, _meeting, _mp = harness
    with pytest.raises(HTTPException) as exc:
        router.request_missing_files(MEETING_ID, USER, router.RequestMissingFilesIn(recipient_email="attacker@example.com"))
    assert exc.value.status_code == 400 and sent == []


def test_opted_out_recipient_is_not_emailed(harness):
    _db, sent, _meeting, mp = harness
    mp.setattr(router, "_opted_out_recipients", lambda *_a: {RESPONSIBLE_EMAIL})
    with pytest.raises(HTTPException) as exc:
        router.request_missing_files(MEETING_ID, USER, router.RequestMissingFilesIn(recipient_email=RESPONSIBLE_EMAIL))
    assert exc.value.status_code == 400 and sent == []


def test_expired_link_sends_nothing(harness):
    _db, sent, meeting, _mp = harness
    meeting["meeting_date"] = "2020-01-01"
    with pytest.raises(HTTPException) as exc:
        router.request_missing_files(MEETING_ID, USER)
    assert exc.value.status_code == 400 and sent == []


def test_legacy_recipients_fall_back_to_files_responsible_then_participants(harness, monkeypatch):
    db, _sent, meeting, _mp = harness
    db.rows["meeting_reminders"] = []
    monkeypatch.setattr(router, "_gefen_files_slots_for_meeting", lambda _s, _scope: ["default"])

    monkeypatch.setattr(router, "_resolve_gefen_files_responsible_for_slot", lambda _s, _slot: {
        "name": "אחראית", "email": RESPONSIBLE_EMAIL, "role_label": "מנהלנ/ית",
    })
    assert set(router._upload_request_recipients(db, meeting, {})) == {RESPONSIBLE_EMAIL}

    monkeypatch.setattr(router, "_resolve_gefen_files_responsible_for_slot", lambda _s, _slot: None)
    assert set(router._upload_request_recipients(db, meeting, {})) == {"secretary@example.com"}
