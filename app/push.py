"""Web Push to every device that turned notifications on in Settings.

On iPhone this needs iOS 16.4 or later and Monat opened from its Home Screen icon. The VAPID key pair
that identifies this server to Apple's and Google's push services is made on first start and kept in
the database, so it survives restarts and updates; if it ever changes, devices have to turn
notifications on again.
"""

import base64
import json
import logging
import os
from urllib.parse import urlsplit

from . import db

log = logging.getLogger("monat.push")
# Only the browsers' own push services: the server posts to whatever endpoint a device registers.
PUSH_HOSTS = ("push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com")
TTL = 24 * 3600  # a phone that's off for longer misses the alert; it's still in the app's history


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def keys(conn) -> dict:
    found = db.get_setting(conn, "vapid")
    if found:
        return found
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid

    v = Vapid()
    v.generate_keys()
    found = {
        "private": v.private_pem().decode(),
        "public": _b64(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
    }
    db.set_setting(conn, "vapid", found)
    return found


def allowed(endpoint: str) -> bool:
    u = urlsplit(endpoint)
    host = u.hostname or ""
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def valid_keys(p256dh: str, auth: str) -> bool:
    """The device's encryption key must be a real P-256 point and its secret 16 bytes, or nothing can be sent."""
    from cryptography.hazmat.primitives.asymmetric import ec

    try:
        raw = base64.urlsafe_b64decode(p256dh + "=" * (-len(p256dh) % 4))
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
        return len(base64.urlsafe_b64decode(auth + "=" * (-len(auth) % 4))) == 16
    except Exception:  # noqa: BLE001
        return False


def subscribe(conn, endpoint: str, p256dh: str, auth: str, user_agent: str, origin: str):
    conn.execute(
        "INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent",
        (endpoint, p256dh, auth, user_agent[:300], db.now().isoformat(timespec="minutes")),
    )
    if origin.startswith("https://"):
        db.set_setting(conn, "push_origin", origin)  # Apple wants the sender's address in every push


def send(items: list[dict], endpoint: str | None = None) -> list[str]:
    """Push each {title, body, target, tag} to every device, or only to `endpoint`. Devices the push
    service no longer knows are forgotten. Returns what went wrong, if anything."""
    if not items:
        return []
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush

    with db.tx() as conn:
        k = keys(conn)
        subject = os.getenv("VAPID_SUBJECT") or db.get_setting(conn, "push_origin") or "mailto:monat@localhost"
        subs = [dict(r) for r in conn.execute("SELECT * FROM push_subscriptions WHERE ? IS NULL OR endpoint = ?", (endpoint, endpoint))]
    vapid = Vapid.from_pem(k["private"].encode())
    gone, errors = [], []
    for s in subs:
        info = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        for item in items:
            try:
                # A fresh claims dict each time: pywebpush stores the push service's address in it.
                webpush(info, json.dumps(item), vapid_private_key=vapid, vapid_claims={"sub": subject}, ttl=TTL, timeout=10)
            except WebPushException as e:
                status = e.response.status_code if e.response is not None else None
                if status in (404, 410):
                    gone.append(s["endpoint"])
                    break
                errors.append(f"{urlsplit(s['endpoint']).hostname} said {status or e}")
                log.warning("push to %s failed: %s", urlsplit(s["endpoint"]).hostname, e)
            except Exception as e:  # noqa: BLE001 — one unreachable device mustn't stop the others
                errors.append(str(e))
                log.warning("push failed: %s", e)
    if gone:
        with db.tx() as conn:
            conn.executemany("DELETE FROM push_subscriptions WHERE endpoint = ?", [(g,) for g in gone])
        log.info("forgot %d device(s) the push service no longer knows", len(gone))
    return errors
