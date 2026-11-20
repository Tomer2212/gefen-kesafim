"""National school directory ("מאגר בתי ספר") — one shared, read-only list of every school in
the country (the Ministry of Education's official file), plus each organization's private copy.

- `school_directory`: public fields only, written ONLY by the superadmin upload (publish).
  No organization ever writes to it.
- An org's copy is an ordinary `schools` row of that org. It is created on the org's first
  action on a directory school (`adopt`) with status 'directory', which keeps it out of every
  list (they all filter status = 'active') while single-school actions (card, meetings,
  checks, reminders, calls) work as usual. "Add to the client list" flips it to 'active'.
- `school_directory_links` ties a `schools` row to its directory entry. It is a separate table so
  linking an org's existing schools never changes a single column of theirs. `base` holds the
  directory values the org last accepted: a field the org changed is one whose value differs
  from `base` (after normalize_for_compare) — that is what a later directory refresh compares.
"""
import logging
import re

import school_activity

logger = logging.getLogger(__name__)

EXPECTED_HEADERS = {
    "symbol": "סמל מוסד",
    "name_with_symbol": "שם וסמל מוסד",
    "ministry_stage": "שלב חינוך",
    "address": "כתובת",
    "city": "יישוב",
    "education_authority": "רשות",
    "phone": "טלפון",
    "principal_name": "שם מנהל",
    "supervision": "פיקוח",
    "sector": "מגזר",
    "grades": "שכבות",
    "ownership": "בעלות",
}

# directory column -> schools column, for the public fields an org copy starts from.
COPY_FIELDS = {
    "name": "name",
    "symbol": "symbol",
    "ministry_stage": "ministry_stage",
    "address": "address",
    "city": "city",
    "education_authority": "education_authority",
    "phone": "school_phone",
    "principal_name": "principal_name",
    "supervision": "supervision",
    "sector": "sector",
    "grade_levels": "grade_levels",
    "ownership_name": "authority",
    "district": "district",
}

DIRECTORY_SELECT = (
    "id, symbol, name, ministry_stage, address, city, education_authority, phone, phone_valid, "
    "principal_name, supervision, sector, grade_levels, grades_raw, ownership_code, ownership_name, district, missing_since"
)

# The org copy's columns a directory row shows (its values win over the directory's — _merge_item).
COPY_SELECT = "id, name, symbol, city, address, school_phone, principal_name, district, status"

GRADE_ORDER = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "יא", "יב"]
_BEYOND_GRADES = ["יג", "יד"]  # technological colleges — the app's grade levels end at יב
_MINISTRY_STAGES = {
    "100": "יסודי בלבד",
    "010": 'חט"ב בלבד',
    "001": "עליונה בלבד",
    "110": 'יסודי וחט"ב',
    "011": 'חט"ב + עליונה',
    "101": "יסודי ועליונה",
    "111": 'יסודי חט"ב ועליונה',
}
# Only one-level stages say how checks split; mirrors ministryStages.js stageSuggestionForMinistryStage.
SINGLE_LEVEL_STAGE = {"יסודי בלבד": "yesodi", 'חט"ב בלבד': "beinayim", "עליונה בלבד": "tikkon"}
_SECTOR_ALIASES = {"צרקסי": "צ'רקסי"}


def _text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return text or None


def _dash_is_empty(value) -> str | None:
    text = _text(value)
    return None if text in (None, "-", "--") else text


def match_ministry_stage(raw) -> str | None:
    """The canonical "שלב חינוך" value, or None when the text names no level (mirrors
    ministryStages.js matchMinistryStage, minus the free-text "אחר")."""
    text = _text(raw)
    if not text:
        return None
    key = re.sub(r"[\s\-_.,'\"׳״()/\\+]+", "", text)
    yesodi = "יסוד" in key
    chativa = "חטב" in key or "ביניים" in key
    elyona = "עליונה" in key or "תיכון" in key
    return _MINISTRY_STAGES.get(f"{int(yesodi)}{int(chativa)}{int(elyona)}")


