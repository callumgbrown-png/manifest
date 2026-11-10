# Economy category report (ideas 1-20, 201-220, 281-300)

All 60 ideas are built as 59 modules in `server/src/features/economy/`, tested in `server/test/features-economy.test.ts`
(63 tests: one or more per module, an idea-coverage test, a switch-file test and a full replay with every economy module
on). No shared core files were edited. Client code (price charts and the index ticker) is in
`server/public/features/economy.js`. Specialty goods and production chains are data: `config/content/economy/cargo.json`
and `config/content/economy/chains.json` (one module per entry).

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| economy.price-history | 2 | Daily price per port and good (14 days); charts for the watched port and the ports your ships are at or bound for |
| economy.price-ticker | 10 | Island-wide price index per good with its 24-hour change and a headline, shown as a strip under the map (with any market news from other economy modules) |
| economy.chain-bread | 11 | Grain to flour (flour mill) to bread (bakery) at fixed works ports, then sold through a small bread/flour market. No processing fee |
| economy.cargo-electronics | 285 | Electronics: loaded at a few ports, sold anywhere (best at its consumer ports), a little breaks at sea |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| economy.demand-curves | 1 | Consumer ports use cheap goods up to 60% faster and dear goods slower (price swings harder) |
| economy.saturation | 7 | A big sale floods the port: extra glut stock (lower price) that drains at 5% an hour |
| economy.rumours | 205 | A daily rumour; 60% are true and really move that port's stock over 36 hours |
| economy.crashes | 220 | 2% a day: one good's stock jumps everywhere (price collapse) |
| economy.price-caps | 210 | When a good's average sits in the top 15% of its band, reserves are released at ports above the cap |
| economy.bulk-discounts | 6 | Bulk desk: 50 t 5% off, 100 t 10%, 200 t 15% |
| economy.black-market | 9 | Three fixed ports buy any cargo at 50-190% of market (new daily), tax-free; 8% of deals are seized |
| economy.futures | 3 | Futures for any good and port, 2-10 days, 20% margin returned on delivery or lost (extends the machinery future already in the game) |
| economy.warehouses | 4 | Store cargo at a port (2,000 t per port) for 0.02 cr per tonne-hour |
| economy.speculation | 204 | Long/short the price index of a good at 2x, 1% fee each way, up to three positions |
| economy.tariffs | 8 | Laden ships landing in another island group pay 5% of cargo cost with the port fee |
| economy.embargoes | 213 | Half the weeks, two island groups are embargoed for 7 days; laden ships crossing pay 30% of cargo cost |
| economy.currencies | 206 | A currency per island group (0.8-1.25, daily drift); exchange fee on sales into weak or purchases in strong money |
| economy.tolls | 214 | 150 cr (per freighter-size) toll on the three busiest lanes, re-picked daily; tolls are a money sink |
| economy.freight-rates | 201 | Laden arrivals on quiet lanes get a freight bonus, crowded lanes pay extra |
| economy.backhaul | 202 | +5% of the sale when a ship brings cargo back down the lane it just came on |
| economy.empty-legs | 203 | Empty ships burn 15% less fuel; card shows each ship's fuel cost of sailing home empty |
| economy.subsidies | 209 | First laden delivery on a lane nobody traded this season: 2 cr per distance unit, max 3,000 |
| economy.cartels | 211 | Two or more members on a good drain consumer stock (higher prices); daily 3% per member chance of a 10%-of-cash fine (doubled with antitrust on) |
| economy.antitrust | 212 | Daily: a company with over 40% of all wealth, or over 60% of ships on a busy lane, is fined 3% of cash |
| economy.wealth-tax | 208 | Top three pay 0.5% a day on net worth over 2x start cash; each 20,000 collected funds a festival that buys up a port's goods |
| economy.money-sinks | 207 | Prestige items (2,000 / 5,000 / 10,000) and 0.2% daily harbour dues on cash over 100,000 |
| economy.loans | 19 | Borrow up to half the fleet's new value at 0.5% a day; collected at season end |
| economy.safety-net | 20 | Once a season, a company in debt and worth under a quarter of start cash may restart: keep one empty ship, cash reset to 2,500 |
| economy.harvests | 17, 288 | 14-day grain cycle: 4 harvest days flood farm ports, 7 lean days halve their output |
| economy.depletion | 18 | Oil wells and ore mines lose 0.1% reserve an hour (output down to 20%); investing refills them and pays a dividend on output |
| economy.oil-output | 215 | Weekly oil output level 60-140% changes fuel stock at oil ports, so fuel price follows output |
| economy.quality-grades | 216 | Each sailing cargo is graded A/B/C (25/50/25%): +8% / 0 / -8% on the sale |
| economy.branded-goods | 217 | 5,000 cr brand for one good; deliveries build fame (1,500 t) worth up to +10% on sales |
| economy.manufacturing | 218 | Pay 3 cr/t to have ore made into machinery (2:1) at a factory port in 24 h |
| economy.recycling | 219 | Four yards turn machinery into ore (1.2 t per t) and cars into 3 t of ore, 1 cr per unit |
| economy.spoilage | 5 | Grain loses 0.1% an hour at sea (module perishables have their own rates) |
| economy.chain-plastics | 12 | Fuel to plastics (cracker plant), 5 cr/t |
| economy.chain-steel | 13 | Ore to steel to containers, 3 and 6 cr/t |
| economy.chain-furniture | 14 | Timber to planks to furniture, 2 and 6 cr/t (timber from economy.cargo-timber) |
| economy.chain-canned-fish | 15 | Fish to canned fish, 3 cr/t (fish from economy.cargo-fish) |
| economy.cargo-pearls | 16 | Pearls only from the remotest ports |
| economy.cargo-hazmat | 281 | Hazardous chemicals: chance of a clean-up fine at sea |
| economy.cargo-livestock | 282 | Livestock: 2 t of hold each, feed cost at sea, slow losses |
| economy.cargo-produce | 283 | Fresh produce: rots 0.8% an hour |
| economy.cargo-medicine | 284 | Medicine: every three days a consumer port runs out (outbreak, top price) |
| economy.cargo-cars | 286 | Cars: 3 t of hold each |
| economy.cargo-coal | 287 | Coal: cheap bulk, small hazard |
| economy.cargo-spices | 289 | Spices from the remotest ports |
| economy.cargo-timber | 290 | Timber (input to the furniture chain) |
| economy.cargo-cement | 291 | Cement: sets (spoils fast) after 72 h |
| economy.cargo-textiles | 292 | Textiles |
| economy.cargo-fish | 293 | Fresh fish: rots 1.2% an hour (input to canned fish) |
| economy.cargo-wine | 294 | Wine: gains 0.2% value per hour held, up to +50% |
| economy.cargo-artifacts | 295 | Artifacts from the remotest ports, very dear, max 5 per ship |
| economy.cargo-mail | 296 | Mail contracts from any port to a random port, paid on delivery (half if late) |
| economy.cargo-gold | 297 | Gold bullion: chance of theft at sea |
| economy.cargo-weapons | 298 | Licensed weapons: 1,500 cr licence first; hazard fines |
| economy.cargo-mystery | 299 | Mystery crates at 60 each, worth 20%-280% (hidden from the client until sold) |
| economy.cargo-glassware | 300 | Fragile glassware: 1% breaks every hour at sea |

