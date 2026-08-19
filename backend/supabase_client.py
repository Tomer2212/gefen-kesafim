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
