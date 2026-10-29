# Next steps (work queue for scheduled sessions)

## Questions for Dave
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
- [ ] Email field on sign-up (optional) for playtest invites
- [x] Check progression feels rewarding: median company only grows ~16k to ~17k a season; propose a fix in this file rather than changing rules silently. Done: question added for Dave above.
