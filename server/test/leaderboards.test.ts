import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";
import { SeasonLeaderboards } from "../src/leaderboards.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function createWorld() {
  const engine = new Engine(rules, map);
  const board = new SeasonLeaderboards(engine);
  const log: (Command | "tick")[] = [];
  function apply(command: Command) {
    const result = engine.apply(command);
    assert.equal(result.ok, true, JSON.stringify(result));
    board.observe();
    log.push(command);
    return result;
  }
  const tick = () => { board.advance(); log.push("tick"); };
  return { engine, board, apply, tick, log };
}

test("downsizing preserves season peak fleet and capacity brackets across replay", () => {
  const { board, apply, log } = createWorld();
  const id = apply({ type: "register", name: "Scaled Line", startPort: 0 }).id!;
  const purchased = apply({ type: "buyShip", company: id, port: 0, shipType: "coaster" }).id!;
  apply({ type: "scrapShip", company: id, ship: purchased });
  assert.equal(board.placements(id)["0"], undefined);
  assert.equal(board.placements(id)["1"].rank, 1);
  assert.equal(board.placements(id)["hold-0"], undefined);
  assert.equal(board.placements(id)["hold-1"].rank, 1);
  assert.equal(board.publicBoards().find(b => b.id === "1")!.rows[0].ships, 1);

  const replay = createWorld();
  for (const event of log) if (event === "tick") replay.tick(); else replay.apply(event);
  assert.deepEqual(replay.board.publicBoards(), board.publicBoards());
});

test("cargo landed and fleet-hour efficiency count only completed arrivals", () => {
  const { engine, board, apply, tick } = createWorld();
  const id = apply({ type: "register", name: "Cargo Line", startPort: 0 }).id!;
  const ship = engine.companies.get(id)!.ships[0];
  const dest = engine.dist[0].findIndex((d, port) => port !== 0 && Number.isFinite(d));
  apply({ type: "sail", company: id, ship, dest, buy: { good: "grain", qty: 20 } });
  assert.equal(board.placements(id).cargo, undefined);
  const hours = engine.ships.get(ship)!.arriveTick;
  while (engine.tick < hours) tick();
  assert.equal(board.placements(id).cargo.score, 20);
  while (engine.tick < Math.max(24, hours)) tick();
  assert.equal(board.placements(id).efficiency.score, Math.round(2000 / engine.tick) / 100);
  assert.deepEqual(board.placements(id)["solo-efficiency"], board.placements(id).efficiency);
});

test("newcomer membership expires and tied division champions share honours", () => {
  const { board, apply, tick } = createWorld();
  const a = apply({ type: "register", name: "A Company", startPort: 0 }).id!;
  const b = apply({ type: "register", name: "B Company", startPort: 0 }).id!;
  assert.deepEqual(board.placements(a).all, board.placements(b).all);
  assert.equal(board.placements(a).all.tied, 1);
  assert.equal(board.placements(a).newcomers.rank, 1);
  for (let i = 0; i < 7 * 24; i++) tick();
  assert.equal(board.placements(a).newcomers, undefined);
  assert.deepEqual(board.weekly?.leaders, [{ division: "One ship", names: ["A Company", "B Company"] }]);
  assert.equal(board.honours().find(x => x.division === "One ship")?.winners.length, 2);
});
