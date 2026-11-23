"""/directory (national school directory): superadmin-only management, org endpoints only where the
org has the directory enabled, and full isolation of org copies — org A never sees or touches
the copy org B made of the same directory school, and copies never appear in the plain school
list. Org A (a real customer) is only read; org B (sandbox) gets a temporary copy that is deleted
at the end, and its directory_enabled flag is restored."""
import pytest

import school_directory
from conftest import ORG_A_ID, ORG_A_MANAGER_USER, ORG_B_ID, ORG_B_MANAGER_USER, ORG_B_OWNER_USER, ORG_B_SCHOOL_ID


def test_admin_endpoints_reject_non_superadmin(make_client):
    client = make_client({**ORG_B_OWNER_USER, "is_superadmin": False})
    assert client.get("/directory/admin/status").status_code == 403
    assert client.post("/directory/admin/publish/00000000-0000-0000-0000-000000000000").status_code == 403
    assert client.put(f"/directory/admin/orgs/{ORG_B_ID}", json={"enabled": True}).status_code == 403
    assert client.post(f"/directory/admin/orgs/{ORG_A_ID}/link").status_code == 403
    res = client.post("/directory/admin/preview", files={"file": ("x.xlsx", b"x", "application/octet-stream")})
    assert res.status_code == 403


def test_admin_status_allows_superadmin(make_client):
    res = make_client({**ORG_B_OWNER_USER, "is_superadmin": True}).get("/directory/admin/status")
    assert res.status_code == 200, res.text
    assert "directory_count" in res.json()


