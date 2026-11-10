"""Throughput: full 56-day seasons per minute, per process and with parallel workers.

    python -m sim.ml.bench [--seasons 4] [--workers N] [--bots 30] [--learners 6]
A "season" is one reset + the random-legal learner playing to the end, in a world of bots (plan: 30 bots, 60 expected).
Only the first learner is controlled in Phase 0; the other learner companies idle.
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import time

from .agents.baselines import play_season, random_legal
from .env import ManifestEnv


def _worker(args: tuple[int, int, int, int]) -> tuple[int, float, int]:
    first_seed, n, bots, learners = args
    env = ManifestEnv(n_bots=bots, n_learners=learners)
    decisions = 0
    t0 = time.perf_counter()
    for s in range(first_seed, first_seed + n):
        decisions += play_season(env, random_legal, s)["decisions"]
    dt = time.perf_counter() - t0
    env.close()
    return n, dt, decisions


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, default=4, help="seasons per worker")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--bots", type=int, default=30)
    ap.add_argument("--learners", type=int, default=6)
    a = ap.parse_args()

    n, dt, dec = _worker((1000, a.seasons, a.bots, a.learners))
    print(f"1 process : {n} seasons in {dt:.1f}s = {60 * n / dt:.1f} seasons/min/process "
          f"({dec / dt:.0f} decisions/s, {dec / n:.0f} decisions/season)")

    t0 = time.perf_counter()
    with mp.get_context("spawn").Pool(a.workers) as pool:
        res = pool.map(_worker, [(2000 + i * 100, a.seasons, a.bots, a.learners) for i in range(a.workers)])
    wall = time.perf_counter() - t0
    total = sum(r[0] for r in res)
    print(f"{a.workers} workers: {total} seasons in {wall:.1f}s = {60 * total / wall:.1f} seasons/min total "
          f"({60 * total / wall / a.workers:.1f} per worker)")


if __name__ == "__main__":
    main()
