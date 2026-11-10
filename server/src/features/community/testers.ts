// Ideas 534, 535: tester leaderboard and cosmetic rewards for bug reports. Players file a structured bug report in the
// game (kind and where; no free text, so nothing personal). When Dave confirms a report he sends the player a
// "points" unlock code (tools/community/make-codes.mjs --grant points:3); tester points unlock the bug-hunter
// cosmetics and rank the public tester board.
import type { FeatureFactory } from "../types.js";
import { action, companyName, day, fail, isInt, OK } from "./shared.js";
import { grant, peek, store } from "./store.js";

export const KINDS = ["prices", "ships", "map", "orders", "contracts", "display", "other"] as const;
export const TIERS: [number, string[]][] = [[1, ["badge.bug-hunter-1", "plate.tester"]], [5, ["badge.bug-hunter-2", "pattern.barnacle"]], [15, ["badge.bug-hunter-3", "wake.lighthouse"]]];
export const REPORTS_PER_DAY = 3, REPORTS_KEPT = 200;

export const testersModule: FeatureFactory = (e) => {
  const id = "community.testers";
  let nextId = 1;
  const reports: { id: number; company: number; kind: string; port: number | null; ship: number | null; tick: number }[] = [];
  const daily = new Map<number, { day: number; n: number }>();
  const award = () => {
    for (const [company, l] of store(e).lockers) for (const [need, items] of TIERS) if (l.points >= need) for (const it of items) grant(e, company, it);
  };
  return {
    id, ideas: [534, 535], title: "Testers", economy: false,
    apply(cmd) {
      if (cmd.action !== "report") return fail("unknown action");
      if (typeof cmd.kind !== "string" || !(KINDS as readonly string[]).includes(cmd.kind)) return fail("choose what kind of problem it is");
      const port = cmd.port === undefined || cmd.port === null || cmd.port === -1 ? null : cmd.port;
      if (port !== null && !isInt(port, 0, e.n - 1)) return fail("unknown port");
      const ship = cmd.ship === undefined || cmd.ship === null || cmd.ship === -1 ? null : cmd.ship;
      if (ship !== null && (typeof ship !== "number" || e.ships.get(ship)?.owner !== cmd.company)) return fail("not your ship");
      const d = day(e), n = daily.get(cmd.company);
      if (n && n.day === d && n.n >= REPORTS_PER_DAY) return fail(`at most ${REPORTS_PER_DAY} reports a day`);
      daily.set(cmd.company, { day: d, n: (n?.day === d ? n.n : 0) + 1 });
      reports.push({ id: nextId++, company: cmd.company, kind: cmd.kind, port, ship: ship as number | null, tick: e.tick });
      if (reports.length > REPORTS_KEPT) reports.shift();
      return { ok: true, id: nextId - 1 };
    },
    advance() { award(); },
    cards(company) {
      const pts = peek(e, company).points, next = TIERS.find(([need]) => pts < need);
      return [{ title: "Report a bug", detail: `Tell us what went wrong and where. Confirmed reports earn tester points (you have ${pts}).`
        + (next ? ` ${next[0]} points unlock the next bug-hunter reward.` : " You have every bug-hunter reward."),
        actions: [{ ...action(id, "Send report", "report"), fields: [
          { key: "kind", label: "Problem with", options: KINDS.map(k => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })) },
          { key: "port", label: "Where", value: -1, options: [{ value: -1, label: "Not at a port" }, ...e.map.ports.map((p, i) => ({ value: i, label: p.name }))] }] }] }];
    },
    view(company) { return { points: peek(e, company).points, reports: reports.filter(r => r.company === company).map(r => ({ id: r.id, kind: r.kind, tick: r.tick })) }; },
    world() {
      return [...store(e).lockers].filter(([c, l]) => l.points > 0 && e.companies.has(c))
        .sort((a, b) => b[1].points - a[1].points || a[0] - b[0]).slice(0, 10).map(([c, l]) => ({ name: companyName(e, c), points: l.points }));
    },
  };
};