def parse_grades(raw) -> list[str]:
    """"א-ו" -> [א..ו]. "גן" counts as the start of א; יג/יד are dropped (no such levels in the
    app); "-" or anything unreadable -> []. The raw text is kept separately (grades_raw)."""
    text = _dash_is_empty(raw)
    if not text:
        return []
    m = re.fullmatch(r"\s*(גן|[א-ת]{1,2})\s*-\s*([א-ת]{1,2})\s*", text)
    if not m:
        return [text] if text in GRADE_ORDER else []
    start, end = m.group(1), m.group(2)
    extended = GRADE_ORDER + _BEYOND_GRADES
    if (start != "גן" and start not in extended) or end not in extended:
        return []
    a = 0 if start == "גן" else extended.index(start)
    b = min(extended.index(end), len(GRADE_ORDER) - 1)
    return GRADE_ORDER[a:b + 1] if a <= b else []


def phone_is_valid(raw) -> bool:
    """False for the ministry's placeholder numbers (08-666-6666, 0--0000, 04-111-1111…)."""
    digits = re.sub(r"\D", "", _text(raw) or "")
    if len(digits) < 9:
        return False
    return not re.search(r"(\d)\1{5}", digits[2:])


def _split_ownership(raw) -> tuple[str | None, str | None]:
    text = _text(raw)
    if not text:
        return None, None
    m = re.fullmatch(r"(\d+)\s+(.+)", text)
    return (m.group(1), m.group(2).strip()) if m else (None, text)


def parse_ministry_rows(rows: list) -> tuple[list[dict], list[str]]:
    """rows = the sheet as tuples, header first. Returns (records, problems). Problems are
    blocking (missing columns, duplicate or empty symbols)."""
    if not rows:
        return [], ["הקובץ ריק"]
    header = [(_text(h) or "") for h in rows[0]]
    col = {}
    missing = []
    for key, label in EXPECTED_HEADERS.items():
        if label in header:
            col[key] = header.index(label)
        else:
            missing.append(label)
    if missing:
        return [], [f"חסרות עמודות: {', '.join(missing)}"]

    records, problems, seen = [], [], {}
    for line_no, row in enumerate(rows[1:], start=2):
        if not row or all(v in (None, "") for v in row):
            continue

        def cell(key):
            idx = col[key]
            return row[idx] if idx < len(row) else None

        symbol = _text(cell("symbol"))
        if not symbol:
            problems.append(f"שורה {line_no}: חסר סמל מוסד")
            continue
        if symbol in seen:
            problems.append(f"שורה {line_no}: סמל {symbol} מופיע פעמיים (גם בשורה {seen[symbol]})")
            continue
        seen[symbol] = line_no
        name = _text(cell("name_with_symbol")) or ""
        if name.startswith(symbol):
            name = name[len(symbol):].strip(" -")
        grades_raw = _text(cell("grades"))
        phone = _dash_is_empty(cell("phone"))
        ownership_code, ownership_name = _split_ownership(cell("ownership"))
        sector = _dash_is_empty(cell("sector"))
        records.append({
            "symbol": symbol,
            "name": name or symbol,
            "ministry_stage": match_ministry_stage(cell("ministry_stage")),
            "address": _dash_is_empty(cell("address")),
            "city": _dash_is_empty(cell("city")),
            "education_authority": _dash_is_empty(cell("education_authority")),
            "phone": phone,
            "phone_valid": phone_is_valid(phone),
            "principal_name": _dash_is_empty(cell("principal_name")),
            "supervision": _dash_is_empty(cell("supervision")),
            "sector": _SECTOR_ALIASES.get(sector, sector),
            "grade_levels": parse_grades(grades_raw),
            "grades_raw": grades_raw,
            "ownership_code": ownership_code,
            "ownership_name": ownership_name,
        })
    return records, problems


def read_xlsx_rows(path) -> list:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return list(wb.worksheets[0].iter_rows(values_only=True))
    finally:
        wb.close()


