# Manifest: 600 feature backlog

Phase 0 checklist from the 600-feature prompt. Status: `todo`, `in build (extend)`, `done`, `flagged`, `blocked`.

Type says how each feature ships under your rules:

- **economy flag, default OFF**: changes prices, money, fuel, tax or travel time, so it is built switched off until you approve it
- **default ON**: content, UI, art, audio, social or tools that leave the economy rules alone
- **outside the game**: marketing or business work (posts, contests, press kit), not code

"In build" was checked against the compiled server in Manifest-debug.2026-11-08 (source commit be0a191, which is not on GitHub).

## Totals

| | Count |
|---|---|
| economy flag, default OFF | 171 |
| default ON | 383 |
| outside the game (marketing/business task) | 46 |
| already in build, to extend | 22 |
| total | 600 |


## Economy and trading

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 1 | Supply-and-demand price curves at every port | economy flag, default OFF | in build (extend) | price slides with stock (core rule) |
| 2 | Price history charts per port | default ON | todo |  |
| 3 | Futures contracts that lock a price for a later delivery | economy flag, default OFF | in build (extend) | machinery futures |
| 4 | Warehouses where players store goods and wait for better prices | economy flag, default OFF | todo |  |
| 5 | Spoilage on perishables like wheat and fish | economy flag, default OFF | in build (extend) | spoilage rules in maritime module |
| 6 | Bulk-volume discounts | economy flag, default OFF | todo |  |
| 7 | Market saturation, where heavy selling drops the price and it slowly recovers | economy flag, default OFF | todo |  |
| 8 | Tariffs between island groups | economy flag, default OFF | in build (extend) | tariffs in maritime module |
| 9 | Black-market ports with odd prices | economy flag, default OFF | todo |  |
| 10 | A commodity price index in a news ticker | default ON | todo |  |
| 11 | Wheat → flour → bread chain | default ON | todo |  |
| 12 | Oil → fuel → plastics chain | economy flag, default OFF | todo |  |
| 13 | Ore → steel → containers chain | economy flag, default OFF | todo |  |
| 14 | Timber → planks → furniture chain | economy flag, default OFF | todo |  |
| 15 | Fish → canned fish chain | economy flag, default OFF | todo |  |
| 16 | Luxury goods that only appear on the isolated islands | economy flag, default OFF | todo |  |
| 17 | Seasonal harvest cycles | economy flag, default OFF | todo |  |
| 18 | Mines and wells that deplete and need investment | economy flag, default OFF | todo |  |
| 19 | Port-bank loans with interest | economy flag, default OFF | todo |  |
| 20 | A bankruptcy restart with a small safety net | economy flag, default OFF | in build (extend) | emergency credit |

## Ships and fleet

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 21 | Tankers for liquids only | economy flag, default OFF | todo |  |
| 22 | Bulk carriers | default ON | in build (extend) | bulker class |
| 23 | Refrigerated ships | default ON | todo |  |
| 24 | Fast feeder boats for short hops | default ON | in build (extend) | coaster class |
| 25 | Heavy-lift ships | default ON | todo |  |
| 26 | Tugs that help big ships dock | default ON | todo |  |
| 27 | Engine upgrades | default ON | todo |  |
| 28 | Fuel tank upgrades | default ON | todo |  |
| 29 | Cargo hold upgrades, shown through your load-state sprites | default ON | todo |  |
| 30 | Hull armour | default ON | todo |  |
| 31 | Radar to spot pirates early | default ON | todo |  |
| 32 | Naming your ships | default ON | todo |  |
| 33 | Custom paint colours | default ON | todo |  |
| 34 | Hull wear that needs repairs | default ON | todo |  |
| 35 | Dry docks for deep repairs | default ON | todo |  |
| 36 | Crew size that affects speed and efficiency | default ON | todo |  |
| 37 | Crew morale | default ON | todo |  |
| 38 | Captains with traits (fuel saver, lucky, brave) | default ON | todo |  |
| 39 | NPC captains who run routes for you | default ON | todo |  |
| 40 | A ship resale market between players | default ON | todo |  |

## Ports and infrastructure

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 41 | Port upgrade tiers that add more docks | economy flag, default OFF | in build (extend) | harbor project lowers docking fee |
| 42 | Faster cranes as an upgrade | default ON | todo |  |
| 43 | Dock queues when a port is crowded | economy flag, default OFF | todo |  |
| 44 | Owner-set dock fees | economy flag, default OFF | todo |  |
| 45 | Player-owned ports | economy flag, default OFF | todo |  |
| 46 | Fuel stations with variable prices | economy flag, default OFF | todo |  |
| 47 | Shipyards that build ships | economy flag, default OFF | todo |  |
| 48 | Repair yards | default ON | todo |  |
| 49 | Customs offices | economy flag, default OFF | todo |  |
| 50 | Lighthouses that extend visibility | default ON | todo |  |
| 51 | Per-player reputation with each port | default ON | todo |  |
| 52 | Port specialisations (grain hub, oil hub) | default ON | todo |  |
| 53 | Port festivals that boost demand | default ON | todo |  |
| 54 | Port strikes that you resolve with wages or by waiting | economy flag, default OFF | todo |  |
| 55 | Harbour pilot services | default ON | todo |  |
| 56 | Player-built shortcut channels | default ON | todo |  |
| 57 | Inland rail links that boost a port’s supply | default ON | todo |  |
| 58 | Airfreight for premium goods | default ON | todo |  |
| 59 | Warehouse rent districts | economy flag, default OFF | todo |  |
| 60 | A rumour board at each port | economy flag, default OFF | todo |  |

