"""One-time migration to "חשבונות במערכת גפן" (gefen_accounts as the source of truth).

    python migrate_gefen_accounts.py            # dry run — reads only, prints the plan
    python migrate_gefen_accounts.py --apply    # backs up, then writes

- A school with accounts: fills `covers` / `custom_label` on rows saved before they existed.
- A school without accounts whose stage implies them (yesodi / beinayim / tikkon /
  sheshshnati): creates them — the stage they derive is exactly the current one.
- A school whose existing accounts contradict its stage: the accounts win — its stage mirror
  is re-derived from them (listed in the report).
- A school with no/other stage and no accounts stays without accounts: its checks keep
  running in one general area, as today (listed in the report).
- Accounts are per academic year: each school's list is written as the explicit value of the
  first academic year (later years inherit it) — skipped for a school that already has a
  value in some year (edited after the per-year editor shipped).
"""
import json
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

import gefen_accounts as ga  # noqa: E402
from academic_years import ACADEMIC_YEARS  # noqa: E402
from supabase_client import get_admin_client  # noqa: E402

BACKUP_DIR = Path(__file__).parent.parent / "fix_data"


def main(apply: bool) -> None:
    db = get_admin_client()
    schools = db.table("schools").select("id, name, org_id, stage, status").execute().data or []
    accounts = db.table("gefen_accounts").select("*").execute().data or []
    by_school: dict[str, list[dict]] = {}
    for a in accounts:
        by_school.setdefault(a["school_id"], []).append(a)
    with_year_value = {
        r["school_id"] for r in (
            db.table("school_year_admin_data").select("school_id, year_gefen_accounts")
            .not_.is_("year_gefen_accounts", "null").execute().data or []
        )
    }
    year_rows = []

    fill_rows, create, conflicts, no_stage = [], [], [], []
    for s in schools:
        accs = by_school.get(s["id"], [])
        if accs:
            for a in accs:
                if not a.get("covers") or not a.get("custom_label"):
                    covers = ga.account_covers(a)
                    fill_rows.append({"id": a["id"], "covers": covers, "custom_label": a.get("custom_label") or ga.covers_label(covers) or None})
            if s["id"] not in with_year_value:
                year_rows.append({"school_id": s["id"], "entries": [{"division_type": a["division_type"], "covers": ga.account_covers(a)} for a in ga.sort_accounts(accs)]})
            if ga.derive_stage(accs) != (s.get("stage") or None):
                conflicts.append({
                    "school_id": s["id"], "name": s["name"], "status": s.get("status"), "stage": s.get("stage"),
                    "accounts": [ga.account_label(a) for a in ga.sort_accounts(accs)],
                    "new_stage": ga.derive_stage(accs),
                })
        elif ga.STAGE_ACCOUNTS.get(s.get("stage") or ""):
            for covers in ga.STAGE_ACCOUNTS[s["stage"]]:
                create.append({
                    "school_id": s["id"], "division_type": ga.division_type_for(covers),
                    "covers": covers, "custom_label": ga.covers_label(covers),
                })
            if s["id"] not in with_year_value:
                year_rows.append({"school_id": s["id"], "entries": [
                    {"division_type": ga.division_type_for(c), "covers": c} for c in ga.STAGE_ACCOUNTS[s["stage"]]
                ]})
        else:
            no_stage.append({"school_id": s["id"], "name": s["name"], "status": s.get("status"), "stage": s.get("stage")})

    print(f"schools: {len(schools)}  existing accounts: {len(accounts)}")
    print(f"rows to fill covers/label: {len(fill_rows)}")
    print(f"accounts to create: {len(create)} (for {len({c['school_id'] for c in create})} schools)")
    print(f"schools getting a {ACADEMIC_YEARS[0]} account list (later years inherit): {len(year_rows)}")
    print(f"schools with no/other stage (stay without accounts — one general checks area): {len(no_stage)}")
    print(f"schools whose accounts contradict their stage (stage re-derived from accounts): {len(conflicts)}")
    for c in conflicts:
        print(f"  - {c['name']} [{c['status']}] stage={c['stage']} -> {c['new_stage']} accounts={c['accounts']}")

    if not apply:
        print("\nDry run — nothing written. Re-run with --apply.")
        return

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = BACKUP_DIR / f"backup_gefen_accounts_before_migration_{stamp}.json"
    backup.write_text(json.dumps({"schools": schools, "gefen_accounts": accounts}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"backup: {backup}")

    for r in fill_rows:
        db.table("gefen_accounts").update({"covers": r["covers"], "custom_label": r["custom_label"]}).eq("id", r["id"]).execute()
    for i in range(0, len(create), 200):
        db.table("gefen_accounts").insert(create[i:i + 200]).execute()
    for c in conflicts:
        db.table("schools").update({"stage": c["new_stage"]}).eq("id", c["school_id"]).execute()
    for i in range(0, len(year_rows), 200):
        db.table("school_year_admin_data").upsert([
            {"school_id": r["school_id"], "academic_year": ACADEMIC_YEARS[0], "year_gefen_accounts": r["entries"]}
            for r in year_rows[i:i + 200]
        ], on_conflict="school_id,academic_year").execute()
    report = BACKUP_DIR / f"gefen_accounts_manual_review_{stamp}.json"
    report.write_text(json.dumps({"conflicts": conflicts, "no_stage": no_stage}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done. manual-review list: {report}")


if __name__ == "__main__":
    main("--apply" in sys.argv)