def test_org_endpoints_require_directory_enabled(make_client, admin_db):
    # The directory is on for every org by default; the superadmin off-switch must block it.
    before = admin_db.table("organizations").select("directory_enabled").eq("id", ORG_B_ID).execute().data[0]["directory_enabled"]
    admin_db.table("organizations").update({"directory_enabled": False}).eq("id", ORG_B_ID).execute()
    try:
        client = make_client(ORG_B_MANAGER_USER)
        assert client.get("/directory/enabled").json() == {"enabled": False}
        assert client.get("/directory/schools").status_code == 403
        assert client.get("/directory/picker", params={"q": "אורט"}).status_code == 403
        assert client.post("/directory/schools/00000000-0000-0000-0000-000000000000/adopt").status_code == 403
        files = {"file": ("x.xlsx", b"x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        assert client.post("/directory/org-import", files=files, data={"rights_confirmed": "true"}).status_code == 403
    finally:
        admin_db.table("organizations").update({"directory_enabled": before}).eq("id", ORG_B_ID).execute()


def test_client_list_is_org_scoped(make_client):
    # Org A cannot change org B's school; org B's own manager passes the org check (400: already a client).
    assert make_client(ORG_A_MANAGER_USER).post(f"/directory/client-list/{ORG_B_SCHOOL_ID}", json={"action": "add", "client_status": "in_progress"}).status_code == 404
    res = make_client(ORG_B_MANAGER_USER).post(f"/directory/client-list/{ORG_B_SCHOOL_ID}", json={"action": "add", "client_status": "in_progress"})
    assert res.status_code == 400, res.text
    advisor = {**ORG_B_MANAGER_USER, "role": "advisor"}
    assert make_client(advisor).post(f"/directory/client-list/{ORG_B_SCHOOL_ID}", json={"action": "return"}).status_code == 403


@pytest.fixture
def org_b_copy(admin_db):
    """Enables the directory for org B, adopts one directory school there, and cleans up."""
    entries = admin_db.table("school_directory").select("id, symbol").eq("ministry_stage", 'יסודי וחט"ב').limit(20).execute().data
    taken = {s["symbol"] for s in admin_db.table("schools").select("symbol").in_("org_id", [ORG_A_ID, ORG_B_ID]).execute().data}
    entry = next((e for e in entries if e["symbol"] not in taken), None)
    if not entry:
        pytest.skip("no free directory entry")
    before = admin_db.table("organizations").select("directory_enabled").eq("id", ORG_B_ID).execute().data[0]["directory_enabled"]
    admin_db.table("organizations").update({"directory_enabled": True}).eq("id", ORG_B_ID).execute()
    created = []
    try:
        yield entry, created
    finally:
        for school_id in created:
            for table in ("school_activity", "school_year_admin_data", "school_advisors_gefen",
                          "school_advisors_current", "school_advisors_district", "advisor_schools", "notifications"):
                admin_db.table(table).delete().eq("school_id", school_id).execute()
            admin_db.table("schools").delete().eq("id", school_id).execute()
        admin_db.table("organizations").update({"directory_enabled": before}).eq("id", ORG_B_ID).execute()


def test_org_copy_is_private_and_hidden_from_lists(make_client, admin_db, org_b_copy):
    entry, created = org_b_copy
    org_b = make_client(ORG_B_MANAGER_USER)
    res = org_b.post(f"/directory/schools/{entry['id']}/adopt")
    assert res.status_code == 200, res.text
    copy_id = res.json()["school_id"]
    created.append(copy_id)
    assert org_b.post(f"/directory/schools/{entry['id']}/adopt").json()["school_id"] == copy_id  # idempotent

    # Org B sees its copy in the directory; org A's view of the same entry stays the bare directory.
    b_view = school_directory.search_directory(admin_db, ORG_B_ID, entry["symbol"], {}, 0)["items"]
    a_view = school_directory.search_directory(admin_db, ORG_A_ID, entry["symbol"], {}, 0)["items"]
    # Opening the card (adopt) alone is not contact: no "היו פגישות" tag until a real meeting.
    assert any(i["school_id"] == copy_id and i["tag"] == "none" for i in b_view)
    assert all(i["school_id"] != copy_id and i["tag"] == "none" for i in a_view if i["directory_id"] == entry["id"])

    # Hidden from the plain list, returned only when asked for by id — and never to another org.
    assert copy_id not in {s["id"] for s in org_b.get("/schools/", params={"lite": True}).json()}
    assert [s["id"] for s in org_b.get("/schools/", params={"ids": copy_id}).json()] == [copy_id]
    org_a = make_client(ORG_A_MANAGER_USER)
    assert org_a.get("/schools/", params={"ids": copy_id}).json() == []
    assert org_a.get(f"/schools/{copy_id}").status_code == 404
    assert org_a.post(f"/directory/client-list/{copy_id}", json={"action": "add", "client_status": "in_progress"}).status_code == 404


def test_org_import_requires_manager(make_client):
    files = {"file": ("x.xlsx", b"x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    advisor = {**ORG_B_MANAGER_USER, "role": "advisor"}
    assert make_client(advisor).post("/directory/org-import", files=files, data={"rights_confirmed": "true"}).status_code == 403


# ---------------------------------------------------------------------------
# Adding a directory school to the client list ("שמור והוסף לרשימת הלקוחות")
# ---------------------------------------------------------------------------

ORG_B_FAKE_ADVISOR = {**ORG_B_MANAGER_USER, "role": "advisor"}


@pytest.fixture
def add_school_override(admin_db):
    """Sets a per-user can_add_school override for the org B user the tests act as (as an advisor)."""
    def set_allowed(allowed: bool):
        admin_db.table("user_permission_overrides").delete().eq("user_id", ORG_B_MANAGER_USER["id"]).eq("permission", "can_add_school").execute()
        admin_db.table("user_permission_overrides").insert({
            "user_id": ORG_B_MANAGER_USER["id"], "owner_id": ORG_B_OWNER_USER["id"],
            "permission": "can_add_school", "allowed": allowed,
        }).execute()
    try:
        yield set_allowed
    finally:
        admin_db.table("user_permission_overrides").delete().eq("user_id", ORG_B_MANAGER_USER["id"]).eq("permission", "can_add_school").execute()


def _adopt(client, entry, created):
    res = client.post(f"/directory/schools/{entry['id']}/adopt")
    assert res.status_code == 200, res.text
    created.append(res.json()["school_id"])
    return res.json()["school_id"]


def test_client_list_add_validates_like_a_manual_add(make_client, admin_db, org_b_copy):
    entry, created = org_b_copy
    org_b = make_client(ORG_B_MANAGER_USER)
    copy_id = _adopt(org_b, entry, created)
    url = f"/directory/client-list/{copy_id}"

    # Another org's user can never be made an accompanying advisor.
    res = org_b.post(url, json={"action": "add", "client_status": "in_progress", "typed_advisors": {"gefen": [ORG_A_MANAGER_USER["id"]]}})
    assert res.status_code == 400, res.text
    # A meeting coordinator per slot of the service type is mandatory.
    res = org_b.post(url, json={"action": "add", "client_status": "in_progress", "service_type": "gefen"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "missing_coordinators", res.text
    admin_db.table("schools").update({"meeting_coordinators": {"gefen": "principal"}, "principal_name": "בדיקה"}).eq("id", copy_id).execute()
    # An active client needs an accompanying advisor per active service type.
    res = org_b.post(url, json={"action": "add", "client_status": "active", "service_type": "gefen"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "missing_advisor", res.text
    assert admin_db.table("schools").select("status").eq("id", copy_id).execute().data[0]["status"] == "directory"

    res = org_b.post(url, json={"action": "add", "client_status": "active", "service_type": "gefen",
                                "typed_advisors": {"gefen": [ORG_B_MANAGER_USER["id"]]}})
    assert res.status_code == 200, res.text
    assert admin_db.table("schools").select("status").eq("id", copy_id).execute().data[0]["status"] == "active"
    assert admin_db.table("school_advisors_gefen").select("advisor_id").eq("school_id", copy_id).execute().data == [{"advisor_id": ORG_B_MANAGER_USER["id"]}]


def test_advisor_completes_directory_copy_only_with_add_permission(make_client, admin_db, org_b_copy, add_school_override):
    entry, created = org_b_copy
    copy_id = _adopt(make_client(ORG_B_MANAGER_USER), entry, created)
    advisor = make_client(ORG_B_FAKE_ADVISOR)
    body = {"name": "בדיקה", "meeting_coordinators": {}}

    add_school_override(False)
    assert advisor.put(f"/schools/{copy_id}", json=body).status_code == 403
    assert advisor.post(f"/directory/client-list/{copy_id}", json={"action": "add", "client_status": "in_progress"}).status_code == 403

    add_school_override(True)
    assert advisor.put(f"/schools/{copy_id}", json=body).status_code == 200
    res = advisor.post(f"/directory/client-list/{copy_id}", json={"action": "add", "client_status": "in_progress"})
    assert res.status_code == 200, res.text
    # Once it is a client, the regular edit rules apply again (no can_edit_school_directly here).
    admin_db.table("user_permission_overrides").insert({
        "user_id": ORG_B_MANAGER_USER["id"], "owner_id": ORG_B_OWNER_USER["id"],
        "permission": "can_edit_school_directly", "allowed": False,
    }).execute()
    try:
        assert advisor.put(f"/schools/{copy_id}", json=body).status_code == 403
    finally:
        admin_db.table("user_permission_overrides").delete().eq("user_id", ORG_B_MANAGER_USER["id"]).eq("permission", "can_edit_school_directly").execute()


def test_create_school_onboarding_rejects_foreign_advisors(make_client):
    res = make_client(ORG_B_MANAGER_USER).post("/schools/", json={
        "name": "בדיקת אבטחה", "symbol": "999997", "meeting_coordinator": "principal",
        "onboarding": {"client_status": "in_progress", "typed_advisors": {"gefen": [ORG_A_MANAGER_USER["id"]]}},
    })
    assert res.status_code == 400, res.text
