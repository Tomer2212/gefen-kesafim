"""An advisor can only add or remove THEMSELVES as a meeting's performing advisor — never
anyone else (2026-11-23: after joining, any field autosave by an advisor-role user replaced
the advisor list with [self], removing the other advisor and their Outlook event).

Runs against one throwaway Org B meeting (Org B has no calendar integration, so no Outlook
event is touched), cleaned up in `finally`. The "advisor" clients reuse real Org B profile
ids with role overridden to advisor — the endpoints under test read the role from the user."""
from tests.security.conftest import (
    ORG_A_ID, ORG_A_MANAGER_ID, ORG_B_ID, ORG_B_MANAGER_ID, ORG_B_OWNER_ID, ORG_B_SCHOOL_ID, _user,
)


def _ids(resp) -> list[str]:
    return sorted(resp.json().get("advisor_ids") or [])


def test_advisor_never_changes_other_advisors(org_b_client, make_client):
    owner_as_advisor = make_client(_user(ORG_B_OWNER_ID, ORG_B_ID, "advisor"))
    manager_as_advisor = make_client(_user(ORG_B_MANAGER_ID, ORG_B_ID, "advisor"))
    cross_org_advisor = make_client(_user(ORG_A_MANAGER_ID, ORG_A_ID, "advisor"))
    both = sorted([ORG_B_MANAGER_ID, ORG_B_OWNER_ID])
    base = f"/schools/{ORG_B_SCHOOL_ID}/meetings"
    meeting_id = None
    try:
        create = org_b_client.post(base, json={"meeting_type": "remote", "status": "scheduled", "advisor_ids": [ORG_B_MANAGER_ID]})
        assert create.status_code == 200, create.text
        meeting_id = create.json()["id"]
        url = f"{base}/{meeting_id}"

        joined = owner_as_advisor.post(f"{url}/join")
        assert joined.status_code == 200, joined.text
        assert _ids(joined) == both

        # A field save by an advisor keeps every advisor — whatever advisor_ids it carries.
        put = owner_as_advisor.put(url, json={"meeting_type": "in_person", "advisor_ids": [ORG_B_OWNER_ID]})
        assert put.status_code == 200, put.text
        assert _ids(put) == both
        put = owner_as_advisor.put(url, json={"meeting_type": "remote"})
        assert put.status_code == 200, put.text
        assert _ids(put) == both

        # A manager's save without advisor_ids leaves them alone; with them, it still edits.
        put = org_b_client.put(url, json={"meeting_type": "in_person", "advisor_id": None})
        assert put.status_code == 200, put.text
        assert _ids(put) == both
        put = org_b_client.put(url, json={"advisor_ids": [ORG_B_MANAGER_ID]})
        assert put.status_code == 200, put.text
        assert _ids(put) == [ORG_B_MANAGER_ID]

        # Leave: only oneself, never the last advisor, never across orgs.
        assert owner_as_advisor.post(f"{url}/join").status_code == 200
        assert cross_org_advisor.post(f"{url}/leave").status_code in (403, 404)
        left = owner_as_advisor.post(f"{url}/leave")
        assert left.status_code == 200, left.text
        assert _ids(left) == [ORG_B_MANAGER_ID]
        again = owner_as_advisor.post(f"{url}/leave")
        assert again.status_code == 200, again.text
        assert _ids(again) == [ORG_B_MANAGER_ID]
        last = manager_as_advisor.post(f"{url}/leave")
        assert last.status_code == 409, last.text
        assert last.json()["detail"]["code"] == "last_advisor"
    finally:
        if meeting_id:
            cleanup = org_b_client.delete(f"{base}/{meeting_id}", params={"confirm_all": True})
            assert cleanup.status_code == 200, f"Cleanup failed — test meeting {meeting_id} may still exist: {cleanup.text}"
