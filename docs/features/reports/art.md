# Art category report (ideas 161-172, 441-480)

All 52 ideas are built as 16 modules in `server/src/features/art/`, with the drawing, sound and story panel in
`server/public/features/art.js`. Tested in `server/test/features-art.test.ts` (18 tests, including a full replay of every
module together). No shared core files were edited. Original writing is in `config/content/art/*.json`.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| art.scene | 161, 162, 164, 165, 170, 442, 446-454, 456-458 | Shared clock, season and cosmetic squalls. Client draws wakes, day/night tint, harbour and ship lights, rain, lightning, gulls, fish, whales, dolphins, funnel smoke, pirate flags, police lights, water sparkle and reflections, snow and seasonal looks; keys 1-5 jump between five zoom levels |
| art.portlife | 163, 444, 445, 459, 460 | Counts dockings: busy ports swing cranes, container stacks vary, ports grow through three stages, each island gets a biome |
| art.flags | 171 | Country-style house flag per company (8 patterns, 12 colours, no free text); flown at home and on ships |
| art.combat | 441, 443, 455 | Ships hit by raids smoke for 24 h; captures explode; lost ships go down with a sinking ripple |
| art.music | 167, 461, 462, 463, 469 | Synthesised chiptune: one theme per island biome, a storm theme when your ship is in a squall, a pirate theme for pirate owners, a shanty when 3+ of your ships are under way |
| art.sound | 166, 168, 169, 464, 465, 466, 470 | Sea swell, UI clicks, ship horns on arrivals and departures, police sirens, crane clanks, gull calls by day and crickets by night |
| art.news | 172, 475 | Harbour Gazette: a headline every six-hour watch (price spikes and crashes, new leader, raids, busiest harbour, quiet days), each with a pixel-art illustration |
| art.lore | 471, 472 | Five-chapter founding story; each island's lore page opens the first time you dock there |
| art.relics | 473 | Twelve collectable relics, plus messages in bottles, turned up by docking |
| art.diary | 474 | Captain's diary written from your departures and arrivals, with a line for quiet days |
| art.chatter | 467, 468 | Harbour radio chatter for everyone; each of your captains barks a line about what the ship is doing |
| art.mystery | 476 | "The Marigold's Missing Cargo": five chapters, each sending you to a port; ends with a title |
| art.rivals | 477 | A running story about the company just above you on net worth (or, for the leader, just below) |
| art.legend | 478 | Collect three chart pieces, then be docked where the Lantern Queen is sighted; ends with a title |
| art.eggs | 479 | Shout words into the fog (letters and spaces, 30 max); seven hidden answers |
| art.cameo | 480 | MV Placeholder, a developer cameo ship that wanders the lanes saying silly things (cosmetic, not a real ship) |

## Switched off until Dave approves (economy)
None. Every art idea is cosmetic or story; quest rewards are titles, never money.

## Decisions
- **Sound is synthesised** with Web Audio (no sound files to license or host). It stays silent until the player ticks
  "Sound on" in the Sea stories panel, because browsers block audio before a click; choices are kept in `localStorage`.
- **Squalls are cosmetic only.** If storms should ever slow ships, that would be a separate economy module (off).
- **Zoom levels (170):** the camera's 1x-5x limit lives in `app.js`; rather than edit it, art adds five preset levels on keys 1-5.
- **Easter-egg shouts** use a small form in the Sea stories panel, because Opportunities cards only take numbers and lists.
- **Sinking** is shown at the ship's last known port: the watcher sees a ship disappear but not where it was on the lane.
- The art ship watcher now also notices departures by ships bought since its last look (fix in `art/shared.ts`).
- The client was smoke-tested in headless Chromium against real module data (no errors), not in the full game page.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
