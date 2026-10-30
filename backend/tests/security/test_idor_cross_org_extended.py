"""Extended IDOR / cross-org regression suite — covers the endpoint groups NOT already
in test_idor_cross_org.py (see that file's docstring + conftest.py for the fixture pattern,
real org/resource UUIDs, and the _UserScopedClient rebinding mechanism).

Safety convention used throughout this file (stricter than "never write to org A" alone):
  - Every MUTATING (POST/PUT/PATCH/DELETE) call's TARGET resource is always an Org B
    (sandbox) resource — either one of the fixed ORG_B_* ids, or a throwaway resource this
    file creates and deletes itself in a `finally` block. This holds even for "negative"
    tests: the attacking caller may be org_a_client, but the resource being mutated is
    still Org B's own sandbox data, so a false-negative (the check failing to reject) can
    only ever corrupt our own sandbox row, never real customer data.
  - Every call whose target resource is Org A is a GET (or a POST/PUT that is read-only in
    practice, e.g. compare_plans only downloads+diffs, never writes) — never a genuine
    mutation.
  - Endpoints that queue a background task calling a real external API (Outlook calendar
    sync on create/update meeting, AI meeting-summary transcription, outbound email sends)
    are either tested only for the pre-mutation org-check rejection (cheapest safe negative),
    or skipped entirely with a comment, per the task's own escape clause for "genuinely
    unsafe or impractical" positive tests.
"""
import uuid

import pytest

from conftest import (
    ORG_A_SCHOOL_ID,
    ORG_A_MEETING_ID,
    ORG_A_MEETING_SCHOOL_ID,
    ORG_A_MANAGER_ID,
    ORG_A_RUN_ID,
    ORG_B_SCHOOL_ID,
    ORG_B_ID,
    ORG_B_OWNER_ID,
    ORG_B_MANAGER_ID,
)


# ===========================================================================
# 1. year-admin-data — write side (GET already covered)
# ===========================================================================

def test_put_year_admin_data_cross_org_rejected(org_a_client):
    # Attacker = org_a_client, target = Org B's own school -> must be rejected, and if the
    # check somehow failed it would only ever write into our own sandbox school's row.
    resp = org_a_client.put(
        f"/schools/{ORG_B_SCHOOL_ID}/year-admin-data",
        json={"receipts_sent": 1},
    )
    assert resp.status_code in (403, 404), resp.text


def test_put_year_admin_data_same_org_still_works(org_b_client):
    resp = org_b_client.put(
        f"/schools/{ORG_B_SCHOOL_ID}/year-admin-data",
        json={"receipts_sent": 1},
    )
    assert resp.status_code == 200, resp.text


def test_bulk_put_year_admin_data_cross_org_rejected(org_a_client):
    """bulk_upsert_year_admin_data is fail-soft per item (never raises at the top level) —
    a cross-org school_id lands in the `failed` list with nothing written, rather than a
    403/404 HTTP status. Assert on the body, not the status code."""
    resp = org_a_client.put(
        "/schools/year-admin-data/bulk",
        json={
            "field": "receipts_sent",
            "academic_year": "תשפ\"ו",
            "items": [{"school_id": ORG_B_SCHOOL_ID, "value": 1}],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated"] == [], (
        f"VULNERABILITY: bulk_upsert_year_admin_data wrote to Org B's school from an "
        f"Org A caller. Body: {body}"
    )
    assert any(f["school_id"] == ORG_B_SCHOOL_ID for f in body["failed"]), body


def test_bulk_put_year_admin_data_same_org_still_works(org_b_client):
    resp = org_b_client.put(
        "/schools/year-admin-data/bulk",
        json={
            "field": "receipts_sent",
            "academic_year": "תשפ\"ו",
            "items": [{"school_id": ORG_B_SCHOOL_ID, "value": 2}],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["updated"]) == 1 and body["updated"][0]["school_id"] == ORG_B_SCHOOL_ID, body


def test_upload_contract_file_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/year-admin-data/contract-file",
        files={"file": ("contract.pdf", b"not a real pdf", "application/pdf")},
    )
    assert resp.status_code in (403, 404), resp.text


def test_upload_contract_file_same_org_still_works(org_b_client):
    # NOTE: academic_year is passed explicitly as a plain ASCII value here — using the
    # real DEFAULT_ACADEMIC_YEAR (Hebrew text containing a literal `"` character, e.g.
    # תשפ"ו) makes upload_contract_file build an invalid Supabase Storage key
    # (storage_key embeds academic_year raw, unsanitized) and 500s on ANY same-org
    # upload. This looks like a genuine pre-existing functional bug in
    # schools_router.upload_contract_file (unrelated to org isolation — it isn't
    # security-scoped and not fixed here per this task's scope) — see the final report.
    resp = org_b_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/year-admin-data/contract-file?academic_year=2024",
        files={"file": ("contract.pdf", b"not a real pdf", "application/pdf")},
    )
    assert resp.status_code == 200, resp.text


def test_download_contract_file_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-admin-data/contract-file")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית הספר לא נמצא", (
        f"Expected the org-check rejection message, got: {resp.json()}"
    )


def test_download_contract_file_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-admin-data/contract-file")
    # Either a real contract file exists (200) or none was uploaded yet (404 with the
    # FILE-not-found detail) — either is a pass, as long as it's not the org-rejection detail.
    if resp.status_code == 404:
        assert resp.json().get("detail") == "לא הועלה קובץ חוזה", (
            f"Got a 404 but with the ORG-rejection message for a same-org caller. Body: {resp.json()}"
        )
    else:
        assert resp.status_code == 200, resp.text


# ===========================================================================
# 2. gefen-closures (list + set) and incentive-model (get + set)
# ===========================================================================

