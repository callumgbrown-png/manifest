"""What a human-like persona perceives and does (plan section 5.5), between the bridge's exact candidates and the policy.

- Price misjudgement: perceived profit is shifted by a belief error on the sale price that drifts every 12 game hours
  (same idea as misjudge() in bots.ts). The command sent to the engine is never altered.
- Limited attention: only some voyage options are noticed; the noticing is noisy and favours options that look good.
- Information use: sometimes the planning hints (which use public inbound-cargo information) are ignored.
- Goods preference: a persona with a goods list does not notice cargo trades in other goods.
- Mistakes: with probability mistake_rate the player does something other than its preferred option.
The optimal flavour skips all of it.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

from .personas.persona import Persona

VOYAGE = ("trade", "carry", "empty")
PLANNER_KEYS = ("planner_rank", "planner_score", "planner_eligible")


def belief(seed: int, tick: int, company: int, dest: int, good: int) -> float:
    """Repeatable value in [-1, 1) that changes every 12 game hours, per company, port and good."""
    key = [seed & 0x7FFFFFFF, (tick // 12) & 0x7FFFFFFF, company & 0x7FFFFFFF, dest & 0x7FFFFFFF, (good + 1) & 0x7FFFFFFF]
    return float(np.random.default_rng(key).uniform(-1, 1))


def likes(p: Persona, c: dict[str, Any]) -> bool:
    """False for a cargo trade in a good outside the persona's goods list (e.g. a grain-only hauler ignores ore)."""
    return p.goods is None or c["kind"] != "trade" or c["cmd"]["buy"]["good"] in p.goods


def perceive(p: Persona, cands: list[dict[str, Any]], seed: int, tick: int, company: int,
             rng: np.random.Generator) -> tuple[list[dict[str, Any] | None], np.ndarray]:
    """Return (seen, mask): seen[i] is a perturbed copy of candidate i or None if not noticed; mask marks the noticed ones."""
    seen: list[dict[str, Any] | None] = []
    voyages = [i for i, c in enumerate(cands) if c["kind"] in VOYAGE and likes(p, c)]
    for c in cands:
        s = dict(c)
        if c["kind"] in VOYAGE and p.price_error:
            good = c.get("good")
            u = belief(seed, tick, company, c.get("dest", -1) if c.get("dest") is not None else -1, -1 if good is None else int(good))
            gross = max(0.0, c.get("profit", 0.0) + c.get("cost", 0.0) + c.get("fuelCost", 0.0))
            shift = p.price_error * u * gross
            s["profit"] = c.get("profit", 0.0) + shift
            s["score"] = c.get("score", 0.0) + shift / (c.get("hours", 1) + 6)
            s["planner_score"] = c.get("planner_score", 0.0) + shift / (c.get("hours", 1) + 6)
        seen.append(s)
    keep = {i for i, c in enumerate(cands) if c["kind"] not in VOYAGE}   # a trade in a good the persona doesn't deal in is not even noticed
    if voyages:
        shown = len(voyages) if p.attention >= 1 else max(2, math.ceil(p.attention * len(voyages)))
        noise = {i: float(rng.normal()) * (1 - p.attention) * 40 for i in voyages}
        ranked = sorted(voyages, key=lambda i: (-(seen[i].get("score", 0.0) + noise[i]), i))
        keep |= set(ranked[:shown])
    out: list[dict[str, Any] | None] = [seen[i] if i in keep else None for i in range(len(cands))]
    if p.info_use < 1 and rng.random() > p.info_use:
        for c in out:
            if c is not None and c["kind"] in VOYAGE:
                for key in PLANNER_KEYS:
                    c[key] = 0
    else:
        # The rank hint is relative to what the player can see.
        for kind in ("trade", "empty"):
            group = [c for c in out if c is not None and c["kind"] == kind and c.get("planner_eligible")]
            group.sort(key=lambda c: -c.get("planner_score", 0.0))
            for j, c in enumerate(group):
                c["planner_rank"] = 1 - j / len(group)
    mask = np.array([c is not None for c in out], dtype=bool)
    return out, mask


def pick_mistake(p: Persona, mask: np.ndarray, kinds: list[str], rng: np.random.Generator) -> int | None:
    """With probability mistake_rate, a uniformly random visible voyage/sell option instead of the policy's choice."""
    if p.mistake_rate <= 0 or rng.random() >= p.mistake_rate:
        return None
    options = [i for i, k in enumerate(kinds) if mask[i] and k in VOYAGE + ("sell",)]
    return int(rng.choice(options)) if options else None
