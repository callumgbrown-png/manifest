// Goal modules: daily quests (386), weekly goals (136), the tutorial chain (137), the free seasonal reward track (385),
// the daily puzzle route (404), scenario puzzles and training missions (403, 412), challenge runs (397) and the co-op
// campaign (402). Rewards are experience and cosmetics only, so none of these touch money.
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { content, type Puzzle, type QuestTemplate, type TripRule } from "./content.js";
import { DAY, fmt, hash, tracker, WEEK, type Finished, type Tracker } from "./tracker.js";
import { action, addTrophy, companyName, dayOf, fail, OK, portName } from "./shared.js";
import type { Engine } from "../../engine.js";

interface Quest { id: string; text: string; stat: string; base: number; target: number; xp: number; done: boolean }
interface QuestSet { period: number; quests: Quest[] }

/** Picks `count` distinct templates for a company and period, deterministically. */
function pick(templates: QuestTemplate[], count: number, company: number, period: number, salt: number): QuestTemplate[] {
  const order = templates.map((q, i) => ({ q, r: hash(company, period, salt, i) })).sort((a, b) => a.r - b.r);
  return order.slice(0, Math.min(count, templates.length)).map(o => o.q);
}

/** Shared engine for daily quests and weekly goals. */
function questRunner(e: Engine, t: Tracker, templates: () => QuestTemplate[], length: number, count: number, salt: number) {
  const sets = new Map<number, QuestSet>();
  const scale = (company: number) => 1 + 0.5 * t.starsOf(company);
  return {
    sets,
    advance() {
      t.update();
      const period = Math.floor(e.tick / length);
      for (const id of e.companies.keys()) {
        if (t.isBot(id) || t.fallen.has(id)) continue;
        let set = sets.get(id);
        if (!set || set.period !== period) {
          set = { period, quests: pick(templates(), count, id, period, salt).map(q => ({ id: q.id, stat: q.stat, xp: q.xp,
            target: Math.ceil(q.target * scale(id)), base: t.value(id, q.stat), text: q.text.replace("{n}", fmt(Math.ceil(q.target * scale(id)))), done: false })) };
          sets.set(id, set);
        }
        for (const q of set.quests) if (!q.done && t.value(id, q.stat) - q.base >= q.target) { q.done = true; t.award(id, q.xp); }
      }
    },
    view(company: number) {
      const set = sets.get(company);
      if (!set) return [];
      return set.quests.map(q => ({ id: q.id, text: q.text, xp: q.xp, done: q.done, progress: Math.min(q.target, Math.max(0, t.value(company, q.stat) - q.base)), target: q.target }));
    },
    endsIn: () => length - (e.tick % length),
  };
}

export const dailyQuests: FeatureFactory = (e) => {
  const t = tracker(e), r = questRunner(e, t, () => content().daily, DAY, 3, 1);
  return {
    id: "progression.daily-quests", ideas: [386], title: "Daily quests", economy: false,
    advance: r.advance,
    cards(company) {
      const v = r.view(company);
      return v.length ? [{ title: "Daily quests", detail: v.map(q => `${q.done ? "Done" : `${fmt(q.progress)}/${fmt(q.target)}`}: ${q.text} (+${q.xp} xp)`).join(". ") + `. New quests in ${r.endsIn()} h.` }] : [];
    },
    view: r.view,
  };
};

export const weeklyGoals: FeatureFactory = (e) => {
  const t = tracker(e), r = questRunner(e, t, () => content().weekly, WEEK, 2, 2);
  return {
    id: "progression.weekly-goals", ideas: [136], title: "Weekly goals", economy: false,
    advance: r.advance,
    cards(company) {
      const v = r.view(company);
      return v.length ? [{ title: "Weekly goals", detail: v.map(q => `${q.done ? "Done" : `${fmt(q.progress)}/${fmt(q.target)}`}: ${q.text} (+${q.xp} xp)`).join(". ") + `. Resets in ${Math.ceil(r.endsIn() / DAY)} days.` }] : [];
    },
    view: r.view,
  };
};

