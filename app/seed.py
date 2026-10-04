"""Default categories, plus the demo month from the Claude Design file (MONAT_DEMO=1)."""

import random
from calendar import monthrange
from datetime import date, timedelta

from .db import set_setting

CATEGORIES = [
    # id, name, limit, threshold, fixed, due_day, color, icon, carry
    ("rent", "Rent", 950, 100, 1, 1, "rent", "rent", 0),
    ("groc", "Groceries", 200, 80, 0, 1, "groc", "groc", 1),
    ("car", "Car", 180, 80, 0, 1, "car", "car", 0),
    ("eat", "Eating out", 120, 80, 0, 1, "eat", "eat", 0),
    ("subs", "Subscriptions", 45, 90, 0, 1, "subs", "subs", 0),
    ("health", "Health", 60, 80, 0, 1, "health", "health", 1),
    ("misc", "Misc", 100, 80, 0, 1, "misc", "misc", 0),
]


def categories(conn):
    conn.executemany(
        "INSERT INTO categories(id, name, monthly_limit, threshold, fixed, due_day, color, icon, carry, position)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(*c, i) for i, c in enumerate(CATEGORIES)],
    )


def card_purpose(raw, d: date, time, method):
    return f"{raw}//BERLIN/DE {d.isoformat()}T{time} KARTENZAHLUNG {method.upper()}"


# October 2026, exactly as drawn. Amounts are money out unless the category is None and it's the salary.
OCTOBER = [
    ("t1", 1, "06:02", "Hausverwaltung Becker", "HAUSVERWALTUNG BECKER GMBH", "rent", -950, "Standing order", "MIETE OKTOBER 2026 WHG 3.OG LINKS SKALITZER STR. 41", "DE27 1005 0000 0190 4471 03"),
    ("t2", 1, "06:02", "HUK-Coburg", "HUK-COBURG VERSICHERUNG", "car", -68.40, "Direct debit", "KFZ-VERSICHERUNG VS-NR 812/442117-K BEITRAG 10/2026 MANDATSREF HUK0091827", "DE73 7835 0000 0000 1234 56"),
    ("t3", 1, "06:02", "Muster Software GmbH", "MUSTER SOFTWARE GMBH", None, 3400, "Transfer", "GEHALT 10/2026 PERSONALNR 1187", "DE02 1203 0000 0000 2020 51"),
    ("t4", 2, "18:42", "REWE", "REWE MARKT GMBH", "groc", -23.85, "girocard", None, None),
    ("t5", 3, "13:10", "Burgermeister", "BURGERMEISTER KOTTBUSSER TOR", "eat", -14.50, "Visa Debit", None, None),
    ("t6", 3, "17:26", "Lidl", "LIDL DIENSTL. SAGT DANKE", "groc", -18.42, "girocard", None, None),
    ("t7", 5, "03:14", "Netflix", "NETFLIX.COM", "subs", -13.99, "Visa Debit", "NETFLIX.COM 866-579-7172 NL MITGLIEDSCHAFT", None),
    ("t8", 6, "07:51", "Shell", "SHELL 1219 BERLIN", "car", -61.20, "girocard", None, None),
    ("t9", 7, "19:05", "Edeka", "EDEKA CENTER", "groc", -31.07, "girocard", None, None),
    ("t10", 8, "12:33", "dm-drogerie markt", "DM-DROGERIE MARKT", "health", -8.45, "girocard", None, None),
    ("t11", 9, "18:20", "REWE", "REWE MARKT GMBH", "groc", -12.60, "girocard", None, None),
    ("t12", 9, "16:47", "Thalia", "THALIA BUCHHANDLUNG", "misc", -16.99, "Visa Debit", None, None),
    ("t13", 10, "20:12", "Pho Hanoi", "PHO HANOI", "eat", -18.90, "Visa Debit", None, None),
    ("t14", 10, "11:02", "Lidl", "LIDL DIENSTL. SAGT DANKE", "groc", -22.19, "girocard", None, None),
    ("t15", 12, "02:40", "Spotify", "SPOTIFY", "subs", -12.99, "Visa Debit", "SPOTIFY P2F3A9C1 STOCKHOLM SE", None),
    ("t16", 13, "04:10", "Apple iCloud+", "APPLE.COM/BILL", "subs", -2.99, "Visa Debit", "APPLE.COM/BILL ITUNES.COM IE ICLOUD+ 200 GB", None),
    ("t17", 13, "06:00", "ZEIT Digital", "ZEIT ONLINE GMBH", "subs", -9.00, "Direct debit", "ZEIT ONLINE GMBH ABO 448812 HAMBURG", "DE51 2005 0550 1263 1407 80"),
    ("t18", 14, "18:55", "REWE", "REWE MARKT GMBH", "groc", -27.34, "girocard", None, None),
    ("t19", 15, "07:40", "Aral", "ARAL STATION 280113", "car", -58.90, "girocard", None, None),
    ("t20", 16, "21:18", "Il Gattopardo", "IL GATTOPARDO", "eat", -22.60, "Visa Debit", None, None),
    ("t21", 17, "10:21", "Edeka", "EDEKA CENTER", "groc", -14.98, "girocard", None, None),
    ("t22", 17, "10:40", "Rosen-Apotheke", "ROSEN-APOTHEKE", "health", -4.05, "girocard", None, None),
    ("t23", 18, "14:02", "APCOA Parking", "APCOA PARKING DE", "car", -14.60, "Visa Debit", None, None),
    ("t24", 17, "15:30", "IKEA", "IKEA DEUTSCHLAND", "misc", -24.21, "girocard", None, None),
    ("t25", 19, "07:55", "Bäckerei Kamps", "BAECKEREI KAMPS", "eat", -8.00, "girocard", None, None),
    ("t26", 20, "18:51", "Lidl", "LIDL DIENSTL. SAGT DANKE", "groc", -21.95, "girocard", None, None),
    ("u1", 21, "08:14", "SumUp *Kiezkaffee", "SUMUP *KIEZKAFFEE", None, -3.80, "Visa Debit", "SUMUP *KIEZKAFFEE//BERLIN/DE 2026-10-21T08:14 KARTENZAHLUNG", None),
    ("u2", 20, "12:30", "PayPal *Kleinanzeigen", "PAYPAL EUROPE S.A.R.L.", None, -25.00, "Direct debit", "PP.7712.PP . KLEINANZEIGEN, IHR EINKAUF BEI KLEINANZEIGEN", "LU89 7510 0013 5104 2000 08"),
    ("u3", 19, "17:44", "Tchibo", "TCHIBO FIL. 0412", None, -12.99, "girocard", None, None),
]

