import os
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

# postgrest-py hardcodes http2=True when building its httpx session (postgrest._sync.client.
# SyncPostgrestClient.create_session) — no ClientOptions/supabase-py parameter exposes this.
# Under FastAPI's default thread-pool execution of sync `def` routes, multiple threads end up
# writing HTTP/2 frames onto the SAME shared singleton connection concurrently without any
# coordination, which corrupts the h2 stream state — this is the actual root cause behind
# recurring "ConnectionTerminated", "Received pseudo-header in trailer", and Cloudflare 400s
# seen in uvicorn_dev_err.log (hundreds of occurrences), not a one-off blip. Monkeypatching
# create_session to force http2=False switches to plain HTTP/1.1 pooled connections, where each
# concurrent request safely gets its own connection from httpx's own thread-safe pool instead of
# sharing one multiplexed stream — must run before the first get_admin_client() call.
try:
    from postgrest._sync.client import SyncPostgrestClient as _SyncPostgrestClient

    def _create_session_http1(self, base_url, headers, timeout, verify=True, proxy=None):
        from postgrest.utils import SyncClient
        return SyncClient(
            base_url=base_url, headers=headers, timeout=timeout,
            verify=verify, proxy=proxy, follow_redirects=True, http2=False,
        )

    _SyncPostgrestClient.create_session = _create_session_http1
except Exception:
    pass  # best-effort — if postgrest's internals change shape, fall back to the library default


# ---------------------------------------------------------------------------
# Transparent fixes for two SILENT PostgREST limits, applied to every sync query's execute().
#
# 1. URL length — auto-chunking of large `.in_()` filters.
#    Filters travel in the request URL. Supabase's gateway rejects a URL carrying ~650+ UUIDs
#    in one `col=in.(...)` filter with a bare "400 Bad Request" — and most call sites treat
#    that as a non-fatal enrichment failure, so data silently goes missing (this is what hid
#    the inherited client_status of ~230 schools in the collection tab). Any `in.(...)` over
#    IN_FILTER_CHUNK_SIZE values is split into several requests and the results merged: rows
#    concatenated, `count` summed, `order` re-applied, top-level `limit`/`offset` applied to
#    the merged set. Only a positive `in.` is chunked — `not.in.` (an intersection, not a
#    union) passes through untouched.
#
# 2. Row cap — auto-pagination past db-max-rows.
#    PostgREST returns at most POSTGREST_MAX_ROWS rows per response and truncates the rest
#    with NO error (orgs already have 8,000+ meetings). When a GET comes back with exactly
#    that many rows — or the caller asked for more via .limit() — it is re-fetched in pages
#    of POSTGREST_MAX_ROWS until exhausted (or until the caller's limit is met). Pages are
#    ordered by the caller's `order` plus the table's primary key as a tie-breaker, so offset
#    paging never skips or repeats a row. A query that returns fewer rows costs nothing extra.
#
# Rather than fix ~200 call sites by hand (and rely on every future one remembering to), this
# is done once here. Single/maybe_single and RPC builders are separate classes and are not
# affected. `postgrest` is pinned in requirements.txt because this patches its internals;
# tests/test_in_filter_chunking.py and tests/test_row_cap_pagination.py guard it.
# ---------------------------------------------------------------------------
IN_FILTER_CHUNK_SIZE = 200
POSTGREST_MAX_ROWS = 1000          # Supabase project setting "Max rows" (db-max-rows)
_AUTO_PAGE_HARD_CAP = 200_000      # runaway guard: never pull more than this in one execute()

