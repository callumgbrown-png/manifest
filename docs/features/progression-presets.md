# World presets, settings and fixed maps (ideas 401, 407, 408, 409, 413-417)

A world preset is chosen in `config/rules.json` before a world starts:

```json
{ "progression": { "worldPreset": "steamship" } }
```

The `progression.world-presets` module then sends the preset's palette and names to every client (the map is
re-tinted and ship/good names in the side panel are swapped). Presets never change game rules by themselves: where a
preset needs a server setting, its card lists the setting to change, so the operator stays in control.

| Preset | id | What to set |
| --- | --- | --- |
| Classic | `classic` | Nothing |
| Offline single-player | `solo` | Run on your own computer: `HOST=127.0.0.1 BOTS=12 TICK_MS=60000 npm run dev`, open http://127.0.0.1:8080. Nothing leaves your machine. |
| Cosy seas (no pirates) | `cosy` | `"pirates": { "enabled": false }` in rules.json |
| Pirate waters | `pirate-only` | `"pirates": { "enabled": true, "bot_share": 0.5, "buy_at_home_only": false }` |
| Tycoon sandbox | `tycoon` | Players pick the Tycoon run mode; the funds need the `progression.sandbox-funds` economy switch |
| Steamship era | `steamship` | Nothing (sepia palette, paddle steamers, coal) |
| Orbital freight | `futuristic` | Nothing (night palette, shuttles, deuterium) |
| Sea of Legends | `fantasy` | Nothing (storybook palette, cogs and galleons) |
| Arctic map | `arctic` | Load `config/maps/arctic.json` (below) |
| Mediterranean map | `mediterranean` | Load `config/maps/mediterranean.json` (below) |

## Fixed maps

`main.ts` normally generates a random archipelago for each new season. To start a fresh world on a fixed map
(the Arctic or Mediterranean map, or any map downloaded from the in-game map gallery):

```sh
cd server
node --experimental-transform-types scripts/use-map.ts ../config/maps/arctic.json data/manifest.db
npm run dev
```

The script refuses to touch a database that already has a world. The map is used for the first season; later
seasons are random again unless you run the script on a fresh database.

## Map editor and sharing (418, 419)

The ✎ button on the chart opens the map editor (when `progression.map-sharing` is on). Draw ports and routes,
download the map as JSON, or share it to the world's gallery (3 per company, 60 in total), where other captains can
rate and download it. Maps are checked on the server: 4-60 ports, safe names, every port reachable, every good with a
producer and a consumer.
