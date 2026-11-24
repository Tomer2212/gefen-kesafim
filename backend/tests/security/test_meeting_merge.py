""""זו אותה פגישה?" — merge-into / confirm-separate: cross-org rejected, same-org works, nothing
lost, and two merges into each other at once never remove both.

Throwaway Org B meetings (no calendar integration), far in the future, removed in `finally`."""
from concurrent.futures import ThreadPoolExecutor

from tests.security.conftest import (
    ORG_A_ID, ORG_A_MANAGER_ID, ORG_B_ID, ORG_B_MANAGER_ID, ORG_B_OWNER_ID, ORG_B_SCHOOL_ID, _user,
)

BASE = f"/schools/{ORG_B_SCHOOL_ID}/meetings"


def _create(client, day, start, end, advisor):
    r = client.post(BASE, json={"status": "scheduled", "meeting_date": day, "start_time": start, "end_time": end, "advisor_ids": [advisor]})
    assert r.status_code == 200, r.text
    return r.json()


def test_merge_and_confirm_separate(org_b_client, make_client):
    outsider = make_client(_user(ORG_A_MANAGER_ID, ORG_A_ID, "manager"))
    stranger = make_client(_user(ORG_B_MANAGER_ID, ORG_B_ID, "advisor"))
    made = []
    try:
        a = _create(org_b_client, "2031-03-04", "10:00", "11:00", ORG_B_MANAGER_ID)
        made.append(a["id"])
        assert a["overlapping_meetings"] == []
        b = _create(org_b_client, "2031-03-04", "10:30", "12:00", ORG_B_OWNER_ID)
        made.append(b["id"])
        assert [x["id"] for x in b["overlapping_meetings"]] == [a["id"]]

        merge, separate = f"{BASE}/{b['id']}/merge-into/{a['id']}", f"{BASE}/{b['id']}/confirm-separate"
        assert outsider.post(merge).status_code in (403, 404)
        assert outsider.post(separate, json={"other_ids": [a["id"]]}).status_code in (403, 404)

        # Not asked again about a confirmed pair, from either side.
        assert org_b_client.post(separate, json={"other_ids": [a["id"]]}).status_code == 200
        put = org_b_client.put(f"{BASE}/{b['id']}", json={"start_time": "10:15", "end_time": "12:00"})
        assert put.status_code == 200 and put.json()["overlapping_meetings"] == []
        put = org_b_client.put(f"{BASE}/{a['id']}", json={"start_time": "10:05", "end_time": "11:00"})
        assert put.json()["overlapping_meetings"] == []

        # An advisor who is neither on the meeting nor its creator can't merge it away.
        assert stranger.post(merge).status_code == 403

        work = org_b_client.post(f"{BASE}/{b['id']}/offline-work", json={"start_time": "08:00", "end_time": "08:30", "notes": "offline work note"})
        assert work.status_code == 200, work.text
        merged = org_b_client.post(merge)
        assert merged.status_code == 200, merged.text
        body = merged.json()
        assert sorted(body["advisor_ids"]) == sorted([ORG_B_MANAGER_ID, ORG_B_OWNER_ID])
        assert (body["start_time"], body["end_time"], len(body["offline_work_entries"])) == ("10:05", "11:00", 1)
        assert org_b_client.post(merge).status_code == 404
    finally:
        for mid in made:
            org_b_client.delete(f"{BASE}/{mid}", params={"confirm_all": True})


def test_merge_fills_only_what_the_existing_meeting_lacks(org_b_client):
    made = []
    try:
        r = org_b_client.post(BASE, json={"status": "scheduled", "meeting_date": "2031-03-06", "advisor_ids": [ORG_B_MANAGER_ID]})
        made.append(r.json()["id"])
        new = _create(org_b_client, "2031-03-06", "13:00", "18:00", ORG_B_MANAGER_ID)
        made.append(new["id"])
        assert [x["id"] for x in new["overlapping_meetings"]] == [made[0]]  # no hours = can't tell apart
        merged = org_b_client.post(f"{BASE}/{new['id']}/merge-into/{made[0]}")
        assert merged.status_code == 200, merged.text
        assert (merged.json()["start_time"], merged.json()["end_time"], merged.json()["status"]) == ("13:00", "18:00", "scheduled")
    finally:
        for mid in made:
            org_b_client.delete(f"{BASE}/{mid}", params={"confirm_all": True})


def test_merging_into_each_other_at_once_keeps_one(org_b_client):
    made = []
    try:
        a = _create(org_b_client, "2031-03-05", "10:00", "11:00", ORG_B_MANAGER_ID)["id"]
        made.append(a)
        b = _create(org_b_client, "2031-03-05", "10:00", "11:00", ORG_B_OWNER_ID)["id"]
        made.append(b)
        with ThreadPoolExecutor(2) as pool:
            codes = sorted(pool.map(lambda p: org_b_client.post(f"{BASE}/{p[0]}/merge-into/{p[1]}").status_code, [(a, b), (b, a)]))
        assert codes[0] == 200 and codes[1] in (404, 409), codes
        left = [x for x in org_b_client.get(BASE).json() if x["id"] in (a, b)]
        assert len(left) == 1 and len(left[0]["advisor_ids"]) == 2
    finally:
        for mid in made:
            org_b_client.delete(f"{BASE}/{mid}", params={"confirm_all": True})
