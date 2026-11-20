"""Office phones (ניהול → הגדרות, org_phones) in the calls pipeline:
- a call whose other side is an office phone / a colleague is named, and never raises the
  "unknown number" prompt (Track B);
- a calls line assigned to an office phone is labelled "{label} – {org name}" and its
  prompts go to the phone's handlers.
The integration part writes only to Org B (the developer sandbox, see tests/security/conftest.py)
and removes what it created."""
import uuid

import pytest

from routers import calls_router as cr

ORG_B_ID = "b716cf8c-7b35-44f8-98ff-e0a1cc584d72"
ORG_B_MANAGER_ID = "c2de1a78-c807-41c2-90d3-0f6f191f7171"


def _call(**kw):
    base = {
        "advisor_id": "u1", "school_id": None, "pending_school_resolution": False,
        "linked_school_ids": [], "internal_counterpart": False, "direction": "outgoing",
        "duration_seconds": 60, "org_phone_id": None, "handler_ids": [],
    }
    return {**base, **kw}


def test_unknown_prompt_for_plain_unknown_number():
    assert cr._needs_unknown_prompt(_call())


def test_no_unknown_prompt_for_own_numbers():
    # office phone or colleague on the other side
    assert not cr._needs_unknown_prompt(_call(internal_counterpart=True))


def test_office_line_prompt_needs_handlers():
    office = dict(advisor_id=None, org_phone_id="p1")
    assert not cr._needs_unknown_prompt(_call(**office))
    assert cr._needs_unknown_prompt(_call(**office, handler_ids=["h1"]))


def test_resolve_contact_marks_internal_counterpart():
    profile_map = {cr._phone_suffix("0355500001"): {"name": "קבלה – ארגון", "kind": "org_phone"}}
    res = cr._resolve_contact_for_call({}, profile_map, {}, "c1", "0355500001")
    assert res["contact_name"] == "קבלה – ארגון"
    assert res["internal_counterpart"] is True
    assert res["counterpart_kind"] == "org_phone"
    assert not cr._resolve_contact_for_call({}, {}, {}, "c1", "0355500001").get("internal_counterpart")


def test_prompt_filter_and_readers():
    f = cr._my_prompt_filter("abc")
    assert f.startswith("caller_advisor_id.eq.abc,") and 'notified_recipient_ids.cs.["abc"]' in f
    assert cr._resolution_readers({"org_phone_id": None, "notified_recipient_ids": ["x"]}, "me") == ["me"]
    assert set(cr._resolution_readers({"org_phone_id": "p", "notified_recipient_ids": ["x"]}, "me")) == {"me", "x"}


@pytest.fixture
def org_b_office_phone():
    from pathlib import Path

    from dotenv import load_dotenv
    from supabase_client import get_admin_client

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    db = get_admin_client()
    number = "03" + str(uuid.uuid4().int)[:7]
    row = db.table("org_phones").insert({
        "org_id": ORG_B_ID, "label": "קבלת בדיקה", "phone": number, "handler_ids": [ORG_B_MANAGER_ID],
    }).execute().data[0]
    agent_key = f"test-line-{uuid.uuid4().hex[:8]}"
    db.table("calls_agent_mappings").insert({
        "org_id": ORG_B_ID, "provider": "exm", "agent_key": agent_key, "agent_label": "קו בדיקה",
        "advisor_id": None, "org_phone_id": row["id"],
    }).execute()
    try:
        yield row, agent_key
    finally:
        db.table("org_phones").delete().eq("id", row["id"]).execute()  # mapping cascades


def test_enrich_names_office_phone_and_office_line(org_b_office_phone):
    phone, agent_key = org_b_office_phone
    org_name = cr._load_org_phones(ORG_B_ID)[1]
    expected = f"קבלת בדיקה – {org_name}"

    calls = cr._enrich_raw_calls(ORG_B_ID, "exm", [
        # an unmapped line calling the office number
        {"call_id": "t1", "agent_key": "unmapped-line", "counterpart_phone": phone["phone"], "direction": "outgoing"},
        # a call made on the line assigned to the office phone
        {"call_id": "t2", "agent_key": agent_key, "counterpart_phone": "0501234567", "direction": "incoming"},
    ])
    to_office, on_office_line = calls

    assert to_office["contact_name"] == expected
    assert to_office["internal_counterpart"] is True
    assert on_office_line["advisor_id"] is None
    assert on_office_line["org_phone_id"] == phone["id"]
    assert on_office_line["org_phone_label"] == expected
    assert on_office_line["handler_ids"] == [ORG_B_MANAGER_ID]
