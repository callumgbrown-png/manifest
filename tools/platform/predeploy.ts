// 582, 590: pre-deploy check for a branch. Runs the determinism self-test on the configured map, checks every
// feature switch file against the modules (economy modules must be off), then runs the test suite.
//   npx tsx ../tools/platform/predeploy.ts [--skip-tests]
// The full human checklist is docs/platform/predeploy-checklist.md.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Engine } from "../../server/src/engine.ts";
import { selfTest } from "../../server/src/features/platform/ops.ts";
import { ROOT } from "./common.ts";

const rules = JSON.parse(readFileSync(new URL("config/rules.json", ROOT), "utf8"));
const map = JSON.parse(readFileSync(new URL(rules.map.file, ROOT), "utf8"));
const problems: string[] = [];
for (const p of selfTest(rules, map, 48)) problems.push(`self-test: ${p}`);
const e = new Engine(rules, map);
const dir = new URL("config/features/", ROOT);
const switches: Record<string, unknown> = {};
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) Object.assign(switches, JSON.parse(readFileSync(new URL(f, dir), "utf8")));
for (const m of e.features.modules.values()) {
  if (!(m.id in switches)) problems.push(`switch missing for ${m.id}`);
  else if (m.economy && switches[m.id] === true) problems.push(`economy module ${m.id} is switched on: needs Dave's approval`);
}
for (const id of Object.keys(switches)) if (!id.startsWith("_") && !e.features.modules.has(id)) problems.push(`switch for unknown module ${id}`);
console.log(problems.length ? problems.map(p => `FAIL ${p}`).join("\n") : "Self-test and switch files OK.");
let code = problems.length ? 1 : 0;
if (!process.argv.includes("--skip-tests")) {
  const r = spawnSync("npm", ["test"], { stdio: "inherit", shell: true, cwd: new URL("server/", ROOT).pathname });
  code ||= r.status ?? 1;
}
process.exit(code);
