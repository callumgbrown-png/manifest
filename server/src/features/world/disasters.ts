import type { Engine } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { action, addNews, alongside, bounds, cleanText, clock, companyName, fail, ownShip, polyNear, portBy, portName, portRegion, regions, round1, seaPoint, shipField, slotsBetween, voyagePoly, type SlotSpec } from "./shared.js";

export const ERUPTION_SPEC: SlotSpec = { period: 240, duration: 12, salt: 1301, chance: 0.8, offset: 40 };
export const TSUNAMI_SPEC: SlotSpec = { period: 360, duration: 6, salt: 1302, chance: 0.5, offset: 90 };
export const ERUPTION_DELAY = 2, TSUNAMI_DELAY = 3;

/** The volcanic island is one port chosen from the map; every eruption grows its lava apron. */
export const volcanoPort = (e: Engine) => portBy(e, 1300);
export function volcano(e: Engine, tick = e.tick) {
  const port = volcanoPort(e), p = e.map.ports[port];
  const past = slotsBetween(ERUPTION_SPEC, 0, tick + 1);
  const erupting = past.find(s => s.starts <= tick && s.ends > tick);
  return { port, x: p.x, y: p.y, eruptions: past.filter(s => s.starts <= tick).length, erupting: erupting ? { starts: erupting.starts, ends: erupting.ends } : null };
}
export function tsunami(e: Engine, tick = e.tick) {
  const s = slotsBetween(TSUNAMI_SPEC, tick, tick + 1)[0];
  return s ? { region: Math.floor((s.index * 7 + 3) % regions(e).length), starts: s.starts, ends: s.ends } : null;
}
/** A new island rises a third of the way into the season, off a lane. */
export const emergeTick = (e: Engine) => Math.max(48, Math.floor(e.seasonHours / 3));
export function newIsland(e: Engine) {
  const at = seaPoint(e, 1350, 0.3, 0.7), { w } = bounds(e);
  return round1({ x: at.x + w * 0.012, y: at.y - w * 0.012 });
}

/** Ideas 108, 327 and 332: a volcanic island that erupts and grows, tsunamis that sweep a sea region, and a new
 *  island that rises from the sea and is named by the first captain to reach it. Visual and news only; delays are
 *  world.disaster-effects. */
export const disasters: FeatureFactory = (e) => {
  const id = "world.disasters";
  let named: { name: string; company: number; tick: number } | null = null;
  const emerged = () => e.tick >= emergeTick(e);
  addNews(e, id, () => {
    const out = slotsBetween(ERUPTION_SPEC, Math.max(0, e.tick - 72), e.tick + 1).map(s => ({ tick: s.starts, kind: "disaster",
      text: `The volcano at ${portName(e, volcanoPort(e))} is erupting until ${clock(s.ends)}. The island will never look the same.` }));
    const t = tsunami(e);
    if (t) out.push({ tick: t.starts, kind: "disaster", text: `Tsunami sweeping ${regions(e)[t.region]?.name}. Harbours there are battening down.` });
    if (emerged()) out.push({ tick: emergeTick(e), kind: "discovery", text: "Steam and rock: a new island has risen from the sea." });
    if (named) out.push({ tick: named.tick, kind: "discovery", text: `${companyName(e, named.company)} named the new island ${named.name}.` });
    return out;
  });
  return {
    id, ideas: [108, 327, 332], title: "Volcanoes, tsunamis and new land", economy: false,
    apply(cmd) {
      if (cmd.action !== "name") return fail("unknown action");
      if (!emerged()) return fail("there is no new island yet");
      if (named) return fail(`it is already called ${named.name}`);
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      if (!alongside(e, s, newIsland(e))) return fail("sail to the new island first");
      const name = cleanText(cmd.name, 24);
      if (!name) return fail("choose a name of letters and numbers");
      named = { name, company: cmd.company, tick: e.tick };
      return { ok: true };
    },
    world: () => ({ volcano: volcano(e), tsunami: tsunami(e), island: emerged() ? { ...newIsland(e), name: named?.name ?? "New island", by: named ? companyName(e, named.company) : null } : null }),
    cards(company) {
      const v = volcano(e), t = tsunami(e), lines = [`The volcano at ${portName(e, v.port)} has erupted ${v.eruptions} time${v.eruptions === 1 ? "" : "s"}${v.erupting ? " and is erupting now" : ""}.`];
      if (t) lines.push(`A tsunami is sweeping ${regions(e)[t.region]?.name} until ${clock(t.ends)}.`);
      const cards: FeatureCard[] = [{ title: "Restless earth", detail: lines.join("\n") }];
      if (emerged() && !named) {
        const field = shipField(e, company, s => s.dest !== null);
        cards.push({ title: "A new island", detail: "Fresh land has risen from the sea. The first captain to sail alongside names it.",
          actions: field ? [action(id, "Name the island", "name", {}, [...field, { key: "name", label: "Name", value: "" }])] : [] });
      }
      return cards;
    },
  };
};

/** Economy half (off): eruptions slow voyages passing the volcano and tsunamis hold ships leaving the swept region. */
export const disasterEffects: FeatureFactory = (e) => ({
  id: "world.disaster-effects", ideas: [108, 327], title: "Volcanoes and tsunamis: delays", economy: true,
  adjust: {
    travelHours(v, ctx) {
      let out = v;
      const vol = volcano(e);
      if (vol.erupting && polyNear(e, voyagePoly(e, ctx.from, ctx.dest), vol, 60)) out += ERUPTION_DELAY;
      const t = tsunami(e);
      if (t && portRegion(e, ctx.from) === t.region) out += TSUNAMI_DELAY;
      return out;
    },
  },
});
