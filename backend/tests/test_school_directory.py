"""National school directory: parsing the Ministry file (scan of 17/11/2026 drove every rule
here), the publish diff, and adopt — the org copy is created once, hidden from lists
(status 'directory'), and an existing school of the org is linked instead of duplicated.
Fully offline."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import school_directory as sd  # noqa: E402
from fake_supabase import FakeDb  # noqa: E402

HEADER = ("סמל מוסד", "שם וסמל מוסד", "שלב חינוך", "כתובת", "יישוב", "רשות", "טלפון", "שם מנהל",
          "פיקוח", "מגזר", "שכבות", "בעלות")


def _row(symbol=110023, name="110023 בית יעקב מטרסדורף", stage="יסודי בלבד", phone="02-537-2853",
         principal="עטרה וולפא", sector="יהודי", grades="א-ח", owner="10430007 עירית ירושלים"):
    return (symbol, name, stage, "זכרון יעקב 3", "ירושלים", "ירושלים", phone, principal, "חרדי", sector, grades, owner)


@pytest.mark.parametrize("raw,expected", [
    ("א-ו", ["א", "ב", "ג", "ד", "ה", "ו"]),
    ("ז-ט", ["ז", "ח", "ט"]),
    ("גן-ב", ["א", "ב"]),          # "גן" is not a grade in the app
    ("ט-יד", ["ט", "י", "יא", "יב"]),  # יג/יד dropped
    ("יג-יד", []),
    ("א-א", ["א"]),
    ("-", []),
    (None, []),
])
def test_parse_grades(raw, expected):
    assert sd.parse_grades(raw) == expected


@pytest.mark.parametrize("phone,valid", [
    ("02-537-2853", True),
    ("08-666-6666", False),
    ("0--0000", False),
    ("04-111-1111", False),
    ("050-600-0000", False),
    ("077-666-6666", False),
])
def test_placeholder_phones(phone, valid):
    assert sd.phone_is_valid(phone) is valid


def test_parse_row_maps_every_column():
    records, problems = sd.parse_ministry_rows([HEADER, _row(sector="צרקסי", principal="-")])
    assert problems == []
    r = records[0]
    assert r["symbol"] == "110023" and r["name"] == "בית יעקב מטרסדורף"
    assert r["ministry_stage"] == "יסודי בלבד"
    assert r["sector"] == "צ'רקסי"
    assert r["principal_name"] is None
    assert (r["ownership_code"], r["ownership_name"]) == ("10430007", "עירית ירושלים")
    assert r["grade_levels"] == ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח"] and r["grades_raw"] == "א-ח"
    assert r["phone_valid"] is True


def test_parse_blocks_missing_columns_and_duplicate_symbols():
    _, problems = sd.parse_ministry_rows([HEADER[:-1], _row()[:-1]])
    assert problems and "בעלות" in problems[0]
    records, problems = sd.parse_ministry_rows([HEADER, _row(), _row()])
    assert len(records) == 1 and len(problems) == 1


def test_diff_ignores_cosmetic_changes():
    old = [{"symbol": "1", "name": 'בית ספר "אורט"', "phone": "02-111-2222", "grade_levels": ["א", "ב"]},
           {"symbol": "2", "name": "נעלם"}]
    new = [{"symbol": "1", "name": "בית ספר אורט", "phone": "021112222", "grade_levels": ["ב", "א"]},
           {"symbol": "3", "name": "חדש"}]
    d = sd.diff_directory(old, new)
    assert (d["new"], d["changed"], d["missing"], d["unchanged"]) == (1, 0, 1, 1)


ORG = "org-1"
ENTRY = {"id": "dir-1", "symbol": "110023", "name": "בית יעקב מטרסדורף", "ministry_stage": 'יסודי וחט"ב',
         "city": "ירושלים", "phone": "02-537-2853", "principal_name": "עטרה וולפא", "grade_levels": ["א"],
         "ownership_name": "עירית ירושלים"}


def _db(**extra):
    return FakeDb({"school_directory": [ENTRY], "school_directory_links": [], "schools": [], "school_activity": [], **extra})


def test_adopt_creates_one_hidden_copy_and_is_idempotent():
    db = _db()
    first = sd.adopt(db, ORG, "dir-1", "user-1")
    second = sd.adopt(db, ORG, "dir-1", "user-1")
    assert first["created"] is True and second == {"school_id": first["school_id"], "created": False}
    schools = db.tables["schools"]
    assert len(schools) == 1
    copy = schools[0]
    assert copy["status"] == "directory" and copy["org_id"] == ORG
    assert copy["authority"] == "עירית ירושלים" and copy["school_phone"] == "02-537-2853"
    assert len(db.tables["school_directory_links"]) == 1


def test_adopt_links_existing_school_with_same_symbol_without_changing_it():
    existing = {"id": "s-1", "org_id": ORG, "symbol": "110023", "name": "השם שלנו", "status": "active"}
    db = _db(schools=[dict(existing)])
    res = sd.adopt(db, ORG, "dir-1", "user-1")
    assert res == {"school_id": "s-1", "created": False}
    assert db.tables["schools"] == [existing]  # untouched
    assert db.tables["school_directory_links"][0]["school_id"] == "s-1"


def test_adopt_refuses_school_in_recycle_bin():
    db = _db(schools=[{"id": "s-1", "org_id": ORG, "symbol": "110023", "name": "x", "status": "pending_deletion"}])
    with pytest.raises(sd.AdoptConflict):
        sd.adopt(db, ORG, "dir-1", "user-1")


def test_copy_of_another_org_is_never_reused():
    db = _db(schools=[{"id": "other", "org_id": "org-2", "symbol": "110023", "name": "x", "status": "active"}])
    res = sd.adopt(db, ORG, "dir-1", "user-1")
    assert res["created"] is True and res["school_id"] != "other"


def test_org_import_parse_recognizes_columns_and_skips_empty_cells():
    rows = [("סמל מוסד", "שם מנהל/ת", 'מייל מנהל/ת', "עמודה לא מוכרת"),
            (110023, "רינה", None, "x"), (110023, "כפול", None, None), (999, None, "-", None)]
    records, labels, problems = sd.parse_org_import(rows)
    assert problems == [] and labels == ["שם מנהל/ת", "מייל מנהל/ת"]
    assert records == [{"symbol": "110023", "fields": {"principal_name": "רינה"}}]


def test_org_import_updates_only_directory_copies():
    client = {"id": "c-1", "org_id": ORG, "symbol": "200", "name": "לקוח", "status": "active", "principal_name": "שלנו"}
    second = {**ENTRY, "id": "dir-2", "symbol": "200"}
    db = _db(schools=[dict(client)])
    db.tables["school_directory"].append(second)
    records = [{"symbol": "110023", "fields": {"principal_name": "רינה"}},
               {"symbol": "200", "fields": {"principal_name": "אחר"}},
               {"symbol": "777", "fields": {"principal_name": "x"}}]
    preview = sd.org_import(db, ORG, records, apply=False, actor_id="u")
    assert (preview["create"], preview["update"], preview["skipped_clients"], preview["not_in_directory"]) == (1, 0, 1, 1)
    assert len(db.tables["schools"]) == 1  # preview writes nothing
    sd.org_import(db, ORG, records, apply=True, actor_id="u")
    copy = next(s for s in db.tables["schools"] if s["symbol"] == "110023")
    assert copy["status"] == "directory" and copy["principal_name"] == "רינה"
    assert next(s for s in db.tables["schools"] if s["id"] == "c-1")["principal_name"] == "שלנו"  # client untouched
