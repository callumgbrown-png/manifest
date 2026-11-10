import { Engine, GOODS, type Command } from "./engine.js";

export interface RecoveryOption {
  kind: "sell" | "scrap" | "refund" | "listing" | "arrival";
  label: string;
  amount: number;
  cashAfter: number;
  immediate: boolean;
  ship?: number;
  port?: number;
}

/** Read-only guidance. Commands still pass through Engine.apply when selected. */
export function recoveryView(engine: Engine, company: number, attempted?: Command) {
  const c = engine.companies.get(company)!;
  const tax = engine.rules.fees.trade_tax_rate;
  const options: RecoveryOption[] = [];
  const add = (option: Omit<RecoveryOption, "cashAfter">) => {
    if (option.amount > 0 && Number.isFinite(option.amount)) options.push({ ...option, cashAfter: c.cash + option.amount });
  };
  if (!engine.seasonOver) {
    for (const id of c.ships) {
      const s = engine.ships.get(id)!;
      if (s.dest !== null) {
        if (s.qty > 0 && s.good !== null && s.arriveTick < engine.seasonHours) {
          add({ kind: "arrival", label: `After Ship ${id} docks, sell its cargo at ${engine.map.ports[s.dest].name}`, amount: engine.sellValue(s.dest, s.good, s.qty) * (1 - tax) - engine.rules.fees.port_fee_per_docking, immediate: false, ship: id, port: s.dest });
        }
        continue;
      }
      if (s.qty > 0 && s.good !== null) {
        if (engine.maritime.hasLoot(s)) continue;
        add({ kind: "sell", label: `Sell the cargo on Ship ${id}`, amount: engine.sellValue(s.port, s.good, s.qty) * (1 - tax), immediate: true, ship: id, port: s.port });
        // A waiting funded buy order can be better than the port market.
        for (const o of engine.orders.values()) {
          if (o.side !== "buy" || o.reservation || o.owner === company || o.port !== s.port || o.good !== s.good) continue;
          add({ kind: "sell", label: `Sell ${Math.min(s.qty, o.qty)} ${GOODS[s.good]} from Ship ${id} to buy order ${o.id}`, amount: Math.min(s.qty, o.qty) * o.price * (1 - tax), immediate: true, ship: id, port: s.port });
        }
      } else if (c.ships.length > 1) {
        add({ kind: "scrap", label: `Scrap spare ${s.type} Ship ${id}`, amount: engine.spec(s.type).price / 2, immediate: true, ship: id, port: s.port });
      }
    }
    for (const o of engine.orders.values()) {
      if (o.owner !== company || o.reservation) continue;
      if (o.side === "buy") add({ kind: "refund", label: `Cancel buy order ${o.id} to release held cash`, amount: o.qty * o.price, immediate: true, port: o.port });
      else add({ kind: "listing", label: `Wait for buyers of your ${GOODS[o.good]} listing at ${engine.map.ports[o.port].name}`, amount: o.qty * o.price * (1 - tax), immediate: false, port: o.port });
    }
  }
  // Prefer cargo to selling fleet capacity. Alternatives are independent, never added together.
  const priority = { sell: 0, refund: 1, scrap: 2, arrival: 3, listing: 4 };
  options.sort((a, b) => priority[a.kind] - priority[b.kind] || b.amount - a.amount);
  const required = attempted ? engine.cashRequired(attempted) : null;
  const shortfall = required === null ? 0 : Math.max(0, required - (attempted?.type === "sail" && c.ships.length === 1 ? Math.max(0, c.cash) : c.cash));
  return {
    active: c.cash < 0 || shortfall > 0,
    cash: c.cash,
    shortfall,
    options,
    explanation: engine.seasonOver ? "The season has ended. Trading is closed until the next season starts."
      : options.some(o => o.immediate) ? "Cargo needs cash. Only your last ship's fuel can go on credit. These are separate options, after trade tax."
      : options.length ? "No cash is available immediately. Arrivals and listing sales may help; prices can change and listings need a buyer."
      : "No cash-raising action is available now. You have no docked cargo, eligible empty spare ship, held cash or pending cargo sale. Waiting alone does not clear debt. Your last ship can sail on fuel credit, but an empty trip earns no cash and adds debt.",
  };
}
