import os
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from database import get_db
from models import User
from auth import hash_password, verify_password, create_token, get_current_user
from limiter import limiter
from services.crypto import encrypt_field, decrypt_field

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
router = APIRouter(prefix="/auth", tags=["auth"])


def _setup_complete(user: User) -> bool:
    has_send_creds = bool(user.gmail_refresh_token or user.gmail_app_password)
    # AI key is optional — OpenRouter is a shared server-level fallback
    return bool(user.full_name and user.gmail_address and has_send_creds)


def _user_response(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "is_admin": user.is_admin,
        "setup_complete": _setup_complete(user),
    }


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str


class ProfileUpdate(BaseModel):
    # Gmail
    gmail_address: Optional[str] = None
    gmail_app_password: Optional[str] = None
    # AI keys
    gemini_api_key: Optional[str] = None
    gemini_api_keys: Optional[list[str]] = None
    claude_api_key: Optional[str] = None
    # Personal info
    full_name: Optional[str] = None
    phone: Optional[str] = None
    portfolio_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    college: Optional[str] = None
    current_role: Optional[str] = None
    current_company: Optional[str] = None
    graduation_month_year: Optional[str] = None
    target_role: Optional[str] = None
    background_text: Optional[str] = None
    projects_json: Optional[str] = None  # JSON string


@router.post("/signup", status_code=201)
@limiter.limit("5/minute")
def signup(request: Request, data: SignupRequest, db: Session = Depends(get_db)):
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = db.query(User).filter(User.email == data.email.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=data.email.lower(), password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_token(user.id, user.email), "user": _user_response(user)}


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": create_token(user.id, user.email), "user": _user_response(user)}


@router.post("/google")
@limiter.limit("20/minute")
def google_auth(request: Request, data: GoogleAuthRequest, db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google auth not configured on server")
    try:
        idinfo = google_id_token.verify_oauth2_token(
            data.credential, google_requests.Request(), GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

    email = idinfo.get("email", "").lower()
    google_sub = idinfo.get("sub")
    if not email:
        raise HTTPException(status_code=400, detail="No email returned from Google")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Pre-fill full_name from Google profile if available
        user = User(email=email, google_sub=google_sub, full_name=idinfo.get("name"))
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.google_sub:
        user.google_sub = google_sub
        db.commit()

    return {"token": create_token(user.id, user.email), "user": _user_response(user)}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)


@router.get("/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    projects = []
    if current_user.projects_json:
        try:
            projects = json.loads(current_user.projects_json)
        except Exception:
            projects = []
    return {
        "gmail_address": current_user.gmail_address or "",
        "has_gmail_password": bool(current_user.gmail_app_password),
        "has_gmail_connected": bool(current_user.gmail_refresh_token),
        "has_gemini_key": bool(current_user.gemini_api_key or current_user.gemini_keys_json),
        "has_claude_key": bool(current_user.claude_api_key),
        "full_name": current_user.full_name or "",
        "phone": current_user.phone or "",
        "portfolio_url": current_user.portfolio_url or "",
        "linkedin_url": current_user.linkedin_url or "",
        "college": current_user.college or "",
        "current_role": current_user.current_role or "",
        "current_company": current_user.current_company or "",
        "graduation_month_year": current_user.graduation_month_year or "",
        "target_role": current_user.target_role or "",
        "background_text": current_user.background_text or "",
        "projects": projects,
        "setup_complete": _setup_complete(current_user),
    }


@router.put("/profile")
def update_profile(data: ProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.gmail_address is not None:
        current_user.gmail_address = data.gmail_address
    if data.gmail_app_password is not None and data.gmail_app_password != "":
        current_user.gmail_app_password = encrypt_field(data.gmail_app_password)
    # Gemini keys: append new keys to any existing ones
    new_gemini_keys = []
    if data.gemini_api_key is not None and data.gemini_api_key != "":
        new_gemini_keys.append(data.gemini_api_key.strip())
    if data.gemini_api_keys:
        new_gemini_keys.extend([k.strip() for k in data.gemini_api_keys if k and k.strip()])
    if new_gemini_keys:
        existing_keys = []
        if current_user.gemini_api_key:
            existing_keys.append(decrypt_field(current_user.gemini_api_key))
        if current_user.gemini_keys_json:
            try:
                raw = json.loads(current_user.gemini_keys_json)
                for enc in raw:
                    if enc:
                        existing_keys.append(decrypt_field(enc))
            except Exception:
                pass
        combined = []
        seen = set()
        for key in existing_keys + new_gemini_keys:
            if key and key not in seen:
                seen.add(key)
                combined.append(key)
        current_user.gemini_keys_json = json.dumps([encrypt_field(k) for k in combined])
        if combined:
            current_user.gemini_api_key = encrypt_field(combined[0])
    if data.claude_api_key is not None and data.claude_api_key != "":
        current_user.claude_api_key = encrypt_field(data.claude_api_key)
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.phone is not None:
        current_user.phone = data.phone
    if data.portfolio_url is not None:
        current_user.portfolio_url = data.portfolio_url
    if data.linkedin_url is not None:
        current_user.linkedin_url = data.linkedin_url
    if data.college is not None:
        current_user.college = data.college
    if data.current_role is not None:
        current_user.current_role = data.current_role
    if data.current_company is not None:
        current_user.current_company = data.current_company
    if data.graduation_month_year is not None:
        current_user.graduation_month_year = data.graduation_month_year
    if data.target_role is not None:
        current_user.target_role = data.target_role
    if data.background_text is not None:
        current_user.background_text = data.background_text
    if data.projects_json is not None:
        current_user.projects_json = data.projects_json
    db.commit()
    return {"ok": True, "setup_complete": _setup_complete(current_user)}


# Keep old endpoint for backwards compatibility
@router.put("/credentials")
def update_credentials(data: ProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return update_profile(data, current_user, db)


class GmailConnectRequest(BaseModel):
    code: str


@router.post("/gmail-connect")
def gmail_connect(data: GmailConnectRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Exchange a Google OAuth2 auth-code (with gmail.send scope) for a refresh token and store it."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not client_secret:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_SECRET not configured on server")

    post_data = urllib.parse.urlencode({
        "code": data.code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": "postmessage",
        "grant_type": "authorization_code",
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=post_data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            tokens = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {body}")

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="No refresh_token returned by Google. Make sure 'access_type=offline' and 'prompt=consent' are set.",
        )

    current_user.gmail_refresh_token = encrypt_field(refresh_token)
    db.commit()
    return {"ok": True, "message": "Gmail connected successfully"}