def normalize_for_compare(value) -> str:
    """Cosmetic differences (spaces, hyphens, quotes, list order, None vs "") are not changes."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "|".join(sorted(normalize_for_compare(v) for v in value if v not in (None, "")))
    return re.sub(r"[\s\-\"'׳״`]", "", str(value))


_DIFF_FIELDS = (
    "name", "ministry_stage", "address", "city", "education_authority", "phone", "principal_name",
    "supervision", "sector", "grade_levels", "grades_raw", "ownership_code", "ownership_name",
)


def diff_directory(existing: list[dict], incoming: list[dict]) -> dict:
    """What publishing `incoming` would do to the current directory rows."""
    by_symbol = {r["symbol"]: r for r in existing}
    incoming_symbols = {r["symbol"] for r in incoming}
    new, changed = [], []
    for rec in incoming:
        old = by_symbol.get(rec["symbol"])
        if not old:
            new.append(rec["symbol"])
            continue
        fields = {
            f: [old.get(f), rec.get(f)]
            for f in _DIFF_FIELDS
            if normalize_for_compare(old.get(f)) != normalize_for_compare(rec.get(f))
        }
        if fields:
            changed.append({"symbol": rec["symbol"], "name": rec["name"], "fields": fields})
    missing = [s for s, r in by_symbol.items() if s not in incoming_symbols and not r.get("missing_since")]
    return {
        "total": len(incoming),
        "new": len(new),
        "changed": len(changed),
        "missing": len(missing),
        "unchanged": len(incoming) - len(new) - len(changed),
        "changed_sample": changed[:30],
        "missing_sample": missing[:30],
        "new_sample": new[:30],
    }


def copy_fields(directory_row: dict) -> dict:
    """The `schools` column values an org copy takes from a directory row."""
    return {school_col: directory_row.get(dir_col) for dir_col, school_col in COPY_FIELDS.items()}


def fetch_all_directory(db) -> list[dict]:
    return db.table("school_directory").select(DIRECTORY_SELECT).execute().data or []


def publish(db, records: list[dict], source_label: str) -> dict:
    """Upserts the file into the directory (by symbol) and marks entries absent from it as
    missing (never deletes — orgs may have copies of them)."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    existing = {r["symbol"]: r for r in fetch_all_directory(db)}
    rows = [{**r, "source_label": source_label, "missing_since": None, "updated_at": now} for r in records]
    for i in range(0, len(rows), 500):
        db.table("school_directory").upsert(rows[i:i + 500], on_conflict="symbol").execute()
    incoming = {r["symbol"] for r in records}
    gone = [r["id"] for s, r in existing.items() if s not in incoming and not r.get("missing_since")]
    if gone:
        db.table("school_directory").update({"missing_since": now}).in_("id", gone).execute()
    return {"upserted": len(rows), "marked_missing": len(gone)}


def _org_links(db, org_id: str) -> list[dict]:
    return db.table("school_directory_links").select("id, school_id, directory_id").eq("org_id", org_id).execute().data or []


def link_existing_org_schools(db, org_id: str, apply: bool, actor_id: str | None = None) -> dict:
    """Links an org's existing schools to the directory by exact symbol. Writes ONLY
    school_directory_links rows — no `schools` column is touched. Schools whose symbol appears
    twice in the org are reported and left unlinked."""
    schools = (
        db.table("schools").select("id, name, symbol, city, status")
        .eq("org_id", org_id).neq("status", "deleted").execute().data or []
    )
    linked_school_ids = {link["school_id"] for link in _org_links(db, org_id)}
    linked_directory_ids = {link["directory_id"] for link in _org_links(db, org_id)}
    directory = {r["symbol"]: r for r in fetch_all_directory(db)}

    by_symbol: dict[str, list[dict]] = {}
    for s in schools:
        sym = (s.get("symbol") or "").strip()
        if sym:
            by_symbol.setdefault(sym, []).append(s)

    to_link, unmatched, duplicates, already = [], [], [], 0
    for s in schools:
        sym = (s.get("symbol") or "").strip()
        if s["id"] in linked_school_ids:
            already += 1
        elif not sym or sym not in directory:
            unmatched.append({"id": s["id"], "name": s["name"], "symbol": sym, "city": s.get("city"), "status": s["status"]})
        elif len(by_symbol[sym]) > 1:
            if sym not in duplicates:
                duplicates.append(sym)
        elif directory[sym]["id"] in linked_directory_ids:
            already += 1
        else:
            to_link.append({
                "org_id": org_id, "school_id": s["id"], "directory_id": directory[sym]["id"],
                "base": copy_fields(directory[sym]), "linked_via": "initial_match", "created_by": actor_id,
            })
    if apply:
        for i in range(0, len(to_link), 500):
            db.table("school_directory_links").insert(to_link[i:i + 500]).execute()
    return {
        "org_schools": len(schools),
        "to_link": len(to_link),
        "already_linked": already,
        "unmatched": unmatched,
        "duplicate_symbols": duplicates,
        "applied": apply,
    }


