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
/** Click a port on the map, the way a player picks one. */
async function selectPort(page: any, id: number) {
  const box = await page.locator("#map").boundingBox();
  const v = await page.evaluate(() => (window as any).eval("view"));
  await page.mouse.click(box.x + v.ox + map.ports[id].x * v.scale, box.y + v.oy + map.ports[id].y * v.scale);
  await page.waitForFunction((n: string) => document.querySelector("#panel h2")?.textContent === n, map.ports[id].name);
}
async function sailTo(page: any, port: number, load?: string) {
  await page.click('#tabs button[data-tab="fleet"]');
  const card = page.locator(".shipCard[data-ship]").first();
  await card.locator("select[data-field=dest]").selectOption(String(port));
  if (load) await card.locator("select[data-field=good]").selectOption(load);
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
  assert.equal(await a.textContent("#hCash"), "10,000");
  assert.equal(await a.textContent("#conn"), "live");
  assert.match((await a.textContent("#hClock"))!, /^Day 1 of 56, \d\d:00$/);

  const b = await player("B");
  await b.fill("#authName", "Alpha Lines"); await b.fill("#authPass", "password123");
  await b.click('button[data-mode="register"]');
  await b.waitForFunction(() => document.getElementById("authError")!.textContent === "That name is taken");
  await b.fill("#authName", "Beta Shipping");
  await b.click('button[data-mode="register"]');
  await b.waitForFunction(() => document.getElementById("hName")!.textContent === "Beta Shipping");

  // ---- the port panel shows the market for the port your ship is in
  const A0 = await me(a);
  const home = A0.ships[0].port;
  assert.equal(await a.textContent("#panel h2"), map.ports[home].name);
  assert.equal(await a.locator("#panel table tr").count() >= 3, true);
  assert.ok(await a.locator('button[data-act="buyShip"]').count(), "buy-ship button shown at a port with your ship");

  // ---- clicking a port on the map selects it
  await selectPort(a, (home + 1) % map.ports.length);

  // ---- the trip estimate updates as you change the form
  await a.click('#tabs button[data-tab="fleet"]');
  const card = a.locator(".shipCard[data-ship]").first();
  assert.match((await card.locator("[data-field=estimate]").textContent())!, /^Fuel ≈ [\d,]+, port fee 25\.$/);
  await card.locator("select[data-field=good]").selectOption("grain");
  assert.match((await card.locator("[data-field=estimate]").textContent())!, /this trip (makes|loses) [\d,]+/);

  // ---- server refusals show as a red toast
  await card.locator("input[data-field=qty]").fill("500");
  await card.locator("button[data-act=sail]").click();
  await toast(a, /over capacity/);
  assert.ok(await a.locator("#toast.bad").count());

  // ---- sail with grain to a neighbour; ship shows as sailing; sell on arrival
  const nb = map.routes.find((r: any) => r.a === home || r.b === home);
  const dest = nb.a === home ? nb.b : nb.a;
  await card.locator("input[data-field=qty]").fill("60");
  await sailTo(a, dest, "grain");
  await a.waitForFunction(() => /Sailing to .*, arrives in \d+ h/.test(document.getElementById("panel")!.textContent!));
  const cashSailing = (await me(a)).cash;
  assert.ok(cashSailing < 10000);
  await waitDocked(a, dest);
  await selectPort(a, dest);
  // List 20 for sale, then sell the rest to the market.
  const shipCard = a.locator(".shipCard[data-ship]").first();
  await shipCard.locator("input[data-field=sellQty]").fill("20");
  await shipCard.locator("input[data-field=sellPrice]").fill("39");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await shipCard.locator("button[data-act=listSell]").click();
  await toast(a, /Listed for sale/);
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 40);
  await a.locator('.shipCard button[data-act="sell"]').click();
  await toast(a, /^Sold$/);
  await a.waitForFunction(() => (window as any).eval("me").ships[0].qty === 0);
  assert.ok((await me(a)).cash > cashSailing);

  // ---- orders tab: post a buy order, see it, cancel it, see the cash come back
  await a.click('#tabs button[data-tab="orders"]');
  const cashBefore = (await me(a)).cash;
  await a.selectOption("#oPort", String(home));
  await a.selectOption("#oGood", "fuel");
  await a.fill("#oQty", "10"); await a.fill("#oPrice", "50");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
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
  await b.locator('button[data-act="buyOrder"]').click();
  await toast(b, /^Bought$/);
  await b.waitForFunction(() => (window as any).eval("me").ships[0].qty === 20);
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
  await a.locator(".shipCard input[data-field=qty]").first().fill("15");
  await sailTo(a, home, "grain");
  await waitDocked(a, home);
  await a.click('#tabs button[data-tab="fleet"]');
  await a.locator('button[data-act="fill"]').click();
  await toast(a, /Order filled/);
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
    await a.click('button[data-act="buyShip"]');
    await toast(a, /not enough cash/);
  }

  // ---- leaderboard
  await a.click('#tabs button[data-tab="board"]');
  const rows = await a.locator("#panel table tr").allTextContents();
  assert.ok(rows.some(r => r.includes("Alpha Lines")) && rows.some(r => r.includes("Beta Shipping")));

  // ---- the session survives a reload; log out shows the sign-in screen; log back in
  await a.reload();
  await a.waitForFunction(() => document.getElementById("hName")!.textContent === "Alpha Lines");
  await a.click("#logout");
  await a.waitForSelector("#auth:not(.hidden)");
  await a.fill("#authName", "alpha lines"); await a.fill("#authPass", "wrong-password");
  await a.click('button[data-mode="login"]');
  await a.waitForFunction(() => document.getElementById("authError")!.textContent === "Wrong name or password");
  await a.fill("#authPass", "password123");
  await a.click('button[data-mode="login"]');
  await a.waitForFunction(() => document.getElementById("hName")!.textContent === "Alpha Lines");

  // ---- phone-sized screen: no sideways scrolling
  await a.setViewportSize({ width: 390, height: 800 });
  await a.waitForTimeout(200);
  assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone screen");

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
  assert.match((await page.textContent("#seasonInfo"))!, /^Day \d+ of 56\.$/);
  // A blank box is left alone instead of being set to zero.
  await page.fill("#upkeep", "");
  await page.fill("#tax", "0.06");
  await page.click("#apply");
  await page.waitForFunction(() => document.getElementById("err")!.textContent === "Saved.");
  const m = await (await fetch(s.url + "/api/admin/metrics", { headers: { "x-admin-token": ADMIN } })).json();
  assert.equal(m.tax, 0.06); assert.equal(m.upkeep, 400);
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