export const tutorial: FeatureFactory = (e) => {
  const t = tracker(e), step = new Map<number, number>(), skipped = new Set<number>();
  return {
    id: "progression.tutorial", ideas: [137], title: "Tutorial", economy: false,
    advance() {
      t.update();
      const steps = content().tutorial;
      for (const id of e.companies.keys()) {
        if (t.isBot(id) || skipped.has(id) || t.tutorialDone.has(id)) continue;
        let i = step.get(id) ?? 0;
        while (i < steps.length && t.met(id, steps[i])) { t.award(id, steps[i].xp); i++; }
        step.set(id, i);
        if (i >= steps.length) t.tutorialDone.add(id);
      }
    },
    apply(cmd) {
      if (cmd.action !== "skip") return fail("unknown action");
      if (t.tutorialDone.has(cmd.company)) return fail("the tutorial is already finished");
      skipped.add(cmd.company);
      return OK;
    },
    cards(company) {
      const steps = content().tutorial, i = step.get(company) ?? 0;
      if (skipped.has(company) || i >= steps.length) return [];
      return [{ title: `Tutorial ${i + 1}/${steps.length}: ${steps[i].name}`, detail: `${steps[i].text} (+${steps[i].xp} xp)`,
        actions: [action("progression.tutorial", "Skip the tutorial", "skip")] }];
    },
    view(company) {
      const i = step.get(company) ?? 0;
      return { step: i, skipped: skipped.has(company), steps: content().tutorial.map((s, n) => ({ id: s.id, name: s.name, text: s.text, done: n < i })) };
    },
  };
};

/** Season-track points: one per 5 experience. */
export const trackPoints = (t: Tracker, company: number) => Math.floor(t.xp(company) / 5);
export const seasonTrack: FeatureFactory = (e) => {
  const t = tracker(e), claimed = new Map<number, number>();   // company -> rewards reached so far
  return {
    id: "progression.season-track", ideas: [385], title: "Season track", economy: false,
    advance() {
      t.update();
      const track = content().track;
      for (const id of e.companies.keys()) {
        if (t.isBot(id)) continue;
        let n = claimed.get(id) ?? 0;
        while (n < track.length && trackPoints(t, id) >= track[n].points) { t.unlock(id, track[n].reward); n++; }
        if (n) claimed.set(id, n);
      }
    },
    cards(company) {
      const track = content().track, n = claimed.get(company) ?? 0, pts = trackPoints(t, company);
      return [{ title: `Season track: ${fmt(pts)} points`,
        detail: `Free rewards unlocked: ${n} of ${track.length}.${n < track.length ? ` Next: ${track[n].label} at ${fmt(track[n].points)} points.` : " Track complete!"} Points come from experience.` }];
    },
    view(company) {
      const n = claimed.get(company) ?? 0;
      return { points: trackPoints(t, company), rewards: content().track.map((r, i) => ({ ...r, unlocked: i < n })) };
    },
  };
};

export interface DailyRoute { day: number; from: number; to: number; good: number }
/** The day's route: a producer of a good to a reachable consumer of it, picked by hash. */
export function routeForDay(e: Engine, day: number): DailyRoute | undefined {
  const options: Omit<DailyRoute, "day">[] = [];
  e.map.ports.forEach((p, from) => GOODS.forEach((g, good) => {
    if (!p.produces.includes(g)) return;
    e.map.ports.forEach((q, to) => { if (to !== from && q.consumes.includes(g) && Number.isFinite(e.dist[from][to])) options.push({ from, to, good }); });
  }));
  if (!options.length) return undefined;
  return { day, ...options[Math.floor(hash(day, 404) * options.length)] };
}
export const dailyRoute: FeatureFactory = (e) => {
  const t = tracker(e), done = new Map<number, number>();   // company -> last day completed
  let today: DailyRoute | undefined;
  const current = () => { const d = dayOf(e.tick); return today?.day === d ? today : routeForDay(e, d); };
  return {
    id: "progression.daily-route", ideas: [404], title: "Daily route", economy: false,
    advance() {
      t.update();
      today = current();
      if (!today) return;
      for (const f of t.finished) {
        if (f.trip.from !== today.from || f.trip.to !== today.to || f.trip.good !== today.good || dayOf(f.trip.arriveTick) !== today.day) continue;
        if (done.get(f.company) === today.day || t.isBot(f.company)) continue;
        done.set(f.company, today.day);
        t.award(f.company, content().dailyRouteXp);
      }
    },
    cards(company) {
      const r = current();
      if (!r) return [];
      return [{ title: "Today's route", detail: `Carry ${GOODS[r.good]} from ${portName(e, r.from)} to ${portName(e, r.to)} and arrive today for ${content().dailyRouteXp} xp.`
        + (done.get(company) === r.day ? " Done for today." : "") }];
    },
    view(company) { const r = current(); return r ? { ...r, done: done.get(company) === r.day } : null; },
    world() { const r = current(); return r ? { from: r.from, to: r.to, good: GOODS[r.good] } : null; },
  };
};