def link_school_if_in_directory(db, org_id: str, school_id: str, symbol: str | None, via: str,
                                actor_id: str | None = None) -> None:
    """After a school is created (manually or by import): link it when its symbol is in the
    directory and the org has no other school linked to that entry. Non-fatal."""
    sym = (symbol or "").strip()
    if not sym:
        return
    try:
        rows = db.table("school_directory").select(DIRECTORY_SELECT).eq("symbol", sym).execute().data or []
        if not rows:
            return
        db.table("school_directory_links").insert({
            "org_id": org_id, "school_id": school_id, "directory_id": rows[0]["id"],
            "base": copy_fields(rows[0]), "linked_via": via, "created_by": actor_id,
        }).execute()
    except Exception as exc:
        # A unique violation here just means the org already has a school linked to that entry.
        logger.info("directory link after create skipped for %s (non-fatal): %s", school_id, exc)


class AdoptConflict(Exception):
    def __init__(self, detail: dict):
        super().__init__(detail.get("message"))
        self.detail = detail


def _existing_link(db, org_id: str, directory_id: str) -> dict | None:
    rows = (
        db.table("school_directory_links").select("school_id")
        .eq("org_id", org_id).eq("directory_id", directory_id).execute().data or []
    )
    return rows[0] if rows else None


def _school_status(db, school_id: str) -> dict | None:
    rows = db.table("schools").select("id, name, status").eq("id", school_id).execute().data or []
    return rows[0] if rows else None


def _recycle_conflict(school: dict) -> AdoptConflict:
    return AdoptConflict({
        "code": "school_in_recycle_bin",
        "message": "בית ספר זה נמצא בסל המחזור של הארגון. יש לשחזר אותו מניהול → בתי ספר.",
        "existing_school_id": school["id"],
        "existing_school_name": school["name"],
    })


