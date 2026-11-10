// Ideas 16 and 281-300 (not 288, which lives in production.ts with the harvests): specialty cargo the engine's
// fixed GOODS list doesn't have. Every entry in config/content/economy/cargo.json becomes one module,
// economy.cargo-<key>. Goods are bought at producer ports, carried in the ship's special hold (specialty.ts) and
// sold at any port (consumer ports pay most). Per-good rules: perishing, breakage at sea, hazard fines, theft,
// feed costs, wine ageing, a weapons licence, mystery crates and mail contracts.
// Electronics (285) is content and ships on; the rest add new ways to make and lose money and ship off.
import { readFileSync } from "node:fs";
import type { Engine, Ship } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { addLot, holdView, lotOf, SideMarket, spaceUsed, sweepHolds, takeLot, holds } from "./specialty.js";
import {
  action, connectedPorts, credits, lazy, dockedShips, fail, freeSpace, isolatedPorts, Notes, ok, ownDocked, pickPorts, portName, whole,
} from "./util.js";

export interface CargoDef {
  idea: number; key: string; name: string; floor: number; ceiling: number;
  target?: number; space?: number; maxBuy?: number; origin?: "isolated";
  perish?: number; setsAfter?: number; breakage?: number; hazard?: number; hazardFine?: number; theft?: number; feed?: number;
  aging?: number; agingCap?: number; license?: number; mystery?: number; mail?: boolean; demandSpike?: boolean;
}

export const CARGO: CargoDef[] = JSON.parse(readFileSync(new URL("../../../../config/content/economy/cargo.json", import.meta.url), "utf8")).goods;

/** Modules in this file that ship on (content, not economy). */
export const CONTENT_CARGO = new Set(["electronics"]);

export interface CargoApi { market: SideMarket; producers: number[]; consumers: number[]; def: CargoDef }

