# Verified random seasons

Fresh games and the admin's new-season action now generate a new terrain layout
and 40 randomly placed ports. A restart reuses the saved snapshot and does not
generate another map. Existing fixed-map seasons remain unchanged until their
normal season transition. Accounts survive season changes, and previous maps
and event logs are archived together.

## Acceptance gates

`server/src/map-generation-pipeline.ts` creates deterministic candidates from
string/numeric seeds. Low-frequency terrain uses 420/190/80 world-unit noise
scales. The default grid is 1000x700 with 4-unit cells and an open-ocean rim.
Port centres must occupy SHALLOW_COAST water tiles bordering cardinal LAND
tiles. Their coast vectors point into the actual neighbouring land.

An independent validator checks all 40 ports are in the same main boundary-ocean
component, rejects isolated lakes, checks all pairs for minimum separation
(56 world units by default), checks IDs/coordinates, and requires at least
14 grain and 14 fuel producers. Generation assigns 16 of each plus 8 consumer
ports. Producers consume the opposite commodity. Failed maps are discarded,
not repaired by altering the validated terrain. Retries are bounded by attempt
and elapsed-time limits; I/O is allowed between failed attempts.

`server/src/random-season.ts` converts this exact terrain into the A* grid.
It creates a spatial minimum spanning tree plus near-neighbour edges, computes
water paths, and simplifies only segments passing supercover collision tests.
A second validator verifies the final serialized terrain, waypoint endpoints,
forward/reverse water clearance, distances and complete graph connectivity.
Only then can main.ts write or activate the season snapshot in SQLite.

## Persistence and failure handling

The active `world_map` snapshot includes the accepted seed, generator version,
original tile classifications, port positions/roles, water raster and routes.
Previous snapshots go to `archived_maps` in the same transaction as the season
results and archived events. Concurrent new-season requests are guarded.
If generation or validation fails, the endpoint returns 503 and leaves the
current map, accounts, sessions and archives intact. No live season is reset
merely by installing this update.

The server sends map/seed metadata and terrain/waypoints once per connection
and at season changes. The client discards old geometry caches and old voyage
form choices when the map changes. Rendering, estimates, ship movement and
headings all follow the authoritative routes.

## Configuration and running

Extract the ZIP and open `server/start.bat`. Leave MAP_SEED unset for fresh
random season seeds. Optional environment variables:

- `MAP_SEED`: a reproducible sequence, derived as `<value>:season:<number>`.
  The accepted candidate may have a deterministic retry suffix.
- `MAP_MIN_PORT_DISTANCE`: default 56 world units; impossible settings fail
  validation rather than silently reducing the separation.
- `MAP_MAX_ATTEMPTS`: default 128. There is also a 10-second candidate budget.

Accepted seeds are stored in SQLite, included in static map metadata and logged
at startup. The complete snapshot remains authoritative across future code
changes. The original map.json now supplies the legacy map and fictional port
name pool, not the layout or trade graph for new seasons. Old per-port coastal
overrides apply to legacy maps; new coasts are derived from actual terrain.

## Verification and limits

All 122 automated tests passed. Coverage includes 20 varied terrain seeds,
10 complete random route graphs, impossible settings, malformed maps, isolated
harbours, resource shortages, overlapping ports, bad paths, exact restart replay,
new-season changes, account carryover and failure preservation. Build and browser
checks passed. Terrain checks are structural; they do not prove long-term
economic balance or guarantee a profitable trade at every port. The old Python
simulator still uses fixed map.json geometry and must be updated before using
it to validate random-season economy balance. Generation runs synchronously
within each attempt; a worker is appropriate for much larger maps or stricter
production latency limits.
