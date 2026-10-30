// Browser test: two players use every feature of the real client, plus the admin and seasons pages.
// Run with `npm run test:browser` (needs Playwright: `npm i -D playwright && npx playwright install chromium`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, ADMIN, cleanup, type Srv } from "../helpers.ts";

import { createRequire } from "node:module";

let pw: any;   // loaded with require() so a global install (NODE_PATH) works too
try { pw = createRequire(import.meta.url)("playwright"); } catch { /* skipped below */ }
const SKIP = pw ? false : "Playwright isn't installed";

const map = JSON.parse(readFileSync(new URL("../../../config/map.json", import.meta.url), "utf8"));
let s: Srv, browser: any;
const errors: string[] = [];

before(async () => {
  if (SKIP) return;
  s = await startServer({ TICK_MS: "150" });
  browser = await pw.chromium.launch();
});
after(async () => { await browser?.close(); if (s) { await s.stop(); cleanup(s); } });

async function player(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m: any) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
  await page.goto(s.url);
  return page;
}
const me = (page: any) => page.evaluate(() => (window as any).eval("me"));
const worldOf = (page: any) => page.evaluate(() => (window as any).eval("world"));
const toast = async (page: any, text: RegExp) => {
  await page.waitForFunction((src: string) => new RegExp(src).test(document.getElementById("toast")!.textContent!), text.source, { timeout: 10000 });
};
async function waitDocked(page: any, port: number) {
  await page.waitForFunction((p: number) => { const m = (window as any).eval("me"); return m?.ships[0].dest === null && m.ships[0].port === p; }, port, { timeout: 30000 });
}
/** Tap a port on the map. */
async function tapPort(page: any, id: number) {
  const box = await page.locator("#map").boundingBox();
  const v = await page.evaluate(() => (window as any).eval("view"));
  await page.mouse.click(box.x + v.ox + map.ports[id].x * v.scale, box.y + v.oy + map.ports[id].y * v.scale);
}
/** Open a port from the map, the way a player picks one. With a docked ship's sail form showing,
 *  the first tap picks the port as its destination and a second tap opens it. */
async function selectPort(page: any, id: number) {
  const name = map.ports[id].name;
  await tapPort(page, id);
  await page.waitForFunction((n: string) => document.querySelector("#panel h2")?.textContent === n
    || document.getElementById("toast")!.textContent!.includes(`→ ${n}`), name);
  if (await page.textContent("#panel h2") !== name) await tapPort(page, id);
  await page.waitForFunction((n: string) => document.querySelector("#panel h2")?.textContent === n, name);
}
/** Close the first-time guide a new company sees. */
async function closeGuide(page: any) {
  await page.waitForSelector("#guide:not(.hidden)");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#guide.hidden", { state: "attached" });
}
async function sailTo(page: any, port: number, load?: string, qty?: number) {
  await page.click('#tabs button[data-tab="fleet"]');
  const card = page.locator(".shipCard[data-ship]").first();
  await card.locator("select[data-field=dest]").selectOption(String(port));
  await card.locator("select[data-field=good]").selectOption(load ?? "");
  if (qty) await card.locator("input[data-field=qty]").fill(String(qty));   // the box is off until a good is picked
  await page.locator('body').click({ position: { x: 5, y: 5 } });   // leave the form so the panel can refresh
  await card.locator("button[data-act=sail]").click();
  await toast(page, new RegExp(`Sailing to ${map.ports[port].name}`));
}

