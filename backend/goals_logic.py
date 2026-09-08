"""Automatic "עמידה ביעד" (goal-met) updates for the יעדים tab, driven by check findings.

See the approved plan (shiny-percolating-falcon.md). Core rules:

- For every planning/reporting goal, compare the latest check's percentage
  (``pct_plan`` for planning goals, ``pct_tanuz`` for reporting goals) against
  ``goal_number`` — a bare number that means "percent" (40 => 40%). The check value is
  a fraction 0..1, so it is multiplied by 100 before the comparison.
- ``current >= target`` => מתג "כן", otherwise => "לא".
- Only while the goal's ``target_date`` has NOT passed (Asia/Jerusalem, date granularity).
  Once it passes the automation never touches ``met``/``notes`` for that goal again —
  the field becomes manual-only and the last note line is effectively "locked".
- Only when the org flag ``organizations.goal_auto_update_enabled`` is on.
- A change is written only on a *meaningful change* — the newly computed value differs
  from the goal's current ``met`` (regardless of whether that value came from a user or a
  previous check). First evaluation of an unset goal always counts. No change => nothing
  is written and no toast fires.
- Every change appends one line to ``school_goals.notes`` (an append-only audit log).
  Manual edits (``set_goal_status``) append their own line. Lines are only ever removed by
  ``reset_auto_goals_for_combo`` (last check for a division+budget deleted).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_IL_TZ = ZoneInfo("Asia/Jerusalem")


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def il_now() -> datetime:
    return datetime.now(_IL_TZ)


def _to_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def fmt_check_dt(iso: str | None) -> str:
    """Check timestamp as shown in the "בדיקות" table: ``DD/MM/YY - HH:MM`` (Jerusalem)."""
    dt = _to_dt(iso)
    if dt is None:
        return "—"
    loc = dt.astimezone(_IL_TZ)
    return f"{loc:%d/%m/%y} - {loc:%H:%M}"


def fmt_date_dmy(dt: datetime | None = None) -> str:
    d = (dt or il_now()).astimezone(_IL_TZ)
    return f"{d:%d/%m/%y}"


def _met_label(met: bool | None) -> str:
    if met is True:
        return "כן"
    if met is False:
        return "לא"
    return "לא הוזן"


def normalize_metric_rows(rows: list[dict] | None) -> list[dict]:
    """check_metrics uses ``budget_name="כללי"`` for a single-budget (non-split) school, but
    the יעדים tab / dashboard use ``"גפן"`` as the app-wide default budget for that same case
    (see GoalsTab.jsx). Rewrite in place so goal rows land where the UI reads them. Real
    multi-budget names (גפן already normalized, דוקאטי, תנופה, ...) are left untouched."""
    for r in rows or []:
        if r.get("budget_name") == "כללי":
            r["budget_name"] = "גפן"
    return rows or []


def build_manual_note_entry(full_name: str | None, met: bool | None) -> dict:
    """Note line appended whenever a user toggles the מתג by hand (via set_goal_status)."""
    name = (full_name or "").strip() or "משתמש"
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": "manual",
        "met": met,
        "text": f"עודכן על ידי {name} ל׳{_met_label(met)}׳ בתאריך {fmt_date_dmy()}",
    }


def _build_auto_note_entry(check_run_at: str | None, met: bool) -> dict:
    return {
        "ts": check_run_at,
        "source": "auto",
        "met": met,
        "text": f"עודכן באופן אוטומטי ל׳{_met_label(met)}׳ בהתאם לבדיקה מיום {fmt_check_dt(check_run_at)}",
    }


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

def _tracked_goal_defs():
    """planning/reporting goal definitions (the ones with a כן/לא toggle)."""
    from routers.schools_router import GOAL_DEFINITIONS  # lazy: avoid import cycle
    return [d for d in GOAL_DEFINITIONS if d["kind"] in ("planning", "reporting")]


def _target_date(goal_def: dict, academic_year: str) -> date | None:
    from routers.schools_router import _shift_goal_date  # lazy
    try:
        return date.fromisoformat(_shift_goal_date(goal_def, academic_year))
    except (ValueError, TypeError):
        return None


def _fetch_goal_rows(db, school_id: str, academic_year: str, combos: list[tuple[str, str]]) -> dict:
    """{(division_type, budget_name, goal_key): row} for the combos we're about to evaluate."""
    if not combos:
        return {}
    divisions = sorted({c[0] for c in combos})
    budgets = sorted({c[1] for c in combos})
    try:
        rows = (
            db.table("school_goals")
            .select("division_type, budget_name, goal_key, met, notes, auto_last_met, auto_last_check_at")
            .eq("school_id", school_id)
            .eq("academic_year", academic_year)
            .in_("division_type", divisions)
            .in_("budget_name", budgets)
            .execute()
            .data
        ) or []
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("goals_logic._fetch_goal_rows failed (non-fatal): %s", exc)
        return {}
    return {(r["division_type"], r["budget_name"], r["goal_key"]): r for r in rows}


