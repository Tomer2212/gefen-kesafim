from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from auth import authenticate_user, create_access_token

router = APIRouter()

MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 10

# { ip: {"count": int, "locked_until": datetime | None} }
_login_attempts: dict[str, dict] = {}


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


def _check_rate_limit(ip: str) -> None:
    entry = _login_attempts.get(ip)
    if not entry:
        return
    if entry.get("locked_until") and datetime.utcnow() < entry["locked_until"]:
        remaining = int((entry["locked_until"] - datetime.utcnow()).total_seconds() / 60) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"חשבון נחסם זמנית. נסה שוב בעוד {remaining} דקות.",
        )


def _record_failure(ip: str) -> None:
    entry = _login_attempts.setdefault(ip, {"count": 0, "locked_until": None})
    # Reset stale lockout
    if entry.get("locked_until") and datetime.utcnow() >= entry["locked_until"]:
        entry["count"] = 0
        entry["locked_until"] = None
    entry["count"] += 1
    if entry["count"] >= MAX_ATTEMPTS:
        entry["locked_until"] = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)


def _record_success(ip: str) -> None:
    _login_attempts.pop(ip, None)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request):
    ip = _get_client_ip(request)
    _check_rate_limit(ip)

    if not authenticate_user(body.email, body.password):
        _record_failure(ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    _record_success(ip)
    token = create_access_token(body.email)
    return {"token": token}
