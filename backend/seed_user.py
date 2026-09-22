"""Create or reset a user directly, bypassing the register-form rules.

Usage: python seed_user.py <username> <password>
"""
import secrets
import sys

from app.auth import _db, _hash_password

username, password = sys.argv[1].lower(), sys.argv[2]
salt = secrets.token_bytes(16)
conn = _db()
with conn:
    conn.execute(
        "INSERT OR REPLACE INTO users (username, salt, hash) VALUES (?, ?, ?)",
        (username, salt.hex(), _hash_password(password, salt)),
    )
conn.close()
print(f"user '{username}' saved")
