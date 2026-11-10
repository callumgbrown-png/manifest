# UI category report (ideas 146-160, 421-440, 481-500)

All 55 ideas are built as 39 modules: 20 server modules in `server/src/features/ui/` and 19 client-only switches whose
code is in `server/public/features/ui.js`. Tested in `server/test/features-ui.test.ts` (23 tests, including a full replay
of every module together and a check that every client switch is used by `ui.js`). The page was also checked in a real
browser with every module switched on: every window opens, the tutorial's "Do it" button sails the ship, and there are no
script errors. No shared core files were edited.

## Switched on
| Module | Ideas | What it does |
| --- | --- | --- |
| ui.planner | 146, 147 | Best three voyages per docked ship, quoted with the server's own voyage maths; a calculator window asks the server for a live quote on any ship, port, good and tonnage |
| ui.repeat-route | 424 | "↻ Repeat to X" on each ship card sails the ship's last voyage from this port again (normal costs) |
| ui.auto-trade | 149 | A 2-3 leg round trip on the voyage queue that re-queues itself up to 20 times |
| ui.alerts | 426 | Up to 10 alerts per player ("grain at Ardgate below 20"); a toast appears when one goes off |
| ui.ledger | 157, 436 | Profit and loss: every finished trip, daily upkeep and forced sale; CSV export in the browser |
| ui.idle-ships | 433 | Hours each ship has sat docked and empty; shown in the fleet table and dashboard |
| ui.daily-summary | 435 | Popup at the start of each game day: deliveries, cash and net worth change |
| ui.undo | 487 | Undo for alerts, watchlist, dashboard and auto-trade stops. Trades, voyages and purchases are never undoable |
| ui.starter-bonus | 483 | Finishing the first profitable delivery earns a Founder's pennant flown beside your ships (no money; see below) |
| ui.cargo-manifest | 155 | Every hold: cargo, fill, what it cost, what it fetches here and at the best port |
| ui.watchlist | 427 | Up to 12 port/good prices with the change over the last game day and a sparkline |
| ui.dashboard | 421 | Pick and order up to 10 widgets; the layout is kept on the server so it follows you to any device |
| ui.tutorial | 481, 482 | Five steps that tick off from what you really do; until the first delivery it names one concrete, affordable voyage with a "Do it" button |
| ui.presets | 486 | Guided / standard / expert help level for your own screen (hints, planner, confirmations, tutorial). Prices untouched |
| ui.hints | 499 | Up to three hints from your situation; "tell me more" makes one a little more specific but never names a route |
| ui.minimap | 150 | Corner minimap with ports, your ships and the view box; click to jump |
| ui.themes | 152, 440, 496 | Harbour (dark, default), light, midnight, parchment, tropical and high-contrast themes; standard, vivid and pastel goods colours |
| ui.shortcuts | 154 | 1-5 tabs, +/-/0 zoom, f fleet, / find port, d r c t l w o windows, h heatmap, m minimap, p photo, u undo, g wiki, ? list |
| ui.heatmap | 156 | Cycle a good to see every port glow blue (cheap) to red (dear) |
| ui.tooltips | 158 | Port tooltips add where each good sells higher, price trends, watched goods and your ships heading there; glossary words get tooltips |
| ui.colour-blind | 159 | Deuteranopia, protanopia and tritanopia palettes (goods already differ by shape too) |
| ui.languages | 160, 495 | English, Spanish, French, German, Portuguese, Irish; community packs loaded from `public/features/lang/<code>.json` (Dutch included as the example) |
| ui.windows | 422 | Every ui window can be dragged; positions are remembered per browser |
| ui.fleet-table | 428, 431, 432, 434 | Fleet overview table, click-to-sort columns, cargo and status filters, hold fill bars (also on ship cards) |
| ui.map-nav | 429, 430 | Find a port by name; zoom the map to frame your whole fleet |
| ui.capture | 437, 438, 439 | Screenshot to PNG, photo mode (hides the interface, adds a vignette), streamer mode (company names become "Company 3", yours "You") |
| ui.wiki | 484, 500 | Searchable glossary and short wiki articles; the tax rate is read from the live rules |
| ui.tips | 485 | A tip on the loading screen and while reconnecting |
| ui.accessibility | 488, 489, 490 | Text size 90-150%, reduced motion, screen reader labels for the map and unlabelled controls, spoken cash and alert changes |
| ui.input | 491, 492 | Gamepad (stick pans, triggers zoom, d-pad moves focus, A presses, B closes, bumpers switch tabs); touch: larger targets, double-tap zoom, swipe the panel to change tab |
| ui.pwa | 493 | Web app manifest, icon and a network-first service worker so the app can be installed and still opens when the connection drops |
| ui.low-spec | 494 | About 20 frames a second, 1x pixel density, no shadows |
| ui.calm | 497, 498 | Calm mode hides the leaderboard, cash flashes and daily popups; optional break reminders every 30-120 real minutes |

## Switched off until Dave approves (economy)
| Module | Ideas | Why it is off |
| --- | --- | --- |
| ui.saved-routes | 148 | Assignment marks it economy. Save up to 8 routes and run one on any ship docked at the start |
| ui.notifications | 151 | Assignment marks it economy. Notification centre: dockings, order fills, forced sales, paused queues |
| ui.mobile | 153 | Assignment marks it economy. Phone layout: the side panel becomes a bottom sheet (double-tap the tabs to fold it) |
| ui.quick-sell | 423 | Sells every docked hold at market price in one click |
| ui.best-trade | 425 | Names the single best trade across your docked ships: an edge over players who work it out |
| ui.starter-bonus-effects | 483 | Pays a one-time 500 cash with the Founder's pennant |

## Decisions
- **Starter bonus (483) was assigned ON but gives money**, so it is split like ships: `ui.starter-bonus` (on) awards the
  pennant, and `ui.starter-bonus-effects` (off) adds the 500 cash. A player who claims while the effect is off gets no cash
  later; that keeps replays simple.
- **Notifications (151) and mobile controls (153) are marked economy in the assignment** although they change no prices or
  money. They ship off as assigned; Dave or Callum can switch them on in `config/features/ui.json` with no risk to the economy.
- **Difficulty presets (486)** change only how much help the player's screen gives. The world's difficulty (admin
  `setDifficulty`) and every price stay the same for everyone, so it is on.
- **Undo (487)** only reverses ui bookkeeping. Undoing trades would let players keep the lucky ones and take back the rest.
- **Nested commands**: modules that sail or sell for the player call `engine.apply` (with the same voyage-queue check
  `applyLive` makes) so the event log keeps just the feature command and a replay repeats it exactly once.
- **Client settings** (theme, language, text size, window positions...) live in `localStorage` inside try/catch, as the
  module rules say. The service worker never caches `/ws` or `/api`, so the live game always comes from the server.
- `manifest.webmanifest` is served as `application/octet-stream` because `main.ts` has no MIME type for it; browsers accept
  it. Adding `".webmanifest": "application/manifest+json"` to `TYPES` in `main.ts` would be tidier but touches a core file.
- Four existing test files need the `ws` package and could not be run in the cloud session without it; run `npm test` locally.
- Translator call-out and pack instructions: `docs/community/language-packs.md`.
