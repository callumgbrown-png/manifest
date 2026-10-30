// Run from server/: npx tsx ../sim/playtest.ts   (env: STRATS, SEEDS, PER, CHECK, DIFF)
// Season playtest: players who check in every few hours and follow the game's own advice panel,
// against 30 live bots. Mirrors the client's "best trips" and "best move" maths (app.js) on the engine.
import { readFileSync } from "node:fs";
import { Engine } from "../server/src/engine.ts";
import { runBots, botName, pickStartPort } from "../server/src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../config/map.json", import.meta.url), "utf8"));
const CHECK = Number(process.env.CHECK || 4);        // hours between a player's check-ins
const PER = Number(process.env.PER || 4);            // players per strategy
const SEEDS = Number(process.env.SEEDS || 3);
const DIFF = process.env.DIFF || "normal";
for (const [k, v] of Object.entries({ CHECK, PER, SEEDS })) {
  if (!Number.isInteger(v) || v < 1) { console.error(`${k} must be a whole number of 1 or more (SEEDS is how many seeds, e.g. SEEDS=3)`); process.exit(1); }
}

type Strat = "advice" | "tripsOnly" | "oldDefault" | "newDefault" | "plan";
interface P { id: number; strat: Strat; emptySpent: number; trips: number; moves: number; waits: number; }

function makeTools(e: Engine) {
  const tax = () => e.rules.fees.trade_tax_rate, fee = () => e.rules.fees.port_fee_per_docking, cap = e.rules.ship.capacity;
  const fuel = (a: number, b: number) => e.fuelNeeded(a, b) * e.price(a, 1);
  function profit(from: number, to: number, g: number, qty: number, cargo: number[][]) {
    if (g < 0) return -(fuel(from, to) + fee());
    const buy = e.buyCost(from, g, qty).cost * (1 + tax());
    const sell = qty * e.price(to, g, e.stock[to][g] + cargo[to][g] + qty / 2) * (1 - tax());
    return sell - buy - fuel(from, to) - fee();
  }
  function bestTrips(port: number, cash: number, cargo: number[][], delay = 0) {
    const out: { dest: number; g: number; qty: number; profit: number; hours: number }[] = [];
    for (let g = 0; g < 2; g++) {
      const qty = Math.floor(Math.min(cap, e.stock[port][g], Math.max(0, cash - 300) / (e.price(port, g) * (1 + tax()) * 1.1)));
      if (qty < 10) continue;
      for (let d = 0; d < e.n; d++) {
        if (d === port || !Number.isFinite(e.dist[port][d])) continue;
        const pr = profit(port, d, g, qty, cargo);
        // Like the client: only trips that dock while trading is still open.
        if (pr > 0 && e.tick + delay + e.voyageHours(port, d) < e.seasonHours) out.push({ dest: d, g, qty, profit: pr, hours: Math.max(1, e.voyageHours(port, d)) });
      }
    }
    return out.sort((a, b) => b.profit / b.hours - a.profit / a.hours);
  }
  function bestMove(port: number, cash: number, cargo: number[][], delay = 0) {
    let best: { dest: number; score: number } | null = null;
    for (let d = 0; d < e.n; d++) {
      if (d === port || !Number.isFinite(e.dist[port][d])) continue;
      const go = profit(port, d, -1, 0, cargo), [next] = bestTrips(d, cash + go, cargo, delay + e.voyageHours(port, d));
      if (!next) continue;
      const net = next.profit + go, score = net / (e.voyageHours(port, d) + next.hours);
      if (net >= 50 && (!best || score > best.score)) best = { dest: d, score };
    }
    return best;
  }
  const alphaFirst = (port: number) => [...map.ports].filter((p: any) => p.id !== port).sort((a: any, b: any) => a.name.localeCompare(b.name))[0].id;
  const nearest = (port: number) => { let b = -1; for (let d = 0; d < e.n; d++) if (d !== port && Number.isFinite(e.dist[port][d]) && (b < 0 || e.dist[port][d] < e.dist[port][b])) b = d; return b; };
  /** Trip choice that also values where the ship ends up: profit plus the best next step from there, per hour. */
  function planned(port: number, cash: number, cargo: number[][]) {
    const trips = bestTrips(port, cash, cargo).slice(0, 12);
    let best: any = null;
    for (const t of trips) {
      const [next] = bestTrips(t.dest, cash, cargo, t.hours);
      const mv = next ? null : bestMove(t.dest, cash, cargo, t.hours);
      const after = next ? next.profit / next.hours : mv ? mv.score : 0;
      const score = (t.profit + after * 6) / (t.hours + 6);
      if (!best || score > best.score) best = { ...t, score };
    }
    return best;
  }
  return { bestTrips, bestMove, alphaFirst, nearest, planned };
}