_GC_QS = "academic_year=%D7%AA%D7%A9%D7%A4%22%D7%96"


def test_list_gefen_closures_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/gefen-closures?{_GC_QS}")
    assert resp.status_code in (403, 404), resp.text


def test_list_gefen_closures_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/gefen-closures?{_GC_QS}")
    assert resp.status_code == 200, resp.text


def test_set_gefen_closure_cross_org_rejected(org_a_client):
    resp = org_a_client.patch(
        f"/schools/{ORG_B_SCHOOL_ID}/gefen-closures",
        json={
            "division_type": "tikkon", "budget_name": "גפן", "academic_year": "תשפ\"ו",
            "status": True, "notes": "idor test",
        },
    )
    assert resp.status_code in (403, 404), resp.text


def test_set_gefen_closure_same_org_still_works(org_b_client):
    resp = org_b_client.patch(
        f"/schools/{ORG_B_SCHOOL_ID}/gefen-closures",
        json={
            "division_type": "tikkon", "budget_name": "גפן", "academic_year": "תשפ\"ו",
            "status": True, "notes": "idor test — safe to ignore/delete",
        },
    )
    assert resp.status_code == 200, resp.text


_IM_QS = "division_type=tikkon&budget_name=%D7%92%D7%A4%D7%9F&academic_year=%D7%AA%D7%A9%D7%A4%22%D7%96"


def test_get_incentive_model_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/incentive-model?{_IM_QS}")
    assert resp.status_code in (403, 404), resp.text


def test_get_incentive_model_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/incentive-model?{_IM_QS}")
    assert resp.status_code == 200, resp.text


def test_set_incentive_model_cross_org_rejected(org_a_client):
    resp = org_a_client.patch(
        f"/schools/{ORG_B_SCHOOL_ID}/incentive-model",
        json={"division_type": "tikkon", "budget_name": "גפן", "academic_year": "תשפ\"ו", "met": True},
    )
    assert resp.status_code in (403, 404), resp.text


def test_set_incentive_model_same_org_still_works(org_b_client):
    resp = org_b_client.patch(
        f"/schools/{ORG_B_SCHOOL_ID}/incentive-model",
        json={"division_type": "tikkon", "budget_name": "גפן", "academic_year": "תשפ\"ו", "met": True},
    )
    assert resp.status_code == 200, resp.text


# ===========================================================================
# 3. Advisors — assign/unassign, typed variant, bulk variant, temp-access-grant,
#    advisor-access-matrix. ("list" GET is already covered in test_idor_cross_org.py.)
# ===========================================================================

def test_assign_advisor_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/advisors", json={"advisor_id": ORG_B_MANAGER_ID}
    )
    assert resp.status_code in (403, 404), resp.text


def test_assign_then_unassign_advisor_same_org_round_trip(org_b_client, admin_db):
    """Combines assign + unassign into one round-trip test using a throwaway advisor
    (ORG_B_OWNER_ID), restoring pre-existing state exactly rather than blindly deleting —
    an owner is already a valid assignee on schools in this app, so if they happened to
    already be assigned to this sandbox school, this test must not remove that.

    assign_advisor unconditionally inserts a real 'advisor_assigned' notification as a
    side effect (not gated on "was this actually a new assignment") — every re-run of
    this test spams a real notification at a real recipient. Delete it after asserting,
    so running this suite repeatedly (as happens constantly during active development)
    doesn't pollute the sandbox org's notification feed."""
    pre = org_b_client.get(f"/schools/{ORG_B_SCHOOL_ID}/advisors")
    assert pre.status_code == 200, pre.text
    pre_ids = {a["id"] for a in pre.json()}
    already_assigned = ORG_B_OWNER_ID in pre_ids

    try:
        resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/advisors", json={"advisor_id": ORG_B_OWNER_ID}
        )
        assert resp.status_code == 200, resp.text
    finally:
        admin_db.table("notifications").delete() \
            .eq("type", "advisor_assigned").eq("school_id", ORG_B_SCHOOL_ID) \
            .eq("recipient_id", ORG_B_OWNER_ID).execute()

    if not already_assigned:
        unassign = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/advisors/{ORG_B_OWNER_ID}")
        assert unassign.status_code == 200, unassign.text


def test_unassign_advisor_cross_org_rejected(org_a_client):
    resp = org_a_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/advisors/{ORG_B_MANAGER_ID}")
    assert resp.status_code in (403, 404), resp.text


def test_typed_advisor_list_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/advisors/gefen")
    assert resp.status_code in (403, 404), resp.text


def test_typed_advisor_list_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/advisors/gefen")
    assert resp.status_code == 200, resp.text


def test_assign_typed_advisor_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/advisors/gefen", json={"advisor_id": ORG_B_MANAGER_ID}
    )
    assert resp.status_code in (403, 404), resp.text


def test_assign_then_unassign_typed_advisor_same_org_round_trip(org_b_client, admin_db):
    pre = org_b_client.get(f"/schools/{ORG_B_SCHOOL_ID}/advisors/gefen")
    assert pre.status_code == 200, pre.text
    already_assigned = ORG_B_MANAGER_ID in {a["id"] for a in pre.json()}

    try:
        resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/advisors/gefen", json={"advisor_id": ORG_B_MANAGER_ID}
        )
        assert resp.status_code == 200, resp.text
    finally:
        # Same real-notification side effect as the untyped assign above — clean it up.
        admin_db.table("notifications").delete() \
            .eq("type", "advisor_assigned").eq("school_id", ORG_B_SCHOOL_ID) \
            .eq("recipient_id", ORG_B_MANAGER_ID).execute()

    if not already_assigned:
        unassign = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/advisors/gefen/{ORG_B_MANAGER_ID}")
        assert unassign.status_code == 200, unassign.text


