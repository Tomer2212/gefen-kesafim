"""One-time backfill: turn the free-text status / meeting_type / meeting_service_type values on
already-imported meetings into the app's canonical values (via the synonym table in
meeting_labels.py), so filtering / stats / automations work for them just like for
manually-created meetings.

- The original Excel wording is preserved in each row's `import_raw` JSONB (only written if not
  already set), so nothing is lost and the change is reversible.
- Values the synonym table can't resolve are left untouched (the org maps those via the
  "map imported values" screen).
- Only touches rows with created_via = 'import'.

Safe to re-run. Run from the backend/ directory:  python backfill_meeting_import_labels.py
"""
import sys
sys.path.insert(0, ".")
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(r"C:\CLAUDE_CODE\Project_gefen-ksafim\.env"))

from supabase_client import get_admin_client
from meeting_labels import (
    normalize_meeting_status,
    normalize_meeting_type,
    normalize_meeting_service_type,
)

FIELDS = {
    "status": normalize_meeting_status,
    "meeting_type": normalize_meeting_type,
    "meeting_service_type": normalize_meeting_service_type,
}

db = get_admin_client()
PAGE_SIZE = 500
offset = 0
scanned = 0
raw_backfilled = 0
changed_rows = 0
per_field_mapped = {f: 0 for f in FIELDS}
per_field_left = {f: 0 for f in FIELDS}

while True:
    page = (
        db.table("meetings")
        .select("id, status, meeting_type, meeting_service_type, import_raw")
        .eq("created_via", "import")
        .order("id", desc=False)
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    rows = page.data or []
    if not rows:
        break

    for row in rows:
        scanned += 1
        update: dict = {}

        if not row.get("import_raw"):
            update["import_raw"] = {
                "status": row.get("status"),
                "meeting_type": row.get("meeting_type"),
                "meeting_service_type": row.get("meeting_service_type"),
            }

        for field, normalizer in FIELDS.items():
            cur = (row.get(field) or "").strip()
            if not cur:
                continue
            canon = normalizer(cur)
            if canon is None:
                if cur not in ("scheduled", "completed", "cancelled", "postponed", "other",
                               "physical", "remote", "gefen", "current", "gefen_current", "district"):
                    per_field_left[field] += 1
                continue
            if canon != cur:
                update[field] = canon
                per_field_mapped[field] += 1

        if not update:
            continue
        try:
            db.table("meetings").update(update).eq("id", row["id"]).execute()
            if "import_raw" in update:
                raw_backfilled += 1
            if any(k != "import_raw" for k in update):
                changed_rows += 1
        except Exception as exc:
            print(f"FAILED meeting {row['id']}: {exc}")

    offset += PAGE_SIZE
    print(f"scanned {scanned} imported meetings so far...")

print("\nDone.")
print(f"  scanned:            {scanned}")
print(f"  import_raw filled:  {raw_backfilled}")
print(f"  rows re-labeled:    {changed_rows}")
for f in FIELDS:
    print(f"  {f}: mapped {per_field_mapped[f]}, still unrecognized (need manual mapping) {per_field_left[f]}")