## Contracts and missions

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 61 | Timed delivery contracts | economy flag, default OFF | todo |  |
| 62 | Rush contracts with premium pay | economy flag, default OFF | todo |  |
| 63 | Multi-stop milk runs | economy flag, default OFF | todo |  |
| 64 | Community contracts that many players fill together | economy flag, default OFF | todo |  |
| 65 | Emergency relief deliveries | economy flag, default OFF | todo |  |
| 66 | Government contracts that need a licence | economy flag, default OFF | todo |  |
| 67 | Exclusive contracts for high-reputation players | economy flag, default OFF | todo |  |
| 68 | Story contract chains | economy flag, default OFF | todo |  |
| 69 | A daily contract board | economy flag, default OFF | todo |  |
| 70 | Late-delivery penalties | economy flag, default OFF | todo |  |
| 71 | Escort missions | economy flag, default OFF | todo |  |
| 72 | Smuggling contracts | economy flag, default OFF | todo |  |
| 73 | Ferry and passenger contracts | economy flag, default OFF | todo |  |
| 74 | Wreck salvage contracts | economy flag, default OFF | todo |  |
| 75 | Contract auctions, where the lowest bidder wins | economy flag, default OFF | todo |  |

## Pirates and police

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 76 | Pirate zones that shift over time | economy flag, default OFF | todo |  |
| 77 | Ambush chance based on route and cargo value | economy flag, default OFF | in build (extend) | pirate raids on ships underway |
| 78 | A pay-the-ransom-or-fight choice | economy flag, default OFF | todo |  |
| 79 | Cargo insurance | economy flag, default OFF | in build (extend) | cargo insurance |
| 80 | Hireable escort ships | economy flag, default OFF | in build (extend) | naval escort |
| 81 | Player convoys with shared protection | default ON | in build (extend) | convoys (book/commission) |
| 82 | Deck-gun upgrades | economy flag, default OFF | todo |  |
| 83 | An opt-in player-pirate role | default ON | todo |  |
| 84 | Bounties on pirates | economy flag, default OFF | in build (extend) | privateer bounties |
| 85 | A wanted level | default ON | in build (extend) | wanted level |
| 86 | Police patrol routes | default ON | in build (extend) | police boats |
| 87 | Contraband inspections | default ON | todo |  |
| 88 | Bribing officers | economy flag, default OFF | todo |  |
| 89 | Pirate hideout islands | default ON | todo |  |
| 90 | Pirate boss events | default ON | todo |  |
| 91 | Fake distress signals | default ON | todo |  |
| 92 | Coast-guard rescue for stranded ships | default ON | todo |  |
| 93 | A piracy news ledger | economy flag, default OFF | todo |  |
| 94 | A pardon path for reformed pirates | default ON | todo |  |
| 95 | Naval blockade events | default ON | todo |  |

## World, weather and events

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 96 | Storms that close sea lanes | default ON | todo |  |
| 97 | Fog that reduces visibility | default ON | todo |  |
| 98 | Currents that speed or slow ships | default ON | todo |  |
| 99 | Seasons | default ON | todo |  |
| 100 | Icebergs in the far north | economy flag, default OFF | todo |  |
| 101 | Whirlpools | default ON | todo |  |
| 102 | A day-night cycle | default ON | todo |  |
| 103 | Hurricane warnings ahead of time | default ON | todo |  |
| 104 | Rare sea-monster sightings as an easter egg | default ON | todo |  |
| 105 | Shipwreck sites to explore | default ON | todo |  |
| 106 | Treasure maps | default ON | todo |  |
| 107 | Uncharted islands found by exploring | default ON | todo |  |
| 108 | Volcanic eruptions that change an island | default ON | todo |  |
| 109 | World events that move prices (oil shortage, harvest festival) | economy flag, default OFF | todo |  |
| 110 | A global news ticker | default ON | todo |  |

## Social and multiplayer

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 111 | Companies and guilds | default ON | in build (extend) | guild freight (check scope) |
| 112 | Shared fleets | default ON | todo |  |
| 113 | A shared company treasury | economy flag, default OFF | todo |  |
| 114 | Company roles and permissions | economy flag, default OFF | todo |  |
| 115 | Company-owned ports | default ON | todo |  |
| 116 | Company-versus-company contests | default ON | todo |  |
| 117 | A direct player trade window | default ON | todo |  |
| 118 | An auction house | default ON | todo |  |
| 119 | Regional chat channels | economy flag, default OFF | todo |  |
| 120 | Flag signals and emotes at sea | economy flag, default OFF | todo |  |
| 121 | Friend lists | default ON | todo |  |
| 122 | Visiting another player’s fleet | default ON | todo |  |
| 123 | A mentor system for new players | default ON | todo |  |
| 124 | Alliances between companies | economy flag, default OFF | todo |  |
| 125 | Rivalries with shared stats | economy flag, default OFF | todo |  |
| 126 | Co-op megaprojects, like building a canal | default ON | todo |  |
| 127 | Player-run shipping lines with timetables | default ON | todo |  |
| 128 | Hiring other players as captains | economy flag, default OFF | todo |  |
| 129 | A trust and reputation score | default ON | todo |  |
| 130 | Spectator mode | economy flag, default OFF | todo |  |

