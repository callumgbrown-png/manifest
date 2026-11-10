// Idea 194: speedrun-style challenges. Start a run on one challenge; the clock is game hours from the start. Best
// times go on a public board per challenge; finishing earns cosmetic rewards only (no money).
import type { Company, Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, companyName, deliveriesSince, fail, OK } from "./shared.js";
import { grant } from "./store.js";

interface Start { worth: number; ships: number; tick: number }
interface Challenge { id: string; name: string; goal: string; par: number; done(e: Engine, c: Company, s: Start, run: Run): boolean }
interface Run { challenge: string; start: Start; ports: Set<number>; tonnes: number; lastScan: number }

export const CHALLENGES: Challenge[] = [
  { id: "grow50", name: "Half again", goal: "Grow net worth by 50%", par: 96, done: (e, c, s) => e.netWorth(c) >= s.worth * 1.5 },
  { id: "deliver500", name: "Five hundred tonnes", goal: "Deliver 500 tonnes of cargo", par: 72, done: (_e, _c, _s, r) => r.tonnes >= 500 },
  { id: "tour5", name: "Grand tour", goal: "Deliver cargo to 5 different ports", par: 96, done: (_e, _c, _s, r) => r.ports.size >= 5 },
  { id: "fleet", name: "Fleet builder", goal: "Own two more ships than at the start", par: 120, done: (_e, c, s) => c.ships.length >= s.ships + 2 },
];
export const MAX_RUN_HOURS = 14 * 24;

export const speedrunsModule: FeatureFactory = (e) => {
  const id = "community.speedruns";
  const runs = new Map<number, Run>();
  const best = new Map<string, Map<number, number>>();   // challenge -> company -> hours
  const finished = new Map<number, Set<string>>();
  const reward = (company: number, ch: Challenge, hours: number) => {
    const set = finished.get(company) ?? new Set<string>();
    set.add(ch.id); finished.set(company, set);
    grant(e, company, "badge.speedrunner");
    if (hours <= ch.par) grant(e, company, "wake.gold");
    if (set.size >= 2) grant(e, company, "logo.stopwatch");
    if (set.size >= CHALLENGES.length) grant(e, company, "pattern.waves");
  };
  const board = (ch: string) => [...(best.get(ch) ?? new Map())].filter(([c]) => e.companies.has(c))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 5).map(([c, h]) => ({ name: companyName(e, c), hours: h }));
  return {
    id, ideas: [194], title: "Speedrun challenges", economy: false,
    apply(cmd) {
      if (cmd.action === "start") {
        const ch = CHALLENGES.find(c => c.id === cmd.challenge);
        if (!ch) return fail("unknown challenge");
        if (runs.has(cmd.company)) return fail("finish or abandon your current run first");
        const c = e.companies.get(cmd.company)!;
        if (e.tick + ch.par > e.seasonHours) return fail("not enough of the season left for that challenge");
        runs.set(c.id, { challenge: ch.id, start: { worth: e.netWorth(c), ships: c.ships.length, tick: e.tick }, ports: new Set(), tonnes: 0, lastScan: e.tick });
        return OK;
      }
      if (cmd.action === "abandon") return runs.delete(cmd.company) ? OK : fail("you have no run going");
      return fail("unknown action");
    },
    advance() {
      for (const [company, run] of [...runs]) {
        const c = e.companies.get(company), ch = CHALLENGES.find(x => x.id === run.challenge)!;
        if (!c) { runs.delete(company); continue; }
        for (const t of deliveriesSince(e, company, run.lastScan)) { run.tonnes += t.qty; run.ports.add(t.to); }
        run.lastScan = e.tick;
        const hours = e.tick - run.start.tick;
        if (ch.done(e, c, run.start, run)) {
          const times = best.get(ch.id) ?? new Map<number, number>();
          if (!times.has(company) || hours < times.get(company)!) times.set(company, hours);
          best.set(ch.id, times);
          runs.delete(company);
          reward(company, ch, hours);
        } else if (hours >= MAX_RUN_HOURS) runs.delete(company);
      }
    },
    cards(company) {
      const run = runs.get(company);
      if (run) {
        const ch = CHALLENGES.find(x => x.id === run.challenge)!;
        return [{ title: `Speedrun: ${ch.name}`, detail: `${ch.goal}. Running for ${e.tick - run.start.tick} h (par ${ch.par} h).`
          + (run.challenge === "deliver500" ? ` ${Math.round(run.tonnes)} of 500 t.` : run.challenge === "tour5" ? ` ${run.ports.size} of 5 ports.` : ""),
          actions: [action(id, "Abandon run", "abandon")] }];
      }
      return [{ title: "Speedrun challenges", detail: CHALLENGES.map(c => `${c.name}: ${c.goal} (par ${c.par} h)`).join("\n")
        + "\nFinishing earns cosmetics; beating par earns the gold wake.",
        actions: [{ ...action(id, "Start a run", "start"), fields: [{ key: "challenge", label: "Challenge", options: CHALLENGES.map(c => ({ value: c.id, label: c.name })) }] }] }];
    },
    view(company) {
      const run = runs.get(company);
      return { run: run ? { challenge: run.challenge, hours: e.tick - run.start.tick, tonnes: run.tonnes, ports: run.ports.size } : null,
        finished: [...(finished.get(company) ?? [])] };
    },
    world() { return CHALLENGES.map(c => ({ id: c.id, name: c.name, goal: c.goal, par: c.par, best: board(c.id) })); },
  };
};
