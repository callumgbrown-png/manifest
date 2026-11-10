# Architecture notes

## Modules
| Area | Files | Notes |
| --- | --- | --- |
| Engine | `server/src/engine.ts` | All game rules, no I/O. `applyLive` validates player commands; `apply` replays; `advance` is one game hour. |
| Server | `server/src/main.ts` | HTTP, WebSockets, accounts, SQLite event log (commands + ticks), replay on start, per-company state views. |
| Economy systems | `maritime.ts`, `guild-freight.ts`, `leaderboards.ts`, `recovery.ts` | Insurance, escorts, convoys, futures, bounties, pennants, backhaul board, harbor projects, season leaderboards. |
| Piracy | `piracy.ts`, `piratebots.ts`, `police.ts` | Raids, notoriety and wanted level, fencing, police patrols. |
| Expansions | `*-expansion.ts` | Trade, ports, piracy, exploration, fleet, scenario; one switch (`EXPANSION`), cards in the Opportunities tab. |
| Map | `archipelago.ts`, `map-generation-pipeline.ts`, `random-season.ts`, `navigation.ts`, `coasts.ts`, `geo.ts` | Random archipelago seasons, water pathfinding. |
| Feature modules | `server/src/features/` | The 600-feature work: one module per feature, switched per module. See `docs/FEATURES.md`. |
| Client | `server/public/app.js` + layers | Canvas map and side panel; `features/api.js` hooks for feature scripts. |
| Simulator | `sim/` | Python bot sim, ML player simulator (`sim/ml`), TS playtest scripts. |

## State model
All state is rebuilt by replaying the event log: accepted commands and `tick` rows in order. Anything that changes
state must therefore happen inside a command or `advance()` and be deterministic. Feature modules follow the same rule;
their on/off set is itself a logged command (`setFeatures`).

## Extension points
- Server: `FeatureModule` (`apply`, `advance`, `cards`, `view`, `world`, `adjust` hooks for fuel, travelHours, portFee,
  tradeTax, capacity and upkeep).
- Client: `ManifestHooks.on("state" | "draw" | "render")`, per-category scripts in `server/public/features/`.
- Switches: `config/features/<category>.json`, `FEATURES` env for testing.
