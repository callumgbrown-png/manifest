# Ships category report (ideas 21-40, 221-240)

All 40 ideas are built as 23 modules in `server/src/features/ships/`, tested in `server/test/features-ships.test.ts`
(18 tests, including a full replay of every module together). No shared core files were edited.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| ships.identity | 32, 33 | Name and paint ships |
| ships.crew | 36, 37, 38, 232 | Crew size, morale, captains with traits, mutiny |
| ships.incidents | 224, 231, 233 | Cargo balance, fires, stowaways |
| ships.logbook | 239, 240 | Journey log and star ratings |
| ships.radar | 31 | Pirate contacts reported early |
| ships.wrecks | 234 | Ghost wrecks where ships left the game |
| ships.fittings | 27-30, 227 | Upgrade slots (2/3/4 by hull); yard time, not money; hold +15%, armour, radar range |
| ships.variants | 22-25, 238 | Refit to bulk carrier (+10% hold), refrigerated (no grain fires), feeder, heavy-lift, sail, tanker |
| ships.tugs | 26 | 3 tugs per port per day; big ships without one may scrape the quay |
| ships.captains | 39 | NPC captain runs a two-port route through the normal voyage queue |
| ships.resale | 40 | Second-hand market between players, 25-300% of new price |
| ships.draft | 225, 226 | Port depths, which ships are too deep where, dredging by lending ships for a day |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| ships.wear | 34, 35, 229 | Repair costs; worn hulls slower and thirstier; breakdowns delay arrival |
| ships.crew-effects | 36-38 | Crew wages in upkeep; crew speed; fuel-saver captains |
| ships.fittings-effects | 27, 28, 237 | Engine -10% time, tanks -7% fuel, hybrid -25% fuel/+5% time; servicing in upkeep |
| ships.variants-effects | 21, 24, 25, 238 | Feeder speed on short hops, heavy-lift port fees, sail fuel/speed, tanker top-up capacity |
| ships.insurance | 228 | Premium in upkeep; pays repairs and lost cargo |
| ships.towing | 230 | Rewards paid between players for clearing breakdowns |
| ships.throttle | 221 | Eco/normal/full: time vs fuel |
| ships.slipstream | 222 | -12% fuel for convoy partners |
| ships.overloading | 223 | +20% hold; risk of jettisoning the cargo |
| ships.draft-effects | 225 | Too-deep ships wait 6 h for the tide |
| ships.age | 235, 236 | Old hulls burn more fuel; retirement value; paid refits |

## Decisions
- **Assignment said ON, but money/time changes:** draft limits (225) need a travel-time effect, so the effect is split into
  `ships.draft-effects` (off); the content part stays on. Fittings and variants follow the same split.
- **Resale (40) is on** although money moves: it only moves between two players at a price they agree, inside a 25-300%
  band, and creates no money. Easy to switch off in `config/features/ships.json` if Dave disagrees.
- **Tankers** can't be made fuel-only without an engine veto hook, so a tanker gets its extra room only to top up a
  fuel cargo already aboard.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
