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

from supabase_client import get_admin_client, reset_admin_client

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


def _get_profile(user_id: str) -> dict:
    now = time.monotonic()
    cached = _profile_cache.get(user_id)
    if cached and (now - cached["_cached_at"]) < _PROFILE_TTL:
        return cached

    for attempt in range(2):
        try:
            db = get_admin_client()
            profile = (
                db.table("profiles")
                .select("role, full_name, org_id, status, is_superadmin, onboarding_dismissed, notification_preferences")
                .eq("id", user_id)
                .single()
                .execute()
            )
            d = profile.data or {}
            result = {
                "role": d.get("role", "advisor"),
                "full_name": d.get("full_name", ""),
                "org_id": d.get("org_id"),
                "status": d.get("status", "active"),
                "is_superadmin": bool(d.get("is_superadmin", False)),
                "onboarding_dismissed": d.get("onboarding_dismissed") or {},
                "notification_preferences": d.get("notification_preferences") or {"meeting_reminder": True, "meeting_reminder_minutes": 10},
                "_cached_at": time.monotonic(),
            }
            _profile_cache[user_id] = result
            return result
        except Exception as exc:
            if attempt == 0:
                logger.warning("_get_profile attempt 1 failed for %s: %s — resetting and retrying", user_id, exc)
                reset_admin_client()
                time.sleep(0.05)
                fresh = _profile_cache.get(user_id)
                if fresh:
                    return fresh
            else:
                logger.warning("_get_profile failed after 2 attempts for %s: %s", user_id, exc)
                fresh = _profile_cache.get(user_id)
                if fresh:
                    return fresh
                return {"role": "advisor", "full_name": "", "org_id": None, "is_superadmin": False, "onboarding_dismissed": {}, "notification_preferences": {"meeting_reminder": True, "meeting_reminder_minutes": 10}, "_cached_at": time.monotonic()}


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
        import datetime as _dt
        public_key = _get_public_key()
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            audience="authenticated",
            leeway=_dt.timedelta(seconds=60),
        )
        user_id = payload.get("sub")
        email = payload.get("email", "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        logger.warning("JWT rejected — expired (token prefix=%s)", token[:20] if token else "?")
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("JWT rejected — invalid (%s): %s", type(exc).__name__, exc)
        raise HTTPException(status_code=401, detail="Invalid token")

    profile = _get_profile(user_id)

    return {
        "id": user_id,
        "email": email,
        "role": profile["role"],
        "full_name": profile["full_name"],
        "org_id": profile["org_id"],
        "status": profile["status"],
        "is_superadmin": profile["is_superadmin"],
        "onboarding_dismissed": profile["onboarding_dismissed"],
        "notification_preferences": profile["notification_preferences"],
    }
