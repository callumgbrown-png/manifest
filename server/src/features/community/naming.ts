// Idea 183 (community.dedications, on): port dedications paid with naming tokens. Early Discord testers and race
// winners get tokens through unlock codes; a token names a quay at a port for the rest of the season ("Smith's Quay").
// Idea 175 (community.naming, economy, off): the same, or naming a ship's public nameboard, paid with in-game credits.
// Names go through the shared name filter; one dedication per port.
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { cleanName } from "./content.js";
import { companyName, fail, isInt, OK } from "./shared.js";
import { locker, peek } from "./store.js";

export const PORT_PRICE = 5000, SHIP_PRICE = 750;
interface Dedication { company: number; name: string; tick: number; paid: boolean }
const shared = new WeakMap<Engine, { ports: Map<number, Dedication>; ships: Map<number, string> }>();
const names = (e: Engine) => { let s = shared.get(e); if (!s) shared.set(e, s = { ports: new Map(), ships: new Map() }); return s; };

function dedicate(e: Engine, company: number, port: unknown, name: unknown, paid: boolean) {
  if (!isInt(port, 0, e.n - 1)) return fail("choose a port");
  const clean = cleanName(name, 24);
  if (!clean) return fail("names are 2-24 letters, digits and spaces, with no links or rude words");
  const d = names(e).ports.get(port);
  if (d && d.company !== company) return fail(`that port is already dedicated to ${companyName(e, d.company)}`);
  names(e).ports.set(port, { company, name: clean, tick: e.tick, paid });
  return OK;
}
const portList = (e: Engine) => [...names(e).ports].filter(([, d]) => e.companies.has(d.company))
  .map(([port, d]) => ({ port, name: d.name, company: d.company, by: companyName(e, d.company) }));

export const dedicationsModule: FeatureFactory = (e) => {
  const id = "community.dedications";
  return {
    id, ideas: [183], title: "Port dedications", economy: false,
    apply(cmd) {
      if (cmd.action !== "dedicate") return fail("unknown action");
      if (peek(e, cmd.company).naming < 1) return fail("you have no dedication tokens");
      const r = dedicate(e, cmd.company, cmd.port, cmd.name, false);
      if (r.ok) locker(e, cmd.company).naming -= 1;
      return r;
    },
    cards(company) {
      const tokens = peek(e, company).naming;
      if (tokens < 1) return [];
      return [{ title: "Dedicate a quay", detail: `You have ${tokens} dedication token(s). A dedication names a quay at a port for the rest of the season. Open the Community panel to choose the port and the name.` }];
    },
    world() { return portList(e); },
  };
};

export const namingModule: FeatureFactory = (e) => {
  const id = "community.naming";
  const pay = (company: number, price: number) => {
    const c = e.companies.get(company)!;
    if (c.cash < price) return false;
    c.cash -= price;
    return true;
  };
  return {
    id, ideas: [175], title: "Paid naming", economy: true,
    apply(cmd) {
      if (cmd.action === "namePort") {
        if (e.companies.get(cmd.company)!.cash < PORT_PRICE) return fail("not enough cash");
        const check = dedicate(e, cmd.company, cmd.port, cmd.name, true);
        if (!check.ok) return check;
        pay(cmd.company, PORT_PRICE);
        return { ok: true, spent: PORT_PRICE };
      }
      if (cmd.action === "nameShip") {
        const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
        if (!s || s.owner !== cmd.company) return fail("not your ship");
        const clean = cleanName(cmd.name, 20);
        if (!clean) return fail("names are 2-20 letters, digits and spaces, with no links or rude words");
        if (!pay(cmd.company, SHIP_PRICE)) return fail("not enough cash");
        names(e).ships.set(s.id, clean);
        return { ok: true, spent: SHIP_PRICE };
      }
      return fail("unknown action");
    },
    world() {
      return { ports: portList(e), ships: Object.fromEntries([...names(e).ships].filter(([s]) => e.ships.has(s))) };
    },
  };
};