# Monthly totals for May–September from the design's category history.
HISTORY = {
    "groc": [188.20, 205.60, 176.30, 214.90, 192.75],
    "car": [165.40, 142.80, 231.60, 158.20, 176.90],
    "eat": [98.50, 134.20, 88.00, 142.60, 76.30],
    "health": [24.80, 8.95, 41.30, 15.60, 30.10],
    "misc": [72.40, 118.90, 54.30, 96.10, 63.80],
}
MERCHANTS = {
    "groc": [("REWE", "REWE MARKT GMBH"), ("Lidl", "LIDL DIENSTL. SAGT DANKE"), ("Edeka", "EDEKA CENTER"), ("Aldi Nord", "ALDI SAGT DANKE")],
    "car": [("Shell", "SHELL 1219 BERLIN"), ("Aral", "ARAL STATION 280113"), ("APCOA Parking", "APCOA PARKING DE")],
    "eat": [("Pho Hanoi", "PHO HANOI"), ("Burgermeister", "BURGERMEISTER KOTTBUSSER TOR"), ("Il Gattopardo", "IL GATTOPARDO"), ("Bäckerei Kamps", "BAECKEREI KAMPS")],
    "health": [("dm-drogerie markt", "DM-DROGERIE MARKT"), ("Rosen-Apotheke", "ROSEN-APOTHEKE")],
    "misc": [("Thalia", "THALIA BUCHHANDLUNG"), ("IKEA", "IKEA DEUTSCHLAND"), ("Amazon", "AMAZON EU S.A R.L.")],
}
SPLITS = {"groc": 8, "car": 2, "eat": 5, "health": 2, "misc": 3}
GERMAN_MONTHS = ["JANUAR", "FEBRUAR", "MAERZ", "APRIL", "MAI", "JUNI", "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"]
CARD_METHODS = ["girocard", "girocard", "Visa Debit"]


def _split(rng, total, n):
    weights = [rng.uniform(0.6, 1.4) for _ in range(n)]
    s = sum(weights)
    parts = [round(total * w / s, 2) for w in weights]
    parts[-1] = round(total - sum(parts[:-1]), 2)
    return parts


