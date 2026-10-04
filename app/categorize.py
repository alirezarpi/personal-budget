"""Category suggestions for the uncategorized inbox.

A learned rule (merchant → category) always wins and is applied automatically on sync.
Without one, keyword hints on the merchant name and purpose text give up to two suggestions,
which the inbox shows as chips with the first one outlined.
"""

import re

from .db import merchant_key

HINTS = {
    "groc": r"REWE|LIDL|EDEKA|ALDI|NETTO|PENNY|KAUFLAND|TCHIBO|BIO ?COMPANY|DENNS",
    "eat": r"KAFFEE|CAFE|COFFEE|BAECKER|BÄCKER|RESTAURANT|PIZZ|BURGER|SUSHI|DOENER|DÖNER|LIEFERANDO|WOLT|BAR\b",
    "car": r"SHELL|ARAL|ESSO|TOTAL|JET\b|TANK|APCOA|PARK|KFZ|ADAC|HUK",
    "subs": r"NETFLIX|SPOTIFY|APPLE\.COM|ICLOUD|DISNEY|YOUTUBE|ABO\b|AUDIBLE",
    "health": r"APOTHEKE|DM-DROGERIE|ROSSMANN|ARZT|PRAXIS|ZAHN",
    "rent": r"MIETE|HAUSVERWALTUNG",
    "misc": r"PAYPAL|AMAZON|IKEA|KLEINANZEIGEN|THALIA",
}


def suggest(txn: dict, rules: dict, category_ids: list[str]) -> list[str]:
    out = []
    learned = rules.get(merchant_key(txn["raw"]))
    if learned:
        out.append(learned)
    text = f"{txn['merchant']} {txn['raw']} {txn['purpose']}".upper()
    for cat, pattern in HINTS.items():
        if re.search(pattern, text):
            out.append(cat)
    out.append("misc")
    seen = []
    for c in out:
        if c in category_ids and c not in seen:
            seen.append(c)
    return (seen or category_ids[:1])[:2]
