// Career modules: captain levels (138), rank ladder (391), stats dashboard (393), collection book (144),
// achievements, milestones, long-term goals and secret achievements (134, 384, 394, 395) with their cash rewards (134,
// economy), titles and playstyle titles (135, 390) with title perks (135, economy), milestone skins (143),
// trophy room (383) and hall of fame (392).
// Everything is observed from the engine's own trip log and fleet each hour by the shared Tracker, so no core file
// needs a hook and nothing the player sends can fake a statistic.
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { content } from "./content.js";
import { fmt, levelFor, tracker, xpForLevel } from "./tracker.js";
import { action, companyName, fail, OK, players, portName, shared } from "./shared.js";

export function rankName(level: number): string {
  let name = "Deckhand";
  for (const r of content().ranks) if (level >= r.level) name = r.name;
  return name;
}

export const captainLevels: FeatureFactory = (e) => {
  const t = tracker(e);
  return {
    id: "progression.captain-levels", ideas: [138], title: "Captain level", economy: false,
    advance() { t.update(); },
    cards(company) {
      const xp = t.xp(company), level = levelFor(xp), next = xpForLevel(level + 1);
      return [{ title: `Level ${level}: ${rankName(level)}`,
        detail: `${fmt(xp)} experience${level < 50 ? `; ${fmt(next - xp)} more for level ${level + 1}` : " (top level)"}. `
          + "Experience comes from deliveries (10 each), distance sailed (1 per 50), trip profit (1 per 100 credits) and goals." }];
    },
    view(company) {
      const xp = t.xp(company), level = levelFor(xp);
      return { xp, level, rank: rankName(level), thisLevel: xpForLevel(level), nextLevel: xpForLevel(level + 1) };
    },
  };
};

export const rankLadder: FeatureFactory = (e) => {
  const t = tracker(e);
  const standings = () => players(e, t).map(id => ({ id, xp: t.xp(id) })).sort((a, b) => b.xp - a.xp || a.id - b.id);
  return {
    id: "progression.rank-ladder", ideas: [391], title: "Rank ladder", economy: false,
    advance() { t.update(); },
    cards(company) {
      const list = standings(), pos = list.findIndex(s => s.id === company);
      const ranks = content().ranks.map(r => `${r.name} (level ${r.level})`).join(", ");
      return [{ title: "Rank ladder", detail: `${pos >= 0 ? `You are number ${pos + 1} of ${list.length} captains. ` : ""}Ranks: ${ranks}.` }];
    },
    view(company) {
      const list = standings();
      return { position: list.findIndex(s => s.id === company) + 1, of: list.length, rank: rankName(t.level(company)) };
    },
    world() {
      return standings().slice(0, 10).map(s => ({ company: s.id, name: companyName(e, s.id), level: levelFor(s.xp), rank: rankName(levelFor(s.xp)) }));
    },
  };
};

