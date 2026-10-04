"""Filing payments into categories.

Each category has rules: a word or phrase to look for in the payee, the purpose text or either, and
optionally an amount range. When several rules match, the most specific one wins: one with an amount
range, then one that looks in a single field (purpose before payee), then the longer phrase, then the
newer rule. A payment no rule matches goes to the catch-all category, if one is set.

Rules file payments automatically, including past ones: whenever rules change, every payment that a
rule or the catch-all filed is filed again. A category picked by hand is never changed.
Only money out is filed; money in is income.
"""

import re

FIELDS = ("any", "payee", "purpose")
FOLD = str.maketrans({"Ä": "AE", "Ö": "OE", "Ü": "UE", "ß": "SS"})
# Payment services that name themselves as the payee; the real merchant is in the purpose text.
INTERMEDIARIES = re.compile(r"^(PAYPAL|KLARNA)\b")
PAYPAL_MERCHANT = re.compile(r"PP\.\d+\.PP\W*(.+?)\s*,\s*Ihr\b", re.I)


def norm(s: str) -> str:
    """'REWE Markt GmbH//München' → 'REWE MARKT GMBH MUENCHEN'. Rules and payments are compared like this."""
    return re.sub(r"[^A-Z0-9]+", " ", (s or "").upper().translate(FOLD)).strip()


def texts(txn: dict) -> dict:
    payee, purpose = norm(txn["raw"]), norm(txn["purpose"])
    return {"payee": f" {payee} ", "purpose": f" {purpose} ", "any": f" {payee} {purpose} "}


def matches(rule: dict, txn: dict, tx: dict | None = None) -> bool:
    """The phrase must start a word, so 'REWE' matches 'REWE CITY' but not 'BREWERY'."""
    p = norm(rule["pattern"])
    if not p or txn["amount"] >= 0:
        return False
    amt = -txn["amount"]
    if rule.get("min_amount") is not None and amt < rule["min_amount"] - 0.004:
        return False
    if rule.get("max_amount") is not None and amt > rule["max_amount"] + 0.004:
        return False
    return f" {p}" in (tx or texts(txn))[rule["field"]]


def specificity(rule: dict):
    ranged = (rule.get("min_amount") is not None) + (rule.get("max_amount") is not None)
    return ranged, {"purpose": 2, "payee": 1}.get(rule["field"], 0), len(norm(rule["pattern"])), rule["id"]


def matching(rules: list[dict], txn: dict) -> list[dict]:
    tx = texts(txn)
    return sorted((r for r in rules if matches(r, txn, tx)), key=specificity, reverse=True)


def load(conn) -> tuple[list[dict], str | None]:
    """All rules, and the catch-all category if it still exists."""
    from .db import get_setting

    rules = [dict(r) for r in conn.execute("SELECT * FROM category_rules ORDER BY id")]
    fallback = get_setting(conn, "fallback")
    if fallback and not conn.execute("SELECT 1 FROM categories WHERE id = ?", (fallback,)).fetchone():
        fallback = None
    return rules, fallback


def recategorize(conn) -> int:
    """File every payment that isn't sorted by hand. Returns how many changed category."""
    rules, fallback = load(conn)
    changed = 0
    rows = conn.execute(
        "SELECT id, amount, raw, purpose, category_id, cat_source, cat_rule FROM transactions"
        " WHERE amount < 0 AND (cat_source IS NULL OR cat_source IN ('rule', 'fallback'))"
    ).fetchall()
    for t in rows:
        hit = matching(rules, dict(t))
        if hit:
            cat, source, rid = hit[0]["category_id"], "rule", hit[0]["id"]
        elif fallback:
            cat, source, rid = fallback, "fallback", None
        else:
            cat, source, rid = None, None, None
        if (cat, source, rid) != (t["category_id"], t["cat_source"], t["cat_rule"]):
            conn.execute("UPDATE transactions SET category_id = ?, cat_source = ?, cat_rule = ? WHERE id = ?", (cat, source, rid, t["id"]))
            changed += cat != t["category_id"]
    return changed


def paypal_merchant(purpose: str) -> str | None:
    m = PAYPAL_MERCHANT.search(purpose or "")
    name = m.group(1).strip(" .") if m else ""
    return name or None


def learn_pattern(txn: dict) -> tuple[str, str] | None:
    """The rule "Always file this merchant here" creates: the payee without branch or terminal numbers
    ('VISA ARAL STATION 190528158' → payee contains 'ARAL STATION'). For PayPal it's the shop named in
    the purpose. None when there's nothing to go on."""
    raw = re.sub(r"^(VISA|GIROCARD)\s+", "", (txn["raw"] or "").split("//")[0].strip(), flags=re.I)
    if INTERMEDIARIES.match(raw.upper()):
        shop = paypal_merchant(txn["purpose"])
        return ("purpose", shop) if shop else None
    words = []
    for w in raw.split():
        if len(re.findall(r"\d", w)) >= 3:
            break
        words.append(w)
    name = " ".join(words) or raw
    return ("payee", name) if norm(name) else None


def suggest(txn: dict, rules: list[dict], category_ids: list[str], fallback: str | None) -> list[str]:
    """Up to two categories for a payment that has none: what rules would say, then the catch-all."""
    out = [r["category_id"] for r in matching(rules, txn)] + [fallback, "misc"]
    seen = []
    for c in out:
        if c in category_ids and c not in seen:
            seen.append(c)
    return (seen or category_ids[:1])[:2]