test("two players play through every feature in the browser", { skip: SKIP, timeout: 180000 }, async () => {
  // ---- sign-up and log-in screens
  const a = await player("A");
  await a.waitForSelector("#auth:not(.hidden)");
  await a.fill("#authName", "ab"); await a.fill("#authPass", "password123");
  await a.click('button[data-mode="register"]');
  assert.ok(await a.locator("#authName:invalid").count(), "browser blocks a 2-letter name");
  await a.fill("#authName", "Alpha Lines");
  await a.click('button[data-mode="register"]');
  await a.waitForSelector("#auth.hidden", { state: "attached" });
  await a.waitForFunction(() => document.getElementById("hName")!.textContent === "Alpha Lines");
  // ---- a new company sees a short guide once
  await a.waitForSelector("#guide:not(.hidden)");
  assert.equal(await a.textContent("#guideStep"), "Step 1 of 4");
  assert.match((await a.textContent("#guideText"))!, /one ship, docked at [A-Z]/);
  assert.ok(await a.locator("#guideBack:disabled").count(), "no Back on the first step");
  await a.click("#guideNext");
  assert.equal(await a.textContent("#guideTitle"), "Buy where it's cheap");
  await a.click("#guideBack");
  assert.equal(await a.textContent("#guideTitle"), "Your ship");
  for (const title of ["Buy where it's cheap", "Sail where it's needed", "Sell, and grow"]) {
    await a.click("#guideNext");
    assert.equal(await a.textContent("#guideTitle"), title);
  }
  assert.equal(await a.textContent("#guideNext"), "Start trading");
  await a.click("#guideNext");
  await a.waitForSelector("#guide.hidden", { state: "attached" });
  assert.equal(await a.evaluate(() => localStorage.getItem("guideSeen")), "1");
  // Once signed in, "How to play" in the header opens the guide again from step 1.
  await a.click("#help");
  await a.waitForSelector("#guide:not(.hidden)");
  assert.equal(await a.textContent("#guideStep"), "Step 1 of 4");
  await a.keyboard.press("Escape");
  await a.waitForSelector("#guide.hidden", { state: "attached" });
  assert.equal(await a.textContent("#hCash"), "10,000");
  assert.equal(await a.textContent("#conn"), "live");
  assert.match((await a.textContent("#hClock"))!, /^Day \d+ of 56, \d\d:00$/);   // day 1, or 2 on a slow machine (150 ms game hours)

  const b = await player("B");
  await b.fill("#authName", "Alpha Lines"); await b.fill("#authPass", "password123");
  await b.click('button[data-mode="register"]');
  await b.waitForFunction(() => document.getElementById("authError")!.textContent === "That name is taken");
  await b.fill("#authName", "Beta Shipping");
  await b.click('button[data-mode="register"]');
  await b.waitForFunction(() => document.getElementById("hName")!.textContent === "Beta Shipping");
  await b.waitForSelector("#guide:not(.hidden)");
  await b.click("#guideSkip");
  await b.waitForSelector("#guide.hidden", { state: "attached" });

  // ---- the port panel shows the market for the port your ship is in
  const A0 = await me(a);
  const home = A0.ships[0].port;
  assert.equal(await a.textContent("#panel h2"), map.ports[home].name);
  assert.equal(await a.locator("#panel table tr").count() >= 3, true);
  // A new company (10,000 cash) can't afford a 12,000 ship: the button is disabled and says what's missing.
  assert.ok(await a.locator('#panel button:disabled', { hasText: "Buy a ship here" }).count(), "buy-ship button shown, disabled, at a port with your ship");
  assert.match((await a.textContent("#panel"))!, /You need 2,000 more cash\./);
  // With the cash, the button explains that a new ship lowers net worth at first (ships count at half price).
  const buyText = await a.evaluate(() => { const w = window as any, me = w.eval("me"), cash = me.cash; me.cash = 20000; const h = w.eval("buyShipHtml")(); me.cash = cash; return h; });
  assert.match(buyText, /data-act="buyShip">Buy a ship here \(12,000\)/);
  assert.match(buyText, /your net worth drops by 6,000 at first/);

  // ---- the trip estimate updates as you change the form
  await a.click('#tabs button[data-tab="fleet"]');
  const card = a.locator(".shipCard[data-ship]").first();
  // The form never starts on a losing empty trip to the first port alphabetically.
  const firstAlpha = await card.locator("select[data-field=dest] option").first().getAttribute("value");
  const startDest = await card.locator("select[data-field=dest]").inputValue();
  const startGood = await card.locator("select[data-field=good]").inputValue();
  assert.ok(startGood !== "" || startDest !== firstAlpha || (await card.locator("button.move").count()) > 0, "form starts on a sensible trip");

  // ---- with your docked ship's form open, tapping a port picks it as the destination;
  //      tapping it again opens it
  const homeCard = card;
  await homeCard.locator("select[data-field=good]").selectOption("");
  // Not the destination the form already shows: tapping that one opens the port instead.
  const shown = Number(await homeCard.locator("select[data-field=dest]").inputValue());
  const other = map.ports.findIndex((_: any, i: number) => i !== home && i !== shown);
  const company = await a.textContent("#panel h2");
  // On a phone the map sits above the panel: picking a port must not scroll the map off the screen,
  // so the toast carries the result of the estimate.
  await a.setViewportSize({ width: 390, height: 800 });
  await a.waitForTimeout(200);
  await a.evaluate(() => window.scrollTo(0, 0));
  await tapPort(a, other);
  await toast(a, new RegExp(`→ ${map.ports[other].name} \\(≈\\d+ h\\): sailing empty costs about [\\d,]+\\. Tap it again to open the port\\.`));
  assert.equal(await a.evaluate(() => window.scrollY), 0, "the page stays on the map");
  assert.ok(await a.locator("#toast.warn").count(), "a trip that costs money gets a warning mark, not a green tick");
  await a.setViewportSize({ width: 1280, height: 800 });
  await a.waitForTimeout(200);
  assert.equal(await a.textContent("#panel h2"), company, "first tap keeps the panel open");
  assert.equal(await homeCard.locator("select[data-field=dest]").inputValue(), String(other), "first tap fills the destination");
  const fuel = await a.evaluate((d: number) => { const w = window as any; return Math.round(w.eval("fuelCost")(w.eval("me").ships[0].port, d)); }, other);
  assert.ok((await homeCard.locator("[data-field=estimate]").textContent())!.includes(`fuel ${fuel.toLocaleString("en-IE")}`), "and updates the estimate");
  await tapPort(a, other);
  await a.waitForFunction((n: string) => document.querySelector("#panel h2")?.textContent === n, map.ports[other].name);
  assert.equal(await a.locator(".shipCard select[data-field=dest]").count(), 0, "no ship of yours is docked there");
  await tapPort(a, home);   // tapping your ship's own port opens it, as before
  await a.waitForFunction((n: string) => document.querySelector("#panel h2")?.textContent === n, map.ports[home].name);
  // ---- clicking a port on the map selects it (two taps while your ship's form is showing)
  await selectPort(a, (home + 1) % map.ports.length);
  await a.click('#tabs button[data-tab="fleet"]');
  await card.locator("select[data-field=good]").selectOption("");
  assert.match((await card.locator("[data-field=estimate]").textContent())!, /^Sailing empty costs about [\d,]+ \(fuel [\d,]+, port fee 25\)\.$/);
  await card.locator("select[data-field=good]").selectOption("grain");
  assert.match((await card.locator("[data-field=estimate]").textContent())!, /This trip (makes|loses) about [\d,]+ \([\d,]+ an hour\)/);

  // ---- short of cash, the estimate says so before the server refuses: with one ship only the
  //      cargo must be paid for (fuel goes on credit); with a spare ship the fuel must be too.
  //      (One synchronous evaluate with cash and fleet changed in the page, so no update lands in between.)
  const broke = await a.evaluate(() => {
    const w = window as any, me = w.eval("me"), card = document.querySelector(".shipCard[data-ship]")!;
    // (No named arrow functions in here: tsx would wrap them in a helper the page doesn't have.)
    const out: string[] = [];
    w.__est = function () { w.eval("estimate")(card); out.push(card.querySelector("[data-field=estimate]")!.textContent!); };
    const est = w.__est;
    const cash = me.cash, ships = me.ships;
    (card.querySelector("[data-field=qty]") as HTMLInputElement).value = "60";
    me.cash = 500; est();
    me.cash = -500; est();
    (card.querySelector("[data-field=good]") as HTMLSelectElement).value = "";
    est();
    me.ships = [...ships, { ...ships[0], id: 999 }]; est();
    me.cash = 1e6; est();
    me.cash = cash; me.ships = ships;
    (card.querySelector("[data-field=good]") as HTMLSelectElement).value = "grain"; est();
    const [oneShip, inDebt, emptyOne, emptyTwo, rich] = out;
    return { oneShip, inDebt, emptyOne, emptyTwo, rich };
  });
  assert.match(broke.oneShip, /^Not enough cash: the cargo costs about [\d,]+ and you have 500\. You can afford about \d+ grain\./);
  assert.match(broke.inDebt, /^Not enough cash: the cargo costs about [\d,]+ and you have -500\. Sail empty instead: your last ship's fuel can go on credit\./);
  assert.doesNotMatch(broke.emptyOne, /Not enough cash/, "a last ship can always sail empty");
  assert.match(broke.emptyOne, /goes on credit/);
  assert.match(broke.emptyTwo, /^Not enough cash: the fuel costs about [\d,]+ and you have -500\. Only a company's last ship can sail on credit/);
  assert.doesNotMatch(broke.rich, /Not enough cash/);

  // ---- server refusals show as a red toast (the form itself won't send an oversized load, so
  // send one the way an out-of-date page could)
  await card.locator("input[data-field=qty]").fill("500");
  assert.ok(await card.locator("button[data-act=sail]").isDisabled(), "the form won't send 500 grain");
  await a.evaluate(() => { const w = window as any, s = w.eval("me").ships[0];
    w.eval("command")({ type: "sail", ship: s.id, dest: w.eval("world").ports.find((p: any) => p.id !== s.port).id, buy: { good: "grain", qty: 500 } }); });
  await toast(a, /over capacity/);
  assert.ok(await a.locator("#toast.bad").count());

  // ---- with the connection down, a click says nothing was done instead of silently doing nothing
  await a.evaluate(() => { const ws = (window as any).eval("ws"); ws.onclose = null; ws.close(); });
  await a.waitForFunction(() => (window as any).eval("ws").readyState === WebSocket.CLOSED);
  await card.locator("input[data-field=qty]").fill("60");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await card.locator("button[data-act=sail]").click();
  await toast(a, /Not connected to the server, so nothing was done/);
  assert.ok(await a.locator("#toast.bad").count());
  await a.evaluate(() => (window as any).eval("connect")());
  await a.waitForFunction(() => document.getElementById("conn")!.textContent === "live");
  await a.waitForFunction(() => (window as any).eval("me")?.ships[0].dest === null);

  // ---- sail with grain to a neighbour; ship shows as sailing; sell on arrival
  const nb = map.routes.find((r: any) => r.a === home || r.b === home);
  const dest = nb.a === home ? nb.b : nb.a;
  await sailTo(a, dest, "grain", 60);
  await a.waitForFunction(() => /Sailing to .*, arrives in \d+ h/.test(document.getElementById("panel")!.textContent!));
  const cashSailing = (await me(a)).cash;
  assert.ok(cashSailing < 10000);
  await waitDocked(a, dest);
  await a.click('#tabs button[data-tab="fleet"]');
  await a.waitForFunction(() => /not sold yet/.test(document.querySelector(".trips-log")?.textContent ?? ""));   // docked, cargo still aboard
  await selectPort(a, dest);
  // List 20 for sale, then sell the rest to the market.
  const shipCard = a.locator(".shipCard[data-ship]").first();
  assert.match((await shipCard.locator("[data-field=listNote]").textContent())!, /buy grain from the market here for about \d+\.\d\d each with tax, so a listing above that rarely sells\. You get your price less \d+(\.\d)?% tax\./);
  await shipCard.locator("input[data-field=sellQty]").fill("20");
  await shipCard.locator("input[data-field=sellPrice]").fill("39");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await shipCard.locator("button[data-act=listSell]").click();
  await toast(a, /Listed for sale/);
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 40);
  // The sell button says what the whole cargo fetches after tax; the note says what that makes.
  const sellText = (await a.locator('.shipCard button[data-act="sell"]').textContent())!;
  assert.match(sellText, /^Sell 40 grain here for [\d,]+$/);
  assert.match((await shipCard.locator("[data-field=saleNote]").textContent())!, /after \d+(\.\d)?% tax.*You paid [\d,]+, so this sale (makes \+|loses −)[\d,]+\./);
  const quoted = Number(sellText.split(" for ")[1].replace(/\D/g, "")), cashPre = (await me(a)).cash;
  await a.locator('.shipCard button[data-act="sell"]').click();
  await toast(a, /^Sold$/);
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 0);
  const got = (await me(a)).cash - cashPre;
  assert.ok(Math.abs(got - quoted) < Math.max(5, quoted * 0.03), `button said ${quoted}, sale paid ${got.toFixed(0)}`);
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 0);
  assert.ok((await me(a)).cash > cashSailing);

  // ---- orders tab: post a buy order, see it, cancel it, see the cash come back
  await a.click('#tabs button[data-tab="orders"]');
  const cashBefore = (await me(a)).cash;
  await a.selectOption("#oPort", String(home));
  await a.selectOption("#oGood", "fuel");
  // The panel warns that filled buy orders don't deliver goods to you, labels its boxes,
  // and says what the order costs as you type.
  assert.match((await a.textContent("#panel"))!, /don't come to you/);
  assert.equal(await a.locator("label.mini", { hasText: "Price each" }).locator("#oPrice").count(), 1);
  await a.fill("#oQty", "10"); await a.fill("#oPrice", "50");
  assert.equal(await a.textContent("#oCost"), "If it fills, this costs you 500.");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  assert.equal(await a.textContent("#oCost"), "If it fills, this costs you 500.", "still right after the panel refreshes");
  await a.click('button[data-act="placeOrder"]');
  await toast(a, /Order posted/);
  await a.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("buying fuel"));
  assert.equal((await me(a)).cash, cashBefore - 500);
  assert.ok((await a.textContent("#panel"))!.includes("selling grain"), "the listing shows under your orders");
  // A price outside the band is refused.
  await a.fill("#oPrice", "5");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await a.click('button[data-act="placeOrder"]');
  await toast(a, /price must be between 30 and 90/);
  const buyRow = a.locator("#panel tr", { hasText: "buying fuel" });
  await buyRow.locator('button[data-act="cancelOrder"]').click();
  await toast(a, /Order cancelled/);
  await a.waitForFunction((c: number) => (window as any).eval("me").cash === c, cashBefore);

  // ---- B sails to A's listing, sees it, buys it; A's cash goes up
  await b.waitForFunction(() => (window as any).eval("world").orders.some((o: any) => o.side === "sell"));
  if ((await me(b)).ships[0].port !== dest) { await sailTo(b, dest); await waitDocked(b, dest); }
  await selectPort(b, dest);
  await b.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("from Alpha Lines at 39.00"));
  assert.ok((await b.textContent("#panel"))!.includes("Alpha Lines"), "player orders table shows the seller");
  const aCash = (await me(a)).cash;
  // The listing says what it costs in total and how that compares with the market here,
  // so a buyer never pays over the odds without knowing (it said only "Buy 20" before).
  assert.equal(await b.locator('button[data-act="buyOrder"]').textContent(), "Buy 20 for 780");
  assert.match((await b.locator("[data-field=listingNote]").textContent())!,
    /(less than buying 20 from the market here \(about [\d,]+ with tax\)|from the market here costs about [\d,]+ with tax, [\d,]+ less than this listing|About the same)/);
  // With less cash the button offers what you can afford, and with too little it's off.
  const withCash = (cash: number) => b.evaluate((c: number) => {
    const w = window as any, real = w.eval("me");
    w.__real = real; w.eval(`me = Object.assign({}, me, { cash: ${c} })`);
    const html = w.eval("listingHtml")(real.ships[0], w.eval("world").orders.find((o: any) => o.side === "sell"));
    w.eval("me = window.__real");
    return html as string;
  }, cash);
  const some = await withCash(100);
  assert.match(some, /Buy 2 for 78</); assert.match(some, /You can afford 2 of 20\./);
  const none = await withCash(10);
  assert.match(none, /<button class="secondary" disabled>Buy<\/button>/); assert.match(none, /Not enough cash: one costs 39\.00 and you have 10\./);
  const bCash = (await me(b)).cash;
  await b.locator('button[data-act="buyOrder"]').click();
  await toast(b, /^Bought$/);
  await b.waitForFunction(() => (window as any).eval("me").ships[0].qty === 20);
  assert.ok(Math.abs((await me(b)).cash - (bCash - 780)) < 0.01, "paid what the button said");
  await a.waitForFunction((c: number) => (window as any).eval("me").cash > c, aCash);
  assert.equal((await worldOf(a)).orders.length, 0);

  // ---- B posts a buy order at a port; A fills it from a ship
  // (A sails back with grain to fill it, using the Fill button.)
  await b.click('#tabs button[data-tab="orders"]');
  await b.selectOption("#oPort", String(home));
  await b.selectOption("#oGood", "grain");
  await b.fill("#oQty", "15"); await b.fill("#oPrice", "40");
  await b.locator("body").click({ position: { x: 5, y: 5 } });
  await b.click('button[data-act="placeOrder"]');
  await toast(b, /Order posted/);
  await a.click('#tabs button[data-tab="fleet"]');
  await sailTo(a, home, "grain", 15);
  await waitDocked(a, home);
  await a.click('#tabs button[data-tab="fleet"]');
  // The fill button says what the delivery pays after tax.
  const fillText = (await a.locator('button[data-act="fill"]').textContent())!;
  assert.match(fillText, /^Fill .+'s order: 15 for [\d,]+$/);
  const fillCash = (await me(a)).cash;
  await a.locator('button[data-act="fill"]').click();
  await toast(a, /Order filled/);
  await a.waitForFunction((c: number) => (window as any).eval("me").cash > c, fillCash);
  assert.ok(Math.abs((await me(a)).cash - fillCash - Number(fillText.split(" for ")[1].replace(/\D/g, ""))) < 1, "fill paid what the button said");
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 0);

  // ---- buy a second ship, see upkeep text, scrap it again
  await a.evaluate(() => 0);
  const cash = (await me(a)).cash;
  if (cash >= 12000) {
    await selectPort(a, home);
    await a.click('button[data-act="buyShip"]');
    await toast(a, /New ship bought/);
    await a.click('#tabs button[data-tab="fleet"]');
    await a.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("2 of 5 ships"));
    await a.locator('button[data-act="scrap"]').last().click();
    await toast(a, /Ship scrapped/);
  } else {
    await selectPort(a, home);
    assert.equal(await a.locator('button[data-act="buyShip"]').count(), 0, "no buy button that would only fail");
  }

  // ---- leaderboard
  await a.click('#tabs button[data-tab="board"]');
  const rows = await a.locator("#panel table tr").allTextContents();
  assert.ok(rows.some(r => r.includes("Alpha Lines")) && rows.some(r => r.includes("Beta Shipping")));
  // Places in the table match the "You" card, and equal net worth shares a place.
  const board = await a.evaluate(() => {
    const lb = (window as any).eval("world").leaderboard, m = (window as any).eval("me");
    const shown = [...document.querySelectorAll("#panel table tr .rank")].map(e => Number(e.textContent));
    return { lb, shown, rank: m.rank, tied: m.tied, card: document.querySelector(".youRank b")!.textContent, mine: Number(document.querySelector("#panel tr.me .rank")?.textContent) };
  });
  board.lb.forEach((c: any, i: number) => assert.equal(board.shown[i], 1 + board.lb.findIndex((x: any) => x.worth === c.worth)));
  if (board.mine) assert.equal(board.mine, board.rank);
  assert.match(board.card!, board.tied ? /^joint \d+(st|nd|rd|th)$/ : /^\d+(st|nd|rd|th)$/);
  // A company not in the top 20 (often one tied with many bots on 16,000) still gets its own row,
  // with the same place as the "You" card, instead of a note that contradicts the card.
  const offList = await a.evaluate(() => (window as any).eval(`(() => {
    const saved = world.leaderboard, tied = me.tied, out = {};
    world.leaderboard = saved.filter(c => c.id !== me.id);
    me.tied = 3; out.tied = boardPanel();
    me.tied = 0; out.alone = boardPanel();
    world.leaderboard = saved; me.tied = tied;
    return out;
  })()`));
  for (const html of [offList.tied, offList.alone]) {
    assert.match(html, new RegExp(`<tr class="me notListed"><td><span class="rank">${board.rank}</span>`));
    assert.match(html, /Alpha Lines <span class="tag mine">you/);
    assert.doesNotMatch(html, /outside the top \d+ with/);
  }
  assert.match(offList.tied, /You share \d+(st|nd|rd|th) place with 3 other companies/);
  assert.match(offList.alone, /You're outside the top \d+, so you're shown at the end/);

  // ---- the session survives a reload; log out shows the sign-in screen; log back in
  await a.reload();
  await a.waitForFunction(() => document.getElementById("hName")!.textContent === "Alpha Lines");
  await a.click("#logout");
  await a.waitForSelector("#auth:not(.hidden)");
  // "How to play" on the sign-in card opens the guide over it
  await a.click("#howToPlay");
  await a.waitForSelector("#guide:not(.hidden)");
  assert.match((await a.textContent("#guideText"))!, /You start with one ship/);
  await a.keyboard.press("Escape");
  await a.waitForSelector("#guide.hidden", { state: "attached" });
  assert.ok(await a.locator("#auth:not(.hidden)").count(), "sign-in card still there");
  await a.fill("#authName", "alpha lines"); await a.fill("#authPass", "wrong-password");
  await a.click('button[data-mode="login"]');
  await a.waitForFunction(() => document.getElementById("authError")!.textContent === "Wrong name or password");
  await a.fill("#authPass", "password123");
  await a.click('button[data-mode="login"]');
  await a.waitForFunction(() => document.getElementById("hName")!.textContent === "Alpha Lines");
  await a.waitForTimeout(300);
  assert.ok(await a.locator("#guide.hidden").count(), "logging in doesn't show the guide again");

  // ---- phone-sized screens: nothing is wider than the screen on any tab. Checks each element's
  // edge, not just scrollWidth, so content clipped by overflow:hidden is caught too.
  for (const width of [390, 320]) {
    await a.setViewportSize({ width, height: 800 });
    for (const t of ["port", "fleet", "orders", "board"]) {
      await a.click(`#tabs button[data-tab="${t}"]`);
      await a.waitForTimeout(150);
      const wide = await a.evaluate(() => [...document.querySelectorAll("body *")].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed";
      }).map(e => `${e.tagName}.${e.className}`).slice(0, 5));
      assert.deepEqual(wide, [], `${t} tab fits a ${width} px screen`);
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scrolling");
    }
  }

  assert.deepEqual(errors, []);
});