def demo(conn):
    rows = []

    def add(id_, d: date, time, merchant, raw, cat, amount, method, purpose=None, iban=None, booked=None):
        purpose = purpose or card_purpose(raw, d, time, method)
        booked = booked or (d + timedelta(days=1)).isoformat()
        rows.append((id_, d.isoformat(), time, booked, amount, merchant, raw, purpose, method, iban, cat))

    for t in OCTOBER:
        id_, day, time, merchant, raw, cat, amount, method, purpose, iban = t
        d = date(2026, 10, day)
        add(id_, d, time, merchant, raw, cat, amount, method, purpose, iban, booked="2026-10-21" if day == 21 else None)

    rng = random.Random(1187)
    for i, month in enumerate(range(5, 10)):
        dim = monthrange(2026, month)[1]
        first = date(2026, month, 1)
        mname = GERMAN_MONTHS[month - 1]
        add(f"h{month}-rent", first, "06:02", "Hausverwaltung Becker", "HAUSVERWALTUNG BECKER GMBH", "rent", -950, "Standing order",
            f"MIETE {mname} 2026 WHG 3.OG LINKS SKALITZER STR. 41", "DE27 1005 0000 0190 4471 03")
        add(f"h{month}-pay", first, "06:02", "Muster Software GmbH", "MUSTER SOFTWARE GMBH", None, 3400, "Transfer",
            f"GEHALT {month:02d}/2026 PERSONALNR 1187", "DE02 1203 0000 0000 2020 51")
        add(f"h{month}-huk", first, "06:02", "HUK-Coburg", "HUK-COBURG VERSICHERUNG", "car", -68.40, "Direct debit",
            f"KFZ-VERSICHERUNG VS-NR 812/442117-K BEITRAG {month:02d}/2026 MANDATSREF HUK0091827", "DE73 7835 0000 0000 1234 56")
        subs = [("Netflix", "NETFLIX.COM", 13.99, 5), ("Spotify", "SPOTIFY", 12.99, 12), ("Apple iCloud+", "APPLE.COM/BILL", 2.99, 13),
                ("ZEIT Digital", "ZEIT ONLINE GMBH", 6.00 if month == 8 else 9.00, 13)]
        for j, (m, raw, amt, day) in enumerate(subs):
            add(f"h{month}-s{j}", date(2026, month, day), "04:00", m, raw, "subs", -amt, "Visa Debit")
        for cat, totals in HISTORY.items():
            total = totals[i] - (68.40 if cat == "car" else 0)
            for j, amt in enumerate(_split(rng, total, SPLITS[cat])):
                m, raw = rng.choice(MERCHANTS[cat])
                d = date(2026, month, rng.randint(2, dim))
                time = f"{rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}"
                add(f"h{month}-{cat}{j}", d, time, m, raw, cat, -amt, rng.choice(CARD_METHODS))

    conn.executemany(
        "INSERT INTO transactions(id, date, time, booked, amount, merchant, raw, purpose, method, iban, category_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.execute("INSERT INTO rules(merchant_key, category_id) VALUES ('REWE MARKT GMBH', 'groc')")
    conn.execute("UPDATE transactions SET note = 'Weekly shop, incl. drinks for Saturday' WHERE id = 't4'")

    notifications = [
        ("daily", "Tuesday: €46.95 across 2 payments", "1 still needs a category. Safe to spend today: €15.71.", "2026-10-21T06:14", "inbox", 0),
        ("close", "Groceries at 86%", "€27.60 left for groceries. 11 days to go.", "2026-10-21T06:13", "cat:groc", 0),
        ("inbox", "3 payments need a category", "SumUp *Kiezkaffee, PayPal *Kleinanzeigen and Tchibo.", "2026-10-21T06:13", "inbox", 0),
        ("over", "Car is €23.10 over", "APCOA Parking, €14.60. 13 days to go.", "2026-10-19T06:12", "cat:car", 1),
        ("over", "Car is €8.50 over", "Aral, €58.90, took it past the €180 limit. 16 days to go.", "2026-10-16T06:12", "cat:car", 1),
        ("sync", "ING needs a TAN", "Confirm in ING Banking to keep syncing. Resolved at 07:02.", "2026-10-14T06:10", "settings", 1),
        ("large", "€950.00 to Hausverwaltung Becker", "Filed under Rent and marked as paid for October.", "2026-10-01T06:12", "cat:rent", 1),
        ("daily", "September closed at €1,528.82", "€126.18 of €1,655 stayed unspent. Nothing went over.", "2026-10-01T06:14", None, 1),
    ]
    conn.executemany(
        "INSERT INTO notifications(kind, title, body, created_at, target, read) VALUES (?, ?, ?, ?, ?, ?)",
        notifications,
    )
    set_setting(conn, "account", {"name": "Girokonto", "iban": "DE•• •••• •••• •••• 4821 00", "short": "··4821"})
    set_setting(conn, "sync", {"status": "ok", "last": "2026-10-21T09:12", "next": "2026-10-21T10:12"})
