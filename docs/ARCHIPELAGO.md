# Archipelago world (4x map, 5 land masses + 3 islands)

New seasons are generated as an archipelago instead of continents. Existing worlds keep the map they started with
until a new season begins (README: "Existing seasons retain their old map").

## What changed
| | Before | Now |
| --- | --- | --- |
| World size | 1000 x 700 | **2000 x 1400** (exactly 4x the area) |
| Land | noise-made continents | **5 small land masses + 3 isolated islands**, shaped by `server/src/archipelago.ts` |
| Ports | 40 | 40: land masses 6-8 each, islands 2 + 2 + 1 |
| Min distance between ports | 56 | 112 (the same 56 in economy units) |

## Economy is untouched
`config/rules.json` is not edited. Every sea lane's `distance` is its sailed length **divided by `worldScale` (2)**,
so fuel use, sailing hours, port fees, taxes and upkeep come out exactly as they did on the 1000 x 700 map.
Pirate range, home safe radius and police catch range are measured the same way (`Geo.dist`).
Typical lane distances in this world are about 60-290, the same range as the old one.
Worlds without a `worldScale` (older saves) behave exactly as before.

## Tuning (`server/src/archipelago.ts`, `map-generation-pipeline.ts`)
- `DEFAULTS` in the pipeline: `width`, `height`, `landmasses` (5), `islands` (3), `worldScale` (2), `minPortDistance` (112).
- `MASS_RADIUS`, `ISLAND_RADIUS`, `EDGE_MARGIN`: sizes and the empty rim. `islandPortQuota`: harbours per island.
- Generator rejects any layout that doesn't have exactly 8 land bodies, a harbour on each, and islands clearly smaller than masses, then tries the next seed automatically.
- `MAP_SEED=anything` makes a world repeatable. `MAP_MIN_PORT_DISTANCE=n` overrides the spacing.
- Ports keep the sprite layout from `docs/SPRITES.md`: every port draws its icon, and a producing port draws its resource sprite directly to its right. The client scales icon size with the world so they look the same size on screen as before.

`docs/archipelago-example.json` is a real generated example (bodies, ports in the `{id, name, position, producesResource, resourceType}` shape, and sample lanes showing `mapLength` vs `economyDistance`).
