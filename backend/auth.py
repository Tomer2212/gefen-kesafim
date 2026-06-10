import json
import logging
import os
import threading
import time
import urllib.request

logger = logging.getLogger(__name__)
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from supabase_client import get_admin_client

_security = HTTPBearer()

# ---------------------------------------------------------------------------
# JWKS cache — public key fetched once from Supabase, refreshed every hour
# ---------------------------------------------------------------------------
_jwks_key = None
_jwks_fetched_at = 0.0
_JWKS_TTL = 3600
_jwks_lock = threading.Lock()  # prevents concurrent fetches on cold start


def _get_public_key():
    """Fetch (and cache) the active signing public key from Supabase's JWKS endpoint."""
    global _jwks_key, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_key and (now - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_key

    with _jwks_lock:
        # Re-check after acquiring lock — another thread may have fetched it already
        now = time.monotonic()
        if _jwks_key and (now - _jwks_fetched_at) < _JWKS_TTL:
            return _jwks_key

        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"

        try:
            with urllib.request.urlopen(jwks_url, timeout=10) as resp:
                jwks = json.loads(resp.read())
            key_data = jwks["keys"][0]
            from jwt.algorithms import ECAlgorithm
            _jwks_key = ECAlgorithm.from_jwk(json.dumps(key_data))
            _jwks_fetched_at = now
        except Exception as exc:
            if _jwks_key:
                # Return stale key rather than crashing on a transient network hiccup
                return _jwks_key
            raise RuntimeError(f"Could not fetch Supabase JWKS: {exc}")

    return _jwks_key


# ---------------------------------------------------------------------------
# Profile cache — avoid a DB round-trip on every request
# ---------------------------------------------------------------------------
_profile_cache: dict = {}
_PROFILE_TTL = 300  # 5 minutes


def _get_profile(user_id: str) -> tuple[str, str]:
    now = time.monotonic()
    cached = _profile_cache.get(user_id)
    if cached and (now - cached[2]) < _PROFILE_TTL:
        return cached[0], cached[1]

    try:
        db = get_admin_client()
        profile = (
            db.table("profiles")
            .select("role, full_name")
            .eq("id", user_id)
            .single()
            .execute()
        )
        role = profile.data.get("role", "advisor") if profile.data else "advisor"
        full_name = profile.data.get("full_name", "") if profile.data else ""
        _profile_cache[user_id] = (role, full_name, now)
        return role, full_name
    except Exception as exc:
        logger.warning("_get_profile DB query failed for %s: %s", user_id, exc)
        # A concurrent call may have already written the correct role to the cache
        # (common when 4+ requests arrive simultaneously on a cold server start).
        fresh = _profile_cache.get(user_id)
        if fresh:
            return fresh[0], fresh[1]
        return "advisor", ""


def invalidate_profile_cache(user_id: str) -> None:
    """Call after changing a user's role so the new role takes effect immediately."""
    _profile_cache.pop(user_id, None)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
) -> dict:
    token = credentials.credentials

    try:
        public_key = _get_public_key()
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            audience="authenticated",
        )
        user_id = payload.get("sub")
        email = payload.get("email", "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    role, full_name = _get_profile(user_id)

    return {
        "id": user_id,
        "email": email,
        "role": role,
        "full_name": full_name,
    }
