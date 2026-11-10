// Ideas 11-15: production chains. Each entry in config/content/economy/chains.json becomes economy.chain-<key>.
// A ship docked at a works port turns an input it carries into the next product, for a fee per output tonne.
// Inputs are engine goods (grain, fuel, ore) or module goods in the special hold (timber and fish come from the
// cargo-timber and cargo-fish modules). Outputs sell at the chain's consumer ports through a small side market.
// The bread chain (11) is content and ships on with no processing fee; the others are economy and ship off.
import { readFileSync } from "node:fs";
import { GOODS, type Engine, type Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { addLot, holdView, lotOf, SideMarket, spaceUsed, sweepHolds, takeLot, holds } from "./specialty.js";
import { action, connectedPorts, lazy, credits, dockedShips, fail, freeSpace, goodIndex, ownDocked, pickPorts, portName, unloadEngineCargo, whole } from "./util.js";

interface ChainGood { key: string; name: string; floor: number; ceiling: number; space?: number; perish?: number }
interface Stage { input: string; output: string; ratio: number; fee: number; works: string }
export interface ChainDef { idea: number; key: string; title: string; goods: ChainGood[]; stages: Stage[] }

export const CHAINS: ChainDef[] = JSON.parse(readFileSync(new URL("../../../../config/content/economy/chains.json", import.meta.url), "utf8")).chains;
export const CONTENT_CHAINS = new Set(["bread"]);

export function chainModule(def: ChainDef): FeatureFactory {
  return (e: Engine) => {
    const id = `economy.chain-${def.key}`, economy = !CONTENT_CHAINS.has(def.key);
    const setup = lazy(() => {
      const ports = connectedPorts(e);
      const works = def.stages.map(st => pickPorts(e, `${def.key}:${st.works}`, 3));
      const consumers = pickPorts(e, `${def.key}:buyers`, Math.max(4, Math.round(ports.length / 6)), ports.filter(p => !works.flat().includes(p)));
      const market = new SideMarket(e, def.goods.map(g => ({ ...g, producers: [], consumers, target: 300 })));
      return { works, consumers, market };
    });
    const spaceMap = new Map(def.goods.map(g => [g.key, g.space ?? 1]));
    const names = new Map(def.goods.map(g => [g.key, g.name]));
    const nameOf = (k: string) => names.get(k) ?? k;

    /** How much of a stage's input the ship carries. */
    const inputOn = (s: Ship, st: Stage) => {
      const g = goodIndex(st.input);
      return g !== undefined ? (s.good === g ? s.qty : 0) : lotOf(e, s.id, st.input)?.qty ?? 0;
    };

    const mod: FeatureModule = {
      id, ideas: [def.idea], title: def.title, economy,
      apply(cmd) {
        const { works, market } = setup();
        const c = e.companies.get(cmd.company)!;
        const s = ownDocked(e, c.id, cmd.ship);
        if (!s) return fail("choose one of your ships in port");
        switch (cmd.action) {
          case "process": {
            if (!whole(cmd.stage, 0, def.stages.length - 1)) return fail("unknown stage");
            const st = def.stages[cmd.stage];
            if (!works[cmd.stage].includes(s.port)) return fail(`there is no ${st.works.toLowerCase()} at ${portName(e, s.port)}`);
            const have = inputOn(s, st);
            if (!whole(cmd.qty, 1, 10_000) || cmd.qty > have + 1e-9) return fail(`you have ${Math.floor(have)} t of ${st.input} aboard`);
            const out = cmd.qty * st.ratio, outSpace = out * (spaceMap.get(st.output) ?? 1), inSpace = cmd.qty * (spaceMap.get(st.input) ?? 1);
            if (outSpace > freeSpace(e, s) + inSpace) return fail("not enough hold space for the product");
            const fee = economy ? out * st.fee : 0;
            if (c.cash < fee) return fail("not enough cash for the processing fee");
            const g = goodIndex(st.input);
            const basis = g !== undefined ? unloadEngineCargo(e, s, cmd.qty) : takeLot(e, s.id, st.input, cmd.qty);
            c.cash -= fee;
            addLot(e, s.id, st.output, out, basis + fee);
            return { ok: true, spent: fee };
          }
          case "sell": {
            if (typeof cmd.good !== "string" || !spaceMap.has(cmd.good)) return fail("unknown product");
            const lot = lotOf(e, s.id, cmd.good);
            if (!lot) return fail(`no ${nameOf(cmd.good).toLowerCase()} aboard`);
            const qty = lot.qty, value = market.sellValue(s.port, cmd.good, qty);
            takeLot(e, s.id, cmd.good, qty);
            market.add(s.port, cmd.good, qty);
            c.cash += value;
            return { ok: true, earned: value };
          }
          default: return fail("unknown action");
        }
      },
      advance() {
        setup().market.step();
        sweepHolds(e, spaceMap.keys());
        for (const g of def.goods) if (g.perish)
          for (const [ship, hold] of holds(e)) { const lot = hold.get(g.key); if (lot) takeLot(e, ship, g.key, lot.qty * g.perish); }
      },
      adjust: { capacity: (v, ctx) => v - spaceUsed(e, ctx.ship, spaceMap) },
      cards(company) {
        const { works, consumers, market } = setup();
        const ships = dockedShips(e, company);
        const actions = [];
        for (const s of ships) {
          def.stages.forEach((st, i) => {
            const have = Math.floor(inputOn(s, st));
            if (works[i].includes(s.port) && have > 0)
              actions.push(action(id, `${st.works}: ${st.input} to ${nameOf(st.output).toLowerCase()} on #${s.id}`, "process", { ship: s.id, stage: i },
                [{ key: "qty", label: "Tonnes in", min: 1, max: have, value: have }]));
          });
          for (const g of def.goods) if (lotOf(e, s.id, g.key))
            actions.push(action(id, `Sell ${g.name.toLowerCase()} from #${s.id} (${credits(market.price(s.port, g.key))}/t here)`, "sell", { ship: s.id, good: g.key }));
        }
        const stages = def.stages.map((st, i) => `${st.works} (${st.input} to ${nameOf(st.output).toLowerCase()}, ${Math.round(st.ratio * 100)}% yield${economy ? `, ${st.fee} cr/t` : ""}) at ${works[i].map(p => portName(e, p)).join(", ")}`);
        return [{ title: def.title, detail: `${stages.join(".\n")}.\nBuyers pay most at ${consumers.slice(0, 5).map(p => portName(e, p)).join(", ")}.`, actions }];
      },
      view(company) {
        const c = e.companies.get(company);
        if (!c) return undefined;
        const keys = new Set(spaceMap.keys());
        return { lots: c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s).flatMap(s => holdView(e, s, keys)) };
      },
      world() { const { works, consumers } = setup(); return { works, consumers, inputs: def.stages.map(st => st.input), engineInputs: def.stages.map(st => goodIndex(st.input) ?? -1) }; },
    };
    return mod;
  };
}

export const chainFactories: FeatureFactory[] = CHAINS.map(chainModule);
