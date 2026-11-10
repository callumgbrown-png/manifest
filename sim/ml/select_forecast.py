"""Select among training leaders using validation only; never final test seeds."""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
from pathlib import Path

import numpy as np
import torch
import yaml

from .evaluate import scripted
from .policy import load_policy, seed_everything
from .rollout import collect
from .run import git_commit, source_metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    search = json.loads((args.run / "search.json").read_text())
    seed_everything(cfg["seed"])
    model = load_policy(args.run / "best.pt")
    selected = {}
    records = []
    with mp.get_context("spawn").Pool(args.workers) as pool:
        for difficulty in cfg["difficulties"]:
            level = ("easy", "normal", "hard").index(difficulty)
            trials = sorted((r for r in search["trials"] if r["difficulty"] == difficulty),
                            key=lambda r: (-r["median"], sum(abs(v) for v in r["weights"])))
            # Predeclared small selection set: two training leaders plus control.
            choices = []
            for weights in [r["weights"] for r in trials[:2]] + [[0.0, 0.0]]:
                if weights not in choices:
                    choices.append(weights)
            baseline = pool.map(scripted, [dict(agent="plan", seed=s, difficulty=difficulty, map_seed=f"validation-{s}")
                                            for s in cfg["validation_seeds"]])
            baseline_median = float(np.median([r["worth"] for r in baseline]))
            evaluations = []
            for weights in choices:
                state = {k: v.detach().clone() for k, v in model.state_dict().items()}
                state["forecast_weights"][level] = torch.tensor(weights)
                rows = pool.map(collect, [dict(seed=s, difficulty=difficulty, map_seed=f"validation-{s}", state=state,
                                               architecture=model.architecture, hidden=model.hidden,
                                               deterministic=True, evaluation=True) for s in cfg["validation_seeds"]])
                if any(r["illegal"] or r["rejected"] for r in rows):
                    raise RuntimeError("validation produced illegal/rejected actions")
                evaluations.append(dict(weights=weights, median=float(np.median([r["worth"] for r in rows])), outcomes=rows))
            winner = max(evaluations, key=lambda r: (r["median"], -sum(abs(v) for v in r["weights"])))
            with torch.no_grad():
                model.forecast_weights[level].copy_(torch.tensor(winner["weights"]))
            selected[difficulty] = winner["weights"]
            record = dict(difficulty=difficulty, baseline_median=baseline_median,
                          selected_median=winner["median"], improved=winner["median"] > baseline_median,
                          candidates=evaluations, baseline=baseline)
            records.append(record)
            print(json.dumps({k: v for k, v in record.items() if k not in ("candidates", "baseline")}), flush=True)
    result = dict(validation_gate_passed=all(r["improved"] for r in records), selected_weights=selected,
                  comparisons=records, config=cfg, git=git_commit(), **source_metadata())
    (args.run / "selection.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    model.save(args.run / "selected.pt", config=cfg, method="validation_selected_forecast_head")
    print(f"Validation gate passed: {result['validation_gate_passed']}", flush=True)


if __name__ == "__main__":
    main()
