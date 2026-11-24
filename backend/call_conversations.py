"""One conversation = counted once per school, however many provider records it left.

A call between two of our own users is logged by the provider twice, once per line, with
different ids and swapped sides (a "mirror"); a conference is logged as several overlapping
calls that share a participant. Pure functions over call dicts (calls_router._enrich_raw_calls)
or meeting_call_links rows — always over ONE school's calls: the same conversation linked to two
schools belongs to each of them.

Each side of a call is a key: "user:<id>" (one of our users) or "tel:<suffix>".
"""
from datetime import datetime, timezone

# Measured on 55 answered internal calls (2026-11): mirrors differ by up to 1 second.
MIRROR_TOLERANCE_SECONDS = 5
_OPPOSITE = {"outgoing": "incoming", "incoming": "outgoing"}


def phone_key(suffix: str | None) -> str | None:
    return f"tel:{suffix}" if suffix and len(suffix) >= 7 else None


def user_key(user_id) -> str | None:
    return f"user:{user_id}" if user_id else None


def start_ts(call: dict) -> float | None:
    raw = call.get("start_time") or call.get("call_time")
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _seconds(call: dict) -> int:
    return call.get("duration_seconds") or 0


def is_mirror(a: dict, b: dict) -> bool:
    """The same internal call as logged on the other side's line. Calls without side keys
    (links saved before they were recorded) never match."""
    if a.get("call_id") == b.get("call_id"):
        return False
    own, other = a.get("own_key"), a.get("other_key")
    if not own or not other or own == other or b.get("own_key") != other or b.get("other_key") != own:
        return False
    if a.get("direction") not in _OPPOSITE or _OPPOSITE[a["direction"]] != b.get("direction"):
        return False
    ta, tb = start_ts(a), start_ts(b)
    if ta is None or tb is None:
        return False
    return abs(ta - tb) <= MIRROR_TOLERANCE_SECONDS and abs(_seconds(a) - _seconds(b)) <= MIRROR_TOLERANCE_SECONDS


def find_mirror(call: dict, others: list[dict]) -> dict | None:
    return next((o for o in others if is_mirror(call, o)), None)


def collapse_mirrors(calls: list[dict], preferred_ids=frozenset()) -> tuple[list[dict], dict]:
    """(calls without the second record of each conversation, {kept call_id: [dropped call_ids]}).
    Kept: a preferred id, else the outgoing record. The original order is preserved."""
    by_pair: dict = {}
    for c in calls:
        if c.get("own_key") and c.get("other_key"):
            by_pair.setdefault(frozenset((c["own_key"], c["other_key"])), []).append(c)
    dropped: dict = {}
    dropped_ids: set = set()
    for group in by_pair.values():
        ordered = sorted(group, key=lambda c: (c["call_id"] not in preferred_ids, c.get("direction") != "outgoing", start_ts(c) or 0))
        kept: list = []  # records still without a twin (each has exactly one)
        for c in ordered:
            twin = find_mirror(c, kept)
            if twin:
                dropped.setdefault(twin["call_id"], []).append(c["call_id"])
                dropped_ids.add(c["call_id"])
                kept.remove(twin)
            else:
                kept.append(c)
    return [c for c in calls if c["call_id"] not in dropped_ids], dropped


def counted_seconds(calls: list[dict]) -> dict:
    """{call_id: seconds it adds to the school's total}: a mirror adds 0, and overlapping calls
    sharing one of our users (a conference) add together the time that actually passed.
    Simultaneous calls of different users are separate work and count in full."""
    kept, dropped = collapse_mirrors(calls)
    out = {cid: 0 for ids in dropped.values() for cid in ids}

    timed = sorted((c for c in kept if c.get("own_key") and start_ts(c) is not None), key=lambda c: (start_ts(c), -_seconds(c)))
    parent = list(range(len(timed)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    last_by_user: dict = {}  # user key -> (latest end, index)
    for i, c in enumerate(timed):
        start, end = start_ts(c), start_ts(c) + _seconds(c)
        for key in {c["own_key"], c.get("other_key")}:
            if not key or not key.startswith("user:"):
                continue
            prev = last_by_user.get(key)
            if prev and prev[0] > start:
                parent[root(i)] = root(prev[1])
            if not prev or end > prev[0]:
                last_by_user[key] = (end, i)

    covered: dict = {}  # conversation -> end of the time already counted
    for i, c in enumerate(timed):
        start, end, r = start_ts(c), start_ts(c) + _seconds(c), root(i)
        out[c["call_id"]] = int(max(0, end - max(start, covered.get(r, start))))
        covered[r] = max(end, covered.get(r, end))
    for c in kept:
        out.setdefault(c["call_id"], _seconds(c))
    return out


def link_as_call(link: dict, phone_suffix) -> dict:
    """A meeting_call_links row with the side keys the functions above read. Rows saved before
    own_key existed get none, so they are counted as they always were."""
    other = None
    if link.get("own_key"):
        other = user_key(link.get("counterpart_user_id")) or phone_key(phone_suffix(link.get("counterpart_phone")))
    return {**link, "other_key": other}