test("admin page shows health and changes live rules", { skip: SKIP, timeout: 60000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => errors.push(`admin: ${e.message}`));
  await page.goto(s.url + "/admin");
  // Applying before entering a token does nothing.
  await page.click("#apply");
  assert.equal(await page.textContent("#err"), "Enter the admin token first.");
  await page.fill("#token", "wrong-token-wrong-token");
  await page.click("#save");
  await page.waitForFunction(() => document.getElementById("err")!.textContent === "admin token required");
  await page.fill("#token", ADMIN);
  await page.click("#save");
  await page.waitForFunction(() => document.querySelectorAll(".tile").length === 7);
  assert.ok((await page.textContent("#tiles"))!.includes("Companies"));
  assert.equal(await page.inputValue("#tax"), "0.07");
  assert.equal(await page.textContent("#diffNow"), "normal");
  assert.match((await page.textContent("#seasonInfo"))!, /^Day \d+ of 56\.$/);
  // A blank box is left alone instead of being set to zero.
  await page.fill("#upkeep", "");
  await page.fill("#tax", "0.06");
  await page.click("#apply");
  await page.waitForFunction(() => document.getElementById("err")!.textContent === "Saved.");
  const m = await (await fetch(s.url + "/api/admin/metrics", { headers: { "x-admin-token": ADMIN } })).json();
  assert.equal(m.tax, 0.06); assert.equal(m.upkeep, 400);
  // A hand-set value makes the world "custom"; the page says the next season still starts on the server's level.
  assert.equal(await page.textContent("#diffNow"), "custom");
  assert.equal(await page.textContent("#nextDiff"), "normal");
  assert.match((await page.textContent("#nextDiffWhy"))!, /not the current one/);
  await page.fill("#tax", "0.9");
  await page.click("#apply");
  await page.waitForFunction(() => document.getElementById("err")!.textContent === "tax must be 0 to 0.3");
  assert.deepEqual(errors, []);
});

