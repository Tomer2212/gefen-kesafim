import secrets
from datetime import datetime, timedelta, timezone

from academic_years import DEFAULT_ACADEMIC_YEAR

UPLOAD_TOKEN_GRACE_DAYS = 3


def get_or_create_upload_token(db, meeting_id: str, meeting_date: str, grace_days: int = UPLOAD_TOKEN_GRACE_DAYS) -> str:
    """Reuses an unexpired token for this meeting if one exists, otherwise
    creates a new one. Tokens are reusable (not single-use)."""
    existing = (
        db.table("meeting_upload_tokens")
        .select("token, expires_at")
        .eq("meeting_id", meeting_id)
        .order("created_at", desc=True)
        .execute()
    )
    now = datetime.now(timezone.utc)
    if existing.data:
        row = existing.data[0]
        expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        if expires_at > now:
            return row["token"]

    token = secrets.token_urlsafe(32)
    meeting_dt = datetime.fromisoformat(meeting_date).replace(tzinfo=timezone.utc)
    expires_at = meeting_dt + timedelta(days=grace_days)
    db.table("meeting_upload_tokens").insert({
        "meeting_id": meeting_id,
        "token": token,
        "expires_at": expires_at.isoformat(),
    }).execute()
    return token

DIVISION_LABELS = {
    "tikkon": "חטיבה עליונה",
    "beinayim": "חטיבת ביניים",
    "yesodi": "יסודי",
    "other": "אחר",
}

FINANCE_SOFTWARE_ONLY_KINDS = ("kesafim2000", "payscool", "schoolcash")


def build_upload_checklist(db, school: dict, academic_year: str | None = None) -> dict:
    """Builds the checklist of expected files for a school's meeting-upload
    request. Falls back to a generic checklist when there's no check_metrics
    data for the given academic_year yet (budgets can differ year to year,
    so history from other years is not used as a substitute)."""
    academic_year = academic_year or DEFAULT_ACADEMIC_YEAR
    school_id = school["id"]

    accounts_res = db.table("gefen_accounts").select("division_type, finance_software").eq("school_id", school_id).execute()
    accounts = accounts_res.data or []

    metrics_res = (
        db.table("check_metrics")
        .select("division_type, budget_name")
        .eq("school_id", school_id)
        .eq("academic_year", academic_year)
        .execute()
    )
    metrics = metrics_res.data or []

    if not metrics:
        finance_softwares = sorted({a["finance_software"] for a in accounts if a.get("finance_software")})
        if not finance_softwares and school.get("finance_software"):
            finance_softwares = [school["finance_software"]]
        items = [
            {"label": "קובץ תכנון (כלל החטיבות)", "kind": "tikhnun", "division_type": None, "budget_name": None},
            {"label": "קובץ דיווח ביצוע (כלל התקציבים והחטיבות)", "kind": "gefen", "division_type": None, "budget_name": None},
        ]
        for fs in finance_softwares:
            items.append({"label": f"קובץ כספים לפי תקציב וחטיבה ({fs})", "kind": "finance", "division_type": None, "budget_name": None})
        return {"items": items, "no_baseline_this_year": True, "divisions": [a["division_type"] for a in accounts]}

    divisions = sorted({m["division_type"] for m in metrics if m.get("division_type")})
    show_suffix = len(divisions) > 1

    items = []
    for div in divisions:
        suffix = f" - {DIVISION_LABELS.get(div, div)}" if show_suffix else ""
        budgets = sorted({m["budget_name"] for m in metrics if m.get("division_type") == div and m.get("budget_name")})
        for b in budgets:
            items.append({"label": f"תכנון {b}{suffix}", "kind": "tikhnun", "division_type": div, "budget_name": b})
        items.append({"label": f"דיווח ביצוע{suffix}", "kind": "gefen", "division_type": div, "budget_name": None})

    finance_softwares = {a["finance_software"] for a in accounts if a.get("division_type") in divisions and a.get("finance_software")}
    if not finance_softwares and school.get("finance_software"):
        finance_softwares = {school["finance_software"]}
    for fs in sorted(finance_softwares):
        items.append({"label": f"קובץ כספים ({fs})", "kind": "finance", "division_type": None, "budget_name": None})

    return {"items": items, "no_baseline_this_year": False, "divisions": divisions}


FINANCE_SOFTWARE_LABELS = {
    "kesafim2000": "כספים2000",
    "payscool": "פייסקול",
    "schoolcash": "סקולקאש",
}


def file_type_label(identified_type: str | None, division_type: str | None, budgets: list[str] | None) -> str:
    """Human-readable Hebrew label for an uploaded file's classification, used
    in the advisor-facing uploaded-files table."""
    if identified_type == "gefen":
        div_label = DIVISION_LABELS.get(division_type, "") if division_type else ""
        return f"דיווח ביצוע{' - ' + div_label if div_label else ''}"
    if identified_type == "tikhnun":
        b = ", ".join(budgets) if budgets else ""
        return f"תכנון{' (' + b + ')' if b else ''}"
    if identified_type in FINANCE_SOFTWARE_ONLY_KINDS:
        return f"קובץ כספים ({FINANCE_SOFTWARE_LABELS.get(identified_type, identified_type)})"
    return "לא זוהה"


def compute_upload_comparison(checklist: dict, received_files: list[dict]) -> dict:
    """received_files: rows from meeting_upload_files (identified_type,
    division_type, budgets). Purely a lightweight expected-vs-received diff —
    does NOT run the real reconciliation."""
    divisions_expected = checklist.get("divisions") or []
    tikhnun_needed = max(1, len(divisions_expected)) if divisions_expected else 1

    gefen_divisions_received = {
        f["division_type"] for f in received_files
        if f.get("identified_type") == "gefen" and f.get("division_type")
    }
    tikhnun_received_count = sum(1 for f in received_files if f.get("identified_type") == "tikhnun")
    tikhnun_budgets_received = set()
    for f in received_files:
        if f.get("identified_type") == "tikhnun":
            for b in (f.get("budgets") or []):
                tikhnun_budgets_received.add(b)
    finance_types_received = {
        f["identified_type"] for f in received_files
        if f.get("identified_type") in FINANCE_SOFTWARE_ONLY_KINDS
    }

    result_items = []
    for item in checklist["items"]:
        kind = item["kind"]
        if kind == "tikhnun":
            budget = item.get("budget_name")
            if budget:
                received = budget in tikhnun_budgets_received and tikhnun_received_count >= tikhnun_needed
            else:
                received = tikhnun_received_count >= tikhnun_needed
        elif kind == "gefen":
            div = item.get("division_type")
            received = (div in gefen_divisions_received) if div else (len(gefen_divisions_received) >= tikhnun_needed)
        elif kind == "finance":
            received = len(finance_types_received) > 0
        else:
            received = False
        result_items.append({**item, "received": received})

    return {
        "items": result_items,
        "all_received": all(i["received"] for i in result_items),
        "no_baseline_this_year": checklist["no_baseline_this_year"],
    }
