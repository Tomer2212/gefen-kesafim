import secrets
from datetime import datetime, timedelta, timezone

from academic_years import DEFAULT_ACADEMIC_YEAR

UPLOAD_TOKEN_GRACE_DAYS = 3


def get_or_create_upload_token(db, meeting_id: str, meeting_date: str, grace_days: int = UPLOAD_TOKEN_GRACE_DAYS,
                               recipient_email: str | None = None, recipient_name: str | None = None,
                               division_scope: list[str] | None = None) -> str:
    """Reuses an unexpired token for this meeting + recipient + division scope if one exists,
    otherwise creates a new one. Tokens are reusable (not single-use). Each recipient gets
    their own link, showing only their divisions (division_scope; None = the whole meeting).
    Links from before per-recipient tokens have no recipient and keep working."""
    email = (recipient_email or "").strip().lower() or None
    scope = division_scope or None
    existing = (
        db.table("meeting_upload_tokens")
        .select("token, expires_at, recipient_email, division_scope")
        .eq("meeting_id", meeting_id)
        .order("created_at", desc=True)
        .execute()
    )
    now = datetime.now(timezone.utc)
    for row in existing.data or []:
        if row.get("recipient_email") == email and (row.get("division_scope") or None) == scope:
            expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
            if expires_at > now:
                return row["token"]
            break

    token = secrets.token_urlsafe(32)
    meeting_dt = datetime.fromisoformat(meeting_date).replace(tzinfo=timezone.utc)
    expires_at = meeting_dt + timedelta(days=grace_days)
    db.table("meeting_upload_tokens").insert({
        "meeting_id": meeting_id,
        "token": token,
        "expires_at": expires_at.isoformat(),
        "recipient_email": email,
        "recipient_name": recipient_name,
        "division_scope": scope,
    }).execute()
    return token

DIVISION_LABELS = {
    "tikkon": "חטיבה עליונה",
    "beinayim": "חטיבת ביניים",
    "yesodi": "יסודי",
    "other": "אחר",
}
BOTH_DIVISIONS_LABEL = "שתי החטיבות"

FINANCE_SOFTWARE_ONLY_KINDS = ("kesafim2000", "payscool", "schoolcash")

FINANCE_SOFTWARE_LABELS = {
    "kesafim2000": "כספים2000",
    "payscool": "פייסקול",
    "schoolcash": "סקולקאש",
}

# gefen_files_responsible slot -> school divisions. A six-year school's data can also hold a
# "yesodi" division, which belongs with the חט"ב responsible.
_SLOT_DIVISIONS = {"tichon": ["tikkon"], "beinayim": ["beinayim", "yesodi"]}


def recipient_division_scope(slots: list[str]) -> list[str] | None:
    """The divisions a file-request recipient answers for, given the responsible slots they
    hold on this meeting. None = the whole meeting: a school with no division split, or one
    person responsible for both divisions."""
    distinct = set(slots)
    if len(distinct) != 1:
        return None
    return _SLOT_DIVISIONS.get(distinct.pop())


def _division_key(division: str | None) -> str | None:
    # The file classifier only knows tikkon/beinayim (from report codes).
    return "beinayim" if division == "yesodi" else division


def file_divisions(uploaded_file: dict) -> set[str] | None:
    """Which divisions an uploaded file serves: what was detected from its content plus any
    advisor-confirmed extras. None = unknown (e.g. uploaded before files were classified)."""
    detected = uploaded_file.get("division_type")
    covered = {"tikkon", "beinayim"} if detected == "both" else ({detected} if detected else set())
    covered |= set(uploaded_file.get("covers_divisions") or [])
    return covered or None


def file_matches_scope(uploaded_file: dict, division_scope: list[str] | None) -> bool:
    """Whether a file is relevant to a recipient's divisions. Files are one shared pool per
    meeting, so this ignores who uploaded them. An unknown file is shown rather than hidden."""
    if not division_scope:
        return True
    covered = file_divisions(uploaded_file)
    return covered is None or bool(covered & {_division_key(d) for d in division_scope})


