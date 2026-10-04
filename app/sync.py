"""Pull transactions from ING via FinTS, the same python-fints flow as banking-stuff/ing-scripts.

Runs every SYNC_INTERVAL_MINUTES (default 2 hours) from the server. The app's sync button works once per
SYNC_MANUAL_COOLDOWN_MINUTES (default 2 hours), and restarts the schedule, so ING sees few logins. By hand:

    python -m app.sync                         # one sync, as the scheduler does it
    python -m app.sync --setup                 # same, but asks for a TAN in the terminal if ING wants one
    python -m app.sync --setup --choose-tan    # also pick the TAN method by hand

The bank calls are the same as banking-stuff/ing-scripts/ing-transaction.py.
The scheduled sync never prompts. If ING wants a TAN it stops and says so in the app; run --setup to confirm.
If ING refuses the login, automatic syncing pauses until the PIN changes or --setup succeeds,
so retries can't use up the three attempts before ING locks the login.
"""

import argparse
import hashlib
import logging
import os
import re
import threading
from datetime import date, datetime, timedelta

from . import db
from .categorize import INTERMEDIARIES, paypal_merchant, recategorize

log = logging.getLogger("monat.sync")
INTERVAL = timedelta(minutes=max(15, int(os.getenv("SYNC_INTERVAL_MINUTES", "120"))))
COOLDOWN = timedelta(minutes=max(0, int(os.getenv("SYNC_MANUAL_COOLDOWN_MINUTES", "120"))))
FIRST_SYNC_DAYS = 90   # ING serves 90 days without a TAN
OVERLAP_DAYS = 7       # re-read a week each time; late bookings land with older dates
_lock = threading.Lock()


class NeedsTAN(Exception):
    pass


class LoginRefused(Exception):
    def __init__(self, bank: list[str], pin: bool):
        super().__init__("; ".join(bank) or "login refused")
        self.bank, self.pin = bank, pin


PIN_CODES = {"9340", "9910", "9930", "9931", "9942"}


def configured() -> bool:
    return all(os.getenv(k) for k in ("FINTS_USER", "FINTS_PIN", "FINTS_PRODUCT_ID"))


def _pin_fingerprint() -> str:
    return hashlib.sha256((os.getenv("FINTS_USER", "") + ":" + os.getenv("FINTS_PIN", "")).encode()).hexdigest()[:16]


# ── Bank ────────────────────────────────────────────────────────────────────

def _client():
    from fints.client import FinTS3PinTanClient

    # Exactly as banking-stuff/ing-scripts/ing-transaction.py builds it: no saved state, default mode.
    return FinTS3PinTanClient(
        bank_identifier=os.getenv("FINTS_BANK_CODE", "50010517"),
        user_id=os.getenv("FINTS_USER"),
        pin=os.getenv("FINTS_PIN"),
        server=os.getenv("FINTS_SERVER", "https://fints.ing.de/fints/"),
        product_id=os.getenv("FINTS_PRODUCT_ID"),
    )


def _answer(client, resp, interactive: bool):
    from fints.client import NeedTANResponse

    while isinstance(resp, NeedTANResponse):
        if not interactive:
            raise NeedsTAN()
        print(resp.challenge)
        if resp.decoupled:
            input("Confirm in the ING app, then press Enter… ")
            resp = client.send_tan(resp, "")
        else:
            resp = client.send_tan(resp, input("TAN: ").strip())
    return resp


def fetch(start: date, interactive: bool = False, choose_tan: bool = False):
    """Returns [(iban, [mt940 transactions])].

    The bank calls are the ones ing-transaction.py makes: get_sepa_accounts(), then get_transactions()
    per account, each in its own dialog. Two additions don't change what is sent to ING: the bank's
    own error text is kept (python-fints reports every refused login as "PIN wrong?"), and a TAN is
    answered only if ING asks for one.
    """
    from fints.exceptions import FinTSClientPINError, FinTSSCARequiredError

    client = _client()
    bank: list[str] = []
    process = client._process_response

    def spy(dialog, segment, response):
        if response.code[:1] == "9":
            bank.append(f"{response.code} {response.text}")
            log.error("ING: %s %s", response.code, response.text)
        return process(dialog, segment, response)

    client._process_response = spy
    if choose_tan:
        from fints.utils import minimal_interactive_cli_bootstrap

        minimal_interactive_cli_bootstrap(client)
    try:
        accounts = _answer(client, client.get_sepa_accounts(), interactive)
        only = os.getenv("FINTS_IBAN", "").replace(" ", "")
        if only:
            accounts = [a for a in accounts if a.iban == only]
        return [(a.iban, _answer(client, client.get_transactions(a, start, date.today()), interactive)) for a in accounts]
    except FinTSSCARequiredError as e:
        raise NeedsTAN() from e
    except FinTSClientPINError as e:
        raise LoginRefused(bank, pin=any(b[:4] in PIN_CODES or "PIN" in b.upper() for b in bank)) from e