test("past seasons page lists finished seasons", { skip: SKIP, timeout: 60000 }, async () => {
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e: Error) => errors.push(`seasons: ${e.message}`));
  await page.goto(s.url + "/seasons");
  await page.waitForFunction(() => document.getElementById("list")!.textContent!.includes("No season has finished yet."));
  await fetch(s.url + "/api/admin/new-season", { method: "POST", headers: { "x-admin-token": ADMIN } });
  await page.reload();
  await page.waitForSelector(".season");
  const text = (await page.textContent("#list"))!;
  assert.match(text, /Season 1 · ended/);
  assert.ok(text.includes("Alpha Lines") && text.includes("Beta Shipping"));
  // Companies on the same net worth share a place, like the in-game leaderboard.
  const rows = await page.$$eval(".season tr", trs => trs.slice(1).map(tr => [Number(tr.cells[0].textContent), tr.cells[2].textContent, tr.className]));
  rows.forEach(([place, worth, cls], i) => {
    const first = rows.findIndex(r => r[1] === worth);
    assert.equal(place, first + 1, `row ${i + 1} (${worth}) shares the place of the first company on that worth`);
    assert.equal(cls === "first", place === 1);
  });
  await page.click("text=Back to the game");
  await page.waitForURL(s.url + "/");
  assert.deepEqual(errors, []);
});

