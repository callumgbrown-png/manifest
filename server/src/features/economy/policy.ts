// Market policy: cartels (211), antitrust events (212), a wealth tax that funds public festivals (208) and money sinks
// that fight inflation (207). All move money or prices, so all are economy modules and ship off.
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, credits, day, fail, goodField, isEngineGood, laneTraffic, Notes, ok, portName, ranking } from "./util.js";

// ------------------------------------------------------------ 211: cartels

export const CARTEL_RISK_PER_MEMBER = 0.03, CARTEL_FINE = 0.1;
export const cartels: FeatureFactory = (e) => {
  const id = "economy.cartels";
  const members = GOODS.map(() => new Set<number>());
  const notes = new Notes();
  let busted: { good: number; day: number } | null = null;
  const active = (g: number) => members[g].size >= 2;
  return {
    id, ideas: [211], title: "Cartels", economy: true,
    apply(cmd) {
      switch (cmd.action) {
        case "join": {
          if (!isEngineGood(cmd.good)) return fail("choose a good");
          if (members.some(m => m.has(cmd.company))) return fail("you are already in a cartel");
          members[cmd.good].add(cmd.company);
          return ok;
        }
        case "leave": {
          if (!members.some(m => m.delete(cmd.company))) return fail("you are not in a cartel");
          return ok;
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      for (let g = 0; g < GOODS.length; g++) {
        for (const c of [...members[g]]) if (!e.companies.has(c)) members[g].delete(c);
        if (!active(g)) continue;
        // Members hold back supply: consumer ports run a little shorter, so their prices rise.
        for (let p = 0; p < e.n; p++) if (e.map.ports[p].consumes.includes(GOODS[g])) e.stock[p][g] = Math.max(0, e.stock[p][g] - e.targets[g] * 0.01);
        if (e.tick % 24 !== 20) continue;
        const risk = CARTEL_RISK_PER_MEMBER * members[g].size * (e.features.enabled("economy.antitrust") ? 2 : 1);
        if (e.features.random() >= risk) continue;
        for (const id of members[g]) {
          const c = e.companies.get(id);
          if (!c) continue;
          const fine = Math.max(0, c.cash) * CARTEL_FINE;
          c.cash -= fine;
          notes.add(id, `Regulators broke up the ${GOODS[g]} cartel. Your fine: ${credits(fine)}.`);
        }
        members[g].clear();
        busted = { good: g, day: day(e) };
      }
    },
    world() { return { cartels: GOODS.map((_, g) => members[g].size), busted }; },
    view(company) { const g = members.findIndex(m => m.has(company)); return { good: g >= 0 ? g : null, notes: notes.of(company) }; },
    cards(company) {
      const g = members.findIndex(m => m.has(company));
      const lines = GOODS.map((name, i) => members[i].size ? `${name}: ${members[i].size} members${active(i) ? " (fixing prices)" : ""}` : "").filter(Boolean);
      return [{ title: "Cartels", detail: [`With two or more members, a cartel holds back supply and lifts what consumer ports pay. Every day there is a ${CARTEL_RISK_PER_MEMBER * 100}% chance per member of an investigation; each member is fined ${CARTEL_FINE * 100}% of cash.`, ...lines, ...notes.of(company).slice(-2)].join("\n"),
        actions: g >= 0 ? [action(id, `Leave the ${GOODS[g]} cartel`, "leave")] : [action(id, "Join a cartel", "join", {}, [goodField()])] }];
    },
  };
};

// ------------------------------------------------------------ 212: antitrust events

export const ANTITRUST_SHARE = 0.4, ANTITRUST_FINE = 0.03, LANE_SHARE = 0.6;
export const antitrust: FeatureFactory = (e) => {
  const cases: { company: number; day: number; reason: string; fine: number }[] = [];
  const fine = (company: number, reason: string) => {
    const c = e.companies.get(company);
    if (!c) return;
    const amount = Math.max(0, c.cash) * ANTITRUST_FINE;
    c.cash -= amount;
    cases.push({ company, day: day(e), reason, fine: Math.round(amount) });
    if (cases.length > 8) cases.shift();
  };
  return {
    id: "economy.antitrust", ideas: [212], title: "Antitrust", economy: true,
    advance() {
      if (e.tick % 24 !== 18 || e.companies.size < 3) return;
      const worth = [...e.companies.values()].map(c => ({ id: c.id, w: Math.max(0, e.netWorth(c)) }));
      const total = worth.reduce((s, x) => s + x.w, 0);
      const top = worth.sort((a, b) => b.w - a.w || a.id - b.id)[0];
      if (total > 0 && top.w / total > ANTITRUST_SHARE) { fine(top.id, `holds ${Math.round(top.w / total * 100)}% of all wealth`); return; }
      // A company running most of the ships on a busy lane.
      const perLane = new Map<string, Map<number, number>>();
      for (const s of e.ships.values()) {
        if (s.dest === null || s.type === "pirate") continue;
        const k = s.port < s.dest ? `${s.port}-${s.dest}` : `${s.dest}-${s.port}`;
        const m = perLane.get(k) ?? new Map<number, number>();
        m.set(s.owner, (m.get(s.owner) ?? 0) + 1);
        perLane.set(k, m);
      }
      for (const [k, n] of [...laneTraffic(e)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
        if (n < 4) break;
        const [owner, count] = [...perLane.get(k)!].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        if (count / n > LANE_SHARE) { fine(owner, `runs ${count} of ${n} ships between ${k.split("-").map(p => portName(e, Number(p))).join(" and ")}`); return; }
      }
    },
    world() { return { cases: cases.map(c => ({ ...c, name: e.companies.get(c.company)?.name ?? "?" })) }; },
    cards() {
      return [{ title: "Antitrust", detail: [`Regulators fine a company ${ANTITRUST_FINE * 100}% of its cash if it holds over ${ANTITRUST_SHARE * 100}% of all wealth, or runs over ${LANE_SHARE * 100}% of the ships on a busy lane.`,
        ...cases.slice(-3).map(c => `Day ${c.day + 1}: ${e.companies.get(c.company)?.name ?? "?"} ${c.reason}; fined ${credits(c.fine)}.`)].join("\n") }];
    },
  };
};

// ------------------------------------------------------------ 208: wealth tax that funds public events

export const WEALTH_TAX = 0.005, FESTIVAL_COST = 20_000;
export const wealthTax: FeatureFactory = (e) => {
  let fund = 0;
  const festivals: { port: number; day: number }[] = [];
  return {
    id: "economy.wealth-tax", ideas: [208], title: "Wealth tax", economy: true,
    advance() {
      if (e.tick % 24 !== 0) return;
      const threshold = e.rules.company.start_cash * 2;
      for (const id of ranking(e).slice(0, 3)) {
        const c = e.companies.get(id)!;
        const tax = Math.min(Math.max(0, c.cash), Math.max(0, e.netWorth(c) - threshold) * WEALTH_TAX);
        c.cash -= tax;
        fund += tax;
      }
      if (fund >= FESTIVAL_COST) {
        // A harbour festival: the town buys up everything it uses, so those prices jump for a while.
        const port = Math.floor(e.features.random() * e.n);
        for (let g = 0; g < GOODS.length; g++) if (e.map.ports[port].consumes.includes(GOODS[g])) e.stock[port][g] = Math.max(0, e.stock[port][g] - e.targets[g] * 0.5);
        fund -= FESTIVAL_COST;
        festivals.push({ port, day: day(e) });
        if (festivals.length > 5) festivals.shift();
      }
    },
    world() { return { fund: Math.round(fund), festivals }; },
    cards() {
      return [{ title: "Wealth tax", detail: [`The three richest companies pay ${WEALTH_TAX * 100}% a day on net worth over twice the starting cash. Every ${credits(FESTIVAL_COST)} collected pays for a harbour festival that buys up the town's goods.`,
        `Fund: ${credits(fund)}.`, ...festivals.slice(-2).map(f => `Day ${f.day + 1}: festival in ${portName(e, f.port)}.`)].join("\n") }];
    },
  };
};

// ------------------------------------------------------------ 207: money sinks

export const PRESTIGE = { pennant: { name: "Company pennant", cost: 2_000 }, statue: { name: "Founder's statue", cost: 5_000 }, lighthouse: { name: "Private lighthouse", cost: 10_000 } } as const;
type Item = keyof typeof PRESTIGE;
export const DUES_RATE = 0.002, DUES_FREE = 100_000;
export const moneySinks: FeatureFactory = (e) => {
  const id = "economy.money-sinks";
  const owned = new Map<number, Set<Item>>();
  const dues = new Map<number, number>();
  return {
    id, ideas: [207], title: "Prestige and harbour dues", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      if (typeof cmd.item !== "string" || !(cmd.item in PRESTIGE)) return fail("unknown item");
      const item = cmd.item as Item, c = e.companies.get(cmd.company)!;
      const mine = owned.get(c.id) ?? new Set<Item>();
      if (mine.has(item)) return fail("you already own that");
      if (c.cash < PRESTIGE[item].cost) return fail("not enough cash");
      c.cash -= PRESTIGE[item].cost;
      mine.add(item);
      owned.set(c.id, mine);
      return ok;
    },
    advance() {
      if (e.tick % 24 !== 0) return;
      for (const c of e.companies.values()) {
        const due = Math.max(0, c.cash - DUES_FREE) * DUES_RATE;
        if (due <= 0) continue;
        c.cash -= due;
        dues.set(c.id, (dues.get(c.id) ?? 0) + due);
      }
    },
    view(company) { return { owned: [...(owned.get(company) ?? [])].sort(), dues: Math.round(dues.get(company) ?? 0) }; },
    world() { return { owners: [...owned].filter(([, s]) => s.size).map(([c, s]) => ({ company: c, items: [...s].sort() })) }; },
    cards(company) {
      const mine = owned.get(company) ?? new Set<Item>();
      const left = (Object.keys(PRESTIGE) as Item[]).filter(k => !mine.has(k));
      return [{ title: "Prestige and harbour dues", detail: `Cash over ${credits(DUES_FREE)} pays ${DUES_RATE * 100}% a day in harbour dues (paid so far: ${credits(dues.get(company) ?? 0)}).\nOwned: ${[...mine].map(k => PRESTIGE[k].name).join(", ") || "nothing yet"}.`,
        actions: left.map(k => action(id, `Buy ${PRESTIGE[k].name} (${credits(PRESTIGE[k].cost)})`, "buy", { item: k })) }];
    },
  };
};