## Progression

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 131 | A tech tree | default ON | todo |  |
| 132 | Licences for ship classes and cargo types | default ON | todo |  |
| 133 | Small daily login rewards | economy flag, default OFF | todo |  |
| 134 | Achievements | economy flag, default OFF | todo |  |
| 135 | Earnable titles | economy flag, default OFF | todo |  |
| 136 | Weekly goals | default ON | todo |  |
| 137 | A tutorial contract chain | default ON | todo |  |
| 138 | Captain levels | default ON | todo |  |
| 139 | Remote islands unlocked late | default ON | todo |  |
| 140 | A prestige reset with permanent bonuses | economy flag, default OFF | todo |  |
| 141 | Seasonal ladders that reset | economy flag, default OFF | todo |  |
| 142 | Weekly leaderboards (profit, deliveries, distance) | default ON | in build (extend) | season leaderboards |
| 143 | Milestone ship skins | default ON | todo |  |
| 144 | A collection book of goods and ports | default ON | todo |  |
| 145 | Offline progress, so ships keep working while you’re away | economy flag, default OFF | todo |  |

## UI and quality of life

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 146 | A route planner with estimated profit | default ON | todo |  |
| 147 | A fuel, time and profit calculator | default ON | todo |  |
| 148 | Saved routes | economy flag, default OFF | todo |  |
| 149 | Auto-trade routes | default ON | in build (extend) | voyage queue |
| 150 | A minimap | default ON | todo |  |
| 151 | In-game notifications | economy flag, default OFF | todo |  |
| 152 | Dark mode | default ON | todo |  |
| 153 | Mobile-friendly controls | economy flag, default OFF | todo |  |
| 154 | Keyboard shortcuts | default ON | todo |  |
| 155 | A cargo manifest screen (it fits the name) | default ON | todo |  |
| 156 | A price heatmap across the map | default ON | todo |  |
| 157 | A profit and loss ledger | default ON | todo |  |
| 158 | Rich tooltips | default ON | todo |  |
| 159 | A colour-blind mode | default ON | todo |  |
| 160 | Multiple languages | default ON | todo |  |

## Art and audio

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 161 | Animated ship wakes | default ON | todo |  |
| 162 | Day-night lighting | default ON | todo |  |
| 163 | Animated cranes and port activity | default ON | todo |  |
| 164 | Rain and storm particle effects | default ON | todo |  |
| 165 | Ambient gulls and fish | default ON | todo |  |
| 166 | Ambient sea audio | default ON | todo |  |
| 167 | A chiptune soundtrack | default ON | todo |  |
| 168 | UI sound effects | default ON | todo |  |
| 169 | Ship horns | default ON | todo |  |
| 170 | More isometric zoom levels | default ON | todo |  |
| 171 | Country-style flags for companies | default ON | todo |  |
| 172 | Pixel-art event illustrations | default ON | todo |  |

## Monetisation within your rules

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 173 | Cosmetic ship skins | default ON | todo |  |
| 174 | Custom company flags | default ON | in build (extend) | company pennants |
| 175 | Paid ship or port naming | economy flag, default OFF | todo |  |
| 176 | A supporter badge | default ON | todo |  |
| 177 | A pay-what-you-want itch.io download | outside the game | todo |  |
| 178 | A tip jar | outside the game | todo |  |
| 179 | Cosmetic company logos | default ON | todo |  |
| 180 | Premium wake and trail effects | default ON | todo |  |
| 181 | Soundtrack sales | default ON | todo |  |
| 182 | Paid sprite packs of your pixel art | outside the game | todo |  |

## Growth and community

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 183 | Naming rewards for early Discord testers | outside the game | todo |  |
| 184 | Discord race events with in-game prizes | outside the game | todo |  |
| 185 | Devlog series with “Part N/M” numbering | outside the game | todo |  |
| 186 | Before-and-after sprite upgrade clips | outside the game | todo |  |
| 187 | Player story clips | outside the game | todo |  |
| 188 | A “share my fleet” image | default ON | todo |  |
| 189 | A public stats page | default ON | todo |  |
| 190 | Weekly Discord announcements | outside the game | todo |  |
| 191 | Reddit posts in strategy and indie game communities | outside the game | todo |  |
| 192 | Browser-game portal listings | outside the game | todo |  |
| 193 | An itch.io page | outside the game | todo |  |
| 194 | Speedrun-style challenges | default ON | todo |  |
| 195 | A community map-design contest | outside the game | todo |  |

## Dev and tooling

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 196 | Simulator-driven balance reports | default ON | in build (extend) | Python simulator exists |
| 197 | Feature flags for safe experiments | default ON | todo |  |
| 198 | Anonymous aggregate telemetry with no personal data | default ON | todo |  |
| 199 | An in-game bug report button | default ON | todo |  |
| 200 | A session replay system for debugging economy bugs | default ON | todo |  |