test("season end closes trading in the client; admin starts the next season", { skip: SKIP, timeout: 120000 }, async () => {
  const t = await startServer({ TICK_MS: "2" });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e: Error) => errors.push(`season: ${e.message}`));
    await page.goto(t.url);
    await page.fill("#authName", "Last Season"); await page.fill("#authPass", "password123");
    await page.click('button[data-mode="register"]');
    await page.waitForFunction(() => document.getElementById("hName")!.textContent === "Last Season");
    await closeGuide(page);
    await page.waitForFunction(() => document.getElementById("hClock")!.textContent === "Season over", null, { timeout: 60000 });
    assert.match((await page.textContent("#seasonBanner"))!, /The season has ended\. Last Season finished first/);
    await page.click('#tabs button[data-tab="fleet"]');
    await page.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("Trading is closed"));
    assert.equal(await page.locator("#panel button[data-act]").count(), 0, "no trading buttons");
    await page.click('#tabs button[data-tab="orders"]');
    assert.equal(await page.locator("#oPort").count(), 0, "no order form");

    const admin = await ctx.newPage();
    await admin.goto(t.url + "/admin");
    await admin.fill("#token", ADMIN); await admin.click("#save");
    await admin.waitForFunction(() => /Season over after 56 days/.test(document.getElementById("seasonInfo")!.textContent!));
    // Cancelling the confirmation does nothing.
    admin.once("dialog", (d: any) => d.dismiss());
    await admin.click("#newSeason");
    await admin.waitForTimeout(300);
    assert.deepEqual(await (await fetch(t.url + "/api/seasons")).json(), []);
    admin.once("dialog", (d: any) => d.accept());
    await admin.click("#newSeason");
    await admin.waitForFunction(() => document.getElementById("err")!.textContent === "Season 2 has started.");
    // The player is asked to log in again and gets a fresh company.
    await page.waitForFunction(() => document.getElementById("authError")!.textContent!.includes("A new season has started"));
    await page.fill("#authName", "Last Season"); await page.fill("#authPass", "password123");
    await page.click('button[data-mode="login"]');
    await page.waitForFunction(() => document.getElementById("hCash")!.textContent === "10,000");
    // (With 2 ms hours the new season can already be over again, so the banner isn't checked here.)
    await ctx.close();
    assert.deepEqual(errors, []);
  } finally { await t.stop(); cleanup(t); }
});


