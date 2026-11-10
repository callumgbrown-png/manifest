// Social modules that move money, fees or time, or that the assignment flagged as economy. All ship switched off
// until Dave approves them: treasury and dividends (113, 344), roles and permissions (114), the guild bank (343),
// shares, takeovers and mergers (345-347), guild-only contracts (348), the guild warehouse (354), guild wars (357),
// alliances (124), rivalries (125), regional chat (119), signals and emotes (120), spectator mode (130), the guild news
// feed (351), hiring players as captains (128), port tax votes (362), piracy laws (365), trade treaties (366), fines (369),
// lighthouse taxes (372), auctioned naming rights (374) and the community fund (376).
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { civ } from "./civic.js";
import { unload } from "./players.js";
import { action, atLeast, Ballot, cleanLabel, cleanText, companyOptions, DailyLimit, day, deliveriesSince, fail, guildName, guildOf, isCompany, isInt, isPort,
  members, name, OK, pay, portName, rankOf, record, social, type Guild, type Rank } from "./shared.js";

const GOODS = ["grain", "fuel", "ore", "machinery"];
const treasury = (e: Engine, g: number) => social(e).treasury.get(g) ?? 0;
const addTreasury = (e: Engine, g: number, v: number) => social(e).treasury.set(g, treasury(e, g) + v);
export const PERMS = ["withdraw", "lend", "dividend", "contract", "warehouse", "war"] as const;
const DEFAULT_PERM: Record<string, Rank> = { withdraw: "leader", lend: "officer", dividend: "leader", contract: "officer", warehouse: "member", war: "leader" };
/** May this member do `act` with guild assets? (social.roles sets the minimum rank per action.) */
export function may(e: Engine, company: number, act: string): boolean {
  const g = guildOf(e, company);
  if (!g) return false;
  const need = (e.features.enabled("social.roles") ? social(e).permissions.get(g.id)?.get(act) : undefined) ?? DEFAULT_PERM[act] ?? "leader";
  return atLeast(g.members.get(company), need);
}
const amount = (v: unknown, max = 1e9) => isInt(v, 1, max) ? v : null;

// 113, 344 treasury and dividends
export const treasuryModule: FeatureFactory = (e) => {
  const id = "social.treasury";
  return {
    id, ideas: [113, 344], title: "Guild treasury", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company), c = e.companies.get(cmd.company)!;
      if (!g) return fail("join a guild first");
      const a = amount(cmd.amount);
      if (cmd.action === "deposit") { if (!a || c.cash < a) return fail("not enough cash"); c.cash -= a; addTreasury(e, g.id, a); record(e, "treasury", c.id, null, a, `deposit to ${g.name}`); return OK; }
      if (cmd.action === "withdraw") {
        if (!may(e, cmd.company, "withdraw")) return fail("your rank can't withdraw");
        if (!a || treasury(e, g.id) < a) return fail("not enough in the treasury");
        addTreasury(e, g.id, -a); c.cash += a; record(e, "treasury", null, c.id, a, `withdrawal from ${g.name}`); return OK;
      }
      if (cmd.action === "dividend") {   // shared equally between members
        if (!may(e, cmd.company, "dividend")) return fail("your rank can't pay dividends");
        const m = members(e, g);
        if (!a || treasury(e, g.id) < a || a < m.length) return fail("not enough in the treasury");
        const each = Math.floor(a / m.length);
        addTreasury(e, g.id, -each * m.length);
        for (const x of m) e.companies.get(x)!.cash += each;
        record(e, "dividend", null, null, each * m.length, `${g.name} paid ${each} to each member`);
        return OK;
      }
      return fail("unknown action");
    },
    cards(company) {
      const g = guildOf(e, company);
      if (!g) return [];
      return [{ title: "Guild treasury", detail: `Treasury: ${treasury(e, g.id).toLocaleString("en-GB")}.`, actions: [
        { ...action(id, "Deposit", "deposit"), fields: [{ key: "amount", label: "Amount", min: 1, value: 1000 }] },
        ...(may(e, company, "withdraw") ? [{ ...action(id, "Withdraw", "withdraw"), fields: [{ key: "amount", label: "Amount", min: 1, value: 1000 }] }] : []),
        ...(may(e, company, "dividend") ? [{ ...action(id, "Pay a dividend", "dividend"), fields: [{ key: "amount", label: "Total", min: 1, value: 1000 }] }] : [])] }];
    },
    world() { return Object.fromEntries([...social(e).treasury].filter(([g]) => social(e).guilds.has(g))); },
  };
};

