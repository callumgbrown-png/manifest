"""One command per experiment (or, with --continuous, the endless training loop: see continuous.py):  python -m sim.ml.run sim/ml/config/experiments/baseline.yaml --seed 1

Plays seeds x difficulties full seasons (in parallel), then writes results/<name>/ (report.md, report.json, CSVs, chart).
Never writes to config/rules.json; what-if numbers go in `rules_overrides` in the experiment file and live in memory only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import subprocess
import time
from pathlib import Path

import yaml

from .bridge_client import REPO
from .report.aggregate import aggregate
from .report.render import render
from .season import run_season


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def source_metadata() -> dict[str, str | bool | None]:
    """Identify local simulator edits as well as the last committed revision."""
    try:
        names = subprocess.run(["git", "ls-files", "-z", "--", "sim/ml"], cwd=REPO,
                               capture_output=True, text=True, check=True).stdout.split("\0")
        digest = hashlib.sha256()
        for name in sorted(n for n in names if n):
            digest.update(name.encode() + b"\0")
            digest.update((REPO / name).read_text(encoding="utf-8").encode() + b"\0")
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO,
                                capture_output=True, text=True, check=True).stdout
        return {"working_tree_dirty": bool(status.strip()), "simulator_hash": digest.hexdigest()}
    except (OSError, subprocess.CalledProcessError):
        return {"working_tree_dirty": None, "simulator_hash": None}


def run_experiment(cfg: dict, seed: int, workers: int, out_root: Path) -> Path:
    rules = json.loads((REPO / "config" / "rules.json").read_text(encoding="utf-8"))
    out = out_root / cfg["name"]
    tasks = [dict(seed=seed + i, difficulty=d, players=cfg["players"], n_bots=cfg.get("n_bots", 30),
                  expected_companies=cfg.get("expected_companies", 60), rules_overrides=cfg.get("rules_overrides"),
                  map_seed=cfg.get("map_seed"),
                  replay_file=f"replay/seed-{seed + i}-{d}.json",
                  replay_path=str((out / "replay" / f"seed-{seed + i}-{d}.json").resolve()))
             for i in range(int(cfg.get("seeds", 3))) for d in cfg.get("difficulties", ["normal"])]
    t0 = time.perf_counter()
    if workers > 1:
        with mp.get_context("spawn").Pool(min(workers, len(tasks))) as pool:
            seasons = pool.map(run_season, tasks)
    else:
        seasons = [run_season(t) for t in tasks]
    wall = time.perf_counter() - t0
    agg = aggregate(seasons, rules["health_checks"])
    meta = dict(seed=seed, git=git_commit(), workers=workers, wall_seconds=round(wall, 1),
                rules_hash=hashlib.sha256(json.dumps(rules).encode()).hexdigest(),
                seasons_per_minute=round(60 * len(tasks) / wall, 1), **source_metadata())
    render(out, cfg["name"], cfg, seasons, agg, meta)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("experiment", type=Path)
    ap.add_argument("--seed", type=int, default=1, help="first world seed; season i uses seed+i")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--out", type=Path, default=REPO / "sim" / "ml" / "results")
    ap.add_argument("--continuous", action="store_true", help="the endless collect/learn/evaluate/report loop (Phase 3b); EXPERIMENT is a live.yaml")
    ap.add_argument("--resume", action="store_true", help="with --continuous: continue the newest run of that name from its checkpoint")
    ap.add_argument("--max-cycles", type=int, help="with --continuous: stop after this many cycles (testing)")
    ap.add_argument("--run-id", help="with --continuous: the run folder name under sim/ml/runs (default: new timestamped, or newest with --resume)")
    a = ap.parse_args()
    if a.continuous:
        from .continuous import run_continuous
        run_continuous(a.experiment, resume=a.resume, max_cycles=a.max_cycles, run_id=a.run_id)
        return
    cfg = yaml.safe_load(a.experiment.read_text(encoding="utf-8"))
    out = run_experiment(cfg, a.seed, a.workers, a.out)
    print(f"wrote {out / 'report.md'}")


if __name__ == "__main__":
    main()
