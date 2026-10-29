# Next steps (work queue for scheduled sessions)

## Questions for Dave
- **Small worlds drift down about 1% a day.** With market scaling, 20–100 companies now lose ~1%/day of money (it was +8%/day inflation before). Options: (a) accept it and lower tax from the admin page during the closed test if players feel poor, (b) scale tax and port fee down for small worlds too. Recommendation: (a), decide after real players try it.

Work top to bottom. Tick items off here and commit with each finished step.

## In progress on branch `wip-bots-seasons`
- [x] Bot traders in the live server (`server/src/bots.ts`, `BOTS` env, default 30)
- [x] Season end: clock stops, trading refused, admin `POST /api/admin/new-season` archives and resets
- [x] Client uses real sea-route distances; season clock, end banner, bot tags
- [x] **Fix small-population inflation.** Done: all market sizes scale by (expected companies / 300)^0.3, fixed per season (`EXPECTED_COMPANIES` env, default 60). Results: 300 companies ~0%/day, 100 ~-0.6%, 20–50 ~-1% to -1.5%. A plain linear scale didn't work (small markets froze: zero trades). Original note: Finding: rules are stable at 300 companies but money grows ~8%/day at 30 and ~4%/day at 100 (`python sim/simulate.py --companies 30 --mix greedy=1.0`). Planned fix: scale port production and consumption by `max(min_scale, companies / reference_companies)` (add both to `config/rules.json` markets; reference 300, min 0.05) in BOTH `sim/simulate.py` and `server/src/engine.ts` (`advance()`). Then confirm money growth < 1%/day at 30, 100 and 300 companies.
- [x] Make `server/test/bots.test.ts` pass (`cd server && npm test`), then merge this branch into `main`. Done: 12/12 tests pass; merged. Work on `main` from now on.

## After that
- [ ] Sell orders (players post goods for sale at a port) with matching against buy orders
- [ ] Season results page showing past seasons from the `seasons` table
- [ ] Email field on sign-up (optional) for playtest invites
- [ ] Check progression feels rewarding: median company only grows ~16k to ~17k a season; propose a fix in this file rather than changing rules silently
