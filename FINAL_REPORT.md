# Final report: 600 new features

All 600 ideas from `IDEAS_600.md` are covered across eleven categories: **394 feature modules** in the game, plus ready-to-use documents in
`docs/community/` (and tools in `tools/`) for the ideas that happen outside the game. Everything is merged on `feature/600-features`.
Each category has a report in `docs/features/reports/<category>.md`, a switch file in `config/features/<category>.json` and a test file
`server/test/features-<category>.test.ts` (every module tested, every idea checked, plus a replay test with the whole category switched on).

## Test run (merged branch, 2026-11-10)
`549 tests, 545 pass` (including `features-all.test.ts`: all 394 modules on together, replayed exactly). The 4 failures are `economy-insights`, `expansion`, `pirates-restart` and `shipyard`, which fail only because the
`ws` package could not be installed in the cloud session (`Cannot find package 'ws'`). `server.test.ts` and `navigation-server.test.ts`
were not run for the same reason. **Run `npm test` locally before deploying.**

## Modules per category

| Category | Modules | On | Off (economy) |
| --- | --- | --- | --- |
| ships | 23 | 12 | 11 |
| ports | 34 | 20 | 14 |
| world | 33 | 15 | 18 |
| economy | 59 | 4 | 55 |
| contracts | 55 | 27 | 28 |
| progression | 44 | 28 | 16 |
| ui | 39 | 33 | 6 |
| art | 16 | 16 | 0 |
| platform | 31 | 26 | 5 |
| community | 13 | 11 | 2 |
| social | 47 | 25 | 22 |
| **total** | **394** | **217** | **177** |

## Shared core files changed
- `server/src/main.ts`: one admin-only route, `/api/admin/features` (platform category), behind the existing admin token.
- No other changes to `engine.ts`, `main.ts`, `app.js`, `registry.ts` or `types.ts`.

## For Dave: economy modules switched off, awaiting approval
These change prices, money, fuel, tax, fees, travel time or upkeep (or the assignment flagged them as economy). Each one ships `false`
in its category's switch file. To approve one, set it to `true` in `config/features/<category>.json` and restart; to try them all on a test
server, run with `FEATURES=all`. The category reports explain each module in more detail.

### ships (11)

| Module | What | Ideas |
| --- | --- | --- |
| `ships.wear` | Hull wear and repairs | 34, 35, 229 |
| `ships.crew-effects` | Crew wages and seamanship | 36, 37, 38 |
| `ships.fittings-effects` | Fitting performance | 27, 28, 237 |
| `ships.variants-effects` | Specialist ship performance | 21, 24, 25, 238 |
| `ships.insurance` | Ship insurance | 228 |
| `ships.towing` | Towing | 230 |
| `ships.throttle` | Throttle | 221 |
| `ships.slipstream` | Convoy slipstream | 222 |
| `ships.overloading` | Overloading | 223 |
| `ships.draft-effects` | Waiting for the tide | 225 |
| `ships.age` | Ship age, retirement and refits | 235, 236 |

### ports (14)

| Module | What | Ideas |
| --- | --- | --- |
| `ports.docks` | Docks and the harbour master | 41, 43, 268 |
| `ports.harbour-effects` | Crane and pilot time savings | 42, 55 |
| `ports.ownership` | Port charters | 44, 45 |
| `ports.fuel-stations` | Fuel stations | 46 |
| `ports.shipyards` | Shipyards | 47 |
| `ports.customs` | Customs offices | 49 |
| `ports.project-effects` | Project effects | 56, 57 |
| `ports.festival-effects` | Festival demand | 53 |
| `ports.strikes` | Strikes and the dockworkers' union | 54, 269 |
| `ports.airfreight-effects` | Air cargo flights | 58 |
| `ports.warehouses` | Warehouse districts | 59 |
| `ports.fish-market` | Fish market | 266 |
| `ports.rumours` | Rumour board | 60 |
| `ports.bank-effects` | Bank deposits | 263 |

### world (18)

| Module | What | Ideas |
| --- | --- | --- |
| `world.storm-closures` | Storm lane closures | 96 |
| `world.currents-effects` | Ocean currents: sailing time | 98 |
| `world.icebergs` | Icebergs in the far north | 100 |
| `world.reefs` | Reef hazards | 246 |
| `world.highways` | Shipping-lane highways | 245 |
| `world.market-events` | Market events | 109, 322, 323, 324, 335 |
| `world.mega-orders` | Royal wedding and holiday gifts | 330, 337 |
| `world.conflicts` | Wars and the pirate king | 326, 331 |
| `world.kraken` | The kraken | 339 |
| `world.coop-goals` | Shared goals | 340 |
| `world.sea-charts` | Sea charts for sale | 243 |
| `world.beacons` | Beacon lights | 244 |
| `world.radar-ping` | Radar ping | 250 |
| `world.discovery-bonus` | First-discovery bounty | 258 |
| `world.ferries` | Archipelago ferries | 259 |
| `world.licences` | Fast-travel licences | 260 |
| `world.disaster-effects` | Volcanoes and tsunamis: delays | 108, 327 |
| `world.quarantine-effects` | Quarantine: inspection delay | 325 |

