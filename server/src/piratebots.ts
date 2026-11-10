// Pirate bots: a few of the 30 bot companies (rules.pirates.bot_share) buy one pirate ship at home and use it.
// They act through the same commands as players, so every action is in the event log and replays.
import type { Engine, Command, Result } from "./engine.js";
import { roll } from "./piracy.js";

export function runPirateBots(engine: Engine, botIds: number[], commit: (c: Command) => Result) {
  if (!engine.piratesOn) return;
  const share = engine.rules.pirates!.bot_share;
  if (!(share > 0)) return;
  const every = Math.max(1, Math.round(1 / share));
  botIds.forEach((id, i) => { if (i % every === 0) runPirate(engine, id, commit); });
}

/** One company's pirate play for this tick (also used by the season simulation for its pirate players). */
export function runPirate(engine: Engine, id: number, commit: (c: Command) => Result) {
  if (!engine.piratesOn) return;
  const price = engine.spec("pirate").price;
  {
    const c = engine.companies.get(id);
    if (!c) return;
    const mine = c.ships.map(x => engine.ships.get(x)!);
    const pirates = mine.filter(s => s.type === "pirate");
    if (!pirates.length) {
      // Buy one at home once the bot can pay for it and still has working money.
      const atHome = mine.some(s => s.dest === null && s.port === c.home);
      if (atHome && c.ships.length < engine.rules.company.max_ships && c.cash >= price + 3000)
        commit({ type: "buyShip", company: id, port: c.home, shipType: "pirate" });
      return;
    }
    for (const s of pirates) {
      const ready = engine.tick >= (engine.piracy.cooldown.get(s.id) ?? 0) && engine.piracy.lockoutHours(id) === 0;
      if (ready && s.dest !== null) {
        // Only worthwhile prey: a good chance, and cargo worth taking.
        const prey = engine.piracy.targetsFor(s, true).find(t => t.chance >= 0.4 && (t.qty >= 15 || engine.maritime.wanted(t.owner)));
        if (prey) commit({ type: "raid", company: id, ship: s.id, target: prey.ship, cargoOnly: prey.cargoOnly });
      }
      if (s.dest !== null || engine.piracy.lockoutHours(id) > 0) continue;
      if (s.qty > 0) {
        if (!engine.maritime.hasLoot(s)) commit({ type: "sell", company: id, ship: s.id });
        else if (s.port === c.home) commit({ type: "fenceCargo", company: id, ship: s.id });
        else commit({ type: "sail", company: id, ship: s.id, dest: c.home });
        continue;
      }
      if (c.cash < 1500) continue;   // never sail a pirate on credit
      // Sail toward an incoming merchant and try to intercept it along the route.
      const loaded = [...engine.ships.values()].filter(t => t.dest !== null && t.type !== "pirate" && t.owner !== id && t.qty >= 15);
      const prey = loaded
        .filter(t => t.dest !== engine.companies.get(t.owner)!.home
          && Number.isFinite(engine.dist[s.port][t.dest!]) && t.dest !== s.port
          && engine.voyageHours(s.port, t.dest!, "pirate") >= 2 && t.arriveTick > engine.tick + 1)
        .sort((a, b) => b.qty - a.qty || a.id - b.id)[0];
      if (prey) { commit({ type: "sail", company: id, ship: s.id, dest: prey.dest! }); continue; }
      // Nothing to hunt: drift to a pseudo-random port.
      for (let k = 0; k < 8; k++) {
        const d = Math.floor(roll(id, engine.tick, s.id, k) * engine.n);
        if (d !== s.port && Number.isFinite(engine.dist[s.port][d]) && commit({ type: "sail", company: id, ship: s.id, dest: d }).ok) break;
      }
    }
  }
}
