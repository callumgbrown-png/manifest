// Random-season worlds must give ore and machinery producers and consumers: before, only grain and fuel had them,
// so those two goods never changed stock, sat at the midpoint price (15.00 and 150.00) and no bot could trade them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateRandomSeason, validateSeasonMap } from "../src/random-season.ts";
import { Engine, GOODS } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));

for (const seed of ["roles-1", "roles-2", "roles-3"]) {
  test(`world "${seed}": every good has producers and consumers, and every price moves`, async () => {
    const map = await generateRandomSeason({ seed });
    assert.equal(validateSeasonMap(map), true);
    const count = (g: string, key: "produces" | "consumes") => map.ports.filter((p: any) => p[key].includes(g)).length;
    assert.deepEqual([count("ore", "produces"), count("ore", "consumes")], [4, 4]);   // the industry chain: four mines make ore, four factories use it
    assert.deepEqual([count("machinery", "produces"), count("machinery", "consumes")], [4, 7]);   // four factories make machinery; the four mines and three more ports use it
    assert.ok(map.ports.every((p: any) => p.produces.length + p.consumes.length <= 4), "no port is loaded with roles");
    assert.ok(map.ports.every((p: any) => p.produces.every((g: string) => !p.consumes.includes(g))), "no port makes and uses the same good");
    const e = new Engine(rules, map, 60);
    const g0 = GOODS.map((_, g) => ({
      maker: map.ports.findIndex((p: any) => p.produces.includes(GOODS[g])),
      user: map.ports.findIndex((p: any) => p.consumes.includes(GOODS[g])),
    }));
    const before = g0.map((x, g) => [e.price(x.maker, g), e.price(x.user, g)]);
    for (let i = 0; i < 168; i++) e.advance();
    GOODS.forEach((name, g) => {
      assert.notEqual(e.price(g0[g].maker, g), before[g][0], `${name} price moves at a producer in a week`);
      assert.notEqual(e.price(g0[g].user, g), before[g][1], `${name} price moves at a consumer in a week`);
      assert.notEqual(e.price(g0[g].maker, g), e.price(g0[g].user, g), `${name} differs between producer and consumer`);
    });
  });
}
