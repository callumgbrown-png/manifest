# Next steps (work queue for scheduled sessions)

**All queued work done** apart from items waiting on Dave's answers below.

## Questions for Dave
- **Collect emails at sign-up?** Storing emails is personal data under GDPR, so it needs a short privacy notice (what's stored, why, how to delete it) and a way to remove an account. Options: (a) don't store emails in the game; collect tester contacts through the Discord sign-up instead, (b) add an optional email field plus a privacy notice and a "delete my account" button. Recommendation: (a) for the closed test. Reply with a choice and it gets built.
- **Is progression rewarding enough?** In simulation the median company only grows from 16,000 to about 17,000 net worth over a season (top bots in a 10-company world reach ~24,000). Options: (a) leave it and see how real players feel, (b) raise rewards by lowering tax from 7% to 4–5% (simulate first to keep inflation in check), (c) add season goals or achievements so progress isn't only net worth. Recommendation: (a) plus a short tester survey question about it.
- **Small worlds drift down about 1% a day.** With market scaling, 20–100 companies now lose ~1%/day of money (it was +8%/day inflation before). Options: (a) accept it and lower tax from the admin page during the closed test if players feel poor, (b) scale tax and port fee down for small worlds too. Recommendation: (a), decide after real players try it.

Work top to bottom. Tick items off here and commit with each finished step.

## In progress on branch `wip-bots-seasons`
- [x] Bot traders in the live server (`server/src/bots.ts`, `BOTS` env, default 30)
- [x] Season end: clock stops, trading refused, admin `POST /api/admin/new-season` archives and resets
- [x] Client uses real sea-route distances; season clock, end banner, bot tags
- [x] **Fix small-population inflation.** Done: all market sizes scale by (expected companies / 300)^0.3, fixed per season (`EXPECTED_COMPANIES` env, default 60). Results: 300 companies ~0%/day, 100 ~-0.6%, 20–50 ~-1% to -1.5%. A plain linear scale didn't work (small markets froze: zero trades). Original note: Finding: rules are stable at 300 companies but money grows ~8%/day at 30 and ~4%/day at 100 (`python sim/simulate.py --companies 30 --mix greedy=1.0`). Planned fix: scale port production and consumption by `max(min_scale, companies / reference_companies)` (add both to `config/rules.json` markets; reference 300, min 0.05) in BOTH `sim/simulate.py` and `server/src/engine.ts` (`advance()`). Then confirm money growth < 1%/day at 30, 100 and 300 companies.
- [x] Make `server/test/bots.test.ts` pass (`cd server && npm test`), then merge this branch into `main`. Done: 12/12 tests pass; merged. Work on `main` from now on.

## After that
- [x] Sell orders (players post goods for sale at a port) with matching against buy orders. Done: "List for sale" on a docked ship with cargo; goods wait at the port and the ship is freed; other players buy onto their ships; crossing buy and sell orders fill automatically at the resting order's price; max 10 open orders per company; cancelling a sell needs a docked ship with room. 6 new tests; checked in a browser with two players.
- [x] Season results page showing past seasons from the `seasons` table. Done: `/seasons` page and `/api/seasons`, linked from the leaderboard. Tested a full 56-day season with bots, then `new-season`; archive and reset work.
- [ ] Email field on sign-up (optional) for playtest invites. **Waiting for Dave's answer above.** Don't build until answered.
- [x] Test every feature (asked by Dave, 29 Oct). Done: 76 tests (was 18). New `test/rules.test.ts` covers every engine rule and refusal; `test/server.test.ts` starts the real server on a temp database and tests HTTP, accounts, every WebSocket command, admin, restart replay, bots, season end and new season; `test/browser/client.e2e.ts` (`npm run test:browser`) has two players click through every feature in Chromium plus the admin and seasons pages. Bugs found and fixed:
  - A single request to `//` crashed the whole server (bad URL threw); directory paths would also have crashed it. Requests are now caught and only plain files are served.
  - A WebSocket message over 16 KB crashed the whole server (no error handler). Also `null`/non-object messages could throw.
  - Port numbers sent as strings (`"5"`) were accepted, so a ship's port could become a string and stop matching orders and the client. Ports must now be whole numbers.
  - Admin settings accepted strings and null: tax `"0.05"` turned `1 + tax` into string maths (cargo cost ×10). Now numbers only, and one bad value changes nothing.
  - Admin page: a blank box sent 0 (wiping tax, upkeep or port fee), and "Saved."/errors vanished instantly. Fixed.
  - Client: live updates rebuilt the panel between mouse-down and click, so buttons like "Set sail" often did nothing, and typed quantities/destinations were reset. The panel now waits for the click and keeps what you typed.
- [x] Fix the dead start of each season (Dave chose "pre-stock ports", 29 Oct). Found by testing: every port started at the same stock, so no trade paid until hour ~134 (day 6) with the defaults, day 16 with 5 bots. Now `markets.start_spread` = 0.2: ports that only produce a good start at target x 1.2, ports that only need it at x 0.8 (server and simulator). First profitable trade is now hour 1 with 30 or more bots (hour 24 with 5). Simulator money change per day: 30 companies -0.6%, 100 -0.5%, 300 between -0.2% and +0.3%; all under the 1% growth limit and close to before. **Deploy at a new season**: the change alters starting stock, so replaying a running season's log under it would not reproduce what players saw.
- [x] Accounts and admin hardening (Dave: "keep working, make it better", 29 Oct). Done, with tests:
  - Log out now ends the session on the server (the old token stops working); sessions expire after `SESSION_DAYS` (default 30).
  - Failed log-ins limited to `LOGIN_FAILS` (10) per address per 15 minutes, sign-ups to `SIGNUPS_PER_HOUR` (10) per address. Behind Caddy set `TRUST_PROXY=1` (added to `deploy/manifest.service`) so the real player address is used; without it the forwarded header is ignored, so it can't be spoofed.
  - Admin page: season status line and an "Archive and start a new season" button (asks for confirmation). Admin day counter no longer shows day 57 when the season is over.
  - Client: once the season ends, trading buttons and the order form are replaced by "Trading is closed" instead of buttons that only error.
- [x] Check progression feels rewarding: median company only grows ~16k to ~17k a season; propose a fix in this file rather than changing rules silently. Done: question added for Dave above.
