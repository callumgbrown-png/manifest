// The shipyard: buying the pirate speedboat (and the civilian classes) through the real server.
// Covers: exactly one ship and one price deducted, a retried/double-clicked request answered once, refusals that change nothing,
// and the pirate class surviving a restart is covered in pirates-restart.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, cleanup, Client } from "./helpers.ts";

test("pirate speedboat: one purchase, one deduction, retries answered once, refusals change nothing", async () => {
  const s = await startServer({ TICK_MS: "100000000" });
  try {
    const a = new Client(s); await a.auth("register", "Shipyard Co");
    const st0 = (await a.state(m => m.me)); const me0 = st0.me, price = st0.world.rules.shipTypes.pirate.price;
    assert.ok(price > 0 && st0.world.rules.pirates.enabled, "the world offers the pirate speedboat");
    assert.equal(me0.ships.length, 1);

    // refused away from the home port: no cash or fleet change
    const away = st0.world.ports.find((p: any) => p.id !== me0.home).id;
    const refused = await a.cmd({ type: "buyShip", port: away, shipType: "pirate" });
    assert.equal(refused.ok, false); assert.match(refused.error, /only at your home port/);

    // a double click / retry: the SAME request id sent twice buys one ship, and both replies are the same
    const id = 9001, first = a.next(m => m.type === "result" && m.reqId === id);
    a.send({ type: "cmd", reqId: id, cmd: { type: "buyShip", port: me0.home, shipType: "pirate" } });
    const r1 = await first;
    const again = a.next(m => m.type === "result" && m.reqId === id);
    a.send({ type: "cmd", reqId: id, cmd: { type: "buyShip", port: me0.home, shipType: "pirate" } });
    const r2 = await again;
    assert.equal(r1.ok, true); assert.deepEqual(r2, r1);
    const st1 = await a.state(m => m.me?.ships.length === 2);
    assert.equal(st1.me.ships.length, 2, "exactly one ship was added");
    assert.equal(st1.me.ships.filter((x: any) => x.type === "pirate").length, 1);
    assert.equal(st1.me.cash, me0.cash - price, "the price was taken exactly once");

    // cash too low: a second speedboat needs more than the 500 left, so it is refused and nothing changes
    const left = st1.me.cash;
    assert.ok(left < price);
    const bad = await a.cmd({ type: "buyShip", port: me0.home, shipType: "pirate" });
    assert.equal(bad.ok, false); assert.match(bad.error, /not enough cash/);
    const st2 = await a.state(m => m.me);
    assert.equal(st2.me.cash, left); assert.equal(st2.me.ships.length, 2);

    // civilian classes still buy normally (a second company with full cash)
    const b = new Client(s); await b.auth("register", "Coaster Co");
    const b0 = (await b.state(m => m.me)).me;
    const coaster = await b.cmd({ type: "buyShip", port: b0.home, shipType: "coaster" });
    assert.equal(coaster.ok, true);
    const bs = await b.state(m => m.me?.ships.length === 2);
    assert.equal(bs.me.ships.filter((x: any) => x.type === "coaster").length, 1);
    assert.equal(bs.me.cash, b0.cash - st0.world.rules.shipTypes.coaster.price);
    b.close();
    a.close();
  } finally { await s.stop(); cleanup(s); }
});