export const statsDashboard: FeatureFactory = (e) => {
  const t = tracker(e);
  return {
    id: "progression.stats-dashboard", ideas: [393], title: "Stats", economy: false,
    advance() { t.update(); },
    cards(company) {
      const s = t.get(company);
      return [{ title: "Career stats",
        detail: `${s.deliveries} deliveries, ${s.voyages} voyages (${s.emptyRuns} empty), ${fmt(s.distance)} distance, `
          + `${fmt(s.cargo)} units landed, ${fmt(s.profit)} trip profit (best ${fmt(s.bestTrip)}), ${s.ports.size} ports, `
          + `peak fleet ${s.peakShips}, peak net worth ${fmt(s.peakWorth)}.` }];
    },
    view(company) {
      const s = t.get(company);
      const routes = [...s.routes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
        .map(([r, n]) => { const [a, b] = r.split("-").map(Number); return { from: a, to: b, label: `${portName(e, a)} to ${portName(e, b)}`, runs: n }; });
      return { ...t.view(company), avgProfit: s.deliveries ? Math.round(s.profit / s.deliveries) : 0,
        avgDistance: s.voyages ? Math.round(s.distance / s.voyages) : 0, topRoutes: routes,
        goods: GOODS.map((g, i) => ({ good: g, units: s.goodUnits[i], deliveries: s.goodDeliveries[i] })) };
    },
  };
};

export const collectionBook: FeatureFactory = (e) => {
  const t = tracker(e);
  const firsts = new Map<number, Map<string, number>>();   // company -> "port:3" | "good:grain" -> first tick
  return {
    id: "progression.collection-book", ideas: [144], title: "Collection book", economy: false,
    advance() {
      t.update();
      for (const id of e.companies.keys()) {
        const s = t.get(id), book = firsts.get(id) ?? new Map<string, number>();
        for (const p of s.ports) if (!book.has(`port:${p}`)) book.set(`port:${p}`, e.tick);
        GOODS.forEach((g, i) => { if (s.goodUnits[i] > 0 && !book.has(`good:${g}`)) book.set(`good:${g}`, e.tick); });
        if (book.size) firsts.set(id, book);
      }
    },
    cards(company) {
      const book = firsts.get(company) ?? new Map();
      const ports = [...book.keys()].filter(k => k.startsWith("port:")).length, goods = [...book.keys()].filter(k => k.startsWith("good:")).length;
      const missing = GOODS.filter(g => !book.has(`good:${g}`));
      return [{ title: "Collection book",
        detail: `Ports: ${ports} of ${e.map.ports.length}. Goods delivered: ${goods} of ${GOODS.length}${missing.length ? ` (missing: ${missing.join(", ")})` : " (complete!)"}.` }];
    },
    view(company) {
      const book = firsts.get(company) ?? new Map<string, number>();
      return {
        ports: e.map.ports.map((p, i) => ({ id: i, name: p.name, since: book.get(`port:${i}`) ?? null })),
        goods: GOODS.map(g => ({ good: g, since: book.get(`good:${g}`) ?? null })),
      };
    },
  };
};

export const achievements: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e);
  return {
    id: "progression.achievements", ideas: [134, 384, 394, 395], title: "Achievements", economy: false,
    advance() {
      t.update();
      const list = content().achievements;
      for (const id of e.companies.keys()) {
        if (t.fallen.has(id)) continue;
        const got = sh.earned.get(id) ?? new Map<string, number>();
        for (const a of list) {
          if (got.has(a.id) || !t.met(id, a)) continue;
          got.set(a.id, e.tick);
          t.award(id, a.xp ?? 0);
          if (a.skin) t.unlock(id, `skin:${a.skin}`);
        }
        if (got.size) sh.earned.set(id, got);
      }
    },
    cards(company) {
      const got = sh.earned.get(company) ?? new Map();
      const list = content().achievements;
      const next = list.filter(a => !got.has(a.id) && !a.secret).map(a => ({ a, p: t.progress(company, a) })).sort((x, y) => y.p - x.p).slice(0, 3);
      return [{ title: `Achievements: ${got.size} of ${list.length}`,
        detail: next.length ? `Closest: ${next.map(n => `${n.a.name} (${Math.round(n.p * 100)}%)`).join(", ")}. Secret achievements stay hidden until earned.` : "All visible achievements earned." }];
    },
    view(company) {
      const got = sh.earned.get(company) ?? new Map<string, number>();
      return content().achievements.map(a => {
        const tick = got.get(a.id);
        if (a.secret && tick === undefined) return { id: a.id, kind: a.kind, secret: true, name: "???", description: "Secret achievement", earned: null, progress: 0 };
        return { id: a.id, kind: a.kind, secret: !!a.secret, name: a.name, description: a.description, earned: tick ?? null,
          progress: Math.round(t.progress(company, a) * 100), skin: a.skin ?? null };
      });
    },
  };
};