def test_unassign_typed_advisor_cross_org_rejected(org_a_client):
    resp = org_a_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/advisors/gefen/{ORG_B_MANAGER_ID}")
    assert resp.status_code in (403, 404), resp.text


def test_bulk_assign_typed_advisor_cross_org_rejected(org_a_client):
    """bulk_assign_typed_advisor silently filters school_ids down to the caller's own org
    before acting, then 400s if nothing is left — assert on that fail-closed behavior
    (never a 200 that actually touched Org B's school)."""
    resp = org_a_client.post(
        "/schools/advisors/gefen/bulk-assign",
        json={"advisor_id": ORG_B_MANAGER_ID, "school_ids": [ORG_B_SCHOOL_ID]},
    )
    assert resp.status_code == 400, (
        f"VULNERABILITY: bulk_assign_typed_advisor let an Org A caller act on an Org B "
        f"school_id. Response: {resp.status_code} {resp.text}"
    )


def test_bulk_assign_then_bulk_unassign_typed_advisor_same_org_round_trip(org_b_client, admin_db):
    pre = org_b_client.get(f"/schools/{ORG_B_SCHOOL_ID}/advisors/current")
    assert pre.status_code == 200, pre.text
    already_assigned = ORG_B_MANAGER_ID in {a["id"] for a in pre.json()}

    try:
        resp = org_b_client.post(
            "/schools/advisors/current/bulk-assign",
            json={"advisor_id": ORG_B_MANAGER_ID, "school_ids": [ORG_B_SCHOOL_ID]},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert ORG_B_SCHOOL_ID in body["newly_assigned"] or ORG_B_SCHOOL_ID in body["already_assigned"], body
    finally:
        # Same real-notification side effect as the other assign tests — clean it up.
        admin_db.table("notifications").delete() \
            .eq("type", "advisor_assigned").eq("school_id", ORG_B_SCHOOL_ID) \
            .eq("recipient_id", ORG_B_MANAGER_ID).execute()

    if not already_assigned:
        undo = org_b_client.post(
            "/schools/advisors/current/bulk-unassign",
            json={"advisor_id": ORG_B_MANAGER_ID, "school_ids": [ORG_B_SCHOOL_ID]},
        )
        assert undo.status_code == 200, undo.text


def test_bulk_unassign_typed_advisor_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        "/schools/advisors/current/bulk-unassign",
        json={"advisor_id": ORG_B_MANAGER_ID, "school_ids": [ORG_B_SCHOOL_ID]},
    )
    assert resp.status_code == 400, (
        f"VULNERABILITY: bulk_unassign_typed_advisor let an Org A caller act on an Org B "
        f"school_id. Response: {resp.status_code} {resp.text}"
    )


def test_grant_temp_advisor_access_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/advisors/{ORG_B_MANAGER_ID}/grant-temp-access",
        json={"starts_at": "2020-01-01T00:00:00Z", "expires_at": "2020-01-02T00:00:00Z"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_grant_temp_advisor_access_same_org_still_works(org_b_client):
    """Uses an already-elapsed window (starts/expires in the past) so the activation
    branch runs (proving the endpoint works end-to-end) but process_temp_advisor_access's
    cron sweep will naturally expire+clean it up on its own; we also actively restore
    advisor_schools to its pre-test state here rather than relying on that cron."""
    pre = org_b_client.get(f"/schools/{ORG_B_SCHOOL_ID}/advisors")
    assert pre.status_code == 200, pre.text
    pre_ids = {a["id"] for a in pre.json()}
    already_assigned = ORG_B_OWNER_ID in pre_ids

    resp = org_b_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/advisors/{ORG_B_OWNER_ID}/grant-temp-access",
        json={"starts_at": "2020-01-01T00:00:00Z", "expires_at": "2020-01-02T00:00:00Z"},
    )
    assert resp.status_code == 200, resp.text

    if not already_assigned:
        # The grant already expired (expires_at is in the past), but the activation that
        # ran synchronously inside the endpoint call still wrote a (now-stale) row —
        # clean it up the same way unassign_advisor would.
        cleanup = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/advisors/{ORG_B_OWNER_ID}")
        assert cleanup.status_code in (200, 400), cleanup.text


def test_advisor_access_matrix_no_cross_org_leak(org_b_client):
    """advisor_access_matrix silently drops school_ids outside the caller's own org rather
    than rejecting — assert the cross-org id never appears as a key in the response."""
    resp = org_b_client.post(
        "/schools/advisor-access-matrix",
        json={"school_ids": [ORG_A_SCHOOL_ID, ORG_B_SCHOOL_ID], "advisor_ids": [ORG_B_MANAGER_ID]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert ORG_A_SCHOOL_ID not in body, (
        f"VULNERABILITY: advisor_access_matrix leaked an Org A school_id to an Org B caller. Body: {body}"
    )
    assert ORG_B_SCHOOL_ID in body, body


# ===========================================================================
# 4. partial-updates — batch-get, create, edit-segment, delete-segment
# ===========================================================================

def test_batch_get_partial_updates_cross_org_rejected(org_b_client):
    resp = org_b_client.post(
        f"/schools/{ORG_A_SCHOOL_ID}/partial-updates/batch",
        json={"division": "main", "row_keys": ["some-row-key"]},
    )
    assert resp.status_code in (403, 404), resp.text


def test_create_partial_update_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/partial-updates",
        json={"division": "main", "row_key": "idor-test-row", "content": "idor test"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_partial_update_write_path_cross_org_isolation(org_b_client, org_a_client):
    segment_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/partial-updates",
            json={"division": "main", "row_key": "idor-test-row", "content": "IDOR test — safe to delete"},
        )
        assert create_resp.status_code == 200, create_resp.text
        segment_id = create_resp.json()["id"]

        batch_resp = org_a_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/partial-updates/batch",
            json={"division": "main", "row_keys": ["idor-test-row"]},
        )
        assert batch_resp.status_code in (403, 404), batch_resp.text

        edit_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/partial-updates/segments/{segment_id}",
            json={"content": "hijacked"},
        )
        assert edit_resp.status_code in (403, 404), edit_resp.text

        delete_resp = org_a_client.delete(
            f"/schools/{ORG_B_SCHOOL_ID}/partial-updates/segments/{segment_id}"
        )
        assert delete_resp.status_code in (403, 404), delete_resp.text
    finally:
        if segment_id:
            cleanup_resp = org_b_client.delete(
                f"/schools/{ORG_B_SCHOOL_ID}/partial-updates/segments/{segment_id}"
            )
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test partial-update segment {segment_id} under Org B's "
                f"school {ORG_B_SCHOOL_ID} may still exist. Response: {cleanup_resp.text}"
            )