const STRATS: Strat[] = (process.env.STRATS || "advice,tripsOnly,oldDefault,newDefault,plan").split(",") as Strat[];
const results = Object.fromEntries(STRATS.map(k => [k, [] as number[]])) as Record<Strat, number[]>;
const stats = Object.fromEntries(STRATS.map(k => [k, { empty: 0, trips: 0, moves: 0 }])) as Record<Strat, { empty: number; trips: number; moves: number }>;
let botFinal: number[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  let r = seed * 7919;
  const rand = (n: number) => { r = (r * 48271) % 2147483647; return r % n; };
  const e = new Engine(rules, map, 60);
  e.apply({ type: "setDifficulty", level: DIFF } as any);
  const bots: number[] = [];
  for (let i = 0; i < 30; i++) bots.push((e.apply({ type: "register", name: botName(i), startPort: rand(e.n) }) as any).id);
  const T = makeTools(e);
  const players: P[] = [];
  for (const strat of STRATS)
    for (let i = 0; i < PER; i++) {
      const start = strat === "oldDefault" ? rand(e.n) : pickStartPort(e, rand);
      players.push({ id: (e.apply({ type: "register", name: `${strat} ${seed}-${i}`, startPort: start }) as any).id, strat, emptySpent: 0, trips: 0, moves: 0, waits: 0 });
    }
  const offset = new Map(players.map((p, i) => [p.id, i % CHECK]));
  while (!e.seasonOver) {
    e.advance();
    runBots(e, bots, c => e.apply(c), { minProfit: e.botMinProfit, error: e.botError });
    for (const p of players) {
      if ((e.tick + offset.get(p.id)!) % CHECK) continue;
      const c = e.companies.get(p.id)!, s = e.ships.get(c.ships[0])!;
      if (s.dest !== null) continue;
      if (s.qty > 0) e.apply({ type: "sell", company: p.id, ship: s.id });
      const { cargo } = e.inbound();
      const trip = p.strat === "plan" ? T.planned(s.port, c.cash, cargo) : T.bestTrips(s.port, c.cash, cargo)[0];
      if (trip) {
        if (e.apply({ type: "sail", company: p.id, ship: s.id, dest: trip.dest, buy: { good: trip.g === 0 ? "grain" : "fuel", qty: trip.qty } }).ok) p.trips++;
        continue;
      }
      const before = c.cash;
      if (p.strat === "advice" || p.strat === "plan" || p.strat === "newDefault") {
        const mv = T.bestMove(s.port, c.cash, cargo);
        if (mv && e.apply({ type: "sail", company: p.id, ship: s.id, dest: mv.dest }).ok) { p.moves++; p.emptySpent += before - c.cash; }
        // Someone who just presses the green button: the form falls back to sailing empty to the nearest port.
        else if (!mv && p.strat === "newDefault" && e.apply({ type: "sail", company: p.id, ship: s.id, dest: T.nearest(s.port) }).ok) { p.moves++; p.emptySpent += before - c.cash; }
      } else if (p.strat === "oldDefault") {
        // The old form: one press of "Set sail" sends the ship empty to the first port alphabetically.
        if (e.apply({ type: "sail", company: p.id, ship: s.id, dest: T.alphaFirst(s.port) }).ok) { p.moves++; p.emptySpent += before - c.cash; }
      }
    }
  }
  for (const p of players) {
    results[p.strat].push(Math.round(e.netWorth(e.companies.get(p.id)!)));
    stats[p.strat].empty += p.emptySpent; stats[p.strat].trips += p.trips; stats[p.strat].moves += p.moves;
  }
  botFinal = botFinal.concat(bots.map(id => Math.round(e.netWorth(e.companies.get(id)!))));
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const n = PER * SEEDS;
console.log(`difficulty ${DIFF}, check-in every ${CHECK} h, ${n} players per strategy, start worth 16,000`);
for (const k of STRATS)
  console.log(`${k.padEnd(10)} median ${med(results[k])}  min ${Math.min(...results[k])}  max ${Math.max(...results[k])}  | per player: ${(stats[k].trips / n).toFixed(0)} trips, ${(stats[k].moves / n).toFixed(0)} empty moves costing ${(stats[k].empty / n).toFixed(0)}`);
console.log(`bots       median ${med(botFinal)}  max ${Math.max(...botFinal)}`);
