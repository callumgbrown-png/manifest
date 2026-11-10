# Progression content and data mods (idea 420)

All progression content lives in JSON under `config/content/progression/`:

| File | What it holds |
| --- | --- |
| `achievements.json` | Achievements, account milestones (`kind: "milestone"`), long-term goals (`kind: "goal"`), secret achievements (`secret: true`) and the pennant skins they unlock |
| `titles.json` | Earnable titles; playstyle titles use `per` and `min` (a ratio) |
| `quests.json` | Daily quest and weekly goal templates (`{n}` is replaced by the target) |
| `puzzles.json` | Scenario puzzles (timed), training missions (untimed) and the tutorial chain |
| `ranks.json` | Rank names by captain level, seasonal-ladder tiers and the free season track |
| `tech.json` | Tech tree nodes, licences and (economy-only) effects |
| `modes.json` | Challenge runs, co-op campaign chapters, world presets and their themes |

## Writing a mod

Drop a JSON file in `config/content/progression/mods/` (names starting with `_` are ignored; see `_example.json`)
and restart the server. A mod may add entries to any list: `achievements`, `skins`, `titles`, `daily`, `weekly`,
`puzzles`, `tutorial`, `nodes`, `challenges`, `campaign`, `presets`. It cannot replace an entry (duplicate ids are
skipped) and cannot change ranks, ladder tiers or the season track. Entries with unsafe ids (only `a-z`, `0-9`, `-`),
names over 60 characters, `<` or `>` in names, or out-of-range numbers are skipped with a console warning.

Mods are read once at start-up. Add them before a world starts: changing content mid-season changes what replaying
the event log produces.

## Stats a condition can use

`deliveries`, `voyages`, `emptyRuns`, `losses`, `shortVoyages`, `profit`, `bestTrip`, `distance`, `cargo`,
`hoursAtSea`, `peakShips`, `peakWorth`, `portsVisited`, `goodsDelivered`, `level`, `xp`, and per good
`goodUnits.<good>` / `goodDeliveries.<good>` for `grain`, `fuel`, `ore`, `machinery`.

A condition is `{ "stat": "deliveries", "atLeast": 10 }`, or a ratio
`{ "stat": "goodDeliveries.grain", "per": "deliveries", "atLeast": 0.5, "min": 10 }`.

## Example

```json
{
  "id": "harbour-pack",
  "achievements": [
    { "id": "hp-ore-1k", "name": "Ore Tycoon", "description": "Deliver 1,000 ore.", "kind": "achievement",
      "stat": "goodUnits.ore", "atLeast": 1000, "xp": 60, "skin": "silver" }
  ],
  "puzzles": [
    { "id": "hp-ore-sprint", "kind": "puzzle", "name": "Ore Sprint", "text": "Deliver 300 ore within 24 hours.",
      "hours": 24, "trip": { "good": "ore", "minQty": 300 }, "xp": 120 }
  ]
}
```
