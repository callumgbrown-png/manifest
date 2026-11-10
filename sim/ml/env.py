"""Gymnasium environment over the bridge: control the first learner company.

The default world has 30 bots and six learner companies. Phase 0 controls only
the first learner; the remaining learner companies idle until multi-agent support.

A step is one decision for one docked ship; the env plays game hours between check-ins (semi-Markov: decisions are
sparse). Candidate actions come from the engine's own quotes, so Python never prices anything itself.
Phase 0 scope: sail trips (buy + sail), carry cargo on, sail empty, sell here, wait. Orders and ship purchases arrive in Phase 2.
"""
from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .bridge_client import Bridge

GLOBAL_FEATURES = 8
LEARNING_GLOBAL_FEATURES = GLOBAL_FEATURES + 3 + 6
CAND_FEATURES = 6
ACTION_KINDS = ("wait", "trade", "carry", "empty", "sell", "buyShip", "scrapShip", "placeOrder", "placeSell", "buyFromOrder", "cancelOrder", "raid")
EXTENDED_FEATURES = CAND_FEATURES + len(ACTION_KINDS) + 3 + 3 + 2


class ManifestEnv(gym.Env):
    metadata: dict[str, Any] = {"render_modes": []}

    def __init__(self, n_bots: int = 30, n_learners: int = 6, difficulty: str = "normal", checkin_hours: int = 4,
                 k: int = 16, expected_companies: int = 60, map_seed: int | str | None = None,
                 rules_overrides: dict | None = None, bridge: Bridge | None = None, extended_actions: bool = False) -> None:
        super().__init__()
        self.cfg = dict(n_bots=n_bots, n_learners=n_learners, difficulty=difficulty,
                        expected_companies=expected_companies, map_seed=map_seed, rules_overrides=rules_overrides)
        self.checkin_hours, self.k = checkin_hours, k
        if checkin_hours < 1 or k < 2:
            raise ValueError("checkin_hours must be positive and k must be at least two")
        self.extended_actions = extended_actions
        self.candidate_features = EXTENDED_FEATURES if extended_actions else CAND_FEATURES
        self.bridge = bridge or Bridge()
        self._owns_bridge = bridge is None
        self.action_space = spaces.Discrete(k)
        global_size = LEARNING_GLOBAL_FEATURES if extended_actions else GLOBAL_FEATURES
        self.observation_space = spaces.Box(-10.0, 10.0, (global_size + k * self.candidate_features,), np.float32)
        self.company = -1
        self.start_worth = 1.0
        self._exclude: list[int] = []
        self._cands: list[dict] = []
        self._ship: dict | None = None
        self._obs_raw: dict = {}
        self._worth = 0.0
        self._last_seed = 0

    # ------------------------------------------------------------------ gym API

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._last_seed = seed
        world = self.bridge.call("reset", seed=self._last_seed, **self.cfg)
        self.company = world["learners"][0]
        self.start_worth = world["startWorth"]
        self.season_hours = world["seasonHours"]
        self._exclude = []
        self._decide(advance=True)
        self._worth = self._obs_raw["worth"]
        return self._obs(), self._info()

    def step(self, action: int):
        if self._done:
            raise RuntimeError("reset the environment after termination")
        before_tick = self._obs_raw["tick"]
        illegal = not (0 <= int(action) < len(self._cands))
        cand = self._cands[0] if illegal else self._cands[int(action)]
        rejected = None
        if cand["kind"] == "wait" or cand["cmd"] is None:
            self._exclude.append(self._ship["id"])
        else:
            res = self.bridge.call("step", commands=[cand["cmd"]], hours=0)["results"][0]
            if not res["ok"]:
                rejected = res["error"]
                self._exclude.append(self._ship["id"])
            elif cand["kind"] != "sell":
                self._exclude.append(self._ship["id"])
        self._decide(advance=True)
        worth = self._obs_raw["worth"]
        reward = (worth - self._worth) / self.start_worth
        self._worth = worth
        terminated = self._done
        info = self._info()
        info.update(illegal=illegal, rejected=rejected)
        info["elapsed_hours"] = self._obs_raw["tick"] - before_tick
        return self._obs(), float(reward), terminated, False, info

    def close(self) -> None:
        if self._owns_bridge:
            self.bridge.close()

    # ------------------------------------------------------------------ helpers

    def digest(self) -> dict[str, Any]:
        return self.bridge.call("digest")

    def dump_log(self, path: str) -> dict[str, Any]:
        return self.bridge.call("dump_log", path=path)

    def final_worth(self) -> float:
        return self.bridge.call("observe", company=self.company)["worth"]

    def _decide(self, advance: bool) -> None:
        r = self.bridge.call("decide", company=self.company, exclude=self._exclude, advance=advance,
                             checkin=self.checkin_hours, k=self.k, extended=self.extended_actions)
        if r["advanced"] > 0:
            self._exclude = []
        self._done = bool(r["done"])
        self._obs_raw = r["obs"]
        self._ship = r.get("ship")
        self._cands = r.get("candidates", [])

    def _mask(self) -> np.ndarray:
        mask = np.zeros(self.k, dtype=bool)
        mask[:len(self._cands)] = True
        if self._done and not len(self._cands):
            mask[0] = True   # keep one valid action at the terminal state
        return mask

    def _info(self) -> dict[str, Any]:
        return {"action_mask": self._mask(), "candidates": self._cands, "tick": self._obs_raw.get("tick", 0),
                "worth": self._obs_raw.get("worth", 0.0), "company": self.company}

    def _obs(self) -> np.ndarray:
        return build_obs(self._obs_raw, self._ship, self._cands, self.start_worth, self.k, self.extended_actions)