def _known_finance_software(fs: str | None) -> bool:
    # schools.finance_software may also be "other" (free-text software the file classifier
    # can't identify) — treated like "unknown" so the checklist falls back to the generic
    # finance item instead of a "(other)" item that could never be marked as received.
    return fs in FINANCE_SOFTWARE_ONLY_KINDS


def _finance_label(fs: str, budget_names: list[str], suffix: str = "") -> str:
    fs_label = FINANCE_SOFTWARE_LABELS.get(fs, fs)
    budgets_part = f" {', '.join(budget_names)}" if budget_names else ""
    return f"קובץ פירוט הוצאות{budgets_part} מתוכנת הכספים ({fs_label}){suffix}"


def _generic_checklist(school: dict, accounts: list[dict], division_scope: list[str] | None, multi_division: bool) -> dict:
    """No check history to go by for these divisions — ask generically."""
    scoped_accounts = [a for a in accounts if not division_scope or a.get("division_type") in division_scope]
    finance_softwares = sorted({a["finance_software"] for a in scoped_accounts if _known_finance_software(a.get("finance_software"))})
    if not finance_softwares and _known_finance_software(school.get("finance_software")):
        finance_softwares = [school["finance_software"]]

    item_division = division_scope[0] if division_scope else None
    if item_division:
        division_label = DIVISION_LABELS.get(item_division, item_division)
        tikhnun_label = f"קובץ תכנון ({division_label})"
        gefen_label = f"קובץ דיווח ביצוע (כלל התקציבים - {division_label})"
        finance_suffix = f" - {division_label}"
    else:
        tikhnun_label = "קובץ תכנון (כלל החטיבות)"
        gefen_label = "קובץ דיווח ביצוע (כלל התקציבים והחטיבות)"
        finance_suffix = ""

    items = [
        {"label": tikhnun_label, "kind": "tikhnun", "division_type": item_division, "budget_name": None},
        {"label": gefen_label, "kind": "gefen", "division_type": item_division, "budget_name": None},
    ]
    if finance_softwares:
        for fs in finance_softwares:
            items.append({"label": _finance_label(fs, [], finance_suffix), "kind": "finance", "division_type": item_division, "budget_name": None, "finance_software": fs})
    else:
        # Neither gefen_accounts nor the school itself has a finance_software on record —
        # still ask for *something*, generically, rather than silently dropping the
        # requirement entirely (matches this branch's whole "generic when unknown" intent).
        items.append({"label": f"קובץ מתוכנת הכספים{finance_suffix}", "kind": "finance", "division_type": item_division, "budget_name": None, "finance_software": None})
    return {
        "items": items,
        "no_baseline_this_year": True,
        "divisions": [a["division_type"] for a in scoped_accounts],
        "multi_division": multi_division,
    }


