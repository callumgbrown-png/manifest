// Idea 546: a community wiki inside the game. Every port, good and ship class has a page: the facts come from the
// game's own rules and map (community.js builds them from world data), and players add short tips (8-140
// characters, filtered) that others vote up. Three flags hide a tip. The top tips per page are public. A link to an
// outside wiki (config/links.json "wiki") is shown when set; docs/community/wiki/ holds starter articles.
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { cleanText } from "./content.js";
import { companyName, day, fail, isInt, OK } from "./shared.js";

export const TIPS_PER_DAY = 3, MAX_TIPS = 300, TOP_PER_PAGE = 3, HIDE_AT_FLAGS = 3;
interface Tip { id: number; page: string; text: string; company: number; tick: number; votes: Set<number>; flags: Set<number> }

/** Wiki page keys: port:<id>, good:<index>, ship:<type>, guide:<topic>. */
export function validPage(e: Engine, page: unknown): page is string {
  if (typeof page !== "string") return false;
  const [kind, key] = page.split(":");
  if (kind === "port") return /^\d+$/.test(key) && isInt(Number(key), 0, e.n - 1);
  if (kind === "good") return /^\d+$/.test(key) && isInt(Number(key), 0, 3);
  if (kind === "ship") return ["coaster", "freighter", "bulker", "pirate"].includes(key);
  if (kind === "guide") return ["trading", "pirates", "orders", "seasons", "starting"].includes(key);
  return false;
}

export const wikiModule: FeatureFactory = (e) => {
  const id = "community.wiki";
  const tips = new Map<number, Tip>();
  const daily = new Map<number, { day: number; n: number }>();
  let nextId = 1;
  const visible = (t: Tip) => t.flags.size < HIDE_AT_FLAGS && e.companies.has(t.company);
  return {
    id, ideas: [546], title: "Community wiki", economy: false,
    apply(cmd) {
      if (cmd.action === "tip") {
        if (!validPage(e, cmd.page)) return fail("unknown wiki page");
        const text = cleanText(cmd.text);
        if (!text) return fail("tips are 8-140 characters of plain text, with no links, numbers to call or rude words");
        const d = day(e), n = daily.get(cmd.company);
        if (n && n.day === d && n.n >= TIPS_PER_DAY) return fail(`at most ${TIPS_PER_DAY} tips a day`);
        if ([...tips.values()].some(t => t.page === cmd.page && t.text.toLowerCase() === text.toLowerCase())) return fail("that tip is already there");
        daily.set(cmd.company, { day: d, n: (n?.day === d ? n.n : 0) + 1 });
        tips.set(nextId, { id: nextId, page: cmd.page, text, company: cmd.company, tick: e.tick, votes: new Set(), flags: new Set() });
        if (tips.size > MAX_TIPS) {   // drop the weakest old tip
          const weakest = [...tips.values()].sort((a, b) => a.votes.size - b.votes.size || a.id - b.id)[0];
          tips.delete(weakest.id);
        }
        return { ok: true, id: nextId++ };
      }
      if (cmd.action === "vote" || cmd.action === "flag") {
        const t = typeof cmd.tip === "number" ? tips.get(cmd.tip) : undefined;
        if (!t || !visible(t)) return fail("no such tip");
        if (t.company === cmd.company) return fail("that is your own tip");
        const set = cmd.action === "vote" ? t.votes : t.flags;
        if (set.has(cmd.company)) return fail("you have already done that");
        set.add(cmd.company);
        return OK;
      }
      if (cmd.action === "remove") {
        const t = typeof cmd.tip === "number" ? tips.get(cmd.tip) : undefined;
        if (!t || t.company !== cmd.company) return fail("not your tip");
        tips.delete(t.id);
        return OK;
      }
      return fail("unknown action");
    },
    view(company) { return { mine: [...tips.values()].filter(t => t.company === company).map(t => ({ id: t.id, page: t.page, votes: t.votes.size, hidden: !visible(t) })) }; },
    world() {
      const pages: Record<string, { id: number; text: string; by: string; votes: number }[]> = {};
      const sorted = [...tips.values()].filter(visible).sort((a, b) => b.votes.size - a.votes.size || a.id - b.id);
      for (const t of sorted) {
        const list = pages[t.page] ??= [];
        if (list.length < TOP_PER_PAGE) list.push({ id: t.id, text: t.text, by: companyName(e, t.company), votes: t.votes.size });
      }
      return { pages };
    },
  };
};
