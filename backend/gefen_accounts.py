"""A school's Gefen accounts ("חשבונות במערכת גפן") — the single source for how its checks,
goals, year closures and control letters split by account.

Each `gefen_accounts` row covers one or more grade layers (`covers`: yesodi / chativa /
elyona). Its `division_type` is derived from those layers and is unique per school for every
valid set of accounts (each layer belongs to at most one account):

    elyona only            -> tikkon
    elyona + another layer -> combined
    yesodi only            -> yesodi
    any other (no elyona)  -> beinayim   (chativa, or yesodi + chativa)

Report codes only tell "elyona" from "not elyona" (yesodi and chativa share their codes), so a
file maps to a "bucket" — tikkon or beinayim — and a bucket to an account. When a bucket holds
two accounts (e.g. separate yesodi and chativa accounts) only the tab the file was uploaded
from can tell them apart.

`schools.stage` is kept as a server-maintained mirror of the accounts (`derive_stage`) so every
"six-year" behavior keyed on stage == 'sheshshnati' (contacts, coordinators, meetings, tasks)
keeps working unchanged: a school is six-year when it has a separate elyona-only account AND a
separate non-elyona account.
"""

LAYERS = ("yesodi", "chativa", "elyona")
LAYER_LABELS = {"yesodi": "יסודי", "chativa": 'חט"ב', "elyona": "עליונה"}
MAX_ACCOUNTS = 3
DIVISION_ORDER = {"yesodi": 0, "beinayim": 1, "combined": 2, "tikkon": 3, "other": 4}

# Accounts saved before `covers` existed carry only a division_type.
_DEFAULT_COVERS = {
    "tikkon": ["elyona"],
    "beinayim": ["chativa"],
    "yesodi": ["yesodi"],
    "combined": ["chativa", "elyona"],
    "other": [],
}

# Legacy stage -> the accounts it implies (used by create_school and the migration).
STAGE_ACCOUNTS = {
    "yesodi": [["yesodi"]],
    "beinayim": [["chativa"]],
    "tikkon": [["elyona"]],
    "sheshshnati": [["chativa"], ["elyona"]],
}


def normalize_covers(covers) -> list[str]:
    s = set(covers or [])
    return [layer for layer in LAYERS if layer in s]


def division_type_for(covers) -> str:
    s = set(normalize_covers(covers))
    if s == {"elyona"}:
        return "tikkon"
    if "elyona" in s:
        return "combined"
    if s == {"yesodi"}:
        return "yesodi"
    return "beinayim"


def covers_label(covers) -> str:
    return " + ".join(LAYER_LABELS[layer] for layer in normalize_covers(covers))


def account_covers(account: dict) -> list[str]:
    covers = normalize_covers(account.get("covers"))
    return covers or list(_DEFAULT_COVERS.get(account.get("division_type") or "", []))


def account_label(account: dict) -> str:
    return covers_label(account_covers(account)) or (account.get("custom_label") or "")


def validate_covers_list(covers_list: list) -> str | None:
    """Hebrew error for an invalid set of accounts, else None."""
    if len(covers_list) > MAX_ACCOUNTS:
        return f"ניתן להגדיר עד {MAX_ACCOUNTS} חשבונות גפן"
    seen: set[str] = set()
    for covers in covers_list:
        layers = normalize_covers(covers)
        if not layers:
            return "יש לבחור לכל חשבון אילו שכבות הוא כולל"
        dup = seen.intersection(layers)
        if dup:
            return f"השכבה {LAYER_LABELS[sorted(dup)[0]]} מופיעה ביותר מחשבון אחד"
        seen.update(layers)
    return None


def sort_accounts(accounts: list[dict]) -> list[dict]:
    return sorted(accounts, key=lambda a: DIVISION_ORDER.get(a.get("division_type"), 9))


def derive_stage(accounts: list[dict]) -> str | None:
    divisions = {a.get("division_type") for a in accounts}
    if not divisions:
        return None
    if "tikkon" in divisions and divisions & {"beinayim", "yesodi"}:
        return "sheshshnati"
    if len(divisions) == 1:
        only = next(iter(divisions))
        return only if only in ("yesodi", "beinayim", "tikkon") else "other"
    return "other"


def buckets_of(account: dict) -> set[str]:
    """Which file divisions (as detected from report codes) an account can receive."""
    layers = set(account_covers(account))
    out = set()
    if "elyona" in layers:
        out.add("tikkon")
    if layers & {"yesodi", "chativa"}:
        out.add("beinayim")
    return out


def resolve_bucket_account(accounts: list[dict], bucket: str, tab_account_id: str | None) -> dict | None:
    """The account a file of `bucket` ('tikkon' / 'beinayim') belongs to: the tab's own account
    when it can hold that bucket, else the only account that can — None when ambiguous."""
    candidates = [a for a in accounts if bucket in buckets_of(a)]
    for a in candidates:
        if a.get("id") == tab_account_id:
            return a
    return candidates[0] if len(candidates) == 1 else None


def requested_bucket(account: dict | None) -> str | None:
    """The file division a tab expects, for the "wrong division" pre-check — None when the
    account holds both buckets (a combined account accepts either)."""
    if not account:
        return None
    buckets = buckets_of(account)
    return next(iter(buckets)) if len(buckets) == 1 else None


def rewrites_to_yesodi(account: dict | None) -> bool:
    """Rows the identifier tags "חטיבת ביניים" are really יסודי when the account's non-elyona
    part is יסודי alone (יסודי / יסודי + עליונה)."""
    if not account:
        return False
    layers = set(account_covers(account))
    return "yesodi" in layers and "chativa" not in layers