# ── Mapping MT940 to Monat ──────────────────────────────────────────────────

STAMP = re.compile(r"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})")
METHODS = {"LASTSCHRIFT": "Direct debit", "DAUERAUFTRAG": "Standing order", "GUTSCHRIFT": "Transfer",
           "UEBERWEISUNG": "Transfer", "ÜBERWEISUNG": "Transfer", "GEHALT/RENTE": "Transfer", "ENTGELT": "Fee",
           "ABSCHLUSS": "Fee", "ZINSEN": "Interest"}


LEGAL = {"GMBH": "GmbH", "AG": "AG", "SE": "SE", "KG": "KG", "UG": "UG", "EV": "e.V.", "E.V.": "e.V."}


def _merchant(name: str, purpose: str = "") -> str:
    """'VISA NETFLIX.COM' → 'Netflix.com', 'REWE MARKT GMBH//BERLIN/DE' → 'Rewe Markt GmbH',
    PayPal → the shop named in the purpose ('Hetzner Online GmbH')."""
    if INTERMEDIARIES.match(name.upper()):
        name = paypal_merchant(purpose) or name
    name = re.sub(r"^(VISA|GIROCARD)\s+", "", name.split("//")[0].strip(), flags=re.I)
    if not name.isupper() or len(name) <= 4:
        return name
    return " ".join(LEGAL.get(w, "*".join(p.capitalize() for p in w.split("*"))) for w in name.split())


def _method(posting: str, text: str) -> str:
    up = text.upper()
    if INTERMEDIARIES.match(up):
        return "PayPal" if up.startswith("PAYPAL") else "Klarna"
    if "VISA" in up:
        return "Visa Debit"
    if "KARTENZAHLUNG" in up or "GIROCARD" in up:
        return "girocard"
    return METHODS.get(posting.upper().strip(), posting.strip().capitalize())


def name_paypal_merchants(conn):
    """Show PayPal payments under the shop that was paid, for payments synced before Monat did that."""
    for t in conn.execute("SELECT id, raw, purpose FROM transactions WHERE raw LIKE 'PAYPAL%'").fetchall():
        conn.execute("UPDATE transactions SET merchant = ?, method = 'PayPal' WHERE id = ?", (_merchant(t["raw"], t["purpose"]), t["id"]))


def to_rows(results) -> list[tuple]:
    own = {iban for iban, _ in results}
    rows, seen = [], {}
    for iban, txs in results:
        for t in txs:
            d = t.data
            amount = float(d["amount"].amount)
            raw = (d.get("applicant_name") or d.get("posting_text") or "ING").strip()
            purpose = re.sub(r"\s+", " ", d.get("purpose") or "").strip()
            cp_iban = (d.get("applicant_iban") or "").replace(" ", "") or None
            if cp_iban in own:
                continue  # moving money between your own ING accounts isn't spending
            day = d.get("date")
            booked = d.get("entry_date") or d.get("guessed_entry_date") or day
            when = STAMP.search(purpose)  # card payments carry the real purchase time in the purpose text
            if when:
                day, time = date.fromisoformat(when.group(1)), when.group(2)
            else:
                time = ""
            base = f"{iban}|{booked}|{d.get('date')}|{amount:.2f}|{raw}|{purpose}"
            n = seen[base] = seen.get(base, 0) + 1
            tid = hashlib.sha1(f"{base}|{n}".encode()).hexdigest()[:16]
            pretty_iban = " ".join(cp_iban[i:i + 4] for i in range(0, len(cp_iban), 4)) if cp_iban else None
            rows.append((tid, day.isoformat(), time, booked.isoformat(), amount, _merchant(raw, purpose), raw.upper(), purpose,
                         _method(d.get("posting_text") or "", f"{raw} {purpose}"), pretty_iban))
    return rows


# ── One run ─────────────────────────────────────────────────────────────────