export const REWARD_PER_XP = 2;
export const achievementRewards: FeatureFactory = (e) => {
  const sh = shared(e), paid = new Map<number, Set<string>>();
  const settle = (payNow: boolean) => {
    for (const [id, got] of sh.earned) {
      const done = paid.get(id) ?? new Set<string>();
      for (const a of got.keys()) {
        if (done.has(a)) continue;
        done.add(a);
        const def = content().achievements.find(x => x.id === a), c = e.companies.get(id);
        if (payNow && def && c) c.cash += (def.xp ?? 0) * REWARD_PER_XP;
      }
      paid.set(id, done);
    }
  };
  return {
    id: "progression.achievement-rewards", ideas: [134], title: "Achievement rewards", economy: true,
    enable() { settle(false); },    // only achievements earned while this is on pay out
    advance() { settle(true); },
    cards() { return [{ title: "Achievement rewards", detail: `Each achievement earned pays ${REWARD_PER_XP} credits per experience point it gives.` }]; },
  };
};

export const titles: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e);
  const owned = (company: number) => {
    const set = new Set(sh.titles.get(company) ?? []);
    for (const c of t.cosmetics.get(company) ?? []) if (c.startsWith("title:")) set.add(c.slice(6));
    return set;
  };
  const nameOf = (id: string) => content().titles.find(x => x.id === id)?.name ?? content().trackTitles.find(x => x.id === id)?.name ?? id;
  return {
    id: "progression.titles", ideas: [135, 390], title: "Titles", economy: false,
    advance() {
      t.update();
      for (const id of e.companies.keys()) {
        if (t.fallen.has(id)) continue;
        const set = sh.titles.get(id) ?? new Set<string>();
        for (const def of content().titles) if (!set.has(def.id) && t.met(id, def)) set.add(def.id);
        if (set.size) sh.titles.set(id, set);
      }
    },
    apply(cmd) {
      if (cmd.action !== "show") return fail("unknown action");
      if (typeof cmd.title !== "string") return fail("choose a title");
      if (!owned(cmd.company).has(cmd.title)) return fail("you have not earned that title");
      sh.shownTitle.set(cmd.company, cmd.title);
      return OK;
    },
    cards(company) {
      const have = [...owned(company)].sort();
      const shown = sh.shownTitle.get(company);
      const locked = content().titles.filter(x => !have.includes(x.id)).slice(0, 4).map(x => `${x.name}: ${x.description}`);
      return [{ title: shown ? `Title: ${nameOf(shown)}` : "Titles",
        detail: `Earned: ${have.map(nameOf).join(", ") || "none yet"}.${locked.length ? ` To earn: ${locked.join(" ")}` : ""}`,
        actions: have.length ? [action("progression.titles", "Show title", "show", {}, [{ key: "title", label: "Title", options: have.map(h => ({ value: h, label: nameOf(h) })) }])] : [] }];
    },
    view(company) {
      const have = owned(company);
      return { shown: sh.shownTitle.get(company) ?? null,
        titles: content().titles.map(x => ({ id: x.id, name: x.name, description: x.description, playstyle: !!x.playstyle, earned: have.has(x.id) })) };
    },
    world() {
      const out: Record<number, string> = {};
      for (const [id, title] of sh.shownTitle) out[id] = nameOf(title);
      return out;
    },
  };
};

export const TITLE_FEE_CUT = 0.02;
export const titlePerks: FeatureFactory = (e) => {
  const sh = shared(e);
  return {
    id: "progression.title-perks", ideas: [135], title: "Title perks", economy: true,
    cards() { return [{ title: "Title perks", detail: `Showing an earned title (other than Deckhand) cuts your port fees by ${TITLE_FEE_CUT * 100}%.` }]; },
    adjust: {
      portFee(value, ctx) {
        const shown = sh.shownTitle.get(ctx.company);
        return shown && shown !== "deckhand" ? value * (1 - TITLE_FEE_CUT) : value;
      },
    },
  };
};

