import { existsSync, readdirSync, readFileSync } from "node:fs";

/** Data-driven progression content from config/content/progression/*.json, plus data mods from its mods/ folder. */
export interface Condition { stat: string; atLeast: number; per?: string; min?: number }
export interface Achievement extends Condition { id: string; name: string; description: string; kind: "achievement" | "milestone" | "goal"; secret?: boolean; skin?: string; xp?: number }
export interface Title extends Condition { id: string; name: string; description: string; playstyle?: boolean }
export interface QuestTemplate { id: string; text: string; stat: string; target: number; xp: number }
export interface TripRule { good?: string; minQty?: number; maxFuel?: number; minProfit?: number; toRole?: "consumer" | "producer"; minDistance?: number; maxHours?: number }
export interface Puzzle { id: string; kind: "puzzle" | "training"; name: string; text: string; hours?: number; trip?: TripRule; stat?: string; gain?: number; xp: number }
export interface TutorialStep { id: string; name: string; text: string; stat: string; atLeast: number; xp: number }
export interface TechNode { id: string; name: string; cost: number; requires: string[]; text: string; licence?: string; effect?: Partial<Record<"fuel" | "portFee" | "capacity" | "travelHours" | "upkeep", number>> }
export interface Challenge { id: string; name: string; text: string; rule: "maxShips" | "forbidShip" | "onlyGood" | "noQueues"; value?: number | string; xp: number }
export interface Chapter { id: string; name: string; text: string; stat: string; target: number; xp: number }
export interface Preset { id: string; name: string; text: string; theme?: string; map?: string; rules?: Record<string, unknown> }
export interface Content {
  achievements: Achievement[]; skins: { id: string; name: string; colour: string }[]; titles: Title[];
  ranks: { level: number; name: string }[]; ladder: { name: string; beats: number }[];
  track: { points: number; reward: string; label: string }[]; trackTitles: { id: string; name: string }[];
  daily: QuestTemplate[]; weekly: QuestTemplate[]; dailyRouteXp: number;
  puzzles: Puzzle[]; tutorial: TutorialStep[]; nodes: TechNode[];
  challenges: Challenge[]; challengeDays: number; campaign: Chapter[]; presets: Preset[];
  themes: Record<string, { filter: string; labels: Record<string, string> }>;
  mods: string[];
}

const LISTS = ["achievements", "skins", "titles", "ranks", "ladder", "track", "trackTitles", "daily", "weekly", "puzzles",
  "tutorial", "nodes", "challenges", "campaign", "presets"] as const;

const DIR = new URL("../../../../config/content/progression/", import.meta.url);

function readJson(url: URL): Record<string, unknown> | undefined {
  try { return JSON.parse(readFileSync(url, "utf8")); } catch (err) { console.warn(`progression content ${url.pathname} skipped:`, (err as Error).message); }
}

const okId = (v: unknown) => typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v);
const okText = (v: unknown, max = 160) => typeof v === "string" && v.length > 0 && v.length <= max && !/[<>]/.test(v);

/** Every list entry needs a safe id; ranks/ladder/track entries have none and are taken from the base files only. */
function valid(list: string, entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  if (list === "ranks" || list === "ladder" || list === "track") return true;
  if (!okId(entry.id)) return false;
  if ("name" in entry && !okText(entry.name, 60)) return false;
  if ("atLeast" in entry && !Number.isFinite(entry.atLeast)) return false;
  if ("target" in entry && !(Number.isFinite(entry.target) && entry.target > 0)) return false;
  if ("xp" in entry && !(Number.isFinite(entry.xp) && entry.xp >= 0 && entry.xp <= 5000)) return false;
  return true;
}

export function loadContent(dir: URL = DIR): Content {
  const out: any = { dailyRouteXp: 80, challengeDays: 14, themes: {}, mods: [] };
  for (const key of LISTS) out[key] = [];
  const merge = (data: Record<string, unknown>, isMod: boolean) => {
    for (const key of LISTS) {
      const list = data[key];
      if (!Array.isArray(list)) continue;
      if (isMod && (key === "ranks" || key === "ladder" || key === "track")) continue;
      for (const entry of list) {
        if (!valid(key, entry)) continue;
        if (entry.id && out[key].some((e: { id?: string }) => e.id === entry.id)) continue;
        out[key].push(entry);
      }
    }
    if (!isMod) {
      if (typeof data.dailyRouteXp === "number") out.dailyRouteXp = data.dailyRouteXp;
      if (typeof data.challengeDays === "number") out.challengeDays = data.challengeDays;
      if (data.themes && typeof data.themes === "object") Object.assign(out.themes, data.themes);
    }
  };
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
      const data = readJson(new URL(file, dir));
      if (data) merge(data, false);
    }
    const mods = new URL("mods/", dir);
    if (existsSync(mods)) for (const file of readdirSync(mods).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort()) {
      const data = readJson(new URL(file, mods));
      if (!data) continue;
      merge(data, true);
      out.mods.push(okId(data.id) ? data.id : file.replace(/\.json$/, ""));
    }
  }
  out.ranks.sort((a: { level: number }, b: { level: number }) => a.level - b.level);
  out.ladder.sort((a: { beats: number }, b: { beats: number }) => a.beats - b.beats);
  out.track.sort((a: { points: number }, b: { points: number }) => a.points - b.points);
  return out as Content;
}

let cached: Content | undefined;
/** Loaded once per process, at the first module construction. */
export function content(): Content { return cached ??= loadContent(); }
