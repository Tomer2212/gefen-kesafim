"""תיאום ישיר (2026-11-16): every request email failed since 2026-10-24 because the advisor's
Reply-To lookup lost its org argument; a failed send left a live, never-sent link behind and
told the manager only "נסה שוב". Also: a meeting whose type changes after "מחליפה" answers
must not keep filling requests of a type it no longer holds. Offline: Supabase is faked."""
import sys
from pathlib import Path

import httpx
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import booking_lock  # noqa: E402
import booking_logic  # noqa: E402
import booking_requests  # noqa: E402
from email_resend import ResendQuotaExceeded  # noqa: E402
from routers import schools_router  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402


# --- the send itself ---

def test_booking_request_email_resolves_reply_to_within_the_org(monkeypatch):
    db = FakeDb({"profiles": [
        {"id": "adv", "org_id": "org", "email": "adv@example.com"},
        {"id": "other", "org_id": "another-org", "email": "other@example.com"},
    ]})
    sent = []
    monkeypatch.setattr(booking_logic, "get_admin_client", lambda: db)
    monkeypatch.setattr(booking_logic, "send_resend_email",
                        lambda to, subject, html, reply_to=None: sent.append((to, reply_to)))
    booking_logic.send_booking_request_email("org", "adv", "school@example.com", "s", "<p/>")
    booking_logic.send_booking_request_email("org", "other", "school@example.com", "s", "<p/>")
    assert sent == [("school@example.com", "adv@example.com"), ("school@example.com", None)]


# --- what the manager is told when it fails ---

def _http_error(status, body):
    request = httpx.Request("POST", "https://api.resend.com/emails")
    return httpx.HTTPStatusError("x", request=request, response=httpx.Response(status, json=body, request=request))


def test_rejected_address_tells_to_fix_the_card():
    status, msg = schools_router._booking_email_failure(
        _http_error(422, {"name": "validation_error", "message": "Invalid `to` field."}), "bad@example")
    assert status == 400 and "bad@example" in msg and "כרטיס בית הספר" in msg


@pytest.mark.parametrize("message", [
    "Invalid `reply_to` field.",                    # the advisor's address, not the coordinator's
    "The gefenai.co.il domain is not verified. Please add and verify your domain.",
])
def test_other_validation_errors_do_not_blame_the_coordinator(message):
    status, msg = schools_router._booking_email_failure(_http_error(422, {"message": message}), "ok@example.com")
    assert status == 503 and "ok@example.com" not in msg


@pytest.mark.parametrize("email,ok", [
    ("anat@school.org.il", True), ("bblankiet@gmail.com", True),
    ("anat@school", False), ("anat school@x.co", False), ("a@b@c.com", False), ("ענת", False),
])
def test_coordinator_email_format(email, ok):
    assert bool(schools_router._EMAIL_FORMAT_RE.match(email)) is ok


def test_lost_answer_may_have_sent_but_a_failed_connection_did_not():
    request = httpx.Request("POST", "https://api.resend.com/emails")
    assert schools_router._email_maybe_sent(httpx.ReadTimeout("t", request=request))
    assert not schools_router._email_maybe_sent(httpx.ConnectError("c", request=request))
    assert not schools_router._email_maybe_sent(_http_error(422, {"message": "Invalid `to` field."}))


def test_quota_tells_to_send_tomorrow():
    status, msg = schools_router._booking_email_failure(ResendQuotaExceeded("daily_quota_exceeded"), "a@b.c")
    assert status == 503 and "מחר" in msg


@pytest.mark.parametrize("exc", [TypeError("bug"), _http_error(500, {"message": "boom"})])
def test_system_fault_says_it_is_not_the_input(exc):
    status, msg = schools_router._booking_email_failure(exc, "a@b.c")
    assert status == 503 and "לא בגלל הפרטים שהוזנו" in msg


# --- a type change drops the "מחליפה" answers the new type no longer holds ---

RANGE = {"key": "g", "service_type": "gefen", "start_date": "2099-12-01", "end_date": "2099-12-31",
         "segments": [{"start_date": "2099-12-01", "end_date": "2099-12-31"}]}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb({
        "org_tasks": [{"id": "task", "name": "פגישות דצמבר", "status": "active"}],
        "meeting_booking_tokens": [{
            "id": "tok", "org_id": "org", "school_id": "s", "task_id": "task", "expires_at": "2099-12-31T00:00:00+00:00",
            "date_ranges": [RANGE, {**RANGE, "key": "c", "service_type": "current"}], "booked_ranges": ["g", "c"],
        }],
        "meetings": [{"id": "m", "school_id": "s", "status": "scheduled", "meeting_date": "2099-12-28",
                      "meeting_service_type": "current", "booking_token_id": None}],
        "meeting_request_resolutions": [
            {"id": "r1", "meeting_id": "m", "token_id": "tok", "range_key": "g", "service_type": "gefen", "decision": "replaces"},
            {"id": "r2", "meeting_id": "m", "token_id": "tok", "range_key": "c", "service_type": "current", "decision": "replaces"},
        ],
    })
    monkeypatch.setattr(booking_requests, "get_admin_client", lambda: fake)
    monkeypatch.setattr(booking_lock, "get_admin_client", lambda: fake)
    monkeypatch.setattr(booking_requests.meeting_activity, "log_meeting_activity", lambda _db, **kw: None)
    return fake


def test_combined_meeting_turned_current_reopens_the_gefen_request(db):
    assert booking_requests.drop_replaces_after_type_change(db, "org", "m", "current") == 1
    assert [r["id"] for r in db.tables["meeting_request_resolutions"]] == ["r2"]
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == ["c"]


def test_combined_type_keeps_both_answers(db):
    assert booking_requests.drop_replaces_after_type_change(db, "org", "m", "gefen_current") == 0
    assert len(db.tables["meeting_request_resolutions"]) == 2
