// art.music and art.sound: the server side of the game's audio. All sound is synthesised in the browser
// (features/art.js, Web Audio, no sound files); the server only shares what every player should hear alike:
// which musical region each harbour belongs to, and the cues for horns, sirens and crane work.
import type { FeatureFactory } from "../types.js";
import { BIOMES, biomeOf, shipWatcher } from "./shared.js";

/** One chiptune theme per island biome, plus the situational themes. Names only; the notes live in art.js. */
export const REGION_THEMES = ["Reef Calypso", "Hedgerow Reel", "Pine Hymn", "Red Cliff Waltz", "Ember Drums"];
export const SITUATION_THEMES = { storm: "Squall Line", pirate: "Black Flag", shanty: "Haul Away" };
export const SHANTY_FLEET = 3;

export const music: FeatureFactory = (e) => {
  let region: number[] = [];
  return {
    id: "art.music", ideas: [167, 461, 462, 463, 469], title: "Chiptune soundtrack, regional themes and shanties", economy: false,
    enable() { region = e.map.ports.map((_, p) => biomeOf(e, p)); },
    world() { return { region, themes: REGION_THEMES, biomes: BIOMES, situations: SITUATION_THEMES }; },
    /** What the player's own music should do: pirate theme for pirate owners, a shanty when a fleet is under way. */
    view(company) {
      const c = e.companies.get(company);
      if (!c) return null;
      const ships = c.ships.map(id => e.ships.get(id)).filter(s => !!s);
      const atSea = ships.filter(s => s.dest !== null).length;
      return {
        home: region[c.home] ?? 0,
        pirate: ships.some(s => s.type === "pirate"),
        shanty: atSea >= SHANTY_FLEET,
      };
    },
  };
};

/** Hours a horn or crane cue stays in the list. */
export const CUE_HOURS = 2;
export interface Cue { kind: "horn-in" | "horn-out"; ship: number; port: number; tick: number }

export const sound: FeatureFactory = (e) => {
  const watch = shipWatcher(e);
  let cues: Cue[] = [];
  return {
    id: "art.sound", ideas: [166, 168, 169, 464, 465, 466, 470], title: "Sea ambience, horns, sirens and sound effects", economy: false,
    enable() { watch.reset(); cues = []; },
    advance() {
      const step = watch.step();
      for (const a of step.arrivals) cues.push({ kind: "horn-in", ship: a.ship, port: a.port, tick: e.tick });
      for (const d of step.departures) cues.push({ kind: "horn-out", ship: d.ship, port: d.port, tick: e.tick });
      cues = cues.filter(c => c.tick > e.tick - CUE_HOURS).slice(-20);
    },
    world() {
      const hour = e.tick % 24;
      return {
        cues: cues.map(c => ({ ...c })),
        // Police boats under way sound their sirens (and flash their lights in art.scene's drawing).
        sirens: e.police.ships.filter(p => p.dest !== null).map(p => p.id),
        night: hour >= 20 || hour < 6,
      };
    },
  };
};
