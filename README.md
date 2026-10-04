# Monat

A personal budget app for one person and one ING account. It's an iPhone PWA served by a small Python
server that you host yourself, and it syncs with ING over FinTS every 2 hours. The design comes from Claude Design: the
source file is [`design/claude-design/MonatApp.dc.html`](design/claude-design/MonatApp.dc.html), and the full
canvas is in the Claude Design project "Monat Budget".

- **Backend:** FastAPI and SQLite (`app/`). No ORM and no build step.
- **Frontend:** Preact and htm, vendored as a single file (`web/`). It's plain ES modules, so there's no Node toolchain.
- **Sync:** python-fints (`app/sync.py`), the same flow as `banking-stuff/ing-scripts`. It runs inside the server process.

## Deploy with Docker

### Behind the invisibleservices edge (monat.alirezarpi.com)

The landing server's edge nginx terminates HTTPS and proxies `monat.alirezarpi.com` to `monat:8765` on the
shared `edge-apps` Docker network. That part lives in the `invisibleservices` repo (`landing_proxied_sites`,
`src/landing-page/DEPLOY.md` §9). Monat runs from a Docker Hub image; the server never builds.

**Publish** from your laptop, after committing:

```bash
docker login                 # once, as alirezarpi
./scripts/publish.sh         # pushes alirezarpi/monat:latest and alirezarpi/monat:<commit>
```

**Run** on the server, from `/opt/monatapp`. It holds only `docker-compose.yml`, copied from
[`deploy/docker-compose.yml`](deploy/docker-compose.yml), and `.env`:

```bash
docker compose pull && docker compose up -d
docker compose run --rm monat python -m app.sync --setup   # once: connect to ING, confirm a TAN if asked
```

To update, publish again, then run `docker compose pull && docker compose up -d` on the server. To roll back, set
`MONAT_IMAGE=alirezarpi/monat:<commit>` in `.env` and run the same command.

### Standalone, with Caddy

On a server without its own proxy, Caddy (profile `caddy`) takes ports 80 and 443 and gets the
Let's Encrypt certificate for `MONAT_DOMAIN` itself. It needs DNS pointing at the server and ports 80/443 open.

```bash
cp .env.example .env    # MONAT_DOMAIN, MONAT_PASSWORD, FINTS_*
docker compose --profile caddy up -d --build
docker compose run --rm monat python -m app.sync --setup
```

Either way, open the HTTPS address, sign in, and on the iPhone tap Share → **Add to Home Screen**.
The app's data lives in the `monat-data` volume; keep it. The app is also reachable at `http://localhost:8765`,
but only from the server itself.

### If nginx already uses ports 80 and 443 on that server

Caddy can't start next to another proxy on the same ports. In that case, start only the app with
`docker compose up -d --build monat`, and give nginx a site for the subdomain:

```nginx
server {
    server_name monat.alirezarpi.com;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, so clients can't fake their IP
    }
    listen 80;
}
```

Then run `sudo certbot --nginx -d monat.alirezarpi.com` for HTTPS.

To take a backup:

```bash
docker compose exec monat python -c "import sqlite3; sqlite3.connect('/data/monat.db').backup(sqlite3.connect('/data/backup.db'))"
```

### Sign-in

The whole API is behind a single password, `MONAT_PASSWORD` in `.env`, at least 12 characters:
- A sign-in lasts 90 days per device; **Sign out** is in Settings.
- Changing the password and restarting signs out every device.
- Failed attempts are limited to 5 per IP address in 15 minutes and 20 overall per hour.
- Changes must come from Monat's own pages; requests from other sites are refused.
- Responses carry a strict Content-Security-Policy, and API responses are never cached.

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
- **Rules:** each category has rules (Budgets → a category → Rules): a word or phrase to find in the payee, the
  purpose text or either, optionally only within an amount range. Payments that match are filed automatically, past
  ones included, and every rule change refiles them. If rules in two categories match, the more specific one wins
  (an amount range, then a single field, then the longer phrase). A category picked by hand is never changed.
  "Always file this way" adds a payee rule for the merchant; for PayPal it uses the shop named in the purpose.
- **Catch-all:** one category (Misc by default) can catch every payment no rule matches.
- **Starting rules:** on first start after the update, categories get rules by name (Rent, Groceries, Servers, …;
  see `RULES` in `app/seed.py`), Misc becomes the catch-all and every payment not sorted by hand is filed.
  Transfers between your own ING accounts are ignored.
- **TAN requests:** the scheduled sync never prompts. If ING asks for a TAN, the app says so; run the `--setup`
  command again and confirm it.
- **Wrong PIN:** automatic syncing pauses until the PIN in `.env` changes, so retries can't lock your ING login.

## Develop

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
MONAT_DEMO=1 MONAT_PASSWORD='a long dev password' .venv/bin/uvicorn app.main:app --reload --port 8765
```

Set `MONAT_PASSWORD` here too; the app asks for it. `MONAT_DEMO=1` seeds the month from the design (Wednesday 21 October 2026, with history from May), pins the clock to
that day, and fakes the sync. Delete the database file to reseed it.

| Path | What |
|---|---|
| `app/main.py` | API, sign-in gate, scheduler. `GET /api/state` returns everything; every change returns the new state. |
| `app/auth.py` | Password check, sessions, sign-in rate limits |
| `app/sync.py` | FinTS fetch, MT940 → transactions, sync status |
| `app/db.py`, `app/seed.py` | Schema, settings, default categories, demo data |
| `app/categorize.py` | Filing rules: matching, the catch-all, refiling, inbox suggestions |
| `web/js/lib/rules.js` | The same matching in the browser, for the rule editor's live preview |
| `web/js/lib/budget.js` | Budget months (including payday months), category states, safe to spend, summary copy |
| `web/js/lib/charts.js` | Month ring, category ring, pace chart, 6-month bars |
| `web/js/screens/` | One module per screen |

## Not built yet

- **Push notifications and alert generation.** The copy and triggers are specified in the design (Web Push with
  VAPID, iOS 16.4+). For now the in-app history only shows the demo alerts.
- **Carry-over.** The flag is saved per category, but it doesn't change next month's limit yet.
- **PDF summary export.** Only CSV export exists.
