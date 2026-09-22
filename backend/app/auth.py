from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "users.db"
SECRET_PATH = DATA_DIR / ".secret"

TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days
PBKDF2_ROUNDS = 200_000
ALLOW_REGISTER = os.getenv("GRD_ALLOW_REGISTER", "1") == "1"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def _load_secret() -> bytes:
    env = os.getenv("GRD_SECRET_KEY")
    if env:
        return env.encode()
    if not SECRET_PATH.exists():
        SECRET_PATH.write_text(secrets.token_hex(32))
    return SECRET_PATH.read_text().strip().encode()


SECRET = _load_secret()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        "username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL)"
    )
    return conn


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS).hex()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def create_token(username: str) -> str:
    payload = _b64(json.dumps({"sub": username, "exp": int(time.time()) + TOKEN_TTL_SECONDS}).encode())
    sig = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(token: str) -> str:
    try:
        payload, sig = token.split(".")
        expected = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        data = json.loads(_unb64(payload))
        if data["exp"] < time.time():
            raise ValueError("expired")
        return data["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please log in again.")


bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if creds is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return verify_token(creds.credentials)


class Credentials(BaseModel):
    username: str
    password: str


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
def register(body: Credentials):
    if not ALLOW_REGISTER:
        raise HTTPException(status_code=403, detail="Registration is disabled.")
    if not USERNAME_RE.match(body.username):
        raise HTTPException(status_code=400, detail="Username must be 3-32 characters: letters, digits, . _ -")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    salt = secrets.token_bytes(16)
    conn = _db()
    try:
        with conn:
            conn.execute(
                "INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)",
                (body.username.lower(), salt.hex(), _hash_password(body.password, salt)),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already taken.")
    finally:
        conn.close()

    username = body.username.lower()
    return {"token": create_token(username), "username": username}


@router.post("/login")
def login(body: Credentials):
    conn = _db()
    try:
        row = conn.execute(
            "SELECT salt, hash FROM users WHERE username = ?", (body.username.lower(),)
        ).fetchone()
    finally:
        conn.close()

    # Same error for unknown user and wrong password.
    if row is None or not hmac.compare_digest(
        _hash_password(body.password, bytes.fromhex(row[0])), row[1]
    ):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    username = body.username.lower()
    return {"token": create_token(username), "username": username}


@router.get("/me")
def me(user: str = Depends(current_user)):
    return {"username": user}
