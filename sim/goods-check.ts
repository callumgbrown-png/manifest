// Run from server/: npx tsx ../sim/goods-check.ts   (env: BOTS, DIFF)
// Does the best choice depend on the situation? Runs a season of bots, and at a few moments finds, for every
// port, which good and which ship class gives the best profit per hour at three cash levels.
import { readFileSync } from "node:fs";
import { Engine, GOODS, SHIP_TYPES, type ShipType } from "../server/src/engine.ts";
import { runBots, botName } from "../server/src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../config/map.json", import.meta.url), "utf8"));
const BOTS = Number(process.env.BOTS || 30), DIFF = process.env.DIFF || "normal";
rules.difficulty.default = DIFF;
const e = new Engine(rules, map, 60);
const ids: number[] = [];
for (let i = 0; i < BOTS; i++) ids.push(e.apply({ type: "register", name: botName(i), startPort: (i * 7) % e.n }).id!);
const commit = (c: any) => e.apply(c);
const tax = () => e.rules.fees.trade_tax_rate, fee = () => e.rules.fees.port_fee_per_docking;

function best(port: number, cash: number, type: ShipType) {
  const sp = e.spec(type), { cargo } = e.inbound();
  let out = { score: 0, g: -1, d: -1, qty: 0, profit: 0, hours: 0 };
  for (let g = 0; g < GOODS.length; g++) {
    const qty = Math.floor(Math.min(sp.capacity, e.stock[port][g], Math.max(0, cash - 300) / (e.price(port, g) * (1 + tax()) * 1.1)));
    if (qty < 5) continue;
    const buy = e.buyCost(port, g, qty).cost * (1 + tax());
    for (let d = 0; d < e.n; d++) {
      if (d === port || !Number.isFinite(e.dist[port][d])) continue;
      const sell = qty * e.price(d, g, e.stock[d][g] + cargo[d][g] + qty / 2) * (1 - tax());
      const profit = sell - buy - e.fuelNeeded(port, d, type) * e.price(port, 1) - fee();
      const hours = e.voyageHours(port, d, type) + 1;
      if (profit / hours > out.score) out = { score: profit / hours, g, d, qty, profit, hours };
    }
  }
  return out;
}

function report(label: string) {
  console.log(`\n== ${label} (tick ${e.tick}): ports where each good / ship class wins, best profit per hour`);
  for (const cash of [10000, 30000, 100000]) {
    const goodWins = GOODS.map(() => 0), typeWins = SHIP_TYPES.map(() => 0), paying = SHIP_TYPES.map(() => 0);
    const score: Record<string, number[]> = Object.fromEntries(SHIP_TYPES.map(t => [t, []]));
    const pair: Record<string, number> = {};
    for (let p = 0; p < e.n; p++) {
      const r = SHIP_TYPES.map(t => best(p, cash, t));
      r.forEach((x, i) => { if (x.score > 0) paying[i]++; score[SHIP_TYPES[i]].push(x.score); });
      let bi = 0; r.forEach((x, i) => { if (x.score > r[bi].score) bi = i; });
      if (r[bi].score > 0) { typeWins[bi]++; goodWins[r[bi].g]++; const k = `${SHIP_TYPES[bi]}+${GOODS[r[bi].g]}`; pair[k] = (pair[k] ?? 0) + 1; }
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };
    console.log(`cash ${String(cash).padStart(6)}: class wins ${SHIP_TYPES.map((t, i) => `${t} ${typeWins[i]}`).join(", ")} | good wins ${GOODS.map((g, i) => `${g} ${goodWins[i]}`).join(", ")} | median profit/h ${SHIP_TYPES.map(t => `${t} ${med(score[t])}`).join(", ")}`);
    console.log("   combos: " + Object.entries(pair).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  }
}

let supply0 = 0;
const sample = new Set([1, 120, 400, 900, 1300]);
const vol = GOODS.map(() => 0);
for (let t = 1; t <= e.seasonHours; t++) {
  e.advance();
  const before = [...e.ships.values()].map(s => [s.good, s.qty, s.dest] as const);
  runBots(e, ids, commit, { minProfit: e.botMinProfit, error: e.botError });
  for (const s of e.ships.values()) if (s.dest !== null && s.good !== null && s.departTick === e.tick) vol[s.good] += s.qty;
  if (t === 1) supply0 = [...e.companies.values()].reduce((a, c) => a + c.cash, 0);
  if (sample.has(t)) report(`season hour ${t}`);
}
const supply = [...e.companies.values()].reduce((a, c) => a + c.cash, 0);
const worth = [...e.companies.values()].map(c => e.netWorth(c)).sort((a, b) => b - a);
console.log(`\nbots ${BOTS}, ${DIFF}: money supply ${(100 * (supply / supply0 - 1)).toFixed(1)}% over the season (${(100 * (Math.pow(supply / supply0, 1 / 56) - 1)).toFixed(2)}%/day); net worth top ${Math.round(worth[0])}, median ${Math.round(worth[Math.floor(worth.length / 2)])}, low ${Math.round(worth.at(-1)!)}`);
console.log("units loaded by bots: " + GOODS.map((g, i) => `${g} ${Math.round(vol[i])}`).join(", "));
const owned: Record<string, number> = {};
for (const s of e.ships.values()) owned[s.type] = (owned[s.type] ?? 0) + 1;
console.log("ships:", owned);