// 114 roles and permissions
export const rolesModule: FeatureFactory = (e) => ({
  id: "social.roles", ideas: [114], title: "Guild roles and permissions", economy: true,
  apply(cmd) {
    if (cmd.action !== "set") return fail("unknown action");
    const g = guildOf(e, cmd.company);
    if (!g || rankOf(e, cmd.company) !== "leader") return fail("only the leader sets permissions");
    if (!(PERMS as readonly string[]).includes(cmd.perm as string) || !["member", "officer", "leader"].includes(cmd.rank as string)) return fail("choose a permission and a rank");
    (social(e).permissions.get(g.id) ?? social(e).permissions.set(g.id, new Map()).get(g.id)!).set(cmd.perm as string, cmd.rank as Rank);
    return OK;
  },
  cards(company) {
    if (rankOf(e, company) !== "leader") return [];
    return [{ title: "Permissions", detail: "Choose the lowest rank allowed to use each guild asset.",
      actions: [{ ...action("social.roles", "Set", "set"), fields: [{ key: "perm", label: "Action", options: PERMS.map(p => ({ value: p, label: p })) }, { key: "rank", label: "Lowest rank", options: ["member", "officer", "leader"].map(r => ({ value: r, label: r })) }] }] }];
  },
  view(company) { const g = guildOf(e, company); return g ? Object.fromEntries(PERMS.map(p => [p, social(e).permissions.get(g.id)?.get(p) ?? DEFAULT_PERM[p]])) : undefined; },
});

// 343 guild bank: loans from the treasury to members, 5% interest, due in 7 days
export const LOAN_RATE = 0.05, LOAN_DAYS = 7;
export const bankModule: FeatureFactory = (e) => {
  const loans = new Map<number, { guild: number; owed: number; due: number }>();
  return {
    id: "social.bank", ideas: [343], title: "Guild bank", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company), c = e.companies.get(cmd.company)!;
      if (!g) return fail("join a guild first");
      const a = amount(cmd.amount);
      if (cmd.action === "borrow") {
        if (loans.has(c.id)) return fail("repay your loan first");
        if (!a || a > treasury(e, g.id) / 2) return fail("borrow up to half the treasury");
        addTreasury(e, g.id, -a); c.cash += a;
        loans.set(c.id, { guild: g.id, owed: Math.ceil(a * (1 + LOAN_RATE)), due: e.tick + LOAN_DAYS * 24 });
        record(e, "loan", null, c.id, a, `loan from ${g.name}`);
        return OK;
      }
      if (cmd.action === "repay") {
        const l = loans.get(c.id);
        if (!l) return fail("no loan");
        const pay = Math.min(l.owed, c.cash);
        if (pay <= 0) return fail("no cash");
        c.cash -= pay; l.owed -= pay; addTreasury(e, l.guild, pay);
        if (l.owed <= 0) loans.delete(c.id);
        return OK;
      }
      return fail("unknown action");
    },
    advance() {   // overdue loans are collected from cash when there is some
      for (const [cid, l] of [...loans]) {
        const c = e.companies.get(cid);
        if (!c || !social(e).guilds.has(l.guild)) { loans.delete(cid); continue; }
        if (e.tick >= l.due && c.cash > 0) { const p = Math.min(l.owed, c.cash); c.cash -= p; l.owed -= p; addTreasury(e, l.guild, p); if (l.owed <= 0) loans.delete(cid); }
      }
    },
    view(company) { return loans.get(company) ?? null; },
  };
};

