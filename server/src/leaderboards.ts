import { isBot } from "./bots.js";
import type { Engine } from "./engine.js";

const WEEK = 7 * 24;

interface Career {
  founded: number;
  ships: number;
  capacity: number;
  worth: number;
  privateer: boolean;
  cargoLanded: number;
  fleetHours: number;
}

interface Entry {
  id: number;
  name: string;
  bot: boolean;
  ships: number;
  worth: number;
  score: number;
}

export interface Board {
  id: string;
  label: string;
  measure: string;
  description: string;
  rows: Entry[];
}

export interface Placement {
  rank: number;
  tied: number;
  companies: number;
  score: number;
}

type FullBoard = Board & { placements: Map<number, Placement> };

function bracket(value: number, first: number, second: number) {
  return value <= first ? 0 : value <= second ? 1 : 2;
}

function rank(rows: Entry[]): Map<number, Placement> {
  const groups = new Map<number, { first: number; count: number }>();
  for (const [i, row] of rows.entries()) {
    const group = groups.get(row.score);
    if (group) group.count++;
    else groups.set(row.score, { first: i + 1, count: 1 });
  }
  return new Map(rows.map(row => {
    const group = groups.get(row.score)!;
    return [row.id, { rank: group.first, tied: group.count - 1, companies: rows.length, score: row.score }];
  }));
}

/** Rebuilt alongside the engine from accepted commands and hourly ticks. */
export class SeasonLeaderboards {
  private readonly careers = new Map<number, Career>();
  private cached?: FullBoard[];
  weekly?: { week: number; leaders: { division: string; names: string[] }[] };

  constructor(private readonly engine: Engine) {}

  observe() {
    this.cached = undefined;
    for (const company of this.engine.companies.values()) {
      const career = this.careers.get(company.id) ?? {
        founded: this.engine.tick, ships: 0, capacity: 0, worth: 0, privateer: false, cargoLanded: 0, fleetHours: 0,
      };
      const ships = company.ships.map(id => this.engine.ships.get(id)!);
      const capacity = ships.reduce((sum, s) => sum + this.engine.spec(s.type).capacity, 0);
      career.ships = Math.max(career.ships, ships.length);
      career.capacity = Math.max(career.capacity, capacity);
      career.worth = Math.max(career.worth, Math.round(this.engine.netWorth(company)));
      career.privateer ||= ships.some(s => s.type === "pirate");
      this.careers.set(company.id, career);
    }
  }

  advance() {
    const e = this.engine;
    if (e.seasonOver) return;
    for (const ship of e.ships.values()) {
      const career = this.careers.get(ship.owner);
      if (!career) continue;
      career.fleetHours++;
      // Record the cargo left aboard on arrival, before the engine can sell or dispatch it again.
      if (ship.dest !== null && ship.arriveTick <= e.tick + 1) career.cargoLanded += ship.qty;
    }
    e.advance();
    this.observe();
    if (e.tick % WEEK === 0) {
      this.weekly = { week: e.tick / WEEK, leaders: this.boards().filter(board => /^[0-2]$/.test(board.id))
        .filter(board => board.rows.length > 0).map(board => ({
          division: board.label, names: board.rows.filter(row => row.score === board.rows[0].score).slice(0, 3).map(row => row.name),
        })) };
    }
  }

  private boards() {
    if (this.cached) return this.cached;
    const e = this.engine;
    const entries = [...e.companies.values()].map(c => {
      const worth = Math.round(e.netWorth(c));
      return { id: c.id, name: c.name, bot: isBot(c.name), worth, score: worth, ships: c.ships.length };
    });
    const boards: FullBoard[] = [];
    const add = (id: string, label: string, description: string, filter: (career: Career) => boolean,
      measure = "Net worth", score?: (career: Career) => number) => {
      const rows = entries.filter(row => filter(this.careers.get(row.id)!))
        .map(row => score ? { ...row, score: score(this.careers.get(row.id)!) } : row)
        .sort((a, b) => b.score - a.score || a.id - b.id);
      boards.push({ id, label, measure, description, rows, placements: rank(rows) });
    };
    add("all", "All companies", "The global net-worth board decides the overall season winner.", () => true);
    const shipLabels = ["One ship", "Two to three ships", "Four or more ships"];
    const holdLabels = ["Light hold", "Medium hold", "Heavy hold"];
    const capitalLabels = ["Starter capital", "Regional capital", "Major capital"];
    const hold = e.spec("freighter").capacity;
    const start = e.rules.company.start_cash + e.rules.company.start_ships * e.spec("freighter").price / 2;
    for (let i = 0; i < 3; i++) {
      add(String(i), shipLabels[i], "Your highest fleet size this season sets your division. Downsizing keeps you in that division.",
        c => bracket(c.ships, 1, 3) === i);
      add(`hold-${i}`, holdLabels[i], `Hold divisions use peak fleet capacity. Light is up to ${hold} units, medium up to ${3 * hold}, and heavy above that.`,
        c => bracket(c.capacity, hold, 3 * hold) === i);
      add(`capital-${i}`, capitalLabels[i], "Capital divisions use your peak net worth. Starter is up to twice starting net worth, regional up to five times, and major above that.",
        c => bracket(c.worth, 2 * start, 5 * start) === i);
    }
    add("newcomers", "New companies", "Companies in their first seven game days this season.", c => e.tick - c.founded < WEEK);
    add("privateers", "Privateer companies", "Companies that have operated a pirate ship this season.", c => c.privateer);
    add("cargo", "Cargo landed", "Total cargo aboard when your ships reached port.", c => c.cargoLanded > 0,
      "Cargo units", c => Math.round(c.cargoLanded));
    add("efficiency", "Fleet efficiency", "Cargo units landed per fleet-hour, including docked and empty time. Requires at least 24 fleet-hours.",
      c => c.fleetHours >= 24 && c.cargoLanded > 0, "Units per fleet-hour", c => Math.round(100 * c.cargoLanded / c.fleetHours) / 100);
    add("solo-efficiency", "Solo efficiency", "Cargo units landed per fleet-hour for companies that have operated one ship throughout the season. Requires at least 24 fleet-hours.",
      c => c.ships <= 1 && c.fleetHours >= 24 && c.cargoLanded > 0, "Units per fleet-hour", c => Math.round(100 * c.cargoLanded / c.fleetHours) / 100);
    return this.cached = boards;
  }

  publicBoards(): Board[] {
    return this.boards().map(({ placements, ...board }) => ({ ...board, rows: board.rows.slice(0, 20) }));
  }

  placements(company: number) {
    return Object.fromEntries(this.boards().flatMap(board => {
      const place = board.placements.get(company);
      return place ? [[board.id, place]] : [];
    }));
  }

  honours() {
    return this.boards().filter(board => board.id !== "all" && board.rows.length > 0).map(board => ({
      division: board.label,
      winners: board.rows.filter(row => row.score === board.rows[0].score).map(({ name, bot }) => ({ name, bot })),
    }));
  }
}
