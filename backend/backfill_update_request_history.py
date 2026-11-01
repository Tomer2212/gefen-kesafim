"""One-off backfill: fills school_update_requests.original_values / field_decisions for requests
created before those columns existed, from the notification payloads that already carry them
(`update_request_submitted.data.current_values`, `update_request_*.data.approved_fields`).

Usage (from backend/):  python backfill_update_request_history.py          # dry run
                        python backfill_update_request_history.py --apply  # write
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from supabase_client import get_admin_client  # noqa: E402

_INTERNAL_KEYS = {"_action", "add_advisor_to_school"}


def main(apply: bool) -> None:
    db = get_admin_client()
    reqs = db.table("school_update_requests").select("*").execute().data or []
    req_ids = [r["id"] for r in reqs]
    notifs = (db.table("notifications").select("type, ref_id, data, created_at")
              .in_("ref_id", req_ids)
              .in_("type", ["update_request_submitted", "update_request_approved",
                            "update_request_rejected", "update_request_result"])
              .execute().data or []) if req_ids else []
    current_by_req: dict[str, dict] = {}
    approved_by_req: dict[str, list | None] = {}
    for n in notifs:
        data = n.get("data") or {}
        if n["type"] == "update_request_submitted" and isinstance(data.get("current_values"), dict):
            current_by_req.setdefault(n["ref_id"], {}).update(data["current_values"])
        elif n["type"] != "update_request_submitted" and "approved_fields" in data:
            approved_by_req[n["ref_id"]] = data.get("approved_fields")

    stats = {"total": len(reqs), "originals_filled": 0, "decisions_filled": 0, "originals_missing": 0}
    for r in reqs:
        proposed = {k: v for k, v in (r.get("proposed_changes") or {}).items() if k not in _INTERNAL_KEYS}
        patch = {}
        if r.get("original_values") is None and proposed:
            cur = current_by_req.get(r["id"])
            if cur:
                patch["original_values"] = {k: cur.get(k) for k in proposed if k in cur}
                stats["originals_filled"] += 1
            else:
                stats["originals_missing"] += 1
        if r.get("field_decisions") is None and proposed and r["status"] in ("approved", "rejected"):
            approved = approved_by_req.get(r["id"])
            patch["field_decisions"] = {
                k: ("approved" if r["status"] == "approved" and (approved is None or k in approved) else "rejected")
                for k in proposed
            }
            stats["decisions_filled"] += 1
        if patch and apply:
            db.table("school_update_requests").update(patch).eq("id", r["id"]).execute()
    print(("APPLIED" if apply else "DRY RUN"), stats)


if __name__ == "__main__":
    main("--apply" in sys.argv)