// 345, 346, 347 shares, takeovers and mergers
export const SHARES = 100;
export const sharesModule: FeatureFactory = (e) => {
  const holdings = new Map<number, Map<number, number>>();   // guild -> company -> shares
  const asks = new Map<string, { guild: number; seller: number; qty: number; price: number }>();
  const merge = new Map<number, number>();                   // guild -> guild it proposed to merge into
  const book = (g: Guild) => { let h = holdings.get(g.id); if (!h) { h = new Map(); const m = members(e, g); m.forEach((c, i) => h!.set(c, Math.floor(SHARES / m.length) + (i < SHARES % m.length ? 1 : 0))); holdings.set(g.id, h); } return h; };
  return {
    id: "social.shares", ideas: [345, 346, 347], title: "Guild shares, takeovers and mergers", economy: true,
    apply(cmd) {
      const s = social(e);
      const g = typeof cmd.guild === "number" ? s.guilds.get(cmd.guild) : guildOf(e, cmd.company);
      if (!g) return fail("no such guild");
      const h = book(g);
      switch (cmd.action) {
        case "ask": {
          if (!isInt(cmd.qty, 1, h.get(cmd.company) ?? 0)) return fail("you don't hold that many shares");
          if (!isInt(cmd.price, 1, 1e7)) return fail("set a price per share");
          asks.set(`${g.id}:${cmd.company}`, { guild: g.id, seller: cmd.company, qty: cmd.qty, price: cmd.price });
          return OK;
        }
        case "buy": {
          const a = typeof cmd.seller === "number" ? asks.get(`${g.id}:${cmd.seller}`) : undefined;
          if (!a || a.seller === cmd.company) return fail("no such offer");
          const q = isInt(cmd.qty, 1, a.qty) ? cmd.qty : null;
          if (!q || (h.get(a.seller) ?? 0) < q) return fail("not that many shares on offer");
          if (!pay(e, cmd.company, a.seller, q * a.price, "shares", `${q} shares of ${g.name}`)) return fail("not enough cash");
          h.set(a.seller, h.get(a.seller)! - q); h.set(cmd.company, (h.get(cmd.company) ?? 0) + q);
          a.qty -= q; if (a.qty <= 0) asks.delete(`${g.id}:${a.seller}`);
          return OK;
        }
        case "takeover": {   // a holder of more than half the shares takes the lead
          if ((h.get(cmd.company) ?? 0) <= SHARES / 2) return fail("you need more than half the shares");
          if (guildOf(e, cmd.company) && guildOf(e, cmd.company) !== g) return fail("leave your own guild first");
          for (const [c, r] of g.members) if (r === "leader") g.members.set(c, "officer");
          g.members.set(cmd.company, "leader"); s.memberOf.set(cmd.company, g.id);
          record(e, "takeover", null, cmd.company, 0, `${name(e, cmd.company)} took over ${g.name}`);
          return OK;
        }
        case "merge": {   // leaders of both guilds must agree; the proposer's guild joins the other
          const mine = guildOf(e, cmd.company);
          if (!mine || rankOf(e, cmd.company) !== "leader" || mine === g) return fail("leaders merge their guild into another");
          if (merge.get(g.id) === mine.id) {   // the other side proposed already: g joins mine
            for (const c of members(e, g)) { mine.members.set(c, g.members.get(c) === "leader" ? "officer" : g.members.get(c)!); s.memberOf.set(c, mine.id); }
            addTreasury(e, mine.id, treasury(e, g.id)); s.treasury.delete(g.id); s.guilds.delete(g.id); merge.delete(g.id); holdings.delete(g.id); holdings.delete(mine.id);
            record(e, "merger", null, null, 0, `${g.name} merged into ${mine.name}`);
            return OK;
          }
          merge.set(mine.id, g.id);
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    view(company) { return [...holdings].map(([g, h]) => ({ guild: g, shares: h.get(company) ?? 0 })).filter(x => x.shares > 0); },
    world() { return [...asks.values()].map(a => ({ guild: guildName(e, a.guild), seller: name(e, a.seller), qty: a.qty, price: a.price })); },
  };
};

// 348 guild-only contracts: an officer posts a delivery, paid from the treasury to the member who delivers it
export const guildContractsModule: FeatureFactory = (e) => {
  const contracts = new Map<number, { guild: number; port: number; good: number; qty: number; reward: number; taken: number | null; done: number; since: number }>();
  let next = 1;
  return {
    id: "social.guild-contracts", ideas: [348], title: "Guild contracts", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company);
      if (!g) return fail("join a guild first");
      if (cmd.action === "post") {
        if (!may(e, cmd.company, "contract")) return fail("your rank can't post contracts");
        if (!isPort(e, cmd.port) || !isInt(cmd.good, 0, 3) || !isInt(cmd.qty, 10, 5000) || !isInt(cmd.reward, 1, 1e7)) return fail("check the contract fields");
        if (treasury(e, g.id) < cmd.reward) return fail("the treasury can't cover the reward");
        addTreasury(e, g.id, -cmd.reward);
        contracts.set(next, { guild: g.id, port: cmd.port, good: cmd.good, qty: cmd.qty, reward: cmd.reward, taken: null, done: 0, since: e.tick });
        return { ok: true, id: next++ };
      }
      if (cmd.action === "take") {
        const k = typeof cmd.contract === "number" ? contracts.get(cmd.contract) : undefined;
        if (!k || k.guild !== g.id || k.taken !== null) return fail("not available");
        k.taken = cmd.company; k.since = e.tick;
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const [cid, k] of [...contracts]) {
        if (!social(e).guilds.has(k.guild)) { contracts.delete(cid); continue; }
        if (k.taken === null) continue;
        for (const t of deliveriesSince(e, k.taken, Math.max(k.since, e.tick - 1))) if (t.to === k.port && t.good === k.good) k.done += t.qty;
        if (k.done >= k.qty) { const c = e.companies.get(k.taken); if (c) c.cash += k.reward; record(e, "contract", null, k.taken, k.reward, `guild contract: ${k.qty} t ${GOODS[k.good]} to ${portName(e, k.port)}`); contracts.delete(cid); }
        else if (e.tick - k.since > 7 * 24) { k.taken = null; k.done = 0; }
      }
    },
    view(company) { const g = guildOf(e, company); return g ? [...contracts].filter(([, k]) => k.guild === g.id).map(([id, k]) => ({ id, ...k, taken: k.taken === null ? null : name(e, k.taken) })) : undefined; },
  };
};

// 354 shared guild warehouse at the HQ
export const warehouseModule: FeatureFactory = (e) => {
  const stock = new Map<number, number[]>();
  const at = (g: Guild) => stock.get(g.id) ?? stock.set(g.id, [0, 0, 0, 0]).get(g.id)!;
  return {
    id: "social.warehouse", ideas: [354], title: "Guild warehouse", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company);
      if (!g || g.hq === null) return fail("your guild needs an HQ");
      if (!may(e, cmd.company, "warehouse")) return fail("your rank can't use the warehouse");
      const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
      if (!s || s.owner !== cmd.company || s.dest !== null || s.port !== g.hq) return fail("use one of your ships docked at the HQ");
      if (cmd.action === "store") {
        if (s.good === null || !isInt(cmd.qty, 1, Math.floor(s.qty))) return fail("store up to what is aboard");
        const good = s.good; unload(e, s, cmd.qty, 0); at(g)[good] += cmd.qty; return OK;
      }
      if (cmd.action === "take") {
        if (!isInt(cmd.good, 0, 3) || !isInt(cmd.qty, 1, at(g)[cmd.good])) return fail("not that much in store");
        if (s.qty > 0 && s.good !== cmd.good) return fail("that ship carries another good");
        if (s.qty + cmd.qty > e.expansionCapacity(s)) return fail("not enough room aboard");
        at(g)[cmd.good] -= cmd.qty; s.good = cmd.good; s.qty += cmd.qty; e.recordCargoLoaded(s, 0); return OK;
      }
      return fail("unknown action");
    },
    view(company) { const g = guildOf(e, company); return g ? at(g).slice() : undefined; },
  };
};

