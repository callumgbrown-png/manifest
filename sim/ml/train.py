"""Manual, bounded CPU training. Continuous learning remains Phase 3b."""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import time
from pathlib import Path

import numpy as np
import torch
import yaml

from .agents.ppo import update
from .imitation import clone
from .policy import CandidatePolicy, load_policy, seed_everything
from .rollout import collect, monte_carlo_returns
from .evaluate import scripted
from .run import git_commit, source_metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--out", type=Path, default=Path("sim/ml/runs/phase2"))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--warm-start", type=Path)
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(cfg["seed"])
    model = load_policy(args.warm_start) if args.warm_start else CandidatePolicy()
    history = {"config": cfg, "git": git_commit(), **source_metadata(), "device": "cpu", "workers": args.workers,
               "torch_version": str(torch.__version__), "updates": []}
    started = time.perf_counter()
    with mp.get_context("spawn").Pool(args.workers) as pool:
        tasks = [dict(seed=s, difficulty=d, expert=True, map_seed=None if s % 3 == 0 else f"train-{s}")
                 for s in cfg["bc_seeds"] for d in cfg["difficulties"]]
        episodes = pool.map(collect, tasks)
        if any(e["illegal"] or e["rejected"] for e in episodes):
            raise RuntimeError("expert collection produced an illegal or rejected action")
        rows = [r for e in episodes for r in e["rows"]]
        returns = np.concatenate([monte_carlo_returns(ep["rows"], cfg["gamma"]) for ep in episodes])
        np.savez_compressed(args.out / "demonstrations.npz", observations=np.stack([r[0] for r in rows]),
                            masks=np.stack([r[1] for r in rows]), actions=np.asarray([r[2] for r in rows]), returns=returns)
        history["collection_seconds"] = time.perf_counter() - started
        history["imitation"] = clone(model, rows, cfg["bc_epochs"], cfg["seed"], returns=returns if cfg.get("prefit_value") else None)
        print(json.dumps({"imitation": history["imitation"], "collection_seconds": history["collection_seconds"]}), flush=True)
        model.save(args.out / "bc.pt", config=cfg)
        anchor_rows = rows[::4]
        anchor = (torch.as_tensor(np.stack([r[0] for r in anchor_rows])),
                  torch.as_tensor(np.stack([r[1] for r in anchor_rows])), torch.as_tensor([r[2] for r in anchor_rows]))
        del rows, episodes, anchor_rows
        optimizer = torch.optim.Adam(model.parameters(), lr=cfg["learning_rate"])
        best = -float("inf")
        reference = None
        if cfg.get("selection_reference"):
            baseline = pool.map(scripted, [dict(agent=cfg["selection_reference"], seed=s, difficulty=d, map_seed=f"validation-{s}")
                                          for s in cfg["validation_seeds"] for d in cfg["difficulties"]])
            history["validation_baseline"] = baseline
            reference = {d: float(np.median([r["worth"] for r in baseline if r["difficulty"] == d])) for d in cfg["difficulties"]}
        for iteration in range(cfg["ppo_updates"] + 1):
            state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            record = {"iteration": iteration}
            if iteration % cfg.get("validate_every", 1) == 0 or iteration == cfg["ppo_updates"]:
                validation = pool.map(collect, [dict(seed=s, difficulty=d, state=state, deterministic=True, evaluation=True,
                                                    architecture=model.architecture, hidden=model.hidden, map_seed=f"validation-{s}")
                                                 for s in cfg["validation_seeds"] for d in cfg["difficulties"]])
                median = float(np.median([r["worth"] for r in validation]))
                by_difficulty = {d: float(np.median([r["worth"] for r in validation if r["difficulty"] == d])) for d in cfg["difficulties"]}
                if reference is None:
                    reference = by_difficulty
                score = min(by_difficulty[d] / max(1, reference[d]) for d in cfg["difficulties"]) if cfg.get("balanced_selection") else median
                if any(r["illegal"] or r["rejected"] for r in validation):
                    raise RuntimeError("validation produced an illegal or rejected action")
                record.update(validation_median=median, validation_by_difficulty=by_difficulty, selection_score=score,
                              validation=[{k: v for k, v in r.items() if k != "rows"} for r in validation])
                if score > best:
                    best = score
                    model.save(args.out / "best.pt", config=cfg, selected_iteration=iteration)
            if iteration < cfg["ppo_updates"]:
                tasks = [dict(seed=1000 + iteration * args.workers + i, difficulty=cfg["difficulties"][i % 3],
                              state=state, architecture=model.architecture, hidden=model.hidden,
                              map_seed=None if i % 3 == 0 else f"ppo-{iteration}-{i}")
                         for i in range(args.workers)]
                episodes = pool.map(collect, tasks)
                if any(e["illegal"] or e["rejected"] for e in episodes):
                    raise RuntimeError("PPO collection produced an illegal or rejected action")
                record["ppo"] = update(model, episodes, optimizer, cfg["ppo_epochs"], cfg["gamma"], cfg["seed"] + iteration,
                                       anchor=anchor, anchor_weight=cfg.get("anchor_weight", 0.0))
                del episodes
            history["updates"].append(record)
            history["elapsed_seconds"] = time.perf_counter() - started
            (args.out / "training.json").write_text(json.dumps(history, indent=2, allow_nan=False), encoding="utf-8")
            model.save(args.out / "latest.pt", config=cfg)
            print(json.dumps({k: v for k, v in record.items() if k != "validation"}), flush=True)
    print(f"Saved best validation checkpoint to {args.out / 'best.pt'}", flush=True)


if __name__ == "__main__":
    main()
