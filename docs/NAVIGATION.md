# Larger landmasses and water navigation

New seasons now randomize terrain AND port placement through the independent
validation pipeline. See [RANDOM_SEASONS.md](RANDOM_SEASONS.md) for current
behaviour. The fixed-coordinate generator described below remains a legacy
prototype/test fixture; its A* and geometry checks are shared with the new system.

Run `server/start.bat` after extracting the game. Fresh databases use the new
terrain immediately. Existing seasons keep their original map and distances;
use the admin page's normal new-season action to switch at a season boundary.
No running season is automatically reset or migrated onto different routes.

## Generation

`server/src/navigation.ts` generates authoritative terrain at 4 world units
per cell. Seeded noise at scales 420/190/80 replaces the port-circle terrain
for new seasons. Local coastal constraints retain all existing port positions.
The default seed produces five substantial landmasses plus smaller islands,
with about 20% land coverage. Landlocked harbour pockets get least-cost narrow
connections to the ocean, rather than cutting a straight channel for every lane.

A* uses eight neighbours, a minimum heap and Euclidean heuristic. Diagonal
corner cutting is forbidden. Supercover line-of-sight checks simplify paths
without cutting through land. The default map has 75 lanes; 56 need waypoints
around land. Distances are measured from the final polylines and used by the
engine for shortest journeys, sailing time, fuel, bots and client estimates.

## Persistence and networking

SQLite `world_map` stores the active ports, seed, terrain and waypoints as one
snapshot. `archived_maps` stores previous maps alongside archived season logs.
Legacy event logs retain their previous map on first upgrade. New-season map
replacement is transactional. Restart replays against the saved snapshot even
if the generator changes later. Map/config changes take effect next season.

The static WebSocket message sends terrain, waypoint routes and exact distance
matrices once on connection and again at a season change. Normal tick updates
carry the map ID and compact route distances, not the terrain raster.

## Rendering

`server/public/navigation-layer.js` renders the server's raster to a static
offscreen canvas. Rounded polyline joins keep routes readable without unsafe
Bezier curves crossing shorelines. Route highlights, previews, travel-time
labels, ship positions and sprite headings use the same waypoint geometry.
Voyage polylines and segment lengths are cached; the main animation loop does
not run A*, rebuild terrain or recompute segment lengths. Zoom/pan reuse the
terrain raster through the existing background cache.

## Verification and limits

All 111 tests passed, including route safety in both directions, disconnected
corner cases, deterministic generation, client movement through every route,
authoritative voyage times, snapshot restart and legacy-season upgrade.
Build, browser voyage/route-preview and zoom checks passed. Tests validate ship
centre lines on the navigation grid; map icons are illustrations and may extend
past the centre line in narrow harbour entrances. Larger maps should move
generation into a worker or offline build step. Economy balance has not been
retuned for longer voyages; the older Python simulator still uses map.json's
original straight-link distances and should not validate this new economy.
