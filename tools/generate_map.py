"""Generate a fictional region map for Manifest: ports, their economic roles and sea routes.

Usage:  python tools/generate_map.py [--seed 7] [--ports 40]
Writes config/map.json. The map is deterministic for a given seed.
"""
import argparse
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SYLLABLES_A = ["Bal", "Cor", "Dun", "Fen", "Gal", "Hav", "Kel", "Lor", "Mar", "Nor",
               "Ost", "Pel", "Ros", "Sal", "Tor", "Vel", "Wex", "Ard", "Bry", "Cal"]
SYLLABLES_B = ["haven", "mouth", "port", "wick", "ford", "sund", "holm", "bay",
               "gate", "strand", "ness", "quay"]


def make_names(rng, n):
    names = set()
    while len(names) < n:
        names.add(rng.choice(SYLLABLES_A) + rng.choice(SYLLABLES_B))
    return sorted(names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--ports", type=int, default=40)
    args = ap.parse_args()

    rules = json.loads((ROOT / "config/rules.json").read_text())
    width, height = rules["map"]["width"], rules["map"]["height"]
    rng = random.Random(args.seed)

    # Place ports with a minimum spacing so routes have real length.
    coords = []
    while len(coords) < args.ports:
        x, y = rng.uniform(30, width - 30), rng.uniform(30, height - 30)
        if all(math.dist((x, y), c) > 70 for c in coords):
            coords.append((x, y))

    names = make_names(rng, args.ports)

    # Economic roles: every port trades both goods; some produce, some consume.
    ids = list(range(args.ports))
    rng.shuffle(ids)
    grain_producers = set(ids[:12])
    fuel_producers = set(ids[12:20])
    rest = ids[20:]
    grain_consumers, fuel_consumers = set(), set()
    for i, pid in enumerate(rest):
        if i % 3 in (0, 1):
            grain_consumers.add(pid)
        if i % 3 in (1, 2):
            fuel_consumers.add(pid)
    # Producers of one good consume the other, so most ports want something.
    for pid in grain_producers:
        if rng.random() < 0.5:
            fuel_consumers.add(pid)
    for pid in fuel_producers:
        if rng.random() < 0.5:
            grain_consumers.add(pid)

    ports = []
    for pid, (x, y) in enumerate(coords):
        ports.append({
            "id": pid,
            "name": names[pid],
            "x": round(x, 1),
            "y": round(y, 1),
            "produces": [c for c, s in (("grain", grain_producers), ("fuel", fuel_producers)) if pid in s],
            "consumes": [c for c, s in (("grain", grain_consumers), ("fuel", fuel_consumers)) if pid in s],
        })

    # Routes: link each port to its 3 nearest neighbours, then join any separate
    # clusters with their shortest link so every port is reachable.
    def d(a, b):
        return math.dist(coords[a], coords[b])

    edges = set()
    for a in range(args.ports):
        near = sorted((b for b in range(args.ports) if b != a), key=lambda b: d(a, b))[:3]
        for b in near:
            edges.add((min(a, b), max(a, b)))

    parent = list(range(args.ports))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in edges:
        parent[find(a)] = find(b)
    while len({find(i) for i in range(args.ports)}) > 1:
        best = None
        for a in range(args.ports):
            for b in range(args.ports):
                if find(a) != find(b) and (best is None or d(a, b) < best[0]):
                    best = (d(a, b), a, b)
        _, a, b = best
        edges.add((min(a, b), max(a, b)))
        parent[find(a)] = find(b)

    routes = [{"a": a, "b": b, "distance": round(d(a, b), 1)} for a, b in sorted(edges)]
    out = {"seed": args.seed, "ports": ports, "routes": routes}
    (ROOT / "config/map.json").write_text(json.dumps(out, indent=2))
    print(f"Wrote {len(ports)} ports and {len(routes)} routes to config/map.json")


if __name__ == "__main__":
    main()
