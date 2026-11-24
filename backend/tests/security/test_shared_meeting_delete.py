"""A meeting with two performing advisors isn't deleted from under one of them."""
from routers import schools_router
from tests.security.conftest import (
    ORG_A_ID, ORG_A_MANAGER_ID, ORG_B_ID, ORG_B_MANAGER_ID, ORG_B_OWNER_ID, ORG_B_SCHOOL_ID, _user,
)

BASE = f"/schools/{ORG_B_SCHOOL_ID}/meetings"


def _create(client, ids):
    r = client.post(BASE, json={"status": "scheduled", "advisor_ids": ids})
    assert r.status_code == 200, r.text
    return f"{BASE}/{r.json()['id']}"


def test_shared_meeting_delete_rules(org_b_client, make_client, monkeypatch):
    # The org may have turned the advisors' delete permission off; the rule under test comes after it.
    monkeypatch.setattr(schools_router, "_check_permission", lambda *a, **k: True)
    manager_as_advisor = make_client(_user(ORG_B_MANAGER_ID, ORG_B_ID, "advisor"))
    owner_as_advisor = make_client(_user(ORG_B_OWNER_ID, ORG_B_ID, "advisor"))
    outsider = make_client(_user(ORG_A_MANAGER_ID, ORG_A_ID, "manager"))
    both = [ORG_B_MANAGER_ID, ORG_B_OWNER_ID]
    made = []
    try:
        url = _create(org_b_client, both)
        made.append(url)
        assert outsider.delete(url, params={"confirm_all": True}).status_code in (403, 404)
        for params in ({}, {"confirm_all": True}, {"discard_draft": True}):  # not the creator's draft
            r = manager_as_advisor.delete(url, params=params)
            assert r.status_code == 409, r.text
            assert r.json()["detail"]["code"] == "multiple_advisors"
            assert sorted(a["id"] for a in r.json()["detail"]["advisors"]) == sorted(both)
        assert org_b_client.delete(url).status_code == 409

        # One leaves; only the one who stayed may delete.
        assert manager_as_advisor.post(f"{url}/leave").status_code == 200
        assert manager_as_advisor.delete(url).status_code == 403
        assert owner_as_advisor.delete(url).status_code == 200

        # A manager deletes for everyone explicitly; a creator discards their own fresh draft.
        url = _create(org_b_client, both)
        made.append(url)
        assert org_b_client.delete(url, params={"confirm_all": True}).status_code == 200
        url = _create(org_b_client, both)
        made.append(url)
        assert org_b_client.delete(url, params={"discard_draft": True}).status_code == 200
    finally:
        for url in made:
            org_b_client.delete(url, params={"confirm_all": True})
