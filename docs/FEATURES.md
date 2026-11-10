# Feature modules

Every feature from `IDEAS_600.md` is a **feature module**: a small, self-contained piece of game code that can be
switched on or off without touching the rest of the game.

## Switching features on and off

`config/features/<category>.json` maps module id to `true` (on) or `false` (off). Edit the file and restart the server.
The switched-on set is written to the event log (`setFeatures`), so old worlds replay exactly.

- **Economy modules ship `false`.** They change prices, money, fuel, tax, fees or travel time, so they stay off
  until Dave approves them. `FINAL_REPORT.md` lists them.
- Content, UI, art, audio, social and tool modules ship `true`.
- For testing: `FEATURES=all npm run dev` switches everything on; `FEATURES=none` switches everything off;
  `FEATURES=+economy.warehouses,-ui.minimap` adjusts the files' choice.

## Writing a module (server)

Put it in `server/src/features/<category>/<name>.ts` and add its factory to `server/src/features/<category>/index.ts`.

```ts
import type { FeatureFactory } from "../types.js";

export const warehouses: FeatureFactory = (e) => {
  const lots = new Map<number, number>();           // all state lives in the closure
  return {
    id: "economy.warehouses", ideas: [4], title: "Warehouses", economy: true,
    apply(cmd) { /* validate everything; cmd.company is trusted, every other field is not */ return { ok: true }; },
    advance() { /* hourly */ },
    cards(company) { return [{ title: "Store cargo", detail: "...", actions: [
      { label: "Store", command: { type: "feature", module: "economy.warehouses", action: "store" },
        fields: [{ key: "qty", label: "Tonnes", min: 1, max: 100, value: 10 }] }] }]; },
    view(company) { return { lots: lots.get(company) ?? 0 }; },   // -> me.featureData["economy.warehouses"]
  };
};
```

Rules:

1. **Deterministic.** No `Date.now()`, no `Math.random()`. Use `e.tick` for time and `e.features.random()` for chance.
   State may change only in `enable`, `apply` and `advance`, so a restart replays the event log to the same state.
2. **Server-authoritative.** Validate every field of `cmd` (types, ranges, ownership). Never trust a price, balance or
   position from the client. Use `e.companies`, `e.ships`, `e.price()`, `e.buyCost()`, `e.sellValue()`, `e.stock`.
3. **Economy hooks.** To change fuel, travel time, port fees, trade tax, capacity or upkeep, use `adjust`
   (see `HookContexts` in `types.ts`). Hooks run only while the module is on. Set `economy: true`.
4. **No personal data.** No emails, real names, IPs or free-text that identifies a player outside the game.
5. **No real money.** Monetisation items are in-game unlocks plus a link placeholder in `config/links.json`.
6. **Don't edit shared core files** (`engine.ts`, `main.ts`, `app.js`, `registry.ts`, `types.ts`) unless a feature truly
   cannot be built through the module API. If you must, keep the change minimal and list it in your category report.
7. Card actions render automatically in the **Opportunities** tab (one section per module with cards).

## Writing a module (client)

Client-only features (UI, art, audio, accessibility) go in `server/public/features/<category>.js`, which loads after
`app.js` and can use its globals (`world`, `me`, `command`, `toast`, `render`, `$`).

```js
ManifestHooks.on("draw", () => { /* draw over the map canvas, id "map" */ });
ManifestHooks.on("state", (world, me) => { /* react to a server update */ });
ManifestHooks.on("render", (world, me) => { /* decorate the side panel */ });
```

A client feature tied to a server module should check `ManifestHooks.enabled("<module id>")`.
Client-only settings (dark mode, text size) are stored in `localStorage` inside try/catch.

## Tests

Each category has `server/test/features-<category>.test.ts`. Use `test/feature-helpers.ts`:

```ts
const w = featureWorld(["economy.warehouses"]);
const c = w.company("A");
assert.equal(w.act(c, "economy.warehouses", "store", { qty: 10 }).ok, true);
assertReplays(["economy.warehouses"], w => { /* same actions */ });
```

Every module needs at least one test. Run `npm test` from `server/`; the whole suite must pass.
