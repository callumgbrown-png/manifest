// Civic life: port mayors (361), law proposals and the server council (363, 364), player courts and arbitration
// (367, 368), licences and inspectors (370, 371), player newspapers (373) and community votes on map changes,
// features and weekly questions (375, 377, 378). Laws, verdicts and licences carry trust and honour, never money.
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addTrust, Ballot, cleanLabel, cleanText, companyOptions, DailyLimit, day, fail, isCompany, isPort, name, OK, portName, portOptions,
  record, social, trustOf } from "./shared.js";

export const TERM_HOURS = 7 * 24;
const civic = new WeakMap<Engine, { mayors: Map<number, number>; council: number[]; laws: { id: number; text: string; passed: number }[];
  inspectors: Set<number>; licences: Map<string, { port: number; holder: number; kind: string; until: number; by: number }> }>();
export const civ = (e: Engine) => { let c = civic.get(e); if (!c) civic.set(e, c = { mayors: new Map(), council: [], laws: [], inspectors: new Set(), licences: new Map() }); return c; };
const residents = (e: Engine, port: number) => [...e.companies.values()].filter(c => c.home === port).map(c => c.id);
const termOf = (e: Engine) => Math.floor(e.tick / TERM_HOURS);

// ------------------------------------------------------------ 361 mayors
export const mayorsModule: FeatureFactory = (e) => {
  const id = "social.mayors";
  const candidates = new Map<number, Set<number>>(), votes = new Map<number, Map<number, number>>();   // port -> ...
  const mottos = new Map<number, string>();
  let term = -1;
  return {
    id, ideas: [361], title: "Port mayors", economy: false,
    enable() { term = termOf(e); },
    apply(cmd) {
      const home = e.companies.get(cmd.company)!.home;
      switch (cmd.action) {
        case "stand": (candidates.get(home) ?? candidates.set(home, new Set()).get(home)!).add(cmd.company); return OK;
        case "vote": {
          if (typeof cmd.candidate !== "number" || !candidates.get(home)?.has(cmd.candidate)) return fail("vote for a candidate in your home port");
          (votes.get(home) ?? votes.set(home, new Map()).get(home)!).set(cmd.company, cmd.candidate);
          return OK;
        }
        case "motto": {
          const port = [...civ(e).mayors].find(([, m]) => m === cmd.company)?.[0];
          if (port === undefined) return fail("only a mayor sets the port motto");
          const text = cleanText(cmd.text, 80, 3);
          if (!text) return fail("a motto is 3-80 characters");
          mottos.set(port, text);
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      if (termOf(e) === term) return;
      term = termOf(e);
      for (const [port, cands] of candidates) {
        const tally = new Map<number, number>();
        for (const v of votes.get(port)?.values() ?? []) if (cands.has(v) && e.companies.has(v)) tally.set(v, (tally.get(v) ?? 0) + 1);
        const [best, second] = [...tally].sort((a, b) => b[1] - a[1] || trustOf(e, b[0]) - trustOf(e, a[0]) || a[0] - b[0]);
        if (best && (!second || best[1] >= second[1])) { civ(e).mayors.set(port, best[0]); record(e, "election", null, best[0], 0, `elected mayor of ${portName(e, port)}`); }
        else civ(e).mayors.delete(port);
      }
      candidates.clear(); votes.clear();
    },
    cards(company) {
      const home = e.companies.get(company)?.home;
      if (home === undefined) return [];
      const cands = [...(candidates.get(home) ?? [])].filter(c => e.companies.has(c)), mayor = civ(e).mayors.get(home);
      return [{ title: `Mayor of ${portName(e, home)}`, detail: `${mayor !== undefined ? `Mayor: ${name(e, mayor)}.` : "No mayor."} Companies based here elect one each week (next count at hour ${(termOf(e) + 1) * TERM_HOURS}).`
        + (cands.length ? ` Candidates: ${cands.map(c => name(e, c)).join(", ")}.` : ""),
        actions: [...(!cands.includes(company) ? [action(id, "Stand for mayor", "stand")] : []),
          ...(cands.length ? [{ ...action(id, "Vote", "vote"), fields: [{ key: "candidate", label: "Candidate", options: cands.map(c => ({ value: c, label: name(e, c) })) }] }] : [])] }];
    },
    world() { return [...civ(e).mayors].filter(([, m]) => e.companies.has(m)).map(([port, m]) => ({ port, mayor: name(e, m), motto: mottos.get(port) ?? null })); },
  };
};

// ------------------------------------------------------------ 363, 364 council and laws
export const COUNCIL_SEATS = 5;
export const LAW_TEMPLATES = [
  "Ships keep 1 hour apart when leaving a port together",
  "No raiding ships within sight of their home port",
  "Honour every trade window offer you accept",
  "Return borrowed guild ships on time",
  "Name and shame price fixing in the newspapers",
  "New captains get right of way at their home port",
  "Disputes go to arbitration before court",
  "Guilds announce wars a day ahead",
];
export const lawsModule: FeatureFactory = (e) => {
  const id = "social.laws";
  let term = -1;
  let councilVotes = new Map<number, number>();
  const proposals = new Map<number, { id: number; law: number; by: number; ballot: Ballot<"yes" | "no"> }>();
  let next = 1;
  return {
    id, ideas: [363, 364], title: "Council and laws", economy: false,
    enable() { term = termOf(e); },
    apply(cmd) {
      const c = civ(e);
      switch (cmd.action) {
        case "electCouncil": if (!isCompany(e, cmd.candidate) || cmd.candidate === cmd.company) return fail("vote for another company"); councilVotes.set(cmd.company, cmd.candidate); return OK;
        case "propose": {
          const allowed = c.council.includes(cmd.company) || [...c.mayors.values()].includes(cmd.company);
          if (!allowed) return fail("council members and mayors propose laws");
          if (typeof cmd.law !== "number" || !LAW_TEMPLATES[cmd.law]) return fail("choose a law");
          if (c.laws.some(l => l.text === LAW_TEMPLATES[cmd.law as number]) || [...proposals.values()].some(p => p.law === cmd.law)) return fail("already law or on the ballot");
          proposals.set(next, { id: next, law: cmd.law, by: cmd.company, ballot: new Ballot(["yes", "no"], e.tick + 48) });
          return { ok: true, id: next++ };
        }
        case "vote": {
          const p = typeof cmd.proposal === "number" ? proposals.get(cmd.proposal) : undefined;
          if (!p) return fail("no such proposal");
          const why = p.ballot.cast(cmd.company, cmd.choice);
          return why ? fail(why) : OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      const c = civ(e);
      for (const p of [...proposals.values()]) if (e.tick >= p.ballot.closes) {
        proposals.delete(p.id);
        const [yes, no] = [p.ballot.tally().find(t => t[0] === "yes")![1], p.ballot.tally().find(t => t[0] === "no")![1]];
        if (yes > no && yes >= 2) { c.laws.push({ id: p.law, text: LAW_TEMPLATES[p.law], passed: e.tick }); record(e, "law", null, null, 0, `law passed: ${LAW_TEMPLATES[p.law]}`); }
      }
      if (termOf(e) !== term) {
        term = termOf(e);
        const tally = new Map<number, number>();
        for (const v of councilVotes.values()) if (e.companies.has(v)) tally.set(v, (tally.get(v) ?? 0) + 1);
        if (tally.size) c.council = [...tally].sort((a, b) => b[1] - a[1] || trustOf(e, b[0]) - trustOf(e, a[0]) || a[0] - b[0]).slice(0, COUNCIL_SEATS).map(([id]) => id);
        councilVotes = new Map();
      }
    },
    cards(company) {
      const c = civ(e), mayorOrCouncil = c.council.includes(company) || [...c.mayors.values()].includes(company);
      const open = [...proposals.values()];
      return [{ title: "Server council", detail: `Council: ${c.council.filter(x => e.companies.has(x)).map(x => name(e, x)).join(", ") || "not elected yet"} (elected weekly, ${COUNCIL_SEATS} seats).`
        + `\nLaws: ${c.laws.map(l => l.text).join("; ") || "none yet"}.` + (open.length ? `\nOn the ballot: ${open.map(p => `"${LAW_TEMPLATES[p.law]}" (closes hour ${p.ballot.closes})`).join("; ")}` : ""),
        actions: [{ ...action(id, "Vote for the council", "electCouncil"), fields: [{ key: "candidate", label: "Company", options: companyOptions(e, company) }] },
          ...(mayorOrCouncil ? [{ ...action(id, "Propose a law", "propose"), fields: [{ key: "law", label: "Law", options: LAW_TEMPLATES.map((t, i) => ({ value: i, label: t })).filter(o => !c.laws.some(l => l.id === o.value)) }] }] : []),
          ...open.slice(0, 3).flatMap(p => [action(id, `Yes: ${LAW_TEMPLATES[p.law].slice(0, 30)}…`, "vote", { proposal: p.id, choice: "yes" }), action(id, "No", "vote", { proposal: p.id, choice: "no" })])] }];
    },
    world() { const c = civ(e); return { council: c.council.filter(x => e.companies.has(x)).map(x => name(e, x)), laws: c.laws.map(l => l.text),
      proposals: [...proposals.values()].map(p => ({ id: p.id, law: LAW_TEMPLATES[p.law], closes: p.ballot.closes, by: name(e, p.by) })) }; },
  };
};

// ------------------------------------------------------------ 367, 368 courts and arbitration
export const CHARGES = ["broke a law", "did not honour a deal", "kept a borrowed ship", "harassment in chat", "cheating"] as const;
interface Case { id: number; kind: "court" | "arbitration"; plaintiff: number; accused: number; charge: string; statement: string; defence: string | null;
  judges: number[]; votes: Map<number, "guilty" | "innocent" | "plaintiff" | "accused">; opened: number; verdict: string | null }
export const courtsModule: FeatureFactory = (e) => {
  const id = "social.courts";
  const cases = new Map<number, Case>();
  let next = 1;
  const limit = new DailyLimit(e, 1);
  const pickJudges = (exclude: number[], n: number) => {
    const pool = [...e.companies.keys()].filter(c => !exclude.includes(c) && trustOf(e, c) >= 40).sort((a, b) => a - b);
    const out: number[] = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(e.features.random() * pool.length), 1)[0]);
    return out;
  };
  const decide = (k: Case) => {
    const counts = new Map<string, number>();
    for (const v of k.votes.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    const against = k.kind === "court" ? counts.get("guilty") ?? 0 : counts.get("plaintiff") ?? 0;
    const forAccused = k.kind === "court" ? counts.get("innocent") ?? 0 : counts.get("accused") ?? 0;
    if (against > forAccused) { k.verdict = k.kind === "court" ? "guilty" : `for ${name(e, k.plaintiff)}`; addTrust(e, k.accused, k.kind === "court" ? -8 : -3); }
    else { k.verdict = k.kind === "court" ? "not guilty" : `for ${name(e, k.accused)}`; if (k.kind === "court") addTrust(e, k.plaintiff, -2); }
    record(e, "verdict", k.plaintiff, k.accused, 0, `${k.kind === "court" ? "court" : "arbitration"}: ${k.charge}: ${k.verdict}`);
  };
  return {
    id, ideas: [367, 368], title: "Courts and arbitration", economy: false,
    apply(cmd) {
      switch (cmd.action) {
        case "file": {
          const kind = cmd.kind === "arbitration" ? "arbitration" : cmd.kind === "court" ? "court" : null;
          if (!kind) return fail("choose court or arbitration");
          if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose a company");
          if (!(CHARGES as readonly string[]).includes(cmd.charge as string)) return fail("choose a charge");
          const statement = cleanText(cmd.statement ?? "", 300, 0) ?? "";
          if ([...cases.values()].some(k => !k.verdict && k.plaintiff === cmd.company && k.accused === cmd.target)) return fail("you already have a case open against them");
          if (!limit.take(cmd.company)) return fail("one case a day");
          const judges = pickJudges([cmd.company, cmd.target], kind === "court" ? 3 : 1);
          if (!judges.length) return fail("not enough companies to hear the case");
          cases.set(next, { id: next, kind, plaintiff: cmd.company, accused: cmd.target, charge: cmd.charge as string, statement, defence: null, judges, votes: new Map(), opened: e.tick, verdict: null });
          return { ok: true, id: next++ };
        }
        case "defend": {
          const k = typeof cmd.case === "number" ? cases.get(cmd.case) : undefined;
          if (!k || k.accused !== cmd.company || k.verdict) return fail("no open case against you");
          const text = cleanText(cmd.statement, 300, 3);
          if (!text) return fail("a defence is 3-300 characters");
          k.defence = text;
          return OK;
        }
        case "judge": {
          const k = typeof cmd.case === "number" ? cases.get(cmd.case) : undefined;
          if (!k || !k.judges.includes(cmd.company) || k.verdict) return fail("you are not hearing that case");
          const ok = k.kind === "court" ? ["guilty", "innocent"] : ["plaintiff", "accused"];
          if (!ok.includes(cmd.verdict as string)) return fail(`choose ${ok.join(" or ")}`);
          k.votes.set(cmd.company, cmd.verdict as "guilty");
          if (k.votes.size === k.judges.length) decide(k);
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const k of cases.values()) if (!k.verdict && e.tick - k.opened >= 72) { if (k.votes.size) decide(k); else k.verdict = "dismissed (no judges ruled)"; }
      for (const k of [...cases.values()]) if (k.verdict && e.tick - k.opened > 14 * 24) cases.delete(k.id);
    },
    cards(company) {
      const mine = [...cases.values()].filter(k => !k.verdict && (k.accused === company || k.judges.includes(company)));
      return [{ title: "Courts", detail: "Take a dispute to arbitration (one trusted judge) or a complaint to court (three judges). Verdicts change trust, never cash."
        + mine.map(k => `\nCase ${k.id}: ${name(e, k.plaintiff)} v ${name(e, k.accused)}, "${k.charge}". ${k.statement ? `Plaintiff: "${k.statement}". ` : ""}${k.defence ? `Defence: "${k.defence}".` : ""}`).join(""),
        actions: [{ ...action(id, "Open a case", "file"), fields: [{ key: "kind", label: "Where", options: [{ value: "arbitration", label: "Arbitration" }, { value: "court", label: "Court" }] },
          { key: "target", label: "Against", options: companyOptions(e, company) }, { key: "charge", label: "Charge", options: CHARGES.map(c => ({ value: c, label: c })) }] },
          ...mine.filter(k => k.judges.includes(company) && !k.votes.has(company)).flatMap(k => (k.kind === "court" ? ["guilty", "innocent"] : ["plaintiff", "accused"])
            .map(v => action(id, `Case ${k.id}: ${v === "plaintiff" ? `for ${name(e, k.plaintiff)}` : v === "accused" ? `for ${name(e, k.accused)}` : v}`, "judge", { case: k.id, verdict: v })))] }];
    },
    world() { return [...cases.values()].map(k => ({ id: k.id, kind: k.kind, plaintiff: name(e, k.plaintiff), accused: name(e, k.accused), charge: k.charge, verdict: k.verdict })); },
  };
};

// ------------------------------------------------------------ 370, 371 licences and inspectors
export const LICENCES = ["pilot", "bulk trader", "fuel handler", "good standing"] as const;
export const licencesModule: FeatureFactory = (e) => {
  const id = "social.licences";
  const inspections: { tick: number; inspector: number; ship: number; owner: number; port: number; licensed: boolean }[] = [];
  const key = (port: number, holder: number, kind: string) => `${port}:${holder}:${kind}`;
  return {
    id, ideas: [370, 371], title: "Licences and inspectors", economy: false,
    apply(cmd) {
      const c = civ(e);
      switch (cmd.action) {
        case "issue": case "revoke": {
          const port = [...c.mayors].find(([, m]) => m === cmd.company)?.[0];
          if (port === undefined) return fail("mayors issue licences for their port");
          if (!isCompany(e, cmd.target)) return fail("choose a company");
          if (!(LICENCES as readonly string[]).includes(cmd.kind as string)) return fail("choose a licence");
          const k = key(port, cmd.target, cmd.kind as string);
          if (cmd.action === "revoke") return c.licences.delete(k) ? OK : fail("no such licence");
          c.licences.set(k, { port, holder: cmd.target, kind: cmd.kind as string, until: e.tick + TERM_HOURS * 2, by: cmd.company });
          return OK;
        }
        case "appoint": {
          if (!c.council.includes(cmd.company)) return fail("the council appoints inspectors");
          if (!isCompany(e, cmd.target)) return fail("choose a company");
          if (c.inspectors.size >= 5 && !c.inspectors.has(cmd.target)) return fail("five inspectors at most");
          if (c.inspectors.has(cmd.target)) c.inspectors.delete(cmd.target); else c.inspectors.add(cmd.target);
          return OK;
        }
        case "inspect": {
          if (!c.inspectors.has(cmd.company)) return fail("only inspectors inspect ships");
          const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
          if (!s || s.dest !== null || s.owner === cmd.company) return fail("choose another company's docked ship");
          const own = e.companies.get(cmd.company)!.ships.some(i => { const x = e.ships.get(i)!; return x.dest === null && x.port === s.port; });
          if (!own) return fail("you need a ship in that port");
          if (inspections.some(i => i.ship === s.id && e.tick - i.tick < 24)) return fail("inspected in the last day");
          const licensed = [...c.licences.values()].some(l => l.port === s.port && l.holder === s.owner && l.until > e.tick);
          inspections.push({ tick: e.tick, inspector: cmd.company, ship: s.id, owner: s.owner, port: s.port, licensed });
          if (inspections.length > 100) inspections.shift();
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() { for (const [k, l] of [...civ(e).licences]) if (l.until <= e.tick) civ(e).licences.delete(k); },
    cards(company) {
      const c = civ(e), port = [...c.mayors].find(([, m]) => m === company)?.[0];
      const out = [];
      if (port !== undefined) out.push({ title: `Licences at ${portName(e, port)}`, detail: "As mayor you can license companies (two weeks). Licences are honours inspectors check.",
        actions: [{ ...action(id, "Issue a licence", "issue"), fields: [{ key: "target", label: "Company", options: companyOptions(e, -1) }, { key: "kind", label: "Licence", options: LICENCES.map(l => ({ value: l, label: l })) }] }] });
      if (c.council.includes(company)) out.push({ title: "Inspectors", detail: `Inspectors: ${[...c.inspectors].map(i => name(e, i)).join(", ") || "none"}.`,
        actions: [{ ...action(id, "Appoint or dismiss an inspector", "appoint"), fields: [{ key: "target", label: "Company", options: companyOptions(e, -1) }] }] });
      if (c.inspectors.has(company)) {
        const here = new Set(e.companies.get(company)!.ships.map(i => e.ships.get(i)!).filter(s => s.dest === null).map(s => s.port));
        const targets = [...e.ships.values()].filter(s => s.dest === null && s.owner !== company && here.has(s.port)).slice(0, 20);
        out.push({ title: "Inspect a ship", detail: "Check whether a docked ship's company holds a licence for this port.",
          actions: targets.length ? [{ ...action(id, "Inspect", "inspect"), fields: [{ key: "ship", label: "Ship", options: targets.map(s => ({ value: s.id, label: `${name(e, s.owner)} ${s.type} ${s.id} at ${portName(e, s.port)}` })) }] }] : [] });
      }
      return out;
    },
    world() { const c = civ(e); return { licences: [...c.licences.values()].filter(l => e.companies.has(l.holder)).map(l => ({ port: l.port, holder: name(e, l.holder), kind: l.kind, until: l.until })),
      inspectors: [...c.inspectors].map(i => name(e, i)), inspections: inspections.slice(-20).map(i => ({ tick: i.tick, inspector: name(e, i.inspector), owner: name(e, i.owner), port: i.port, licensed: i.licensed })) }; },
  };
};

// ------------------------------------------------------------ 373 newspapers
export const newspapersModule: FeatureFactory = (e) => {
  const id = "social.newspapers";
  const papers = new Map<number, string>();   // owner -> paper name
  const articles: { id: number; owner: number; headline: string; body: string; tick: number; readers: Set<number> }[] = [];
  let next = 1;
  const limit = new DailyLimit(e, 2);
  return {
    id, ideas: [373], title: "Newspapers", economy: false,
    apply(cmd) {
      if (cmd.action === "found") {
        const n = cleanLabel(cmd.name, 30, 3);
        if (!n) return fail("paper names are 3-30 letters and spaces");
        if ([...papers.values()].some(p => p.toLowerCase() === n.toLowerCase())) return fail("that name is taken");
        papers.set(cmd.company, n);
        return OK;
      }
      if (cmd.action === "publish") {
        if (!papers.has(cmd.company)) return fail("found a paper first");
        const headline = cleanText(cmd.headline, 80, 5), body = cleanText(cmd.body, 800, 20);
        if (!headline || !body) return fail("a headline is 5-80 characters and a story 20-800");
        if (!limit.take(cmd.company)) return fail("two stories a day at most");
        articles.push({ id: next++, owner: cmd.company, headline, body, tick: e.tick, readers: new Set() });
        if (articles.length > 100) articles.shift();
        return OK;
      }
      if (cmd.action === "like") {
        const a = articles.find(x => x.id === cmd.article);
        if (!a || a.owner === cmd.company) return fail("no such story");
        a.readers.add(cmd.company);
        return OK;
      }
      return fail("unknown action");
    },
    cards(company) {
      return [{ title: "Newspapers", detail: papers.has(company) ? `You publish ${papers.get(company)}. Write stories in the Social panel (two a day).` : "Found a paper to write about the season: trades, wars, scandals.",
        actions: [] }];
    },
    world() {
      const live = articles.filter(a => e.companies.has(a.owner) && e.tick - a.tick < 7 * 24);
      const score = (a: typeof live[number]) => a.readers.size * 6 - (e.tick - a.tick) / 4;
      return { front: [...live].sort((a, b) => score(b) - score(a) || b.id - a.id).slice(0, 6).map(a => ({ id: a.id, paper: papers.get(a.owner), by: name(e, a.owner), headline: a.headline, body: a.body, likes: a.readers.size, day: Math.floor(a.tick / 24) + 1 })),
        papers: [...papers].filter(([c]) => e.companies.has(c)).map(([c, p]) => ({ paper: p, owner: name(e, c) })) };
    },
  };
};

// ------------------------------------------------------------ 375, 377, 378 community votes
export const MAP_CHANGES = ["Open a new lane between the two busiest ports", "Add a fishing village in the empty south", "Dredge the shallowest harbour", "Rename the windiest port", "Add a second machinery works"];
export const FEATURE_CHOICES = ["Weather fronts that slow ships", "Passenger ferries", "Port festivals", "A fifth good: timber", "Night and day on the map", "Ship naming contests"];
export const WEEKLY_QUESTIONS: [string, string[]][] = [
  ["Which good is the best to trade?", ["Grain", "Fuel", "Ore", "Machinery"]],
  ["Best ship class?", ["Coaster", "Freighter", "Bulker"]],
  ["How do you deal with pirates?", ["Avoid their lanes", "Pay for escorts", "Become one", "Pray"]],
  ["What should the next season's twist be?", ["Storms", "Gold rush", "Blockade", "Calm seas"]],
  ["When do you play most?", ["Morning", "Afternoon", "Evening", "Night"]],
];
export const pollsModule: FeatureFactory = (e) => {
  const id = "social.polls";
  let week = -1;
  let ballots: Record<"map" | "feature" | "weekly", Ballot<number>> = null!;
  const results: { week: number; poll: string; winner: string }[] = [];
  const fresh = () => {
    const w = Math.floor(e.tick / 168);
    const q = WEEKLY_QUESTIONS[w % WEEKLY_QUESTIONS.length];
    const idx = (n: number) => Array.from({ length: n }, (_, i) => i);
    ballots = { map: new Ballot(idx(MAP_CHANGES.length), (w + 1) * 168), feature: new Ballot(idx(FEATURE_CHOICES.length), (w + 1) * 168), weekly: new Ballot(idx(q[1].length), (w + 1) * 168) };
    week = w;
  };
  const labels = (k: string) => k === "map" ? MAP_CHANGES : k === "feature" ? FEATURE_CHOICES : WEEKLY_QUESTIONS[week % WEEKLY_QUESTIONS.length][1];
  return {
    id, ideas: [375, 377, 378], title: "Community votes", economy: false,
    enable() { fresh(); },
    apply(cmd) {
      if (cmd.action !== "vote") return fail("unknown action");
      const b = (ballots as Record<string, Ballot<number>>)[cmd.poll as string];
      if (!b) return fail("no such poll");
      const why = b.cast(cmd.company, cmd.choice);
      return why ? fail(why) : OK;
    },
    advance() {
      if (Math.floor(e.tick / 168) === week) return;
      for (const k of ["map", "feature", "weekly"] as const) { const w = ballots[k].winner(); if (w !== undefined) results.push({ week: week + 1, poll: k, winner: labels(k)[w] }); }
      while (results.length > 30) results.shift();
      fresh();
    },
    cards(company) {
      const q = WEEKLY_QUESTIONS[week % WEEKLY_QUESTIONS.length];
      const mk = (k: "map" | "feature" | "weekly", title: string) => ({ ...action(id, title, "vote", { poll: k }), fields: [{ key: "choice", label: "Choice", value: ballots[k].votes.get(company) ?? 0, options: labels(k).map((l, i) => ({ value: i, label: l })) }] });
      return [{ title: "Community votes", detail: `This week: map change, next feature, and "${q[0]}". Results are published each week; map and feature winners go to the developers.`,
        actions: [mk("map", "Vote on a map change"), mk("feature", "Vote for a feature"), mk("weekly", q[0])] }];
    },
    world() {
      return { week: week + 1, question: WEEKLY_QUESTIONS[week % WEEKLY_QUESTIONS.length][0],
        polls: (["map", "feature", "weekly"] as const).map(k => ({ poll: k, tally: ballots[k].tally().map(([i, n]) => ({ choice: labels(k)[i], votes: n })) })), results };
    },
  };
};
void day; void isPort; void portOptions; void social;