test("trip estimates match what really happens, and 'best trips' plans a trip", { skip: SKIP, timeout: 120000 }, async () => {
  const t = await startServer({ TICK_MS: "120" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.on("pageerror", (e: Error) => errors.push(`estimate: ${e.message}`));
    await page.goto(t.url);
    await page.fill("#authName", "Honest Co"); await page.fill("#authPass", "password123");
    await page.click('button[data-mode="register"]');
    await page.waitForFunction(() => document.getElementById("hName")!.textContent === "Honest Co");
    await closeGuide(page);
    await page.click('#tabs button[data-tab="fleet"]');
    await page.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("Best trips from here"));
    const card = page.locator(".shipCard[data-ship]").first();
    // Near the end of the season, advice only offers trips that dock while trading is still open,
    // and the estimate warns about a voyage that would dock too late. (Done in one synchronous
    // evaluate with the clock moved forward, so no server update can land in between.)
    const end = await page.evaluate(() => {
      const w = window as any, world = w.eval("world"), s = w.eval("me").ships[0], dist = w.eval("distance");
      const card = document.querySelector(".shipCard[data-ship]")!, sel = card.querySelector("[data-field=dest]") as HTMLSelectElement;
      const saved = world.tick, old = sel.value;
      world.tick = world.seasonHours - 6;
      const raw = w.eval("rawTrips")(s, 40).map((t: any) => t.hours);
      const best = w.eval("bestTrips")(s, 10).map((t: any) => t.hours + (t.next ? t.next.hours : 0));
      const far = world.ports.filter((p: any) => p.id !== s.port).sort((a: any, b: any) => dist(s.port, b.id) - dist(s.port, a.id))[0].id;
      sel.value = String(far); w.eval("estimate")(card);
      const text = card.querySelector("[data-field=estimate]")!.textContent;
      world.tick = world.seasonHours - 1;
      const html = w.eval("tripsHtml")(s);
      world.tick = saved; sel.value = old; w.eval("estimate")(card);
      return { raw, best, text, html };
    });
    for (const h of [...end.raw, ...end.best]) assert.ok(h < 6, `a ${h} h trip can't finish in the last 6 hours`);
    assert.match(end.text!, /^This ship would dock after the season ends/);
    assert.match(end.html, /The season ends in 1 h, too soon for any voyage from here to dock in time\. Your ship can stay where it is\./);
    // Best trips are profitable by the honest estimate, and ranked by profit per hour counting the
    // next step from where they end (score), so a dead-end trip ranks below a slightly poorer one.
    const trips = await page.evaluate(() => { const w = window as any; return w.eval("bestTrips")(w.eval("me").ships[0], 10); });
    for (let i = 0; i < trips.length; i++) {
      assert.ok(trips[i].profit > 0);
      assert.ok(trips[i].score >= trips[i].profit / (trips[i].hours + 6) - 1e-9, "score counts the trip itself");
      if (i) assert.ok(trips[i - 1].score >= trips[i].score);
    }
    assert.equal(await card.locator('button[data-act="plan"]:not(.move)').count(), Math.min(3, trips.length));
    const plan = card.locator('button[data-act="plan"]:not(.move)').first();
    let dest: number;
    if (await plan.count()) {
      dest = Number(await plan.getAttribute("data-dest"));
      // (Clicked from inside the page: see the note on the "Set sail" click below.)
      await page.evaluate((d: number) => (document.querySelector(`.shipCard[data-ship] button[data-act="plan"][data-dest="${d}"]:not(.move)`) as HTMLButtonElement).click(), dest);
      assert.equal(await card.locator("select[data-field=dest]").inputValue(), String(dest), "plan fills the destination");
      assert.notEqual(await card.locator("select[data-field=good]").inputValue(), "", "and the cargo");
      assert.match((await card.locator("[data-field=estimate]").textContent())!, /This trip makes about/);
    } else {
      const home = (await me(page)).ships[0].port;
      const nb = map.routes.find((r: any) => r.a === home || r.b === home);
      dest = nb.a === home ? nb.b : nb.a;
      await card.locator("select[data-field=dest]").selectOption(String(dest));
      await card.locator("select[data-field=good]").selectOption("grain");
      await card.locator("input[data-field=qty]").fill("100");
    }
    // What the client predicts, using exactly the form's values.
    const predicted = await page.evaluate(() => {
      const w = window as any, card = document.querySelector(".shipCard[data-ship]")!;
      const s = w.eval("me").ships[0];
      const g = w.eval("GOOD_NAMES").indexOf((card.querySelector("[data-field=good]") as HTMLSelectElement).value);
      const qty = Number((card.querySelector("[data-field=qty]") as HTMLInputElement).value);
      return w.eval("tripProfit")(s, Number((card.querySelector("[data-field=dest]") as HTMLSelectElement).value), g, qty).profit;
    });
    const before = (await me(page)).cash;
    // A game hour passes every 0.12 s here and each one rebuilds the panel, so Playwright's click
    // keeps finding a fresh button; click it from inside the page (a real click holds the rebuild).
    await page.evaluate(() => (document.querySelector(".shipCard[data-ship] button[data-act=sail]") as HTMLButtonElement).click());
    await page.waitForFunction((d: number) => { const m = (window as any).eval("me"); return m.ships[0].dest === null && m.ships[0].port === d; }, dest, { timeout: 60000 });
    // At this test's speed a game hour passes every 0.12 s, so the button's price label (and width)
    // changes faster than Playwright's "stable" check; click it from inside the page instead.
    await page.waitForSelector('.shipCard button[data-act="sell"]');
    await page.evaluate(() => (document.querySelector('.shipCard button[data-act="sell"]') as HTMLButtonElement).click());
    await page.waitForFunction(() => (window as any).eval("me").ships[0].qty === 0);
    const real = (await me(page)).cash - before;
    // Markets drift a little during the voyage, so allow a small gap.
    // The estimate must never overpromise. It may undersell: the destination keeps consuming during
    // the voyage, which pushes its price up, and the estimate uses today's price.
    const gap = Math.max(60, Math.abs(predicted) * 0.15);
    // (This test world has no bots, so prices can climb a lot during the voyage.)
    assert.ok(real > predicted - gap, `predicted ${predicted.toFixed(0)}, really ${real.toFixed(0)}`);
    assert.deepEqual(errors, []);
  } finally { await t.stop(); cleanup(t); }
});

