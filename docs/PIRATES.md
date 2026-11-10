# Pirates, police and home bases

Branch `pirates-police` (off `merge-all`). Server owns every rule; the client only shows state and sends commands.
All numbers live in `config/rules.json` (`pirates`, `police`, `ship_types.pirate`). Set `pirates.enabled` to `false` and the
game is the old one (no pirate ships for sale, no raids, no police). Everything is event-log replayed: raids roll with a
seeded hash of (tick, ship, target, raid counter), never `Math.random` or the clock.

## Already fixed before the build
* **Flat ore and machinery prices.** The map generator made ports for the four goods, but `ore` and `machinery` had no
  producers in live (random-season) worlds, so their prices never moved. `assignNewGoods` now gives 10 ports ore and 6 machinery;
  `validateMap` requires them. Test `test/goods-roles.test.ts`. (Economy-related: please confirm.)
* **Ship icons turn smoothly through 360 degrees** (`ship-views.js`): vector placeholder hulls, eased heading; the pixel-art atlas
  remains as fallback (`ManifestShipSprites.setMode("atlas")`).

## 1. Home bases
Every company gets one permanent home port when it registers (`homes.ts`): the start port with the fewest companies, then the
farthest by sea from other homes, random among the best 3 (seeded). Shown on the map as a flag and as "Your home base".

## 2. Pirate ship class
Fast, small hold, dear, sold **only at your home port**: price 9,500, hold 30, speed 120 per hour (freighter: 100 hold, 40 per hour),
upkeep 300 a day. Max fleet size is unchanged.

## 3. Raiding (`piracy.ts`)
A pirate ship may raid a ship at sea within `range` 70 that is not a pirate, not in port, not in the safe waters
(`home_safe_radius` 45) around its own owner's home port, and (while `protect_only_ship` is true) not a company's only ship.
Then it rests `cooldown_hours` 12.

    chance = clamp(base 0.2 + 0.7 x (1 - victim speed / pirate speed) - 0.03 x max(0, victim hold / pirate hold - 1), 0.1, 0.85)

A seeded roll below the chance wins. A win takes as much cargo as the pirate's free hold (30); a roll below
chance x (1 - 0.85) captures the whole ship (if the pirate company has room). A loss costs 300. Every raid adds 25 notoriety
(max 100, decays 0.4 an hour). Both sides get a notice.

## 4. Police (`police.ts`)
One police ship per 8 companies (3 to 10), speed 100. They patrol between ports; a company whose notoriety is above 10 is
chased; within 30 of it the police catch with chance 0.15 + 0.005 x notoriety (max 0.7). Outcome by notoriety:
below 45 a fine of 80 per point; 45 to 75 a 24 hour lockout from sailing; 75 and above one ship confiscated (a company's only ship
gets the lockout instead). After an arrest notoriety drops to 5.

## 5. Interface
Raid button on every pirate ship card (targets, the exact odds the server worked out, disabled with the reason when lying low or locked
out); notoriety bar with a meter role; lockout line; the last 12 notices (raided, captured, fined, ...); police ships drawn with a ring on
the map; a "How pirates work" box (keyboard-operable `details`). Works at 1440, 390 and 320 px.

## Simulation (`sim/playtest.ts`, 20 seasons, normal difficulty, 30 bots, map `config/map.json`)
Run: `PIRATES=off|on SEEDS=20 PER=2 STRATS=plan,pirate npx tsx ../sim/playtest.ts` from `server/`.
`RULES='{"pirates":{...}}'` overrides numbers. "honest" is the `plan` strategy (the best advice-following trader, one freighter).
"pirate" has that same trading freighter plus a pirate ship played like a pirate bot.

| Setting | Honest median | Honest worst | Pirate median | Pirate worst / best | Raids won / captured / lost (20 seasons, 40 pirates) |
|---|---|---|---|---|---|
| Pirates off | 41,498 | 26,225 | - | - | - |
| **As built** (only ships protected, upkeep 300) | 38,181 | 28,260 | **6,159** | 4,727 / 41,823 | 0 / 0 / 2 |
| Only ships can be raided too | 36,101 | 4,669 | 20,792 | 4,664 / 37,995 | 99 / 27 / 104 |
| ... and pirate upkeep 150 | 36,322 | 11,969 | 23,504 | 5,395 / 38,621 | 99 / 22 / 84 |
| ... base chance 0.3, failed raid 150, upkeep 150 | 34,806 | -707 | 22,317 | 4,444 / 38,607 | 127 / 26 / 66 |
| ... upkeep 150, bot_share 0.05 | 36,868 | 11,969 | 23,485 | 5,395 / 42,000 | 114 / 22 / 83 |

(For scale: the other honest strategies, "advice" alone, finish near 20,700; bots near 18,000.) Start worth is 16,000.

### What the numbers say
1. **As built, pirates do not work.** Nearly every company has one ship and a company's only ship is protected, so a pirate almost
   never has prey (2 raids in 20 seasons) and loses its 9,500 price and 300 a day. This is the decision for you.
2. If only ships can be raided, pirates become a real but weaker path (median about 21,000 to 23,500, below an honest optimiser at
   about 36,000, above bots at about 18,000), and they do not beat honest players by a large margin. Honest median falls 7 to 9 percent;
   the worst honest season falls to about 12,000 with upkeep 150 (a victim loses a load but not the company). Raising the pirate's odds and
   cutting repair costs (row 5) is too harsh: one honest player went below zero.

### Proposal (needs your approval; the branch keeps the as-built numbers)
* `pirates.protect_only_ship`: `false`, and pirate `upkeep`: 150. Optionally `bot_share` 0.05 so bots do not hunt so much.
* A different protection to consider instead of "only ship": no raids in a company's first N days, or while its cash is below a floor.
  The rule is now a flag, so this is a small change.

## Decisions only you can make
1. Protect only ships (as built) or not; pirate upkeep 300 or 150 (the table).
2. Pirate ships sold at the home port only (as built) or anywhere.
3. `home_safe_radius` is around the **victim's** home port (as built); you may prefer a safe zone around every port.
4. Ore/machinery generator fix changes live prices: please confirm.
5. Whether a captured ship keeps its cargo (it does) and whether a captured pirate ship may itself be captured.

## Art needed from you (placeholders only today)
Pirate ship and police ship sprites (8 directions to match the atlas), home flag icon, notoriety/police icons, and final
art for the ship classes (coaster, freighter, bulker) if you want pixel art for them in the vector mode's place.

## Tests
`test/pirate-class.test.ts`, `raiding.test.ts`, `police.test.ts` (including a whole bot world replayed exactly from its commands),
`pirates-restart.test.ts` (server restart keeps homes, pirate ship, police), `goods-roles.test.ts`, browser test for the UI at 1440/390/320.
Questions or feedback: https://discord.gg/zZDk58ZyD