def adopt(db, org_id: str, directory_id: str, actor_id: str | None) -> dict:
    """The org's copy of a directory school: returns the existing one, links an existing
    school of the org with the same symbol, or creates a 'directory' copy. Idempotent and safe
    under concurrency (UNIQUE(org_id, directory_id)). Returns {school_id, created}."""
    link = _existing_link(db, org_id, directory_id)
    if link:
        school = _school_status(db, link["school_id"])
        if school and school["status"] == "pending_deletion":
            raise _recycle_conflict(school)
        if school and school["status"] != "deleted":
            return {"school_id": link["school_id"], "created": False}

    rows = db.table("school_directory").select(DIRECTORY_SELECT).eq("id", directory_id).execute().data or []
    if not rows:
        raise LookupError("directory school not found")
    entry = rows[0]

    same_symbol = (
        db.table("schools").select("id, name, status")
        .eq("org_id", org_id).eq("symbol", entry["symbol"]).neq("status", "deleted").execute().data or []
    )
    if same_symbol:
        school = same_symbol[0]
        if school["status"] == "pending_deletion":
            raise _recycle_conflict(school)
        _insert_link(db, org_id, school["id"], entry, "manual", actor_id)
        winner = _existing_link(db, org_id, directory_id)
        return {"school_id": (winner or {}).get("school_id", school["id"]), "created": False}

    payload = {
        **{k: v for k, v in copy_fields(entry).items() if v not in (None, "", [])},
        "org_id": org_id,
        "status": "directory",
        "meeting_coordinator": "principal",
    }
    new_school = db.table("schools").insert(payload).execute().data[0]
    if not _insert_link(db, org_id, new_school["id"], entry, "adopt", actor_id):
        # Lost a race with a concurrent adopt: keep the winner's copy, drop ours.
        winner = _existing_link(db, org_id, directory_id)
        if winner and winner["school_id"] != new_school["id"]:
            db.table("schools").delete().eq("id", new_school["id"]).execute()
            return {"school_id": winner["school_id"], "created": False}
        raise RuntimeError("directory link insert failed")

    school_activity.log_school_activity(
        db, school_id=new_school["id"], org_id=org_id, actor_id=actor_id,
        source="directory", action="created", after=new_school,
    )
    stage = SINGLE_LEVEL_STAGE.get(entry.get("ministry_stage") or "")
    if stage:
        try:
            import gefen_accounts
            from academic_years import DEFAULT_ACADEMIC_YEAR
            from routers.schools_router import _replace_gefen_accounts
            _replace_gefen_accounts(db, new_school["id"], DEFAULT_ACADEMIC_YEAR, [
                {"covers": c} for c in gefen_accounts.STAGE_ACCOUNTS[stage]
            ])
        except Exception as exc:
            logger.warning("directory adopt: gefen account for %s failed (non-fatal): %s", new_school["id"], exc)
    return {"school_id": new_school["id"], "created": True}


def _insert_link(db, org_id: str, school_id: str, entry: dict, via: str, actor_id: str | None) -> bool:
    try:
        db.table("school_directory_links").insert({
            "org_id": org_id, "school_id": school_id, "directory_id": entry["id"],
            "base": copy_fields(entry), "linked_via": via, "created_by": actor_id,
        }).execute()
        return True
    except Exception as exc:
        logger.info("directory link insert failed (org %s, entry %s): %s", org_id, entry["id"], exc)
        return False


# The "ללא מחוז" filter value (the directory's district comes from a separate, older file, so
# some entries have none).
NO_DISTRICT = "__none__"

_SEARCH_STRIP = re.compile(r"[,()*\\%]")
_QUOTE_CHARS = re.compile(r"[\"'׳״`]")


def _search_term(q: str | None) -> str:
    """Safe for a PostgREST or_() value. Quote marks become the one-character wildcard, so
    "ע"ש" / "ממ"ד" match whichever quote character the stored name uses."""
    term = _SEARCH_STRIP.sub(" ", q or "").strip()
    return _QUOTE_CHARS.sub("_", term)


