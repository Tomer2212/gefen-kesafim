"""IDOR / cross-org regression suite.

For every covered endpoint group there are (at least) two tests:
  - a NEGATIVE (IDOR) test: Org B's user calls the endpoint with an Org A
    resource id -> must be rejected (403/404), never return real data.
  - a POSITIVE (regression) test: same endpoint, same org's own resource id
    -> must still succeed, to catch an over-fix that broke legitimate access.

Routes/line numbers were re-confirmed directly in backend/routers/*.py at the
time this suite was written (they shift over time, so re-grep if a test here
starts failing with a 404 that looks like "route doesn't exist" rather than
"org check rejected it" — check response body/detail, not just status code,
when debugging).
"""
from conftest import (
    ORG_A_SCHOOL_ID,
    ORG_A_LOG_ID,
    ORG_A_LOG_SCHOOL_ID,
    ORG_A_MEETING_ID,
    ORG_A_MEETING_SCHOOL_ID,
    ORG_B_SCHOOL_ID,
)


# ---------------------------------------------------------------------------
# 1. Accounts — GET /schools/{school_id}/accounts
# ---------------------------------------------------------------------------

def test_list_accounts_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/accounts")
    assert resp.status_code in (403, 404), resp.text


def test_list_accounts_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/accounts")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 2. Goals — GET /schools/{school_id}/goals
#
# NOTE: as of this writing, list_goals() in schools_router.py performs NO
# org-ownership check on school_id at all before querying school_goals —
# unlike every sibling endpoint in this file. This looks like a genuine gap
# the audit missed. The negative test below asserts the CORRECT/expected
# behavior (403/404); if it fails with a 200, that is confirming this real
# finding, not a flaky test — see the final report.
# ---------------------------------------------------------------------------

_GOALS_QS = "division_type=tikkon&budget_name=%D7%92%D7%A4%D7%9F&academic_year=%D7%AA%D7%A9%D7%A4%22%D7%96"


def test_list_goals_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/goals?{_GOALS_QS}")
    assert resp.status_code in (403, 404), (
        "VULNERABILITY: list_goals returned "
        f"{resp.status_code} for a cross-org school_id instead of 403/404. "
        f"Body: {resp.text}"
    )


def test_list_goals_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/goals?{_GOALS_QS}")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 3. Advisors — GET /schools/{school_id}/advisors (manager+ only)
# ---------------------------------------------------------------------------

def test_list_advisors_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/advisors")
    assert resp.status_code in (403, 404), resp.text


def test_list_advisors_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/advisors")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 4. Notes — GET /schools/{school_id}/notes
# ---------------------------------------------------------------------------

def test_get_school_notes_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/notes")
    assert resp.status_code in (403, 404), resp.text


def test_get_school_notes_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/notes")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 5. Files — GET /schools/{school_id}/files
# ---------------------------------------------------------------------------

def test_get_school_files_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/files")
    assert resp.status_code in (403, 404), resp.text


def test_get_school_files_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/files")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 6. Logs — GET /schools/{school_id}/logs and /{school_id}/logs/{log_id}
# ---------------------------------------------------------------------------

def test_list_logs_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_LOG_SCHOOL_ID}/logs")
    assert resp.status_code in (403, 404), resp.text


def test_list_logs_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_LOG_SCHOOL_ID}/logs")
    assert resp.status_code == 200, resp.text


def test_get_log_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_LOG_SCHOOL_ID}/logs/{ORG_A_LOG_ID}")
    assert resp.status_code in (403, 404), resp.text


def test_get_log_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_LOG_SCHOOL_ID}/logs/{ORG_A_LOG_ID}")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 7. Meetings — GET /schools/{school_id}/meetings and .../meetings/{id}/notes
#
# NOTE: same situation as list_goals above — list_meetings() in
# schools_router.py queries the `meetings` table filtered ONLY by
# school_id, with no call to _require_school_in_org / _check_school_access
# and no .eq("org_id", ...) anywhere in the function. This is a second
# apparent gap the audit missed. Asserting the correct behavior here so a
# 200 is caught and reported, not silently accepted.
# ---------------------------------------------------------------------------

def test_list_meetings_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings")
    assert resp.status_code in (403, 404), (
        "VULNERABILITY: list_meetings returned "
        f"{resp.status_code} for a cross-org school_id instead of 403/404. "
        f"Body (truncated): {resp.text[:300]}"
    )


def test_list_meetings_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings")
    assert resp.status_code == 200, resp.text


def test_get_meeting_notes_cross_org_rejected(org_b_client):
    resp = org_b_client.get(
        f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings/{ORG_A_MEETING_ID}/notes"
    )
    assert resp.status_code in (403, 404), resp.text


