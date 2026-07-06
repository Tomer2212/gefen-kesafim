"""One-time backfill: recompute check_metrics rows (including the new fields added for the
dashboard summary columns) from every existing check_logs row. Safe to re-run — later checks
(processed in run_at-ascending order) overwrite earlier ones for the same
(school_id, division_type, budget_name, academic_year) key, exactly like the live save path.

Run from the backend/ directory: python backfill_check_metrics.py
"""
import sys
sys.path.insert(0, ".")
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(r"C:\CLAUDE_CODE\Project_gefen-ksafim\.env"))

from supabase_client import get_admin_client
from routers.analyze_router import _save_check_metrics
from academic_years import DEFAULT_ACADEMIC_YEAR

db = get_admin_client()

PAGE_SIZE = 500
offset = 0
total = 0
skipped = 0

while True:
    page = (
        db.table("check_logs")
        .select("id, school_id, gefen_account_id, academic_year, summary, run_at")
        .order("run_at", desc=False)
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    rows = page.data or []
    if not rows:
        break

    for row in rows:
        summary = row.get("summary") or {}
        run = {
            "tikhnun": summary.get("tikhnun_result"),
            "tikhnun_tikkon": summary.get("tikhnun_tikkon_result"),
            "tikhnun_beinayim": summary.get("tikhnun_beinayim_result"),
            "per_combo_results": summary.get("per_combo_results"),
            "summary": summary,  # so _compute_check_metrics_rows can read summary["division"]
        }
        if not (run["tikhnun"] or run["tikhnun_tikkon"] or run["tikhnun_beinayim"]):
            skipped += 1
            continue
        try:
            _save_check_metrics(
                db,
                row["school_id"],
                row.get("gefen_account_id"),
                row.get("academic_year") or DEFAULT_ACADEMIC_YEAR,
                run,
            )
            total += 1
        except Exception as exc:
            print(f"FAILED check_log {row['id']}: {exc}")

    offset += PAGE_SIZE
    print(f"processed {offset} check_logs rows so far...")

print(f"Done. {total} check_logs rows contributed check_metrics rows, {skipped} skipped (no tikhnun data).")
