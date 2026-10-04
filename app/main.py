import asyncio
import csv
import io
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, db, sync
from .categorize import FIELDS, learn_pattern, matches, matching, norm, recategorize, suggest

WEB = Path(__file__).resolve().parent.parent / "web"
COLORS = {"rent", "groc", "car", "eat", "subs", "health", "misc", "x"}
ICONS = {"rent", "groc", "car", "eat", "subs", "health", "book", "misc"}
log = logging.getLogger("monat")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")  # sync and ING errors in `docker compose logs`


async def sync_forever():
    """Sync with ING every SYNC_INTERVAL_MINUTES, starting as soon as the last sync is that old."""
    while True:
        await asyncio.sleep(max(5.0, sync.due()))
        try:
            await asyncio.to_thread(sync.run)
        except Exception:  # noqa: BLE001 — keep the loop alive whatever happens
            log.exception("scheduled sync crashed")
            await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app):
    db.init()
    task = None
    if not db.DEMO and sync.configured():
        task = asyncio.create_task(sync_forever())
    yield
    if task:
        task.cancel()


app = FastAPI(title="Monat", docs_url=None, redoc_url=None, lifespan=lifespan)

PUBLIC_API = {"/api/session", "/api/login", "/api/logout"}
HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                               "connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; "
                               "base-uri 'none'; form-action 'self'; object-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@app.middleware("http")
async def guard(request: Request, call_next):
    """Every /api route except sign-in needs a session; changes must come from Monat's own pages."""
    path = request.url.path
    if path.startswith("/api/"):
        origin = request.headers.get("origin")
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")  # as the browser saw it
        if request.method not in ("GET", "HEAD") and origin and urlsplit(origin).netloc != host:
            return JSONResponse({"detail": "Cross-site request refused."}, status_code=403)
        if path not in PUBLIC_API:
            with db.tx() as conn:
                ok = auth.valid(conn, request.cookies.get(auth.COOKIE))
            if not ok:
                return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
    response = await call_next(request)
    for k, v in HEADERS.items():
        response.headers.setdefault(k, v)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class Login(BaseModel):
    password: str = Field(max_length=500)


@app.get("/api/session")
def session(request: Request):
    with db.tx() as conn:
        signed_in = auth.valid(conn, request.cookies.get(auth.COOKIE))
    return {"signed_in": signed_in, "configured": auth.configured()}


