"""What Monat tells you, after each sync with ING and once every morning.

Every alert lands in the in-app history (the bell) and is pushed to each device that turned
notifications on. Each one has a key, so it goes out once: a category's threshold or limit once per
budget month, an overspend once per payment, a large payment once, the summary once a day. The
toggles in Settings decide which kinds are sent at all.

Only news counts: payments from the very first sync, or older than RECENT_DAYS when they arrive,
are history and stay quiet.
"""

import os
from calendar import monthrange
from datetime import date, timedelta
from types import SimpleNamespace

from . import db

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
LARGE = 150.0                                          # "Single payments over €150" in Settings
RECENT_DAYS = 4                                        # ING books card payments a day or two late, longer over weekends
DAILY_HOUR = int(os.getenv("DAILY_SUMMARY_HOUR", "8"))  # local time; late starts still send it until noon


# ── Money and months, as the app writes them (web/js/lib/format.js, budget.js) ──

def money(v: float) -> str:
    v = abs(v)
    return f"€{round(v):,}" if abs(v - round(v)) < 0.005 else f"€{v:,.2f}"


def full(v: float) -> str:
    return f"€{abs(v):,.2f}"


def listing(names: list[str]) -> str:
    return names[0] if len(names) < 2 else ", ".join(names[:-1]) + " and " + names[-1]


def days(n: int) -> str:
    return f"{n} {'day' if n == 1 else 'days'}"


def period(y: int, m: int, start_day: int):
    """A budget month is named for the calendar month it ends in."""
    if start_day == 1:
        start, end = date(y, m, 1), date(y, m, monthrange(y, m)[1])
    else:
        py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
        start, end = date(py, pm, start_day), date(y, m, start_day - 1)
    return SimpleNamespace(start=start, end=end, name=MONTHS[m - 1], key=f"{y}-{m:02d}")


def period_for(d: date, start_day: int):
    y, m = d.year, d.month
    if start_day != 1 and d.day >= start_day:
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return period(y, m, start_day)


def spent_in(conn, p) -> dict[str, float]:
    """Spend per category in a period; a refund filed under a category lowers it."""
    out: dict[str, float] = {}
    for r in conn.execute("SELECT category_id, amount FROM transactions WHERE category_id IS NOT NULL AND date BETWEEN ? AND ?",
                          (p.start.isoformat(), p.end.isoformat())):
        out[r["category_id"]] = out.get(r["category_id"], 0.0) - r["amount"]
    return out


# ── Recording ──────────────────────────────────────────────────────────────

def emit(conn, pref: str, kind: str, key: str, title: str, body: str, target: str | None) -> dict | None:
    """Add an alert to the history unless its kind is switched off or it was sent before.
    Returns what to push."""
    if not (db.get_setting(conn, "prefs") or {}).get(pref, True):
        return None
    cur = conn.execute(
        "INSERT INTO notifications(kind, title, body, created_at, target, read, key) VALUES (?, ?, ?, ?, ?, 0, ?)"
        " ON CONFLICT(key) DO NOTHING",
        (kind, title, body, db.now().isoformat(timespec="minutes"), target, key),
    )
    return {"title": title, "body": body, "target": target, "tag": key} if cur.rowcount else None


# ── After a sync ───────────────────────────────────────────────────────────

def after_sync(conn, new_ids: list[str]) -> list[dict]:
    """Thresholds, overspending and large payments caused by the payments this sync brought."""
    if not new_ids:
        return []
    today = db.now().date()
    p = period_for(today, db.get_setting(conn, "month_start") or 1)
    cats = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM categories")}
    marks = ",".join("?" * len(new_ids))
    fresh = [dict(r) for r in conn.execute(
        f"SELECT * FROM transactions WHERE id IN ({marks}) AND amount < 0 AND date >= ? ORDER BY date, time",
        (*new_ids, (today - timedelta(days=RECENT_DAYS)).isoformat()))]
    spent = spent_in(conn, p)
    to_go = f"{days((p.end - today).days + 1)} to go."
    out, alerted = [], set()

    for cid, c in cats.items():
        mine = [t for t in fresh if t["category_id"] == cid and p.start.isoformat() <= t["date"] <= p.end.isoformat()]
        if c["fixed"] or not mine:
            continue
        lim, after = c["monthly_limit"], spent.get(cid, 0.0)
        before = after + sum(t["amount"] for t in mine)
        last = mine[-1]
        if after > lim + 0.005:
            if before <= lim + 0.005:
                body = f"{last['merchant']}, {full(last['amount'])}, took it past the {money(lim)} limit. {to_go}"
            elif len(mine) == 1:
                body = f"{last['merchant']}, {full(last['amount'])}. {to_go}"
            else:
                body = f"{len(mine)} payments, {full(sum(t['amount'] for t in mine))}. {to_go}"
            a = emit(conn, "over", "over", f"over:{cid}:{last['id']}", f"{c['name']} is {money(after - lim)} over", body, f"cat:{cid}")
        elif after >= lim - 0.005 > before:
            a = emit(conn, "reached", "reached", f"reached:{cid}:{p.key}", f"{c['name']} reached its limit",
                     f"All {money(lim)} for {c['name'].lower()} is spent. {to_go}", f"cat:{cid}")
        elif c["threshold"] < 100 and after * 100 >= c["threshold"] * lim > before * 100:
            a = emit(conn, "approach", "close", f"approach:{cid}:{p.key}", f"{c['name']} at {round(after / lim * 100)}%",
                     f"{money(lim - after)} left for {c['name'].lower()}. {to_go}", f"cat:{cid}")
        else:
            continue
        alerted.add(cid)
        if a:
            out.append(a)

    for t in fresh:
        if -t["amount"] <= LARGE or t["category_id"] in alerted:
            continue  # the category's own alert already names it
        c = cats.get(t["category_id"])
        if not c:
            body, target = "It needs a category.", "inbox"
        elif c["fixed"]:
            body, target = f"Filed under {c['name']} and marked as paid for {p.name}.", f"cat:{c['id']}"
        else:
            left = c["monthly_limit"] - spent.get(c["id"], 0.0)
            body = f"Filed under {c['name']}. " + (f"{money(left)} left this month." if left >= 0 else f"{money(-left)} over this month.")
            target = f"cat:{c['id']}"
        a = emit(conn, "large", "large", f"large:{t['id']}", f"{full(t['amount'])} to {t['merchant']}", body, target)
        if a:
            out.append(a)
    return out