def fetch_accounts(db, school_id: str) -> list[dict]:
    rows = (
        db.table("gefen_accounts")
        .select("id, school_id, division_type, covers, custom_label, finance_software, tmura_model")
        .eq("school_id", school_id)
        .execute()
    ).data or []
    return sort_accounts(rows)


# ---------------------------------------------------------------------------
# Per academic year
# ---------------------------------------------------------------------------
# A year's accounts live in school_year_admin_data.year_gefen_accounts ([{division_type,
# covers}]); a year with NULL inherits the latest earlier year that has a value ([] = an
# explicit "no accounts"). The gefen_accounts table is the school's catalog: one row per
# division_type it ever had — the id checks point to, plus finance_software / tmura_model.
# A catalog row is never deleted for a removed account: the year's checks on it show as a
# read-only "archive" tab, and re-adding the account brings the tab back.

def covers_from_label(label: str) -> list[str]:
    by_label = {v: k for k, v in LAYER_LABELS.items()}
    return normalize_covers([by_label.get(part.strip()) for part in (label or "").split("+")])


def _years_up_to(academic_year: str) -> list[str]:
    from academic_years import ACADEMIC_YEARS
    if academic_year in ACADEMIC_YEARS:
        return ACADEMIC_YEARS[: ACADEMIC_YEARS.index(academic_year) + 1]
    return [academic_year]


def years_after(academic_year: str) -> list[str]:
    from academic_years import ACADEMIC_YEARS
    if academic_year in ACADEMIC_YEARS:
        return ACADEMIC_YEARS[ACADEMIC_YEARS.index(academic_year) + 1:]
    return []


def _year_entries(value) -> list[dict]:
    out = []
    for e in value or []:
        covers = normalize_covers((e or {}).get("covers"))
        if covers:
            out.append({"division_type": division_type_for(covers), "covers": covers})
    return out


def resolve_year_accounts_bulk(db, schools: list[dict], academic_year: str) -> dict[str, list[dict]]:
    """{school_id: [{division_type, covers}]} for `academic_year`. `schools` are dicts with
    id + stage. Fallback when no year has a value (a school saved before accounts were kept
    per year): its catalog rows, else what its stage implies."""
    ids = [s["id"] for s in schools if s.get("id")]
    if not ids:
        return {}
    years = _years_up_to(academic_year)
    rows = (
        db.table("school_year_admin_data").select("school_id, academic_year, year_gefen_accounts")
        .in_("school_id", ids).in_("academic_year", years).execute()
    ).data or []
    by_school: dict[str, dict] = {}
    for r in rows:
        by_school.setdefault(r["school_id"], {})[r["academic_year"]] = r.get("year_gefen_accounts")
    catalog = db.table("gefen_accounts").select("school_id, division_type, covers").in_("school_id", ids).execute().data or []
    catalog_by_school: dict[str, list[dict]] = {}
    for a in catalog:
        catalog_by_school.setdefault(a["school_id"], []).append(a)

    out: dict[str, list[dict]] = {}
    for s in schools:
        sid = s["id"]
        value = None
        for y in reversed(years):
            v = by_school.get(sid, {}).get(y)
            if v is not None:
                value = v
                break
        if value is not None:
            entries = _year_entries(value)
        elif catalog_by_school.get(sid):
            entries = [{"division_type": a["division_type"], "covers": account_covers(a)} for a in catalog_by_school[sid]]
        else:
            entries = [{"division_type": division_type_for(c), "covers": c} for c in STAGE_ACCOUNTS.get(s.get("stage") or "", [])]
        out[sid] = sort_accounts(entries)
    return out


def resolve_year_accounts(db, school_id: str, academic_year: str, stage: str | None = None) -> list[dict]:
    if stage is None:
        rows = db.table("schools").select("stage").eq("id", school_id).execute().data or []
        stage = (rows[0] if rows else {}).get("stage")
    return resolve_year_accounts_bulk(db, [{"id": school_id, "stage": stage}], academic_year).get(school_id, [])


def year_view(db, school_id: str, academic_year: str) -> dict:
    """{active, archived} for the year. active: the year's accounts joined to their catalog
    row (id None when none exists yet). archived: catalog accounts not active this year that
    have checks of this year. Each item carries label + checks_count (this year)."""
    active_entries = resolve_year_accounts(db, school_id, academic_year)
    catalog = {a["division_type"]: a for a in fetch_accounts(db, school_id)}
    counts: dict[str, int] = {}
    if catalog:
        logs = (
            db.table("check_logs").select("gefen_account_id")
            .eq("school_id", school_id).eq("academic_year", academic_year)
            .in_("gefen_account_id", [a["id"] for a in catalog.values()]).execute()
        ).data or []
        for r in logs:
            counts[r["gefen_account_id"]] = counts.get(r["gefen_account_id"], 0) + 1

    def item(division_type, covers, row, archived):
        return {
            "id": (row or {}).get("id"), "division_type": division_type, "covers": covers,
            "label": covers_label(covers), "archived": archived,
            "finance_software": (row or {}).get("finance_software"), "tmura_model": (row or {}).get("tmura_model"),
            "checks_count": counts.get((row or {}).get("id"), 0),
        }

    active_types = {e["division_type"] for e in active_entries}
    active = [item(e["division_type"], e["covers"], catalog.get(e["division_type"]), False) for e in active_entries]
    archived = [
        item(dt, account_covers(row), row, True)
        for dt, row in catalog.items()
        if dt not in active_types and counts.get(row["id"])
    ]
    return {"academic_year": academic_year, "active": active, "archived": sort_accounts(archived)}
