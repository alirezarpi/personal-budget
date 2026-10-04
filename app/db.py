import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.getenv("MONAT_DB", Path(__file__).resolve().parent.parent / "data" / "monat.db"))
DEMO = os.getenv("MONAT_DEMO") == "1"

# Demo mode pins the clock to the moment the design was drawn: Wednesday 21 October 2026, 09:41.
DEMO_NOW = datetime(2026, 10, 21, 9, 41)

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_limit REAL NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 80,
  fixed INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER NOT NULL DEFAULT 1,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  carry INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  booked TEXT,
  amount REAL NOT NULL,            -- signed, as the bank reports it: negative is money out
  merchant TEXT NOT NULL,
  raw TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  iban TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS rules (
  merchant_key TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  target TEXT,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,     -- SHA-256 of the cookie value; the token itself is never stored
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
"""

DEFAULT_SETTINGS = {
    "month_start": 1,
    "prefs": {"approach": True, "reached": True, "over": True, "large": True, "daily": True, "sync": True},
    "account": None,
    "sync": {"status": "never", "last": None, "next": None},
}


def now() -> datetime:
    return DEMO_NOW if DEMO else datetime.now()


def merchant_key(raw: str) -> str:
    """Normalise a counterparty name so branches of one merchant share a rule (SHELL 1219 → SHELL)."""
    key = re.sub(r"\d+", " ", raw.upper())
    return re.sub(r"\s+", " ", key).strip()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def get_setting(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else DEFAULT_SETTINGS.get(key)


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def init():
    from . import auth, seed

    with tx() as conn:
        conn.executescript(SCHEMA)
        auth.init(conn)
        if not conn.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
            seed.categories(conn)
            if DEMO:
                seed.demo(conn)
