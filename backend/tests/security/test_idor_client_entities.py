"""District / ownership client cards (/clients, client_entities.py) — cross-org isolation plus
the rules that keep a card out of school-only paths.

Same safety convention as test_idor_cross_org_extended.py: every mutation targets Org B (the
sandbox); the card this file adopts is deleted afterwards if this file created it.
"""
import pytest

from conftest import ORG_B_ID, ORG_B_OWNER_ID, _user

DISTRICT_KEY = "חינוך התיישבותי"


@pytest.fixture
def org_b_district(org_b_client, admin_db):
    existed = (
        admin_db.table("schools").select("id")
        .eq("org_id", ORG_B_ID).eq("client_type", "district").eq("entity_key", DISTRICT_KEY)
        .execute().data
    )
    resp = org_b_client.post("/clients/adopt", json={"type": "district", "key": DISTRICT_KEY})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    try:
        yield row
    finally:
        if not existed:
            admin_db.table("school_activity").delete().eq("school_id", row["id"]).execute()
            admin_db.table("schools").delete().eq("id", row["id"]).execute()


def test_adopt_returns_entity_row(org_b_district):
    assert org_b_district["client_type"] == "district"
    assert org_b_district["status"] == "entity"
    assert org_b_district["label"] == f"מחוז {DISTRICT_KEY}"


def test_adopt_is_idempotent(org_b_client, org_b_district):
    resp = org_b_client.post("/clients/adopt", json={"type": "district", "key": DISTRICT_KEY})
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == org_b_district["id"]


def test_adopt_unknown_key_rejected(org_b_client):
    resp = org_b_client.post("/clients/adopt", json={"type": "district", "key": "לא מחוז"})
    assert resp.status_code == 404, resp.text


def test_get_client_cross_org_rejected(org_a_client, org_b_district):
    resp = org_a_client.get(f"/clients/{org_b_district['id']}")
    assert resp.status_code in (403, 404), resp.text


