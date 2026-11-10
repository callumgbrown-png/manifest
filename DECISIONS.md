# Decisions

Choices made without asking, per the 600-feature prompt. Newest last.

1. **Base code.** GitHub `main` was older than the game. The newest source was the local Codex workspace
   `Documents/Codex/2026-11-08/gene/work/manifest-gameplay` (all six expansions, newer than the debug.2026-11-08 build).
   It is committed as the baseline on `feature/600-features`. Browser e2e tests and the `sim/ml` subpackages
   (agents, bridge, personas, report, tests, config) could not be copied (folders too deeply nested) and are missing.
2. **One mechanism for 600 features.** Each feature is a module in `server/src/features/<category>/`, switched by
   `config/features/<category>.json` and recorded in the event log (`setFeatures`). See `docs/FEATURES.md`.
3. **Economy switch-off.** Every module that changes prices, money, fuel, tax, fees or travel time ships switched off.
4. **Engine hooks.** Six hook points (fuel, travelHours, portFee, tradeTax, capacity, upkeep) are the only engine edits;
   they return the unchanged value when no module is on, so the existing 235 tests are unaffected.
5. **Outside-the-game items** (Reddit posts, press kit, contests and similar) are delivered as ready-to-use documents
   in `docs/community/`, not code.