/** Does a finished trip satisfy a puzzle's trip rule? */
export function tripMatches(e: Engine, f: Finished, rule: TripRule): boolean {
  const { trip } = f;
  if (trip.good === null) return false;
  if (rule.good !== undefined && GOODS[trip.good] !== rule.good) return false;
  if (rule.minQty !== undefined && trip.qty < rule.minQty) return false;
  if (rule.maxFuel !== undefined && (trip.costs?.fuel ?? Infinity) > rule.maxFuel) return false;
  if (rule.minProfit !== undefined && f.profit < rule.minProfit) return false;
  if (rule.minDistance !== undefined && f.distance < rule.minDistance) return false;
  if (rule.maxHours !== undefined && trip.arriveTick - trip.departTick > rule.maxHours) return false;
  if (rule.toRole) {
    const port = e.map.ports[trip.to], g = GOODS[trip.good];
    if (!port || !(rule.toRole === "consumer" ? port.consumes : port.produces).includes(g)) return false;
  }
  return true;
}

interface Attempt { id: string; start: number; base: number }
export const puzzles: FeatureFactory = (e) => {
  const t = tracker(e), active = new Map<number, Attempt>(), solved = new Map<number, Set<string>>(), lastFail = new Map<number, string>();
  const find = (id: unknown): Puzzle | undefined => typeof id === "string" ? content().puzzles.find(p => p.id === id) : undefined;
  return {
    id: "progression.puzzles", ideas: [403, 412], title: "Puzzles and training", economy: false,
    advance() {
      t.update();
      for (const [company, a] of active) {
        const p = find(a.id);
        if (!p) { active.delete(company); continue; }
        const win = p.trip ? t.finished.some(f => f.company === company && f.trip.departTick >= a.start && tripMatches(e, f, p.trip!))
          : !!p.stat && t.value(company, p.stat) - a.base >= (p.gain ?? 1);
        if (win) {
          active.delete(company);
          const set = solved.get(company) ?? new Set<string>(); set.add(p.id); solved.set(company, set);
          t.award(company, p.xp);
          if (p.kind === "puzzle") addTrophy(e, company, `Solved the puzzle "${p.name}"`);
        } else if (p.hours !== undefined && e.tick - a.start >= p.hours) {
          active.delete(company); lastFail.set(company, p.id);
        }
      }
    },
    apply(cmd) {
      if (cmd.action === "abandon") return active.delete(cmd.company) ? OK : fail("no puzzle in progress");
      if (cmd.action !== "start") return fail("unknown action");
      const p = find(cmd.puzzle);
      if (!p) return fail("unknown puzzle");
      if (active.has(cmd.company)) return fail("finish or abandon your current puzzle first");
      if (solved.get(cmd.company)?.has(p.id)) return fail("already solved");
      active.set(cmd.company, { id: p.id, start: e.tick, base: p.stat ? t.value(cmd.company, p.stat) : 0 });
      lastFail.delete(cmd.company);
      return OK;
    },
    cards(company) {
      const a = active.get(company), done = solved.get(company) ?? new Set();
      const open = content().puzzles.filter(p => !done.has(p.id));
      if (a) {
        const p = find(a.id)!;
        return [{ title: `${p.kind === "puzzle" ? "Puzzle" : "Training"}: ${p.name}`,
          detail: `${p.text}${p.hours !== undefined ? ` ${Math.max(0, p.hours - (e.tick - a.start))} h left.` : ""} (+${p.xp} xp)`,
          actions: [action("progression.puzzles", "Abandon", "abandon")] }];
      }
      if (!open.length) return [{ title: "Puzzles and training", detail: "Every puzzle and training mission solved." }];
      const failed = lastFail.get(company);
      return [{ title: "Puzzles and training", detail: `${done.size} of ${content().puzzles.length} solved.${failed ? ` Time ran out on "${find(failed)?.name}".` : ""} Training missions have no time limit.`,
        actions: [action("progression.puzzles", "Start", "start", {}, [{ key: "puzzle", label: "Puzzle", options: open.map(p => ({ value: p.id, label: `${p.name}${p.hours ? ` (${p.hours} h)` : ""}` })) }])] }];
    },
    view(company) {
      const a = active.get(company);
      return { active: a ? { ...a } : null, solved: [...(solved.get(company) ?? [])].sort(),
        list: content().puzzles.map(p => ({ id: p.id, kind: p.kind, name: p.name, text: p.text, hours: p.hours ?? null, xp: p.xp })) };
    },
  };
};

