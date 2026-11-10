import type { FeatureFactory } from "../types.js";
import { action, addRep, crewPerk, day, dockedPorts, exhibit, fail, hash, integer, record, shared } from "./shared.js";

export const BOXES = 8, COLUMNS = 3, DROPS = 5, LANE = 20, TRIES_PER_DAY = 3;

/** Today's puzzle for a company: container weights (1-9) in arrival order. */
export const boxesFor = (company: number, d: number) => Array.from({ length: BOXES }, (_, i) => 1 + Math.floor(hash(151, company, d, i) * 9));
/** Today's crane targets (0-20) and the wind on each drop (-2 to 2). Only the first gust is shown in advance. */
export const craneFor = (company: number, d: number) => ({
  targets: Array.from({ length: DROPS }, (_, i) => Math.floor(hash(157, company, d, i) * (LANE + 1))),
  wind: Array.from({ length: DROPS }, (_, i) => Math.floor(hash(163, company, d, i) * 5) - 2),
});

/** Stacking score: a box on a lighter box costs 10, uneven stacks cost 5 per level of difference. 0-100. */
export function stackScore(weights: number[], columns: number[]): number {
  const cols: number[][] = Array.from({ length: COLUMNS }, () => []);
  let score = 100;
  weights.forEach((w, i) => { const col = cols[columns[i]]; if (col.length && col[col.length - 1] < w) score -= 10; col.push(w); });
  const h = cols.map(c => c.length);
  return Math.max(0, score - 5 * (Math.max(...h) - Math.min(...h)));
}
/** Crane score: 4 points off per metre each container lands from its mark (after the wind). 0-100. */
export function craneScore(targets: number[], wind: number[], drops: number[]): number {
  return Math.max(0, 100 - 4 * drops.reduce((sum, x, i) => sum + Math.abs(x + wind[i] - targets[i]), 0));
}
const intList = (v: unknown, n: number, lo: number, hi: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every(x => integer(x) && x >= lo && x <= hi);

/** 272 a cargo-yard stacking minigame and 273 a crane-operator minigame. A fresh puzzle each day, three tries each;
 *  the best scores go into the museum's records. Played in the Opportunities tab (ports.js draws a helper). */
export const minigames: FeatureFactory = (e) => {
  const id = "ports.minigames";
  const tries = new Map<string, number>();                // `${company}:${game}:${day}` -> attempts
  const best = new Map<string, number>();                 // `${company}:${game}` -> best score
  const bonus = (company: number) => (e.companies.get(company)?.ships ?? []).some(s => crewPerk(e, s) === "games") ? 5 : 0;
  const finish = (company: number, game: "stacking" | "crane", raw: number) => {
    const score = Math.min(105, raw + bonus(company));
    const key = `${company}:${game}:${day(e)}`, n = tries.get(key) ?? 0;
    tries.set(key, n + 1);
    if (n === 0) { const port = dockedPorts(e, company)[0]; if (port !== undefined) addRep(e, company, port, 1); }
    const k = `${company}:${game}`;
    if (score > (best.get(k) ?? -1)) best.set(k, score);
    if (record(e, game, company, score)) exhibit(e, game, company, `${e.companies.get(company)?.name} set the ${game} record: ${score}`);
    return { ok: true as const };
  };
  return {
    id, ideas: [272, 273], title: "Harbour games", economy: false,
    apply(cmd) {
      if (!dockedPorts(e, cmd.company).length) return fail("you need a ship in port to play");
      const game = cmd.action === "stack" ? "stacking" : cmd.action === "crane" ? "crane" : undefined;
      if (!game) return fail("unknown action");
      if ((tries.get(`${cmd.company}:${game}:${day(e)}`) ?? 0) >= TRIES_PER_DAY) return fail("three tries a day; come back tomorrow");
      if (game === "stacking") {
        const columns = cmd.columns ?? Array.from({ length: BOXES }, (_, i) => cmd[`c${i}`]);
        if (!intList(columns, BOXES, 0, COLUMNS - 1)) return fail(`give a column 0-${COLUMNS - 1} for each of the ${BOXES} containers`);
        return finish(cmd.company, game, stackScore(boxesFor(cmd.company, day(e)), columns));
      }
      const drops = cmd.drops ?? Array.from({ length: DROPS }, (_, i) => cmd[`d${i}`]);
      if (!intList(drops, DROPS, 0, LANE)) return fail(`give a drop point 0-${LANE} for each of the ${DROPS} containers`);
      const p = craneFor(cmd.company, day(e));
      return finish(cmd.company, game, craneScore(p.targets, p.wind, drops));
    },
    advance() {
      if (e.tick % 24 !== 0) return;
      const today = day(e);
      for (const k of [...tries.keys()]) if (Number(k.split(":")[2]) < today - 1) tries.delete(k);
    },
    cards(company) {
      if (!dockedPorts(e, company).length) return [];
      const d = day(e), boxes = boxesFor(company, d), crane = craneFor(company, d);
      const left = (g: string) => TRIES_PER_DAY - (tries.get(`${company}:${g}:${d}`) ?? 0);
      return [
        { title: "Cargo yard stacking", detail: `Containers arrive weighing ${boxes.join(", ")} (in that order). Put each in column 0, 1 or 2. Never set a heavy box on a lighter one, and keep stacks even. ${left("stacking")} tries left today. Best: ${best.get(`${company}:stacking`) ?? "none"}.`,
          actions: left("stacking") > 0 ? [{ ...action(id, "Stack the containers", "stack"), fields: boxes.map((w, i) => ({ key: `c${i}`, label: `Box ${i + 1} (${w} t)`, min: 0, max: 2, value: i % 3 })) }] : [] },
        { title: "Crane operator", detail: `Land five containers on marks ${crane.targets.join(", ")} (0-${LANE} m along the quay). The first gust blows ${crane.wind[0] >= 0 ? "+" : ""}${crane.wind[0]} m; later gusts are a surprise. ${left("crane")} tries left today. Best: ${best.get(`${company}:crane`) ?? "none"}.`,
          actions: left("crane") > 0 ? [{ ...action(id, "Drop the containers", "crane"), fields: crane.targets.map((t, i) => ({ key: `d${i}`, label: `Drop ${i + 1}`, min: 0, max: LANE, value: t })) }] : [] },
      ];
    },
    view: (company) => ({ stacking: best.get(`${company}:stacking`) ?? null, crane: best.get(`${company}:crane`) ?? null,
      today: { boxes: boxesFor(company, day(e)), targets: craneFor(company, day(e)).targets, firstGust: craneFor(company, day(e)).wind[0] } }),
    world: () => ({ records: Object.fromEntries([...shared(e).records].filter(([g]) => g === "stacking" || g === "crane").map(([g, r]) => [g, r.score])) }),
  };
};
