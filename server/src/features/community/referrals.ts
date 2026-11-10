// Idea 536: cosmetic referral rewards. Every company has a referral tag. A new company (no finished voyages yet) can
// enter a friend's tag once; the referral counts when the new company has finished 3 voyages, so empty sign-ups earn
// nothing. Rewards are cosmetics only: both get the Shipmates flag; the referrer also gets the friendship wake at 2,
// the handshake logo at 3 and the Harbour host badge at 5 qualified referrals.
import type { FeatureFactory } from "../types.js";
import { sha256 } from "./content.js";
import { companyName, fail, OK } from "./shared.js";
import { grant } from "./store.js";

export const QUALIFY_VOYAGES = 3;
export const REWARDS: [number, string][] = [[1, "flag.shipmates"], [2, "wake.friendship"], [3, "logo.handshake"], [5, "badge.referrer"]];
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A company's tag: fixed, not secret, and unrelated to anything personal. */
export function referralTag(company: number): string {
  const h = sha256(`manifest-referral-v1:${company}`);
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHA[parseInt(h.slice(i * 2, i * 2 + 2), 16) % ALPHA.length];
  return `SHIP-${out}`;
}

export const referralsModule: FeatureFactory = (e) => {
  const id = "community.referrals";
  const referredBy = new Map<number, number>();   // new company -> referrer
  const qualified = new Map<number, Set<number>>();  // referrer -> qualified new companies
  const finishedVoyages = (company: number) => (e.trips.get(company) ?? []).filter(t => !t.open && t.good !== null).length;
  const tagOwner = (tag: string) => [...e.companies.keys()].find(c => referralTag(c) === tag);
  return {
    id, ideas: [536], title: "Invite a friend", economy: false,
    apply(cmd) {
      if (cmd.action !== "enterTag") return fail("unknown action");
      if (typeof cmd.tag !== "string" || !/^SHIP-[A-Z0-9]{6}$/.test(cmd.tag.trim().toUpperCase())) return fail("tags look like SHIP-ABC234");
      if (referredBy.has(cmd.company)) return fail("you have already entered a tag");
      if (finishedVoyages(cmd.company) > 0) return fail("tags can only be entered before your first finished voyage");
      const owner = tagOwner(cmd.tag.trim().toUpperCase());
      if (owner === undefined) return fail("no company has that tag");
      if (owner === cmd.company) return fail("you cannot refer yourself");
      if (referredBy.get(owner) === cmd.company) return fail("you cannot refer each other");
      referredBy.set(cmd.company, owner);
      return OK;
    },
    advance() {
      for (const [fresh, referrer] of referredBy) {
        if (qualified.get(referrer)?.has(fresh) || !e.companies.has(referrer) || finishedVoyages(fresh) < QUALIFY_VOYAGES) continue;
        const set = qualified.get(referrer) ?? new Set<number>();
        set.add(fresh); qualified.set(referrer, set);
        grant(e, fresh, "flag.shipmates");
        for (const [need, item] of REWARDS) if (set.size >= need) grant(e, referrer, item);
      }
    },
    cards(company) {
      const n = qualified.get(company)?.size ?? 0, pending = [...referredBy.values()].filter(r => r === company).length - n;
      return [{ title: "Invite a friend", detail: `Your tag is ${referralTag(company)}. A new player who enters it before their first finished voyage counts once they finish ${QUALIFY_VOYAGES} voyages. `
        + `Qualified: ${n}${pending > 0 ? `, waiting: ${pending}` : ""}. Rewards are cosmetic.` + (referredBy.has(company) ? `\nYou were invited by ${companyName(e, referredBy.get(company)!)}.` : "") }];
    },
    view(company) {
      return { tag: referralTag(company), qualified: qualified.get(company)?.size ?? 0, invitedBy: referredBy.has(company) ? companyName(e, referredBy.get(company)!) : null,
        canEnter: !referredBy.has(company) && finishedVoyages(company) === 0 };
    },
  };
};
