# World category report (ideas 96-110, 241-260, 321-340)

All 55 ideas are built as 33 modules in `server/src/features/world/`, tested in `server/test/features-world.test.ts`
(31 tests, including a full replay of every module together). Map drawing, the news strip, layer toggles, the ruler,
storm-free routes and route codes are in `server/public/features/world.js`. No shared core files were edited.

Weather, events and hazards are pure functions of the map and the tick (`shared.ts` schedules), so forecasts, effects
and replays always agree. Random rolls (monster sightings, wreck finds, kraken damage) use `e.features.random()`.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| world.chart | 247, 249, 257 | Six named sea regions, narrow straits found from lane crowding, owners of ships at sea |
| world.map-tools | 252, 253, 255, 256 | Client: layer toggles, alt-click ruler, storm-free route between two ports, copy/load route codes |
| world.weather | 96, 97, 99, 101, 102, 103, 254, 333, 334 | Storms, fog, hurricanes forecast 24 h ahead, whirlpools, seasons, day/night, tides, eclipses; per-ship storm warnings before docking |
| world.currents | 98 | Currents drawn on the chart |
| world.news | 110 | News ticker fed by every switched-on world module |
| world.sightings | 104, 336 | Rare sea-serpent sightings; Halloween ghost fleet with lanterns to collect |
| world.exploration | 105, 106, 107 | Dive on 6 wrecks for relics, treasure maps to a dig site with a trophy, 4 hidden islands revealed when sighted |
| world.disasters | 108, 327, 332 | Volcano that erupts and grows, tsunamis by region, a new island named by the first ship alongside |
| world.waypoints | 241 | Up to 8 waypoints per company (shift-click) |
| world.fog-of-war | 242 | 24 x 16 chart cells hidden until your ships have been near |
| world.buoys | 248 | 3 labelled buoys per company, 72 h each, labels from a fixed list |
| world.rescue | 251, 328 | Distress beacons answered by other captains; stricken crews to pick up. Medals |
| world.regatta | 321 | Weekly race between two ports; gold/silver/bronze trophies |
| world.festivals | 322, 329, 338 | Harvest festival ribbons, trade-fair best in show, weekly and monthly anniversaries |
| world.quarantine | 325 | A port under quarantine; ships that dock there fly the yellow flag for 24 h |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| world.storm-closures | 96 | Voyages through a storm wait it out: up to +12 h |
| world.currents-effects | 98 | With the current -10% time, against +10% |
| world.icebergs | 100 | Winter voyages through the far north +2 h |
| world.reefs | 246 | +1 h per reef passed |
| world.highways | 245 | Six busiest lanes 15% quicker |
| world.market-events | 109, 322, 323, 324, 335 | Oil shortage, oil boom, fuel strike and harvest change port stocks (prices follow); fuel buy tax +0.15/+0.10; harvest grain sells tax-free in hungry ports; sale week has no buy tax |
| world.mega-orders | 330, 337 | Royal wedding buys 300 t at 1.5x market; holiday gifts (up to 20 t) at 1.3x plus 150 |
| world.conflicts | 326, 331 | Pirate king toll +150 on voyages crossing his region; war: 1.5x port fees and +3 h between warring regions |
| world.kraken | 339 | Ships passing +4 h; fighters share a 3000 purse by damage |
| world.coop-goals | 340 | Weekly shared delivery goal (500 t); contributions bought at market value; bonus 200 + 2/t when met |
| world.sea-charts | 243 | 1500 per region chart; lifts fog and marks islands there |
| world.beacons | 244 | 3000 to build; night arrivals at that port 1 h quicker |
| world.radar-ping | 250 | 100 per ping; lists vessels within 150 miles for 6 h |
| world.discovery-bonus | 258 | 1500 to the first company to sight each uncharted island |
| world.ferries | 259 | 17 short island hops 25% quicker, +40 port fee |
| world.licences | 260 | 2500 for a week on one lane, 20% quicker; 3 at most |
| world.disaster-effects | 108, 327 | Eruption +2 h near the volcano; tsunami +3 h leaving the swept region |
| world.quarantine-effects | 325 | +4 h inspection when arriving at a quarantined port |

## Decisions
- **Assignment said ON, but time changes:** storms (96), currents (98), volcano/tsunami (108, 327) and quarantine (325)
  are split: the visible part is on, the travel-time part is a separate `-effects`/closures module that ships off.
- **Harvest festival (322)** is on as ribbons; its price effect lives in `world.market-events` (off).
- **"Moves prices"** is done by changing port stock (the engine's price follows stock) and trade tax through the
  `tradeTax` hook, since there is no price hook. Tax can't go below 0, so "cheaper" events zero a tax rather than pay a bonus.
- **Player text** is limited to the new island's name (24 characters, letters/digits, blocklist in
  `config/content/world/world.json`). Buoys use a fixed label list.
- **Halloween** is the last three days of autumn; **anniversaries** count from the first hour a company is seen.
- The client strip, ruler and drawing could not be tried in a browser here (the `ws` package is missing in the cloud);
  worth a quick look locally. The four `ws`-dependent test files fail for that reason only.
