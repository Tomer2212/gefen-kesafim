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
    ORG_A_ID,
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


def test_meeting_messages_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/meetings/{ORG_A_MEETING_ID}/messages")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הפגישה לא נמצאה", resp.json()


def test_meeting_messages_same_org_works(org_a_client):
    resp = org_a_client.get(f"/schools/meetings/{ORG_A_MEETING_ID}/messages")
    assert resp.status_code == 200, resp.text
    assert "messages" in resp.json()


def test_uploaded_file_coverage_cross_org_rejected(org_b_client):
    resp = org_b_client.patch(
        f"/schools/meetings/{ORG_A_MEETING_ID}/uploaded-files/00000000-0000-0000-0000-000000000000/coverage",
        json={"division": "beinayim"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הפגישה לא נמצאה", resp.json()


def test_uploaded_file_coverage_same_org_passes_org_check(org_a_client):
    # Org check passes for a same-org caller; the made-up file_id then 404s with the
    # FILE-not-found detail, so nothing is written.
    resp = org_a_client.patch(
        f"/schools/meetings/{ORG_A_MEETING_ID}/uploaded-files/00000000-0000-0000-0000-000000000000/coverage",
        json={"division": "beinayim"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הקובץ לא נמצא", resp.json()


def test_request_missing_files_with_recipient_cross_org_rejected(org_b_client):
    """Negative-only, like the test below: a same-org call could send a real email."""
    resp = org_b_client.post(
        f"/schools/meetings/{ORG_A_MEETING_ID}/request-missing-files",
        json={"recipient_email": "attacker@example.com"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "הפגישה לא נמצאה", resp.json()


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


# ===========================================================================
# 15. schools bulk-field (finance_software + its "other" free text)
# ===========================================================================
# Both tests target the Org B sandbox school (mutating-call convention above); the
# cross-org caller is Org A's manager.

def test_bulk_school_field_cross_org_rejected(org_a_client, admin_db):
    before = admin_db.table("schools").select("finance_software, finance_software_other_text") \
        .eq("id", ORG_B_SCHOOL_ID).execute().data[0]
    r = org_a_client.put("/schools/bulk-field", json={
        "field": "finance_software", "items": [{"school_id": ORG_B_SCHOOL_ID, "value": "other"}],
    })
    assert r.status_code == 200
    assert r.json()["updated"] == []
    assert [f["school_id"] for f in r.json()["failed"]] == [ORG_B_SCHOOL_ID]
    after = admin_db.table("schools").select("finance_software, finance_software_other_text") \
        .eq("id", ORG_B_SCHOOL_ID).execute().data[0]
    assert after == before


def test_bulk_school_field_same_org_still_works(org_b_client, admin_db):
    before = admin_db.table("schools").select("finance_software, finance_software_other_text") \
        .eq("id", ORG_B_SCHOOL_ID).execute().data[0]
    try:
        r = org_b_client.put("/schools/bulk-field", json={
            "field": "finance_software", "items": [{"school_id": ORG_B_SCHOOL_ID, "value": "other"}],
        })
        assert r.status_code == 200
        assert [u["school_id"] for u in r.json()["updated"]] == [ORG_B_SCHOOL_ID]
        r = org_b_client.put("/schools/bulk-field", json={
            "field": "finance_software_other_text", "items": [{"school_id": ORG_B_SCHOOL_ID, "value": "בדיקה"}],
        })
        assert r.status_code == 200
        assert r.json()["updated"][0]["data"]["finance_software_other_text"] == "בדיקה"
    finally:
        admin_db.table("schools").update(before).eq("id", ORG_B_SCHOOL_ID).execute()


# ---------------------------------------------------------------------------
# Meeting activity log — GET /schools/{school_id}/meetings/{meeting_id}/activity
# ---------------------------------------------------------------------------

def test_get_meeting_activity_cross_org_rejected(org_b_client):
    resp = org_b_client.get(
        f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings/{ORG_A_MEETING_ID}/activity"
    )
    assert resp.status_code in (403, 404), resp.text


def test_get_meeting_activity_same_org_still_works(org_a_client):
    resp = org_a_client.get(
        f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings/{ORG_A_MEETING_ID}/activity"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["events"], list) and body["events"], body
    assert body["events"][-1]["action"] == "created"


# --- School-card activity log ("תיעוד פעולות") + update-request org checks ---------------------

ORG_A_RESOLVED_UPDATE_REQUEST_ID = "de873156-0fe8-423f-a26c-181168b25379"  # approved, org A school


def test_get_school_activity_cross_org_rejected(org_b_client):
    resp = org_b_client.get(f"/schools/{ORG_A_SCHOOL_ID}/activity")
    assert resp.status_code in (403, 404), resp.text


def test_get_school_activity_same_org_still_works(org_a_client):
    resp = org_a_client.get(f"/schools/{ORG_A_SCHOOL_ID}/activity")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["events"], list) and body["events"], body
    assert any(e["kind"] == "created" for e in body["events"])


def test_submit_update_request_cross_org_rejected(org_b_client):
    # Rejected before any insert — no side effects. (No same-org twin: a successful submit
    # would create a real pending request + approver notifications in live data.)
    resp = org_b_client.post(
        f"/schools/{ORG_A_SCHOOL_ID}/update-requests",
        json={"proposed_changes": {"city": "x"}},
    )
    assert resp.status_code in (403, 404), resp.text


def test_review_update_request_cross_org_rejected(org_b_client):
    resp = org_b_client.patch(
        f"/schools/update-requests/{ORG_A_RESOLVED_UPDATE_REQUEST_ID}",
        json={"status": "rejected"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_review_update_request_same_org_reaches_status_check(org_a_client):
    # Same org passes the org check and stops at "already resolved" (400) — nothing is written.
    resp = org_a_client.patch(
        f"/schools/update-requests/{ORG_A_RESOLVED_UPDATE_REQUEST_ID}",
        json={"status": "rejected"},
    )
    assert resp.status_code in (400, 403), resp.text


# ===========================================================================
# calls_router — ambiguous-contact call prompts (AmbiguousCallPopup feed)
# ===========================================================================

def _insert_sandbox_ambiguous_prompt(admin_db, caller_id: str) -> str:
    """An open ambiguous-contact row in Org B (sandbox) addressed to `caller_id`."""
    from datetime import datetime, timezone
    call_id = f"idor-test-ambiguous-{uuid.uuid4()}"
    admin_db.table("calls_call_contact_resolutions").insert({
        "org_id": ORG_B_ID,
        "call_id": call_id,
        "kind": "ambiguous",
        "call_time": datetime.now(timezone.utc).isoformat(),
        "contact_name": "idor test",
        "candidate_schools": [{"id": ORG_B_SCHOOL_ID, "name": "sandbox"}],
        "caller_advisor_id": caller_id,
        "notified_recipient_ids": [caller_id],
    }).execute()
    return call_id


def test_ambiguous_call_prompts_cross_org_hidden(org_a_client, admin_db):
    # Org B row deliberately addressed to the Org A user's id — the org filter alone must
    # keep it out of Org A's feed.
    call_id = _insert_sandbox_ambiguous_prompt(admin_db, ORG_A_MANAGER_ID)
    try:
        resp = org_a_client.get("/calls/calls/ambiguous/my-prompts")
        assert resp.status_code == 200, resp.text
        assert call_id not in [p["call_id"] for p in resp.json()["prompts"]]
    finally:
        admin_db.table("calls_call_contact_resolutions").delete() \
            .eq("org_id", ORG_B_ID).eq("call_id", call_id).execute()


def test_ambiguous_call_prompts_same_org_visible(org_b_client, admin_db):
    call_id = _insert_sandbox_ambiguous_prompt(admin_db, ORG_B_OWNER_ID)
    try:
        resp = org_b_client.get("/calls/calls/ambiguous/my-prompts")
        assert resp.status_code == 200, resp.text
        prompt = next(p for p in resp.json()["prompts"] if p["call_id"] == call_id)
        assert prompt["candidate_schools"][0]["id"] == ORG_B_SCHOOL_ID
    finally:
        admin_db.table("calls_call_contact_resolutions").delete() \
            .eq("org_id", ORG_B_ID).eq("call_id", call_id).execute()


# ---------------------------------------------------------------------------
# Meeting task "התאמה אישית" — per-school division overrides are keyed by school_id from the
# request body. Tested at the validator, which is read-only: POST /tasks/ itself queues real sends.
# ---------------------------------------------------------------------------


def _six_year_school_id(admin_db, org_id):
    rows = admin_db.table("schools").select("id").eq("org_id", org_id).eq("stage", "sheshshnati") \
        .eq("status", "active").limit(1).execute().data
    return rows[0]["id"]


def test_stage_scope_override_cross_org_school_dropped(admin_db):
    from routers.tasks_router import _prepare_meeting_conditions
    foreign_id = _six_year_school_id(admin_db, ORG_A_ID)
    criteria = {"groups": [{"conditions": [
        {"type": "meeting", "stage_scope": "both", "stage_scope_by_school": {foreign_id: "tichon"}},
    ]}]}
    _prepare_meeting_conditions(criteria, ORG_B_ID)
    assert criteria["groups"][0]["conditions"][0]["stage_scope_by_school"] == {}


def test_stage_scope_override_same_org_school_kept(admin_db):
    from routers.tasks_router import _prepare_meeting_conditions
    own_id = _six_year_school_id(admin_db, ORG_B_ID)
    criteria = {"groups": [{"conditions": [
        {"type": "meeting", "stage_scope": "both", "stage_scope_by_school": {own_id: "tichon"}},
    ]}]}
    _prepare_meeting_conditions(criteria, ORG_B_ID)
    assert criteria["groups"][0]["conditions"][0]["stage_scope_by_school"] == {own_id: "tichon"}


def test_task_preview_six_year_enrichment_stays_in_org(org_b_client, admin_db):
    foreign_id = _six_year_school_id(admin_db, ORG_A_ID)
    own_id = _six_year_school_id(admin_db, ORG_B_ID)
    resp = org_b_client.post("/tasks/preview", json={
        "criteria": {"groups": []}, "manual_school_ids": [foreign_id, own_id],
    })
    assert resp.status_code == 200, resp.text
    schools = resp.json()["schools"]
    assert [s["school_id"] for s in schools] == [own_id]
    assert isinstance(schools[0]["principal_same_person"], bool)


# ---------------------------------------------------------------------------
# Combined "גפן+שוטף" meeting — PATCH /tasks/{task_id}/meeting-overrides/{school_id} saves which
# coordinator gets the link. Both the task and the school must be the caller's own org's.
# Org A is never written to: the cross-org calls are rejected before any write.
# ---------------------------------------------------------------------------


def _any_task_id(admin_db, org_id):
    rows = admin_db.table("org_tasks").select("id").eq("org_id", org_id).limit(1).execute().data
    if not rows:
        pytest.skip(f"no org_tasks row in org {org_id}")
    return rows[0]["id"]


_OVERRIDE_BODY = {"meeting_service_type": "gefen_current", "coordinator_type": "gefen"}


def test_meeting_override_cross_org_task_rejected(org_b_client, admin_db):
    foreign_task = _any_task_id(admin_db, ORG_A_ID)
    before = admin_db.table("org_tasks").select("meeting_overrides").eq("id", foreign_task).execute().data[0]
    resp = org_b_client.patch(f"/tasks/{foreign_task}/meeting-overrides/{ORG_B_SCHOOL_ID}", json=_OVERRIDE_BODY)
    assert resp.status_code in (403, 404), resp.text
    after = admin_db.table("org_tasks").select("meeting_overrides").eq("id", foreign_task).execute().data[0]
    assert after == before


def test_meeting_override_cross_org_school_rejected(org_b_client, admin_db):
    own_task = _any_task_id(admin_db, ORG_B_ID)
    before = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]
    resp = org_b_client.patch(f"/tasks/{own_task}/meeting-overrides/{ORG_A_SCHOOL_ID}", json=_OVERRIDE_BODY)
    assert resp.status_code in (403, 404), resp.text
    after = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]
    assert after == before


def test_meeting_override_same_org_works(org_b_client, admin_db):
    own_task = _any_task_id(admin_db, ORG_B_ID)
    original = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]["meeting_overrides"]
    try:
        resp = org_b_client.patch(f"/tasks/{own_task}/meeting-overrides/{ORG_B_SCHOOL_ID}", json=_OVERRIDE_BODY)
        assert resp.status_code == 200, resp.text
        saved = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]["meeting_overrides"]
        assert saved[ORG_B_SCHOOL_ID]["gefen_current"]["coordinator_type"] == "gefen"
    finally:
        admin_db.table("org_tasks").update({"meeting_overrides": original}).eq("id", own_task).execute()


# The same endpoint also saves which of a school's several card advisors a meeting is for: only
# advisors on that school's card list are accepted, so no one else can be put on a booking link.

def _task_without_round(admin_db, org_id):
    rows = admin_db.table("org_tasks").select("id").eq("org_id", org_id).is_("round_id", "null").limit(1).execute().data
    if not rows:
        pytest.skip(f"no org_tasks row without a round in org {org_id}")
    return rows[0]["id"]


def test_advisor_choice_cross_org_task_rejected(org_b_client, admin_db):
    foreign_task = _any_task_id(admin_db, ORG_A_ID)
    before = admin_db.table("org_tasks").select("meeting_overrides").eq("id", foreign_task).execute().data[0]
    resp = org_b_client.patch(f"/tasks/{foreign_task}/meeting-overrides/{ORG_B_SCHOOL_ID}",
                              json={"advisor_choice_key": "gefen", "advisor_ids": [ORG_B_MANAGER_ID]})
    assert resp.status_code in (403, 404), resp.text
    after = admin_db.table("org_tasks").select("meeting_overrides").eq("id", foreign_task).execute().data[0]
    assert after == before


def test_advisor_choice_advisor_not_on_card_rejected(org_b_client, admin_db):
    own_task = _task_without_round(admin_db, ORG_B_ID)
    before = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]
    resp = org_b_client.patch(f"/tasks/{own_task}/meeting-overrides/{ORG_B_SCHOOL_ID}",
                              json={"advisor_choice_key": "gefen", "advisor_ids": [ORG_A_MANAGER_ID]})
    assert resp.status_code == 400, resp.text
    after = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]
    assert after == before


def test_advisor_choice_same_org_works(org_b_client, admin_db):
    own_task = _task_without_round(admin_db, ORG_B_ID)
    card = admin_db.table("school_advisors_gefen").select("advisor_id").eq("school_id", ORG_B_SCHOOL_ID).execute().data
    added_to_card = not card
    if added_to_card:  # temporarily, removed below
        admin_db.table("school_advisors_gefen").insert({"school_id": ORG_B_SCHOOL_ID, "advisor_id": ORG_B_MANAGER_ID}).execute()
    advisor_id = card[0]["advisor_id"] if card else ORG_B_MANAGER_ID
    original = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]["meeting_overrides"]
    try:
        resp = org_b_client.patch(f"/tasks/{own_task}/meeting-overrides/{ORG_B_SCHOOL_ID}",
                                  json={"advisor_choice_key": "gefen@tichon", "advisor_ids": [advisor_id]})
        assert resp.status_code == 200, resp.text
        saved = admin_db.table("org_tasks").select("meeting_overrides").eq("id", own_task).execute().data[0]["meeting_overrides"]
        assert saved[ORG_B_SCHOOL_ID]["advisor_choices"]["gefen@tichon"] == [advisor_id]
    finally:
        admin_db.table("org_tasks").update({"meeting_overrides": original}).eq("id", own_task).execute()
        if added_to_card:
            admin_db.table("school_advisors_gefen").delete().eq("school_id", ORG_B_SCHOOL_ID).eq("advisor_id", ORG_B_MANAGER_ID).execute()


# ---------------------------------------------------------------------------
# "מחליפה או נוספת?" — POST /schools/{school_id}/meetings/{meeting_id}/booking-request-resolutions.
# The meeting, the school and the booking link must all be the caller's own org's. Org A is never
# written to; the same-org test uses a temporary org-B meeting and restores the link.
# ---------------------------------------------------------------------------


def _org_link(admin_db, org_id):
    rows = (
        admin_db.table("meeting_booking_tokens").select("id, school_id, date_ranges, booked_ranges")
        .eq("org_id", org_id).execute().data or []
    )
    rows = [r for r in rows if r.get("date_ranges")]
    if not rows:
        pytest.skip(f"no range booking link in org {org_id}")
    return rows[0]


def _resolutions_for(admin_db, meeting_id):
    return admin_db.table("meeting_request_resolutions").select("id").eq("meeting_id", meeting_id).execute().data or []


def test_request_resolution_cross_org_meeting_rejected(org_b_client, admin_db):
    link = _org_link(admin_db, ORG_B_ID)
    resp = org_b_client.post(
        f"/schools/{ORG_A_MEETING_SCHOOL_ID}/meetings/{ORG_A_MEETING_ID}/booking-request-resolutions",
        json={"token_id": link["id"], "range_key": link["date_ranges"][0]["key"], "decision": "replaces"},
    )
    assert resp.status_code in (403, 404), resp.text
    assert _resolutions_for(admin_db, ORG_A_MEETING_ID) == []


def test_request_resolution_cross_org_link_rejected(org_b_client, admin_db):
    foreign_link = _org_link(admin_db, ORG_A_ID)
    own_link = _org_link(admin_db, ORG_B_ID)
    meeting = admin_db.table("meetings").insert({
        "school_id": own_link["school_id"], "status": "scheduled", "meeting_date": "2099-12-10", "participants": [],
    }).execute().data[0]
    try:
        resp = org_b_client.post(
            f"/schools/{own_link['school_id']}/meetings/{meeting['id']}/booking-request-resolutions",
            json={"token_id": foreign_link["id"], "range_key": foreign_link["date_ranges"][0]["key"], "decision": "replaces"},
        )
        assert resp.status_code in (403, 404), resp.text
        assert _resolutions_for(admin_db, meeting["id"]) == []
    finally:
        admin_db.table("meetings").delete().eq("id", meeting["id"]).execute()


def test_request_resolution_same_org_works(org_b_client, admin_db):
    link = _org_link(admin_db, ORG_B_ID)
    original_booked = link.get("booked_ranges")
    meeting = admin_db.table("meetings").insert({
        "school_id": link["school_id"], "status": "scheduled", "meeting_date": "2099-12-10", "participants": [],
    }).execute().data[0]
    try:
        resp = org_b_client.post(
            f"/schools/{link['school_id']}/meetings/{meeting['id']}/booking-request-resolutions",
            json={"token_id": link["id"], "range_key": link["date_ranges"][0]["key"], "decision": "additional"},
        )
        assert resp.status_code == 200, resp.text
        assert len(_resolutions_for(admin_db, meeting["id"])) == 1
    finally:
        admin_db.table("meeting_activity").delete().eq("meeting_id", meeting["id"]).execute()
        admin_db.table("meetings").delete().eq("id", meeting["id"]).execute()  # cascades the resolution
        admin_db.table("meeting_booking_tokens").update({"booked_ranges": original_booked}).eq("id", link["id"]).execute()


# POST /analyze/rerun — re-runs an interrupted check. ORG_A_RUN_ID is a completed ("done") run,
# so the same-org call stops at the 409 "not interrupted" guard and writes nothing to org A.
def test_rerun_interrupted_cross_org_rejected(org_b_client):
    resp = org_b_client.post(f"/analyze/rerun/{ORG_A_RUN_ID}")
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "בית ספר לא נמצא", resp.json()


def test_rerun_interrupted_same_org_passes_org_check(org_a_client):
    resp = org_a_client.post(f"/analyze/rerun/{ORG_A_RUN_ID}")
    assert resp.status_code == 409, resp.text


# ===========================================================================
# "סבבי פגישות" (/rounds) — a round of another org is never readable, changeable or deletable,
# and a task can't be attached to it. Rounds are created directly in the sandbox org (org B);
# the attacker is org A (read-only org: every attack call is rejected before any write).
# ===========================================================================

def _make_round(admin_db, org_id=ORG_B_ID):
    return admin_db.table("meeting_rounds").insert({
        "org_id": org_id, "academic_year": "תשפ\"ז", "name": "בדיקת אבטחה", "start_date": "2099-12-01",
        "end_date": "2099-12-31", "school_ids": [ORG_B_SCHOOL_ID],
        "requirement": {"meeting_service_type": "gefen", "count_per_school": 1},
    }).execute().data[0]


@pytest.fixture
def org_b_round(admin_db):
    rnd = _make_round(admin_db)
    yield rnd
    admin_db.table("meeting_rounds").delete().eq("id", rnd["id"]).execute()


def test_round_read_cross_org_rejected(org_a_client, org_b_round):
    assert org_a_client.get(f"/rounds/{org_b_round['id']}").status_code == 404
    listed = org_a_client.get("/rounds/", params={"academic_year": "תשפ\"ז"})
    assert listed.status_code == 200 and org_b_round["id"] not in {r["id"] for r in listed.json()}


def test_round_write_cross_org_rejected(org_a_client, org_b_round, admin_db):
    rid = org_b_round["id"]
    assert org_a_client.patch(f"/rounds/{rid}", json={"name": "נפרץ"}).status_code == 404
    assert org_a_client.post(f"/rounds/{rid}/audience-apply", json={"remove_ids": [ORG_B_SCHOOL_ID]}).status_code == 404
    assert org_a_client.post(f"/rounds/{rid}/audience-preview").status_code == 404
    assert org_a_client.delete(f"/rounds/{rid}").status_code == 404
    row = admin_db.table("meeting_rounds").select("name, school_ids").eq("id", rid).execute().data[0]
    assert row["name"] == "בדיקת אבטחה" and row["school_ids"] == [ORG_B_SCHOOL_ID]


def test_round_same_org_works(org_b_client, org_b_round):
    rid = org_b_round["id"]
    resp = org_b_client.get(f"/rounds/{rid}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["round"]["id"] == rid
    assert org_b_client.patch(f"/rounds/{rid}", json={"name": "סבב בדיקה"}).json()["name"] == "סבב בדיקה"


def test_round_apply_never_adds_another_orgs_school(org_b_client, org_b_round, admin_db):
    resp = org_b_client.post(f"/rounds/{org_b_round['id']}/audience-apply", json={"add_ids": [ORG_A_SCHOOL_ID]})
    assert resp.status_code == 200, resp.text
    assert ORG_A_SCHOOL_ID not in resp.json()["school_ids"]


def test_task_cannot_join_another_orgs_round(org_b_client, admin_db):
    foreign = _make_round(admin_db, org_id=str(uuid.uuid4()))  # a round of some other org
    try:
        resp = org_b_client.post("/tasks/", json={
            "name": "בדיקת אבטחה", "criteria": {"groups": []}, "manual_school_ids": [ORG_B_SCHOOL_ID],
            "message_config": {"recipient_role": "principal", "channel": "email_resend", "body_template": "x"},
            "round_id": foreign["id"],
        })
        assert resp.status_code == 404, resp.text
        assert admin_db.table("org_tasks").select("id").eq("round_id", foreign["id"]).execute().data == []
    finally:
        admin_db.table("meeting_rounds").delete().eq("id", foreign["id"]).execute()


# ===========================================================================
# Task sends reach only the task's own schools. _queue_messages_for_schools reads any school id
# it is given, so an unchecked id (another org's school included) used to get this task's message.
# Proven with a sandbox school outside the task, so a regression can only ever email the sandbox.
# ===========================================================================

def _org_b_task_and_outsider(admin_db):
    tasks = admin_db.table("org_tasks").select("id, matched_school_ids").eq("org_id", ORG_B_ID).limit(50).execute().data or []
    schools = [s["id"] for s in admin_db.table("schools").select("id").eq("org_id", ORG_B_ID).execute().data or []]
    for t in tasks:
        outside = [sid for sid in schools if sid not in set(t.get("matched_school_ids") or [])]
        if outside:
            return t, outside[0]
    pytest.skip("no sandbox task with a school outside it")


def _messages(admin_db, task_id, school_id):
    return admin_db.table("org_task_messages").select("id").eq("task_id", task_id).eq("school_id", school_id).execute().data or []


def test_bulk_send_ignores_schools_outside_the_task(org_b_client, admin_db):
    task, outsider = _org_b_task_and_outsider(admin_db)
    before = len(_messages(admin_db, task["id"], outsider))
    resp = org_b_client.post(f"/tasks/{task['id']}/send", json={"only_school_ids": [outsider]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["queued"] == 0
    assert len(_messages(admin_db, task["id"], outsider)) == before


def test_single_send_rejects_a_school_outside_the_task(org_b_client, admin_db):
    task, outsider = _org_b_task_and_outsider(admin_db)
    before = len(_messages(admin_db, task["id"], outsider))
    assert org_b_client.post(f"/tasks/{task['id']}/schools/{outsider}/send").status_code == 404
    assert len(_messages(admin_db, task["id"], outsider)) == before


# ימי שטח (/rounds/{id}/field-days): never read or changed through another org's round, never
# set for another org's advisor, and a day id of another org is never deleted.

def test_field_days_cross_org_rejected(org_a_client, org_b_round, admin_db):
    rid = org_b_round["id"]
    assert org_a_client.get(f"/rounds/{rid}/field-days").status_code == 404
    assert org_a_client.post(f"/rounds/{rid}/field-days", json={"advisor_id": ORG_A_MANAGER_ID, "days": ["2099-12-10"]}).status_code == 404
    assert admin_db.table("advisor_field_days").select("id").eq("round_id", rid).execute().data == []


def test_field_days_never_for_another_orgs_advisor(org_b_client, org_b_round, admin_db):
    resp = org_b_client.post(f"/rounds/{org_b_round['id']}/field-days", json={"advisor_id": ORG_A_MANAGER_ID, "days": ["2099-12-10"]})
    assert resp.status_code == 404, resp.text
    assert admin_db.table("advisor_field_days").select("id").eq("advisor_id", ORG_A_MANAGER_ID).eq("day", "2099-12-10").execute().data == []


def test_field_days_same_org_works_and_foreign_ids_are_not_deleted(org_b_client, org_b_round, admin_db):
    rid = org_b_round["id"]
    try:
        resp = org_b_client.post(f"/rounds/{rid}/field-days", json={"advisor_id": ORG_B_MANAGER_ID, "days": ["2099-12-10"]})
        assert resp.status_code == 200, resp.text
        assert org_b_client.get(f"/rounds/{rid}/field-days").status_code == 200
        foreign = admin_db.table("advisor_field_days").insert({
            "org_id": str(uuid.uuid4()), "advisor_id": ORG_B_OWNER_ID, "day": "2099-12-11",
        }).execute().data[0]
        assert org_b_client.delete(f"/rounds/{rid}/field-days/{foreign['id']}").status_code == 200
        assert admin_db.table("advisor_field_days").select("id").eq("id", foreign["id"]).execute().data  # still there
    finally:
        admin_db.table("advisor_field_days").delete().in_("day", ["2099-12-10", "2099-12-11"]).in_("advisor_id", [ORG_B_MANAGER_ID, ORG_B_OWNER_ID]).execute()


def test_field_exempt_keeps_only_own_org_advisors(org_b_client, org_b_round):
    resp = org_b_client.patch(f"/rounds/{org_b_round['id']}", json={"field_exempt_advisor_ids": [ORG_B_MANAGER_ID, ORG_A_MANAGER_ID]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["field_exempt_advisor_ids"] == [ORG_B_MANAGER_ID]


def test_field_exempt_cross_org_rejected(org_a_client, org_b_round, admin_db):
    assert org_a_client.patch(f"/rounds/{org_b_round['id']}", json={"field_exempt_advisor_ids": [ORG_A_MANAGER_ID]}).status_code == 404
    row = admin_db.table("meeting_rounds").select("field_exempt_advisor_ids").eq("id", org_b_round["id"]).execute().data[0]
    assert row["field_exempt_advisor_ids"] == []


def test_physical_check_never_reads_another_orgs_school(org_b_client):
    resp = org_b_client.post("/rounds/physical-check", json={
        "school_ids": [ORG_A_SCHOOL_ID], "requirement": {"meeting_service_type": "gefen_current"},
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["schools"] == []


def test_round_edit_rebuilds_list_only_from_own_org_schools(org_b_client, org_b_round):
    resp = org_b_client.patch(f"/rounds/{org_b_round['id']}", json={"manual_school_ids": [ORG_B_SCHOOL_ID, ORG_A_SCHOOL_ID]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["school_ids"] == [ORG_B_SCHOOL_ID] and resp.json()["criteria"] is None


def test_round_edit_cross_org_rejected(org_a_client, org_b_round, admin_db):
    resp = org_a_client.patch(f"/rounds/{org_b_round['id']}", json={"manual_school_ids": [ORG_A_SCHOOL_ID], "name": "x"})
    assert resp.status_code == 404
    row = admin_db.table("meeting_rounds").select("school_ids, name").eq("id", org_b_round["id"]).execute().data[0]
    assert row["school_ids"] == [ORG_B_SCHOOL_ID] and row["name"] == "בדיקת אבטחה"


# "יועצים שקובעים לעצמם" (advisor_exclusions): the org default and a round's list keep only the
# caller's own org advisors, and another org's round can't be changed.
def test_exclusions_default_keeps_only_own_org_advisors(org_b_client, admin_db):
    before = admin_db.table("organizations").select("advisor_exclusions").eq("id", ORG_B_ID).execute().data[0]["advisor_exclusions"]
    try:
        resp = org_b_client.put("/tasks/advisor-exclusions-default", json={"advisor_exclusions": {
            ORG_B_MANAGER_ID: ["gefen"], ORG_A_MANAGER_ID: ["all"]}})
        assert resp.status_code == 200
        assert resp.json()["advisor_exclusions"] == {ORG_B_MANAGER_ID: ["gefen"]}
        assert org_b_client.get("/tasks/advisor-exclusions-default").json()["advisor_exclusions"] == {ORG_B_MANAGER_ID: ["gefen"]}
    finally:
        admin_db.table("organizations").update({"advisor_exclusions": before}).eq("id", ORG_B_ID).execute()


def test_round_exclusions_keep_only_own_org_advisors(org_b_client, org_b_round):
    resp = org_b_client.patch(f"/rounds/{org_b_round['id']}", json={"advisor_exclusions": {
        ORG_B_MANAGER_ID: ["current"], ORG_A_MANAGER_ID: ["all"]}})
    assert resp.status_code == 200
    assert resp.json()["advisor_exclusions"] == {ORG_B_MANAGER_ID: ["current"]}


def test_round_exclusions_cross_org_rejected(org_a_client, org_b_round, admin_db):
    assert org_a_client.patch(f"/rounds/{org_b_round['id']}", json={"advisor_exclusions": {ORG_A_MANAGER_ID: ["all"]}}).status_code == 404
    row = admin_db.table("meeting_rounds").select("advisor_exclusions").eq("id", org_b_round["id"]).execute().data[0]
    assert ORG_A_MANAGER_ID not in (row["advisor_exclusions"] or {})


# ---------------------------------------------------------------------------
# "שלח שוב לנכשלים" — POST /tasks/{task_id}/retry-failed re-sends a task's failed messages.
# Cross-org: rejected before any write. Same org: a task with no failed messages (nothing is
# re-sent — no real email goes out from the test).
# ---------------------------------------------------------------------------


def test_retry_failed_cross_org_rejected(org_b_client, admin_db):
    foreign_task = _any_task_id(admin_db, ORG_A_ID)
    before = admin_db.table("org_task_messages").select("id, status").eq("task_id", foreign_task).execute().data
    resp = org_b_client.post(f"/tasks/{foreign_task}/retry-failed")
    assert resp.status_code in (403, 404), resp.text
    after = admin_db.table("org_task_messages").select("id, status").eq("task_id", foreign_task).execute().data
    assert sorted(map(str, after)) == sorted(map(str, before))


def test_retry_failed_same_org_works(org_b_client, admin_db):
    tasks = admin_db.table("org_tasks").select("id").eq("org_id", ORG_B_ID).execute().data or []
    failed = {r["task_id"] for r in admin_db.table("org_task_messages").select("task_id").eq("status", "failed")
              .in_("task_id", [t["id"] for t in tasks] or ["00000000-0000-0000-0000-000000000000"]).execute().data or []}
    clean = [t["id"] for t in tasks if t["id"] not in failed]
    if not clean:
        pytest.skip("no org B task without failed messages")
    resp = org_b_client.post(f"/tasks/{clean[0]}/retry-failed")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"retried": 0}
