"""Final held-out comparison against unprojected, fixed scripted strategies."""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
from pathlib import Path

import numpy as np
import yaml

from .bridge_client import Bridge
from .policy import load_policy, seed_everything
from .rollout import collect
from .run import git_commit, source_metadata

BASELINES = ("plan", "advice", "tripsOnly", "oldDefault", "newDefault", "pirate", "plan_growth")


def scripted(task: dict) -> dict:
    with Bridge() as br:
        w = br.call("reset", seed=task["seed"], map_seed=task["map_seed"], difficulty=task["difficulty"],
                    n_bots=30, n_learners=6, expected_companies=60)
        company = w["learners"][0]
        for tick in range(0, w["seasonHours"], 4):
            br.call("play", company=company, params=dict(strat="plan" if task["agent"] == "plan_growth" else task["agent"],
                                                        buy_ships=task["agent"] == "plan_growth"))
            br.call("step", commands=[], hours=min(4, w["seasonHours"] - tick))
        if task.get("replay_path"):
            br.call("dump_log", path=task["replay_path"])
        return {"agent": task["agent"], "seed": task["seed"], "difficulty": task["difficulty"],
                "worth": br.call("observe", company=company)["worth"], "digest": br.call("digest")["digest"]}


def worker(task: dict) -> dict:
    if task["agent"] != "learned":
        return scripted(task)
    result = collect(task)
    result.pop("rows")
    return {"agent": "learned", **result}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("--out", type=Path, default=Path("sim/ml/results/phase2-heldout"))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(cfg["seed"])
    model = load_policy(args.checkpoint)
    state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    tasks = [dict(agent=a, seed=s, difficulty=d, map_seed=f"heldout-{s}", state=state if a == "learned" else None,
                  architecture=model.architecture, hidden=model.hidden,
                  deterministic=True, evaluation=True,
                  replay_path=str((args.out / "replay" / f"{a}-{s}-{d}.json").resolve()))
             for s in cfg["heldout_seeds"] for d in cfg["difficulties"] for a in ("learned", *BASELINES)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(worker, tasks)
    rows = []
    for d in cfg["difficulties"]:
        medians = {a: float(np.median([r["worth"] for r in results if r["difficulty"] == d and r["agent"] == a]))
                   for a in ("learned", *BASELINES)}
        best = max(BASELINES, key=lambda a: medians[a])
        differences = [next(r["worth"] for r in results if r["agent"] == "learned" and r["difficulty"] == d and r["seed"] == s)
                       - next(r["worth"] for r in results if r["agent"] == best and r["difficulty"] == d and r["seed"] == s)
                       for s in cfg["heldout_seeds"]]
        rows.append(dict(difficulty=d, medians=medians, best_scripted=best,
                         median_gate=medians["learned"] > medians[best], paired_wins=sum(x > 0 for x in differences),
                         pairs=len(differences), paired_differences=differences))
    learned = [r for r in results if r["agent"] == "learned"]
    legal = all(r["illegal"] == 0 and r["rejected"] == 0 for r in learned)
    report = {"gate_passed": legal and all(r["median_gate"] for r in rows), "legal": legal, "comparisons": rows,
              "checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              "git": git_commit(), **source_metadata(), "config": cfg, "results": results,
              "limitations": [f"{len(cfg['heldout_seeds'])} paired seeds per difficulty; this gate is descriptive, not statistical proof.",
                              "One controlled learner, five idle learner companies, 30 active background bots.",
                              "All agents use full 56-day seasons, identical initial seeds/maps, and four-hour check-ins."]}
    (args.out / "evaluation.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    lines = ["# Phase 2 held-out evaluation", "", f"Gate passed: **{report['gate_passed']}**. No illegal/rejected learned actions: **{legal}**.", "",
             "| Difficulty | Learned median | Best scripted | Scripted median | Paired wins | Gate |", "|---|---:|---|---:|---:|---|"]
    for row in rows:
        lines.append(f"| {row['difficulty']} | {row['medians']['learned']:.2f} | {row['best_scripted']} | "
                     f"{row['medians'][row['best_scripted']]:.2f} | {row['paired_wins']}/{row['pairs']} | {row['median_gate']} |")
    lines += ["", *report["limitations"], "", "All episode command logs are saved under replay/. No game rules were changed."]
    (args.out / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines), flush=True)


if __name__ == "__main__":
    main()