export const CHALLENGE_MIN_DELIVERIES = 5;
interface Run { id: string; start: number; deliveries: number; failed?: string }
export const challenges: FeatureFactory = (e) => {
  const t = tracker(e), runs = new Map<number, Run>(), won = new Map<number, Set<string>>();
  const find = (id: unknown) => typeof id === "string" ? content().challenges.find(c => c.id === id) : undefined;
  return {
    id: "progression.challenges", ideas: [397], title: "Challenge runs", economy: false,
    advance() {
      t.update();
      for (const [company, run] of runs) {
        const ch = find(run.id), c = e.companies.get(company);
        if (!ch || !c || run.failed) continue;
        const ships = c.ships.map(id => e.ships.get(id)).filter(s => !!s);
        const mine = t.finished.filter(f => f.company === company && f.trip.departTick >= run.start);
        run.deliveries += mine.length;
        if (ch.rule === "maxShips" && c.ships.length > Number(ch.value)) run.failed = `owned more than ${ch.value} ship(s)`;
        if (ch.rule === "forbidShip" && ships.some(s => s!.type === ch.value)) run.failed = `owned a ${ch.value}`;
        if (ch.rule === "onlyGood" && mine.some(f => GOODS[f.trip.good!] !== ch.value)) run.failed = `delivered something other than ${ch.value}`;
        if (ch.rule === "noQueues" && c.ships.some(id => e.voyageQueues.has(id))) run.failed = "used a voyage queue";
        if (run.failed) continue;
        if (e.tick - run.start >= content().challengeDays * DAY) {
          runs.delete(company);
          if (run.deliveries >= CHALLENGE_MIN_DELIVERIES) {
            const set = won.get(company) ?? new Set<string>(); set.add(ch.id); won.set(company, set);
            t.award(company, ch.xp);
            addTrophy(e, company, `Completed the challenge run "${ch.name}"`);
          } else run.failed = `fewer than ${CHALLENGE_MIN_DELIVERIES} deliveries`;
        }
      }
    },
    apply(cmd) {
      if (cmd.action === "abandon") return runs.delete(cmd.company) ? OK : fail("no challenge run in progress");
      if (cmd.action !== "start") return fail("unknown action");
      const ch = find(cmd.challenge);
      if (!ch) return fail("unknown challenge");
      const cur = runs.get(cmd.company);
      if (cur && !cur.failed) return fail("finish or abandon your current challenge first");
      if (won.get(cmd.company)?.has(ch.id)) return fail("already completed");
      runs.set(cmd.company, { id: ch.id, start: e.tick, deliveries: 0 });
      return OK;
    },
    cards(company) {
      const run = runs.get(company), done = won.get(company) ?? new Set();
      if (run && !run.failed) {
        const ch = find(run.id)!;
        return [{ title: `Challenge: ${ch.name}`, detail: `${ch.text} ${Math.max(0, Math.ceil((content().challengeDays * DAY - (e.tick - run.start)) / DAY))} days left; ${run.deliveries} deliveries so far (${CHALLENGE_MIN_DELIVERIES} needed).`,
          actions: [action("progression.challenges", "Abandon", "abandon")] }];
      }
      const open = content().challenges.filter(c => !done.has(c.id));
      return open.length ? [{ title: "Challenge runs",
        detail: `${run?.failed ? `Last run failed: ${run.failed}. ` : ""}Keep to a rule for ${content().challengeDays} days and make ${CHALLENGE_MIN_DELIVERIES}+ deliveries.`,
        actions: [action("progression.challenges", "Start", "start", {}, [{ key: "challenge", label: "Challenge", options: open.map(c => ({ value: c.id, label: `${c.name}: ${c.text}` })) }])] }] : [];
    },
    view(company) { const r = runs.get(company); return { run: r ? { ...r } : null, won: [...(won.get(company) ?? [])].sort() }; },
  };
};