# Tables whose primary key is not a single "id" column (used as the paging tie-breaker).
# tests/test_row_cap_pagination.py fails if a table is added/changed without updating this.
TABLE_PRIMARY_KEYS = {
    "advisor_schools": ("advisor_id", "school_id"),
    "calendar_sync_locks": ("meeting_id",),
    "chatbot_usage_daily": ("user_id", "usage_date"),
    "org_outlook_send_counts": ("org_id", "send_date"),
    "person_task_name_overrides": ("task_id", "user_id"),
    "person_task_pins": ("task_id", "user_id"),
    "school_advisors_current": ("school_id", "advisor_id"),
    "school_advisors_district": ("school_id", "advisor_id"),
    "school_advisors_gefen": ("school_id", "advisor_id"),
    "task_opted_out_contacts": ("email",),
    "task_pins": ("task_id", "user_id"),
    "twilio_connections": ("org_id",),
}

try:
    import functools
    import logging
    from httpx import QueryParams as _QueryParams
    from postgrest._sync.request_builder import SyncQueryRequestBuilder as _SyncQueryRequestBuilder
    from postgrest.base_request_builder import APIResponse as _APIResponse

    _patch_logger = logging.getLogger(__name__)
    _original_execute = _SyncQueryRequestBuilder.execute

    def _split_in_values(inner: str) -> list[str]:
        """Split the body of `in.(a,b,"c,d")` on commas outside double quotes
        (postgrest's sanitize_param quotes values containing , : ( ))."""
        out, cur, quoted = [], [], False
        for ch in inner:
            if ch == '"':
                quoted = not quoted
            if ch == "," and not quoted:
                out.append("".join(cur))
                cur = []
            else:
                cur.append(ch)
        out.append("".join(cur))
        return out

    def _order_cmp(spec: list[tuple[str, bool, bool]]):
        # spec: [(column, desc, nulls_first)] — mirrors PostgREST's `order=` param.
        def cmp(a: dict, b: dict) -> int:
            for col, desc, nulls_first in spec:
                va, vb = a.get(col), b.get(col)
                if va == vb:
                    continue
                if va is None or vb is None:
                    return (-1 if va is None else 1) * (1 if nulls_first else -1)
                try:
                    r = -1 if va < vb else 1
                except TypeError:
                    r = -1 if str(va) < str(vb) else 1
                return -r if desc else r
            return 0
        return cmp

    def _parse_order(order: str) -> list[tuple[str, bool, bool]]:
        spec = []
        for part in order.split(","):
            bits = part.split(".")
            desc = "desc" in bits[1:]
            if "nullsfirst" in bits[1:]:
                nulls_first = True
            elif "nullslast" in bits[1:]:
                nulls_first = False
            else:
                nulls_first = desc  # Postgres default: NULLS LAST for ASC, NULLS FIRST for DESC
            spec.append((bits[0], desc, nulls_first))
        return spec

    def _sub_builder(self, items: list):
        return _SyncQueryRequestBuilder(
            self.session, self.path, self.http_method, self.headers, _QueryParams(items), self.json,
        )

    def _split_paging(items: list) -> tuple[list, int | None, int | None]:
        """Strip top-level limit/offset (PostgREST honours the LAST occurrence of each)."""
        limit = offset = None
        rest = []
        for k, v in items:
            if k == "limit":
                limit = int(v)
            elif k == "offset":
                offset = int(v)
            else:
                rest.append((k, v))
        return rest, limit, offset

    def _with_stable_order(self, items: list) -> list:
        """Caller's order (if any) + the table's primary key as a tie-breaker."""
        table = self.path.strip("/").split("?")[0]
        pk = TABLE_PRIMARY_KEYS.get(table, ("id",))
        existing = next((v for k, v in items if k == "order"), "")
        used = {part.split(".")[0] for part in existing.split(",") if part}
        extra = [f"{c}.asc" for c in pk if c not in used]
        order = ",".join([p for p in [existing] + extra if p])
        return [(k, v) for k, v in items if k != "order"] + [("order", order)]

    def _paged_get(self, items: list):
        """GET with auto-pagination past POSTGREST_MAX_ROWS (see header comment, part 2)."""
        rest, limit, offset = _split_paging(items)
        first = _original_execute(self)
        data = first.data
        if not isinstance(data, list) or len(data) < POSTGREST_MAX_ROWS or (limit is not None and len(data) >= limit):
            return first  # common case: nothing was truncated — zero extra cost

        ordered = _with_stable_order(self, rest)
        rows: list = []
        count = first.count
        off = offset or 0
        while True:
            want = POSTGREST_MAX_ROWS if limit is None else min(POSTGREST_MAX_ROWS, limit - len(rows))
            page = _original_execute(_sub_builder(self, ordered + [("offset", str(off)), ("limit", str(want))]))
            page_rows = page.data or []
            rows.extend(page_rows)
            if page.count is not None:
                count = page.count
            if len(page_rows) < want or (limit is not None and len(rows) >= limit):
                break
            if len(rows) >= _AUTO_PAGE_HARD_CAP:
                _patch_logger.error("auto-pagination hit hard cap (%d rows) on %s — result truncated",
                                    _AUTO_PAGE_HARD_CAP, self.path)
                break
            off += len(page_rows)
        return _APIResponse(data=rows, count=count)

    def _patched_execute(self):
        accept = self.headers.get("Accept") or ""
        if self.http_method not in ("GET", "HEAD", "PATCH", "DELETE") or "text/csv" in accept or "pgrst.plan" in accept:
            return _original_execute(self)
        items = list(self.params.multi_items())

        big_idx, values = None, None
        for i, (k, v) in enumerate(items):
            if isinstance(v, str) and v.startswith("in.(") and v.endswith(")") and v.count(",") >= IN_FILTER_CHUNK_SIZE:
                vals = _split_in_values(v[4:-1])
                if len(vals) > IN_FILTER_CHUNK_SIZE:
                    big_idx, values = i, vals
                    break

        if big_idx is None:
            return _paged_get(self, items) if self.http_method == "GET" else _original_execute(self)

        # --- part 1: chunk the oversized in.() filter ---
        col = items[big_idx][0]
        base, limit, offset = _split_paging([it for j, it in enumerate(items) if j != big_idx])
        if limit is not None:
            # each chunk needs at most offset+limit rows for the merged slice to be exact
            base.append(("limit", str((offset or 0) + limit)))
        rows: list = []
        total = None
        for i in range(0, len(values), IN_FILTER_CHUNK_SIZE):
            chunk = "in.(" + ",".join(values[i:i + IN_FILTER_CHUNK_SIZE]) + ")"
            res = _patched_execute(_sub_builder(self, base + [(col, chunk)]))  # recursive: pages + 2nd big in.()
            if isinstance(res.data, list):
                rows.extend(res.data)
            if res.count is not None:
                total = (total or 0) + res.count

        order = self.params.get("order")
        if order and rows:
            rows.sort(key=functools.cmp_to_key(_order_cmp(_parse_order(order))))
        if offset or limit is not None:
            start = offset or 0
            rows = rows[start:start + limit] if limit is not None else rows[start:]
        return _APIResponse(data=rows, count=total)

    _SyncQueryRequestBuilder.execute = _patched_execute
except Exception as _exc:  # pragma: no cover - only if postgrest's internals change shape
    import logging
    logging.getLogger(__name__).error(
        "postgrest execute() patch NOT applied — large id lists may fail and results may be "
        "silently capped at 1000 rows: %s", _exc
    )

_client: Client | None = None

# Fail fast: 3 s per query.
# Supabase REST responds in <500ms normally; 3s is enough for any legitimate query.
# Reduces cold-start penalty from 10s → 3s when a stale connection is encountered.
_POSTGREST_TIMEOUT = 3


def get_admin_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = create_client(url, key, options=ClientOptions(postgrest_client_timeout=_POSTGREST_TIMEOUT))
    return _client


def reset_admin_client() -> None:
    """Discard the current singleton so the next call creates a fresh httpx pool.
    Call after any network-level Supabase error to avoid retrying on a broken connection.
    """
    global _client
    _client = None
