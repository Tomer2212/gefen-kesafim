"""One-time backfill: populate schools.gefen_files_responsible from a three-way fallback
cascade — secretary -> principal -> finance_contact (and their _chativa counterparts for
the חט"ב slot of six-year schools) — each candidate accepted only if BOTH name and email
are present. If none of the three qualifies for a slot, that slot is left unset (not
guessed) and printed at the end for manual follow-up.

For the חט"ב (beinayim) slot of a six-year school: if the role's *_same_person flag is
true, there is no separate chativa contact, so the cascade falls back to the role's
regular (non-chativa) fields instead.

Safe to re-run: always recomputes from the authoritative contact fields, never reads
schools.gefen_files_responsible itself as input.

Run from the backend/ directory: python backfill_gefen_files_responsible.py
"""
import sys
sys.path.insert(0, ".")
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(r"C:\CLAUDE_CODE\Project_gefen-ksafim\.env"))

from supabase_client import get_admin_client
from routers.schools_router import _gefen_files_slots_for_school

db = get_admin_client()

PAGE_SIZE = 500
offset = 0
updated = 0
skipped_reference = 0
needs_manual_attention = []  # (school_id, school_name, slot)

SELECT_FIELDS = (
    "id, name, stage, status, "
    "principal_name, principal_email, principal_chativa_name, principal_chativa_email, principal_same_person, "
    "secretary_name, secretary_email, secretary_chativa_name, secretary_chativa_email, secretary_same_person, "
    "finance_contact_name, finance_contact_email, finance_contact_chativa_name, finance_contact_chativa_email, finance_same_person"
)


def _candidates_for_slot(row: dict, slot: str) -> list[tuple[str, str, str]]:
    """Returns [(ref, name_field, email_field), ...] in cascade order: secretary -> principal
    -> finance_contact. For 'beinayim', uses the _chativa fields unless the role's
    *_same_person flag is true (no separate chativa contact exists in that case)."""
    use_chativa = slot == "beinayim"

    def role(ref_base: str, same_person_field: str, name_field: str, email_field: str,
             chativa_name_field: str, chativa_email_field: str) -> tuple[str, str, str]:
        if use_chativa and not row.get(same_person_field):
            return f"{ref_base}_chativa", chativa_name_field, chativa_email_field
        return ref_base, name_field, email_field

    return [
        role("secretary", "secretary_same_person", "secretary_name", "secretary_email",
             "secretary_chativa_name", "secretary_chativa_email"),
        role("principal", "principal_same_person", "principal_name", "principal_email",
             "principal_chativa_name", "principal_chativa_email"),
        role("finance_contact", "finance_same_person", "finance_contact_name", "finance_contact_email",
             "finance_contact_chativa_name", "finance_contact_chativa_email"),
    ]


while True:
    page = (
        db.table("schools")
        .select(SELECT_FIELDS)
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    rows = page.data or []
    if not rows:
        break

    for row in rows:
        if row.get("status") == "reference":
            skipped_reference += 1
            continue

        result: dict[str, str] = {}
        for slot in _gefen_files_slots_for_school(row):
            chosen_ref = None
            for ref, name_field, email_field in _candidates_for_slot(row, slot):
                if (row.get(name_field) or "").strip() and (row.get(email_field) or "").strip():
                    chosen_ref = ref
                    break
            if chosen_ref:
                result[slot] = chosen_ref
            else:
                needs_manual_attention.append((row["id"], row.get("name"), slot))

        try:
            db.table("schools").update({"gefen_files_responsible": result}).eq("id", row["id"]).execute()
            updated += 1
            print(f"school {row['id']} ({row.get('name')}): {result}")
        except Exception as exc:
            print(f"FAILED school {row['id']}: {exc}")

    offset += PAGE_SIZE
    print(f"processed {offset} schools so far...")

print(
    f"\nDone. {updated} schools updated, "
    f"{skipped_reference} skipped (status=reference)."
)
if needs_manual_attention:
    print(f"\n{len(needs_manual_attention)} slot(s) need manual attention (no candidate with name+email):")
    for school_id, school_name, slot in needs_manual_attention:
        print(f"  - {school_id} ({school_name}): slot '{slot}'")
