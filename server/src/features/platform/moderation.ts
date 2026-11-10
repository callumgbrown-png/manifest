// Player-facing safety tools: bug reports, player reports with reputation penalties and appeals, and
// mute/block lists with the shared text filter. All free text is length-limited and filtered (shared.ts).
import type { Engine } from "../../engine.js";
import { allowAction, ageHours, cleanText, fail, flag, int, noteCompanies, ok, type PlatformFactory } from "./shared.js";

const BUG_KINDS = ["prices", "ships", "orders", "map", "display", "other"] as const;
const REPORT_REASONS = ["cheating", "offensive name", "harassment", "exploit", "other"] as const;

function shipSnapshot(e: Engine, company: number) {
  const c = e.companies.get(company)!;
  return c.ships.map(id => e.ships.get(id)!).map(s => ({ id: s.id, type: s.type, port: s.port, dest: s.dest, good: s.good, qty: Math.round(s.qty) }));
}

/** 199: an in-game bug report button. Saves the player's words plus a small state snapshot for debugging. */
export const bugReport: PlatformFactory = (e) => {
  const reports: { id: number; tick: number; company: number; kind: string; text: string | null;
    snapshot: { cash: number; ships: ReturnType<typeof shipSnapshot>; features: number } }[] = [];
  let seq = 0;
  return {
    id: "platform.bug-report", ideas: [199], title: "Report a bug", economy: false,
    apply(cmd) {
      if (cmd.action !== "report") return fail("unknown action");
      const kind = BUG_KINDS.find(k => k === cmd.kind);
      if (!kind) return fail("choose what the bug is about");
      const text = cmd.text === undefined || cmd.text === "" ? null : cleanText(cmd.text, 280);
      if (cmd.text !== undefined && cmd.text !== "" && text === null) return fail("describe the bug in plain text");
      if (!allowAction(e, cmd.company, "bug-report", 3, 24)) return fail("you can send 3 bug reports a day");
      reports.push({ id: ++seq, tick: e.tick, company: cmd.company, kind, text,
        snapshot: { cash: Math.round(e.companies.get(cmd.company)!.cash), ships: shipSnapshot(e, cmd.company), features: e.features.list().length } });
      if (reports.length > 200) reports.shift();
      return { ok: true, id: seq };
    },
    cards: () => [{ title: "Report a bug", detail: "Tell us what went wrong. We save your fleet's positions with the report so we can find it. Use the bug box under the Fleet tab to add a description (up to 280 characters).",
      actions: [{ label: "Send bug report", command: { type: "feature", module: "platform.bug-report", action: "report" },
        fields: [{ key: "kind", label: "What is it about?", options: BUG_KINDS.map(k => ({ value: k, label: k })), value: "other" }] }] }],
    view: (company) => ({ sent: reports.filter(r => r.company === company).length }),
    admin: () => ({ reports: reports.slice(-50) }),
  };
};

