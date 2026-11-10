# Progression category report (ideas 131-145, 381-420)

All 55 ideas are built as 44 modules in `server/src/features/progression/`, tested in
`server/test/features-progression.test.ts` (36 tests, including a full replay with every module on). No shared core
files were edited. Content (achievements, titles, quests, puzzles, tech, presets) is data in
`config/content/progression/*.json`, extendable by data mods.

Every statistic comes from one shared tracker (`tracker.ts`) that reads the engine's own trip log and fleet once an
hour, so no player command can fake progress. Views and cards only read; a view never creates state, so a live server
reading views at odd times cannot make a replay drift (there is a test for this).

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| progression.run-modes | 396, 398, 406, 409 | Pick a mode in the first day: standard, sandbox, tycoon, ironman (locked), hardcore (run ends on bankruptcy or losing every ship) |
| progression.new-game-plus | 399 | After the tutorial and level 10/20/...: take a star; quest and goal targets rise by half per star |
| progression.captain-levels | 138 | Experience from deliveries, distance, profit and goals; 50 levels |
| progression.rank-ladder | 391 | Rank names by level (Deckhand to Admiral of the Line) and standings among players |
| progression.stats-dashboard | 393 | Career numbers, per-good totals and top routes |
| progression.collection-book | 144 | Ports visited and goods delivered, with the hour each was first collected |
| progression.achievements | 134, 384, 394, 395 | Achievements, account milestones, long-term goals (incl. a 50-ship fleet) and secret achievements; experience and pennants only |
| progression.titles | 135, 390 | Earnable titles and playstyle titles (Grain Baron, Long Hauler, Drifter...); show one next to your name |
| progression.skins | 143 | Milestone pennants flown on your ships at sea |
| progression.trophy-room | 383 | Trophies from tournaments, ladders, puzzles, campaigns and seasons |
| progression.hall-of-fame | 392 | World records: best trip, largest fleet, highest worth, distance, deliveries |
| progression.daily-quests | 386 | Three quests a day, picked deterministically per company |
| progression.weekly-goals | 136 | Two goals a week |
| progression.tutorial | 137 | Six-step contract chain from first voyage to second ship; can be skipped |
| progression.season-track | 385 | Free reward track (pennants, titles, badges) from experience |
| progression.daily-route | 404 | One producer-to-consumer route a day, drawn on the map |
| progression.puzzles | 403, 412 | Timed scenario puzzles ("deliver 100 with at most 100 fuel") and untimed training missions |
| progression.challenges | 397 | 14-day challenge runs (one ship, no bulkers, grain only, no queues...) |
| progression.coop-campaign | 402 | Crews of up to 4 companies clear five campaign chapters together |
| progression.weekly-leaderboards | 142 | Profit, deliveries and distance this week; last week's podium gets trophies |
| progression.seasons | 410 | Countdown and final standings with trophies when the time-limited season ends |
| progression.tournaments | 411 | Every 3 days, a 24-hour most-profit tournament; podium trophies and experience |
| progression.tech-tree | 131 | Research points from deliveries and distance unlock nodes |
| progression.licences | 132 | Licences come from the tech tree; unlicensed deliveries are recorded (no penalty while fines are off) |
| progression.remote-islands | 139 | The most remote fifth of ports is charted at captain level 8; first landfalls give experience |
| progression.world-presets | 401, 407, 408, 413-417 | Offline solo, cosy, pirate-only, steamship, futuristic, fantasy, Arctic and Mediterranean presets: palette, names, map files, settings checklist |
| progression.map-sharing | 418, 419 | Client map editor (✎ on the chart) and a server-validated gallery to share, rate and download maps |
| progression.mods | 420 | Data mods from `config/content/progression/mods/` (validated, cannot replace base content) |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| progression.sandbox-funds | 396, 409 | Sandbox companies topped up to 1,000,000 hourly; tycoon companies get 250,000 once |
| progression.achievement-rewards | 134 | Pays 2 credits per experience point of each achievement earned while on |
| progression.title-perks | 135 | Showing an earned title cuts port fees 2% |
| progression.seasonal-ladder | 141 | 14-day ladder rounds; pays 0/500/1,500/3,000/5,000 by tier at each reset |
| progression.blitz | 405 | 6-hour speed-trading blitz every 2 days: 200 entry into a pot, plus a 500 bonus, split 60/30/10 |
| progression.tech-bonuses | 131 | Tech node effects: up to -3% fuel, -5% port fees, +4% hold, -3% travel time |
| progression.licence-fines | 132 | Unlicensed cargo fined 5% of the sale, at most 500 |
| progression.skill-points | 387 | One point per level: 1% fuel, fees, speed or hold each (max 5 per skill) |
| progression.cargo-mastery | 388 | Mastery tiers per good (500/2,000/5,000 units): -2% port fees per tier when arriving with it |
| progression.route-mastery | 389 | Tiers per route (3/10/25 runs): 2% faster per tier on that route |
| progression.veteran-perks | 400 | Level 15+ or a New Game+ star: -3% fuel and upkeep |
| progression.heirlooms | 382 | Heirlooms found at levels 5/10/20/30 (fuel, fees, speed, upkeep); two equipped |
| progression.legacy | 381 | Retire the captain at level 10/20/...: -1% upkeep and fuel per retirement (max 5) |
| progression.prestige | 140 | At 150,000 net worth, reset cash to the starting purse for +3% hold per prestige (max 5) |
| progression.daily-login | 133 | 100 credits a game day, +25 per streak day up to 7 days |
| progression.offline-progress | 145 | Away mode (72 h): docked empty ships repeat their last profitable run through the voyage queue |

## Decisions
- **Assignment said economy for achievements (134) and titles (135):** achievements and titles themselves are on and
  give only experience and cosmetics; the money side is split into `achievement-rewards` and `title-perks` (off).
- **Assignment said ON for sandbox (396) and tycoon (409), but they need money:** the mode choice is on
  (`run-modes`), the funds are `sandbox-funds` (off). Sandbox and tycoon companies are left out of every ranking.
- **Tech tree (131) and licences (132) are on, their effects are off:** without an engine veto hook a licence cannot
  block a purchase, so licences are certificates; the penalty is `licence-fines` (off).
- **Remote islands (139)** cannot be blocked without an engine hook either, so they are "uncharted" (drawn locked on
  the map) and give nothing before level 8, and a landfall bonus after.
- **Cosy (407) and pirate-only (408)** are world presets: the module lists the `rules.json` settings to change instead
  of rewriting rules at run time, so an operator always sees what the world runs.
- **Arctic and Mediterranean maps (416, 417)** are real map files (`config/maps/`), loaded into a fresh world with
  `server/scripts/use-map.ts` (writes the `world_map` row main.ts already reads), so main.ts needed no change.
- **Hardcore permadeath (406)** cannot delete a company, so the run "ends": progression freezes and the trophy room
  records it.
- **Offline single-player (401)** is the existing server run locally with bots; the preset documents the command.
- Map gallery entries are full maps; to keep state updates small, only the map a company asked to download is sent
  to it.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