export const CREW_MAX = 4;
interface Crew { id: number; members: number[]; chapter: number; base: Map<number, number> }
export const coopCampaign: FeatureFactory = (e) => {
  const t = tracker(e), crews = new Map<number, Crew>();
  let nextId = 1;
  const crewOf = (company: number) => [...crews.values()].find(c => c.members.includes(company));
  const chapter = (c: Crew) => content().campaign[c.chapter];
  const progress = (c: Crew) => { const ch = chapter(c); return ch ? c.members.reduce((sum, m) => sum + Math.max(0, t.value(m, ch.stat) - (c.base.get(m) ?? 0)), 0) : 0; };
  const rebase = (c: Crew) => { const ch = chapter(c); c.base = new Map(c.members.map(m => [m, ch ? t.value(m, ch.stat) : 0])); };
  return {
    id: "progression.coop-campaign", ideas: [402], title: "Co-op campaign", economy: false,
    advance() {
      t.update();
      for (const c of crews.values()) {
        const ch = chapter(c);
        if (!ch || progress(c) < ch.target) continue;
        for (const m of c.members) { t.award(m, ch.xp); addTrophy(e, m, `Crew campaign: ${ch.name}`); }
        c.chapter++;
        rebase(c);
      }
    },
    apply(cmd) {
      const mine = crewOf(cmd.company);
      if (cmd.action === "found") {
        if (mine) return fail("leave your crew first");
        const c: Crew = { id: nextId++, members: [cmd.company], chapter: 0, base: new Map() };
        rebase(c); crews.set(c.id, c);
        return { ok: true, id: c.id };
      }
      if (cmd.action === "join") {
        if (mine) return fail("leave your crew first");
        const c = typeof cmd.crew === "number" ? crews.get(cmd.crew) : undefined;
        if (!c) return fail("no such crew");
        if (c.members.length >= CREW_MAX) return fail(`a crew has at most ${CREW_MAX} companies`);
        c.members.push(cmd.company);
        const ch = chapter(c);
        c.base.set(cmd.company, ch ? t.value(cmd.company, ch.stat) : 0);
        return OK;
      }
      if (cmd.action === "leave") {
        if (!mine) return fail("you are not in a crew");
        mine.members = mine.members.filter(m => m !== cmd.company);
        mine.base.delete(cmd.company);
        if (!mine.members.length) crews.delete(mine.id);
        return OK;
      }
      return fail("unknown action");
    },
    cards(company) {
      const c = crewOf(company), id = "progression.coop-campaign";
      if (!c) {
        const open = [...crews.values()].filter(x => x.members.length < CREW_MAX);
        return [{ title: "Co-op campaign", detail: `Team up with up to ${CREW_MAX} companies and play the campaign chapters together: everyone's deliveries count.`,
          actions: [action(id, "Found a crew", "found"),
            ...(open.length ? [action(id, "Join a crew", "join", {}, [{ key: "crew", label: "Crew", options: open.map(x => ({ value: x.id, label: `Crew ${x.id}: ${x.members.map(m => companyName(e, m)).join(", ")}` })) }])] : [])] }];
      }
      const ch = chapter(c);
      return [{ title: `Crew ${c.id}: ${ch ? ch.name : "campaign complete"}`,
        detail: `${c.members.map(m => companyName(e, m)).join(", ")}. ${ch ? `${ch.text} Progress ${fmt(progress(c))} / ${fmt(ch.target)}.` : "All chapters done!"}`,
        actions: [action(id, "Leave the crew", "leave")] }];
    },
    view(company) { const c = crewOf(company); return c ? { id: c.id, members: c.members, chapter: c.chapter, progress: progress(c) } : null; },
  };
};
