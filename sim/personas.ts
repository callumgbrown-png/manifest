// 571-576, 196, 583, 584, 586: persona simulator. Runs the five persona policies (features/platform/personas.ts)
// against the 30 house bots, then prints a balance report (who wins, Gini, health score), writes hourly
// AI-readable reports and a replay file (every command and hour plus the final digest).
//   from server/:  npx tsx ../sim/personas.ts [--days 7] [--per 2] [--seed name] [--out ../sim/out]
//   replay check:  npx tsx ../sim/personas.ts --replay ../sim/out/personas-<seed>.replay.json
// --seed builds a random-season map from that seed (the same seed always gives the same world); without it the
// classic map is used.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Engine, type Command, type Result } from "../server/src/engine.ts";
import { runBots, botName } from "../server/src/bots.ts";
import { runPirateBots } from "../server/src/piratebots.ts";
import { generateRandomSeason } from "../server/src/random-season.ts";
import { PERSONAS } from "../server/src/features/platform/personas.ts";
import { aiReport, balanceReport, type HealthSample } from "../server/src/features/platform/analytics.ts";
import { stateDigest } from "../server/src/features/platform/ops.ts";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const rules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
const FEATURES = ["platform.economy-health", "platform.personas", "platform.audit", "platform.anomaly"];

type Entry = Command | "tick";
interface ReplayFile { format: "manifest-sim-replay/1"; seed: string | null; log: Entry[]; digest: string }

async function mapFor(seed: string | null) {
  return seed ? generateRandomSeason({ seed }) : JSON.parse(readFileSync(new URL("../config/map.json", import.meta.url), "utf8"));
}

if (arg("replay")) {
  const file = JSON.parse(readFileSync(arg("replay")!, "utf8")) as ReplayFile;
  const e = new Engine(rules, await mapFor(file.seed), 60);
  for (const entry of file.log) entry === "tick" ? e.advance() : e.apply(entry);
  const digest = stateDigest(e);
  console.log(digest === file.digest ? `Replay matches (${digest}) after ${e.tick} hours.` : `Replay DIVERGED: ${digest} vs ${file.digest}`);
  process.exit(digest === file.digest ? 0 : 1);
}

const days = Number(arg("days", "7")), per = Number(arg("per", "2")), seed = arg("seed") ?? null;
const outDir = arg("out", new URL("out/", import.meta.url).pathname)!;
if (!Number.isInteger(days) || days < 1 || !Number.isInteger(per) || per < 1) { console.error("--days and --per must be whole numbers of 1 or more"); process.exit(1); }
const e = new Engine(rules, await mapFor(seed), 60);
const log: Entry[] = [];
const commit = (c: Command): Result => { const r = e.apply(c); if (r.ok) log.push(structuredClone(c)); return r; };
commit({ type: "setFeatures", enabled: FEATURES });
const bots: number[] = [];
for (let i = 0; i < 30; i++) { const r = commit({ type: "register", name: botName(i), startPort: i % e.n }); if (r.ok) bots.push(r.id!); }
const players: { id: number; persona: typeof PERSONAS[number]; memory: Map<string, number> }[] = [];
PERSONAS.forEach((persona, k) => {
  for (let i = 0; i < per; i++) {
    const r = commit({ type: "register", name: `${persona.id} ${i + 1}`, startPort: (k * 7 + i * 3) % e.n });
    if (r.ok) players.push({ id: r.id!, persona, memory: new Map() });
  }
});
const reports: ReturnType<typeof aiReport>[] = [];
for (let h = 0; h < days * 24 && !e.seasonOver; h++) {
  runBots(e, bots, commit, { minProfit: 150, error: 0.25 });
  runPirateBots(e, bots, commit);
  for (const p of players) if (h % p.persona.every === p.id % p.persona.every) p.persona.act(e, p.id, commit, p.memory);
  log.push("tick"); e.advance();
  reports.push(aiReport(e));
}
const history = ((e.features.modules.get("platform.economy-health") as unknown as { admin(): { history: HealthSample[] } }).admin()).history;
const byPersona = PERSONAS.map(persona => {
  const mine = players.filter(p => p.persona.id === persona.id).map(p => e.netWorth(e.companies.get(p.id)!));
  return { persona: persona.id, goal: persona.goal, averageWorth: Math.round(mine.reduce((a, b) => a + b, 0) / Math.max(1, mine.length)) };
}).sort((a, b) => b.averageWorth - a.averageWorth);
const botWorth = Math.round(bots.reduce((a, id) => a + e.netWorth(e.companies.get(id)!), 0) / Math.max(1, bots.length));
const digest = stateDigest(e);
const lines = [
  `Persona simulation: ${days} days, ${per} of each persona, seed ${seed ?? "classic map"}. Final digest ${digest}.`,
  ...byPersona.map(p => `  ${p.persona.padEnd(10)} average worth ${p.averageWorth}`),
  `  house bots average worth ${botWorth}`,
  ...balanceReport(history),
];
console.log(lines.join("\n"));
mkdirSync(outDir, { recursive: true });
const name = `personas-${(seed ?? "classic").replace(/[^a-z0-9-]/gi, "_")}`;
writeFileSync(join(outDir, `${name}.report.txt`), lines.join("\n") + "\n");
writeFileSync(join(outDir, `${name}.hourly.jsonl`), reports.map(r => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(outDir, `${name}.replay.json`), JSON.stringify({ format: "manifest-sim-replay/1", seed, log, digest } satisfies ReplayFile));
console.log(`Wrote ${name}.report.txt, .hourly.jsonl and .replay.json to ${outDir}`);