def search_directory(db, org_id: str, q: str | None, filters: dict, page: int, page_size: int = 50) -> dict:
    """One page of the directory, each row merged with the org's own copy (whose values win)."""
    query = db.table("school_directory").select(DIRECTORY_SELECT, count="exact").is_("missing_since", "null")
    term = _search_term(q)
    if term:
        like = f"*{term}*"
        digits = re.sub(r"\D", "", term)
        parts = [f"name.ilike.{like}", f"symbol.ilike.{like}", f"city.ilike.{like}", f"principal_name.ilike.{like}"]
        if len(digits) >= 5:
            parts.append(f"phone.ilike.*{digits[-7:-4]}*{digits[-4:]}*")
        query = query.or_(",".join(parts))
    city = _search_term(filters.get("city"))
    if city:
        query = query.ilike("city", f"*{city}*")
    for key in ("education_authority", "ministry_stage", "supervision", "sector"):
        value = (filters.get(key) or "").strip()
        if value:
            query = query.eq(key, value)
    district = (filters.get("district") or "").strip()
    if district == NO_DISTRICT:
        query = query.is_("district", "null")
    elif district:
        query = query.eq("district", district)
    offset = max(page, 0) * page_size
    try:
        res = query.order("name").order("symbol").range(offset, offset + page_size - 1).execute()
    except Exception as exc:
        # A page past the end (results shrank between requests) is an empty page, not an error.
        if "PGRST103" not in str(exc):
            raise
        return {"items": [], "total": 0, "page": page, "page_size": page_size}
    entries = res.data or []
    total = res.count if res.count is not None else len(entries)

    links = {}
    if entries:
        link_rows = (
            db.table("school_directory_links").select("school_id, directory_id")
            .eq("org_id", org_id).in_("directory_id", [e["id"] for e in entries]).execute().data or []
        )
        links = {r["directory_id"]: r["school_id"] for r in link_rows}
    copies = {}
    if links:
        copy_rows = (
            db.table("schools").select(COPY_SELECT)
            .eq("org_id", org_id).in_("id", list(links.values())).execute().data or []
        )
        copies = {r["id"]: r for r in copy_rows}

    met = schools_with_meetings(db, [c["id"] for c in copies.values() if c.get("status") == "directory"])
    items = []
    for e in entries:
        copy = copies.get(links.get(e["id"]))
        if copy and copy.get("status") == "deleted":
            copy = None
        items.append(_merge_item(e, copy, met=bool(copy and copy["id"] in met)))
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def schools_with_meetings(db, school_ids: list[str]) -> set[str]:
    """Which of these schools have a real (scheduled / completed) meeting. Merely opening a
    directory school's card creates the org's copy, so a copy alone says nothing about contact."""
    if not school_ids:
        return set()
    rows = (
        db.table("meetings").select("school_id")
        .in_("school_id", school_ids).in_("status", ["scheduled", "completed"]).execute().data or []
    )
    return {r["school_id"] for r in rows}


def _merge_item(entry: dict, copy: dict | None, met: bool = False) -> dict:
    tag = "none"
    if copy:
        tag = {"active": "client", "pending_deletion": "recycle"}.get(copy["status"], "met" if met else "none")
    shown = copy or {}
    return {
        "directory_id": entry["id"],
        "school_id": copy["id"] if copy else None,
        "tag": tag,
        "name": shown.get("name") or entry["name"],
        "symbol": shown.get("symbol") or entry["symbol"],
        "city": shown.get("city") or entry.get("city"),
        "address": shown.get("address") or entry.get("address"),
        "phone": shown.get("school_phone") or entry.get("phone"),
        "principal_name": shown.get("principal_name") or entry.get("principal_name"),
        "ministry_stage": entry.get("ministry_stage"),
        "district": shown.get("district") or entry.get("district"),
        "supervision": entry.get("supervision"),
        "sector": entry.get("sector"),
        "education_authority": entry.get("education_authority"),
        "ownership_name": entry.get("ownership_name"),
        "grade_levels": entry.get("grade_levels") or [],
        "grades_raw": entry.get("grades_raw"),
    }


def met_copies(db, org_id: str, q: str | None, limit: int = 20) -> list[dict]:
    """The org's 'directory' copies that had meetings (not clients) matching `q` — listed
    first in the pickers' "מהמאגר" tab."""
    query = (
        db.table("schools").select("id, name, symbol, city")
        .eq("org_id", org_id).eq("status", "directory")
    )
    term = _search_term(q)
    if term:
        like = f"*{term}*"
        query = query.or_(f"name.ilike.{like},symbol.ilike.{like},city.ilike.{like}")
    copies = query.order("name").limit(200).execute().data or []
    met = schools_with_meetings(db, [c["id"] for c in copies])
    return [c for c in copies if c["id"] in met][:limit]