def build_upload_checklist(db, school: dict, academic_year: str | None = None, division_scope: list[str] | None = None) -> dict:
    """Builds the checklist of expected files for a school's meeting-upload
    request. Falls back to a generic checklist when there's no check_metrics
    data for the given academic_year yet (budgets can differ year to year,
    so history from other years is not used as a substitute). division_scope limits it to
    one recipient's divisions; None = the whole school."""
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

    # A scope exists only at a six-year school, whose one-division list must still tell files
    # of the other division apart, even if only one division has check history so far.
    all_divisions = {m["division_type"] for m in metrics if m.get("division_type")} or {a["division_type"] for a in accounts}
    multi_division = bool(division_scope) or len(all_divisions) > 1

    scoped_metrics = [m for m in metrics if not division_scope or m.get("division_type") in division_scope]
    if not scoped_metrics:
        return _generic_checklist(school, accounts, division_scope, multi_division)

    divisions = sorted({m["division_type"] for m in scoped_metrics if m.get("division_type")})
    show_suffix = len(divisions) > 1

    items = []
    for div in divisions:
        suffix = f" - {DIVISION_LABELS.get(div, div)}" if show_suffix else ""
        budgets = sorted({m["budget_name"] for m in scoped_metrics if m.get("division_type") == div and m.get("budget_name")})
        items.append({"label": f"תכנון{suffix}", "kind": "tikhnun", "division_type": div, "budget_name": None})
        for b in budgets:
            items.append({"label": f"דיווח ביצוע {b}{suffix}", "kind": "gefen", "division_type": div, "budget_name": b})

    # A whole-school finance item stays division-free; a scoped one must be answered for its own division.
    finance_division = divisions[0] if division_scope and divisions else None
    all_budgets = sorted({m["budget_name"] for m in scoped_metrics if m.get("budget_name")})
    finance_softwares = {a["finance_software"] for a in accounts if a.get("division_type") in divisions and _known_finance_software(a.get("finance_software"))}
    if not finance_softwares and _known_finance_software(school.get("finance_software")):
        finance_softwares = {school["finance_software"]}
    if finance_softwares:
        for fs in sorted(finance_softwares):
            items.append({"label": _finance_label(fs, all_budgets), "kind": "finance", "division_type": finance_division, "budget_name": None, "finance_software": fs})
    else:
        items.append({"label": "קובץ מתוכנת הכספים", "kind": "finance", "division_type": finance_division, "budget_name": None, "finance_software": None})

    return {"items": items, "no_baseline_this_year": False, "divisions": divisions, "multi_division": multi_division}


def file_type_label(identified_type: str | None, division_type: str | None, budgets: list[str] | None, multi_division: bool = False) -> str:
    """Human-readable Hebrew label for an uploaded file's classification, used
    in the advisor-facing uploaded-files table. multi_division adds which divisions a planning
    or finance file serves, which only means something at a six-year school."""
    both_part = f" - {BOTH_DIVISIONS_LABEL}" if multi_division and division_type == "both" else ""
    division_part = f" - {DIVISION_LABELS[division_type]}" if multi_division and division_type in DIVISION_LABELS else both_part
    if identified_type == "gefen":
        div_label = DIVISION_LABELS.get(division_type, "") if division_type else ""
        budgets_part = f" {', '.join(budgets)}" if budgets else ""
        return f"דיווח ביצוע{budgets_part}{' - ' + div_label if div_label else both_part}"
    if identified_type == "tikhnun":
        b = ", ".join(budgets) if budgets else ""
        return f"תכנון{' (' + b + ')' if b else ''}{division_part}"
    if identified_type in FINANCE_SOFTWARE_ONLY_KINDS:
        return f"קובץ פירוט הוצאות מ{FINANCE_SOFTWARE_LABELS.get(identified_type, identified_type)}{division_part}"
    return "לא זוהה"


def reusable_finance_file(item: dict, received_files: list[dict]) -> dict | None:
    """For a still-missing per-division finance item: an uploaded file of the same software
    that an advisor could confirm also serves this division. Detection can't always tell — a
    combined export looks single-division when the other division had no expenses."""
    if item.get("kind") != "finance" or not item.get("division_type"):
        return None
    software = item.get("finance_software")
    return next((
        f for f in received_files
        if f.get("identified_type") in FINANCE_SOFTWARE_ONLY_KINDS and (not software or f.get("identified_type") == software)
    ), None)


