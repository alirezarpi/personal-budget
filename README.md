# Monat

A personal budget app for one person and one ING account. It's an iPhone PWA served by a small Python
server that you host yourself, and it syncs with ING over FinTS every 2 hours. The design comes from Claude Design: the
source file is [`design/claude-design/MonatApp.dc.html`](design/claude-design/MonatApp.dc.html), and the full
canvas is in the Claude Design project "Monat Budget".

- **Backend:** FastAPI and SQLite (`app/`). No ORM and no build step.
- **Frontend:** Preact and htm, vendored as a single file (`web/`). It's plain ES modules, so there's no Node toolchain.
- **Sync:** python-fints (`app/sync.py`), the same flow as `banking-stuff/ing-scripts`. It runs inside the server process.

## Deploy with Docker

```bash
cp .env.example .env          # fill in FINTS_USER, FINTS_PIN, FINTS_PRODUCT_ID
docker compose up -d --build
docker compose run --rm monat python -m app.sync --setup   # once: pick the TAN method, confirm a TAN if ING asks
```

Data lives in the `monat-data` volume at `/data/monat.db`. The port is only bound to `127.0.0.1`.
To reach the app from your phone, put it on your tailnet over HTTPS, which iOS requires before it will install a PWA:

```bash
tailscale serve --bg 8765
```

Then open `https://<server>.<tailnet>.ts.net` in Safari, tap Share, and choose **Add to Home Screen**.

To take a backup:

```bash
docker compose exec monat python -c "import sqlite3; sqlite3.connect('/data/monat.db').backup(sqlite3.connect('/data/backup.db'))"
```

## Sync

- **Schedule:** the server syncs every `SYNC_INTERVAL_MINUTES` (default 120, minimum 15). The first sync reads 90 days.
  Each later sync re-reads the last 7, so late bookings are caught.
- **Sync button:** **Sync now** in Settings, or pulling down on the overview, asks ING straight away. It works once every
  `SYNC_MANUAL_COOLDOWN_MINUTES` (default 120), and the server enforces this too. A manual sync also restarts the
  schedule, so ING sees at most about two logins per two hours. During the cooldown, pulling down only refreshes the
  app from your server, and the button shows when it's available again. The open app refreshes every 5 minutes.
- **Card payments:** ING books them the next business day, so a card payment appears with the first sync after
  ING books it, not at the till.
- **Learned merchants:** new payments from a merchant you've sorted before are filed automatically.
  Transfers between your own ING accounts are ignored.
- **TAN requests:** the scheduled sync never prompts. If ING asks for a TAN, the app says so; run the `--setup`
  command again and confirm it.
- **Wrong PIN:** automatic syncing pauses until the PIN in `.env` changes, so retries can't lock your ING login.

## Develop

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
MONAT_DEMO=1 .venv/bin/uvicorn app.main:app --reload --port 8765
```

`MONAT_DEMO=1` seeds the month from the design (Wednesday 21 October 2026, with history from May), pins the clock to
that day, and fakes the sync. Delete the database file to reseed it.

| Path | What |
|---|---|
| `app/main.py` | API and scheduler. `GET /api/state` returns everything; every change returns the new state. |
| `app/sync.py` | FinTS fetch, MT940 → transactions, sync status |
| `app/db.py`, `app/seed.py` | Schema, settings, default categories, demo data |
| `app/categorize.py` | Inbox suggestions and learned merchant rules |
| `web/js/lib/budget.js` | Budget months (including payday months), category states, safe to spend, summary copy |
| `web/js/lib/charts.js` | Month ring, category ring, pace chart, 6-month bars |
| `web/js/screens/` | One module per screen |

## Not built yet

- **Push notifications and alert generation.** The copy and triggers are specified in the design (Web Push with
  VAPID, iOS 16.4+). For now the in-app history only shows the demo alerts.
- **Carry-over.** The flag is saved per category, but it doesn't change next month's limit yet.
- **PDF summary export.** Only CSV export exists.