# ---------------------------------------------------------------------------
# An org's own file into its own copies ("ייבוא פרטים מקובץ של הארגון")
# ---------------------------------------------------------------------------
# Hebrew header (as the app labels the field, plus common variants) -> schools column.
ORG_IMPORT_COLUMNS = {
    "שם מוסד": "name", "עיר": "city", "יישוב": "city", "כתובת": "address", "מחוז": "district",
    "טלפון בית הספר": "school_phone", "טלפון": "school_phone",
    "שם מנהל/ת": "principal_name", "שם מנהל": "principal_name",
    "טלפון מנהל/ת": "principal_phone", "טלפון מנהל": "principal_phone",
    "מייל מנהל/ת": "principal_email", "מייל מנהל": "principal_email",
    "שם מנהלנ/ית": "secretary_name", "שם מנהלנית": "secretary_name", "שם מזכירה": "secretary_name",
    "טלפון מנהלנ/ית": "secretary_phone", "טלפון מנהלנית": "secretary_phone", "טלפון מזכירה": "secretary_phone",
    "מייל מנהלנ/ית": "secretary_email", "מייל מנהלנית": "secretary_email", "מייל מזכירה": "secretary_email",
    "שם אחראי/ת כספים": "finance_contact_name", "טלפון אחראי/ת כספים": "finance_contact_phone",
    "מייל אחראי/ת כספים": "finance_contact_email",
}


def _header_key(text) -> str:
    return re.sub(r"[\s\"'׳״]", "", _text(text) or "")


_ORG_IMPORT_BY_KEY = {_header_key(k): v for k, v in ORG_IMPORT_COLUMNS.items()}


def parse_org_import(rows: list) -> tuple[list[dict], list[str], list[str]]:
    """-> (records [{symbol, fields}], recognized column labels, problems). Empty cells are not
    part of `fields`, so they never erase anything."""
    if not rows:
        return [], [], ["הקובץ ריק"]
    header = list(rows[0])
    symbol_idx = next((i for i, h in enumerate(header) if _header_key(h) == "סמלמוסד"), None)
    if symbol_idx is None:
        return [], [], ['חסרה עמודת "סמל מוסד"']
    columns = {i: _ORG_IMPORT_BY_KEY[_header_key(h)] for i, h in enumerate(header) if _header_key(h) in _ORG_IMPORT_BY_KEY}
    if not columns:
        return [], [], ["לא נמצאה אף עמודה מוכרת מלבד סמל מוסד"]
    records, seen = [], set()
    for row in rows[1:]:
        if not row or symbol_idx >= len(row):
            continue
        symbol = _text(row[symbol_idx])
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        fields = {}
        for i, col in columns.items():
            value = _dash_is_empty(row[i]) if i < len(row) else None
            if value:
                fields[col] = value
        if fields:
            records.append({"symbol": symbol, "fields": fields})
    labels = [str(header[i]).strip() for i in columns]
    return records, labels, []


def org_import(db, org_id: str, records: list[dict], apply: bool, actor_id: str | None) -> dict:
    """Applies an org's file to its OWN copies only: creates the copy when needed, updates the
    given fields of 'directory' copies, and never touches the org's clients (status 'active') —
    those are listed as skipped. Symbols not in the directory are reported."""
    symbols = [r["symbol"] for r in records]
    directory = {
        d["symbol"]: d for d in (
            db.table("school_directory").select(DIRECTORY_SELECT).in_("symbol", symbols).execute().data or []
        )
    } if symbols else {}
    links = {
        link["directory_id"]: link["school_id"] for link in (
            db.table("school_directory_links").select("directory_id, school_id").eq("org_id", org_id)
            .in_("directory_id", [d["id"] for d in directory.values()]).execute().data or []
        )
    } if directory else {}
    own = {}
    if symbols:
        for s in db.table("schools").select("id, symbol, status").eq("org_id", org_id).in_("symbol", symbols).neq("status", "deleted").execute().data or []:
            own.setdefault((s.get("symbol") or "").strip(), s)

    plan = {"create": [], "update": [], "skipped_clients": [], "not_in_directory": []}
    for rec in records:
        entry = directory.get(rec["symbol"])
        if not entry:
            plan["not_in_directory"].append(rec["symbol"])
            continue
        school = own.get(rec["symbol"])
        if school and school["status"] != "directory":
            plan["skipped_clients"].append(rec["symbol"])
        elif school or links.get(entry["id"]):
            plan["update"].append((school["id"] if school else links[entry["id"]], rec))
        else:
            plan["create"].append((entry, rec))

    summary = {
        "rows": len(records), "create": len(plan["create"]), "update": len(plan["update"]),
        "skipped_clients": len(plan["skipped_clients"]), "not_in_directory": len(plan["not_in_directory"]),
        "not_in_directory_sample": plan["not_in_directory"][:20], "applied": apply,
    }
    if not apply:
        return summary

    # A whole-country file is thousands of rows: write in chunks, never one request per school.
    created_events = _bulk_create_copies(db, org_id, plan["create"], actor_id)
    before = school_activity.fetch_schools(db, [sid for sid, _ in plan["update"]])
    updates = [
        {"id": sid, "org_id": org_id, "name": (before.get(sid) or {}).get("name"), **rec["fields"]}
        for sid, rec in plan["update"] if before.get(sid)
    ]
    _bulk_upsert_uniform(db, "schools", updates, on_conflict="id")
    events = created_events + [
        {"school_id": u["id"], "org_id": org_id, "actor_id": actor_id, "source": "directory_org_import",
         "action": "updated", "before": before[u["id"]], "after": {**before[u["id"]], **u}}
        for u in updates
    ]
    school_activity.log_school_activity_bulk(db, events)
    return summary


