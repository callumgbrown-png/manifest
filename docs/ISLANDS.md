# Procedural coastlines

For new worlds, see [NAVIGATION.md](NAVIGATION.md): larger server-generated
landmasses and A* lanes replace the earlier cosmetic island algorithm.
The implementation described below remains only for legacy-season rendering.

Existing port coordinates, lane distances and game rules are unchanged.
Each port receives a normalized `coastDirection` pointing inland. Automatic
directions prefer gaps between shipping lanes and account for nearby lanes
between other ports. Optional `coastDirection: { dx, dy }` entries in map.json
override automatic directions. SQLite `port_coasts(port_id, dx, dy)` overrides
take priority; restart the server after editing map/coast configuration.

`server/src/coasts.ts` creates cosmetic metadata independently of event replay.
`server/public/island-layer.js` creates seeded noisy distance fields, blends
islands, protects each harbour's coastline, and clears water along sea routes.
The browser rasterizes terrain once at two world units per pixel into an
offscreen canvas. Live ticks and prices do not invalidate it. Map geometry or
seed changes rebuild the terrain. Zoom/pan only recomposite this canvas into
the existing background cache. The animation loop still draws that cached
background with one drawImage call.

Rendering may create narrow channels where existing routes cross land.
Terrain is decorative; navigation still uses the authoritative sea-lane graph.
The first connection performs terrain generation on the main browser thread;
much larger worlds should move generation to a worker.

Verified: TypeScript build; all 105 automated tests including coastline checks
for all 40 ports, route centreline clearance, deterministic metadata, and cache
invalidation; browser login and zoom checks. The tested worlds use isolated
databases, which are not included in the deliverable.

Run locally: open server/start.bat. Node.js 22.13 or newer is required.
