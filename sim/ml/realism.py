"""How much do simulated players look like the (estimated) target population? A realism check for the training loop.

    realism_metrics(players, target="recruited")

`players` are eval player dicts as league.run_league returns them (or rows read back from a cycle's players.csv). Each is
turned into the per-player session statistics of realdata/stats.py, then compared with data/estimated/<target>/players.jsonl
using realdata/likeness.py (per-feature Wasserstein distance scaled by the target spread; cross-validated discriminator AUC).

Feature mapping (a sim "session" is one check-in visit, as in stats.py):
- sessions_per_day   = visits / days observed (the season; sim players start at hour 0)
- trips_per_session  = kinds["trade"] / visits (a trade is a sail that loads cargo, the stats.py "trip"); needs `kinds`
- days_to_first_buy  = first_buy_tick / 24, censored at the days observed when the player never bought a ship
- quit               = churned (quit_tick set) at least `quit_days` before the season ended (stats.py: no session in the
                       last quit_days days). A player who stayed but went silent is not visible here and counts as active.
- active_day_fraction: UNAVAILABLE (needs the tick of every visit; the player dicts only carry counts).
A feature is used only when every simulated player has what it needs; the rest are listed in `features_missing`.

Honesty rule: the target is a literature-derived ESTIMATE, not measured Manifest players. The score is therefore an
`estimated_score` (and `fixture_score`), and `human_likeness` is always None here.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from .realdata.likeness import discriminator_auc, wasserstein1
from .realdata.stats import FEATURES

ESTIMATED_DIR = Path(__file__).resolve().parents[2] / "data" / "estimated"
SEASON_HOURS = 1344          # rules.season.days (56) * 24; also the estimated populations' ticks_observed
UNAVAILABLE = {"active_day_fraction": "needs the tick of every visit; eval player dicts only carry visit counts"}


def _num(v: Any) -> float | None:
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    return float(v)


def _kinds(p: dict[str, Any]) -> dict[str, Any] | None:
    k = p.get("kinds")
    if isinstance(k, str):
        k = json.loads(k) if k.strip() else None
    return k if isinstance(k, dict) else None


def player_features(p: dict[str, Any], season_hours: int = SEASON_HOURS, quit_days: float = 3.0) -> dict[str, float | None]:
    """One simulated player as stats.py session statistics (None where the dict lacks the data)."""
    days = max(1.0, season_hours / 24)
    visits = _num(p.get("visits"))
    quit_tick, first_buy = _num(p.get("quit_tick")), _num(p.get("first_buy_tick"))
    kinds = _kinds(p)
    out: dict[str, float | None] = {f: None for f in FEATURES}
    if visits is not None:
        out["sessions_per_day"] = visits / days
        if kinds is not None:
            out["trips_per_session"] = float(kinds.get("trade", 0)) / max(1.0, visits)
    out["days_to_first_buy"] = first_buy / 24 if first_buy is not None else days
    out["quit"] = float(quit_tick is not None and season_hours - quit_tick >= quit_days * 24)
    return out


@lru_cache(maxsize=4)
def load_target(target: str) -> tuple[tuple[dict[str, Any], ...], dict[str, Any]]:
    folder = ESTIMATED_DIR / target
    rows = tuple(json.loads(line) for line in (folder / "players.jsonl").read_text(encoding="utf-8").splitlines() if line.strip())
    return rows, json.loads((folder / "meta.json").read_text(encoding="utf-8"))


def realism_metrics(players: list[dict[str, Any]], target: str = "recruited", season_hours: int = SEASON_HOURS,
                    seed: int = 0) -> dict[str, Any]:
    """Distance and discriminator AUC between `players` and the estimated `target` population ("recruited" or "organic")."""
    observed, meta = load_target(target)
    sim = [player_features(p, season_hours, meta.get("quit_days", 3.0)) for p in players]
    used = [f for f in FEATURES if f not in UNAVAILABLE and sim and all(s[f] is not None for s in sim)
            and all(f in o for o in observed)]
    missing = {f: UNAVAILABLE.get(f, "not derivable from these player dicts") for f in FEATURES if f not in used}
    per: dict[str, float] = {}
    for f in used:
        o = np.array([float(r[f]) for r in observed])
        s = np.array([float(r[f]) for r in sim])
        per[f] = wasserstein1(o, s) / max(float(o.std()), 1e-3)
    d = float(np.mean(list(per.values()))) if per else None    # None, not NaN: reports are written with allow_nan=False
    # likeness.discriminator_auc reads every FEATURE; unused ones are set to the same constant on both sides, which the
    # standardisation turns into an all-zero column, so they carry no information and the AUC is over `used` only.
    pad = lambda row: {f: (float(row[f]) if f in used else 0.0) for f in FEATURES}
    disc = discriminator_auc([pad(r) for r in observed], [pad(r) for r in sim], seed=seed) if used else None
    score = math.exp(-d) if per else None
    return {"target": target, "source": "estimated", "synthetic_note": meta.get("synthetic_note"),
            "per_feature": per, "distance": d, "auc": disc["auc"] if disc else None,
            "estimated_score": score, "fixture_score": score, "human_likeness": None,
            "n_sim": len(sim), "n_target": len(observed), "features_used": used,
            "features_missing": sorted(missing), "missing_reasons": missing, "estimated_only": True}
