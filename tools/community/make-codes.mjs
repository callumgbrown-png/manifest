#!/usr/bin/env node
// Makes unlock codes for community.codes and appends their salted hashes to config/content/community/codes.json.
// The plain codes are printed once (give them to buyers/testers); the server never stores them.
//
//   node tools/community/make-codes.mjs --grant pack:pack.supporter --count 10 --label supporter-pack
//   node tools/community/make-codes.mjs --grant points:3 --label bug-report-142           (one tester code)
//   node tools/community/make-codes.mjs --grant naming:1 --grant item:badge.race-winner --uses 1 --label race-week-3
//   add --dry-run to print without saving
//
// Grants: item:<id>, pack:<id>, naming:<1-5>, points:<1-20> (ids from config/content/community/cosmetics.json).
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(ROOT, "config", "content", "community", "codes.json");
const CAT = JSON.parse(readFileSync(join(ROOT, "config", "content", "community", "cosmetics.json"), "utf8"));
const args = process.argv.slice(2), grants = [];
let count = 1, uses = 1, label = "", dry = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--grant") grants.push(args[++i]);
  else if (a === "--count") count = Number(args[++i]);
  else if (a === "--uses") uses = Number(args[++i]);
  else if (a === "--label") label = String(args[++i] ?? "");
  else if (a === "--dry-run") dry = true;
  else { console.error(`unknown option ${a}`); process.exit(1); }
}
const ok = g => { const [k, v] = String(g).split(":"); const n = Number(v);
  return (k === "item" && CAT.items.some(x => x.id === v)) || (k === "pack" && CAT.packs.some(x => x.id === v))
    || (k === "naming" && Number.isInteger(n) && n >= 1 && n <= 5) || (k === "points" && Number.isInteger(n) && n >= 1 && n <= 20); };
if (!grants.length || !grants.every(ok)) { console.error("give at least one valid --grant (see the top of this file)"); process.exit(1); }
if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(uses) || uses < 1) { console.error("bad --count or --uses"); process.exit(1); }

const sha = s => createHash("sha256").update(s).digest("hex");
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join("")).join("-");
const data = JSON.parse(readFileSync(FILE, "utf8"));
const out = [];
for (let i = 0; i < count; i++) {
  const code = makeCode(), salt = randomBytes(12).toString("hex");
  const proof = sha(`manifest-code-v1:${code.replace(/[^A-Z0-9]/g, "")}`);
  data.codes.push({ label: label.slice(0, 40), salt, hash: sha(`${salt}:${proof}`), grants, uses });
  out.push(code);
}
if (!dry) writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(out.join("\n"));
console.error(dry ? `${count} code(s) NOT saved (dry run)` : `${count} code(s) saved to ${FILE}; restart the server to load them.`);
