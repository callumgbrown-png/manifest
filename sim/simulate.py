"""Manifest economy simulator.

Bot trading companies play a full season against the market rules in
config/rules.json on the map in config/map.json. The point is to find out
whether the economy stays stable before any real player joins.

Usage:
    python sim/simulate.py --seasons 10 --companies 300
Outputs (in results/):
    season_<n>.csv     one row per day per season
    summary.json       health checks per season and overall
"""
import argparse
import csv
import json
import math
import random
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
GOODS = ["grain", "fuel"]
FUEL = 1


# ---------------------------------------------------------------- world setup

def load_world():
    rules = json.loads((ROOT / "config/rules.json").read_text())
    world = json.loads((ROOT / rules["map"]["file"]).read_text())
    n = len(world["ports"])

    # Shortest sailing distance between every pair of ports (Floyd-Warshall).
    dist = np.full((n, n), np.inf)
    np.fill_diagonal(dist, 0)
    for r in world["routes"]:
        dist[r["a"], r["b"]] = dist[r["b"], r["a"]] = r["distance"]
    for k in range(n):
        dist = np.minimum(dist, dist[:, k:k + 1] + dist[k:k + 1, :])

    m = rules["markets"]
    prod = np.zeros((n, 2))
    cons = np.zeros((n, 2))
    for p in world["ports"]:
        for g, good in enumerate(GOODS):
            if good in p["produces"]:
                prod[p["id"], g] = m["production_per_hour"][good]
            if good in p["consumes"]:
                cons[p["id"], g] = m["consumption_per_hour"][good]
    return rules, world, dist, prod, cons


class Market:
    """Stock-based port markets. Price falls linearly from ceiling (no stock)
    to floor (stock at twice the target)."""

    def __init__(self, rules, n):
        self.floor = np.array([rules["commodities"][g]["floor"] for g in GOODS], float)
        self.ceil = np.array([rules["commodities"][g]["ceiling"] for g in GOODS], float)
        self.target = rules["markets"]["target_stock"]
        self.cap = self.target * rules["markets"]["max_stock_multiple"]
        self.stock = np.full((n, 2), float(self.target))

    def price_at(self, stock, g):
        frac = np.clip(1 - stock / (2 * self.target), 0, 1)
        return self.floor[g] + (self.ceil[g] - self.floor[g]) * frac

    def prices(self):
        return np.stack([self.price_at(self.stock[:, g], g) for g in range(2)], axis=1)

    def buy_cost(self, port, g, qty):
        """Total cost of buying qty; price rises as stock falls. Stock that
        isn't there is bought at the ceiling price (emergency supply)."""
        have = min(qty, self.stock[port, g])
        mid = self.stock[port, g] - have / 2
        cost = have * self.price_at(mid, g) + (qty - have) * self.ceil[g]
        return float(cost), have

    def sell_value(self, port, g, qty):
        mid = self.stock[port, g] + qty / 2
        return float(qty * self.price_at(mid, g))


# ---------------------------------------------------------------- agents

class Ship:
    __slots__ = ("owner", "port", "dest", "eta", "good", "qty", "cost")

    def __init__(self, owner, port):
        self.owner, self.port = owner, port
        self.dest, self.eta, self.good, self.qty, self.cost = None, 0, None, 0.0, 0.0


class Company:
    __slots__ = ("id", "profile", "cash", "ships", "offset")

    def __init__(self, cid, profile, cash, offset):
        self.id, self.profile, self.cash, self.ships, self.offset = cid, profile, cash, [], offset

    def active(self, hour):
        # Casual players log in twice a day; everyone else is always on.
        return self.profile != "casual" or hour % 12 == self.offset


PROFILES = [("greedy", 0.4), ("lagged", 0.4), ("casual", 0.2)]   # default bot mix
RESERVE = {"greedy": 3000, "lagged": 5000, "casual": 8000}


# ---------------------------------------------------------------- season

