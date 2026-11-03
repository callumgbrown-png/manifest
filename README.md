# Manifest

A browser-based freight economy MMO. Run a shipping company; every price comes from supply, demand and other players.

## Play it locally

Needs Node.js 22.13 or newer.

```
cd server
npm install
TICK_MS=5000 DIFFICULTY=easy ADMIN_TOKEN=a-long-random-admin-token npm run dev
```

Open http://localhost:8080 to play and http://localhost:8080/admin for the economy dashboard.
`TICK_MS` is the length of one game hour in milliseconds: 5000 for testing, 3600000 (one real hour) for a live season.
`BOTS` (default 30) is how many computer traders keep markets moving; `EXPECTED_COMPANIES` (default 60) sizes the markets for the season. Set it to players + bots you expect.
`DIFFICULTY` (`easy`, `normal` or `hard`) sets the difficulty of a new world or season; you can change it any time on the admin page. Easy lowers tax and fees and makes the bots leave smaller trades to players. `start.bat` uses easy.
`SESSION_DAYS` (default 30) is how long a login lasts. `LOGIN_FAILS` (10 per 15 minutes) and `SIGNUPS_PER_HOUR` (10) limit each address; set `TRUST_PROXY=1` behind Caddy so the player's real address is used.
On Windows, double-click `server/start.bat`.

## What's in the MVP

- 40-port region, four goods (grain, fuel, ore, machinery), voyages in real time
- Three ship classes: coaster (fast, small, cheap), freighter (the start ship) and bulker (slow, big, dear). Machinery is valuable but its markets are thin, ore and grain are cheap and deep, so the best ship and cargo depend on where you are and how much cash you have
- Port markets where price slides with stock; cargo already sailing to each port is public
- Player buy orders with cash held in escrow
- Up to 5 ships per company; one freighter's worth of upkeep is free (so a lone freighter or coaster costs nothing), spare ships scrapped automatically if in debt; a last ship can always sail, with fuel on credit if needed
- Leaderboard by net worth, admin dashboard with live tax, upkeep and port-fee controls
- Every action stored in an append-only event log (SQLite); a restart replays it exactly

## Repository layout

| Path | What it is |
| --- | --- |
| `config/rules.json` | All economy rules, shared by server and simulator |
| `config/map.json` | The region map. `tools/generate_map.py --seed N` makes the ports, grain and fuel; run `tools/add_goods.py` after it to give the ports ore and machinery roles |
| `server/src/engine.ts` | Authoritative game rules, no I/O |
| `server/src/main.ts` | HTTP, WebSockets, accounts, event log, clock |
| `server/public/` | Browser client and admin page |
| `server/test/` | Tests: `npm test` (engine rules, bots, and the real server over HTTP and WebSockets) |
| `server/test/browser/` | Browser test of the client, admin and seasons pages: `npm run test:browser` |
| `sim/` | Python bot simulator and charts for tuning the economy |
| `deploy/` | systemd unit and nightly backup script |

## Tests

```
cd server
npm test                # ~20 s: every engine rule, bots, and a real server on a throwaway database
npm run test:browser    # two players click through every feature in Chromium
```

`npm test` starts real servers on free ports with temporary databases, so it never touches `data/`.
The browser test needs Playwright (`npm i -D playwright && npx playwright install chromium`) and is skipped without it.

## Economy simulator

```
python tools/generate_map.py && python tools/add_goods.py
python sim/simulate.py --seasons 10 --companies 300
python sim/charts.py results
```

Current rules pass all health checks across 10 seasons: see `docs/economy-v1.png`. The Python simulator still models only grain, fuel and the freighter; `npx tsx ../sim/goods-check.ts` (from `server/`) runs the real engine with bots and shows which good and ship class wins where, and `sim/playtest.ts` plays whole seasons.

## Deploying to a VPS

1. Create a small Ubuntu VPS and point your domain at it.
2. Install Node 22, `sqlite3`, and Caddy (for free HTTPS).
3. `sudo useradd -r manifest`, clone this repo to `/opt/manifest`, then `cd server && npm ci && npm run build`.
4. Copy `deploy/manifest.service` to `/etc/systemd/system/`, set a long random `ADMIN_TOKEN`, run `sudo systemctl enable --now manifest`.
5. Caddyfile: `yourdomain.com { reverse_proxy localhost:8080 }` (WebSockets work through it automatically).
6. Add `deploy/backup.sh` to cron, and copy the backups off the server.

## Not built yet

Player corporations, more regions and commodities, warehouses, email verification, anti-multi-account checks beyond one company per account, payments.
