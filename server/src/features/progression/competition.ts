// Competition modules: weekly leaderboards (142), seasonal ladders with cash rewards (141, economy), the time-limited
// season wrap-up (410), tournaments (411) and the speed-trading blitz with an entry pot (405, economy).
// Scores are gains in tracker stats over a window, so only finished, real trips count.
import type { FeatureFactory } from "../types.js";
import { content } from "./content.js";
import { DAY, fmt, tracker, WEEK, type Tracker } from "./tracker.js";
import { action, addTrophy, companyName, fail, OK, players } from "./shared.js";

/** Baseline-and-gain scoring over a window, for any set of stats. */
class Window {
  base = new Map<number, Record<string, number>>();
  constructor(private readonly t: Tracker, private readonly stats: readonly string[]) {}
  join(company: number) { if (!this.base.has(company)) this.base.set(company, Object.fromEntries(this.stats.map(s => [s, this.t.value(company, s)]))); }
  gain(company: number, stat: string) { const b = this.base.get(company); return b ? Math.max(0, this.t.value(company, stat) - (b[stat] ?? 0)) : 0; }
  ranking(stat: string) { return [...this.base.keys()].map(id => ({ id, score: this.gain(id, stat) })).sort((a, b) => b.score - a.score || a.id - b.id); }
  reset() { this.base.clear(); }
}

const BOARDS = [["profit", "Profit"], ["deliveries", "Deliveries"], ["distance", "Distance"]] as const;
export const weeklyLeaderboards: FeatureFactory = (e) => {
  const t = tracker(e), w = new Window(t, BOARDS.map(b => b[0]));
  let week = -1;
  let last: { week: number; winners: Record<string, { company: number; name: string; score: number }[]> } | null = null;
  return {
    id: "progression.weekly-leaderboards", ideas: [142], title: "Weekly leaderboards", economy: false,
    advance() {
      t.update();
      const now = Math.floor(e.tick / WEEK);
      if (now !== week) {
        if (week >= 0) {
          const winners: Record<string, { company: number; name: string; score: number }[]> = {};
          for (const [stat, label] of BOARDS) {
            winners[stat] = w.ranking(stat).filter(r => r.score > 0).slice(0, 3).map(r => ({ company: r.id, name: companyName(e, r.id), score: r.score }));
            winners[stat].forEach((r, i) => addTrophy(e, r.company, `Week ${week + 1} ${label.toLowerCase()} leaderboard: place ${i + 1}`));
          }
          last = { week, winners };
        }
        week = now; w.reset();
      }
      for (const id of players(e, t)) w.join(id);
    },
    cards(company) {
      const lines = BOARDS.map(([stat, label]) => {
        const r = w.ranking(stat), pos = r.findIndex(x => x.id === company);
        return `${label}: ${pos >= 0 ? `you are ${pos + 1} of ${r.length} with ${fmt(r[pos].score)}` : "not ranked"}${r[0]?.score ? `, leader ${companyName(e, r[0].id)} ${fmt(r[0].score)}` : ""}`;
      });
      return [{ title: "This week's leaderboards", detail: `${lines.join(". ")}. Resets in ${Math.ceil((WEEK - e.tick % WEEK) / DAY)} days.` }];
    },
    world() {
      const boards: Record<string, { company: number; name: string; score: number }[]> = {};
      for (const [stat] of BOARDS) boards[stat] = w.ranking(stat).slice(0, 5).map(r => ({ company: r.id, name: companyName(e, r.id), score: r.score }));
      return { week: week + 1, boards, last };
    },
  };
};

