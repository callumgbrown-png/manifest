# Combined version

Branch `combined-recovery-economy-pirates` = `pirates-police` + the two features from the other copy of the game
(Codex, 6 November): **cash recovery guidance** (`docs/RECOVERY-IMPLEMENTATION.md`) and **voyage cost breakdown, market
outlook, watched ports and the ore-to-machinery chain** (`docs/ECONOMY-INSIGHTS.md`). Both came as patches
(`docs/evidence/*.patch`), applied in that order on the shared baseline.

Where the versions overlapped:
* **Ore and machinery roles.** This branch's generator fix (10 ore and 6 machinery ports) and the other copy's explicit chain
  (4 mines, 4 factories, 2 ore make 1 machinery, persisted as `industry`) did the same job. The chain wins in live seasons:
  `generateRandomSeason` clears the generator's roles before applying it, and `validateMap` skips the 10/6 count check when a
  season carries a chain. Unchained maps (config/map.json, old logs) are unchanged.
* **`privateView` / `publicView`** now carry both sets of fields (pirates: `notoriety`, `notices`, `police`; recovery: `recovery`;
  economy: `outlook`).
* **Existing browser test** `client.e2e.ts` now accepts the recovery feature's new "You are short of N cash:" prefix in
  refusal messages, and its tap helper reads live port coordinates.

Tests: 204 unit, 26 browser, all passing. Economy-affecting changes (pirates, the chain, the ore/machinery roles) still need
your approval before anything goes to main.