def compute_upload_comparison(checklist: dict, received_files: list[dict]) -> dict:
    """received_files: rows from meeting_upload_files (identified_type,
    division_type, budgets, covers_divisions). Purely a lightweight expected-vs-received diff —
    does NOT run the real reconciliation. Files are a shared pool for the meeting: a file
    counts for every division it serves, whoever uploaded it."""
    divisions_expected = checklist.get("divisions") or []
    tikhnun_needed = max(1, len(divisions_expected)) if divisions_expected else 1
    # A school with 0 or 1 real divisions (יסודי, or any non-six-year school) — the file
    # classifier's division_type ("tikkon"/"beinayim"/"both", from tikkon/beinayim report
    # codes) is a different vocabulary than the school's own division_type ("yesodi" etc.)
    # and can never match it directly. There's no ambiguity to resolve for such a school —
    # any successfully-identified gefen file is necessarily "the" division's file.
    is_multi_division = checklist.get("multi_division", len(divisions_expected) > 1)

    gefen_files = [f for f in received_files if f.get("identified_type") == "gefen"]
    gefen_unclear = any(not f.get("division_type") for f in gefen_files)

    tikhnun_files = [f for f in received_files if f.get("identified_type") == "tikhnun"]
    tikhnun_covered = {d for f in tikhnun_files for d in (file_divisions(f) or ())}
    # Unclassified planning files (uploaded before classification existed) keep the old
    # count-based rule: enough of them satisfy whatever no classified file covers.
    tikhnun_unknown_count = sum(1 for f in tikhnun_files if file_divisions(f) is None)
    tikhnun_uncovered_items = sum(
        1 for i in checklist["items"]
        if i["kind"] == "tikhnun" and _division_key(i.get("division_type")) not in tikhnun_covered
    )
    finance_files = [f for f in received_files if f.get("identified_type") in FINANCE_SOFTWARE_ONLY_KINDS]

    result_items = []
    for item in checklist["items"]:
        kind = item["kind"]
        div = item.get("division_type")
        div_key = _division_key(div)
        if kind == "tikhnun":
            if div and is_multi_division:
                received = div_key in tikhnun_covered or tikhnun_unknown_count >= tikhnun_uncovered_items
            else:
                received = len(tikhnun_files) >= tikhnun_needed
        elif kind == "gefen":
            budget = item.get("budget_name")
            matching_div_files = [
                f for f in gefen_files
                if not div or not is_multi_division or div_key in (file_divisions(f) or ())
            ]
            confirmed_budgets = {b for f in matching_div_files for b in (f.get("budgets") or [])}
            if not budget:
                received = bool(matching_div_files)
            elif budget in confirmed_budgets:
                received = True
            else:
                # Interim fallback until real per-file budget identification lands
                # (see zihuy_core.identify integration): an uploaded gefen file whose
                # budget couldn't be confirmed can provisionally satisfy at most one
                # still-missing budget item in its division, picked deterministically
                # (lowest budget name first) so one file is never double-counted.
                unconfirmed_count = sum(1 for f in matching_div_files if not f.get("budgets"))
                claimed_by_earlier_items = sum(
                    1 for i in checklist["items"]
                    if i["kind"] == "gefen" and i.get("division_type") == div
                    and i.get("budget_name") and i["budget_name"] < budget
                    and i["budget_name"] not in confirmed_budgets
                )
                received = unconfirmed_count > claimed_by_earlier_items
        elif kind == "finance":
            fs = item.get("finance_software")
            candidates = [f for f in finance_files if not fs or f["identified_type"] == fs]
            if div and is_multi_division:
                # An unclassified file (from before classification existed) still counts.
                candidates = [f for f in candidates if file_divisions(f) is None or div_key in file_divisions(f)]
            received = bool(candidates)
        else:
            received = False
        result_items.append({**item, "received": received})

    return {
        "items": result_items,
        "all_received": all(i["received"] for i in result_items),
        "no_baseline_this_year": checklist["no_baseline_this_year"],
        # Surfaced (not fatal) when a multi-division school got a gefen file whose division
        # couldn't be auto-detected — the secretary/advisor should double-check it by hand
        # rather than the item silently sitting as "not received" forever with no explanation.
        "gefen_division_unclear": is_multi_division and gefen_unclear,
    }
