import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { GOOD, action, addRep, arrivals, day, dockedPorts, exhibit, fail, hash, inRange, isPort, loadCargo, ownDocked, portName, shipOptions, sites, takeCargo, workShip } from "./shared.js";

export const airfields = (e: Engine) => sites(e, 89, 0.25, 2);

/** Today's courier parcel: from one airfield to another. */
export function parcelOf(e: Engine, d = day(e)) {
  const a = airfields(e);
  if (a.length < 2) return undefined;
  const from = a[Math.floor(hash(97, d) * a.length)];
  const rest = a.filter(p => p !== from);
  return { day: d, from, to: rest[Math.floor(hash(101, d) * rest.length)] };
}

/** 58 airfreight (content): airfields at a few ports and a daily air-courier parcel. Pick it up at one airfield and
 *  land any of your ships at the other for standing at both. The cargo flights themselves are in ports.airfreight-effects. */
export const airfreight: FeatureFactory = (e) => {
  const id = "ports.airfreight";
  const carrying = new Map<number, { day: number; from: number; to: number }>();   // company -> parcel
  const delivered = new Map<number, number>();
  return {
    id, ideas: [58], title: "Airfields and couriers", economy: false,
    apply(cmd) {
      if (cmd.action !== "pickup") return fail("unknown action");
      const p = parcelOf(e);
      if (!p) return fail("no parcel today");
      if (carrying.get(cmd.company)?.day === p.day) return fail("you already carry today's parcel");
      if (!ownDocked(e, cmd.company, p.from).length) return fail(`dock a ship at ${portName(e, p.from)} to collect it`);
      carrying.set(cmd.company, p);
      return { ok: true };
    },
    advance() {
      for (const s of arrivals(e)) {
        const p = carrying.get(s.owner);
        if (!p || p.to !== s.port) continue;
        carrying.delete(s.owner);
        delivered.set(s.owner, (delivered.get(s.owner) ?? 0) + 1);
        addRep(e, s.owner, p.to, 4); addRep(e, s.owner, p.from, 2);
        if (delivered.get(s.owner) === 5) exhibit(e, "courier", s.owner, `${e.companies.get(s.owner)?.name} delivered five air parcels`);
      }
    },
    cards(company) {
      const p = parcelOf(e), mine = carrying.get(company);
      const can = p && !mine && ownDocked(e, company, p.from).length;
      return [{ title: "Air courier", detail: `Airfields: ${airfields(e).map(a => portName(e, a)).join(", ")}.\n${p ? `Today's parcel: ${portName(e, p.from)} to ${portName(e, p.to)}.` : "No parcel today."}${mine ? `\nYou carry a parcel for ${portName(e, mine.to)}.` : ""}`,
        actions: can ? [action(id, "Collect the parcel", "pickup")] : [] }];
    },
    view: (company) => ({ carrying: carrying.get(company) ?? null, delivered: delivered.get(company) ?? 0 }),
    world: () => ({ airfields: airfields(e), parcel: parcelOf(e) ?? null }),
  };
};

export const AIR_MAX = 5, AIR_HOURS = 6, AIR_FEE_PER_T = 20;

/** Economy side of 58: fly up to 5 t of machinery between your ships at two airfields in six hours, for a fee. */
export const airfreightEffects: FeatureFactory = (e) => {
  const id = "ports.airfreight-effects";
  const flights: { company: number; to: number; ship: number; qty: number; cost: number; due: number }[] = [];
  return {
    id, ideas: [58], title: "Air cargo flights", economy: true,
    apply(cmd) {
      if (cmd.action !== "fly") return fail("unknown action");
      const c = e.companies.get(cmd.company)!;
      const from = workShip(e, c.id, cmd.ship), a = airfields(e);
      if (!from || !a.includes(from.port) || from.good !== GOOD.machinery || from.qty < 1) return fail("choose a ship with machinery docked at an airfield");
      if (!isPort(e, cmd.to) || cmd.to === from.port || !a.includes(cmd.to)) return fail("choose another airfield");
      const target = workShip(e, c.id, cmd.target, cmd.to);
      if (!target || (target.qty > 0 && target.good !== GOOD.machinery)) return fail("choose your empty (or machinery) ship docked at that airfield");
      if (!inRange(cmd.qty, 1, Math.min(AIR_MAX, from.qty))) return fail(`fly 1 to ${Math.min(AIR_MAX, from.qty)} t`);
      const fee = cmd.qty * AIR_FEE_PER_T;
      if (c.cash < fee) return fail("not enough cash");
      const cost = from.cost * cmd.qty / from.qty;
      takeCargo(e, from, cmd.qty);
      c.cash -= fee;
      flights.push({ company: c.id, to: cmd.to, ship: target.id, qty: cmd.qty, cost, due: e.tick + AIR_HOURS });
      return { ok: true, spent: fee };
    },
    advance() {
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        if (f.due > e.tick) continue;
        flights.splice(i, 1);
        const s = e.ships.get(f.ship);
        const ready = s && s.owner === f.company && s.dest === null && s.port === f.to && (!s.qty || s.good === GOOD.machinery) && e.expansionCapacity(s) - s.qty >= f.qty;
        if (ready) loadCargo(e, s, GOOD.machinery, f.qty, f.cost);
        else { const c = e.companies.get(f.company); if (c) c.cash += f.cost; }   // nowhere to land it: the yard buys it at cost
      }
    },
    cards(company) {
      const a = airfields(e), here = dockedPorts(e, company).filter(p => a.includes(p));
      const sources = here.flatMap(p => ownDocked(e, company, p)).filter(s => s.good === GOOD.machinery && s.qty > 0);
      const targets = here.flatMap(p => ownDocked(e, company, p)).filter(s => !s.qty || s.good === GOOD.machinery);
      return sources.length && targets.length > 0 ? [{ title: "Air cargo", detail: `Fly up to ${AIR_MAX} t of machinery to your ship at another airfield in ${AIR_HOURS} h for ${AIR_FEE_PER_T} credits a tonne.`,
        actions: [{ ...action(id, "Fly machinery", "fly"), fields: [{ key: "ship", label: "From ship", options: shipOptions(sources) },
          { key: "to", label: "To airfield", options: a.map(p => ({ value: p, label: portName(e, p) })) },
          { key: "target", label: "To ship", options: shipOptions(targets) }, { key: "qty", label: "Tonnes", min: 1, max: AIR_MAX, value: AIR_MAX }] }] }] : [];
    },
    view: (company) => flights.filter(f => f.company === company).map(f => ({ to: f.to, qty: f.qty, due: f.due })),
  };
};
