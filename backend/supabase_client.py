import os
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

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