// 357 guild wars: a declared war lasts 3 days; the side that delivers more tonnes wins a tribute of 5% of the loser's treasury
export const warsModule: FeatureFactory = (e) => {
  const wars: { a: number; b: number; start: number; score: [number, number] }[] = [];
  let lastScan = 0;
  return {
    id: "social.wars", ideas: [357], title: "Guild wars", economy: true,
    enable() { lastScan = e.tick; },
    apply(cmd) {
      if (cmd.action !== "declare") return fail("unknown action");
      const g = guildOf(e, cmd.company), t = typeof cmd.guild === "number" ? social(e).guilds.get(cmd.guild) : undefined;
      if (!g || !may(e, cmd.company, "war")) return fail("your rank can't declare war");
      if (!t || t === g) return fail("choose another guild");
      if (wars.some(w => [w.a, w.b].includes(g.id) || [w.a, w.b].includes(t.id))) return fail("one war at a time");
      wars.push({ a: g.id, b: t.id, start: e.tick + 24, score: [0, 0] });
      record(e, "war", null, null, 0, `${g.name} declared war on ${t.name}`);
      return OK;
    },
    advance() {
      for (const w of [...wars]) {
        if (e.tick < w.start) continue;
        [w.a, w.b].forEach((gid, i) => { const g = social(e).guilds.get(gid); if (g) for (const c of members(e, g)) for (const t of deliveriesSince(e, c, lastScan)) w.score[i] += t.qty; });
        if (e.tick >= w.start + 72) {
          wars.splice(wars.indexOf(w), 1);
          if (w.score[0] === w.score[1]) continue;
          const [win, lose] = w.score[0] > w.score[1] ? [w.a, w.b] : [w.b, w.a];
          const tribute = Math.floor(treasury(e, lose) * 0.05);
          addTreasury(e, lose, -tribute); addTreasury(e, win, tribute);
          record(e, "war", null, null, tribute, `${guildName(e, win)} beat ${guildName(e, lose)}`);
        }
      }
      lastScan = e.tick;
    },
    world() { return wars.map(w => ({ a: guildName(e, w.a), b: guildName(e, w.b), start: w.start, score: w.score })); },
  };
};

