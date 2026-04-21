from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from auth import authenticate_user, create_access_token

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    if not authenticate_user(body.email, body.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(body.email)
    return {"token": token}
