"""Play one full season with scripted, persona-driven players against the bots. One Node process per season."""
from __future__ import annotations

from typing import Any

import numpy as np

from .bridge_client import Bridge
from .personas.churn import Frustration
from .personas.persona import Persona, load_personas
from .personas.schedule import checkin_ticks

H24, H48, H168 = 1, 2, 7   # worthLog indexes: one entry per game day, entry k = worth at hour 24*k


def run_season(task: dict[str, Any]) -> dict[str, Any]:
    """task: {seed, difficulty, players: {persona: count}, n_bots, expected_companies, rules_overrides?, personas_path?}"""
    seed, diff = int(task["seed"]), task["difficulty"]
    library = load_personas(task.get("personas_path"))
    rng = np.random.default_rng([seed, ["easy", "normal", "hard"].index(diff) if diff in ("easy", "normal", "hard") else 9])
    roster: list[Persona] = []
    for name, count in task["players"].items():
        roster += [library[name].sampled(rng) for _ in range(int(count))]

    with Bridge() as br:
        world = br.call("reset", seed=seed, difficulty=diff, n_bots=task["n_bots"], n_learners=len(roster),
                        expected_companies=task["expected_companies"], rules_overrides=task.get("rules_overrides"),
                        map_seed=task.get("map_seed"), maritime_enabled=task.get("maritime_enabled", True))
        ids, hours, start = world["learners"], world["seasonHours"], world["startWorth"]
        due: dict[int, list[int]] = {}
        for i, p in enumerate(roster):
            for t in checkin_ticks(p, hours, rng, slot=i):
                due.setdefault(t, []).append(i)
        days = list(range(24, hours + 1, 24))
        stops = sorted(set(due) | set(days))

        state = [Frustration(p, start, initial_worth=br.call("observe", company=ids[i])["worth"])
                 for i, p in enumerate(roster)]
        rec = [dict(visits=0, trips=0, moves=0, waits=0, empty_spent=0.0, no_move=0, bought=0, goods=[0, 0, 0, 0],
                    raids=dict(won=0, lost=0, captured=0, loot=0), raided=0, arrested=0, forced_sales=0,
                    quit_tick=None, quit_events=[], quit_p=[], first_raid_notice_tick=None) for _ in roster]
        money: list[dict[str, float]] = []
        cur = 0
        for t in stops:
            if t > cur:
                br.call("step", commands=[], hours=t - cur)
                cur = t
            if t % 24 == 0:
                m = br.call("metrics")["metrics"]
                money.append({"tick": t, "money": m["moneySupply"], "escrow": m["escrow"], "ships": m["ships"],
                              "in_debt": m["inDebt"], "price_index": m["priceIndex"]})
            for i in due.get(t, []):
                p, r = roster[i], rec[i]
                if r["quit_tick"] is not None:
                    continue
                res = br.call("play", company=ids[i], params=p.play_params())
                r["visits"] += 1
                for k in ("trips", "moves", "waits", "bought"):
                    r[k] += res[k]
                r["empty_spent"] += res["emptySpent"]
                r["no_move"] += bool(res["noMove"])
                r["goods"] = [a + b for a, b in zip(r["goods"], res["goods"])]
                for k in ("won", "lost", "captured", "loot"):
                    r["raids"][k] += res["raids"][k]
                r["raided"] += sum(n in ("raided", "captured") for n in res["newNotices"])
                if r["first_raid_notice_tick"] is None and any(n in ("raided", "captured") for n in res["newNotices"]):
                    r["first_raid_notice_tick"] = t
                r["arrested"] += sum(n in ("fined", "locked-out", "confiscated") for n in res["newNotices"])
                r["forced_sales"] += res["newForcedSales"]
                hazard = state[i].visit(t, res)
                if p.churn and rng.random() < hazard:
                    r["quit_tick"] = t
                    r["quit_events"] = list(state[i].recent)
                    r["quit_p"] = [round(hazard, 4)]
        if cur < hours:
            br.call("step", commands=[], hours=hours - cur)
        s = br.call("summary")
        digest = br.call("digest")["digest"]
        if task.get("replay_path"):
            br.call("dump_log", path=str(task["replay_path"]))

    players = []
    for i, p in enumerate(roster):
        L = s["learners"][i]
        log = L["worthLog"]
        players.append(dict(
            seed=seed, difficulty=diff, persona=p.name, slot=i, strat=p.strat, final_worth=L["worth"],
            worth_h24=log[H24] if len(log) > H24 else None, worth_h48=log[H48] if len(log) > H48 else None,
            worth_h168=log[H168] if len(log) > H168 else None, home=L["home"], ships=L["ships"],
            notoriety=L["notoriety"], **rec[i]))
    return dict(seed=seed, difficulty=diff, digest=digest, players=players, money=money, metrics=s["metrics"],
                bot_worths=s["botWorths"], learner_worths=[L["worth"] for L in s["learners"]], start_worth=start,
                start_net_worth=s["learners"][0]["worthLog"][0], replay_file=task.get("replay_file"), usage=s["usage"])
