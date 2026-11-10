// Start a NEW world on a fixed map (ideas 416, 417 and shared maps from the map gallery, 418, 419).
//
//   node --experimental-transform-types scripts/use-map.ts ../config/maps/arctic.json [data/manifest.db]
//
// Run it before the first start of a fresh database (or after moving the old one away): it stores the map as the
// world map, which main.ts then loads instead of generating a random archipelago. It refuses to touch a database
// that already has events, so a running world can never be switched to another map by accident.
// A map downloaded from the gallery works too (ids are added if missing). Then set the matching world preset in
// config/rules.json, e.g. { "progression": { "worldPreset": "arctic" } }, for the palette.
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { addCoasts } from "../src/coasts.js";

interface InMap { seed?: number; name?: string; ports: { id?: number; name: string; x: number; y: number; produces: string[]; consumes: string[] }[]; routes: { a: number; b: number; distance: number }[] }

/** The stored form: ids, coast directions and the legacy navigation id (routes are drawn as straight lanes). */
export function prepareMap(m: InMap) {
  const ports = m.ports.map((p, i) => ({ ...p, id: i }));
  return { seed: m.seed ?? 1, ports: addCoasts(ports, m.routes), routes: m.routes, navigationId: "legacy-v1" };
}

async function main() {
  const [file, dbPath = "data/manifest.db"] = process.argv.slice(2);
  if (!file) { console.error("usage: use-map.ts <map.json> [database]"); process.exit(1); }
  const map = prepareMap(JSON.parse(readFileSync(file, "utf8")));
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS world_map (id INTEGER PRIMARY KEY CHECK(id=1), map_json TEXT NOT NULL)");
  const hasEvents = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get()
    && (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n > 0);
  if (hasEvents) { console.error("this database already has a world; move it away first"); process.exit(1); }
  db.prepare("INSERT OR REPLACE INTO world_map(id,map_json) VALUES(1,?)").run(JSON.stringify(map));
  console.log(`stored ${map.ports.length} ports and ${map.routes.length} routes in ${dbPath}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("use-map.ts")) await main();