test("admin can switch the world to easy and players see it", { skip: SKIP, timeout: 60000 }, async () => {
  const t = await startServer();
  try {
    const ctx = await browser.newContext();
    const adminPage = await ctx.newPage();
    await adminPage.goto(t.url + "/admin");
    await adminPage.fill("#token", ADMIN); await adminPage.click("#save");
    await adminPage.waitForFunction(() => document.getElementById("diffNow")!.textContent === "normal");
    await adminPage.selectOption("#difficulty", "easy");
    await adminPage.click("#applyDifficulty");
    await adminPage.waitForFunction(() => document.getElementById("err")!.textContent === "Difficulty set to easy.");
    assert.equal(await adminPage.inputValue("#tax"), "0.05", "live controls show the preset");
    const game = await ctx.newPage();
    await game.goto(t.url);
    await game.waitForFunction(() => document.getElementById("diff")!.textContent === "Easy world");
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});

test("a new Hard world, where no trip pays anywhere yet, says so instead of blaming the port", { skip: SKIP, timeout: 60000 }, async () => {
  // At hour 0 of a Hard season (9% tax, 40 port fee) the pre-stocked ports aren't far enough apart
  // for any trip to pay. The panel used to say "from here or one hop away", as if moving would help.
  const t = await startServer({ DIFFICULTY: "hard" });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e: Error) => errors.push(`hard: ${e.message}`));
    await page.goto(t.url);
    await page.fill("#authName", "Hardy Freight"); await page.fill("#authPass", "password123");
    await page.click("button[data-mode=register]");
    await closeGuide(page);
    const nowhere = await page.evaluate(() => { const w = (window as any).eval("world"), m = (window as any).eval("me");
      return w.ports.every((p: any) => (window as any).eval("rawTrips")({ ...m.ships[0], port: p.id, qty: 0 }, 1).length === 0); });
    assert.ok(nowhere, "test assumes no trip pays anywhere at hour 0 on Hard");
    await page.waitForFunction(() => document.getElementById("panel")!.textContent!.includes("No trip pays anywhere on the map right now"));
    assert.ok(!(await page.textContent("#panel"))!.includes("one hop away"));
    assert.ok(await page.locator("button[data-act=sail]").first().isDisabled(), "nothing is preselected, so Set sail waits for a choice");
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});