def _status(conn, **kw):
    cur = db.get_setting(conn, "sync") or {}
    now = db.now()
    cur.update({"next": (now + INTERVAL).isoformat(timespec="minutes"), **kw})
    db.set_setting(conn, "sync", cur)


def manual_wait(status: dict) -> float:
    """Seconds until the app's sync button may contact ING again."""
    last = (status or {}).get("manual_last")
    if not last:
        return 0.0
    return max(0.0, (datetime.fromisoformat(last) + COOLDOWN - db.now()).total_seconds())


def claim_manual(conn) -> str | None:
    """Record a manual sync, or return why it has to wait."""
    status = db.get_setting(conn, "sync") or {}
    wait = manual_wait(status)
    if wait:
        return f"Synced recently. You can sync with ING again at {(db.now() + timedelta(seconds=wait)):%H:%M}."
    status["manual_last"] = db.now().isoformat(timespec="minutes")
    db.set_setting(conn, "sync", status)
    return None


def run(interactive: bool = False, manual: bool = False, cooldown: bool = True, choose_tan: bool = False) -> str:
    """Sync once. `manual` is the app's button: rate-limited unless `cooldown` is off (the CLI).
    Returns the sentence the app shows in its toast."""
    if not configured():
        return "Add your ING login to the server’s .env to start syncing."
    if not _lock.acquire(blocking=False):
        return "A sync is already running."
    try:
        with db.tx() as conn:
            if manual and cooldown:
                refused = claim_manual(conn)
                if refused:
                    return refused
            prev = db.get_setting(conn, "sync") or {}
        if prev.get("blocked") == _pin_fingerprint() and not interactive:  # only --setup may retry a refused login
            return "Automatic syncing is paused until the login works again. Run the setup on the server."
        last = prev.get("last")
        start = (datetime.fromisoformat(last).date() - timedelta(days=OVERLAP_DAYS)) if last else date.today() - timedelta(days=FIRST_SYNC_DAYS)

        try:
            results = fetch(start, interactive, choose_tan)
        except Exception as e:  # noqa: BLE001 — every failure becomes a status the app can show
            if isinstance(e, NeedsTAN):
                msg = "ING is asking for a TAN. Run the setup on the server to confirm it."
            elif isinstance(e, LoginRefused):
                said = f" ING said: “{e.bank[-1].rstrip('.')}”." if e.bank else ""
                msg = ("ING rejected the PIN." if e.pin else "ING refused the login.") + said + \
                    " Automatic syncing is paused so the login doesn’t get locked."
            else:
                log.exception("sync failed")
                msg = "Couldn’t reach ING. Monat tries again at the next scheduled sync."
            with db.tx() as conn:
                _status(conn, status="error", message=msg,
                        blocked=_pin_fingerprint() if isinstance(e, LoginRefused) else None)
            return msg

        with db.tx() as conn:
            rows = to_rows(results)
            before = conn.total_changes
            conn.executemany(
                "INSERT OR IGNORE INTO transactions(id, date, time, booked, amount, merchant, raw, purpose, method, iban)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            new = conn.total_changes - before
            recategorize(conn)
            if results:
                iban = results[0][0]
                db.set_setting(conn, "account", {"name": os.getenv("FINTS_ACCOUNT_NAME", "Girokonto"),
                                                 "iban": f"{iban[:2]}•• •••• •••• •••• {iban[-6:-2]} {iban[-2:]}",
                                                 "short": "··" + iban[-6:-2]})
            _status(conn, status="ok", message=None, blocked=None, last=db.now().isoformat(timespec="minutes"))
        log.info("sync ok: %d new of %d", new, len(rows))
        if new:
            return f"Synced with ING. {new} new {'payment' if new == 1 else 'payments'}."
        return f"Synced with ING. No new payments since {last[11:16]}." if last else "Synced with ING."
    finally:
        _lock.release()


def due() -> float:
    """Seconds until the next scheduled sync."""
    with db.tx() as conn:
        last = (db.get_setting(conn, "sync") or {}).get("last")
    if not last:
        return 0
    return max(0.0, (datetime.fromisoformat(last) + INTERVAL - db.now()).total_seconds())


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--setup", action="store_true", help="confirm a TAN in the terminal if ING asks for one")
    p.add_argument("--choose-tan", action="store_true", help="pick the TAN method by hand (implies --setup)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    db.init()
    print(run(interactive=args.setup or args.choose_tan, manual=True, cooldown=False, choose_tan=args.choose_tan))