export const LADDER_DAYS = 14;
export const LADDER_REWARDS: Record<string, number> = { Bronze: 0, Silver: 500, Gold: 1500, Platinum: 3000, Diamond: 5000 };
/** Ladder tier for a company: the highest tier whose share of players it beats. */
function tierFor(ranking: { id: number; score: number }[], company: number): string {
  const ladder = content().ladder, pos = ranking.findIndex(r => r.id === company);
  if (pos < 0 || !ladder.length) return ladder[0]?.name ?? "Bronze";
  const beaten = ranking.length > 1 ? (ranking.length - 1 - pos) / (ranking.length - 1) : 0;
  let name = ladder[0].name;
  for (const step of ladder) if (beaten >= step.beats && (ranking[pos].score > 0 || step.beats === 0)) name = step.name;
  return name;
}
export const seasonalLadder: FeatureFactory = (e) => {
  const t = tracker(e), w = new Window(t, ["xp"]);
  let round = -1;
  const length = LADDER_DAYS * DAY;
  return {
    id: "progression.seasonal-ladder", ideas: [141], title: "Seasonal ladder", economy: true,
    advance() {
      t.update();
      const now = Math.floor(e.tick / length);
      if (now !== round) {
        if (round >= 0) {
          const ranking = w.ranking("xp");
          for (const r of ranking) {
            const tier = tierFor(ranking, r.id), pay = LADDER_REWARDS[tier] ?? 0, c = e.companies.get(r.id);
            if (pay > 0 && c) { c.cash += pay; addTrophy(e, r.id, `Ladder round ${round + 1}: ${tier}`); }
          }
        }
        round = now; w.reset();
      }
      for (const id of players(e, t)) w.join(id);
    },
    cards(company) {
      const ranking = w.ranking("xp"), tier = tierFor(ranking, company);
      return [{ title: `Ladder: ${tier}`, detail: `Experience earned this ${LADDER_DAYS}-day round: ${fmt(w.gain(company, "xp"))}. The ladder resets every ${LADDER_DAYS} days and pays by tier: `
        + Object.entries(LADDER_REWARDS).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") + "." }];
    },
    view(company) { const r = w.ranking("xp"); return { tier: tierFor(r, company), score: w.gain(company, "xp"), round: round + 1 }; },
  };
};

export const seasons: FeatureFactory = (e) => {
  const t = tracker(e);
  let final: { company: number; name: string; worth: number }[] | null = null;
  return {
    id: "progression.seasons", ideas: [410], title: "Season", economy: false,
    advance() {
      t.update();
      if (!e.seasonOver || final) return;
      final = players(e, t).map(id => ({ company: id, name: companyName(e, id), worth: Math.round(e.netWorth(e.companies.get(id)!)) }))
        .sort((a, b) => b.worth - a.worth || a.company - b.company).slice(0, 10);
      final.slice(0, 3).forEach((f, i) => addTrophy(e, f.company, `Season finished in place ${i + 1}`));
    },
    cards() {
      const left = Math.max(0, e.seasonHours - e.tick);
      return [{ title: final ? "The season is over" : `Season: ${Math.ceil(left / DAY)} days left`,
        detail: final ? `Final standings: ${final.slice(0, 3).map((f, i) => `${i + 1}. ${f.name} (${fmt(f.worth)})`).join(", ")}.`
          : `Seasons are time-limited: the world closes after ${e.seasonHours / DAY} days and the top three by net worth get trophies. ${left} hours to go.` }];
    },
    world() { return { hoursLeft: Math.max(0, e.seasonHours - e.tick), final }; },
  };
};

export const TOURNAMENT_EVERY = 3 * DAY, TOURNAMENT_HOURS = DAY;
export const TOURNAMENT_XP = [150, 90, 50];
interface Cup { number: number; start: number; entrants: Set<number>; w: Window }
export const tournaments: FeatureFactory = (e) => {
  const t = tracker(e);
  const cupAt = (tick: number) => Math.floor(tick / TOURNAMENT_EVERY);
  let cup: Cup | null = null;
  const signups = new Map<number, Set<number>>();   // cup number -> companies entered ahead of time
  const results: { number: number; podium: { company: number; name: string; score: number }[] }[] = [];
  const running = () => e.tick % TOURNAMENT_EVERY < TOURNAMENT_HOURS;
  return {
    id: "progression.tournaments", ideas: [411], title: "Tournaments", economy: false,
    advance() {
      t.update();
      const n = cupAt(e.tick);
      if (cup && (cup.number !== n || !running())) {
        const ranking = [...cup.entrants].map(id => ({ id, score: cup!.w.gain(id, "profit") })).sort((a, b) => b.score - a.score || a.id - b.id);
        if (ranking.length >= 2) {
          const podium = ranking.slice(0, 3).filter(r => r.score > 0);
          podium.forEach((r, i) => { t.award(r.id, TOURNAMENT_XP[i]); addTrophy(e, r.id, `Tournament ${cup!.number + 1}: place ${i + 1}`); });
          results.push({ number: cup.number + 1, podium: podium.map(r => ({ company: r.id, name: companyName(e, r.id), score: r.score })) });
          if (results.length > 10) results.shift();
        }
        cup = null;
      }
      if (!cup && running()) {
        cup = { number: n, start: e.tick, entrants: signups.get(n) ?? new Set(), w: new Window(t, ["profit"]) };
        signups.delete(n);
        for (const id of cup.entrants) cup.w.join(id);
      }
    },
    apply(cmd) {
      if (cmd.action !== "enter") return fail("unknown action");
      if (t.isBot(cmd.company)) return fail("bots do not enter tournaments");
      if (cup && running() && e.tick - cup.start < 6) {
        if (cup.entrants.has(cmd.company)) return fail("already entered");
        cup.entrants.add(cmd.company); cup.w.join(cmd.company);
        return OK;
      }
      const next = cupAt(e.tick) + 1;
      const set = signups.get(next) ?? new Set<number>();
      if (set.has(cmd.company)) return fail("already entered");
      set.add(cmd.company); signups.set(next, set);
      return OK;
    },
    cards(company) {
      const live = cup && running();
      const nextStart = (Math.floor(e.tick / TOURNAMENT_EVERY) + 1) * TOURNAMENT_EVERY;
      const entered = live ? cup!.entrants.has(company) : [...signups.values()].some(s => s.has(company));
      const detail = live
        ? `Tournament ${cup!.number + 1} is on: most trip profit in ${TOURNAMENT_HOURS} hours wins. ${cup!.entrants.size} entrants.${entered ? ` Your score: ${fmt(cup!.w.gain(company, "profit"))}.` : " Late entries are open for the first 6 hours."}`
        : `Next tournament starts in ${nextStart - e.tick} hours. Most trip profit in ${TOURNAMENT_HOURS} hours wins a trophy and experience.${entered ? " You are entered." : ""}`;
      return [{ title: "Tournaments", detail, actions: entered ? [] : [action("progression.tournaments", "Enter", "enter")] }];
    },
    world() {
      return { live: !!(cup && running()), entrants: cup?.entrants.size ?? 0,
        leaders: cup ? [...cup.entrants].map(id => ({ company: id, name: companyName(e, id), score: cup!.w.gain(id, "profit") })).sort((a, b) => b.score - a.score).slice(0, 5) : [],
        results };
    },
  };
};

export const BLITZ_EVERY = 2 * DAY, BLITZ_HOURS = 6, BLITZ_FEE = 200, BLITZ_BONUS = 500;
export const BLITZ_SPLIT = [0.6, 0.3, 0.1];
export const blitz: FeatureFactory = (e) => {
  const t = tracker(e);
  const phase = () => e.tick % BLITZ_EVERY;        // 0..BLITZ_HOURS-1 running
  const round = () => Math.floor(e.tick / BLITZ_EVERY);
  let entrants = new Map<number, number>();         // company -> round entered for
  let w: Window | null = null, wRound = -1;
  const settle = (r: number) => {
    const field = [...entrants].filter(([, n]) => n === r).map(([id]) => id);
    const pot = field.length * BLITZ_FEE;
    if (field.length < 2) { for (const id of field) { const c = e.companies.get(id); if (c) c.cash += BLITZ_FEE; } }
    else {
      const ranking = field.map(id => ({ id, score: w?.gain(id, "profit") ?? 0 })).sort((a, b) => b.score - a.score || a.id - b.id);
      ranking.slice(0, 3).forEach((r, i) => {
        const c = e.companies.get(r.id);
        if (c) c.cash += Math.round((pot + BLITZ_BONUS) * BLITZ_SPLIT[i]);
        addTrophy(e, r.id, `Speed-trading blitz ${r.id === ranking[0].id ? "winner" : `place ${i + 1}`}`);
      });
    }
    entrants = new Map([...entrants].filter(([, n]) => n !== r));
  };
  return {
    id: "progression.blitz", ideas: [405], title: "Speed-trading blitz", economy: true,
    advance() {
      t.update();
      if (phase() === 0 && wRound !== round()) {
        wRound = round(); w = new Window(t, ["profit"]);
        for (const [id, n] of entrants) if (n === wRound) w.join(id);
      }
      if (phase() === BLITZ_HOURS && wRound === round()) settle(wRound);
    },
    apply(cmd) {
      if (cmd.action !== "enter") return fail("unknown action");
      const c = e.companies.get(cmd.company);
      if (!c) return fail("no company");
      if (t.isBot(cmd.company)) return fail("bots do not enter");
      const next = round() + 1;
      if (entrants.get(cmd.company) === next) return fail("already entered");
      if (c.cash < BLITZ_FEE) return fail(`the entry fee is ${BLITZ_FEE}`);
      c.cash -= BLITZ_FEE;
      entrants.set(cmd.company, next);
      return OK;
    },
    cards(company) {
      const next = round() + 1, entered = entrants.get(company) === next;
      const running = phase() < BLITZ_HOURS && wRound === round();
      return [{ title: "Speed-trading blitz",
        detail: `${running ? `A blitz is running: ${BLITZ_HOURS - phase()} h left. ` : ""}Next blitz in ${BLITZ_EVERY - phase()} h. Entry ${BLITZ_FEE}; the pot plus a ${BLITZ_BONUS} bonus goes 60/30/10 to the most trip profit in ${BLITZ_HOURS} hours. Fewer than two entrants: refunded.`,
        actions: entered ? [] : [action("progression.blitz", `Enter (${BLITZ_FEE})`, "enter")] }];
    },
    view(company) { return { entered: entrants.get(company) ?? null }; },
  };
};

