import type { FeatureAction } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { arrivals, exhibit, fail, inRange, isPort, ownDocked, portName, repAtLeast } from "./shared.js";

const CHARTER_PRICE = 4000, MAX_CHARTERS = 2;

/** 45 player-owned ports (a season charter), 44 owner-set dock fees. The owner keeps half of what visitors pay. */
export const ownership: FeatureFactory = (e) => {
  const charters = new Map<number, { owner: number; rate: number; earned: number }>();
  const visitorFee = (port: number) => e.rules.fees.port_fee_per_docking * (charters.get(port)!.rate / 100);
  return {
    id: "ports.ownership", ideas: [44, 45], title: "Port charters", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (!isPort(e, cmd.port)) return fail("choose a port");
      const charter = charters.get(cmd.port);
      switch (cmd.action) {
        case "buyCharter":
          if (charter) return fail("that port already has an owner");
          if (!ownDocked(e, c.id, cmd.port).length) return fail("dock a ship there first");
          if (!repAtLeast(e, c.id, cmd.port, 30)) return fail("you need Trusted standing at this port");
          if ([...charters.values()].filter(x => x.owner === c.id).length >= MAX_CHARTERS) return fail(`you can own at most ${MAX_CHARTERS} ports`);
          if (c.cash < CHARTER_PRICE) return fail("not enough cash");
          c.cash -= CHARTER_PRICE;
          charters.set(cmd.port, { owner: c.id, rate: 100, earned: 0 });
          exhibit(e, "charter", c.id, `${c.name} took the charter of ${portName(e, cmd.port)}`);
          return { ok: true, spent: CHARTER_PRICE };
        case "setFee":
          if (charter?.owner !== c.id) return fail("you do not own this port");
          if (!inRange(cmd.rate, 50, 150)) return fail("set the fee between 50% and 150% of the standard fee");
          charter.rate = cmd.rate;
          return { ok: true };
        case "sellCharter":
          if (charter?.owner !== c.id) return fail("you do not own this port");
          charters.delete(cmd.port);
          c.cash += CHARTER_PRICE / 2;
          return { ok: true, earned: CHARTER_PRICE / 2 };
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of arrivals(e)) {
        const charter = charters.get(s.port);
        if (!charter || charter.owner === s.owner) continue;
        const cut = visitorFee(s.port) / 2;
        const owner = e.companies.get(charter.owner);
        if (owner) { owner.cash += cut; charter.earned += cut; }
      }
    },
    adjust: {
      portFee(v, ctx) {
        const charter = charters.get(ctx.dest);
        if (!charter) return v;
        return charter.owner === ctx.company ? v * 0.5 : v * charter.rate / 100;
      },
    },
    cards(company) {
      const c = e.companies.get(company)!;
      const docked = [...new Set(c.ships.map(id => e.ships.get(id)!).filter(s => s.dest === null).map(s => s.port))];
      const out = [];
      for (const [port, ch] of charters) if (ch.owner === company) out.push({ title: `Your port · ${portName(e, port)}`,
        detail: `Visitors pay ${ch.rate}% of the standard docking fee; you keep half. Earned so far: ${Math.round(ch.earned)}.`,
        actions: [
          { label: "Set dock fee", command: { type: "feature", module: "ports.ownership", action: "setFee", port }, fields: [{ key: "rate", label: "Fee %", min: 50, max: 150, value: ch.rate }] },
          { label: `Sell the charter back (${CHARTER_PRICE / 2})`, command: { type: "feature", module: "ports.ownership", action: "sellCharter", port } },
        ] as FeatureAction[] });
      for (const port of docked) if (!charters.has(port)) out.push({ title: `Charter for sale · ${portName(e, port)}`,
        detail: `Own this port for the season for ${CHARTER_PRICE}. Needs Trusted standing. Your ships dock at half price; you set visitors' fees.`,
        actions: [{ label: "Buy the charter", command: { type: "feature", module: "ports.ownership", action: "buyCharter", port } }] });
      return out;
    },
    world() { return { owners: [...charters].map(([port, ch]) => ({ port, owner: e.companies.get(ch.owner)?.name ?? "?", rate: ch.rate })) }; },
  };
};