/** 556, 559, 560: player reports, automatic reputation penalties and appeals. */
export const playerReports: PlatformFactory = (e) => {
  const reports: { tick: number; from: number; target: number; reason: string; text: string | null }[] = [];
  const reputation = new Map<number, number>();       // 0..100, default 100
  const penalties = new Map<number, number>();        // tick of the last penalty
  const appeals: { id: number; company: number; tick: number; text: string; status: "open" | "lifted" | "kept" }[] = [];
  let appealSeq = 0;
  const rep = (id: number) => reputation.get(id) ?? 100;
  const reportersOf = (target: number, hours: number) =>
    new Set(reports.filter(r => r.target === target && e.tick - r.tick < hours && rep(r.from) >= 50).map(r => r.from));
  return {
    id: "platform.reports", ideas: [556, 559, 560], title: "Fair play reports", economy: false,
    enable() { noteCompanies(e); },
    apply(cmd) {
      if (cmd.action === "report") {
        const target = int(cmd.target, 1, 1e9);
        if (target === null || !e.companies.has(target)) return fail("choose a company to report");
        if (target === cmd.company) return fail("you can't report yourself");
        const reason = REPORT_REASONS.find(r => r === cmd.reason);
        if (!reason) return fail("choose a reason");
        const text = cmd.text === undefined || cmd.text === "" ? null : cleanText(cmd.text, 200);
        if (ageHours(e, cmd.company) < 24) return fail("new companies can report after their first day");
        if (reports.some(r => r.from === cmd.company && r.target === target && e.tick - r.tick < 72)) return fail("you already reported this company recently");
        if (!allowAction(e, cmd.company, "player-report", 5, 24)) return fail("you can send 5 reports a day");
        reports.push({ tick: e.tick, from: cmd.company, target, reason, text });
        if (reports.length > 500) reports.shift();
        // Three different established reporters within three days: a reputation penalty and an admin review flag.
        if (reportersOf(target, 72).size >= 3 && e.tick - (penalties.get(target) ?? -1e9) >= 72) {
          reputation.set(target, Math.max(0, rep(target) - 10));
          penalties.set(target, e.tick);
          flag(e, target, "player-reports", `${reportersOf(target, 72).size} players reported this company (latest reason: ${reason})`);
        }
        return ok;
      }
      if (cmd.action === "appeal") {
        const text = cleanText(cmd.text, 400);
        if (!text || text.length < 10) return fail("write at least 10 characters for your appeal");
        if (rep(cmd.company) >= 100) return fail("you have no penalty to appeal");
        if (appeals.some(a => a.company === cmd.company && a.status === "open")) return fail("your appeal is already being reviewed");
        if (!allowAction(e, cmd.company, "appeal", 1, 72)) return fail("you can appeal once every three days");
        appeals.push({ id: ++appealSeq, company: cmd.company, tick: e.tick, text, status: "open" });
        return { ok: true, id: appealSeq };
      }
      return fail("unknown action");
    },
    advance() {
      noteCompanies(e);
      if (e.tick % 24 === 0) for (const [id, r] of reputation) if (r < 100) reputation.set(id, Math.min(100, r + 1));
      // Automatic review: with no new penalty for three days after an appeal, the latest penalty is lifted.
      for (const a of appeals) if (a.status === "open" && e.tick - a.tick >= 72) {
        const repeated = (penalties.get(a.company) ?? -1) > a.tick;
        a.status = repeated ? "kept" : "lifted";
        if (!repeated) reputation.set(a.company, Math.min(100, rep(a.company) + 10));
      }
      while (appeals.length > 200) appeals.shift();
    },
    cards: (company) => {
      const others = [...e.companies.values()].filter(c => c.id !== company).slice(0, 60);
      const cards = others.length ? [{ title: "Report a player", detail: "Reports are reviewed by the admin. Three players reporting the same company within three days lowers its fair-play reputation until it appeals or it recovers (1 point a day).",
        actions: [{ label: "Report", command: { type: "feature", module: "platform.reports", action: "report" },
          fields: [{ key: "target", label: "Company", options: others.map(c => ({ value: c.id, label: c.name })) },
            { key: "reason", label: "Reason", options: REPORT_REASONS.map(r => ({ value: r, label: r })) }] }] }] : [];
      return cards;
    },
    view: (company) => ({ reputation: rep(company), appeal: appeals.filter(a => a.company === company).at(-1)?.status ?? null,
      reported: reports.filter(r => r.from === company && e.tick - r.tick < 72).map(r => r.target) }),
    world: () => ({ lowReputation: [...reputation].filter(([, r]) => r < 100).map(([id, r]) => ({ id, r })).slice(0, 50) }),
    admin: () => ({ reports: reports.slice(-50), appeals: appeals.filter(a => a.status === "open"), reputation: Object.fromEntries(reputation) }),
  };
};

/** 557, 558: mute and block lists (for any chat or board in the game) plus the shared text filter. */
export const chatSafety: PlatformFactory = (e) => {
  const lists = new Map<number, { muted: Set<number>; blocked: Set<number> }>();
  const of = (id: number) => { let l = lists.get(id); if (!l) lists.set(id, l = { muted: new Set(), blocked: new Set() }); return l; };
  return {
    id: "platform.chat-safety", ideas: [557, 558], title: "Mute and block", economy: false,
    apply(cmd) {
      const target = int(cmd.target, 1, 1e9);
      if (target === null || !e.companies.has(target) || target === cmd.company) return fail("choose another company");
      const l = of(cmd.company);
      const set = cmd.action === "mute" || cmd.action === "unmute" ? l.muted : cmd.action === "block" || cmd.action === "unblock" ? l.blocked : null;
      if (!set) return fail("unknown action");
      if (cmd.action.startsWith("un")) { if (!set.delete(target)) return fail("that company is not on your list"); return ok; }
      if (set.size >= 50) return fail("your list is full (50)");
      set.add(target);
      return ok;
    },
    cards: (company) => {
      const others = [...e.companies.values()].filter(c => c.id !== company).slice(0, 60);
      if (!others.length) return [];
      const field = [{ key: "target", label: "Company", options: others.map(c => ({ value: c.id, label: c.name })) }];
      const act = (action: string, label: string) => ({ label, command: { type: "feature", module: "platform.chat-safety", action }, fields: field });
      return [{ title: "Mute or block a company", detail: "Muted companies' messages are hidden from you. Blocked companies also can't send you contracts or messages. Only you see your lists.",
        actions: [act("mute", "Mute"), act("block", "Block"), act("unmute", "Unmute"), act("unblock", "Unblock")] }];
    },
    view: (company) => { const l = lists.get(company); return { muted: l ? [...l.muted] : [], blocked: l ? [...l.blocked] : [] }; },
    admin: () => ({ companiesUsingLists: lists.size }),
  };
};

/** True if `by` has blocked `who` (used by other platform modules, e.g. player contracts). */
export function isBlocked(e: Engine, by: number, who: number): boolean {
  const v = e.features.enabled("platform.chat-safety") ? e.features.modules.get("platform.chat-safety")!.view?.(by) as { blocked: number[] } : null;
  return !!v?.blocked.includes(who);
}