def test_get_meeting_notes_same_org_still_works(org_a_client):
    resp = org_a_client.get(
        f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings/{ORG_A_MEETING_ID}/notes"
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 8. analyze_router — GET /analyze/logs/{log_id}/source-file
#
# download_log_source_file() checks org access via _check_school_access
# BEFORE looking for the actual stored file. Both the org-check failure and
# a genuine "file not found" return 404, so status code alone can't tell
# them apart — assert on the Hebrew `detail` text too, per the task's own
# guidance, so the test actually proves the ORG CHECK ran and did its job
# rather than just coincidentally producing a 404 either way.
# ---------------------------------------------------------------------------

def test_download_log_source_file_cross_org_rejected(org_b_client):
    resp = org_b_client.get(
        f"/analyze/logs/{ORG_A_LOG_ID}/source-file",
        params={"name": "irrelevant_test_name.xlsx"},
    )
    assert resp.status_code == 404, resp.text
    # Org mismatch is rejected at the _check_school_access stage, before the
    # file lookup even runs — detail must be the "school not found" message,
    # not the (also-404) "file not found" message a same-org caller would see.
    assert resp.json().get("detail") == "בית ספר לא נמצא", (
        f"Expected the org-check rejection message, got: {resp.json()}"
    )


def test_download_log_source_file_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(
        f"/analyze/logs/{ORG_A_LOG_ID}/source-file",
        params={"name": "a_filename_that_almost_certainly_does_not_exist.xlsx"},
    )
    # The org check passes for a same-org caller, so we expect to fall through
    # to the "file not found" branch (this log's stored_file_paths won't
    # contain our made-up name) — a 404 here with the FILE-not-found detail
    # is a pass: it proves the org-check layer let a legitimate caller through.
    # A 200 would also be an acceptable pass if the name happened to match.
    if resp.status_code == 404:
        assert resp.json().get("detail") == "הקובץ לא נמצא", (
            "Got a 404 but with the ORG-rejection message for a same-org "
            f"caller — regression in the org check. Body: {resp.json()}"
        )
    else:
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 9. year-admin-data — GET /schools/{school_id}/year-admin-data
# ---------------------------------------------------------------------------

def test_get_year_admin_data_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-admin-data")
    assert resp.status_code in (403, 404), resp.text


def test_get_year_admin_data_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-admin-data")
    assert resp.status_code == 200, resp.text


# List variant — GET /schools/year-admin-data used to return every org's rows (filtered
# only by academic_year). It takes no school_id, so "rejected" means "never contains the
# other org's schools".

def test_list_year_admin_data_cross_org_excluded(org_b_client):
    resp = org_b_client.get("/schools/year-admin-data")
    assert resp.status_code == 200, resp.text
    assert ORG_A_SCHOOL_ID not in resp.json(), (
        "VULNERABILITY: list_year_admin_data returned an Org A school to an Org B caller"
    )


def test_list_year_admin_data_same_org_still_works(org_a_client):
    resp = org_a_client.get("/schools/year-admin-data")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert ORG_B_SCHOOL_ID not in data
    # Inherited client_status must be filled for the org's schools (the bug this guards:
    # an oversized inheritance query failing silently left ~230 schools without a status).
    assert any(v.get("client_status") for v in data.values())


# ---------------------------------------------------------------------------
# Optional real write-path test, Org B sandbox ONLY: create a school_note
# under Org B's own school, confirm Org A cannot read/edit/delete it, then
# clean it up via Org B's own client.
# ---------------------------------------------------------------------------

def test_school_note_write_path_cross_org_isolation(org_b_client, org_a_client):
    note_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/notes",
            json={"note_type": "general", "content": "IDOR test note — safe to delete"},
        )
        assert create_resp.status_code == 200, create_resp.text
        note_id = create_resp.json()["id"]

        # Org A must not be able to read Org B's notes list and find this note
        # via the org-scoped notes listing in the first place.
        list_resp = org_a_client.get(f"/schools/{ORG_B_SCHOOL_ID}/notes")
        assert list_resp.status_code in (403, 404), list_resp.text

        # Org A must not be able to edit it even if it somehow knew the id.
        edit_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/notes/segments/{note_id}",
            json={"content": "hijacked"},
        )
        assert edit_resp.status_code in (403, 404), edit_resp.text

        # Org A must not be able to delete it either.
        delete_resp = org_a_client.delete(
            f"/schools/{ORG_B_SCHOOL_ID}/notes/segments/{note_id}"
        )
        assert delete_resp.status_code in (403, 404), delete_resp.text
    finally:
        if note_id:
            cleanup_resp = org_b_client.delete(
                f"/schools/{ORG_B_SCHOOL_ID}/notes/segments/{note_id}"
            )
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test note {note_id} under Org B's school "
                f"{ORG_B_SCHOOL_ID} may still exist. Response: {cleanup_resp.text}"
            )
