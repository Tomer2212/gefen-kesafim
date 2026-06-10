import os
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

_client: Client | None = None


def get_admin_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        # Limit PostgREST queries to 30 s — default is 120 s which lets a hung
        # Supabase connection tie up a gunicorn worker for 2 minutes.
        _client = create_client(url, key, options=ClientOptions(postgrest_client_timeout=30))
    return _client
