// 561: rollback tool. Writes a NEW save that ends at a given hour (every event after it is dropped), after checking
// the replay at that hour; the original file is never changed. Stop the server, roll back, then start the server
// on the new file (DB_PATH=...). Use the platform.checkpoints digest shown in the admin console to pick the hour.
//   npx tsx ../tools/platform/rollback.ts --tick 120 [--expect <digest>] [--db path] [--out path]
import { copyFileSync, existsSync } from "node:fs";
import { arg, checkpointAt, defaultDb, openSave, replaySave } from "./common.ts";
import { stateDigest } from "../../server/src/features/platform/ops.ts";

const src = arg("db", defaultDb())!, tick = Number(arg("tick"));
if (!Number.isInteger(tick) || tick < 0) { console.error("give --tick <hour to roll back to>"); process.exit(1); }
const out = arg("out", src.replace(/\.db$/, "") + `-rollback-${tick}.db`)!;
if (existsSync(out)) { console.error(`${out} already exists; choose another --out`); process.exit(1); }
const { e, lastId } = replaySave(openSave(src), tick);
if (e.tick !== tick) { console.error(`the save only reaches tick ${e.tick}`); process.exit(1); }
// --expect is the checkpoint digest shown in the admin console (recorded mid-hour by platform.checkpoints).
const digest = checkpointAt(e, tick) ?? stateDigest(e);
if (arg("expect") && arg("expect") !== digest) { console.error(`checkpoint at ${tick} is ${digest}, not ${arg("expect")}; not rolling back`); process.exit(1); }
copyFileSync(src, out);
const db = openSave(out, false);
const dropped = db.prepare("DELETE FROM events WHERE id > ?").run(lastId).changes;
db.close();
console.log(`Wrote ${out}: rolled back to tick ${tick} (digest ${digest}), dropped ${dropped} later events. The original is unchanged.`);