def sync_failed(conn, title: str, message: str, was_error: bool) -> list[dict]:
    """Once when syncing stops working, not again on every retry."""
    if was_error:
        return []
    a = emit(conn, "sync", "sync", f"sync:{db.now().isoformat(timespec='minutes')}", title, message, "settings")
    return [a] if a else []


# ── Every morning ──────────────────────────────────────────────────────────

def daily(conn) -> list[dict]:
    """Yesterday's spending and what's safe to spend today; on a budget month's first day, how the
    last one closed instead."""
    today = db.now().date()
    start_day = db.get_setting(conn, "month_start") or 1
    p = period_for(today, start_day)
    cats = [dict(r) for r in conn.execute("SELECT * FROM categories")]
    key = f"daily:{today.isoformat()}"
    if not cats:
        return []

    if today == p.start:
        prev = period_for(today - timedelta(days=1), start_day)
        spent = spent_in(conn, prev)
        tl = sum(c["monthly_limit"] for c in cats)
        ts = sum(spent.get(c["id"], 0.0) for c in cats)
        overs = [c["name"] for c in cats if not c["fixed"] and spent.get(c["id"], 0.0) > c["monthly_limit"] + 0.005]
        body = (f"{money(tl - ts)} of {money(tl)} stayed unspent." if ts <= tl else f"{money(ts - tl)} over the {money(tl)} budget.")
        body += f" {listing(overs)} went over." if overs else " Nothing went over."
        a = emit(conn, "daily", "daily", key, f"{prev.name} closed at {full(ts)}", body, None)
        return [a] if a else []

    y = today - timedelta(days=1)
    paid = [r["amount"] for r in conn.execute("SELECT amount FROM transactions WHERE date = ? AND amount < 0", (y.isoformat(),))]
    title = f"{WEEKDAYS[y.weekday()]}: " + (f"{full(sum(paid))} across {len(paid)} {'payment' if len(paid) == 1 else 'payments'}" if paid else "nothing spent")
    # Safe to spend, as the overview works it out: what's left after fixed costs still to come, per day.
    spent = spent_in(conn, p)
    left = sum(c["monthly_limit"] - spent.get(c["id"], 0.0) for c in cats)
    unpaid = sum(c["monthly_limit"] for c in cats if c["fixed"] and spent.get(c["id"], 0.0) <= 0.005)
    safe = max(0.0, left - unpaid) / ((p.end - today).days + 1)
    uncat = conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id IS NULL AND amount < 0").fetchone()[0]
    body = (f"{uncat} still {'needs' if uncat == 1 else 'need'} a category. " if uncat else "") + f"Safe to spend today: {full(safe)}."
    a = emit(conn, "daily", "daily", key, title, body, "inbox" if uncat else None)
    return [a] if a else []


def daily_wait() -> float:
    """Seconds until the morning summary is due: now, if today's hasn't gone out and it's before noon."""
    now = db.now()
    at = now.replace(hour=DAILY_HOUR, minute=0, second=0, microsecond=0)
    with db.tx() as conn:
        done = db.get_setting(conn, "daily_last") == now.date().isoformat()
    if not done and at <= now < at.replace(hour=12):
        return 0.0
    if now >= at:
        at += timedelta(days=1)
    return (at - now).total_seconds()


def run_daily() -> None:
    from . import push

    with db.tx() as conn:
        today = db.now().date().isoformat()
        if db.get_setting(conn, "daily_last") == today:
            return
        db.set_setting(conn, "daily_last", today)  # also when the summary is switched off, so this runs once a day
        items = daily(conn)
    push.send(items)