def run_season(seed, n_companies, rules, world, dist, prod, cons, return_companies=False,
               profiles=PROFILES):
    rng = random.Random(seed)
    n = len(world["ports"])
    mk = Market(rules, n)
    fee = rules["fees"]["port_fee_per_docking"]
    tax = rules["fees"]["trade_tax_rate"]
    sh = rules["ship"]
    cap, speed = sh["capacity"], sh["speed_per_hour"]
    fuel_rate = sh["fuel_per_100_distance"] / 100
    hours_total = rules["season"]["days"] * 24
    hours = np.ceil(dist / speed)
    np.fill_diagonal(hours, 0)
    fuel_need = dist * fuel_rate

    companies, ships = [], []
    for cid in range(n_companies):
        r, acc = rng.random(), 0
        for name, share in profiles:
            acc += share
            if r <= acc:
                profile = name
                break
        c = Company(cid, profile, rules["company"]["start_cash"], rng.randrange(12))
        for _ in range(rules["company"]["start_ships"]):
            s = Ship(cid, rng.randrange(n))
            c.ships.append(s)
            ships.append(s)
        companies.append(c)

    inbound_visible = rules.get("information", {}).get("inbound_cargo_visible", False)
    incoming = np.zeros((n, 2))  # cargo already sailing towards each port
    empty_inbound = np.zeros(n)  # empty ships sailing to each port to load there
    net_flow = prod - cons       # hourly stock change at each port, before trading
    history = []               # price snapshots, for players acting on old data
    rows = []
    flows = dict.fromkeys(["sales", "goods", "fuel", "fees", "upkeep", "ships"], 0.0)
    trades, profit_sum, revenue_sum = 0, 0.0, 0.0

    for hour in range(hours_total):
        # 1. Ports produce and consume.
        mk.stock = np.minimum(mk.stock + prod, mk.cap)
        mk.stock = np.maximum(mk.stock - cons, 0)
        true_p = mk.prices()
        history.append(true_p)
        stale_p = history[max(0, len(history) - 25)]

        # 2. Daily upkeep.
        if hour % 24 == 0 and hour > 0:
            for c in companies:
                cost = sh["upkeep_per_day"] * len(c.ships)
                c.cash -= cost
                flows["upkeep"] += cost

        # 3. Arrivals: dock, pay the fee, sell cargo.
        for s in ships:
            if s.dest is None:
                continue
            s.eta -= 1
            if s.eta > 0:
                continue
            owner = companies[s.owner]
            s.port, s.dest = s.dest, None
            owner.cash -= fee
            flows["fees"] += fee
            if s.qty == 0:
                empty_inbound[s.port] -= 1
            if s.qty > 0:
                incoming[s.port, s.good] -= s.qty
                gross = mk.sell_value(s.port, s.good, s.qty)
                net = gross * (1 - tax)
                mk.stock[s.port, s.good] += s.qty
                owner.cash += net
                flows["sales"] += net
                flows["fees"] += gross * tax
                trades += 1
                profit_sum += net - s.cost
                revenue_sum += net
                s.qty, s.cost, s.good = 0.0, 0.0, None

        # Best loaded trip available from each port (used for repositioning).
        p = true_p
        fuel_cost_from = fuel_need * p[:, FUEL][:, None]
        best_from = np.zeros(n)
        for g in range(2):
            spread = (p[None, :, g] * (1 - tax) - p[:, None, g] * (1 + tax)) * cap
            val = spread - fuel_cost_from - fee
            np.fill_diagonal(val, -np.inf)
            best_from = np.maximum(best_from, val.max(axis=1))

        # 4. Idle ships choose their next voyage.
        rng.shuffle(ships)
        for s in ships:
            if s.dest is not None:
                continue
            owner = companies[s.owner]
            if not owner.active(hour) or owner.cash <= 0:
                continue
            seen = stale_p if owner.profile == "lagged" else true_p
            here = s.port
            dests = np.arange(n)
            if owner.profile == "casual":
                dests = np.array(rng.sample(range(n), 6))
            dests = dests[dests != here]
            trip_fuel = fuel_need[here, dests] * seen[here, FUEL]
            trip_h = hours[here, dests]

            best = (0.0, None, None, 0.0)   # score, dest, good, qty
            for g in range(2):
                unit = seen[here, g] * (1 + tax)
                qty = min(cap, mk.stock[here, g], max(0.0, owner.cash - 500) / unit)
                if qty < 10:
                    continue
                if inbound_visible and owner.profile != "lagged":
                    # Forecast the destination price when this ship arrives:
                    # cargo already inbound, the port's own production and
                    # consumption over the trip, and the price drop from our sale.
                    est = np.clip(mk.stock[dests, g] + incoming[dests, g]
                                  + net_flow[dests, g] * trip_h, 0, mk.cap) + qty / 2
                    sell_p = mk.price_at(est, g)
                    unit = mk.price_at(mk.stock[here, g] - qty / 2, g) * (1 + tax)
                else:
                    sell_p = seen[dests, g]
                profit = qty * (sell_p * (1 - tax) - unit) - trip_fuel - fee
                score = profit / (trip_h + 1)
                i = int(np.argmax(score))
                if score[i] > best[0]:
                    best = (float(score[i]), int(dests[i]), g, float(qty))
            # Sail empty to a better port if that beats any loaded trip. Players
            # who can see inbound ships expect to share that port's best trade
            # with the empty ships already heading there.
            opportunity = best_from[dests]
            if inbound_visible and owner.profile != "lagged":
                opportunity = opportunity / (1 + empty_inbound[dests])
            repo = (opportunity - trip_fuel - fee) / (trip_h + 6)
            i = int(np.argmax(repo))
            if repo[i] > best[0] * 1.5 and repo[i] > 0:
                best = (float(repo[i]), int(dests[i]), None, 0.0)
            if best[1] is None:
                continue

            _, dest, g, qty = best
            if g is not None:
                cost, _ = mk.buy_cost(here, g, qty)
                cost *= 1 + tax
                if cost > owner.cash - 200:
                    continue
                mk.stock[here, g] = max(0.0, mk.stock[here, g] - qty)
                owner.cash -= cost
                flows["goods"] += cost
                s.good, s.qty, s.cost = g, qty, cost
                incoming[dest, g] += qty
            fcost, got = mk.buy_cost(here, FUEL, fuel_need[here, dest])
            mk.stock[here, FUEL] -= got
            owner.cash -= fcost
            flows["fuel"] += fcost
            if g is None:
                empty_inbound[dest] += 1
            s.dest, s.eta = dest, max(1, int(hours[here, dest]))

        # 5. Companies with spare cash buy another ship.
        for c in companies:
            if (len(c.ships) < rules["company"]["max_ships"] and c.active(hour)
                    and c.cash > sh["price"] + RESERVE[c.profile]):
                c.cash -= sh["price"]
                flows["ships"] += sh["price"]
                s = Ship(c.id, c.ships[0].port if c.ships else rng.randrange(n))
                c.ships.append(s)
                ships.append(s)

        # 6. Daily metrics.
        if hour % 24 == 23:
            cash = np.array([c.cash for c in companies])
            worth = np.array([c.cash + 0.5 * sh["price"] * len(c.ships)
                              + sum(x.cost for x in c.ships) for c in companies])
            top = np.sort(worth)[::-1]
            k = max(1, len(top) // 100)
            positive = worth.clip(min=0)
            prodmask = prod > 0
            consmask = cons > 0
            rows.append({
                "day": hour // 24 + 1,
                "money_supply": round(float(cash.sum())),
                "median_networth": round(float(np.median(worth))),
                "top1pct_share": round(float(positive[np.argsort(-worth)[:k]].sum() / positive.sum()), 4),
                "bankrupt_share": round(float((cash < -2000).mean()), 4),
                "ships": len(ships),
                "grain_price_at_producers": round(float(true_p[prodmask[:, 0], 0].mean()), 2),
                "grain_price_at_consumers": round(float(true_p[consmask[:, 0], 0].mean()), 2),
                "fuel_price_at_producers": round(float(true_p[prodmask[:, 1], 1].mean()), 2),
                "fuel_price_at_consumers": round(float(true_p[consmask[:, 1], 1].mean()), 2),
                "trades": trades,
                "avg_margin": round(profit_sum / revenue_sum, 4) if revenue_sum else 0,
                **{f"flow_{k_}": round(v) for k_, v in flows.items()},
            })
            flows = dict.fromkeys(flows, 0.0)
            trades, profit_sum, revenue_sum = 0, 0.0, 0.0
    if return_companies:
        return rows, companies
    return rows


def health(rows, rules):
    hc = rules["health_checks"]
    start = rows[6]["money_supply"]          # after the first week settles
    end = rows[-1]["money_supply"]
    days = len(rows) - 7
    growth = (end / start) ** (1 / days) - 1 if start > 0 and end > 0 else float("nan")
    top1 = rows[-1]["top1pct_share"]
    bankrupt = rows[-1]["bankrupt_share"]
    return {
        "money_growth_per_day": round(growth, 4),
        "top1pct_share_end": top1,
        "bankrupt_share_end": bankrupt,
        "money_ok": growth <= hc["max_money_supply_growth_per_day"],
        "concentration_ok": top1 <= hc["max_top1pct_networth_share"],
        "bankruptcy_ok": bankrupt <= hc["max_bankrupt_share"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, default=10)
    ap.add_argument("--companies", type=int, default=300)
    ap.add_argument("--out", default="results")
    ap.add_argument("--mix", default="greedy=0.4,lagged=0.4,casual=0.2",
                    help="share of each bot type: greedy (live prices), lagged (prices a day old), casual (logs in twice a day)")
    ap.add_argument("--set", action="append", default=[], metavar="PATH=VALUE",
                    help="override a rule for this run, e.g. --set ship.fuel_per_100_distance=3")
    args = ap.parse_args()

    rules, world, dist, prod, cons = load_world()
    for item in args.set:
        path, value = item.split("=", 1)
        node = rules
        *parents, leaf = path.split(".")
        for key in parents:
            node = node[key]
        node[leaf] = json.loads(value)
    if args.set:
        # Market rates feed the production arrays, so rebuild them after overrides.
        m = rules["markets"]
        for p in world["ports"]:
            for g, good in enumerate(GOODS):
                prod[p["id"], g] = m["production_per_hour"][good] if good in p["produces"] else 0
                cons[p["id"], g] = m["consumption_per_hour"][good] if good in p["consumes"] else 0
    out = ROOT / args.out
    out.mkdir(exist_ok=True)
    summary = []
    for season in range(1, args.seasons + 1):
        mix = [(k, float(v)) for k, v in (x.split("=") for x in args.mix.split(","))]
        rows = run_season(season, args.companies, rules, world, dist, prod, cons, profiles=mix)
        with open(out / f"season_{season}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        h = health(rows, rules)
        h["season"] = season
        summary.append(h)
        print(f"season {season:2d}: money/day {h['money_growth_per_day']:+.2%}  "
              f"top1% {h['top1pct_share_end']:.1%}  bankrupt {h['bankrupt_share_end']:.1%}  "
              f"ships {rows[-1]['ships']}")
    (out / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