## Decisions
- **No price hook in the engine**, so "moves prices" is done by changing port stock (the engine's price follows stock)
  and by the `tradeTax` hook. Fees, tariffs, tolls, fines and freight bonuses go through the `portFee` hook (charged on
  arrival). The freight-rate bonus makes the port fee negative on quiet lanes, which the engine pays out as cash.
- **Specialty goods live in feature state**, not in `Ship.good`: each ship has a shared "special hold" (`specialty.ts`).
  Each cargo module charges its own goods' hold space through the `capacity` hook, so engine cargo and module cargo
  share one hold correctly. Module goods have their own small side markets per module.
- **Assignment said ON for bread (11) and electronics (285)** although they let players earn money: they add tradeable
  goods without changing any existing price, fee or rule. The bread chain charges no processing fee (other chains do).
  Easy to switch off in `config/features/economy.json` if Dave disagrees.
- **Idea 288 (grain)** is already an engine good, so it is covered by the grain harvest cycle (`economy.harvests`).
- **Idea 203 (visible empty-leg cost)** is mostly information, but the assignment marks it economy, so it also gives
  empty ships a 15% ballast fuel saving and ships off.
- **Factories run during Engine construction** (before the map exists), so all map-derived choices (works ports,
  producers, black-market ports, yards) are built on first use (`lazy` in `util.ts`). They depend only on the map.
- **Overlaps with the base game**: machinery futures, emergency credit, tariffs and spoilage in the maritime module,
  and the backhaul board already exist. The modules here extend them (any good, any port; a full restart; island-group
  tariffs; grain spoilage at sea) and don't change the existing rules.
- Four existing test files need the `ws` package and could not be run in the cloud session; the client strip and charts
  could not be tried in a browser here, so they are worth a quick look locally.
