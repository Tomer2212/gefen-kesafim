import os
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

_client: Client | None = None

# Fail fast: 10 s per query instead of 30 s.
# Frees the gunicorn worker 3× faster when Supabase is slow.
_POSTGREST_TIMEOUT = 10


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
