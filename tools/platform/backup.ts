// 589: save backups. Copies the live save with SQLite's VACUUM INTO (safe while the server runs) into
// data/backups/manifest-<UTC time>.db and keeps the newest N (default 48). Schedule it hourly with cron or
// Windows Task Scheduler:  npx tsx ../tools/platform/backup.ts [--keep 48] [--db path] [--dir path]
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { arg, defaultDb, openSave, ROOT } from "./common.ts";

const src = arg("db", defaultDb())!, keep = Math.max(1, Number(arg("keep", "48")));
const dir = arg("dir", new URL("data/backups/", ROOT).pathname)!;
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");   // a tool, not game code: wall-clock time is fine here
const target = join(dir, `manifest-${stamp}.db`);
const db = openSave(src);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(dir).filter(f => /^manifest-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(join(dir, f));
console.log(`Backed up to ${target}; removed ${old.length} old backup(s).`);