// 124 alliances: two guild leaders agree; allies share a channel and see each other on the guild list
export const alliancesModule: FeatureFactory = (e) => {
  const pacts = new Set<string>(), offers = new Set<string>();
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  return {
    id: "social.alliances", ideas: [124], title: "Alliances", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company), t = typeof cmd.guild === "number" ? social(e).guilds.get(cmd.guild) : undefined;
      if (!g || rankOf(e, cmd.company) !== "leader") return fail("leaders make alliances");
      if (!t || t === g) return fail("choose another guild");
      const k = key(g.id, t.id);
      if (cmd.action === "propose") { if (offers.has(`${t.id}>${g.id}`)) { pacts.add(k); offers.delete(`${t.id}>${g.id}`); } else offers.add(`${g.id}>${t.id}`); return OK; }
      if (cmd.action === "break") return pacts.delete(k) ? OK : fail("no alliance");
      return fail("unknown action");
    },
    world() { return [...pacts].map(k => k.split(":").map(Number)).filter(([a, b]) => social(e).guilds.has(a) && social(e).guilds.has(b)).map(([a, b]) => [guildName(e, a), guildName(e, b)]); },
  };
};

// 125 rivalries: name a rival company; both see a shared head-to-head of worth and deliveries
export const rivalriesModule: FeatureFactory = (e) => {
  const rivals = new Map<number, number>();
  return {
    id: "social.rivalries", ideas: [125], title: "Rivalries", economy: true,
    apply(cmd) {
      if (cmd.action !== "declare") return fail("unknown action");
      if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose a rival");
      rivals.set(cmd.company, cmd.target);
      return OK;
    },
    view(company) {
      const r = rivals.get(company);
      if (r === undefined || !e.companies.has(r)) return null;
      const stat = (c: number) => ({ name: name(e, c), worth: Math.round(e.netWorth(e.companies.get(c)!)), voyages: (e.trips.get(c) ?? []).filter(t => !t.open).length });
      return { me: stat(company), rival: stat(r) };
    },
  };
};

// 119 regional chat: one channel per port region (port id mod 5), for companies with a ship there
export const REGIONS = 5;
export const regionalChatModule: FeatureFactory = (e) => {
  const chans = new Map<number, { tick: number; from: number; text: string }[]>();
  const limit = new DailyLimit(e, 100);
  const regionsOf = (company: number) => new Set((e.companies.get(company)?.ships ?? []).map(i => e.ships.get(i)!.port % REGIONS));
  return {
    id: "social.regional-chat", ideas: [119], title: "Regional chat", economy: true,
    apply(cmd) {
      if (cmd.action !== "say" || !isInt(cmd.region, 0, REGIONS - 1)) return fail("choose a region");
      if (!regionsOf(cmd.company).has(cmd.region)) return fail("you need a ship in that region");
      const text = cleanText(cmd.text, 200);
      if (!text || !limit.take(cmd.company)) return fail("message refused");
      const l = chans.get(cmd.region) ?? []; l.push({ tick: e.tick, from: cmd.company, text }); if (l.length > 50) l.shift(); chans.set(cmd.region, l);
      return OK;
    },
    view(company) { return Object.fromEntries([...regionsOf(company)].map(r => [r, (chans.get(r) ?? []).map(m => ({ ...m, from: name(e, m.from) }))])); },
  };
};

// 120 flag signals and emotes at sea: a fixed set of signals shown over a ship for 3 hours
export const SIGNALS = ["Ahoy!", "Thanks", "Danger ahead", "Need fuel", "Follow me", "Pirates!", "Good trade", "🎉"];
export const signalsModule: FeatureFactory = (e) => {
  const shown = new Map<number, { signal: number; until: number }>();
  return {
    id: "social.signals", ideas: [120], title: "Signals and emotes", economy: true,
    apply(cmd) {
      const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
      if (cmd.action !== "signal" || !s || s.owner !== cmd.company) return fail("choose your ship");
      if (!isInt(cmd.signal, 0, SIGNALS.length - 1)) return fail("choose a signal");
      shown.set(s.id, { signal: cmd.signal, until: e.tick + 3 });
      return OK;
    },
    advance() { for (const [s, v] of [...shown]) if (v.until <= e.tick || !e.ships.has(s)) shown.delete(s); },
    world() { return Object.fromEntries([...shown].map(([s, v]) => [s, SIGNALS[v.signal]])); },
  };
};

