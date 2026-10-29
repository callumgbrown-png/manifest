// Bot trading companies for the live server, so markets move before real players arrive.
// Bots act through the same commands as players, so every bot action lands in the event log.
import type { Engine, Command, Result } from "./engine.js";

export const BOT_MARK = " · ";   // player names can't contain "·", so this marks a bot

const PREFIXES = ["Northwind", "Saltmarsh", "Greyhull", "Tidewater", "Ironkeel", "Blue Anchor", "Harbourline",
  "Driftwood", "Coastal", "Seaspray", "Westerly", "Redfunnel", "Lowtide", "Gullwing", "Stormbay", "Kestrel"];
const SUFFIXES = ["Freight", "Shipping", "Lines", "Haulage", "Carriers", "Traders"];

export function botName(i: number) {
  return `${PREFIXES[i % PREFIXES.length]}${BOT_MARK}${SUFFIXES[Math.floor(i / PREFIXES.length) % SUFFIXES.length]}${i >= 96 ? " " + i : ""}`;
}

export function isBot(name: string) { return name.includes(BOT_MARK); }

/** One decision pass: every idle bot ship sells cargo or picks its best trade. */
export function runBots(engine: Engine, botIds: number[], commit: (c: Command) => Result) {
  const tax = engine.rules.fees.trade_tax_rate, fee = engine.rules.fees.port_fee_per_docking;
  const cap = engine.rules.ship.capacity;
  const { cargo, emptyShips } = engine.inbound();
  // Best full-load trade available from each port right now, used to decide
  // where an empty ship should sail when nothing pays from where it is.
  const bestFrom = Array.from({ length: engine.n }, (_, p) => {
    let best = 0;
    for (let g = 0; g < 2; g++) {
      const qty = Math.min(cap, engine.stock[p][g]);
      if (qty < 20) continue;
      const buy = engine.buyCost(p, g, qty).cost * (1 + tax);
      for (let d = 0; d < engine.n; d++) {
        if (d === p || !Number.isFinite(engine.dist[p][d])) continue;
        const sell = qty * engine.price(d, g, engine.stock[d][g] + cargo[d][g] + qty / 2) * (1 - tax);
        const v = sell - buy - engine.fuelNeeded(p, d) * engine.price(p, 1) - fee;
        if (v > best) best = v;
      }
    }
    return best;
  });
  for (const id of botIds) {
    const c = engine.companies.get(id);
    if (!c) continue;
    for (const shipId of c.ships) {
      const s = engine.ships.get(shipId);
      if (!s || s.dest !== null) continue;
      if (s.qty > 0) { commit({ type: "sell", company: id, ship: s.id }); continue; }
      let best = { score: 0, dest: -1, good: -1, qty: 0 };
      for (let g = 0; g < 2; g++) {
        const qty = Math.floor(Math.min(cap, engine.stock[s.port][g], (c.cash - 1500) / (engine.price(s.port, g) * (1 + tax))));
        if (qty < 20) continue;
        const buy = engine.buyCost(s.port, g, qty).cost * (1 + tax);
        for (let d = 0; d < engine.n; d++) {
          if (d === s.port || !Number.isFinite(engine.dist[s.port][d])) continue;
          const hours = engine.voyageHours(s.port, d);
          const expected = engine.stock[d][g] + cargo[d][g] + qty / 2;
          const sell = qty * engine.price(d, g, expected) * (1 - tax);
          const fuel = engine.fuelNeeded(s.port, d) * engine.price(s.port, 1);
          const score = (sell - buy - fuel - fee) / (hours + 1);
          if (score > best.score) best = { score, dest: d, good: g, qty };
        }
      }
      if (best.dest < 0) {
        // Nothing pays from here: sail empty to the most promising port,
        // sharing its opportunity with empty ships already heading there.
        let move = { score: 0, dest: -1 };
        for (let d = 0; d < engine.n; d++) {
          if (d === s.port || !Number.isFinite(engine.dist[s.port][d])) continue;
          const value = bestFrom[d] / (1 + emptyShips[d]) - engine.fuelNeeded(s.port, d) * engine.price(s.port, 1) - fee;
          const score = value / (engine.voyageHours(s.port, d) + 6);
          if (score > move.score) move = { score, dest: d };
        }
        if (move.dest >= 0 && commit({ type: "sail", company: id, ship: s.id, dest: move.dest }).ok) emptyShips[move.dest]++;
        continue;
      }
      if (best.dest >= 0) {
        const r = commit({ type: "sail", company: id, ship: s.id, dest: best.dest,
          buy: { good: best.good === 0 ? "grain" : "fuel", qty: best.qty } });
        if (r.ok) cargo[best.dest][best.good] += best.qty;
      }
    }
    // Grow carefully: a second ship once comfortably rich, never more than three.
    const docked = c.ships.map(x => engine.ships.get(x)!).find(x => x.dest === null);
    if (docked && c.ships.length < 3 && c.cash > engine.rules.ship.price * 2.5)
      commit({ type: "buyShip", company: id, port: docked.port });
  }
}
