// Idea 228: insurance tiers, and idea 230: towing services from other players. Both move money, so both are economy
// modules (off until approved).
//
// Insurance: a company picks a tier for its whole fleet. The premium is added to the daily upkeep. Cover pays part
// of hull repairs (ships.wear asks repairShare) and settles cargo losses other modules record in shared().losses.
//
// Towing: a ship that broke down at sea (ships.wear) can post a tow request with a reward. Another company with a
// ship docked anywhere can take the job: it is paid the reward and the breakdown delay is cleared.
import type { Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, credits, fail, int, note, OK, ownShip, peer, shared, shipName } from "./shared.js";
import type { WearApi } from "./wear.js";

export const TIERS = { none: { premium: 0, repairs: 0, cargo: 0 }, basic: { premium: 0.003, repairs: 0.5, cargo: 0.5 }, full: { premium: 0.006, repairs: 0.8, cargo: 0.9 } } as const;
export type Tier = keyof typeof TIERS;
const TIER_TEXT: Record<Tier, string> = { none: "No cover", basic: "Basic", full: "Full" };

export const insurance: FeatureFactory = (e) => {
  const id = "ships.insurance";
  const tiers = new Map<number, Tier>();
  const paid = new Map<number, number>();   // company -> claims paid this season
  const tierOf = (company: number): Tier => tiers.get(company) ?? "none";
  const mod: FeatureModule & { repairShare(ship: number): number } = {
    id, ideas: [228], title: "Ship insurance", economy: true,
    repairShare(ship) { const s = e.ships.get(ship); return s ? TIERS[tierOf(s.owner)].repairs : 0; },
    apply(cmd) {
      if (cmd.action !== "setTier") return fail("unknown action");
      if (typeof cmd.tier !== "string" || !(cmd.tier in TIERS)) return fail("choose a tier");
      tiers.set(cmd.company, cmd.tier as Tier);
      return OK;
    },
    advance() {
      const losses = shared(e).losses;
      for (const loss of losses.splice(0)) {
        const c = e.companies.get(loss.owner);
        const share = TIERS[tierOf(loss.owner)].cargo;
        if (!c || share <= 0 || !(loss.amount > 0)) continue;
        const payout = loss.amount * share;
        c.cash += payout;
        paid.set(c.id, (paid.get(c.id) ?? 0) + payout);
        if (e.ships.has(loss.ship)) note(e, loss.ship, `Insurers paid ${credits(payout)} for the ${loss.kind}.`);
      }
    },
    adjust: {
      upkeep: (u, ctx) => {
        const c = e.companies.get(ctx.company), rate = TIERS[tierOf(ctx.company)].premium;
        if (!c || rate <= 0) return u;
        let value = 0;
        for (const i of c.ships) { const s = e.ships.get(i); if (s) value += e.spec(s.type).price; }
        return u + value * rate;
      },
    },
    cards(company) {
      const t = tierOf(company);
      return [{ title: "Ship insurance",
        detail: `Basic cover costs 0.3% of your fleet's new value a day and pays half of hull repairs and half of cargo lost at sea. Full cover costs 0.6% and pays 80% of repairs and 90% of lost cargo.\nYour cover: ${TIER_TEXT[t]}. Claims paid this season: ${credits(paid.get(company) ?? 0)}.`,
        actions: [{ ...action(id, "Change cover", "setTier"), fields: [{ key: "tier", label: "Cover", options: (Object.keys(TIERS) as Tier[]).map(k => ({ value: k, label: TIER_TEXT[k] })) }] }] }];
    },
    view(company) { return { tier: tierOf(company), paid: paid.get(company) ?? 0 }; },
  };
  return mod;
};

