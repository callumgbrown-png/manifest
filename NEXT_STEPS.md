# Next steps (work queue for scheduled sessions)

Work top to bottom. Tick items off here and commit with each finished step.

## In progress on branch `wip-bots-seasons`
- [x] Bot traders in the live server (`server/src/bots.ts`, `BOTS` env, default 30)
- [x] Season end: clock stops, trading refused, admin `POST /api/admin/new-season` archives and resets
- [x] Client uses real sea-route distances; season clock, end banner, bot tags
- [ ] **Fix small-population inflation.** Finding: rules are stable at 300 companies but money grows ~8%/day at 30 and ~4%/day at 100 (`python sim/simulate.py --companies 30 --mix greedy=1.0`). Planned fix: scale port production and consumption by `max(min_scale, companies / reference_companies)` (add both to `config/rules.json` markets; reference 300, min 0.05) in BOTH `sim/simulate.py` and `server/src/engine.ts` (`advance()`). Then confirm money growth < 1%/day at 30, 100 and 300 companies.
- [ ] Make `server/test/bots.test.ts` pass (`cd server && npm test`), then merge this branch into `main`.

## After that
- [ ] Sell orders (players post goods for sale at a port) with matching against buy orders
- [ ] Season results page showing past seasons from the `seasons` table
- [ ] Email field on sign-up (optional) for playtest invites
- [ ] Check progression feels rewarding: median company only grows ~16k to ~17k a season; propose a fix in this file rather than changing rules silently
