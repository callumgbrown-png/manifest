"""Give every port a role in the two newer goods (ore, machinery) and write config/map.json.

Deterministic: producers and consumers of each good are picked by farthest-point sampling (so they
spread over the map), starting from a port chosen by a fixed seed. Existing grain/fuel roles are kept.
Usage:  python tools/add_goods.py
"""
import json, math, random
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "config" / "map.json"
# good: (producers, consumers, seed)
PLAN = {"ore": (10, 9, 11), "machinery": (6, 10, 23)}


def spread(ports, k, rng, avoid):
    cand = [p for p in ports if p["id"] not in avoid]
    pick = [rng.choice(cand)]
    while len(pick) < k:
        far = max((c for c in cand if c not in pick),
                  key=lambda c: min(math.dist((c["x"], c["y"]), (q["x"], q["y"])) for q in pick))
        pick.append(far)
    return pick


def main():
    m = json.loads(PATH.read_text())
    for p in m["ports"]:
        p["produces"] = [g for g in p["produces"] if g in ("grain", "fuel")]
        p["consumes"] = [g for g in p["consumes"] if g in ("grain", "fuel")]
    for good, (nprod, ncons, seed) in PLAN.items():
        rng = random.Random(seed)
        prods = spread(m["ports"], nprod, rng, set())
        # Keep every port to at most three roles overall, and never produce and consume the same good.
        busy = {p["id"] for p in m["ports"] if len(p["produces"]) + len(p["consumes"]) >= 3}
        cons = spread(m["ports"], ncons, rng, {p["id"] for p in prods} | busy)
        for p in prods: p["produces"].append(good)
        for p in cons: p["consumes"].append(good)
    PATH.write_text(json.dumps(m, indent=2) + "\n")
    for g in ("ore", "machinery"):
        print(g, sum(g in p["produces"] for p in m["ports"]), "producers,", sum(g in p["consumes"] for p in m["ports"]), "consumers")


main()