def test_get_client_same_org_still_works(org_b_client, org_b_district):
    resp = org_b_client.get(f"/clients/{org_b_district['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["can_mark_client"] is True


def test_get_client_rejects_a_real_school(org_b_client):
    from conftest import ORG_B_SCHOOL_ID
    resp = org_b_client.get(f"/clients/{ORG_B_SCHOOL_ID}")
    assert resp.status_code == 404, resp.text


def test_contacts_cross_org_rejected(org_a_client, org_b_district):
    resp = org_a_client.put(f"/clients/{org_b_district['id']}/contacts", json={"extra_contacts": []})
    assert resp.status_code in (403, 404), resp.text


def test_contacts_same_org_still_works(org_b_client, org_b_district):
    contacts = [{"role": "מפקח/ת", "name": "בדיקה", "phone": "", "email": "", "day_off": []}]
    resp = org_b_client.put(f"/clients/{org_b_district['id']}/contacts", json={"extra_contacts": contacts})
    assert resp.status_code == 200, resp.text
    assert resp.json()["extra_contacts"][0]["name"] == "בדיקה"
    org_b_client.put(f"/clients/{org_b_district['id']}/contacts", json={"extra_contacts": org_b_district.get("extra_contacts") or []})


def test_client_list_cross_org_rejected(org_a_client, org_b_district):
    resp = org_a_client.patch(f"/clients/{org_b_district['id']}/client-list", json={"is_client": True})
    assert resp.status_code in (403, 404), resp.text


def test_client_list_advisor_rejected(make_client, org_b_district):
    advisor = make_client(_user(ORG_B_OWNER_ID, ORG_B_ID, "advisor"))
    resp = advisor.patch(f"/clients/{org_b_district['id']}/client-list", json={"is_client": True})
    assert resp.status_code == 403, resp.text


def test_client_list_same_org_still_works(org_b_client, org_b_district):
    before = bool(org_b_district.get("is_client"))
    resp = org_b_client.patch(f"/clients/{org_b_district['id']}/client-list", json={"is_client": not before})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_client"] is (not before)
    org_b_client.patch(f"/clients/{org_b_district['id']}/client-list", json={"is_client": before})


def test_list_clients_scoped_to_org(org_a_client, org_b_client, org_b_district):
    mine = org_b_client.get("/clients/", params={"type": "district", "scope": "all"})
    assert mine.status_code == 200, mine.text
    rows = mine.json()
    assert len(rows) >= 8
    assert any(r["id"] == org_b_district["id"] for r in rows)
    theirs = org_a_client.get("/clients/", params={"type": "district", "scope": "all"})
    assert theirs.status_code == 200, theirs.text
    assert all(r["id"] != org_b_district["id"] for r in theirs.json())


def test_entity_not_listed_as_school(org_b_client, org_b_district):
    resp = org_b_client.get("/schools/", params={"lite": True})
    assert resp.status_code == 200, resp.text
    assert all(s["id"] != org_b_district["id"] for s in resp.json())
    resp = org_b_client.get("/schools/", params={"ids": org_b_district["id"], "lite": True})
    assert [s["id"] for s in resp.json()] == [org_b_district["id"]]


def test_entity_meetings_cross_org_rejected(org_a_client, org_b_district):
    resp = org_a_client.get(f"/schools/{org_b_district['id']}/meetings")
    assert resp.status_code in (403, 404), resp.text


def test_entity_meeting_rules(org_b_client, org_b_district, admin_db):
    sid = org_b_district["id"]
    bad = org_b_client.post(f"/schools/{sid}/meetings", json={"meeting_service_type": "district", "advisor_ids": []})
    assert bad.status_code == 400, bad.text
    resp = org_b_client.post(
        f"/schools/{sid}/meetings",
        json={"meeting_service_type": "gefen", "advisor_ids": [], "reminder_enabled": True},
    )
    assert resp.status_code == 200, resp.text
    meeting = resp.json()
    try:
        assert meeting["reminder_enabled"] is False
        listed = org_b_client.get(f"/schools/{sid}/meetings")
        assert any(m["id"] == meeting["id"] for m in listed.json())
    finally:
        admin_db.table("meeting_activity").delete().eq("meeting_id", meeting["id"]).execute()
        admin_db.table("meetings").delete().eq("id", meeting["id"]).execute()


def test_contacts_phone_validated(org_b_client, org_b_district):
    sid = org_b_district["id"]
    original = org_b_district.get("extra_contacts") or []
    for bad in ("5012345678", "05012345678", "0501", "123456789"):
        resp = org_b_client.put(f"/clients/{sid}/contacts", json={"extra_contacts": [{"name": "בדיקה", "phone": bad}]})
        assert resp.status_code == 422, (bad, resp.text)
    try:
        for good, stored in (("0501234567", "0501234567"), ("035551234", "035551234"),
                             ("972501234567", "0501234567"), ("050-123-4567", "0501234567")):
            resp = org_b_client.put(f"/clients/{sid}/contacts", json={"extra_contacts": [{"name": "בדיקה", "phone": good}]})
            assert resp.status_code == 200, (good, resp.text)
            assert resp.json()["extra_contacts"][0]["phone"] == stored
    finally:
        org_b_client.put(f"/clients/{sid}/contacts", json={"extra_contacts": original})


def test_entity_calls_cross_org_rejected(org_a_client, org_b_district):
    resp = org_a_client.get(f"/schools/{org_b_district['id']}/calls")
    assert resp.status_code in (403, 404), resp.text


def test_entity_calls_same_org_still_works(org_b_client, org_b_district):
    # Passing the access check is what's tested: the request then reaches the live calls provider,
    # which may refuse a dev machine's IP (502 "IP address ... is not trusted") — not an access denial.
    resp = org_b_client.get(f"/schools/{org_b_district['id']}/calls")
    assert resp.status_code not in (401, 403, 404), resp.text