## Advanced economy

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 201 | Dynamic freight rates per shipping lane | economy flag, default OFF | todo |  |
| 202 | Backhaul bonus for returning with cargo | economy flag, default OFF | in build (extend) | return-load (backhaul) board |
| 203 | Visible fuel cost of empty return legs | economy flag, default OFF | todo |  |
| 204 | A commodity speculation market | economy flag, default OFF | todo |  |
| 205 | Port rumours that may be false | economy flag, default OFF | todo |  |
| 206 | A currency per island group, with exchange rates | economy flag, default OFF | todo |  |
| 207 | Money sinks that fight inflation | economy flag, default OFF | todo |  |
| 208 | A wealth tax on top players that funds public events | economy flag, default OFF | todo |  |
| 209 | Subsidies for opening new routes | economy flag, default OFF | todo |  |
| 210 | Price caps during emergencies | economy flag, default OFF | in build (extend) | admin rule toggles (check scope) |
| 211 | Company cartels that fix prices and risk investigation | economy flag, default OFF | todo |  |
| 212 | Antitrust events | economy flag, default OFF | todo |  |
| 213 | Trade embargoes between regions | economy flag, default OFF | todo |  |
| 214 | Toll gates on busy lanes | economy flag, default OFF | todo |  |
| 215 | Fuel price tied to in-game oil output | economy flag, default OFF | todo |  |
| 216 | Cargo quality grades | economy flag, default OFF | todo |  |
| 217 | Company-branded goods | economy flag, default OFF | todo |  |
| 218 | Manufacturing contracts, not just shipping | economy flag, default OFF | todo |  |
| 219 | Recycling goods back into raw materials | economy flag, default OFF | todo |  |
| 220 | Rare market-crash events | economy flag, default OFF | todo |  |

## Ship mechanics

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 221 | A speed-versus-fuel throttle slider | economy flag, default OFF | todo |  |
| 222 | Convoy slipstream fuel savings | economy flag, default OFF | todo |  |
| 223 | Overloading that risks sinking | economy flag, default OFF | todo |  |
| 224 | Cargo balance and stability | default ON | todo |  |
| 225 | Draft limits that keep big ships out of shallow ports | default ON | todo |  |
| 226 | Port dredging to admit bigger ships | default ON | todo |  |
| 227 | Modular upgrade slots | default ON | todo |  |
| 228 | Insurance tiers | economy flag, default OFF | todo |  |
| 229 | Mid-voyage breakdowns | economy flag, default OFF | todo |  |
| 230 | Towing services from other players | economy flag, default OFF | todo |  |
| 231 | Fire-on-board events | default ON | todo |  |
| 232 | Mutiny when morale is low | default ON | todo |  |
| 233 | Stowaways | default ON | todo |  |
| 234 | Ghost wrecks of abandoned ships | default ON | todo |  |
| 235 | Ship age and retirement value | economy flag, default OFF | todo |  |
| 236 | Refitting old hulls | economy flag, default OFF | todo |  |
| 237 | Green or hybrid engines | economy flag, default OFF | todo |  |
| 238 | Sails for the early game | default ON | todo |  |
| 239 | A logbook of each ship’s journeys | default ON | todo |  |
| 240 | Ship rating stats | default ON | todo |  |

## Navigation and maps

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 241 | Waypoints | default ON | todo |  |
| 242 | Fog of war on the map | default ON | todo |  |
| 243 | Purchasable sea charts | economy flag, default OFF | todo |  |
| 244 | Beacon lights | economy flag, default OFF | todo |  |
| 245 | Shipping-lane highways with a speed bonus | economy flag, default OFF | todo |  |
| 246 | Reef hazards | economy flag, default OFF | todo |  |
| 247 | Narrow straits as chokepoints | default ON | todo |  |
| 248 | Player-placed buoys | default ON | todo |  |
| 249 | Live positions of other ships | default ON | todo |  |
| 250 | A radar ping | economy flag, default OFF | todo |  |
| 251 | Distress beacons | default ON | todo |  |
| 252 | Map layer toggles | default ON | todo |  |
| 253 | A distance ruler | default ON | todo |  |
| 254 | ETA that accounts for weather | default ON | todo |  |
| 255 | Hazard-avoiding auto-routes | default ON | todo |  |
| 256 | Shareable route codes | default ON | todo |  |
| 257 | Named sea regions | default ON | todo |  |
| 258 | A first-discovery bonus | economy flag, default OFF | todo |  |
| 259 | Ferries between archipelago islands | economy flag, default OFF | todo |  |
| 260 | Paid fast-travel licences with a fee | economy flag, default OFF | todo |  |