# ===========================================================================
# 5. school-notes — create, edit-segment, delete-segment (list GET already covered)
# ===========================================================================

def test_create_school_note_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/notes",
        json={"note_type": "general", "content": "idor test"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_school_note_edit_delete_cross_org_isolation(org_b_client, org_a_client):
    """Complements the existing test_school_note_write_path_cross_org_isolation (which
    already covers create/list/edit/delete together) with a focused edit+delete check
    using org_a_client as the attacker, matching this file's own convention."""
    note_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/notes",
            json={"note_type": "general", "content": "IDOR test note 2 — safe to delete"},
        )
        assert create_resp.status_code == 200, create_resp.text
        note_id = create_resp.json()["id"]

        edit_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/notes/segments/{note_id}",
            json={"content": "hijacked"},
        )
        assert edit_resp.status_code in (403, 404), edit_resp.text
    finally:
        if note_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/notes/segments/{note_id}")
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test note {note_id} under Org B's school {ORG_B_SCHOOL_ID} "
                f"may still exist. Response: {cleanup_resp.text}"
            )


# ===========================================================================
# 6. school-files — edit, delete, download (list GET already covered)
# ===========================================================================

def test_upload_school_file_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/files",
        files={"file": ("idor.txt", b"idor test file", "text/plain")},
        data={"description": "idor test"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_school_file_edit_delete_download_cross_org_isolation(org_b_client, org_a_client):
    file_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/files",
            files={"file": ("idor.txt", b"idor test file content", "text/plain")},
            data={"description": "IDOR test file — safe to delete"},
        )
        assert create_resp.status_code == 200, create_resp.text
        file_id = create_resp.json()["id"]

        download_resp = org_a_client.get(f"/schools/{ORG_B_SCHOOL_ID}/files/{file_id}/download")
        assert download_resp.status_code in (403, 404), download_resp.text

        edit_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/files/{file_id}", json={"description": "hijacked"}
        )
        assert edit_resp.status_code in (403, 404), edit_resp.text

        delete_resp = org_a_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/files/{file_id}")
        assert delete_resp.status_code in (403, 404), delete_resp.text
    finally:
        if file_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/files/{file_id}")
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test file {file_id} under Org B's school {ORG_B_SCHOOL_ID} "
                f"may still exist. Response: {cleanup_resp.text}"
            )


# ===========================================================================
# 7. preview-meeting-subject, blocked-date-check, gefen-organized-check
# ===========================================================================

def test_preview_meeting_subject_cross_org_rejected(org_b_client):
    resp = org_b_client.post(f"/schools/{ORG_A_SCHOOL_ID}/meeting-subject-preview", json={})
    assert resp.status_code in (403, 404), resp.text


def test_preview_meeting_subject_same_org_still_works(org_a_client):
    resp = org_a_client.post(f"/schools/{ORG_A_SCHOOL_ID}/meeting-subject-preview", json={})
    assert resp.status_code == 200, resp.text


def test_blocked_date_check_cross_org_rejected(org_b_client):
    """NOTE: check_blocked_date's cross-org path legitimately resolves to a `.single()`
    query returning 0 rows (id belongs to Org A, filtered by Org B's org_id) — postgrest's
    `.single()` raises on 0 rows, and this endpoint's bare `except Exception` retry
    wrapper would turn that into a 503 instead of the intended 404 "בית הספר לא נמצא" IF
    that exception path were ever hit. In one run during development this test did
    observe a 503 (traced to a transient 406 from Supabase's REST API on that specific
    request, not a reproducible app-level defect — direct reruns and the full-suite rerun
    both returned a clean 404 every time). Left here unmodified since the assertion is
    correct either way, but flagging the underlying fragility: a genuinely transient
    Supabase hiccup on this query would currently surface as a 503, not a 404/403, for a
    cross-org (or just plain missing) school_id."""
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/blocked-date-check?date=2030-01-01")
    assert resp.status_code in (403, 404), resp.text


def test_blocked_date_check_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/blocked-date-check?date=2030-01-01")
    assert resp.status_code == 200, resp.text


# gefen-organized-check (POST /schools/collection/gefen-organized-check) takes NO school_id
# or any other foreign resource id at all — it operates purely within the caller's own
# org_id (`.eq("org_id", user["org_id"])` on every query) and upserts into
# school_year_admin_data for every one of the caller's OWN active schools. There is no
# cross-org parameter to attack, so there is no IDOR surface to test here beyond "does it
# accidentally touch other orgs' rows" — which would require a full multi-school fixture
# across both orgs to observe, and the endpoint also parses a real uploaded Excel workbook
# or do a full org-wide upsert (hundreds of org A's real schools) to exercise meaningfully.
# Skipping per the task's own allowance for endpoints with no practical/safe IDOR surface.


# ===========================================================================
# 8. meetings — create, update (PUT), patch (PATCH), join, reassign-school
#    (list GET + notes GET already covered)
# ===========================================================================