export function cargoModule(def: CargoDef): FeatureFactory {
  return (e: Engine) => {
    const id = `economy.cargo-${def.key}`, key = def.key, space = def.space ?? 1, maxBuy = def.maxBuy ?? 200;
    const setup = lazy(() => {
      const ports = connectedPorts(e);
      const producers = def.mail ? ports : def.origin === "isolated" ? isolatedPorts(e) : pickPorts(e, `${key}:make`, Math.max(3, Math.round(ports.length / 8)));
      const consumers = def.mail ? [] : pickPorts(e, `${key}:use`, Math.max(4, Math.round(ports.length / 6)), ports.filter(p => !producers.includes(p)));
      const market = new SideMarket(e, [{ key, name: def.name, floor: def.floor, ceiling: def.ceiling, target: def.target, space, producers, consumers }]);
      return { ports, producers, consumers, market };
    });
    const spaceMap = new Map([[key, space]]);
    const licensed = new Set<number>();
    const notes = new Notes();
    let outbreak = -1;           // medicine: the port with a sudden shortage
    const unitPrice = (port: number) => def.mystery ?? setup().market.price(port, key);

    const sale = (s: Ship, qty: number): { value: number; error?: string } => {
      const { market } = setup();
      const lot = lotOf(e, s.id, key)!;
      if (def.mail) {
        if (lot.dest !== s.port) return { value: 0, error: `this mail is for ${portName(e, lot.dest!)}` };
        return { value: (lot.pay ?? 0) * (e.tick <= (lot.due ?? 0) ? 1 : 0.5) * qty / lot.qty };
      }
      if (def.mystery) return { value: (lot.value ?? 0) * qty / lot.qty };
      let value = market.sellValue(s.port, key, qty);
      if (def.aging) value *= 1 + Math.min(def.agingCap ?? 0.5, def.aging * (e.tick - lot.tick));
      return { value };
    };

    const mod: FeatureModule & CargoApi = {
      id, ideas: [def.idea], title: def.name, economy: !CONTENT_CARGO.has(key), def,
      get market() { return setup().market; }, get producers() { return setup().producers; }, get consumers() { return setup().consumers; },
      apply(cmd) {
        const { ports, producers, market } = setup();
        const c = e.companies.get(cmd.company)!;
        switch (cmd.action) {
          case "license": {
            if (!def.license) return fail("no licence is needed for this cargo");
            if (licensed.has(c.id)) return fail("you already hold the licence");
            if (c.cash < def.license) return fail("not enough cash for the licence");
            c.cash -= def.license;
            licensed.add(c.id);
            return ok;
          }
          case "buy": {
            const s = ownDocked(e, c.id, cmd.ship);
            if (!s) return fail("choose one of your ships in port");
            if (!producers.includes(s.port)) return fail(`${def.name} is not loaded at ${portName(e, s.port)}`);
            if (!whole(cmd.qty, 1, maxBuy)) return fail(`load between 1 and ${maxBuy}`);
            if (def.license && !licensed.has(c.id)) return fail("you need a licence first");
            const lot = lotOf(e, s.id, key);
            if (def.mail && lot) return fail("deliver the mail already aboard first");
            if (lot && lot.qty + cmd.qty > maxBuy) return fail(`a ship carries at most ${maxBuy}`);
            if (freeSpace(e, s) < cmd.qty * space) return fail("not enough hold space");
            if (def.mail) {
              const options = ports.filter(p => p !== s.port && Number.isFinite(e.dist[s.port][p]));
              if (!options.length) return fail("no mail to carry from here");
              const dest = options[Math.floor(e.features.random() * options.length)];
              const hours = e.voyageHours(s.port, dest, s.type);
              const pay = Math.round(cmd.qty * (15 + e.dist[s.port][dest] * 0.4));
              addLot(e, s.id, key, cmd.qty, 0, { dest, due: e.tick + Math.ceil(hours * 1.5) + 12, pay });
              notes.add(c.id, `Ship #${s.id} took ${cmd.qty} sacks of mail for ${portName(e, dest)}, paying ${credits(pay)}.`);
              return ok;
            }
            const cost = def.mystery ? def.mystery * cmd.qty : market.buyCost(s.port, key, cmd.qty);
            if (c.cash < cost) return fail("not enough cash");
            c.cash -= cost;
            if (!def.mystery) market.add(s.port, key, -cmd.qty);
            const before = lotOf(e, s.id, key)?.value ?? 0;
            addLot(e, s.id, key, cmd.qty, cost);
            if (def.mystery) {
              let value = 0;
              for (let i = 0; i < cmd.qty; i++) { const r = e.features.random(); value += def.mystery * (0.2 + 2.6 * r * r); }
              lotOf(e, s.id, key)!.value = before + value;
            }
            return { ok: true, spent: cost };
          }
          case "sell": {
            const s = ownDocked(e, c.id, cmd.ship);
            if (!s) return fail("choose one of your ships in port");
            const lot = lotOf(e, s.id, key);
            if (!lot) return fail(`no ${def.name.toLowerCase()} aboard`);
            const qty = cmd.qty === undefined ? lot.qty : cmd.qty;
            if (typeof qty !== "number" || !(qty > 0) || qty > lot.qty + 1e-9 || !Number.isFinite(qty)) return fail("bad quantity");
            const { value, error } = sale(s, qty);
            if (error) return fail(error);
            const valueLeft = lot.value;
            takeLot(e, s.id, key, qty);
            const left = lotOf(e, s.id, key);
            if (left && valueLeft !== undefined) left.value = valueLeft * left.qty / (left.qty + qty);
            if (!def.mail && !def.mystery) market.add(s.port, key, qty);
            c.cash += value;
            if (def.mystery) notes.add(c.id, `The crates held goods worth ${credits(value)}.`);
            return { ok: true, earned: value };
          }
          default: return fail("unknown action");
        }
      },
      advance() {
        const { ports, consumers, market } = setup();
        market.step();
        sweepHolds(e, [key]);
        if (def.demandSpike && e.tick % 72 === 1) {
          const targets = consumers.length ? consumers : ports;
          outbreak = targets[Math.floor(e.features.random() * targets.length)];
          market.stock.get(key)![outbreak] = 0;
        }
        for (const [shipId, hold] of holds(e)) {
          const lot = hold.get(key);
          const s = e.ships.get(shipId);
          if (!lot || !s) continue;
          const atSea = s.dest !== null, c = e.companies.get(s.owner);
          if (def.mail) continue;
          if (def.perish && (!def.setsAfter || e.tick - lot.tick > def.setsAfter)) takeLot(e, shipId, key, lot.qty * def.perish);
          if (!atSea || !hold.has(key)) continue;
          if (def.breakage) takeLot(e, shipId, key, lot.qty * def.breakage);
          if (def.feed && c) c.cash -= def.feed * lot.qty;
          if (def.theft && e.features.random() < def.theft) {
            takeLot(e, shipId, key, lot.qty);
            notes.add(s.owner, `Thieves took the ${def.name.toLowerCase()} from ship #${shipId}.`);
            continue;
          }
          if (def.hazard && c && e.features.random() < def.hazard) {
            const fine = lot.cost * (def.hazardFine ?? 0.2);
            c.cash -= fine;
            notes.add(s.owner, `A ${def.name.toLowerCase()} incident on ship #${shipId} cost ${credits(fine)} in clean-up fines.`);
          }
        }
      },
      adjust: { capacity: (v, ctx) => v - spaceUsed(e, ctx.ship, spaceMap) },
      cards(company) {
        const { producers, consumers } = setup();
        const ships = dockedShips(e, company);
        if (!ships.length) return [];
        const out: FeatureCard[] = [];
        const actions = [];
        for (const s of ships) {
          const lot = lotOf(e, s.id, key);
          if (producers.includes(s.port) && (!def.license || licensed.has(company)) && !(def.mail && lot))
            actions.push(action(id, `Load on #${s.id} at ${portName(e, s.port)}`, "buy", { ship: s.id },
              [{ key: "qty", label: def.mail ? "Sacks" : "Units", min: 1, max: maxBuy, value: Math.min(maxBuy, 10) }]));
          if (lot && (!def.mail || lot.dest === s.port)) actions.push(action(id, `Sell from #${s.id}`, "sell", { ship: s.id }));
        }
        if (def.license && !licensed.has(company)) actions.push(action(id, `Buy licence (${credits(def.license)})`, "license"));
        const where = def.mail ? "Every port has mail to send." : `Loaded at ${producers.map(p => portName(e, p)).join(", ")}. Best paid at ${consumers.slice(0, 5).map(p => portName(e, p)).join(", ")}.`;
        const rules = [def.perish && "perishes", def.breakage && "breaks at sea", def.hazard && "risk of fines at sea", def.theft && "target for thieves",
          def.feed && "needs feeding at sea", def.aging && "gains value as it ages", def.mystery && "contents unknown until sold", def.space && def.space > 1 && `takes ${def.space} t of hold each`]
          .filter(Boolean).join(", ");
        const here = ships.map(s => `${portName(e, s.port)}: ${def.mystery ? credits(def.mystery) + "/crate" : def.mail ? "-" : credits(unitPrice(s.port)) + "/unit"}`).join("; ");
        out.push({ title: def.name, detail: `${where}${rules ? `\nRules: ${rules}.` : ""}${def.mail ? "" : `\nPrices here: ${here}.`}${notes.of(company).length ? `\n${notes.of(company).slice(-2).join("\n")}` : ""}`, actions });
        return out;
      },
      view(company) {
        const c = e.companies.get(company);
        if (!c) return undefined;
        const lots = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s).flatMap(s => holdView(e, s, new Set([key])));
        return { lots, licensed: licensed.has(company), notes: notes.of(company), outbreak: outbreak >= 0 ? outbreak : undefined };
      },
      world() { return def.mail ? undefined : { producers: setup().producers, consumers: setup().consumers }; },
    };
    return mod;
  };
}

export const cargoFactories: FeatureFactory[] = CARGO.map(cargoModule);
