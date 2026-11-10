// Ideas 176, 181, 184, 510, 512, 513: unlock codes. The supporter badge, soundtrack extras, Discord race prizes, the
// founder pack, the charity skin and the playtester skin are sold or given away outside the game (itch.io, Bandcamp,
// Ko-fi, Discord); the buyer gets a code. The browser sends only a hash of the code ("proof"), and the server keeps only
// salted hashes (config/content/community/codes.json, made with tools/community/make-codes.mjs), so the plain code
// never reaches the event log. No real money ever touches the game.
import type { FeatureFactory } from "../types.js";
import { getCatalogue, getCodes, storedHash } from "./content.js";
import { day, fail } from "./shared.js";
import { grant, locker, peek, store } from "./store.js";

export const MAX_FAILS_PER_DAY = 5;

export const codesModule: FeatureFactory = (e) => {
  const id = "community.codes";
  const fails = new Map<number, { day: number; n: number }>();
  const lastGrant = new Map<number, string[]>();
  return {
    id, ideas: [176, 181, 184, 510, 512, 513], title: "Unlock codes", economy: false,
    apply(cmd) {
      if (cmd.action !== "redeem") return fail("unknown action");
      const today = day(e), f = fails.get(cmd.company);
      if (f && f.day === today && f.n >= MAX_FAILS_PER_DAY) return fail("too many wrong codes today; try again tomorrow");
      const miss = (why: string) => { fails.set(cmd.company, { day: today, n: (f?.day === today ? f.n : 0) + 1 }); return fail(why); };
      if (typeof cmd.proof !== "string" || !/^[0-9a-f]{64}$/.test(cmd.proof)) return miss("that is not a valid code");
      const entry = getCodes().find(c => storedHash(c.salt, cmd.proof as string) === c.hash);
      if (!entry) return miss("that code is not valid");
      const s = store(e);
      if (peek(e, cmd.company).redeemed.has(entry.hash)) return fail("you have already used that code");
      if ((s.codeUses.get(entry.hash) ?? 0) >= entry.uses) return fail("that code has been used up");
      s.codeUses.set(entry.hash, (s.codeUses.get(entry.hash) ?? 0) + 1);
      const l = locker(e, cmd.company);
      l.redeemed.add(entry.hash);
      const got: string[] = [];
      for (const g of entry.grants) {
        const [kind, value] = g.split(":");
        if (kind === "item" || kind === "pack") got.push(...grant(e, cmd.company, value).map(i => getCatalogue().items.get(i)!.name));
        else if (kind === "naming") { l.naming += Number(value); got.push(`${value} port dedication token(s)`); }
        else if (kind === "points") { l.points += Number(value); got.push(`${value} tester point(s)`); }
      }
      lastGrant.set(cmd.company, got);
      return { ok: true };
    },
    view(company) {
      return { redeemed: peek(e, company).redeemed.size, lastGrant: lastGrant.get(company) ?? [], codesLoaded: getCodes().length };
    },
  };
};
