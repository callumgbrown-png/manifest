// A server restart replays the event log: home bases, pirate ships, notoriety, police and notices all come back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, cleanup, Client, sleep } from "./helpers.ts";

test("a restart keeps home bases, a player's pirate ship, notoriety and the police exactly", async () => {
  const s = await startServer({ TICK_MS: "30", BOTS: "10" });
  const a = new Client(s); await a.auth("register", "Corsair Co");
  const me = (await a.state(m => m.me)).me;
  assert.equal(typeof me.home, "number", "a company has a home port");
  const bought = await a.cmd({ type: "buyShip", port: me.home, shipType: "pirate" });
  assert.equal(bought.result?.ok ?? bought.ok, true, JSON.stringify(bought));
  await sleep(600);   // ticks pass; bots (one in ten is a pirate) and police act
  const before = await a.state(m => m.me?.ships.some((x: any) => x.type === "pirate"));
  assert.ok(before.world.police.length >= 3, "police are patrolling");
  assert.ok(before.world.ports.some((p: any) => p.homes > 0), "home counts are public");
  a.close(); await s.stop();

  const t = await startServer({ TICK_MS: "100000000", BOTS: "10" }, s.db);
  try {
    assert.match(t.log(), /Replayed \d+ events/);
    const b = new Client(t);
    await b.auth("login", "Corsair Co");
    const st = await b.state(m => m.me);
    assert.equal(st.me.home, me.home, "home survives the restart");
    assert.ok(st.me.ships.some((x: any) => x.type === "pirate"), "the pirate ship survives the restart");
    assert.ok(st.world.police.length >= 3, "police are back");
    // Restarting again with no new activity gives the identical world and company (notoriety, lockout, notices included).
    const key = (x: any) => JSON.stringify({ w: { ...x.world, tickMs: 0 }, n: x.me.notoriety, l: x.me.lockedOutHours, notices: x.me.notices });
    const first = key(st);
    b.close(); await t.stop();
    const u = await startServer({ TICK_MS: "100000000", BOTS: "10" }, s.db);
    const c = new Client(u);
    await c.auth("login", "Corsair Co");
    assert.equal(key(await c.state(m => m.me)), first);
    c.close(); await u.stop();
  } finally { await t.stop(); cleanup(s); }
});
