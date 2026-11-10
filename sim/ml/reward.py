"""Persona reward (plan section 5.1): r = w_profit * d(net worth)/start worth + likes - dislikes.

Net worth, not cash, so holding cargo isn't punished. Each like/dislike is a count of events times its persona weight times
a small unit (a fraction of start worth), and every single term is capped so no weight can be farmed into a dominating
reward. Evaluation never uses this number: it uses net worth and quit rate.
"""
from __future__ import annotations

from typing import Mapping

from .personas.persona import Persona

UNIT = 0.08   # one weighted event is worth this share of start worth (was 0.02: persona rewards were too weak next to profit to change behaviour)
CAP = 0.20    # no single term may exceed this in either direction (was 0.05); the cap still stops any weight from being farmed

LIKES = {"new_ship": "w_new_ship", "big_deal": "w_big_deal", "raid_win": "w_raid_win", "rank_gain": "w_rank_gain"}
DISLIKES = {"raided": "w_raided", "arrested": "w_fine_lockout", "forced_sale": "w_forced_sale", "near_broke": "w_near_broke",
            "no_move": "w_no_move", "idle_days": "w_idle", "empty_run": "w_empty_run", "thin_margin": "w_thin_margin",
            "rank_fall": "w_rank_fall"}


def _term(count: float, weight: float) -> float:
    return max(-CAP, min(CAP, count * weight * UNIT))


def shaping(p: Persona, events: Mapping[str, float]) -> float:
    """Likes minus dislikes for a bundle of events, e.g. {"new_ship": 1, "raided": 2}. Unknown keys are an error."""
    total = 0.0
    for name, count in events.items():
        if name in LIKES:
            total += _term(count, getattr(p, LIKES[name]))
        elif name in DISLIKES:
            total -= _term(count, getattr(p, DISLIKES[name]))
        else:
            raise KeyError(f"unknown reward event {name!r}")
    return total


def profit_reward(p: Persona, worth_change: float, start_worth: float) -> float:
    return p.w_profit * worth_change / start_worth