## Port life and buildings

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 261 | A tavern for rumours and hiring | default ON | todo |  |
| 262 | Market stalls | default ON | todo |  |
| 263 | A bank | default ON | todo |  |
| 264 | An insurance office | default ON | todo |  |
| 265 | A chandlery for supplies | default ON | todo |  |
| 266 | A fish market | economy flag, default OFF | todo |  |
| 267 | Lighthouse keeper quests | default ON | todo |  |
| 268 | A harbour master | economy flag, default OFF | todo |  |
| 269 | A dockworkers’ union | economy flag, default OFF | todo |  |
| 270 | A customs queue | default ON | todo |  |
| 271 | A weather station | default ON | todo |  |
| 272 | A cargo yard stacking minigame | default ON | todo |  |
| 273 | A crane operator minigame | default ON | todo |  |
| 274 | Land reclamation to expand ports | default ON | todo |  |
| 275 | A shipbreaking yard | default ON | todo |  |
| 276 | A cruise terminal | default ON | todo |  |
| 277 | A naval base | default ON | todo |  |
| 278 | A research institute | default ON | todo |  |
| 279 | A museum of player achievements | default ON | todo |  |
| 280 | A port skyline that grows with prosperity | default ON | todo |  |

## Cargo and goods

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 281 | Hazardous cargo | economy flag, default OFF | todo |  |
| 282 | Livestock | economy flag, default OFF | todo |  |
| 283 | Fresh produce | economy flag, default OFF | todo |  |
| 284 | Medicine | economy flag, default OFF | todo |  |
| 285 | Electronics | default ON | todo |  |
| 286 | Cars | economy flag, default OFF | todo |  |
| 287 | Coal | economy flag, default OFF | todo |  |
| 288 | Grain | economy flag, default OFF | todo |  |
| 289 | Spices | economy flag, default OFF | todo |  |
| 290 | Timber | economy flag, default OFF | todo |  |
| 291 | Cement | economy flag, default OFF | todo |  |
| 292 | Textiles | economy flag, default OFF | todo |  |
| 293 | Fresh fish | economy flag, default OFF | todo |  |
| 294 | Wine | economy flag, default OFF | todo |  |
| 295 | Artifacts | economy flag, default OFF | todo |  |
| 296 | Mail | economy flag, default OFF | todo |  |
| 297 | Gold bullion | economy flag, default OFF | todo |  |
| 298 | Licensed weapons | economy flag, default OFF | todo |  |
| 299 | Mystery crates | economy flag, default OFF | todo |  |
| 300 | Fragile cargo | economy flag, default OFF | todo |  |

## NPCs and factions

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 301 | Rival NPC shipping companies | economy flag, default OFF | todo |  |
| 302 | A merchant guild faction | default ON | todo |  |
| 303 | A smuggler syndicate | default ON | todo |  |
| 304 | A navy faction | default ON | todo |  |
| 305 | Island tribes | default ON | todo |  |
| 306 | A wandering trader ship | default ON | todo |  |
| 307 | A ghost ship | default ON | todo |  |
| 308 | NPC ferry traffic | default ON | todo |  |
| 309 | NPC fishermen | default ON | todo |  |
| 310 | NPC cruise liners | default ON | todo |  |
| 311 | A quest-giving old captain | default ON | todo |  |
| 312 | A rival AI that learns your habits | default ON | todo |  |
| 313 | Named pirates with personalities | default ON | todo |  |
| 314 | Legendary captains | default ON | todo |  |
| 315 | Port mayors | default ON | todo |  |
| 316 | Journalists who write the news | default ON | todo |  |
| 317 | Inspectors | default ON | todo |  |
| 318 | Mechanics who offer repair deals | default ON | todo |  |
| 319 | Travelling merchants | economy flag, default OFF | todo |  |
| 320 | A mystery stranger | default ON | todo |  |

## Events and seasons

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 321 | A regatta race | default ON | todo |  |
| 322 | A harvest festival | default ON | todo |  |
| 323 | An oil boom | economy flag, default OFF | todo |  |
| 324 | A fuel strike | economy flag, default OFF | todo |  |
| 325 | Quarantine events | default ON | todo |  |
| 326 | A pirate king rising | economy flag, default OFF | todo |  |
| 327 | A tsunami | default ON | todo |  |
| 328 | A shipwreck rescue | default ON | todo |  |
| 329 | A trade fair | default ON | todo |  |
| 330 | A royal wedding mega-order | economy flag, default OFF | todo |  |
| 331 | A war between regions | economy flag, default OFF | todo |  |
| 332 | A new island emerging | default ON | todo |  |
| 333 | Extreme tides | default ON | todo |  |
| 334 | An eclipse event | default ON | todo |  |
| 335 | A sale week | economy flag, default OFF | todo |  |
| 336 | A Halloween ghost fleet | default ON | todo |  |
| 337 | Holiday gift shipping | economy flag, default OFF | todo |  |
| 338 | An anniversary event | default ON | todo |  |
| 339 | A world-boss kraken | economy flag, default OFF | todo |  |
| 340 | Server-wide cooperative goals | economy flag, default OFF | todo |  |

