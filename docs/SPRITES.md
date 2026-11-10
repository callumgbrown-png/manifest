# Port icons, resource sprites and the police boat

The map draws every port as a pixel-art icon (`server/public/port-sprites.js`). A port that produces goods
shows one small production sprite per good directly to the right of the icon (grain = wheat field,
fuel = oil pumpjack, ore = mine headframe, machinery = factory). Ports that produce nothing show the icon alone.
If the sprite files fail to load, the map falls back to the old coloured shapes.

## Adjusting it (all in `server/public/port-sprites.js`)
| What | Where |
| --- | --- |
| Asset paths | `SPRITES` (`src` = atlas PNG, `json` = TexturePacker file). Files live in `server/public/img/sprites/buildings/` |
| Port icon size | `LAYOUT.portWidth` (map units), clamped by `minPx` / `maxPx` on screen |
| Gap between port and resource | `LAYOUT.gapRatio` (x port width); `resourceGapRatio` between several resources |
| Resource size | `LAYOUT.scaleRatio` (fraction of the port icon's height) |
| Vertical nudge | `LAYOUT.yOffsetRatio` |
| View rotation | `LAYOUT.direction` (atlas column 0-7) |
| Another resource | add a `SPRITES` entry named after the good |

Everything is a ratio of the port icon, so zoom and screen size cannot misalign the resource sprites.
Labels, the green docked ring, the home flag and click/hover hit-testing all use the icon + resources group.

## Police boat
`server/public/ship-views.js` draws police patrols from `img/sprites/ships/police_boat/` (8 headings,
77x67 cells, atlas columns N, NE, E, SE, S, SW, W, NW). Change the on-map size with `SPRITE_SCALE.police` in `app.js`
or `HULL_PX` in `ship-views.js`. If the files fail to load, the old vector boat is used.
`assets/police_boat_source/` holds the individual frames and atlas for editing.

## Harbour layout (`server/public/harbours.js`)
Each port's quay is anchored to the coast beside its berth, facing open water, and its industry is placed on land from the
season's terrain mask (base 100% on land, body at least 80%, clear of quays and other buildings). If no clear spot is
found the good still shows as a compact badge beside the port label. To nudge one port by hand, add it to `OVERRIDES`
(`{ dockShift: [dx, dy], industry: { good: [x, y] } }`, world units).

## Port atlas cleaning
The baked blue water squares were removed from `img/sprites/buildings/port_atlas.png` with `tools/clean_port_water.py`
(original kept in `assets/port_source_original/`).

## Pirate speedboat
`img/sprites/ships/pirate_speedboat/` is an 8-heading sheet (N, NE, E, SE, S, SW, W, NW) drawn through `ship-views.js`
with a shared cell-centre pivot and nearest-neighbour scaling. It is sold from the Fleet tab shipyard at the pirate
home port only; price, hold and speed come from `config/rules.json`.