def _bulk_upsert_uniform(db, table: str, rows: list[dict], on_conflict: str, chunk: int = 500) -> list[dict]:
    """PostgREST fills keys missing from some rows of a bulk write with NULL, so rows are grouped
    by their exact key set first — a column a row doesn't carry is never touched."""
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault(tuple(sorted(r)), []).append(r)
    out = []
    for group in groups.values():
        for i in range(0, len(group), chunk):
            q = db.table(table)
            q = q.upsert(group[i:i + chunk], on_conflict=on_conflict) if on_conflict else q.insert(group[i:i + chunk])
            out.extend(q.execute().data or [])
    return out


def _bulk_create_copies(db, org_id: str, items: list[tuple], actor_id: str | None) -> list[dict]:
    """Creates the org's 'directory' copies for (entry, rec) pairs in chunks, then their links.
    A link that loses a race with a concurrent adopt falls back to adopt's own rule (the
    winner's copy is kept, ours deleted). Returns school_activity 'created' events. Gefen
    accounts are left to the card (a school without accounts checks in one general area)."""
    if not items:
        return []
    rows = []
    for entry, rec in items:
        rows.append({
            **{k: v for k, v in copy_fields(entry).items() if v not in (None, "", [])},
            **rec["fields"],
            "org_id": org_id, "status": "directory", "meeting_coordinator": "principal",
        })
    inserted = _bulk_upsert_uniform(db, "schools", rows, on_conflict="")
    by_symbol = {s["symbol"]: s for s in inserted}
    links = [
        {"org_id": org_id, "school_id": by_symbol[entry["symbol"]]["id"], "directory_id": entry["id"],
         "base": copy_fields(entry), "linked_via": "import", "created_by": actor_id}
        for entry, _ in items if entry["symbol"] in by_symbol
    ]
    entry_by_id = {entry["id"]: entry for entry, _ in items}
    for i in range(0, len(links), 500):
        chunk = links[i:i + 500]
        try:
            db.table("school_directory_links").insert(chunk).execute()
        except Exception as exc:
            logger.info("org import: link chunk conflict, linking one by one: %s", exc)
            for link in chunk:
                if not _insert_link(db, org_id, link["school_id"], entry_by_id[link["directory_id"]], "import", actor_id):
                    db.table("schools").delete().eq("id", link["school_id"]).eq("status", "directory").execute()
                    by_symbol.pop(entry_by_id[link["directory_id"]]["symbol"], None)
    return [
        {"school_id": s["id"], "org_id": org_id, "actor_id": actor_id, "source": "directory_org_import",
         "action": "created", "after": s}
        for s in by_symbol.values()
    ]