## Company depth

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 341 | A company HQ port | default ON | todo |  |
| 342 | A company shipyard | default ON | todo |  |
| 343 | A company bank | economy flag, default OFF | todo |  |
| 344 | Dividends | economy flag, default OFF | todo |  |
| 345 | Tradeable company shares | economy flag, default OFF | todo |  |
| 346 | Hostile takeovers | economy flag, default OFF | todo |  |
| 347 | Mergers | economy flag, default OFF | todo |  |
| 348 | Company-only contracts | economy flag, default OFF | todo |  |
| 349 | Company ranks | default ON | todo |  |
| 350 | Company flags | default ON | todo |  |
| 351 | A company news feed | economy flag, default OFF | todo |  |
| 352 | Company missions | default ON | todo |  |
| 353 | Fleet formations | default ON | todo |  |
| 354 | A shared company warehouse | economy flag, default OFF | todo |  |
| 355 | A company tech tree | default ON | todo |  |
| 356 | Company reputation | default ON | todo |  |
| 357 | Company wars | economy flag, default OFF | todo |  |
| 358 | Company chat | default ON | todo |  |
| 359 | A recruitment board | default ON | todo |  |
| 360 | A company hall of fame | default ON | todo |  |

## Player-run politics

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 361 | Electing port mayors | default ON | todo |  |
| 362 | Port tax votes | economy flag, default OFF | todo |  |
| 363 | Law proposals | default ON | todo |  |
| 364 | A server council | default ON | todo |  |
| 365 | Piracy laws | economy flag, default OFF | todo |  |
| 366 | Trade treaties | economy flag, default OFF | todo |  |
| 367 | Player-run courts | default ON | todo |  |
| 368 | Dispute arbitration | default ON | todo |  |
| 369 | A fines system | economy flag, default OFF | todo |  |
| 370 | Player-issued licences | default ON | todo |  |
| 371 | A player inspector role | default ON | todo |  |
| 372 | Lighthouse taxes | economy flag, default OFF | todo |  |
| 373 | Player-written newspapers | default ON | todo |  |
| 374 | Auctioned naming rights | economy flag, default OFF | todo |  |
| 375 | Community-voted map changes | default ON | todo |  |
| 376 | A community fund | economy flag, default OFF | todo |  |
| 377 | Community-voted features | default ON | todo |  |
| 378 | Weekly polls | default ON | todo |  |
| 379 | A transparent public ledger | default ON | todo |  |
| 380 | A whistleblower system | default ON | todo |  |

## Meta progression

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 381 | A retired captain’s legacy as a passive bonus | economy flag, default OFF | todo |  |
| 382 | Heirloom items | economy flag, default OFF | todo |  |
| 383 | A trophy room | default ON | todo |  |
| 384 | Account milestones | default ON | todo |  |
| 385 | A free seasonal reward track | default ON | todo |  |
| 386 | Daily quests | default ON | todo |  |
| 387 | Skill points | economy flag, default OFF | todo |  |
| 388 | Mastery per cargo type | economy flag, default OFF | todo |  |
| 389 | Mastery per route | economy flag, default OFF | todo |  |
| 390 | Titles by playstyle | default ON | todo |  |
| 391 | A rank ladder | default ON | todo |  |
| 392 | A hall of fame | default ON | todo |  |
| 393 | A stats dashboard | default ON | todo |  |
| 394 | Long-term goals, like owning a 50-ship fleet | default ON | todo |  |
| 395 | Secret achievements | default ON | todo |  |
| 396 | A sandbox mode with unlimited funds | default ON | todo |  |
| 397 | Challenge runs, like no fuel upgrades | default ON | todo |  |
| 398 | An ironman mode | default ON | todo |  |
| 399 | New Game+ | default ON | todo |  |
| 400 | Veteran perks | economy flag, default OFF | todo |  |

## Game modes

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 401 | Offline single-player | default ON | todo |  |
| 402 | A co-op campaign | default ON | todo |  |
| 403 | Scenario puzzles, like “deliver X with 100 fuel” | default ON | todo |  |
| 404 | A daily puzzle route | default ON | todo |  |
| 405 | A speed-trading blitz | economy flag, default OFF | todo |  |
| 406 | Hardcore permadeath | default ON | todo |  |
| 407 | A cosy mode with no pirates | default ON | todo |  |
| 408 | A pirate-only mode | default ON | todo |  |
| 409 | A tycoon sandbox | default ON | todo |  |
| 410 | Time-limited seasons | default ON | todo |  |
| 411 | Tournaments | default ON | todo |  |
| 412 | Training missions | default ON | todo |  |
| 413 | A steamship-era setting | default ON | todo |  |
| 414 | A futuristic setting | default ON | todo |  |
| 415 | A fantasy setting | default ON | todo |  |
| 416 | An Arctic map | default ON | todo |  |
| 417 | A Mediterranean map | default ON | todo |  |
| 418 | A custom map editor | default ON | todo |  |
| 419 | Map sharing | default ON | todo |  |
| 420 | Mod support | default ON | todo |  |

