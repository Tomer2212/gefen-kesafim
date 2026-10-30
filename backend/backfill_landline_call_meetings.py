"""One-time backfill: re-attribute calls to meetings for schools with a landline contact.

Until the _phone_suffix fix (calls_router.py), landline numbers (e.g. 03-5531905) never
matched the provider's e164 form, so calls with them were never attached to meetings.
This re-runs the contact-change meeting resync (last 30 days) for every active school that
has at least one landline contact number.

Usage (from backend/):  python backfill_landline_call_meetings.py [--dry-run]
"""
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import HTTPException  # noqa: E402

from supabase_client import get_admin_client  # noqa: E402
from routers.calls_router import _phone_suffix, _pull_org_calls  # noqa: E402
from routers.schools_router import (  # noqa: E402
    _CONTACT_PHONE_FIELDS,
    _CONTACT_PHONES_SELECT,
    _CONTACT_RESYNC_LOOKBACK_DAYS,
    _maybe_auto_complete_meeting,
    _recompute_meeting_call_activity,
)


def _has_landline(school: dict) -> bool:
    phones = [school.get(f) for f in _CONTACT_PHONE_FIELDS]
    phones += [ec.get("phone") for ec in (school.get("extra_contacts") or []) if isinstance(ec, dict)]
    # Israeli landlines are 8 digits without the trunk zero; mobiles are 9.
    return any((s := _phone_suffix(p)) and len(s) == 8 for p in phones)


def main(dry_run: bool) -> None:
    db = get_admin_client()
    schools = (
        db.table("schools").select(f"id, org_id, {_CONTACT_PHONES_SELECT}")
        .eq("status", "active").execute()
    ).data or []
    targets = [s for s in schools if s.get("org_id") and _has_landline(s)]
    print(f"{len(targets)} of {len(schools)} active schools have a landline contact")

    today_il = datetime.now(ZoneInfo("Asia/Jerusalem")).date()
    since = (today_il - timedelta(days=_CONTACT_RESYNC_LOOKBACK_DAYS)).isoformat()
    org_by_school = {s["id"]: s["org_id"] for s in targets}
    meetings = (
        db.table("meetings").select("school_id, meeting_date")
        .in_("school_id", list(org_by_school)).gte("meeting_date", since).lte("meeting_date", today_il.isoformat())
        .execute()
    ).data or []
    # org -> date -> set(school_id): one provider pull per org per day, same as the cron.
    plan: dict = defaultdict(lambda: defaultdict(set))
    for m in meetings:
        plan[org_by_school[m["school_id"]]][m["meeting_date"]].add(m["school_id"])
    print(f"{sum(len(d) for d in plan.values())} org-day pull(s), "
          f"{sum(len(x) for d in plan.values() for x in d.values())} school-day(s)")
    if dry_run:
        print("dry run — nothing written")
        return

    done = 0
    for org_id, by_date in plan.items():
        for date_str in sorted(by_date):
            try:
                calls = _pull_org_calls(org_id, f"{date_str}T00:00:00", f"{date_str}T23:59:59")["calls"]
            except HTTPException as exc:
                if exc.status_code == 400:
                    break  # calls integration not configured for this org
                print(f"  pull failed org={org_id} date={date_str}: {exc.detail}")
                continue
            for school_id in by_date[date_str]:
                calls_for_school = [
                    c for c in calls
                    if school_id not in (c.get("excluded_school_ids") or [])
                    and (c.get("school_id") == school_id or school_id in (c.get("linked_school_ids") or []))
                ]
                db = get_admin_client()
                affected = _recompute_meeting_call_activity(db, org_id, school_id, date_str, calls_for_school)
                for mid in affected:
                    _maybe_auto_complete_meeting(db, org_id, mid)
                done += 1
    print(f"done — {done} school-day(s) re-synced")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
