// 200: session replay for debugging economy bugs. Replays a save to a tick and prints the world digest and one
// company's state, hour by hour if asked, so a bug report's tick can be re-lived exactly.
//   npx tsx ../tools/platform/replay.ts --tick 120 --company 7 [--trace 6] [--db path]
import { arg, checkpointAt, openSave, replaySave } from "./common.ts";
import { stateDigest } from "../../server/src/features/platform/ops.ts";

const tick = Number(arg("tick", "Infinity")), company = arg("company") === undefined ? null : Number(arg("company"));
const trace = Number(arg("trace", "0"));
const show = (e: Parameters<typeof stateDigest>[0]) => {
  const c = company === null ? undefined : e.companies.get(company);
  const ships = c ? c.ships.map(id => e.ships.get(id)!).map(s => `#${s.id} ${s.type} ${s.dest === null ? `at ${s.port}` : `${s.port}->${s.dest}`} ${s.good === null ? "empty" : `${Math.round(s.qty)}t g${s.good}`}`) : [];
  return `tick ${e.tick} digest ${stateDigest(e)}${c ? ` | ${c.name} cash ${Math.round(c.cash)} | ${ships.join("; ")}` : ""}`;
};
const { e, failed } = replaySave(openSave(arg("db")), tick, x => { if (trace && tick - x.tick < trace) console.log(show(x)); });
console.log(show(e));
const cp = checkpointAt(e, e.tick);
if (cp) console.log(`platform.checkpoints digest at tick ${e.tick}: ${cp}`);
if (failed) console.log(`${failed} logged commands were rejected on replay (normal for commands the live server also rejected).`);