## UI and quality of life

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 421 | A customisable dashboard | default ON | todo |  |
| 422 | Draggable windows | default ON | todo |  |
| 423 | Quick-sell | economy flag, default OFF | todo |  |
| 424 | One-click repeat of the last route | default ON | todo |  |
| 425 | A “best trade right now” suggestion | economy flag, default OFF | todo |  |
| 426 | Price alerts | default ON | todo |  |
| 427 | A watchlist | default ON | todo |  |
| 428 | Cargo filters | default ON | todo |  |
| 429 | Port search | default ON | todo |  |
| 430 | Zoom to fleet | default ON | todo |  |
| 431 | A fleet overview table | default ON | todo |  |
| 432 | Ship sorting and filtering | default ON | todo |  |
| 433 | Idle-ship warnings | default ON | todo |  |
| 434 | A cargo fill bar | default ON | todo |  |
| 435 | A daily summary popup | default ON | todo |  |
| 436 | CSV ledger export | default ON | todo |  |
| 437 | A screenshot mode | default ON | todo |  |
| 438 | A photo mode | default ON | todo |  |
| 439 | A streamer mode that hides names | default ON | todo |  |
| 440 | Theme packs | default ON | todo |  |

## Art and animation

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 441 | Ship damage sprites | default ON | todo |  |
| 442 | Funnel smoke | default ON | todo |  |
| 443 | A sinking animation | default ON | todo |  |
| 444 | Crane loading animations | default ON | todo |  |
| 445 | Container stack variations | default ON | todo |  |
| 446 | Seasonal sprite swaps | default ON | todo |  |
| 447 | Snow on ports in winter | default ON | todo |  |
| 448 | Pixelated water shaders | default ON | todo |  |
| 449 | Water reflections | default ON | todo |  |
| 450 | Night lights | default ON | todo |  |
| 451 | Lightning | default ON | todo |  |
| 452 | Rain | default ON | todo |  |
| 453 | Fluttering pirate flags | default ON | todo |  |
| 454 | Flashing police lights | default ON | todo |  |
| 455 | Explosions | default ON | todo |  |
| 456 | Seagulls | default ON | todo |  |
| 457 | Whales | default ON | todo |  |
| 458 | Dolphins following ships | default ON | todo |  |
| 459 | Island biome variety | default ON | todo |  |
| 460 | Port growth stages | default ON | todo |  |

## Audio and story

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 461 | Per-region music | default ON | todo |  |
| 462 | Storm music | default ON | todo |  |
| 463 | A pirate theme | default ON | todo |  |
| 464 | Police sirens | default ON | todo |  |
| 465 | Crane clanks | default ON | todo |  |
| 466 | Gull calls | default ON | todo |  |
| 467 | Radio chatter | default ON | todo |  |
| 468 | Captain voice barks | default ON | todo |  |
| 469 | Sea shanties | default ON | todo |  |
| 470 | Day and night ambience | default ON | todo |  |
| 471 | Island lore | default ON | todo |  |
| 472 | A founding story | default ON | todo |  |
| 473 | Collectable lore items | default ON | todo |  |
| 474 | A captain’s diary | default ON | todo |  |
| 475 | Newspaper headlines | default ON | todo |  |
| 476 | A lost-cargo mystery plot | default ON | todo |  |
| 477 | Rival story arcs | default ON | todo |  |
| 478 | A legendary ship quest | default ON | todo |  |
| 479 | Easter eggs | default ON | todo |  |
| 480 | A developer cameo ship | default ON | todo |  |

## Onboarding and accessibility

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 481 | An interactive tutorial | default ON | todo |  |
| 482 | A guided first delivery | default ON | todo |  |
| 483 | A starter bonus | default ON | todo |  |
| 484 | A glossary | default ON | todo |  |
| 485 | Loading-screen tips | default ON | todo |  |
| 486 | Difficulty presets | default ON | todo |  |
| 487 | Undo for the last action | default ON | todo |  |
| 488 | Text scaling | default ON | todo |  |
| 489 | Reduced motion | default ON | todo |  |
| 490 | Screen reader labels | default ON | todo |  |
| 491 | Controller support | default ON | todo |  |
| 492 | Touch controls | default ON | todo |  |
| 493 | An installable offline-friendly web app | default ON | todo |  |
| 494 | A low-spec mode | default ON | todo |  |
| 495 | Community language packs | default ON | todo |  |
| 496 | Colour palettes | default ON | todo |  |
| 497 | A calm mode | default ON | todo |  |
| 498 | Session timer reminders | default ON | todo |  |
| 499 | Spoiler-free hints | default ON | todo |  |
| 500 | An in-game wiki | default ON | todo |  |

## Cosmetics and monetisation

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 501 | Flag packs | default ON | todo |  |
| 502 | Hull patterns | default ON | todo |  |
| 503 | Funnel designs | default ON | todo |  |
| 504 | Port banners | default ON | todo |  |
| 505 | Crane skins | default ON | todo |  |
| 506 | Name plates | default ON | todo |  |
| 507 | Wake colours | default ON | todo |  |
| 508 | Horn sounds | default ON | todo |  |
| 509 | Seasonal skins | default ON | todo |  |
| 510 | A founder pack | default ON | todo |  |
| 511 | Limited-run skins | default ON | todo |  |
| 512 | A charity skin | default ON | todo |  |
| 513 | A playtester skin | default ON | todo |  |
| 514 | A soundtrack release | outside the game | todo |  |
| 515 | A pixel-art book PDF | outside the game | todo |  |
| 516 | Wallpapers | outside the game | todo |  |
| 517 | Sticker packs | outside the game | todo |  |
| 518 | Printable posters of your sprites | outside the game | todo |  |
| 519 | Pixel-art commissions for other devs | outside the game | todo |  |
| 520 | Pixel-art tutorials | outside the game | todo |  |

