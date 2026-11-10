# Contracts category report (ideas 61-95, 301-320)

All 55 ideas are built as 55 modules in `server/src/features/contracts/`, tested in `server/test/features-contracts.test.ts`
(55 tests, including a full replay of every module together). Map drawing (pirate zones, hideouts, the boss, named
pirates, the ghost ship, distress signals, wrecks, ferries, fishermen, the cruise liner, police boats, the trader, the
old captain, the stranger and forming convoys) is in `server/public/features/contracts.js`. No shared core files were edited.

Files: `core.ts` (shared helpers, the contract book, NPC schedules), `delivery.ts` (61-70, 73, 75), `jobs.ts` (71, 72, 74),
`pirates.ts` (76-82, 84, 93), `law.ts` (83, 85-92, 94, 95), `npcs.ts` (301-320).

NPC places and events (pirate zones, the boss, blockades, named pirates, the ghost ship, the trader, mayors' wishes,
inspectors, mechanics, merchants, the stranger) are pure functions of the map and the tick, so forecasts, clients and
replays agree. Fight and ambush rolls hash the tick and ship id; contract drafting uses `e.features.random()`.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| contracts.convoys | 81 | Form or join a convoy at a port; ships of any company leaving for the same port within 3 h sail protected. Convoy log, Convoy Commodore title |
| contracts.black-flag | 83 | Opt-in pirate role (24 h between changes): hideouts, false signals, parley; heat on each lawful docking |
| contracts.wanted | 85 | 0-5 stars from police notoriety plus heat (heat cools 0.5/h); most-wanted list; notices when stars change |
| contracts.patrols | 86 | Public patrol loops and police boat positions; report one visible pirate ship a day (+5 heat to its owner) |
| contracts.inspections | 87 | Chance of a customs search on docking (8% + 6%/star, +30% at an inspector's port, never at hideouts); seizes smuggled crates |
| contracts.hideouts | 89 | Three lawless remote ports: no customs, black-flag heat cools 3x, tavern rumours |
| contracts.pirate-boss | 90 | Boss flagship sails every fifth day for 48 h; hunters within range join; odds by hunters and guns; Boss Breaker title |
| contracts.fake-distress | 91 | Maydays every 12 h, 40% are traps (ship exposed 24 h); real ones give reputation and the Lifesaver title; black-flag captains can send false ones |
| contracts.coast-guard | 92 | Three stations; a docked, empty ship whose company can't afford the cheapest hop is "stranded" and can call for help (every 72 h) |
| contracts.pardon | 94 | Flag down 72 h, 3 honest cargo arrivals, heat under 10: notoriety and heat wiped, Pardoned title |
| contracts.blockade | 95 | Weekly 36 h blockade of one port; every arrival there is searched |
| contracts.guild / syndicate / navy / tribes | 302-305 | Faction standing (-100..100) with ranks; guild weekly charter, syndicate respects and tips, navy patrol duty and ambush cover, tribal gifts and titles |
| contracts.wandering-trader | 306 | Moves port daily; a curio (12 to collect) and a market whisper per visit |
| contracts.ghost-ship | 307 | Some nights before dawn; hail it for lanterns, Ghost Whisperer at 5 |
| contracts.npc-traffic | 308-310 | Ferries, fishing fleets and a cruise liner on the map; fishermen tell where pirates were seen |
| contracts.old-captain | 311 | Five errands from an NPC who moves weekly; The Old Captain's Heir title |
| contracts.rival-ai | 312 | Captain Vex finds your most-sailed route and races you there, getting faster each time you beat him |
| contracts.named-pirates | 313 | Five pirates with personalities roam lanes; lookouts warn you; black-flag captains can parley |
| contracts.legends | 314 | Three legends' challenges (25 voyages, 12 ports, 1,000 t); hall of legends |
| contracts.mayors | 315 | Each port's mayor wishes for a good each week; favour and the Freedom of the port |
| contracts.journalists | 316 | Three reporters write up sea news; one interview a day in a chosen tone |
| contracts.inspectors | 317 | Two inspectors move daily (today and tomorrow shown); they raise inspection odds where they stand |
| contracts.mechanics | 318 | Mechanics at 3 ports a day; a checkup gives a week's Serviced badge and a report |
| contracts.stranger | 320 | Appears for 72 h at a time with five riddles, one answer per appearance; the Stranger's Token |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| contracts.timed | 61 | 3 jobs at 130% of cargo value with a deadline |
| contracts.rush | 62 | 2 tight-deadline jobs at 180% |
| contracts.milk-run | 63 | One good dropped at 2-3 ports in order, paid per stop at 135% |
| contracts.community | 64 | 400 t shared order every 3 days, 120% per tonne + 15% completion bonus split by tonnes |
| contracts.relief | 65 | 150 t of grain or fuel within 36 h, 160% per tonne |
| contracts.government | 66 | 150% jobs; licence = reputation 3 and no wanted stars |
| contracts.exclusive | 67 | 200% job for reputation 8+ |
| contracts.story | 68 | Three four-chapter story chains (140-170%), title at the end |
| contracts.board | 69 | 5 easy jobs a day at 115%, replaced each morning |
| contracts.late-penalty | 70 | Late delivery allowed for 48 h at -10% per 6 h (floor 30%); undelivered = 10% penalty |
| contracts.passengers | 73 | Passenger fares paid on arrival (no hold space) |
| contracts.auctions | 75 | Reverse auction every 12 h; lowest bid (50-100% of the top price) wins |
| contracts.escort | 71 | Paid to sail alongside a merchant between two ports |
| contracts.smuggling | 72 | Crate carried without hold space; high pay, +6 heat, seized by inspections |
| contracts.salvage | 74 | Paid for sailing a wreck's lane |
| contracts.pirate-zones | 76 | Three zones that move daily; lanes through one take 10% longer |
| contracts.ambush | 77 | Once per voyage in a zone: 3%/h x cargo value factor (0.3-2) x protection; a lost fight costs 30% of the cargo |
| contracts.ransom | 78 | A stopped ship is frozen until it pays 20% of cargo value + 50, or fights (lose = 50% of cargo); auto-fight after 6 h |
| contracts.cargo-insurance | 79 | 4% premium for the next voyage; pays 80% of losses |
| contracts.escort-hire | 80 | 120 + 2% of cargo value; ambush odds x0.3 for one voyage |
| contracts.deck-guns | 82 | 400/800/1,200 per level; -15% ambush odds and +15% to fight off per level |
| contracts.bounties | 84 | 400-800 for named pirates, one try a day from a ship in range |
| contracts.news-ledger | 93 | Ambush, cargo-loss, ransom and bounty tallies plus sea news (assignment marked it economy: it publishes cargo values) |
| contracts.bribes | 88 | 100 + 100/star for 48 h without inspections; 20% refuse (+10 heat, no money taken) |
| contracts.coast-guard-effects | 92 | Coast-guard call also pays just enough for fuel to the cheapest neighbour |
| contracts.rival-companies | 301 | Three NPC lines move up to 20 t of market stock from producers to consumers |
| contracts.mechanics-effects | 318 | Checkups cost 80; serviced ships cost 10% less upkeep |
| contracts.travelling-merchants | 319 | Two merchants a day sell 60 t each at 85% of the local price |

## Decisions
- **Assignment said ON, but money moves:** the coast guard (92) and mechanics (318) are split like ships: the content
  module is on (stations, stranded check and call log; mechanic schedule, checkup and badge), and the money part is a
  separate `-effects` module that is off.
- **Convoys (81) are on:** they only lower ambush odds, and ambushes are off until approved, so with the defaults a
  convoy is a social/log feature. Faction standing, wanted heat and titles are on: they never move money by themselves.
- **Pardons (94) reset police notoriety.** That changes how hard the existing police come down on a pirate, but it is
  earned by playing straight and creates no money, so it ships on.
- **Inspections (87) and blockades (95) only seize smuggled crates** (which exist only while smuggling is on) and add
  heat. Neither delays ships nor fines, so both stay on.
- **Ransom holds** freeze a ship by moving its depart and arrive ticks forward one hour per hour held. This is a time
  effect, which is why `contracts.ransom` is economy.
- **Wanted heat** is stored with the tick it was set and read decayed, so no module has to be on for it to cool.
- Cross-module effects only apply while both modules are on (e.g. inspectors raise inspection odds only with
  `contracts.inspectors` on; navy standing lowers ambush odds only with `contracts.navy` on).
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