interface TowRequest { ship: number; owner: number; reward: number; since: number }
export const towing: FeatureFactory = (e) => {
  const id = "ships.towing";
  const requests = new Map<number, TowRequest>();
  const wear = () => peer<WearApi>(e, "ships.wear");
  const live = (r: TowRequest) => { const s = e.ships.get(r.ship); return !!s && s.owner === r.owner && s.dest !== null && !!wear()?.brokenDown(r.ship); };
  return {
    id, ideas: [230], title: "Towing", economy: true,
    apply(cmd) {
      switch (cmd.action) {
        case "request": {
          const s = ownShip(e, cmd.company, cmd.ship);
          if (!s) return fail("not your ship");
          if (!wear()) return fail("hull wear is not in play in this world");
          if (s.dest === null || !wear()!.brokenDown(s.id)) return fail("only a ship broken down at sea needs a tow");
          if (requests.has(s.id)) return fail("a tow is already requested");
          const reward = int(cmd.reward, 1, 100_000);
          if (reward === undefined) return fail("offer a reward");
          if (e.companies.get(cmd.company)!.cash < reward) return fail("not enough cash for that reward");
          requests.set(s.id, { ship: s.id, owner: cmd.company, reward, since: e.tick });
          note(e, s.id, `Called for a tow, offering ${credits(reward)}.`);
          return OK;
        }
        case "cancel": {
          const r = typeof cmd.ship === "number" ? requests.get(cmd.ship) : undefined;
          if (!r || r.owner !== cmd.company) return fail("you have no such request");
          requests.delete(r.ship);
          return OK;
        }
        case "accept": {
          const r = typeof cmd.ship === "number" ? requests.get(cmd.ship) : undefined;
          if (!r) return fail("that tow is no longer needed");
          if (r.owner === cmd.company) return fail("you cannot tow your own ship for a reward");
          if (!live(r)) { requests.delete(r.ship); return fail("that tow is no longer needed"); }
          const tower = e.companies.get(cmd.company)!, owner = e.companies.get(r.owner);
          if (!owner) { requests.delete(r.ship); return fail("that tow is no longer needed"); }
          if (!tower.ships.some(i => e.ships.get(i)?.dest === null)) return fail("you need a ship in port to send out");
          if (owner.cash < r.reward) { requests.delete(r.ship); return fail("the owner can no longer pay the reward"); }
          const saved = wear()!.clearBreakdown(r.ship);
          owner.cash -= r.reward;
          tower.cash += r.reward;
          requests.delete(r.ship);
          note(e, r.ship, `${tower.name} towed the ship back on course for ${credits(r.reward)}, saving ${saved} hours.`);
          return { ok: true, earned: r.reward };
        }
        default: return fail("unknown action");
      }
    },
    advance() { for (const r of [...requests.values()]) if (!live(r)) requests.delete(r.ship); },
    cards(company) {
      const c = e.companies.get(company);
      if (!c || !wear()) return [];
      const brokenMine = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.dest !== null && !!wear()!.brokenDown(s.id) && !requests.has(s.id));
      const others = [...requests.values()].filter(r => r.owner !== company);
      const mine = [...requests.values()].filter(r => r.owner === company);
      if (!brokenMine.length && !others.length && !mine.length) return [];
      return [{ title: "Towing",
        detail: `A ship broken down at sea can call for a tow. Another company with a ship in port can take the job for the reward offered, and the breakdown delay is cleared.`
          + (others.length ? `\nTows wanted:\n${others.map(r => `${shipName(e, r.ship)} (${e.companies.get(r.owner)?.name ?? "?"}): ${credits(r.reward)}`).join("\n")}` : ""),
        actions: [
          ...(brokenMine.length ? [{ ...action(id, "Call for a tow", "request"), fields: [{ key: "ship", label: "Ship", options: brokenMine.map(s => ({ value: s.id, label: shipName(e, s.id) })) }, { key: "reward", label: "Reward", min: 1, max: 100000, value: 150 }] }] : []),
          ...others.slice(0, 6).map(r => action(id, `Tow ${shipName(e, r.ship)} for ${credits(r.reward)}`, "accept", { ship: r.ship })),
          ...mine.map(r => action(id, `Cancel the tow request (${shipName(e, r.ship)})`, "cancel", { ship: r.ship })),
        ] }];
    },
    world() { return [...requests.values()].map(r => ({ ship: r.ship, reward: r.reward })); },
  };
};