### economy (55)

| Module | What | Ideas |
| --- | --- | --- |
| `economy.demand-curves` | Supply and demand | 1 |
| `economy.saturation` | Market saturation | 7 |
| `economy.rumours` | Port rumours | 205 |
| `economy.crashes` | Market crashes | 220 |
| `economy.price-caps` | Emergency price caps | 210 |
| `economy.bulk-discounts` | Bulk buying desk | 6 |
| `economy.black-market` | Black market | 9 |
| `economy.futures` | Futures contracts | 3 |
| `economy.warehouses` | Warehouses | 4 |
| `economy.speculation` | Commodity exchange | 204 |
| `economy.tariffs` | Island tariffs | 8 |
| `economy.embargoes` | Trade embargoes | 213 |
| `economy.currencies` | Island currencies | 206 |
| `economy.tolls` | Toll gates | 214 |
| `economy.freight-rates` | Freight rates | 201 |
| `economy.backhaul` | Backhaul bonus | 202 |
| `economy.empty-legs` | Empty legs | 203 |
| `economy.subsidies` | New-route subsidies | 209 |
| `economy.cartels` | Cartels | 211 |
| `economy.antitrust` | Antitrust | 212 |
| `economy.wealth-tax` | Wealth tax | 208 |
| `economy.money-sinks` | Prestige and harbour dues | 207 |
| `economy.loans` | Port bank | 19 |
| `economy.safety-net` | Bankruptcy restart | 20 |
| `economy.harvests` | Grain harvests | 17, 288 |
| `economy.depletion` | Mines and wells | 18 |
| `economy.oil-output` | Oil output | 215 |
| `economy.quality-grades` | Cargo grades | 216 |
| `economy.branded-goods` | Company brands | 217 |
| `economy.manufacturing` | Manufacturing contracts | 218 |
| `economy.recycling` | Recycling | 219 |
| `economy.spoilage` | Spoilage | 5 |
| `economy.chain-plastics` | Oil to fuel to plastics | 12 |
| `economy.chain-steel` | Ore to steel to containers | 13 |
| `economy.chain-furniture` | Timber to planks to furniture | 14 |
| `economy.chain-canned-fish` | Fish to canned fish | 15 |
| `economy.cargo-hazmat` | Hazardous chemicals | 281 |
| `economy.cargo-livestock` | Livestock | 282 |
| `economy.cargo-produce` | Fresh produce | 283 |
| `economy.cargo-medicine` | Medicine | 284 |
| `economy.cargo-cars` | Cars | 286 |
| `economy.cargo-coal` | Coal | 287 |
| `economy.cargo-spices` | Spices | 289 |
| `economy.cargo-timber` | Timber | 290 |
| `economy.cargo-cement` | Cement | 291 |
| `economy.cargo-textiles` | Textiles | 292 |
| `economy.cargo-fish` | Fresh fish | 293 |
| `economy.cargo-wine` | Wine | 294 |
| `economy.cargo-artifacts` | Artifacts | 295 |
| `economy.cargo-mail` | Mail | 296 |
| `economy.cargo-gold` | Gold bullion | 297 |
| `economy.cargo-weapons` | Licensed weapons | 298 |
| `economy.cargo-mystery` | Mystery crates | 299 |
| `economy.cargo-glassware` | Fragile glassware | 300 |
| `economy.cargo-pearls` | Island pearls | 16 |

### contracts (28)

| Module | What | Ideas |
| --- | --- | --- |
| `contracts.timed` | Timed delivery contracts | 61 |
| `contracts.rush` | Rush contracts | 62 |
| `contracts.milk-run` | Milk runs | 63 |
| `contracts.community` | Community contracts | 64 |
| `contracts.relief` | Emergency relief | 65 |
| `contracts.government` | Government contracts | 66 |
| `contracts.exclusive` | Exclusive contracts | 67 |
| `contracts.story` | Story contracts | 68 |
| `contracts.board` | Daily contract board | 69 |
| `contracts.late-penalty` | Late-delivery penalties | 70 |
| `contracts.passengers` | Ferry and passenger contracts | 73 |
| `contracts.auctions` | Contract auctions | 75 |
| `contracts.escort` | Escort missions | 71 |
| `contracts.smuggling` | Smuggling contracts | 72 |
| `contracts.salvage` | Wreck salvage contracts | 74 |
| `contracts.pirate-zones` | Shifting pirate zones | 76 |
| `contracts.escort-hire` | Hireable escort ships | 80 |
| `contracts.deck-guns` | Deck-gun upgrades | 82 |
| `contracts.ambush` | Ambushes | 77 |
| `contracts.ransom` | Ransom or fight | 78 |
| `contracts.cargo-insurance` | Cargo insurance | 79 |
| `contracts.bounties` | Bounties on pirates | 84 |
| `contracts.news-ledger` | Piracy news ledger | 93 |
| `contracts.bribes` | Bribing officers | 88 |
| `contracts.coast-guard-effects` | Coast-guard fuel top-up | 92 |
| `contracts.rival-companies` | Rival NPC shipping companies | 301 |
| `contracts.mechanics-effects` | Mechanics' service deals | 318 |
| `contracts.travelling-merchants` | Travelling merchants | 319 |