def build_obs(o: dict, ship: dict | None, cands: list, start_worth: float, k: int, extended: bool,
              persona: np.ndarray | None = None) -> np.ndarray:
    """Observation vector from a bridge `decide` reply. A None candidate is a hidden option (all zeros).
    With `persona`, its vector is appended at the end (the layout persona-conditioned policies expect)."""
    sw = start_worth
    cap = (ship or {}).get("capacity", 100) or 100
    g = [o["tick"] / o["seasonHours"], o["cash"] / sw, o["worth"] / sw, o["rank"] / max(1, o["companies"]),
         len(o["ships"]) / 5, o["notoriety"] / 100, float(o["lockedOutHours"] > 0), cap / 100]
    if extended:
        g += [float(o["difficulty"] == level) for level in ("easy", "normal", "hard")]
        remaining = [max(0, s["arriveTick"] - o["tick"]) for s in o["ships"] if s["dest"] is not None]
        g += [sum(s["dest"] is None for s in o["ships"]) / 5, len(remaining) / 5,
              sum(s["cost"] for s in o["ships"]) / sw,
              min(remaining, default=0) / 48, max(remaining, default=0) / 48, o["dailyUpkeep"] / sw]
    c = np.zeros((k, EXTENDED_FEATURES if extended else CAND_FEATURES), dtype=np.float32)
    for i, cand in enumerate(cands[:k]):
        if cand is None:
            continue
        c[i, :CAND_FEATURES] = [1.0, cand.get("profit", 0.0) / 1000, cand.get("hours", 0) / 48, cand.get("qty", 0) / cap,
                cand.get("fuelCost", 0.0) / 1000, cand.get("cost", 0.0) / 10000]
        if extended:
            c[i, CAND_FEATURES + ACTION_KINDS.index(cand["kind"])] = 1
            c[i, 18:21] = [cand.get("opportunity", 0) / 100, cand.get("score", 0) / 100,
                          cand.get("capacity", cap) / 100]
            c[i, 21:24] = [cand.get("planner_rank", 0), np.arcsinh(cand.get("planner_score", 0)) / 10,
                          float(cand.get("planner_eligible", False))]
            c[i, 24:] = [cand.get("market_drift", 0), cand.get("inbound_pressure", 0)]
    parts = [np.array(g, dtype=np.float32), c.ravel()]
    if persona is not None:
        parts.append(np.asarray(persona, dtype=np.float32))
    return np.clip(np.concatenate(parts), -10, 10)