def _current_pct(kind: str, metric_row: dict):
    """Fraction 0..1 from a check_metrics-shaped row, or None when this check has no data
    for that dimension (reporting/pct_tanuz is only present when a doch was analyzed)."""
    val = metric_row.get("pct_plan") if kind == "planning" else metric_row.get("pct_tanuz")
    try:
        return None if val is None else float(val)
    except (ValueError, TypeError):
        return None


def apply_goal_automation(
    db,
    *,
    school_id: str,
    metric_rows: list[dict],
    check_run_at: str | None,
    academic_year: str,
    org_flag_on: bool,
) -> list[dict]:
    """Evaluate every planning/reporting goal for each (division_type, budget_name) present
    in ``metric_rows`` (rows shaped like ``check_metrics`` — need ``division_type``,
    ``budget_name``, ``pct_plan`` and optionally ``pct_tanuz``).

    Writes only meaningful changes to ``school_goals`` and returns a list of change
    descriptors ``{goal_key, division_type, budget_name, label, met}`` for the caller to
    turn into a single summary toast. Fully non-fatal — never raises.
    """
    if not org_flag_on or not metric_rows:
        return []

    changes: list[dict] = []
    try:
        tracked = _tracked_goal_defs()
        today_il = il_now().date()

        # De-dupe combos; keep the first metric row seen per combo.
        combo_row: dict[tuple[str, str], dict] = {}
        for mr in metric_rows:
            dt_, bn = mr.get("division_type"), mr.get("budget_name")
            if dt_ and bn and (dt_, bn) not in combo_row:
                combo_row[(dt_, bn)] = mr

        existing = _fetch_goal_rows(db, school_id, academic_year, list(combo_row.keys()))
        now_iso = datetime.now(timezone.utc).isoformat()

        for (division_type, budget_name), mr in combo_row.items():
            for gdef in tracked:
                tgt = _target_date(gdef, academic_year)
                if tgt is None or today_il > tgt:
                    continue  # frozen once the target date has passed
                pct = _current_pct(gdef["kind"], mr)
                if pct is None:
                    continue  # this check carries no value for this goal
                new_met = round(pct * 100, 6) >= gdef["goal_number"]

                row = existing.get((division_type, budget_name, gdef["key"]))
                cur_met = row.get("met") if row else None
                if new_met == cur_met:
                    continue  # not a meaningful change

                notes = list(row.get("notes") or []) if row else []
                notes.append(_build_auto_note_entry(check_run_at, new_met))
                try:
                    db.table("school_goals").upsert(
                        {
                            "school_id": school_id,
                            "division_type": division_type,
                            "budget_name": budget_name,
                            "goal_key": gdef["key"],
                            "goal_type": gdef["kind"],
                            "goal_number": gdef["goal_number"],
                            "academic_year": academic_year,
                            "met": new_met,
                            "auto_last_met": new_met,
                            "auto_last_check_at": check_run_at,
                            "notes": notes,
                            "updated_at": now_iso,
                        },
                        on_conflict="school_id,division_type,budget_name,goal_key,academic_year",
                    ).execute()
                except Exception as exc:
                    logger.warning("goals_logic upsert failed for %s/%s/%s (non-fatal): %s",
                                   division_type, budget_name, gdef["key"], exc)
                    continue

                changes.append({
                    "goal_key": gdef["key"],
                    "division_type": division_type,
                    "budget_name": budget_name,
                    "label": gdef["label"],
                    "met": new_met,
                })
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("apply_goal_automation failed (non-fatal): %s", exc)

    return changes


def reset_auto_goals_for_combo(db, school_id: str, division_type: str, budget_name: str, academic_year: str) -> None:
    """No check remains for this (division, budget): drop auto note lines and clear the
    automation-set state. Manual note lines are kept; ``met`` falls back to the last manual
    line's value, else NULL ("לא הוזן"). Non-fatal."""
    try:
        rows = (
            db.table("school_goals")
            .select("id, goal_key, met, notes, auto_last_met")
            .eq("school_id", school_id)
            .eq("academic_year", academic_year)
            .eq("division_type", division_type)
            .eq("budget_name", budget_name)
            .execute()
            .data
        ) or []
    except Exception as exc:
        logger.warning("reset_auto_goals_for_combo read failed (non-fatal): %s", exc)
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    for r in rows:
        notes = r.get("notes") or []
        has_auto = any((n or {}).get("source") == "auto" for n in notes) or r.get("auto_last_met") is not None
        if not has_auto:
            continue
        manual_notes = [n for n in notes if (n or {}).get("source") == "manual"]
        fallback_met = manual_notes[-1].get("met") if manual_notes else None
        try:
            db.table("school_goals").update({
                "met": fallback_met,
                "auto_last_met": None,
                "auto_last_check_at": None,
                "notes": manual_notes,
                "updated_at": now_iso,
            }).eq("id", r["id"]).execute()
        except Exception as exc:
            logger.warning("reset_auto_goals_for_combo update failed for %s (non-fatal): %s", r.get("goal_key"), exc)
