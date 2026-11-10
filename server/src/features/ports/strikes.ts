import type { FeatureFactory } from "../types.js";
import { action, addRep, connected, day, exhibit, fail, hash, isPort, ownDocked, portName } from "./shared.js";

export const STRIKE_DELAY = 6, STRIKE_HOURS = 48, WAGES = 300, UNION_DUES_PER_SHIP = 5;

/** 54 port strikes, resolved by paying the dockers' wages or by waiting; 269 a dockworkers' union whose members'
 *  ships are worked through a strike, for daily dues. Economy: money and travel time. */
export const strikes: FeatureFactory = (e) => {
  const id = "ports.strikes";
  const struck = new Map<number, number>();               // port -> tick the strike ends
  const members = new Set<number>();
  let lastDay = -1;
  const on = (port: number) => (struck.get(port) ?? 0) > e.tick;
  return {
    id, ideas: [54, 269], title: "Strikes and the dockworkers' union", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      switch (cmd.action) {
        case "payWages": {
          if (!isPort(e, cmd.port) || !on(cmd.port)) return fail("there is no strike there");
          if (!ownDocked(e, c.id, cmd.port).length) return fail("dock a ship there to meet the dockers");
          if (c.cash < WAGES) return fail("not enough cash");
          c.cash -= WAGES;
          struck.delete(cmd.port);
          addRep(e, c.id, cmd.port, 15);
          exhibit(e, "strike", c.id, `${c.name} paid the dockers and ended the strike at ${portName(e, cmd.port)}`);
          return { ok: true, spent: WAGES };
        }
        case "join": if (members.has(c.id)) return fail("you are already a member"); members.add(c.id); return { ok: true };
        case "leave": if (!members.delete(c.id)) return fail("you are not a member"); return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      for (const [p, end] of struck) if (end <= e.tick) struck.delete(p);
      if (day(e) === lastDay) return;
      lastDay = day(e);
      const ports = connected(e);
      if (ports.length && hash(53, lastDay) < 0.35) {
        const p = ports[Math.floor(hash(59, lastDay) * ports.length)];
        if (!on(p)) struck.set(p, e.tick + STRIKE_HOURS);
      }
    },
    adjust: {
      travelHours: (v, ctx) => on(ctx.dest) && !members.has(e.ships.get(ctx.ship)?.owner ?? -1) ? v + STRIKE_DELAY : v,
      upkeep: (v, ctx) => members.has(ctx.company) ? v + UNION_DUES_PER_SHIP * (e.companies.get(ctx.company)?.ships.length ?? 0) : v,
    },
    cards(company) {
      const now = [...struck].filter(([p]) => on(p));
      const cards = now.map(([port, end]) => ({ title: `Strike · ${portName(e, port)}`,
        detail: `Dockers are out for ${end - e.tick} more hours. Arrivals take ${STRIKE_DELAY} h longer${members.has(company) ? " (not yours: you are in the union)" : ""}.`,
        actions: ownDocked(e, company, port).length ? [action(id, `Pay the dockers' wages (${WAGES})`, "payWages", { port })] : [] }));
      cards.push({ title: "Dockworkers' union", actions: [members.has(company) ? action(id, "Leave the union", "leave") : action(id, "Join the union", "join")],
        detail: `Members pay ${UNION_DUES_PER_SHIP} credits a day per ship; their ships are worked through strikes.${members.has(company) ? " You are a member." : ""}` });
      return cards;
    },
    view: (company) => ({ member: members.has(company) }),
    world: () => ({ strikes: [...struck].filter(([p]) => on(p)).map(([port, until]) => ({ port, until })) }),
  };
};