// 130 spectator mode: follow a company's public ships (the client switches the camera); spectators are counted
export const spectatorModule: FeatureFactory = (e) => {
  const watching = new Map<number, number>();
  return {
    id: "social.spectator", ideas: [130], title: "Spectator mode", economy: true,
    apply(cmd) {
      if (cmd.action === "watch") { if (!isCompany(e, cmd.target)) return fail("choose a company"); watching.set(cmd.company, cmd.target); return OK; }
      if (cmd.action === "stop") { watching.delete(cmd.company); return OK; }
      return fail("unknown action");
    },
    view(company) { const t = watching.get(company); return t === undefined ? null : { target: t, name: name(e, t), ships: (e.companies.get(t)?.ships ?? []) }; },
    world() { const n = new Map<number, number>(); for (const t of watching.values()) n.set(t, (n.get(t) ?? 0) + 1); return [...n].map(([c, k]) => ({ name: name(e, c), spectators: k })); },
  };
};

// 351 guild news feed: automatic posts for members' big deliveries and guild events
export const newsFeedModule: FeatureFactory = (e) => {
  const feeds = new Map<number, { tick: number; text: string }[]>();
  let lastScan = 0;
  return {
    id: "social.news-feed", ideas: [351], title: "Guild news feed", economy: true,
    enable() { lastScan = e.tick; },
    advance() {
      for (const g of social(e).guilds.values()) for (const c of members(e, g)) for (const t of deliveriesSince(e, c, lastScan)) if (t.qty >= 200) {
        const f = feeds.get(g.id) ?? []; f.push({ tick: e.tick, text: `${name(e, c)} delivered ${Math.round(t.qty)} t of ${GOODS[t.good!]} to ${portName(e, t.to)}` }); if (f.length > 30) f.shift(); feeds.set(g.id, f);
      }
      lastScan = e.tick;
    },
    view(company) { const g = guildOf(e, company); return g ? feeds.get(g.id) ?? [] : undefined; },
  };
};

// 128 hiring other players as captains: the owner pays a daily wage; the hired captain may send that ship on voyages
// and sell its cargo for the owner (cargo is bought with the owner's cash; the owner keeps the takings)
export const hireCaptainsModule: FeatureFactory = (e) => {
  const hires = new Map<number, { owner: number; captain: number; wage: number; until: number }>();
  return {
    id: "social.hire-captains", ideas: [128], title: "Hire player captains", economy: true,
    apply(cmd) {
      if (cmd.action === "hire") {
        const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
        if (!s || s.owner !== cmd.company || s.type === "pirate") return fail("not your ship");
        if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose a captain");
        if (!isInt(cmd.wage, 1, 1e6) || !isInt(cmd.days, 1, 7)) return fail("set a daily wage and 1-7 days");
        hires.set(s.id, { owner: cmd.company, captain: cmd.target, wage: cmd.wage, until: e.tick + cmd.days * 24 });
        return OK;
      }
      if (cmd.action === "fire") { const h = typeof cmd.ship === "number" ? hires.get(cmd.ship) : undefined; if (!h || h.owner !== cmd.company) return fail("no such hire"); hires.delete(cmd.ship as number); return OK; }
      if (cmd.action === "sail" || cmd.action === "sell") {
        const h = typeof cmd.ship === "number" ? hires.get(cmd.ship) : undefined;
        if (!h || h.captain !== cmd.company || e.ships.get(cmd.ship as number)?.owner !== h.owner) return fail("you are not that ship's captain");
        if (cmd.action === "sell") return e.apply({ type: "sell", company: h.owner, ship: cmd.ship as number });
        if (!isPort(e, cmd.dest)) return fail("choose a port");
        const buy = typeof cmd.good === "string" && GOODS.includes(cmd.good) && isInt(cmd.qty, 1, 100000) ? { good: cmd.good as "grain", qty: cmd.qty } : undefined;
        return e.apply({ type: "sail", company: h.owner, ship: cmd.ship as number, dest: cmd.dest, buy });
      }
      return fail("unknown action");
    },
    advance() {
      if (e.tick % 24 !== 0) return;
      for (const [sid, h] of [...hires]) {
        if (!e.ships.has(sid) || e.tick > h.until || !pay(e, h.owner, h.captain, h.wage, "wage", `captain's wage for ship ${sid}`)) hires.delete(sid);
      }
    },
    world() { return [...hires].map(([ship, h]) => ({ ship, owner: name(e, h.owner), captain: name(e, h.captain), wage: h.wage, until: h.until })); },
  };
};

