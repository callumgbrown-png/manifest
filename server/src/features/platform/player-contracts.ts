// 600 (economy): player-written contracts. A company posts "deliver Q tonnes of G to port P within H hours" and
// puts the reward in escrow. Another company accepts it, brings the cargo, and delivers from a ship docked at P:
// the cargo goes into that port's market stock and the escrowed reward is paid to the deliverer. Unaccepted or
// failed contracts refund the poster when they expire. Money only moves between the two companies (no money is
// created), but it moves cash and cargo, so the module is economy: true and ships switched off.
import { GOODS } from "../../engine.js";
import { isBlocked } from "./moderation.js";
import { allowAction, cleanText, fail, int, ok, type PlatformFactory } from "./shared.js";

export interface PlayerContract {
  id: number; poster: number; port: number; good: number; qty: number; reward: number;
  posted: number; deadline: number; taker: number | null; note: string | null;
}

export const playerContracts: PlatformFactory = (e) => {
  const open = new Map<number, PlayerContract>();
  const done: { id: number; poster: number; taker: number; tick: number }[] = [];
  let seq = 0;
  const refund = (c: PlayerContract) => { const p = e.companies.get(c.poster); if (p) p.cash += c.reward; open.delete(c.id); };
  return {
    id: "platform.player-contracts", ideas: [600], title: "Player contracts", economy: true,
    apply(cmd) {
      const me = e.companies.get(cmd.company)!;
      if (cmd.action === "post") {
        const port = int(cmd.port, 0, e.n - 1);
        if (port === null) return fail("choose a port");
        const good = typeof cmd.good === "string" ? GOODS.indexOf(cmd.good as never) : int(cmd.good, 0, GOODS.length - 1) ?? -1;
        if (good < 0) return fail("choose a good");
        const qty = int(cmd.qty, 10, 1000);
        if (qty === null) return fail("between 10 and 1000 tonnes");
        const hours = int(cmd.hours, 12, 168);
        if (hours === null) return fail("deadline between 12 and 168 hours");
        const band = e.rules.commodities[GOODS[good]];
        const reward = int(cmd.reward, 1, 10_000_000);
        if (reward === null) return fail("give a whole-number reward");
        // The reward must be at least the floor value of the cargo and at most twice its ceiling value.
        if (reward < qty * band.floor || reward > qty * band.ceiling * 2) return fail(`reward between ${Math.ceil(qty * band.floor)} and ${Math.floor(qty * band.ceiling * 2)}`);
        if (me.cash < reward) return fail("not enough cash for the escrow");
        if ([...open.values()].filter(c => c.poster === cmd.company).length >= 5) return fail("you can have 5 open contracts");
        const note = cmd.note === undefined || cmd.note === "" ? null : cleanText(cmd.note, 120);
        if (!allowAction(e, cmd.company, "player-contract", 10, 24)) return fail("you can post 10 contracts a day");
        me.cash -= reward;
        const c: PlayerContract = { id: ++seq, poster: cmd.company, port, good, qty, reward, posted: e.tick, deadline: e.tick + hours, taker: null, note };
        open.set(c.id, c);
        return { ok: true, id: c.id };
      }
      const id = int(cmd.contract, 1, Number.MAX_SAFE_INTEGER);
      const c = id === null ? undefined : open.get(id);
      if (!c) return fail("no such contract");
      if (cmd.action === "accept") {
        if (c.poster === cmd.company) return fail("you can't take your own contract");
        if (c.taker !== null) return fail("someone already took it");
        if (isBlocked(e, c.poster, cmd.company)) return fail("this company doesn't accept your contracts");
        if ([...open.values()].filter(x => x.taker === cmd.company).length >= 3) return fail("you can work 3 contracts at once");
        c.taker = cmd.company;
        return ok;
      }
      if (cmd.action === "deliver") {
        if (c.taker !== cmd.company) return fail("you haven't accepted this contract");
        const sid = int(cmd.ship, 1, Number.MAX_SAFE_INTEGER);
        const s = sid === null ? undefined : e.ships.get(sid);
        if (!s || s.owner !== cmd.company) return fail("not your ship");
        if (s.dest !== null || s.port !== c.port) return fail("the ship must be docked at the contract port");
        if (s.good !== c.good || s.qty + 1e-6 < c.qty) return fail(`the ship needs ${c.qty} t of ${GOODS[c.good]}`);
        s.qty -= c.qty;
        if (s.qty < 1e-6) { s.qty = 0; s.good = null; s.cost = 0; }
        e.stock[c.port][c.good] += c.qty;
        me.cash += c.reward;
        open.delete(c.id);
        done.push({ id: c.id, poster: c.poster, taker: cmd.company, tick: e.tick });
        if (done.length > 200) done.shift();
        return ok;
      }
      if (cmd.action === "cancel") {
        if (c.poster !== cmd.company) return fail("not your contract");
        if (c.taker !== null) return fail("it has been accepted; it can only expire");
        refund(c);
        return ok;
      }
      if (cmd.action === "abandon") {
        if (c.taker !== cmd.company) return fail("you haven't accepted this contract");
        c.taker = null;
        return ok;
      }
      return fail("unknown action");
    },
    advance() { for (const c of [...open.values()]) if (e.tick >= c.deadline) refund(c); },
    cards: (company) => {
      const board = [...open.values()].filter(c => c.poster !== company && c.taker === null && !isBlocked(e, c.poster, company)).slice(0, 10);
      const port = e.companies.get(company)?.home ?? 0;
      return [
        { title: "Post a contract", detail: "Ask other players to bring cargo to a port. The reward is held in escrow and refunded if nobody delivers in time.",
          actions: [{ label: "Post", command: { type: "feature", module: "platform.player-contracts", action: "post" },
            fields: [{ key: "port", label: "Port", options: e.map.ports.map(p => ({ value: p.id, label: p.name })), value: port },
              { key: "good", label: "Good", options: GOODS.map(g => ({ value: g, label: g })) },
              { key: "qty", label: "Tonnes", min: 10, max: 1000, value: 50 },
              { key: "reward", label: "Reward", min: 1, max: 10_000_000, value: 5000 },
              { key: "hours", label: "Hours", min: 12, max: 168, value: 48 }] }] },
        ...board.map(c => ({ title: `${c.qty} t ${GOODS[c.good]} to ${e.map.ports[c.port]?.name}`,
          detail: `Reward ${c.reward}, ${c.deadline - e.tick} hours left.${c.note ? ` "${c.note}"` : ""}`,
          actions: [{ label: "Accept", command: { type: "feature", module: "platform.player-contracts", action: "accept", contract: c.id } }] })),
      ];
    },
    view: (company) => ({
      posted: [...open.values()].filter(c => c.poster === company),
      taken: [...open.values()].filter(c => c.taker === company),
      completed: done.filter(d => d.poster === company || d.taker === company).length,
    }),
    world: () => ({ open: [...open.values()].filter(c => c.taker === null).length }),
  };
};
