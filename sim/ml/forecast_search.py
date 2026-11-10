"""Fit six forecast-head weights to paired full-season training returns.

This is an explicit low-dimensional policy-search alternative, not PPO.
Validation and final-test seeds are never used to choose these weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
from pathlib import Path

import numpy as np
import torch
import yaml

from .policy import load_policy, seed_everything
from .rollout import collect
from .run import git_commit, source_metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("--out", type=Path, default=Path("sim/ml/runs/phase2-forecast"))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(cfg["seed"])
    model = load_policy(args.checkpoint)
    history = {"method": "coordinate search over a frozen neural policy's public-forecast head",
               "config": cfg, "git": git_commit(), **source_metadata(), "workers": args.workers,
               "initial_checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(), "trials": []}
    cache = {}
    selected = {}
    with mp.get_context("spawn").Pool(args.workers) as pool:
        for level, difficulty in enumerate(cfg["difficulties"]):
            current = [0.0, 0.0]
            for coordinate, values in enumerate((cfg["drift_weights"], cfg["inbound_weights"])):
                choices = []
                for value in values:
                    candidate = current.copy()
                    candidate[coordinate] = float(value)
                    key = (difficulty, *candidate)
                    if key not in cache:
                        state = {k: v.detach().clone() for k, v in model.state_dict().items()}
                        state["forecast_weights"][level] = torch.tensor(candidate)
                        tasks = [dict(seed=s, difficulty=difficulty, map_seed=f"forecast-train-{s}", state=state,
                                      architecture=model.architecture, hidden=model.hidden,
                                      deterministic=True, evaluation=True) for s in cfg["forecast_train_seeds"]]
                        rows = pool.map(collect, tasks)
                        if any(r["illegal"] or r["rejected"] for r in rows):
                            raise RuntimeError("forecast search produced illegal/rejected actions")
                        cache[key] = rows
                        history["trials"].append({"difficulty": difficulty, "weights": candidate,
                                                  "outcomes": rows, "median": float(np.median([r["worth"] for r in rows]))})
                        (args.out / "search.json").write_text(json.dumps(history, indent=2, allow_nan=False), encoding="utf-8")
                    choices.append((float(np.median([r["worth"] for r in cache[key]])), candidate))
                # Tie-break toward the zero/smaller correction, not arbitrary grid order.
                _, current = max(choices, key=lambda pair: (pair[0], -sum(abs(v) for v in pair[1])))
                print(json.dumps({"difficulty": difficulty, "coordinate": coordinate, "weights": current,
                                  "training_median": max(x[0] for x in choices)}), flush=True)
            with torch.no_grad():
                model.forecast_weights[level].copy_(torch.tensor(current))
            selected[difficulty] = current
    history["selected_weights"] = selected
    (args.out / "search.json").write_text(json.dumps(history, indent=2, allow_nan=False), encoding="utf-8")
    model.save(args.out / "best.pt", config=cfg, method="forecast_head_search")
    print(f"Saved trained forecast head to {args.out / 'best.pt'}", flush=True)


if __name__ == "__main__":
    main()