test("keyboard players: the guide keeps Tab inside it, and focus survives live updates", { skip: SKIP, timeout: 60000 }, async () => {
  const t = await startServer({ TICK_MS: "200", BOTS: "5" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e: Error) => errors.push(`keyboard: ${e.message}`));
    await p.goto(t.url);
    await p.fill("#authName", "Keys Ltd"); await p.fill("#authPass", "password123");
    await p.focus('button[data-mode="register"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#guide:not(.hidden)");
    const inGuide = () => p.evaluate(() => document.getElementById("guide")!.contains(document.activeElement));
    for (let i = 0; i < 4; i++) { await p.keyboard.press("Tab"); assert.ok(await inGuide(), `Tab ${i + 1} stays in the guide`); }
    await p.keyboard.press("Shift+Tab"); assert.ok(await inGuide(), "Shift+Tab stays in the guide");
    await p.keyboard.press("Escape");
    await p.waitForSelector("#guide.hidden", { state: "attached" });
    // Focus a button in the panel, then let several ticks (and bot trades) rebuild the panel.
    await p.waitForSelector("#panel button[data-act]");
    await p.focus("#panel button[data-act]");
    const act = await p.evaluate(() => (document.activeElement as HTMLElement).dataset.act);
    const tick = (await worldOf(p)).tick;
    await p.waitForFunction((t0: number) => (window as any).eval("world").tick >= t0 + 5, tick);
    assert.equal(await p.evaluate(() => (document.activeElement as HTMLElement).dataset.act), act, "the same button still has focus");
    await p.focus('#tabs button[data-tab="fleet"]'); await p.keyboard.press("Enter");
    assert.equal(await p.getAttribute('#tabs button[data-tab="fleet"]', "aria-selected"), "true", "screen readers hear which tab is open");
    assert.equal(await p.getAttribute('#tabs button[data-tab="port"]', "aria-selected"), "false");
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});

test("the sail form says why a load won't work before the click, instead of a bare server refusal", { skip: SKIP, timeout: 60000 }, async () => {
  const t = await startServer({ TICK_MS: "5000", BOTS: "0" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e: Error) => errors.push(`load form: ${e.message}`));
    await p.goto(t.url);
    await p.fill("#authName", "Careful Cargo"); await p.fill("#authPass", "password123");
    await p.click('button[data-mode="register"]');
    await closeGuide(p);
    await p.click('#tabs button[data-tab="fleet"]');
    const card = p.locator(".shipCard[data-ship]").first();
    const ship = (await me(p)).ships[0];
    const dest = map.ports.find((q: any) => q.id !== ship.port).id;
    await card.locator("select[data-field=dest]").selectOption(String(dest));
    await card.locator("select[data-field=good]").selectOption("grain");
    const sail = card.locator("button[data-act=sail]"), est = card.locator("[data-field=estimate]");
    const qty = card.locator("input[data-field=qty]");
    for (const [q, msg] of [["150", /holds 100 at most/], ["0", /Enter how many grain to load/], ["", /Enter how many grain to load/], ["-3", /Enter how many/]] as const) {
      await qty.fill(q);
      assert.match((await est.textContent())!, msg, `quantity ${JSON.stringify(q)}`);
      assert.ok(await sail.isDisabled(), `Set sail is off for quantity ${JSON.stringify(q)}`);
    }
    await qty.fill("20");
    assert.match((await est.textContent())!, /This trip (makes|loses) about/);
    assert.ok(!(await sail.isDisabled()), "a sensible load can sail");
    // More than the port has in stock.
    const text = await p.evaluate(() => {
      const w = window as any, s = w.eval("me").ships[0], port = w.eval("world").ports[s.port];
      const card = document.querySelector(".shipCard[data-ship]")!, saved = port.stock[0];
      port.stock[0] = 12; w.eval("estimate")(card);
      const text = card.querySelector("[data-field=estimate]")!.textContent;
      port.stock[0] = saved; w.eval("estimate")(card);
      return text;
    });
    assert.match(text, /only has 12 grain in stock/);
    // Sailing empty: the quantity box has nothing to count and is switched off.
    await card.locator("select[data-field=good]").selectOption("");
    assert.ok(await qty.isDisabled(), "quantity box is off when sailing empty");
    assert.match((await est.textContent())!, /Sailing empty costs about/);
    assert.ok(!(await sail.isDisabled()));
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});

test("buying a ship warns about the debt sale, and a ship sold for debt is explained", { skip: SKIP, timeout: 60000 }, async () => {
  const t = await startServer({ TICK_MS: "5000", BOTS: "0" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e: Error) => errors.push(`debt sale: ${e.message}`));
    await p.goto(t.url);
    await p.fill("#authName", "Two Hulls"); await p.fill("#authPass", "password123");
    await p.click('button[data-mode="register"]');
    await closeGuide(p);
    const m = await me(p);
    assert.deepEqual(m.forcedSales, [], "the server sends the (empty) list of debt sales");
    // Port tab of the docked ship, with just enough cash to buy: the note warns how little is left.
    const note = (cash: number) => p.evaluate((c: number) => {
      const w = window as any; w.eval("me").cash = c; w.eval("render")();
      return document.querySelector("[data-field=buyShipNote]")?.outerHTML ?? "";
    }, cash);
    const tight = await note(12_500);
    assert.match(tight, /class="est warn"/);
    assert.match(tight, /You'd have 500 cash left, less than one full load here/);
    assert.match(tight, /if your cash is below zero then, an idle spare ship is sold for 6,000/);
    const roomy = await note(40_000);
    assert.doesNotMatch(roomy, /warn|You'd have/, "no warning with plenty of cash");
    assert.match(roomy, /idle spare ship is sold/, "the rule is still explained");
    // The server sold a ship at the day's upkeep: a warning toast, and a note on the Fleet tab.
    await p.click('#tabs button[data-tab="fleet"]');
    const out = await p.evaluate(() => {
      const w = window as any, cur = w.eval("me"), before = { ...cur, forcedSales: [] };
      cur.forcedSales = [{ ship: 77, port: cur.ships[0].port, tick: 48, paid: 6000, cashBefore: -140 }];
      w.eval("noteForcedSales")(before); w.eval("render")();
      return { toast: document.getElementById("toast")!.className + " " + document.getElementById("toast")!.textContent,
        fleet: document.querySelector("[data-field=forcedSale]")?.textContent ?? "" };
    });
    assert.match(out.toast, /warn.*Ship 77 was sold at .+ for 6,000 at the start of day 3: your cash was -140 after the daily upkeep/);
    assert.match(out.fleet, /Ship 77 was sold/);
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});

test("after setting sail the port panel says where your ship went; best trips explain a hop and the ranking", { skip: SKIP, timeout: 60000 }, async () => {
  const t = await startServer({ TICK_MS: "5000", BOTS: "0" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e: Error) => errors.push(`where ships are: ${e.message}`));
    await p.goto(t.url);
    await p.fill("#authName", "Gone Sailing"); await p.fill("#authPass", "password123");
    await p.click('button[data-mode="register"]');
    await closeGuide(p);
    const out = await p.evaluate(() => {
      const w = window as any, m = w.eval("me"), world = w.eval("world"), s = m.ships[0];
      const from = s.port, to = world.ports.find((q: any) => q.id !== from).id;
      // The ship has just left: the panel is still on the port it left.
      Object.assign(s, { dest: to, departTick: world.tick, arriveTick: world.tick + 7 });
      w.eval("selectedPort = " + from); w.eval("render")();
      const empty = document.querySelector("#panel .empty")?.textContent ?? "";
      Object.assign(s, { dest: null });
      // A trip whose destination has nothing paying, but a short empty hop does.
      const trip = { dest: to, g: 0, qty: 100, profit: 300, hours: 4, fuel: 100, next: null,
        onward: { dest: from, cost: 120, hours: 2, next: { profit: 520 } } };
      const html = w.eval("tripsHtml")(s, [trip, { ...trip, onward: null, profit: 200 }]);
      return { empty, html, to: world.ports[to].name, from: world.ports[from].name, id: s.id };
    });
    assert.match(out.empty, new RegExp(`None of your ships are docked here\\. Ship ${out.id} is sailing to ${out.to}, arriving in 7 h\\.`));
    assert.doesNotMatch(out.empty, /Pick a port with your ship/);
    assert.match(out.html, new RegExp(`then \\+400 after a 2 h empty hop to ${out.from}`));
    assert.doesNotMatch(out.html, /short hop to more trips/);
    assert.match(out.html, /Ranked by what each trip earns an hour, counting the next trip from where it ends/);
    // On a 320 px phone the cash change shown after a trade sits beside the cash, not over the clock's label.
    await p.setViewportSize({ width: 320, height: 700 });
    const overlap = await p.evaluate(() => {
      const d = document.getElementById("hDelta")!; d.textContent = "-5,818"; d.classList.add("show");
      const a = d.getBoundingClientRect(), b = document.getElementById("hClock")!.parentElement!.querySelector("span")!.getBoundingClientRect();
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    });
    assert.equal(overlap, false, "cash change overlaps the season clock label at 320 px");
    await ctx.close();
  } finally { await t.stop(); cleanup(t); }
});
