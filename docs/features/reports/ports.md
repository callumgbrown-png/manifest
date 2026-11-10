# Ports category report (ideas 41-60, 261-280)

All 40 ideas are built as 34 modules in `server/src/features/ports/`, tested in `server/test/features-ports.test.ts`
(33 tests, including a full replay of every module together). Map drawing (lighthouse rings, skylines, stall pennants,
festival stars, strike bars, the cruise liner) and a stacking-puzzle picture are in `server/public/features/ports.js`.
Port names, festival names, tavern hands, banners and research topics are in `config/content/ports/ports.json`.
No shared core files were edited.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| ports.cranes | 42, 55 | Crane levels built from donated machinery (no money); free harbour pilots, 3 per port per day |
| ports.repair-yards | 48 | Free hull survey and a 12 h overhaul (yard time, no money) at repair-yard ports |
| ports.customs-queue | 270 | Loaded ships arriving at customs ports queue to declare; prompt declaring earns standing |
| ports.projects | 50, 56, 57, 267, 274 | Lighthouses, shortcut channels, rail links and land reclamation built from donated cargo; daily lighthouse-keeper fuel quest; lit lighthouses widen sight on the map |
| ports.reputation | 51, 52 | Standing per company per port (Stranger/Known/Trusted/Honoured); port specialisations (grain hub, oil hub...) |
| ports.festivals | 53 | Daily festival calendar; arriving with the featured good earns standing; join the parade |
| ports.airfreight | 58 | Airfields and a daily air-courier parcel delivered by sea for standing |
| ports.tavern | 261 | Free daily gossip; hire one hand per ship with a small non-economic perk |
| ports.stalls | 262 | Up to three market stalls with banners; a point of standing per stall per day |
| ports.bank | 263 | Statements (cash, net worth over the last week) and a savings goal |
| ports.insurance-office | 264 | Daily risk ratings for ports you can reach |
| ports.chandlery | 265 | Free ship's stores at chandlery ports; well-found ships earn standing on arrival |
| ports.weather | 271 | Forecasts for today and tomorrow (three days with Tide tables) |
| ports.minigames | 272, 273 | Cargo-yard stacking and crane-operator puzzles, a new one daily, three tries, museum records |
| ports.shipbreaking | 275 | Retire a ship at a breaker's yard (normal scrap price) with a museum plaque and standing |
| ports.cruise | 276 | A liner calls at one terminal a day; welcome it, or run harbour tours in an empty ship |
| ports.naval-base | 277 | Patrol bulletin of pirate ships near the base; daily report-in for standing |
| ports.research | 278 | Donate cargo for research points; unlock Tide tables, Signal lamps, Market survey |
| ports.museum | 279 | Milestones from every port module plus minigame records |
| ports.skyline | 280 | Cargo landed grows a port's skyline (level 0-5), slowly fading |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| ports.docks | 41, 43, 268 | Paid dock tiers (1,500 x tier); crowded ports add up to 12 h of queue; paid harbour-master priority berth (60) |
| ports.harbour-effects | 42, 55 | Each crane level saves 1 h leaving that port; a pilot saves 1 h arriving |
| ports.ownership | 44, 45 | Season charter of a port (4,000, needs Trusted standing); owner sets visitors' dock fee 50-150% and keeps half |
| ports.fuel-stations | 46 | Fuel costs 85-120% depending on port and day |
| ports.shipyards | 47 | Order a hull at a shipyard for 90% of list price; launches after 48 h |
| ports.customs | 49 | +2% duty on trade at customs ports |
| ports.project-effects | 56, 57 | Finished channels cut their lane's time by 15%; finished rail links add supply |
| ports.festival-effects | 53 | Festival crowds eat the featured good's stock (prices rise for the day) |
| ports.strikes | 54, 269 | Random strikes add 6 h to arrivals; end one by paying 300 wages; union members (5/ship/day) are exempt |
| ports.airfreight-effects | 58 | Fly up to 5 t of machinery between your ships at two airfields in 6 h, 20 per tonne |
| ports.warehouses | 59 | Store cargo ashore; daily rent per tonne by district (quayside, old town, outskirts) |
| ports.fish-market | 266 | Empty ships at fishing ports fish for 6 h and sell the catch |
| ports.rumours | 60 | Paid tip (50) naming the best-paying reachable port for a good |
| ports.bank-effects | 263 | Deposits up to 50,000 earning 0.2% a day |

## Decisions
- **Assignment said ON, but money/time changes:** cranes (42), pilots (55), festivals (53), airfreight (58), the bank (263)
  and channels/rail links (56, 57) are split like ships: a content module ON and an `-effects` economy module OFF.
- **Harbour master (268)** is economy per the assignment, so it lives in `ports.docks` (priority berths). The
  dockworkers' union (269) lives in `ports.strikes`.
- **Repair yards (48)** cannot restore hull condition yet: hull condition belongs to `ships.wear` (on the ships branch).
  The yard calls an optional `repairTo(ship, condition)` on `ships.wear` if it exists. When the branches are merged,
  add that three-line method to `ships.wear` (set the condition, add a logbook line) to make overhauls repair hulls.
- **Shipbreaking (275) is on** although money moves: it uses the game's normal `scrapShip` command, so the price is
  the existing scrap price; nothing new is paid.
- **Tavern gossip (261) and the insurance office (264)** only show information already in the game (stocks, pirate
  positions), so they are on; the paid, reliable tip is the rumour board (60), which is off.
- The old WIP `ports.infrastructure` module was split into `ports.docks` (economy) and `ports.cranes` (content).
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