### progression (16)

| Module | What | Ideas |
| --- | --- | --- |
| `progression.sandbox-funds` | Sandbox funds | 396, 409 |
| `progression.achievement-rewards` | Achievement rewards | 134 |
| `progression.title-perks` | Title perks | 135 |
| `progression.seasonal-ladder` | Seasonal ladder | 141 |
| `progression.blitz` | Speed-trading blitz | 405 |
| `progression.tech-bonuses` | Tech bonuses | 131 |
| `progression.licence-fines` | Licence fines | 132 |
| `progression.skill-points` | Skill points | 387 |
| `progression.cargo-mastery` | Cargo mastery | 388 |
| `progression.route-mastery` | Route mastery | 389 |
| `progression.veteran-perks` | Veteran perks | 400 |
| `progression.heirlooms` | Heirlooms | 382 |
| `progression.legacy` | Captain's legacy | 381 |
| `progression.prestige` | Prestige | 140 |
| `progression.daily-login` | Daily reward | 133 |
| `progression.offline-progress` | Offline progress | 145 |

### ui (6)

| Module | What | Ideas |
| --- | --- | --- |
| `ui.best-trade` | Best trade right now | 425 |
| `ui.saved-routes` | Saved routes | 148 |
| `ui.quick-sell` | Quick-sell | 423 |
| `ui.notifications` | Notifications | 151 |
| `ui.starter-bonus-effects` | Starter bonus cash | 483 |
| `ui.mobile` | Mobile-friendly controls | 153 |

### art (0)

None.

### platform (5)

| Module | What | Ideas |
| --- | --- | --- |
| `platform.newbie-zones` | Newbie waters | 567 |
| `platform.catch-up` | Catch-up help | 569 |
| `platform.wealth-limits` | Wealth limits | 570 |
| `platform.exotic-craft-effects` | Submarine and airship performance | 591, 592 |
| `platform.player-contracts` | Player contracts | 600 |

### community (2)

| Module | What | Ideas |
| --- | --- | --- |
| `community.shop` | Cosmetic shop | 173, 179, 180, 501, 502, 503, 504, 505, 506, 507, 508 |
| `community.naming` | Paid naming | 175 |

### social (22)

| Module | What | Ideas |
| --- | --- | --- |
| `social.treasury` | Guild treasury | 113, 344 |
| `social.roles` | Guild roles and permissions | 114 |
| `social.bank` | Guild bank | 343 |
| `social.shares` | Guild shares, takeovers and mergers | 345, 346, 347 |
| `social.guild-contracts` | Guild contracts | 348 |
| `social.warehouse` | Guild warehouse | 354 |
| `social.wars` | Guild wars | 357 |
| `social.alliances` | Alliances | 124 |
| `social.rivalries` | Rivalries | 125 |
| `social.regional-chat` | Regional chat | 119 |
| `social.signals` | Signals and emotes | 120 |
| `social.spectator` | Spectator mode | 130 |
| `social.news-feed` | Guild news feed | 351 |
| `social.hire-captains` | Hire player captains | 128 |
| `social.tax-votes` | Port tax votes | 362 |
| `social.piracy-laws` | Piracy laws | 365 |
| `social.treaties` | Trade treaties | 366 |
| `social.fines` | Fines | 369 |
| `social.lighthouse-taxes` | Lighthouse taxes | 372 |
| `social.naming-auctions` | Auctioned naming rights | 374 |
| `social.community-fund` | Community fund | 376 |
| `social.megaproject-effects` | Megaproject effects | 126 |

## Other things to decide
- **Player-to-player money moves that ship ON** (no money is created; prices are agreed between players within bands): ships resale market,
  social trade window, ship auctions and shared fleets. Each can be switched off in its category file if Dave prefers.
- **Social modules flagged economy by the assignment that move no money** (regional chat, signals, spectator mode, guild news feed, alliances,
  rivalries, roles, mergers): safe to switch on without balance review.
- **Community codes:** `config/content/community/codes.json` ships empty. Make codes with `node tools/community/make-codes.mjs` before selling
  supporter packs, the soundtrack or sending tester rewards. Links in `config/links.json` are empty placeholders.
- **Placeholder art:** cosmetics and several overlays are drawn in code until real sprites exist.