@app.post("/api/login")
def login(body: Login, request: Request, response: Response):
    if not auth.configured():
        raise HTTPException(503, f"Set MONAT_PASSWORD (at least {auth.MIN_LENGTH} characters) in the server’s .env, then restart Monat.")
    ip = request.client.host if request.client else "?"
    wait = auth.retry_after(ip)
    if wait:
        minutes = max(1, round(wait / 60))
        raise HTTPException(429, f"Too many attempts. Try again in {minutes} {'minute' if minutes == 1 else 'minutes'}.",
                            headers={"Retry-After": str(wait)})
    if not auth.check_password(body.password, ip):
        raise HTTPException(401, "That password didn’t work.")
    with db.tx() as conn:
        token = auth.create_session(conn, request.headers.get("user-agent", ""))
    response.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https", path="/")
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    with db.tx() as conn:
        auth.end_session(conn, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


def state(conn) -> dict:
    cats = [
        {
            "id": r["id"], "name": r["name"], "limit": r["monthly_limit"], "thr": r["threshold"], "fixed": bool(r["fixed"]),
            "due": r["due_day"], "color": r["color"], "icon": r["icon"], "carry": bool(r["carry"]),
        }
        for r in conn.execute("SELECT * FROM categories ORDER BY position, rowid")
    ]
    cat_ids = [c["id"] for c in cats]
    rules = [dict(r) for r in conn.execute("SELECT * FROM category_rules ORDER BY id")]
    fallback = db.get_setting(conn, "fallback")
    txns = []
    for r in conn.execute("SELECT * FROM transactions ORDER BY date DESC, time DESC"):
        t = dict(r)
        out_ = t["amount"] < 0
        learn = learn_pattern(t) if out_ else None
        txns.append({
            "id": t["id"], "date": t["date"], "time": t["time"] or "", "booked": t["booked"], "amount": t["amount"],
            "merchant": t["merchant"], "raw": t["raw"], "purpose": t["purpose"], "method": t["method"], "iban": t["iban"],
            "cat": t["category_id"], "note": t["note"], "source": t["cat_source"], "rule": t["cat_rule"],
            "learn": {"field": learn[0], "pattern": learn[1]} if learn else None,
            # A rule of its own category matches it, so "Always file this way" is on.
            "learned": t["category_id"] is not None and any(r["category_id"] == t["category_id"] and matches(r, t) for r in rules),
            "suggest": suggest(t, rules, cat_ids, fallback) if t["category_id"] is None and out_ else [],
        })
    notifs = [dict(r) for r in conn.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200")]
    for n in notifs:
        n["read"] = bool(n["read"])
    out = {
        "now": db.now().isoformat(timespec="minutes"),
        "demo": db.DEMO,
        "sync_minutes": int(sync.INTERVAL.total_seconds() // 60),
        "cooldown_minutes": int(sync.COOLDOWN.total_seconds() // 60),
        "categories": cats,
        "rules": [{"id": r["id"], "cat": r["category_id"], "field": r["field"], "pattern": r["pattern"],
                   "min": r["min_amount"], "max": r["max_amount"]} for r in rules],
        "transactions": txns,
        "notifications": notifs,
        "settings": {k: db.get_setting(conn, k) for k in db.DEFAULT_SETTINGS},
    }
    sync_status = dict(out["settings"]["sync"] or {})
    sync_status["paused"] = sync_status.pop("blocked", None) == sync._pin_fingerprint()  # never ship the fingerprint
    sync_status["manual_wait"] = round(sync.manual_wait(sync_status))
    out["settings"]["sync"] = sync_status
    return out


@app.get("/api/state")
def get_state():
    with db.tx() as conn:
        return state(conn)


class TxnPatch(BaseModel):
    category: Optional[str] = None
    set_category: bool = False  # distinguishes "set to uncategorized" from "leave alone"
    note: Optional[str] = None
    remember: Optional[bool] = None


def _rules_matching(conn, t, cat) -> list[dict]:
    rules = [dict(r) for r in conn.execute("SELECT * FROM category_rules WHERE category_id = ?", (cat,))]
    return matching(rules, dict(t))


@app.patch("/api/transactions/{tid}")
def patch_transaction(tid: str, body: TxnPatch):
    """Changing a category by hand pins it. `remember` adds a rule for the merchant to the category
    (true) or removes the rules that file it there (false); either way past payments are refiled."""
    with db.tx() as conn:
        t = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "No such transaction")
        cat = t["category_id"]
        if body.remember is False and cat:
            ids = [r["id"] for r in _rules_matching(conn, t, cat)]
            conn.executemany("DELETE FROM category_rules WHERE id = ?", [(i,) for i in ids])
        if body.set_category:
            cat = body.category
            if cat is not None and not conn.execute("SELECT 1 FROM categories WHERE id = ?", (cat,)).fetchone():
                raise HTTPException(400, "No such category")
            conn.execute("UPDATE transactions SET category_id = ?, cat_source = 'manual', cat_rule = NULL WHERE id = ?", (cat, tid))
        if body.note is not None:
            conn.execute("UPDATE transactions SET note = ? WHERE id = ?", (body.note[:2000], tid))
        if body.remember and cat and t["amount"] < 0 and not _rules_matching(conn, t, cat):
            learn = learn_pattern(dict(t))
            if not learn:
                raise HTTPException(400, "This payment doesn’t name a merchant, so there’s nothing to remember.")
            field, pattern = learn
            # The same rule elsewhere would compete with this one, so it moves here.
            for r in conn.execute("SELECT id, field, pattern FROM category_rules WHERE min_amount IS NULL AND max_amount IS NULL").fetchall():
                if r["field"] == field and norm(r["pattern"]) == norm(pattern):
                    conn.execute("DELETE FROM category_rules WHERE id = ?", (r["id"],))
            conn.execute("INSERT INTO category_rules(category_id, field, pattern) VALUES (?, ?, ?)", (cat, field, pattern))
        moved = recategorize(conn) if body.remember is not None else 0
        s = state(conn)
        if moved:
            s["message"] = f"{moved} other {'payment' if moved == 1 else 'payments'} filed again."
        return s


class RuleIn(BaseModel):
    id: Optional[int] = None
    field: str = "any"
    pattern: str = Field(min_length=1, max_length=80)
    min: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    max: Optional[float] = Field(default=None, ge=0, le=1_000_000)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    limit: float = Field(gt=0, le=1_000_000)
    thr: int = Field(ge=1, le=100)
    fixed: bool = False
    due: int = Field(default=1, ge=1, le=28)
    color: str
    icon: str
    carry: bool = False
    rules: Optional[list[RuleIn]] = Field(default=None, max_length=200)   # None leaves the rules alone
    catch_all: Optional[bool] = None


def _check(c: CategoryIn):
    if c.color not in COLORS or c.icon not in ICONS:
        raise HTTPException(400, "Unknown color or icon")
    for r in c.rules or []:
        if r.field not in FIELDS:
            raise HTTPException(400, "Unknown rule field")
        if len(norm(r.pattern)) < 2:
            raise HTTPException(400, f"“{r.pattern}” is too short for a rule. Use at least two letters or digits.")
        if r.min is not None and r.max is not None and r.min > r.max:
            raise HTTPException(400, f"In the rule for “{r.pattern}”, the lowest amount is above the highest.")


def _save_rules(conn, cid: str, body: CategoryIn) -> dict:
    """Store the category's rules and catch-all flag, refile past payments, and return the state with a
    sentence about what moved."""
    if body.rules is not None:
        keep = {r.id for r in body.rules if r.id}
        for (rid,) in conn.execute("SELECT id FROM category_rules WHERE category_id = ?", (cid,)).fetchall():
            if rid not in keep:
                conn.execute("DELETE FROM category_rules WHERE id = ?", (rid,))
        for r in body.rules:
            vals = (r.field, r.pattern.strip(), r.min, r.max)
            cur = conn.execute("UPDATE category_rules SET field = ?, pattern = ?, min_amount = ?, max_amount = ? WHERE id = ? AND category_id = ?",
                               (*vals, r.id, cid)) if r.id else None
            if not cur or not cur.rowcount:
                conn.execute("INSERT INTO category_rules(field, pattern, min_amount, max_amount, category_id) VALUES (?, ?, ?, ?, ?)", (*vals, cid))
    if body.catch_all is not None:
        current = db.get_setting(conn, "fallback")
        if body.catch_all:
            db.set_setting(conn, "fallback", cid)
        elif current == cid:
            db.set_setting(conn, "fallback", None)
    moved = recategorize(conn)
    s = state(conn)
    if moved:
        s["message"] = f"{body.name} saved. {moved} {'payment' if moved == 1 else 'payments'} filed again."
    return s


@app.post("/api/categories")
def create_category(body: CategoryIn):
    _check(body)
    with db.tx() as conn:
        base = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "category"
        cid, n = base, 2
        while conn.execute("SELECT 1 FROM categories WHERE id = ?", (cid,)).fetchone() or cid == "income":
            cid, n = f"{base}-{n}", n + 1
        pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM categories").fetchone()[0]
        conn.execute(
            "INSERT INTO categories(id, name, monthly_limit, threshold, fixed, due_day, color, icon, carry, position)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, body.name, body.limit, body.thr, body.fixed, body.due, body.color, body.icon, body.carry, pos),
        )
        return _save_rules(conn, cid, body)


@app.put("/api/categories/{cid}")
def update_category(cid: str, body: CategoryIn):
    _check(body)
    with db.tx() as conn:
        cur = conn.execute(
            "UPDATE categories SET name = ?, monthly_limit = ?, threshold = ?, fixed = ?, due_day = ?, color = ?, icon = ?, carry = ?"
            " WHERE id = ?",
            (body.name, body.limit, body.thr, body.fixed, body.due, body.color, body.icon, body.carry, cid),
        )
        if not cur.rowcount:
            raise HTTPException(404, "No such category")
        return _save_rules(conn, cid, body)


@app.delete("/api/categories/{cid}")
def delete_category(cid: str):
    """Its rules go with it. Its payments are filed again by the other rules or the catch-all;
    if it was the catch-all, unmatched payments wait for a category."""
    with db.tx() as conn:
        conn.execute("UPDATE transactions SET cat_source = NULL, cat_rule = NULL WHERE category_id = ?", (cid,))
        conn.execute("DELETE FROM categories WHERE id = ?", (cid,))
        if db.get_setting(conn, "fallback") == cid:
            db.set_setting(conn, "fallback", None)
        recategorize(conn)
        return state(conn)


class SettingsPatch(BaseModel):
    month_start: Optional[int] = None
    prefs: Optional[dict[str, bool]] = None


@app.patch("/api/settings")
def patch_settings(body: SettingsPatch):
    with db.tx() as conn:
        if body.month_start is not None:
            if body.month_start not in (1, 15, 25):
                raise HTTPException(400, "Month start must be the 1st, 15th or 25th")
            db.set_setting(conn, "month_start", body.month_start)
        if body.prefs is not None:
            prefs = db.get_setting(conn, "prefs")
            prefs.update({k: v for k, v in body.prefs.items() if k in prefs})
            db.set_setting(conn, "prefs", prefs)
        return state(conn)


@app.post("/api/notifications/read")
def read_notifications():
    with db.tx() as conn:
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        return state(conn)


@app.post("/api/sync")
def sync_now():
    if db.DEMO:
        with db.tx() as conn:
            message = sync.claim_manual(conn)
            if not message:
                status = db.get_setting(conn, "sync")
                last, now = status.get("last"), db.now()
                status.update({"status": "ok", "last": now.isoformat(timespec="minutes"),
                               "next": (now + sync.INTERVAL).isoformat(timespec="minutes")})
                db.set_setting(conn, "sync", status)
                message = f"Synced with ING. No new payments since {last[11:16]}." if last else "Synced with ING."
            s = state(conn)
    else:
        message = sync.run(manual=True)
        with db.tx() as conn:
            s = state(conn)
    s["message"] = message
    return s


@app.get("/api/export.csv")
def export_csv(start: Optional[str] = None, end: Optional[str] = None):
    with db.tx() as conn:
        rows = conn.execute(
            "SELECT t.date, t.time, t.booked, t.amount, t.merchant, COALESCE(c.name, '') AS category, t.method, t.purpose, t.iban, t.note"
            " FROM transactions t LEFT JOIN categories c ON c.id = t.category_id"
            " WHERE (? IS NULL OR t.date >= ?) AND (? IS NULL OR t.date <= ?) ORDER BY t.date, t.time",
            (start, start, end, end),
        ).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "time", "booked", "amount", "merchant", "category", "method", "purpose", "iban", "note"])
    w.writerows([tuple(r) for r in rows])
    name = f"monat-{start or 'all'}{'_' + end if end else ''}.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    return FileResponse(WEB / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB), name="web")
