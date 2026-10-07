import json
import os
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
  note TEXT NOT NULL DEFAULT '',
  cat_source TEXT,                 -- 'manual', 'rule' or 'fallback'; NULL while nothing has filed it
  cat_rule INTEGER                 -- the rule that filed it, when cat_source is 'rule'
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  field TEXT NOT NULL DEFAULT 'any',   -- where to look: 'any', 'payee' or 'purpose'
  pattern TEXT NOT NULL,
  min_amount REAL,                     -- money out, in euros; NULL means no bound
  max_amount REAL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  target TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  key TEXT                         -- what makes it unique, so an alert is sent once (app/alerts.py)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,       -- one per device that turned notifications on
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
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
    "fallback": None,   # the catch-all category: payments no rule matches are filed here
    "sync": {"status": "never", "last": None, "next": None},
}


def now() -> datetime:
    return DEMO_NOW if DEMO else datetime.now()


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


def _migrate(conn):
    """Bring a database from before category rules up to date."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "cat_source" not in cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN cat_source TEXT")
        conn.execute("ALTER TABLE transactions ADD COLUMN cat_rule INTEGER")
        conn.execute("UPDATE transactions SET cat_source = 'manual' WHERE category_id IS NOT NULL")
    if "key" not in {r["name"] for r in conn.execute("PRAGMA table_info(notifications)")}:
        conn.execute("ALTER TABLE notifications ADD COLUMN key TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS notifications_key ON notifications(key)")


def init():
    from . import auth, seed

    with tx() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        auth.init(conn)
        if not conn.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
            seed.categories(conn)
            if DEMO:
                seed.demo(conn)
        if not get_setting(conn, "rules_seeded"):
            seed.rules(conn)