## Community and marketing

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 521 | A subreddit | outside the game | todo |  |
| 522 | Weekly Discord Q&A sessions | outside the game | todo |  |
| 523 | Roadmap voting | outside the game | todo |  |
| 524 | Changelog posts | outside the game | todo |  |
| 525 | Patch note videos | outside the game | todo |  |
| 526 | A Short: “what pirates stole this week” | outside the game | todo |  |
| 527 | A Short: price crash explained | outside the game | todo |  |
| 528 | A Short: sprite timelapse | outside the game | todo |  |
| 529 | A Short: a day in the life of a captain | outside the game | todo |  |
| 530 | A Short: the economy explained | outside the game | todo |  |
| 531 | A pixel-art process devlog | outside the game | todo |  |
| 532 | Streamer invites | outside the game | todo |  |
| 533 | Playtest weekends | outside the game | todo |  |
| 534 | A tester leaderboard | default ON | todo |  |
| 535 | Cosmetic rewards for bug reports | default ON | todo |  |
| 536 | Cosmetic referral rewards | default ON | todo |  |
| 537 | A press kit | outside the game | todo |  |
| 538 | A trailer | outside the game | todo |  |
| 539 | A GIF library | outside the game | todo |  |
| 540 | A game jam entry | outside the game | todo |  |
| 541 | Indie showcase submissions | outside the game | todo |  |
| 542 | An itch.io devlog | outside the game | todo |  |
| 543 | A Show HN post | outside the game | todo |  |
| 544 | A Product Hunt launch | outside the game | todo |  |
| 545 | Cross-promotion with other indie browser games | outside the game | todo |  |
| 546 | A community wiki | default ON | todo |  |
| 547 | Fan art contests | outside the game | todo |  |
| 548 | A fan-made ship contest | outside the game | todo |  |
| 549 | A lore writing contest | outside the game | todo |  |
| 550 | A meme template | outside the game | todo |  |

## Fairness and moderation

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 551 | Rate limits | default ON | todo |  |
| 552 | Anti-bot checks | default ON | todo |  |
| 553 | Multi-account detection | default ON | todo |  |
| 554 | Server-side price validation | default ON | todo |  |
| 555 | Server-authoritative game state | default ON | todo |  |
| 556 | A player report button | default ON | todo |  |
| 557 | Chat filters | default ON | todo |  |
| 558 | Mute and block | default ON | todo |  |
| 559 | Reputation penalties | default ON | todo |  |
| 560 | An appeals process | default ON | todo |  |
| 561 | Rollback tools | default ON | todo |  |
| 562 | Economy audit logs | default ON | todo |  |
| 563 | Anomaly alerts | default ON | todo |  |
| 564 | Duplication guards | default ON | todo |  |
| 565 | Cheater purges from leaderboards | default ON | todo |  |
| 566 | Fair event brackets | default ON | todo |  |
| 567 | Newbie protection zones | economy flag, default OFF | todo |  |
| 568 | Pirate protection for low levels | default ON | todo |  |
| 569 | Catch-up mechanics | economy flag, default OFF | todo |  |
| 570 | Limits on runaway wealth | economy flag, default OFF | todo |  |

## Dev tools and simulation

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 571 | Simulator personas with different goals | default ON | todo |  |
| 572 | A min-maxer persona | default ON | todo |  |
| 573 | An explorer persona | default ON | todo |  |
| 574 | A pirate persona | default ON | todo |  |
| 575 | A social persona | default ON | todo |  |
| 576 | A casual persona | default ON | todo |  |
| 577 | Churn prediction | default ON | todo |  |
| 578 | An economy health score | default ON | todo |  |
| 579 | A wealth inequality (Gini) tracker | default ON | todo |  |
| 580 | Route heatmaps | default ON | todo |  |
| 581 | A/B tests | default ON | todo |  |
| 582 | Automated regression tests | default ON | todo |  |
| 583 | Hourly AI-readable bot reports | default ON | todo |  |
| 584 | Replays of simulator runs | default ON | todo |  |
| 585 | Balance dashboards | default ON | todo |  |
| 586 | Seed-based reproducible worlds | default ON | todo |  |
| 587 | A debug overlay | default ON | todo |  |
| 588 | An admin console | default ON | todo |  |
| 589 | Save backups | default ON | todo |  |
| 590 | A pre-deploy checklist for branches | default ON | todo |  |

## Experimental

| # | Feature | Type | Status | Note |
|---|---|---|---|---|
| 591 | Submarines | default ON | todo |  |
| 592 | Cargo airships | default ON | todo |  |
| 593 | A space shipping expansion | default ON | todo |  |
| 594 | Underwater ports | default ON | todo |  |
| 595 | A ghost port that appears at random | default ON | todo |  |
| 596 | Floating cities | default ON | todo |  |
| 597 | Time-travel events | default ON | todo |  |
| 598 | A dragon in fantasy mode | default ON | todo |  |
| 599 | Real-time cooperative fleet battles | default ON | todo |  |
| 600 | Player-written contracts | economy flag, default OFF | todo |  |
