# Platform category report (ideas 196-200, 551-600)

All 55 ideas are built as 31 modules in `server/src/features/platform/`, tested in `server/test/features-platform.test.ts`
(28 tests, including a full replay of every module together). Tools that work outside the running game are in
`tools/platform/` (replay, rollback, backup, pre-deploy check) and `sim/personas.ts` (persona simulator); the client
part is `server/public/features/platform.js`; the admin console is a new section of `server/public/admin.html`.

## Switched on (content, tools and safety)
| Module | Ideas | What it does |
| --- | --- | --- |
| platform.audit | 554, 555, 562 | Hourly economy audit log (cash movements) and invariant checks: prices and orders inside their bands, no negative or over-capacity cargo, every ship in exactly one fleet |
| platform.anomaly | 563, 564 | Alerts for cash jumps, fills outside the price band, cargo growing at sea, a ship in two fleets (duplication guard) |
| platform.multi-account | 553 | Linked-account check from in-game behaviour only: three off-market trades between the same pair in a week flags both for review |
| platform.activity-watch | 551, 552 | Actions per company per hour; bursts (over 15 an hour) and no-sleep patterns (22 of 24 hours) raise review flags. Platform commands are rate-limited per company |
| platform.fair-play | 565, 566 | Leaderboard without companies flagged on hard evidence; event brackets (rookie for the first 3 days, then gold/silver/bronze by net worth) |
| platform.bug-report | 199 | Bug report button (kind + up to 280 characters) with a fleet snapshot; 3 a day |
| platform.reports | 556, 559, 560 | Player reports; three established reporters in 3 days cost 10 reputation and flag for review; appeals lift the penalty after 3 quiet days; reputation recovers 1 a day |
| platform.chat-safety | 557, 558 | Mute and block lists (blocked companies can't take your contracts) and the shared text filter (`config/content/platform/chat-filter.json`; contact details always removed) |
| platform.pirate-shield | 568 | Cargo-raid protection for companies in their first 72 hours or worth under 1.5x the starting cash |
| platform.economy-health | 196, 578, 579, 585 | Hourly health score (0-100 from equality, solvency, prices away from limits, activity), Gini of player net worth, two weeks of history and a plain-text balance report for the admin dashboard |
| platform.churn | 577 | Churn risk from idle hours and falling worth (admin list); returning players see a welcome-back summary |
| platform.route-heatmap | 580 | Departures per lane over the last week, drawn on the map (toggle in the strip under the map) |
| platform.telemetry | 198 | Anonymous hourly totals (voyages, orders, ships bought, active companies); no ids or names |
| platform.bot-reports | 583 | An hourly AI-readable report (`manifest-bot-report/1`: players vs house bots, Gini, widest spreads, a one-line summary) |
| platform.experiments | 197, 581 | Feature flags (the switched-on list is sent to clients) and A/B tests from `config/content/platform/experiments.json`; a company's variant is a fixed hash; results by variant in the admin console |
| platform.checkpoints | 200, 561, 584, 586, 589 | Hourly world digest and the world seed; the digest is what the replay, rollback, backup and simulator-replay tools check |
| platform.self-test | 582, 590 | Once a game day, runs a fixed scenario twice in fresh engines and checks determinism and invariants; the same check is in `tools/platform/predeploy.ts` |
| platform.admin-console | 588 | Admin console: `/api/admin/features` (admin token) returns admin-only data from every switched-on module; shown on the admin page (health chart, flags, alerts, reports, appeals, bug reports, churn, experiments, checkpoints) |
| platform.debug-overlay | 587 | Debug overlay on the map (F3): tick, ships, orders, checkpoint digest, self-test, your experiment variants |
| platform.personas | 571-576 | The five simulator personas (min-maxer, explorer, pirate, social, casual) as playing policies for `sim/personas.ts`; live players see which style they play like |
| platform.exotic-craft | 591, 592 | Refit a ship into a submarine (no cargo raids at sea, finds the underwater port) or an airship; 12 h in the home yard, no charge |
| platform.space-shipping | 593 | The best-connected port is a spaceport; ordinary sales of the rocket good there fill the next rocket together; contributors get launches on their record |
| platform.mystery-places | 594, 595, 596 | A hidden underwater port (submarines dive to find it), a ghost port that appears at random for 12 h (collect a lantern), a floating city that moves daily (passport stamps) |
| platform.time-rifts | 597 | A rift to another era opens at a random port every few days for 24 h; step through for an era relic |
| platform.dragon | 598 | Fantasy mode (per player, opt-in): a dragon roams the coast; befriend it 5 times to ride it; pirates don't raid ships docked beside it |
| platform.fleet-battles | 599 | Pirate armadas appear every 1.5-3 days; players commit docked ships (up to 3 each), hourly battle rounds shown to everyone; winners get honours and a day of raid protection. Ships are never damaged |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| platform.newbie-zones | 567 | First 72 hours: no port fee and 25% less fuel inside the home port's protected waters |
| platform.catch-up | 569 | Companies under half the median player worth pay half upkeep and half port fees |
| platform.wealth-limits | 570 | Above 5x the median player worth, daily upkeep rises by 0.2% of the excess (max 5,000 a day); the money leaves the game |
| platform.exotic-craft-effects | 591, 592 | Airships 25% faster but 40% more fuel; submarines lose 20% of their hold |
| platform.player-contracts | 600 | Player-written delivery contracts: reward held in escrow, paid on delivery (cargo goes into the port's stock), refunded on expiry |

## Decisions
- **Shared core file edited (minimal):** `main.ts` gets one admin-only route, `/api/admin/features` (6 lines plus an
  import), because module admin data (flags, reports, appeals, bug reports) must not go to players through
  `world()`, and there was no other way to reach the admin page. It uses the existing admin-token check.
  `admin.html` (not a protected file) gained the feature-console section.
- **Nothing bans or fines automatically.** Integrity modules only flag for review; only hard evidence (cash jumps,
  impossible fills, duplicated ships, cargo growing at sea, repeated off-market trading) keeps a company off the
  fair-play leaderboard. The reputation penalty from player reports has no gameplay effect yet beyond the number.
- **Server-authoritative state (555) and server-side price validation (554)** were already true of the engine
  (clients send intents; the server computes prices, fills and balances). The modules add the audits that prove it.
- **No personal data.** The multi-account check uses in-game trades only (no IPs, e-mails or devices); telemetry is
  totals only; free text is filtered and length-limited, with contact details removed.
- **Space shipping, rift relics, lanterns, stamps, dragon friendship and battle honours give collectibles, not money.**
  Space shipping counts ordinary market sales rather than consuming cargo, so it stays economy-neutral.
- **Protection is content, not economy:** the submarine, dragon and battle-victory raid protection reuse the engine's
  cargo-raid protection (as `platform.pirate-shield`, idea 568, which the assignment marked ON).
- **Rollback (561) is a tool, not an in-game command:** `tools/platform/rollback.ts` writes a new save ending at a
  chosen hour after checking its checkpoint digest; the original save is never changed. Backups (589) use SQLite
  `VACUUM INTO`, safe while the server runs; schedule `tools/platform/backup.ts` hourly.
- **Tools run with `npx tsx`** from `server/` like the existing simulator; `sim/out/` (simulator reports and replay
  files) is git-ignored.
- **Fixed in the WIP snapshot:** the text filter's character-class regex contained raw line-separator characters that
  broke parsing; it now uses escapes.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
