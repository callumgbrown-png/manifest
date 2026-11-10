// Shared by the platform tools: open a save (the server's SQLite file) and replay its event log into an engine.
// Run the tools from server/ with: npx tsx ../tools/platform/<tool>.ts [options]
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Engine, type Command } from "../../server/src/engine.ts";

export const ROOT = new URL("../../", import.meta.url);
export const defaultDb = () => process.env.DB_PATH ?? new URL("data/manifest.db", ROOT).pathname;

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function openSave(path = defaultDb(), readOnly = true) {
  if (!existsSync(path)) throw new Error(`no save at ${path} (set --db or DB_PATH)`);
  return new DatabaseSync(path, { readOnly });
}

/** Replays a save's event log; stops after `untilTick` hours if given. Calls `onTick` after every hour. */
export function replaySave(db: DatabaseSync, untilTick = Infinity, onTick?: (e: Engine) => void) {
  const rules = JSON.parse(readFileSync(new URL("config/rules.json", ROOT), "utf8"));
  const saved = db.prepare("SELECT map_json FROM world_map WHERE id=1").get() as { map_json: string } | undefined;
  const map = saved ? JSON.parse(saved.map_json) : JSON.parse(readFileSync(new URL(rules.map.file, ROOT), "utf8"));
  const e = new Engine(rules, map, Number(process.env.EXPECTED_COMPANIES ?? 60));
  let lastId = 0, failed = 0;
  for (const row of db.prepare("SELECT id, kind, payload FROM events ORDER BY id").all() as { id: number; kind: string; payload: string }[]) {
    if (row.kind === "tick") {
      if (e.tick >= untilTick) break;
      e.advance(); lastId = row.id; onTick?.(e);
      if (e.tick >= untilTick) break;   // stop at the top of the hour, before that hour's commands
      continue;
    }
    if (!e.apply(JSON.parse(row.payload) as Command).ok) failed++;
    lastId = row.id;
  }
  return { e, lastId, failed };
}

/** The digest platform.checkpoints recorded at `tick` while replaying (null if that module was off then). */
export function checkpointAt(e: Engine, tick: number): string | null {
  const m = e.features.modules.get("platform.checkpoints") as unknown as { admin?(): { checkpoints: { tick: number; digest: string }[] } } | undefined;
  if (!m?.admin || !e.features.enabled("platform.checkpoints")) return null;
  return m.admin().checkpoints.find(c => c.tick === tick)?.digest ?? null;
}
