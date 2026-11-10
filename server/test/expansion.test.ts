import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN, Client, cleanup, startServer } from "./helpers.js";

test("opportunities accept authenticated actions and survive a server restart", async () => {
  const server = await startServer({ MAP_SEED: "expansion-replay" });
  let client = new Client(server);
  let restarted: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    assert.equal((await client.auth("register", "Test Expansion")).type, "auth");
    const before = (await client.state(m => m.me)).me;
    for (const category of ["ports", "trade", "piracy", "fleet", "exploration", "season"])
      assert.ok(before.expansion[category].length > 0, category);
    const refit = before.expansion.fleet.find((card: { title: string }) => card.title.includes("refit"));
    assert.ok(refit?.actions?.length);
    const action = { ...refit.actions[0].command, fit: "tank", company: -999 };
    assert.equal((await client.cmd(action)).ok, true);
    const after = (await client.fresh()).me;
    assert.ok(after.cash < before.cash);
    assert.ok(after.ships[0].capacity < before.ships[0].capacity);
    client.close();
    await server.stop();
    restarted = await startServer({}, server.db);
    client = new Client(restarted);
    assert.equal((await client.auth("login", "Test Expansion")).type, "auth");
    const replay = (await client.state(m => m.me)).me;
    assert.equal(replay.cash, after.cash);
    assert.deepEqual(replay.ships, after.ships);
  } finally {
    client.close();
    await restarted?.stop();
    await server.stop();
    cleanup(server);
  }
});

test("admin mode selection is validated and starts a seven-day Orders From Shore season", async () => {
  const server = await startServer({ MAP_SEED: "expansion-season" });
  const client = new Client(server);
  try {
    const start = (scenario: string) => fetch(server.url + "/api/admin/new-season", {
      method: "POST", headers: { "x-admin-token": ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    assert.equal((await start("unknown")).status, 400);
    assert.equal((await start("orders-from-shore")).status, 200);
    assert.equal((await client.auth("register", "Test Shore Orders")).type, "auth");
    const { world, me } = await client.state(m => m.me);
    assert.equal(world.seasonHours, 7 * 24);
    assert.equal(me.expansion.season[0].title, "Orders From Shore");
    assert.equal((await client.cmd({ type: "setVoyageQueue", ship: me.ships[0].id, legs: [] })).ok, false);
  } finally {
    client.close();
    await server.stop();
    cleanup(server);
  }
});
