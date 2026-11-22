"""POST /calls/calls/{call_id}/link-school from a non-manager (personal area "שייך שיחה").

An advisor may link only a call of their own (advisor_id, or an office line they handle) —
verified against the provider's calls of that day. The provider is faked here
(calls_router._pull_org_calls), and the same-day meeting recompute is disabled, so these
tests never depend on a calls integration and never touch real meetings. Every write targets
Org B (sandbox), per this suite's safety convention.
"""
import pytest

from conftest import ORG_A_SCHOOL_ID, ORG_B_ID, ORG_B_SCHOOL_ID, _user
from routers import calls_router

# Not a real profile — get_current_user is overridden, and link-school never reads the profile.
ORG_B_ADVISOR_ID = "00000000-0000-4000-8000-00000000ad01"
OTHER_ADVISOR_ID = "00000000-0000-4000-8000-00000000ad02"
CALL_TIME = "2020-01-05T08:00:00Z"  # a day with no meetings, far in the past


def _fake_day(calls):
    def _pull(org_id, date_from, date_to):
        assert org_id == ORG_B_ID
        return {"calls": [dict(c) for c in calls], "provider": "fake"}
    return _pull


@pytest.fixture
def advisor_client(make_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_after_manual_school_attribution", lambda *a, **k: None)
    return make_client(_user(ORG_B_ADVISOR_ID, ORG_B_ID, "advisor"))


def _link(client, call_id, school_id=ORG_B_SCHOOL_ID, call_time=CALL_TIME):
    body = {"school_id": school_id}
    if call_time:
        body["call_time"] = call_time
    return client.post(f"/calls/calls/{call_id}/link-school", json=body)


def test_advisor_link_requires_call_time(advisor_client):
    resp = _link(advisor_client, "idor-test-advisor-call", call_time=None)
    assert resp.status_code == 400, resp.text


def test_advisor_link_cross_org_school_rejected(advisor_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_pull_org_calls", _fake_day([
        {"call_id": "idor-test-advisor-call", "advisor_id": ORG_B_ADVISOR_ID, "handler_ids": []},
    ]))
    resp = _link(advisor_client, "idor-test-advisor-call", school_id=ORG_A_SCHOOL_ID)
    assert resp.status_code in (403, 404), resp.text


def test_advisor_link_someone_elses_call_rejected(advisor_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_pull_org_calls", _fake_day([
        {"call_id": "idor-test-advisor-call", "advisor_id": OTHER_ADVISOR_ID, "handler_ids": []},
    ]))
    resp = _link(advisor_client, "idor-test-advisor-call")
    assert resp.status_code == 404, resp.text


def test_advisor_link_unknown_call_rejected(advisor_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_pull_org_calls", _fake_day([]))
    resp = _link(advisor_client, "idor-test-advisor-call")
    assert resp.status_code == 404, resp.text


def test_advisor_link_own_call_works(advisor_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_pull_org_calls", _fake_day([
        {"call_id": "idor-test-advisor-call", "advisor_id": ORG_B_ADVISOR_ID, "handler_ids": []},
    ]))
    resp = _link(advisor_client, "idor-test-advisor-call")
    assert resp.status_code == 200, resp.text


def test_advisor_link_office_line_call_works(advisor_client, monkeypatch):
    monkeypatch.setattr(calls_router, "_pull_org_calls", _fake_day([
        {"call_id": "idor-test-advisor-office-call", "advisor_id": None, "handler_ids": [ORG_B_ADVISOR_ID]},
    ]))
    resp = _link(advisor_client, "idor-test-advisor-office-call")
    assert resp.status_code == 200, resp.text


def test_is_own_call():
    assert calls_router._is_own_call({"advisor_id": "u1"}, "u1")
    assert calls_router._is_own_call({"advisor_id": None, "handler_ids": ["u1"]}, "u1")
    assert not calls_router._is_own_call({"advisor_id": "u2", "handler_ids": ["u3"]}, "u1")
    assert not calls_router._is_own_call({}, "u1")
