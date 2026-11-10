"""League seasons: several learner companies share one world with the bots. Each slot is driven by

- a persona-conditioned policy ("policy"; model "current", or "frozen" = an older checkpoint as opponent), or
- a scripted persona ("scripted", the Phase 1 `play` strategies).

A policy slot is either "human" (the persona's check-in schedule, imperfect perception, mistakes, churn) or "optimal"
(a check-in every game hour, perfect perception, greedy actions, never quits: the skill ceiling). Policy slots with
`train: true` return rows for PPO in the same tuple layout as rollout.collect. One Node process per season.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from .bridge_client import Bridge
from .env import build_obs
from .imperfection import VOYAGE, perceive, pick_mistake
from .persona_policy import PersonaPolicy
from .personas.churn import Frustration
from .personas.mood import LOSS_AVERSION, MOODS, Mood, summarise
from .personas.persona import GOODS, Persona, load_personas
from .personas.schedule import checkin_ticks
from .policy import CandidatePolicy, seed_everything
from .reward import profit_reward, shaping

K = 32
H24, H48, H168 = 1, 2, 7
DIFFICULTIES = ("easy", "normal", "hard")


def make_model(task: dict[str, Any], key: str = "state") -> PersonaPolicy:
    model = PersonaPolicy(CandidatePolicy(K, task.get("hidden", 64), task.get("architecture", "legacy")))
    model.load_state_dict(task[key])
    model.eval()
    return model


class Slot:
    """One learner company: its persona, controller and the bookkeeping for rewards, rows, churn and fingerprints."""

    def __init__(self, idx: int, company: int, spec: dict[str, Any], persona: Persona, start_worth: float, worth: float) -> None:
        self.idx, self.company, self.spec, self.p = idx, company, spec, persona
        self.control = spec.get("control", "policy")
        self.flavour = spec.get("flavour", "human")
        self.train = bool(spec.get("train")) and self.control == "policy" and spec.get("model", "current") == "current"
        self.vec = persona.vector()
        self.start = start_worth
        self.R, self.last_worth = 0.0, worth
        self.rows: list[dict[str, Any]] = []
        self.last_notice, self.last_forced, self.last_rank = 0, 0, None
        self.last_visit, self.last_trip = 0, 0
        self.quit_tick: int | None = None
        self.quit_events: list[str] = []
        self.churn = Frustration(persona, start_worth, worth) if self.flavour == "human" and persona.churn and self.control == "policy" else None
        self.mood = Mood(persona) if self.flavour == "human" and persona.emotionality > 0 and self.control == "policy" else None
        self.mood_peak = dict.fromkeys(MOODS, 0.0)
        self.mood_rows: list[tuple[dict[str, float], str, bool]] = []
        self.sold = 0.0               # margin realised by sales in the last visit (cargo sells inside a visit, never between visits)
        self.kinds: Counter[str] = Counter()
        self.goods = [0, 0, 0, 0]
        self.voyage_hours = 0.0
        self.visits = self.mistakes = self.rejected = self.raided = self.arrested = self.bought = 0
        self.first_buy: int | None = None
        self.raid_results: Counter[str] = Counter()

    def measure(self, worth: float) -> None:
        self.R += profit_reward(self.p, worth - self.last_worth, self.start)
        self.last_worth = worth

    def finish_rows(self, end_tick: int) -> list[tuple]:
        out = []
        for j, r in enumerate(self.rows):
            last = j + 1 == len(self.rows)
            nxt_r = self.R if last else self.rows[j + 1]["R0"]
            hours = end_tick - r["tick"] if last else self.rows[j + 1]["tick"] - r["tick"]
            out.append((r["obs"], r["mask"], r["action"], nxt_r - r["R0"], r["logp"], r["value"], hours, last))
        return out


def run_league(task: dict[str, Any]) -> dict[str, Any]:
    """task: {seed, difficulty, map_seed?, slots: [spec], state?, frozen_state?, explore?, n_bots, expected_companies, replay_path?}
    spec: {persona, control: policy|scripted, flavour: human|optimal, model: current|frozen, train: bool}"""
    seed, diff = int(task["seed"]), task["difficulty"]
    seed_everything(seed)
    library = load_personas(task.get("personas_path"))
    rng = np.random.default_rng([seed, DIFFICULTIES.index(diff) if diff in DIFFICULTIES else 9, 77])
    personas = [library[s["persona"]].sampled(rng) if s.get("flavour", "human") == "human" else library[s["persona"]]
                for s in task["slots"]]
    models = {"current": make_model(task) if task.get("state") is not None else None,
              "frozen": make_model(task, "frozen_state") if task.get("frozen_state") is not None else None}
    if models["frozen"] is None:
        models["frozen"] = models["current"]

    with Bridge() as br:
        world = br.call("reset", seed=seed, difficulty=diff, n_bots=task.get("n_bots", 30), n_learners=len(personas),
                        expected_companies=task.get("expected_companies", 60), map_seed=task.get("map_seed"),
                        rules_overrides=task.get("rules_overrides"))
        hours, start = world["seasonHours"], world["startWorth"]
        slots = []
        for i, (spec, p) in enumerate(zip(task["slots"], personas)):
            slots.append(Slot(i, world["learners"][i], spec, p, start, br.call("observe", company=world["learners"][i])["worth"]))

        due: dict[int, list[int]] = {}
        for s in slots:
            if s.flavour == "optimal":
                ticks = list(range(0, hours))
            else:
                ticks = checkin_ticks(s.p, hours, rng, slot=s.idx)
            for t in ticks:
                due.setdefault(t, []).append(s.idx)
        stops = sorted(set(due) | set(range(24, hours + 1, 24)))
        money: list[dict[str, float]] = []

        def visit(s: Slot, t: int) -> None:
            if s.control == "scripted":
                res = br.call("play", company=s.company, params=s.p.play_params())
                s.visits += 1
                s.kinds["trade"] += res["trips"]
                s.kinds["empty"] += res["moves"]
                s.goods = [a + b for a, b in zip(s.goods, res["goods"])]
                s.bought += res["bought"]
                return
            p, model = s.p, models[s.spec.get("model", "current")]
            o = br.call("observe", company=s.company)
            days = min(3.0, max(1, t - s.last_visit) / 24)
            ev: Counter[str] = Counter()
            kinds = [n["kind"] for n in o["notices"] if n["id"] > s.last_notice]
            s.last_notice = max([s.last_notice] + [n["id"] for n in o["notices"]])
            ev["raided"] = sum(k in ("raided", "captured") for k in kinds)
            ev["arrested"] = sum(k in ("fined", "locked-out", "confiscated") for k in kinds)
            forced = max(0, o["forcedSales"] - s.last_forced)
            s.last_forced = o["forcedSales"]
            ev["forced_sale"] = forced
            s.raided += ev["raided"]
            s.arrested += ev["arrested"]
            if o["cash"] < p.near_broke_cash:
                ev["near_broke"] = days
            if t - s.last_trip > p.patience_hours:
                ev["idle_days"] = days
            if s.last_rank is not None:
                step = max(1, o["companies"] // 20)
                if o["rank"] > s.last_rank + step:
                    ev["rank_fall"] = 1
                elif o["rank"] < s.last_rank:
                    ev["rank_gain"] = min(1.0, (s.last_rank - o["rank"]) / step)
            s.last_rank = o["rank"]
            # What the player feels as "how did I do since I last played": the time away (upkeep, fees) plus what last visit's sales made.
            # Without the sales the change between visits is never positive (cargo is only sold during a visit), so moods saw only losses
            # and every traded good was remembered as a loser.
            gain = (o["worth"] - s.last_worth + s.sold) / s.start
            s.sold = 0.0
            if s.mood is not None:
                s.mood.fade(t)
                s.mood.reflect(gain)
                s.mood.feel({**ev, "big_loss": float(gain < -0.02 / LOSS_AVERSION), "profit": float(gain > 0.02), "near_broke": float(ev["near_broke"] > 0),
                             "arrested": ev["arrested"], "no_move": 0.0})
            s.measure(o["worth"])
            s.R += shaping(p, ev)
            s.visits += 1

            exclude: list[int] = []
            voyages = wins = bought = 0
            docked = False
            selling: tuple[str, float] | None = None   # (good, worth before) of a sale whose margin the next observation shows

            def settle(worth: float) -> None:
                s.sold += worth - selling[1]
                if s.mood is not None:     # learn from what the sale actually made, per good
                    s.mood.remember_trade(selling[0], (worth - selling[1]) / start)

            for _ in range(2 * p.session_length):
                r = br.call("decide", company=s.company, exclude=exclude, advance=False, checkin=1, k=K, extended=True)
                if not r["found"]:
                    break
                docked = True
                cands, ob, ship = r["candidates"], r["obs"], r["ship"]
                if selling is not None:
                    settle(ob["worth"])
                    selling = None
                if s.flavour == "optimal":
                    seen, mask = cands, np.ones(len(cands), dtype=bool)
                else:
                    seen, mask = perceive(s.mood.effective() if s.mood else p, cands, seed, t, s.company, rng)
                full = np.zeros(K, dtype=bool)
                full[:len(mask)] = mask
                if s.mood is not None:     # conscience and past experience take options out of view
                    full[:len(mask)] = s.mood.hold_back(cands, full[:len(mask)], rng)
                obs = build_obs(ob, ship, seen, start, K, True, s.vec)
                s.measure(ob["worth"])
                # Imperfection comes from perception, mistakes and schedules, not from sampling: only training explores.
                action, logp, value = model.act(obs, full, deterministic=not task.get("explore", False))
                kind_names = [c["kind"] for c in cands]
                slip = pick_mistake(s.mood.effective() if s.mood else p, full, kind_names, rng) if s.flavour == "human" else None
                if slip is None and s.mood is not None:
                    slip = s.mood.impulse(kind_names, full, rng, cands, ob["cash"])    # anger, fear or elation overrides the policy's choice
                if slip is None and s.train:
                    s.rows.append(dict(obs=obs, mask=full, action=action, logp=logp, value=value, tick=t, R0=s.R))
                if slip is not None:
                    s.mistakes += 1
                cand = cands[slip if slip is not None else action]
                if s.mood is not None:
                    s.mood_rows.append((s.mood.snapshot(), cand["kind"], slip is not None))
                s.kinds[cand["kind"]] += 1
                if cand["cmd"] is None:
                    exclude.append(ship["id"])
                    continue
                res = br.call("step", commands=[cand["cmd"]], hours=0)["results"][0]
                if not res["ok"]:
                    s.rejected += 1
                    exclude.append(ship["id"])
                    continue
                kind, ev = cand["kind"], Counter()
                if kind == "buyShip":
                    ev["new_ship"] = 1
                    bought += 1
                    s.first_buy = t if s.first_buy is None else s.first_buy
                elif kind == "trade":
                    share = cand.get("profit", 0.0) / start
                    ev["big_deal"] = float(share >= p.big_deal_profit)
                    ev["thin_margin"] = float(share < 0.005)
                    s.goods[GOODS.index(cand["cmd"]["buy"]["good"])] += 1
                elif kind == "sell" and ship.get("good") is not None:
                    selling = (GOODS[ship["good"]], ob["worth"])
                elif kind == "empty":
                    ev["empty_run"] = 1
                elif kind == "raid":
                    s.raid_results[res.get("outcome", "?")] += 1
                    wins += res.get("outcome") in ("won", "captured")
                    ev["raid_win"] = float(res.get("outcome") in ("won", "captured"))
                s.R += shaping(p, {k: v for k, v in ev.items() if v})
                if kind in VOYAGE:
                    voyages += 1
                    s.voyage_hours += cand.get("hours", 0)
                    if kind != "empty":
                        s.last_trip = t
                if kind != "sell":
                    exclude.append(ship["id"])
            if selling is not None:
                settle(br.call("observe", company=s.company)["worth"])
            if s.mood is not None:
                s.mood.feel({"new_ship": bought, "raid_win": wins, "no_move": float(docked and voyages == 0)})
                for m, v in s.mood.snapshot().items():
                    s.mood_peak[m] = max(s.mood_peak[m], v)
            if s.churn is not None:
                post = br.call("observe", company=s.company)
                hazard = s.churn.visit(t, dict(trips=voyages, noMove=docked and voyages == 0, newNotices=kinds, newForcedSales=forced,
                                               obs=post, bought=bought, raids=dict(won=wins)))
                s.last_visit = t
                if s.mood is not None:    # sulking and boredom make quitting likelier (at most 1.5x: the mood tips a decision, it isn't one)
                    hazard = min(1.0, hazard * (1 + min(0.5, p.emotionality * (0.8 * s.mood.anger + 0.5 * s.mood.boredom))))
                if rng.random() < hazard:
                    s.quit_tick, s.quit_events = t, list(s.churn.recent)
            s.last_visit = t

        cur = 0
        for t in stops:
            if t > cur:
                br.call("step", commands=[], hours=t - cur)
                cur = t
            if t % 24 == 0 and t > 0:
                m = br.call("metrics")["metrics"]
                money.append({"tick": t, "money": m["moneySupply"], "escrow": m["escrow"], "ships": m["ships"],
                              "in_debt": m["inDebt"], "price_index": m["priceIndex"]})
            for i in due.get(t, []):
                if slots[i].quit_tick is None and t < hours:
                    visit(slots[i], t)
        if cur < hours:
            br.call("step", commands=[], hours=hours - cur)
        summary = br.call("summary")
        digest = br.call("digest")["digest"]
        if task.get("replay_path"):
            br.call("dump_log", path=str(task["replay_path"]))

    players, episodes = [], []
    for s, L in zip(slots, summary["learners"]):
        s.measure(L["worth"])
        log = L["worthLog"]
        players.append(dict(
            seed=seed, difficulty=diff, slot=s.idx, persona=s.spec["persona"], control=s.control, flavour=s.flavour,
            model=s.spec.get("model", "current"), final_worth=L["worth"], worth_h24=log[H24] if len(log) > H24 else None,
            worth_h48=log[H48] if len(log) > H48 else None, worth_h168=log[H168] if len(log) > H168 else None,
            ships=L["ships"], visits=s.visits, quit_tick=s.quit_tick, quit_events=s.quit_events, mistakes=s.mistakes,
            impulses=s.mood.impulses if s.mood else 0, held_back=s.mood.held_back if s.mood else 0,
            lessons={g: round(v, 2) for g, v in s.mood.memory.items()} if s.mood else None, mood_peak=s.mood_peak if s.mood else None,
            mood_play=summarise(s.mood_rows) if s.mood else None,
            rejected=s.rejected, raided=s.raided, arrested=s.arrested, kinds=dict(s.kinds), goods=s.goods,
            voyage_hours=s.voyage_hours, first_buy_tick=s.first_buy, raids=dict(s.raid_results), decisions=sum(s.kinds.values())))
        if s.train and s.rows:
            episodes.append({"rows": s.finish_rows(hours), "worth": L["worth"], "persona": s.spec["persona"], "slot": s.idx})
    return dict(seed=seed, difficulty=diff, digest=digest, players=players, money=money, metrics=summary["metrics"],
                bot_worths=summary["botWorths"], start_worth=start, episodes=episodes, replay_file=task.get("replay_file"))
