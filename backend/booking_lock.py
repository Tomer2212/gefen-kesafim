"""Public booking links — no two schools (or two clicks of one school) may book overlapping
times for the same advisor, even when they confirm at the same instant on different workers.

Two layers:
1. booking_locks(keys) — a Postgres-backed lock (table booking_slot_locks, same mechanism as
   graph_client.calendar_sync_lock) held around the booking's fresh re-check + insert, keyed per
   advisor+day ("adv:{id}:{date}") and per booking request ("range:{token}:{key}"). Keys are
   taken in sorted order so two bookings never wait on each other. Never in-process: the backend
   runs several workers.
2. keep_or_discard_booking — right after the insert, any other scheduled meeting overlapping one
   of the advisors decides who stays: the one created first (created_at, then id). Every request
   applies the same rule, so two that see each other agree on one winner and never both lose.
   This holds even if the lock was stolen from a stalled holder.
"""
import logging
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from supabase_client import get_admin_client

logger = logging.getLogger(__name__)

LOCK_STALE_SECONDS = 30   # the locked section is a few DB calls; a holder this old has died
LOCK_POLL_INTERVAL = 0.15
LOCK_MAX_WAIT = 15.0  # measured ~0.7s per hand-off on the live DB: ~20 schools at once on one advisor+day
BUSY_DETAIL = "יש עומס רגעי בקביעת פגישות. נסו שוב בעוד רגע."
TAKEN_DETAIL = "אופס.. הזמן הזה נתפס הרגע. נא לבחור מועד אחר."


def advisor_day_key(advisor_id: str, meeting_date: str) -> str:
    return f"adv:{advisor_id}:{meeting_date}"


def range_key(token_id: str, key: str) -> str:
    return f"range:{token_id}:{key}"


def _try_acquire(lock_key: str, holder: str) -> bool:
    try:
        db = get_admin_client()
        db.table("booking_slot_locks").insert({"lock_key": lock_key, "locked_by": holder}).execute()
        return True
    except Exception:
        pass  # held by someone else (primary key) — or a transient error; either way check staleness
    try:
        db = get_admin_client()
        now = datetime.now(timezone.utc)
        stolen = (
            db.table("booking_slot_locks")
            .update({"locked_at": now.isoformat(), "locked_by": holder})
            .eq("lock_key", lock_key)
            .lt("locked_at", (now - timedelta(seconds=LOCK_STALE_SECONDS)).isoformat())
            .execute()
        )
        return bool(stolen.data)
    except Exception as exc:
        logger.warning("booking lock: stale check failed for %s: %s", lock_key, exc)
        return False


def _release(lock_key: str, holder: str) -> None:
    try:
        db = get_admin_client()
        db.table("booking_slot_locks").delete().eq("lock_key", lock_key).eq("locked_by", holder).execute()
    except Exception as exc:
        logger.warning("booking lock: release failed for %s (expires on its own): %s", lock_key, exc)


@contextmanager
def booking_locks(keys: list[str], max_wait: float = LOCK_MAX_WAIT):
    """Holds every key for the duration of the block, or raises 503 (the booking must not go on
    unlocked) when they can't all be taken within max_wait seconds."""
    holder = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
    held: list[str] = []
    deadline = time.monotonic() + max_wait
    try:
        for lock_key in sorted(set(keys)):
            while not _try_acquire(lock_key, holder):
                if time.monotonic() >= deadline:
                    logger.warning("booking lock: %s not acquired within %.1fs", lock_key, max_wait)
                    raise HTTPException(status_code=503, detail=BUSY_DETAIL)
                time.sleep(LOCK_POLL_INTERVAL)
            held.append(lock_key)
        yield
    finally:
        for lock_key in reversed(held):
            _release(lock_key, holder)


def _overlaps(a: dict, b: dict) -> bool:
    return str(a["start_time"])[:5] < str(b["end_time"])[:5] and str(b["start_time"])[:5] < str(a["end_time"])[:5]


def _created_order(row: dict) -> tuple:
    try:
        created = datetime.fromisoformat(str(row.get("created_at")).replace("Z", "+00:00"))
    except ValueError:
        created = datetime.max.replace(tzinfo=timezone.utc)
    return created, str(row["id"])


def keep_or_discard_booking(db, meeting: dict, advisor_ids: list[str]) -> bool:
    """Called right after a booking's insert. False (and the new row deleted) when another
    scheduled meeting of one of these advisors overlaps it and was created first. A failed
    check keeps the booking: the lock already guards it, and cancelling a valid booking over a
    transient error would be worse."""
    try:
        rows = (
            db.table("meetings").select("id, start_time, end_time, advisor_ids, created_at")
            .eq("status", "scheduled").eq("meeting_date", meeting["meeting_date"])
            .execute().data or []
        )
    except Exception as exc:
        logger.warning("booking verify: overlap check failed for meeting %s (keeping it): %s", meeting.get("id"), exc)
        return True
    mine = _created_order(meeting)
    advisor_set = set(advisor_ids)
    earlier = [
        r for r in rows
        if r["id"] != meeting["id"] and not advisor_set.isdisjoint(r.get("advisor_ids") or [])
        and _overlaps(r, meeting) and _created_order(r) < mine
    ]
    if not earlier:
        return True
    logger.warning("booking verify: meeting %s overlaps earlier meeting %s — discarding it", meeting["id"], earlier[0]["id"])
    try:
        db.table("meetings").delete().eq("id", meeting["id"]).execute()
    except Exception as exc:
        # The row is still there, so the school must not be told it failed.
        logger.error("booking verify: could not delete overlapping meeting %s — kept, needs manual follow-up: %s",
                     meeting["id"], exc, exc_info=True)
        return True
    return False