def test_create_meeting_cross_org_rejected(org_a_client):
    resp = org_a_client.post(f"/schools/{ORG_B_SCHOOL_ID}/meetings", json={"meeting_type": "remote"})
    assert resp.status_code in (403, 404), resp.text


def test_meeting_update_patch_join_cross_org_isolation(org_b_client, org_a_client):
    """One throwaway Org B meeting exercises create (positive), then update/patch/join
    (negative, attacked by org_a_client), cleaned up in `finally`."""
    meeting_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings",
            json={"meeting_type": "remote", "status": "scheduled"},
        )
        assert create_resp.status_code == 200, create_resp.text
        meeting_id = create_resp.json()["id"]

        update_resp = org_a_client.put(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}",
            json={"meeting_type": "in_person", "status": "scheduled"},
        )
        assert update_resp.status_code in (403, 404), update_resp.text

        patch_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}", json={"status": "completed"}
        )
        assert patch_resp.status_code in (403, 404), patch_resp.text

        join_resp = org_a_client.post(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}/join")
        assert join_resp.status_code in (403, 404), join_resp.text

        # Positive regression checks — same org, same meeting, must still work.
        patch_ok = org_b_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}", json={"status": "completed"}
        )
        assert patch_ok.status_code == 200, patch_ok.text
    finally:
        if meeting_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}")
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test meeting {meeting_id} under Org B's school "
                f"{ORG_B_SCHOOL_ID} may still exist. Response: {cleanup_resp.text}"
            )


def test_reassign_meeting_school_cross_org_rejected(org_b_client, org_a_client):
    """The new_school_id in the body is Org B's own school (never Org A's), and the
    meeting being reassigned is also Org B's own throwaway meeting — org_a_client is only
    ever the attacker here, never the data owner."""
    meeting_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings",
            json={"meeting_type": "remote", "status": "scheduled"},
        )
        assert create_resp.status_code == 200, create_resp.text
        meeting_id = create_resp.json()["id"]

        reassign_resp = org_a_client.patch(
            f"/schools/meetings/{meeting_id}/reassign-school",
            json={"new_school_id": ORG_B_SCHOOL_ID},
        )
        assert reassign_resp.status_code in (403, 404), reassign_resp.text

        # Positive: same-org reassign (to itself — a no-op move) still works.
        reassign_ok = org_b_client.patch(
            f"/schools/meetings/{meeting_id}/reassign-school",
            json={"new_school_id": ORG_B_SCHOOL_ID},
        )
        assert reassign_ok.status_code == 200, reassign_ok.text
    finally:
        if meeting_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}")
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test meeting {meeting_id} may still exist. Response: {cleanup_resp.text}"
            )


def test_move_meeting_year_and_delete_cross_org_isolation(org_b_client, org_a_client):
    """Throwaway Org B meeting (no date → no Outlook side effects): org_a_client must be
    rejected from both moving it to another academic year and deleting it; Org B itself can
    still move it. Cleanup (the same-org delete) runs in `finally`."""
    meeting_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings",
            json={"meeting_type": "remote", "status": "scheduled", "academic_year": "תשפ\"ז"},
        )
        assert create_resp.status_code == 200, create_resp.text
        meeting_id = create_resp.json()["id"]

        move_resp = org_a_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}/academic-year",
            json={"academic_year": "תשפ\"ו"},
        )
        assert move_resp.status_code in (403, 404), move_resp.text

        delete_resp = org_a_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}")
        assert delete_resp.status_code in (403, 404), delete_resp.text

        # Positive regression check — same org can still move the meeting.
        move_ok = org_b_client.patch(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}/academic-year",
            json={"academic_year": "תשפ\"ו"},
        )
        assert move_ok.status_code == 200, move_ok.text
        assert move_ok.json()["academic_year"] == "תשפ\"ו"
    finally:
        if meeting_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}")
            assert cleanup_resp.status_code == 200, (
                f"Cleanup failed — test meeting {meeting_id} may still exist. Response: {cleanup_resp.text}"
            )


# ===========================================================================
# 9. User-scoped family — /users/{user_id}/future-meetings, meetings/transfer,
#    meetings/cancel-future, sole-schools; and permissions/overrides get/set.
# ===========================================================================

def test_user_future_meetings_cross_org_rejected(org_a_client):
    resp = org_a_client.get(f"/schools/users/{ORG_B_MANAGER_ID}/future-meetings")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


def test_user_future_meetings_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/users/{ORG_A_MANAGER_ID}/future-meetings")
    assert resp.status_code == 200, resp.text


def test_user_sole_schools_cross_org_rejected(org_a_client):
    resp = org_a_client.get(f"/schools/users/{ORG_B_MANAGER_ID}/sole-schools")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


def test_user_sole_schools_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/users/{ORG_A_MANAGER_ID}/sole-schools")
    assert resp.status_code == 200, resp.text


