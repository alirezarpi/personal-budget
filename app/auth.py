"""Single-user sign-in for running Monat on the public internet.

The password is MONAT_PASSWORD from the environment (at least 12 characters). A successful sign-in sets a
random session cookie (HttpOnly, SameSite=Strict, Secure over HTTPS) valid for 90 days of inactivity; the
database stores only its SHA-256. Changing the password signs out every device. Failed attempts are limited
per IP address and in total, so the password can't be guessed online.
"""

import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from . import db

COOKIE = "monat_session"
SESSION_DAYS = 90
MIN_LENGTH = 12
PER_IP = (5, 15 * 60)      # 5 failures per IP in 15 minutes
GLOBAL = (20, 60 * 60)     # 20 failures from anywhere in an hour

_failures: dict[str, deque] = defaultdict(deque)
_all_failures: deque = deque()
_guard = threading.Lock()


def _password() -> str:
    return os.getenv("MONAT_PASSWORD", "")


def configured() -> bool:
    return len(_password()) >= MIN_LENGTH


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def init(conn):
    """Sign every device out when the password changed since the last start.

    The stored check value is a salted scrypt hash, so a copy of the database doesn't give the password away.
    """
    if not configured():
        return
    stored = db.get_setting(conn, "auth_check")
    if stored:
        salt = bytes.fromhex(stored["salt"])
        if hmac.compare_digest(hashlib.scrypt(_password().encode(), salt=salt, n=2**14, r=8, p=1).hex(), stored["hash"]):
            return
    salt = secrets.token_bytes(16)
    db.set_setting(conn, "auth_check", {"salt": salt.hex(), "hash": hashlib.scrypt(_password().encode(), salt=salt, n=2**14, r=8, p=1).hex()})
    conn.execute("DELETE FROM sessions")


def _prune(q: deque, window: int, now: float):
    while q and q[0] < now - window:
        q.popleft()


def retry_after(ip: str) -> int:
    """Seconds this IP has to wait before trying again, 0 if it may try now."""
    now = time.monotonic()
    with _guard:
        mine = _failures[ip]
        _prune(mine, PER_IP[1], now)
        _prune(_all_failures, GLOBAL[1], now)
        waits = []
        if len(mine) >= PER_IP[0]:
            waits.append(mine[0] + PER_IP[1] - now)
        if len(_all_failures) >= GLOBAL[0]:
            waits.append(_all_failures[0] + GLOBAL[1] - now)
        return int(max(waits)) + 1 if waits else 0


def check_password(given: str, ip: str) -> bool:
    ok = configured() and hmac.compare_digest(_sha(given), _sha(_password()))
    if not ok:
        now = time.monotonic()
        with _guard:
            _failures[ip].append(now)
            _all_failures.append(now)
        time.sleep(0.4)  # costs a guesser time, not you
    return ok


def create_session(conn, user_agent: str) -> str:
    token = secrets.token_urlsafe(32)
    now = db.now().isoformat(timespec="seconds")
    conn.execute("INSERT INTO sessions(token_hash, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?)",
                 (_sha(token), now, now, user_agent[:200]))
    return token


def valid(conn, token: str | None) -> bool:
    if not token or not configured():
        return False
    row = conn.execute("SELECT last_seen FROM sessions WHERE token_hash = ?", (_sha(token),)).fetchone()
    if not row:
        return False
    last = datetime.fromisoformat(row["last_seen"])
    if db.now() - last > timedelta(days=SESSION_DAYS):
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha(token),))
        return False
    if db.now() - last > timedelta(hours=1):
        conn.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (db.now().isoformat(timespec="seconds"), _sha(token)))
    return True


def end_session(conn, token: str | None):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha(token),))