// 362 port tax votes: a mayor proposes a trade tax change of -2..+2 points at their port; residents vote for 48 h
export const taxVotesModule: FeatureFactory = (e) => {
  const offsets = new Map<number, number>();
  const ballots = new Map<number, { change: number; ballot: Ballot<"yes" | "no"> }>();
  return {
    id: "social.tax-votes", ideas: [362], title: "Port tax votes", economy: true,
    apply(cmd) {
      if (cmd.action === "propose") {
        const port = [...civ(e).mayors].find(([, m]) => m === cmd.company)?.[0];
        if (port === undefined) return fail("mayors propose tax changes");
        if (!isInt(cmd.change, -2, 2) || cmd.change === 0) return fail("change by -2 to +2 points");
        if (ballots.has(port)) return fail("a vote is already running");
        ballots.set(port, { change: cmd.change, ballot: new Ballot(["yes", "no"], e.tick + 48) });
        return OK;
      }
      if (cmd.action === "vote") {
        const home = e.companies.get(cmd.company)!.home, b = ballots.get(home);
        if (!b) return fail("no vote in your home port");
        const why = b.ballot.cast(cmd.company, cmd.choice);
        return why ? fail(why) : OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const [port, b] of [...ballots]) if (e.tick >= b.ballot.closes) {
        ballots.delete(port);
        if (b.ballot.winner() === "yes") offsets.set(port, Math.max(-0.02, Math.min(0.05, (offsets.get(port) ?? 0) + b.change / 100)));
      }
    },
    adjust: { tradeTax(v, ctx) { return Math.max(0, v + (offsets.get(ctx.port) ?? 0)); } },
    world() { return Object.fromEntries(offsets); },
  };
};

// 365 piracy laws: the council outlaws piracy at a port: pirate ships pay a 500 fine as their port fee there
export const PIRACY_FINE = 500;
export const piracyLawsModule: FeatureFactory = (e) => {
  const outlawed = new Set<number>();
  return {
    id: "social.piracy-laws", ideas: [365], title: "Piracy laws", economy: true,
    apply(cmd) {
      if (cmd.action !== "toggle") return fail("unknown action");
      if (!civ(e).council.includes(cmd.company)) return fail("the council makes piracy laws");
      if (!isPort(e, cmd.port)) return fail("choose a port");
      if (outlawed.has(cmd.port)) outlawed.delete(cmd.port); else outlawed.add(cmd.port);
      return OK;
    },
    adjust: { portFee(v, ctx) { return outlawed.has(ctx.dest) && e.ships.get(ctx.ship)?.type === "pirate" ? v + PIRACY_FINE : v; } },
    world() { return [...outlawed]; },
  };
};

// 366 trade treaties: two guilds' members pay half the port fee at each other's HQ
export const treatiesModule: FeatureFactory = (e) => {
  const treaties = new Set<string>(), offers = new Set<string>();
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  return {
    id: "social.treaties", ideas: [366], title: "Trade treaties", economy: true,
    apply(cmd) {
      const g = guildOf(e, cmd.company), t = typeof cmd.guild === "number" ? social(e).guilds.get(cmd.guild) : undefined;
      if (cmd.action !== "propose" || !g || rankOf(e, cmd.company) !== "leader" || !t || t === g) return fail("leaders sign treaties with another guild");
      if (offers.delete(`${t.id}>${g.id}`)) treaties.add(key(g.id, t.id)); else offers.add(`${g.id}>${t.id}`);
      return OK;
    },
    adjust: {
      portFee(v, ctx) {
        const g = guildOf(e, ctx.company);
        if (!g) return v;
        for (const k of treaties) { const [a, b] = k.split(":").map(Number); const other = a === g.id ? b : b === g.id ? a : null;
          if (other !== null && social(e).guilds.get(other)?.hq === ctx.dest) return v / 2; }
        return v;
      },
    },
    world() { return [...treaties].map(k => k.split(":").map(Number).map(id => guildName(e, id))); },
  };
};

// 369 fines: a guilty court verdict lets the plaintiff claim a fine of up to 2% of the guilty company's cash (max 5,000)
export const finesModule: FeatureFactory = (e) => {
  const claimed = new Set<string>();
  return {
    id: "social.fines", ideas: [369], title: "Fines", economy: true,
    apply(cmd) {
      if (cmd.action !== "claim") return fail("unknown action");
      const v = social(e).ledger.find(l => l.kind === "verdict" && l.from === cmd.company && l.to === cmd.target && l.note.endsWith(": guilty") && e.tick - l.tick < 7 * 24);
      if (!v || typeof cmd.target !== "number") return fail("you have no recent guilty verdict against them");
      const k = `${v.tick}:${cmd.company}:${cmd.target}`;
      if (claimed.has(k)) return fail("already claimed");
      const c = e.companies.get(cmd.target);
      if (!c) return fail("they have left");
      const fine = Math.min(5000, Math.max(0, Math.floor(c.cash * 0.02)));
      claimed.add(k);
      if (fine > 0) pay(e, cmd.target, cmd.company, fine, "fine", "court fine");
      return OK;
    },
  };
};

