import asyncio
import csv
import io
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, sync
from .categorize import suggest

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


def state(conn) -> dict:
    cats = [
        {
            "id": r["id"], "name": r["name"], "limit": r["monthly_limit"], "thr": r["threshold"], "fixed": bool(r["fixed"]),
            "due": r["due_day"], "color": r["color"], "icon": r["icon"], "carry": bool(r["carry"]),
        }
        for r in conn.execute("SELECT * FROM categories ORDER BY position, rowid")
    ]
    cat_ids = [c["id"] for c in cats]
    rules = {r["merchant_key"]: r["category_id"] for r in conn.execute("SELECT * FROM rules")}
    txns = []
    for r in conn.execute("SELECT * FROM transactions ORDER BY date DESC, time DESC"):
        t = dict(r)
        key = db.merchant_key(t["raw"])
        txns.append({
            "id": t["id"], "date": t["date"], "time": t["time"] or "", "booked": t["booked"], "amount": t["amount"],
            "merchant": t["merchant"], "raw": t["raw"], "purpose": t["purpose"], "method": t["method"], "iban": t["iban"],
            "cat": t["category_id"], "note": t["note"],
            "learned": t["category_id"] is not None and rules.get(key) == t["category_id"],
            "suggest": suggest(t, rules, cat_ids) if t["category_id"] is None and t["amount"] < 0 else [],
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


@app.patch("/api/transactions/{tid}")
def patch_transaction(tid: str, body: TxnPatch):
    with db.tx() as conn:
        t = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "No such transaction")
        key = db.merchant_key(t["raw"])
        cat = t["category_id"]
        if body.set_category:
            cat = body.category
            if cat is not None and not conn.execute("SELECT 1 FROM categories WHERE id = ?", (cat,)).fetchone():
                raise HTTPException(400, "No such category")
            conn.execute("UPDATE transactions SET category_id = ? WHERE id = ?", (cat, tid))
        if body.note is not None:
            conn.execute("UPDATE transactions SET note = ? WHERE id = ?", (body.note[:2000], tid))

        rule = conn.execute("SELECT category_id FROM rules WHERE merchant_key = ?", (key,)).fetchone()
        remember = body.remember
        if remember is None and body.set_category and rule:
            remember = True  # a learned merchant follows its transaction to the new category
        if remember and cat:
            conn.execute(
                "INSERT INTO rules(merchant_key, category_id) VALUES (?, ?)"
                " ON CONFLICT(merchant_key) DO UPDATE SET category_id = excluded.category_id",
                (key, cat),
            )
            # File the merchant's other unsorted payments the same way.
            for other in conn.execute("SELECT id, raw FROM transactions WHERE category_id IS NULL AND amount < 0").fetchall():
                if db.merchant_key(other["raw"]) == key:
                    conn.execute("UPDATE transactions SET category_id = ? WHERE id = ?", (cat, other["id"]))
        elif remember is False or (remember and not cat):
            conn.execute("DELETE FROM rules WHERE merchant_key = ?", (key,))
        return state(conn)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    limit: float = Field(gt=0, le=1_000_000)
    thr: int = Field(ge=1, le=100)
    fixed: bool = False
    due: int = Field(default=1, ge=1, le=28)
    color: str
    icon: str
    carry: bool = False


def _check(c: CategoryIn):
    if c.color not in COLORS or c.icon not in ICONS:
        raise HTTPException(400, "Unknown color or icon")


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
        return state(conn)


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
        return state(conn)


@app.delete("/api/categories/{cid}")
def delete_category(cid: str):
    with db.tx() as conn:
        conn.execute("DELETE FROM categories WHERE id = ?", (cid,))
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