export const skins: FeatureFactory = (e) => {
  const t = tracker(e);
  const worn = new Map<number, string>();
  const owned = (company: number) => ["standard", ...[...t.cosmetics.get(company) ?? []].filter(c => c.startsWith("skin:")).map(c => c.slice(5))];
  return {
    id: "progression.skins", ideas: [143], title: "Ship skins", economy: false,
    advance() { t.update(); },
    apply(cmd) {
      if (cmd.action !== "wear") return fail("unknown action");
      if (typeof cmd.skin !== "string" || !owned(cmd.company).includes(cmd.skin)) return fail("you have not unlocked that skin");
      if (cmd.skin === "standard") worn.delete(cmd.company); else worn.set(cmd.company, cmd.skin);
      return OK;
    },
    cards(company) {
      const have = owned(company), all = content().skins;
      const label = (id: string) => all.find(s => s.id === id)?.name ?? id;
      return [{ title: "Ship skins",
        detail: `Pennants unlocked by milestones and the season track: ${have.map(label).join(", ")}. ${all.length - have.length} still locked.`,
        actions: [action("progression.skins", "Fly pennant", "wear", {}, [{ key: "skin", label: "Pennant", value: worn.get(company) ?? "standard", options: have.map(h => ({ value: h, label: label(h) })) }])] }];
    },
    view(company) { return { worn: worn.get(company) ?? "standard", owned: owned(company) }; },
    world() {
      const out: Record<number, string> = {};
      for (const [id, skin] of worn) out[id] = content().skins.find(s => s.id === skin)?.colour ?? "#e8e2d0";
      return out;
    },
  };
};

export const trophyRoom: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e);
  return {
    id: "progression.trophy-room", ideas: [383], title: "Trophy room", economy: false,
    advance() { t.update(); },
    cards(company) {
      const trophies = sh.trophies.get(company) ?? [], got = sh.earned.get(company)?.size ?? 0;
      return [{ title: "Trophy room",
        detail: `${trophies.length} trophies, ${got} achievements, ${sh.titles.get(company)?.size ?? 0} titles, best trip ${fmt(t.get(company).bestTrip)}.`
          + (trophies.length ? ` Latest: ${trophies.slice(-3).map(x => x.text).join("; ")}.` : " Win tournaments, ladders and seasons to fill the shelves.") }];
    },
    view(company) {
      return { trophies: sh.trophies.get(company) ?? [], achievements: [...(sh.earned.get(company) ?? new Map()).entries()].map(([id, tick]) => ({ id, tick })),
        bestTrip: t.get(company).bestTrip, peakWorth: t.get(company).peakWorth };
    },
  };
};

const RECORDS = [["bestTrip", "Best single trip"], ["peakShips", "Largest fleet"], ["peakWorth", "Highest net worth"],
  ["distance", "Most distance sailed"], ["deliveries", "Most deliveries"]] as const;
export const hallOfFame: FeatureFactory = (e) => {
  const t = tracker(e);
  const records = new Map<string, { company: number; name: string; value: number; tick: number }>();
  return {
    id: "progression.hall-of-fame", ideas: [392], title: "Hall of fame", economy: false,
    advance() {
      t.update();
      for (const id of players(e, t)) {
        const s = t.get(id);
        for (const [key] of RECORDS) {
          const value = s[key], best = records.get(key);
          if (value > 0 && (!best || value > best.value)) records.set(key, { company: id, name: companyName(e, id), value, tick: e.tick });
        }
      }
    },
    cards() {
      const lines = RECORDS.map(([k, label]) => { const r = records.get(k); return r ? `${label}: ${r.name} (${fmt(r.value)})` : null; }).filter(Boolean);
      return [{ title: "Hall of fame", detail: lines.length ? lines.join(". ") + "." : "No records yet this world." }];
    },
    world() { return RECORDS.map(([k, label]) => ({ key: k, label, ...(records.get(k) ?? { company: null, name: null, value: 0, tick: null }) })); },
  };
};