// 372 lighthouse taxes: a guild holding a port (social.guild-ports) charges other companies +50 on the port fee there;
// the guild's treasury collects it
export const LIGHTHOUSE_TAX = 50;
export const lighthouseModule: FeatureFactory = (e) => {
  let lastScan = 0;
  const holder = (port: number) => (e.features.modules.get("social.guild-ports")?.world?.() as { port: number; guild: number }[] | undefined)?.find(h => h.port === port)?.guild;
  return {
    id: "social.lighthouse-taxes", ideas: [372], title: "Lighthouse taxes", economy: true,
    enable() { lastScan = e.tick; },
    adjust: { portFee(v, ctx) { const g = holder(ctx.dest); return g !== undefined && guildOf(e, ctx.company)?.id !== g ? v + LIGHTHOUSE_TAX : v; } },
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest !== null || s.arriveTick <= lastScan || s.arriveTick > e.tick) continue;
        const g = holder(s.port);
        if (g !== undefined && guildOf(e, s.owner)?.id !== g) addTreasury(e, g, LIGHTHOUSE_TAX);
      }
      lastScan = e.tick;
    },
  };
};

// 374 auctioned naming rights: a port's honorary name for a week goes to the highest bid; the money goes to the community fund
export const namingAuctionsModule: FeatureFactory = (e) => {
  const bids = new Map<number, { company: number; amount: number; name: string }>(), names = new Map<number, string>();
  let week = -1;
  return {
    id: "social.naming-auctions", ideas: [374], title: "Auctioned naming rights", economy: true,
    enable() { week = Math.floor(e.tick / 168); },
    apply(cmd) {
      if (cmd.action !== "bid" || !isPort(e, cmd.port)) return fail("choose a port");
      const n = cleanLabel(cmd.name, 24, 3);
      if (!n) return fail("names are 3-24 letters and spaces");
      const best = bids.get(cmd.port);
      if (!isInt(cmd.amount, best ? best.amount + 100 : 500, 1e8)) return fail(`bid at least ${best ? best.amount + 100 : 500}`);
      const c = e.companies.get(cmd.company)!;
      if (c.cash < cmd.amount) return fail("not enough cash");
      if (best) { const b = e.companies.get(best.company); if (b) b.cash += best.amount; }
      c.cash -= cmd.amount;
      bids.set(cmd.port, { company: cmd.company, amount: cmd.amount, name: n });
      return OK;
    },
    advance() {
      if (Math.floor(e.tick / 168) === week) return;
      week = Math.floor(e.tick / 168);
      names.clear();
      for (const [port, b] of bids) { names.set(port, b.name); communityFundAdd(e, b.amount); record(e, "naming", b.company, null, b.amount, `${portName(e, port)} named "${b.name}" this week`); }
      bids.clear();
    },
    world() { return { names: Object.fromEntries(names), bids: [...bids].map(([p, b]) => ({ port: p, amount: b.amount, by: name(e, b.company) })) }; },
  };
};

// 376 community fund: donations; the council grants from it to new companies (up to 2,000 each, once)
const funds = new WeakMap<Engine, { total: number }>();
export const communityFund = (e: Engine) => funds.get(e) ?? funds.set(e, { total: 0 }).get(e)!;
export function communityFundAdd(e: Engine, v: number) { communityFund(e).total += v; }
export const communityFundModule: FeatureFactory = (e) => {
  const granted = new Set<number>();
  return {
    id: "social.community-fund", ideas: [376], title: "Community fund", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "donate") { const a = amount(cmd.amount); if (!a || c.cash < a) return fail("not enough cash"); c.cash -= a; communityFundAdd(e, a); record(e, "fund", c.id, null, a, "donation to the community fund"); return OK; }
      if (cmd.action === "grant") {
        if (!civ(e).council.includes(cmd.company)) return fail("the council makes grants");
        if (!isCompany(e, cmd.target) || granted.has(cmd.target)) return fail("one grant per company");
        const a = amount(cmd.amount, 2000);
        if (!a || communityFund(e).total < a) return fail("grants are up to 2,000 and the fund must cover it");
        communityFund(e).total -= a; e.companies.get(cmd.target)!.cash += a; granted.add(cmd.target);
        record(e, "fund", null, cmd.target, a, "community fund grant");
        return OK;
      }
      return fail("unknown action");
    },
    world() { return { total: Math.round(communityFund(e).total), grants: granted.size }; },
  };
};