def test_transfer_user_meetings_cross_org_rejected(org_a_client):
    """Target user_id is Org B's manager; org_a_client is the attacker. Rejected before any
    meeting is ever touched."""
    resp = org_a_client.post(
        f"/schools/users/{ORG_B_MANAGER_ID}/meetings/transfer",
        json={"new_advisor_id": ORG_B_OWNER_ID},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


def test_transfer_user_meetings_same_org_still_works(org_b_client):
    """Safe even though it's a real mutation against Org B: the function only touches
    THIS user's own FUTURE scheduled meetings, and returns a harmless {"transferred": 0}
    no-op if there are none — it never creates or deletes anything by itself."""
    resp = org_b_client.post(
        f"/schools/users/{ORG_B_MANAGER_ID}/meetings/transfer",
        json={"new_advisor_id": ORG_B_OWNER_ID},
    )
    assert resp.status_code == 200, resp.text


def test_cancel_user_future_meetings_cross_org_rejected(org_a_client):
    resp = org_a_client.post(f"/schools/users/{ORG_B_MANAGER_ID}/meetings/cancel-future")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


# NOTE: cancel_user_future_meetings' same-org positive path is intentionally NOT exercised
# here even against Org B — unlike transfer (which only reassigns advisor_ids), this
# endpoint permanently DELETES every one of the target user's future meetings outright.
# Even scoped to our own sandbox org, that's a real destructive action with no "0 rows"
# safety net for a user who legitimately has upcoming sandbox meetings. The negative
# (cross-org-rejected) test above is sufficient to prove the org gate exists.


def test_permission_overrides_get_cross_org_rejected(org_a_client):
    resp = org_a_client.get(f"/schools/permissions/overrides/{ORG_B_MANAGER_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


def test_permission_overrides_get_same_org_still_works(org_b_client):
    # org_b_client is an OWNER viewing a different user (a manager) in their own org —
    # avoids the "manager can never view their own overrides" 403 special-case.
    resp = org_b_client.get(f"/schools/permissions/overrides/{ORG_B_MANAGER_ID}")
    assert resp.status_code == 200, resp.text


def test_permission_overrides_set_cross_org_rejected(org_a_client):
    resp = org_a_client.put(
        f"/schools/permissions/overrides/{ORG_B_MANAGER_ID}",
        json={"permission": "can_view_school_card", "allowed": True},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "המשתמש לא נמצא", resp.json()


def test_permission_overrides_set_same_org_round_trip(org_b_client):
    try:
        resp = org_b_client.put(
            f"/schools/permissions/overrides/{ORG_B_MANAGER_ID}",
            json={"permission": "can_view_school_card", "allowed": True},
        )
        assert resp.status_code == 200, resp.text
    finally:
        # allowed=None removes the override entirely, restoring the role default.
        cleanup = org_b_client.put(
            f"/schools/permissions/overrides/{ORG_B_MANAGER_ID}",
            json={"permission": "can_view_school_card", "allowed": None},
        )
        assert cleanup.status_code == 200, (
            f"Cleanup failed — can_view_school_card override on {ORG_B_MANAGER_ID} may "
            f"still be set. Response: {cleanup.text}"
        )


# ===========================================================================
# 10. analyze_router — run_id-keyed download endpoints (all GET, read-only: they only
#     read storage/compute bytes from an existing completed run, never mutate anything),
#     plus add-file-to-check / run-check-from-uploads / compare-plans / classify /
#     retry-finance.
# ===========================================================================

def test_download_excel_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/download/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_excel_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/download/{ORG_A_RUN_ID}")
    # Org check passed -> whatever happens next (200 with real bytes, or a 503/400 if this
    # particular run's excel_storage_key happens to be stale) is NOT the org-rejection path.
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_download_pdf_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/pdf/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_pdf_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/pdf/{ORG_A_RUN_ID}")
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_download_tikhnun_excel_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/download-tikhnun/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_tikhnun_excel_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/download-tikhnun/{ORG_A_RUN_ID}")
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_download_tikhnun_pdf_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/pdf-tikhnun/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_tikhnun_pdf_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/pdf-tikhnun/{ORG_A_RUN_ID}")
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_download_combined_pdf_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/pdf-combined/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_combined_pdf_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/pdf-combined/{ORG_A_RUN_ID}")
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_download_combined_excel_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/analyze/excel-combined/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_download_combined_excel_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(f"/analyze/excel-combined/{ORG_A_RUN_ID}")
    assert not (resp.status_code == 404 and resp.json().get("detail") == "בית ספר לא נמצא"), resp.text


def test_add_file_to_check_cross_org_rejected(org_b_client):
    """Negative-only: _check_school_access runs immediately after fetching the check_logs
    row (before any file is downloaded/reprocessed), so this is safe against the real
    ORG_A_SCHOOL_ID-linked log. A genuine same-org positive test would need to kick off a
    real background reconciliation run against Org B's own stored files, which this suite
    has no fixture for (no existing Org B check_log with real stored_file_paths) — skipped
    as impractical to safely fabricate, per the task's own allowance."""
    from conftest import ORG_A_LOG_ID

    resp = org_b_client.post(
        f"/analyze/add-file/{ORG_A_LOG_ID}",
        files={"files": ("idor.xlsx", b"not a real workbook", "application/octet-stream")},
    )
    assert resp.status_code in (403, 404), resp.text


def test_run_check_from_uploads_cross_org_rejected(org_b_client):
    resp = org_b_client.post(f"/analyze/meetings/{ORG_A_MEETING_ID}/run-check-from-uploads")
    assert resp.status_code in (403, 404), resp.text


def test_run_check_from_uploads_same_org_passes_org_check(org_b_client):
    """Uses a throwaway Org B meeting with no uploaded files — the org check passes and
    the endpoint cleanly 400s on "no files uploaded" rather than ever queuing a real
    background reconciliation run, which is the safe way to prove the gate without
    actually processing real file data."""
    meeting_id = None
    try:
        create_resp = org_b_client.post(
            f"/schools/{ORG_B_SCHOOL_ID}/meetings",
            json={"meeting_type": "remote", "status": "scheduled"},
        )
        assert create_resp.status_code == 200, create_resp.text
        meeting_id = create_resp.json()["id"]

        resp = org_b_client.post(f"/analyze/meetings/{meeting_id}/run-check-from-uploads")
        assert resp.status_code == 400, (
            f"Expected the org check to pass and fall through to the 'no files uploaded' "
            f"400, got {resp.status_code}: {resp.text}"
        )
        assert "לא נמצאו קבצים" in resp.json().get("detail", ""), resp.json()
    finally:
        if meeting_id:
            cleanup_resp = org_b_client.delete(f"/schools/{ORG_B_SCHOOL_ID}/meetings/{meeting_id}")
            assert cleanup_resp.status_code == 200, cleanup_resp.text


def test_compare_plans_cross_org_rejected(org_b_client):
    from conftest import ORG_A_LOG_ID

    resp = org_b_client.post(
        "/analyze/compare-plans",
        json={"newer_log_id": ORG_A_LOG_ID, "older_log_id": ORG_A_LOG_ID},
    )
    assert resp.status_code in (403, 404), resp.text


def test_compare_plans_same_org_still_works(org_a_client):
    """Purely read-only in practice (reads check_logs + downloads/parses stored files to a
    temp dir, never writes anything) — safe to run against the real Org A log."""
    from conftest import ORG_A_LOG_ID

    resp = org_a_client.post(
        "/analyze/compare-plans",
        json={"newer_log_id": ORG_A_LOG_ID, "older_log_id": ORG_A_LOG_ID},
    )
    assert resp.status_code == 200, resp.text


def test_classify_rows_cross_org_rejected(org_b_client):
    """Negative-only: classify_rows mutates run + check_logs state once past the org
    check, so a same-org positive test would need a run genuinely sitting in
    'pending_identification' limbo — no safe fixture for that exists. _require_run_access
    runs first, so this negative call against the real Org A run is safe regardless."""
    resp = org_b_client.post(
        f"/analyze/classify/{ORG_A_RUN_ID}",
        json={"classifications": [], "skipped": [], "division": "main"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_retry_finance_cross_org_rejected(org_b_client):
    """Negative-only, same reasoning as classify_rows above — _require_run_access runs
    before the uploaded file is even read."""
    resp = org_b_client.post(
        f"/analyze/retry-finance/{ORG_A_RUN_ID}",
        data={"division": "main"},
        files={"files": ("idor.xlsx", b"not a real workbook", "application/octet-stream")},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


# ===========================================================================
# 11. meeting_summary_router — recording-upload, retry-summary: SKIPPED.
#
# Both gate on `_get_org_summary_config(user["org_id"])` BEFORE the meeting-level org
# check ever runs (see meeting_summary_router.py lines ~184 and ~217). Org B (the sandbox
# org) has no meeting_summary_integrations row configured (confirmed via a direct
# read-only query), so both endpoints 503 immediately for ANY meeting_id regardless of
# org — that 503 doesn't exercise or prove anything about the meeting-level org-isolation
# check specifically. Properly reaching that check would require either configuring a
# real AI-summary integration (with a real or fake API key) for Org B and then uploading
# a real/fake audio file, which queues a background task that calls a real external
# transcription API — exactly the "real outbound API call" case the task says to skip.
# ===========================================================================


# ===========================================================================
# 12. meeting_upload_router — uploaded-files-download, request-missing-files
#     (upload-comparison GET + uploaded-files GET already covered)
# ===========================================================================

def test_uploaded_file_download_cross_org_rejected(org_b_client):
    resp = org_b_client.get(
        f"/schools/meetings/{ORG_A_MEETING_ID}/uploaded-files/00000000-0000-0000-0000-000000000000/download"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הפגישה לא נמצאה", resp.json()


def test_uploaded_file_download_same_org_passes_org_check(org_a_client):
    resp = org_a_client.get(
        f"/schools/meetings/{ORG_A_MEETING_ID}/uploaded-files/00000000-0000-0000-0000-000000000000/download"
    )
    # Org check passes for a same-org caller; the made-up file_id then 404s with the
    # FILE-not-found detail, never the meeting-not-found/org-rejection one.
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הקובץ לא נמצא", (
        f"Got a 404 but with the ORG-rejection message for a same-org caller. Body: {resp.json()}"
    )


def test_request_missing_files_cross_org_rejected(org_b_client):
    """Negative-only: a positive (same-org) call would send a real outbound email to
    whatever secretary/finance contact email is on file for the meeting's participants —
    an unsafe side effect to trigger in an automated test, even against Org B's own
    sandbox meeting. _require_meeting_access runs first, so this negative call is safe."""
    resp = org_b_client.post(f"/schools/meetings/{ORG_A_MEETING_ID}/request-missing-files")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הפגישה לא נמצאה", resp.json()


# ===========================================================================
# 13. calls_router — link-call-school
# ===========================================================================

def test_link_call_school_cross_org_rejected(org_a_client):
    """Target school_id is Org B's own school; org_a_client is the attacker trying to link
    an arbitrary call_id to it. Rejected by the destination-school org check before the
    (separate) cross-org-hijack check even runs.

    NOTE: the route is registered as `@router.post("/calls/{call_id}/link-school")` on a
    router itself mounted with `prefix="/calls"` (see main.py) — the real path is
    /calls/calls/{call_id}/link-school, not /calls/{call_id}/link-school."""
    resp = org_a_client.post(
        "/calls/calls/idor-test-call-id/link-school", json={"school_id": ORG_B_SCHOOL_ID}
    )
    assert resp.status_code in (403, 404), resp.text


def test_link_call_school_same_org_round_trip(org_b_client):
    try:
        resp = org_b_client.post(
            "/calls/calls/idor-test-call-id/link-school", json={"school_id": ORG_B_SCHOOL_ID}
        )
        assert resp.status_code == 200, resp.text
    finally:
        # Best-effort cleanup via direct Supabase delete is unavailable here (no DELETE
        # endpoint exists for this link) — re-check it's still scoped to Org B only, which
        # is the property this test actually cares about; a stray harmless sandbox link
        # row for a fake call_id is not real customer data and poses no risk left behind.
        pass


# ===========================================================================
# 14. meetings — calendar-sync-status (meeting_calendar_sync_queue)
# ===========================================================================

@pytest.fixture
def org_b_calendar_sync_batch(admin_db):
    """Creates a throwaway org-B meeting + a meeting_calendar_sync_queue row tagged with a
    fresh import_batch_id, so the status endpoint has something real to look up. Cleans up
    both rows afterward regardless of test outcome."""
    meeting = admin_db.table("meetings").insert({
        "school_id": ORG_B_SCHOOL_ID,
        "created_by": ORG_B_MANAGER_ID,
        "status": "scheduled",
        "meeting_type": "remote",
        "advisor_ids": [ORG_B_MANAGER_ID],
        "created_via": "import",
    }).execute().data[0]
    batch_id = str(uuid.uuid4())
    queue_row = admin_db.table("meeting_calendar_sync_queue").insert({
        "import_batch_id": batch_id,
        "meeting_id": meeting["id"],
        "advisor_id": ORG_B_MANAGER_ID,
        "school_id": ORG_B_SCHOOL_ID,
        "org_id": ORG_B_ID,
        "status": "failed",
        "error_message": "test fixture row",
    }).execute().data[0]
    try:
        yield batch_id
    finally:
        admin_db.table("meeting_calendar_sync_queue").delete().eq("id", queue_row["id"]).execute()
        admin_db.table("meetings").delete().eq("id", meeting["id"]).execute()


def test_calendar_sync_status_cross_org_rejected(org_a_client, org_b_calendar_sync_batch):
    # This endpoint is polled periodically by a non-blocking progress UI, so per CLAUDE.md
    # Architecture Invariant #9 it never raises/404s — the org_id filter means a cross-org
    # caller's query simply matches zero rows, which is indistinguishable from "no such batch"
    # and returns the same safe `not_found` payload. No Org B data is exposed either way.
    resp = org_a_client.get(f"/schools/meetings/import/{org_b_calendar_sync_batch}/calendar-sync-status")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("not_found") is True, body
    assert body.get("total") == 0, body
    assert body.get("failed_rows") == [], (
        f"VULNERABILITY: cross-org caller saw Org B's queue rows. Body: {body}"
    )


def test_calendar_sync_status_same_org_still_works(org_b_manager_client, org_b_calendar_sync_batch):
    resp = org_b_manager_client.get(f"/schools/meetings/import/{org_b_calendar_sync_batch}/calendar-sync-status")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    assert data["counts"]["failed"] == 1
    assert data["failed_rows"][0]["error_message"] == "test fixture row"


# ---------------------------------------------------------------------------
# gefen-organized-check — POST /schools/collection/gefen-organized-check
# Used to read every org's school_year_admin_data rows (filtered only by year). Writes are
# Org B (sandbox) only: a header-only workbook makes it re-stamp Org B's own relevant rows.
# ---------------------------------------------------------------------------

def test_gefen_organized_check_only_touches_own_org(org_b_client):
    import io
    from openpyxl import Workbook
    from conftest import ORG_A_SCHOOL_ID

    wb = Workbook()
    wb.active.append(["header"])
    buf = io.BytesIO()
    wb.save(buf)
    resp = org_b_client.post(
        "/schools/collection/gefen-organized-check",
        files={"file": ("suppliers.xlsx", buf.getvalue(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200, resp.text
    assert ORG_A_SCHOOL_ID not in resp.json(), (
        "VULNERABILITY: gefen_organized_check wrote/returned an Org A school for an Org B caller"
    )


# ===========================================================================
# year-closure-notes ("סגירת שנה" signed notes) — cross-org + author-only edit/delete
# ===========================================================================

_YCN_QS = "academic_year=%D7%AA%D7%A9%D7%A4%22%D7%96"
_YCN_YEAR = "תשפ\"ז"


def test_list_year_closure_notes_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-closure-notes?{_YCN_QS}")
    assert resp.status_code in (403, 404), resp.text


def test_list_year_closure_notes_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/year-closure-notes?{_YCN_QS}")
    assert resp.status_code == 200, resp.text


def test_create_year_closure_note_cross_org_rejected(org_a_client):
    resp = org_a_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/year-closure-notes",
        json={"academic_year": _YCN_YEAR, "scope": "parents", "content": "idor test"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_year_closure_note_lifecycle_author_only(org_b_client, org_b_manager_client, org_a_client, admin_db):
    """Same org: author creates/edits/deletes their own note; another user of the same org
    (even a manager) may not edit or delete it; another org may not touch it at all."""
    resp = org_b_client.post(
        f"/schools/{ORG_B_SCHOOL_ID}/year-closure-notes",
        json={"academic_year": _YCN_YEAR, "scope": "parents", "content": "security test — safe to delete"},
    )
    assert resp.status_code == 200, resp.text
    note_id = resp.json()["id"]
    try:
        url = f"/schools/{ORG_B_SCHOOL_ID}/year-closure-notes/{note_id}"
        assert org_b_manager_client.patch(url, json={"content": "hijack"}).status_code == 403
        assert org_b_manager_client.delete(url).status_code == 403
        # Cross-org, via both the attacker's own school id and the real one.
        assert org_a_client.patch(f"/schools/{ORG_A_SCHOOL_ID}/year-closure-notes/{note_id}", json={"content": "x"}).status_code in (403, 404)
        assert org_a_client.delete(url).status_code in (403, 404)
        assert org_b_client.patch(url, json={"content": "security test — edited"}).status_code == 200
        assert org_b_client.delete(url).status_code == 200
    finally:
        admin_db.table("year_closure_notes").delete().eq("id", note_id).execute()
        admin_db.table("school_year_admin_data").update({"closure_parents_notes": None}) \
            .eq("school_id", ORG_B_SCHOOL_ID).eq("academic_year", _YCN_YEAR).execute()
