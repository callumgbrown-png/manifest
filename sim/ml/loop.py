"""Run an experiment over and over with fresh seeds until told to stop (what the app's Start button runs).

    python -m sim.ml.loop sim/ml/config/experiments/baseline.yaml --out sim/ml/runs/live

Each cycle plays the experiment on new world seeds, writes its report to <out>/cycles/<n>/ (report.md, report.json, CSVs, chart),
appends one line to <out>/INDEX.jsonl and rewrites <out>/LATEST.json. To stop cleanly create a file named STOP in <out> (the app's
Stop button does this): the cycle in progress finishes, then the loop ends. Ctrl-C does the same. Starting again continues the cycle
numbering, so seeds are never reused. Only the newest `--keep` cycle folders are kept.

This is NOT the learning loop of plan section 6b (no training, no baselines comparison, no schema-validated report): scripted players
do not improve between cycles. It repeats measurements, which averages out seed noise and lets you watch a rule change over time.
It never writes to config/rules.json; what-if numbers go in the experiment file's `rules_overrides`, applied in memory only.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from .controller import clear_stale_stop
from .run import run_experiment

STOP_FILE = "STOP"


def headline(report_dir: Path) -> dict[str, Any]:
    """One-line summary of a cycle for the index: who leads each difficulty, and the bots for scale."""
    agg = json.loads((report_dir / "report.json").read_text(encoding="utf-8"))["aggregate"]
    leaders = {d: {"persona": v["leader"], "median_net_worth": round(v["median"])} for d, v in agg["dominance"]["leaders"].items()}
    return {"leaders": leaders, "bots_median": {d: round(b["median"]) for d, b in agg["bots"].items()},
            "dominant_personas": agg["dominance"]["dominant_personas"]}


def rotate(cycles_dir: Path, keep: int) -> list[str]:
    """Delete the oldest generated cycle folders beyond `keep` (only ever inside <out>/cycles)."""
    folders = sorted(p for p in cycles_dir.iterdir() if p.is_dir() and p.name.isdigit())
    removed = []
    for old in folders[:-keep] if keep > 0 else []:
        shutil.rmtree(old)
        removed.append(old.name)
    return removed


def run_loop(experiment: Path, out: Path, *, seed_base: int = 1, workers: int = 10, keep: int = 20, max_cycles: int | None = None) -> int:
    cfg = yaml.safe_load(experiment.read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    stop, index = out / STOP_FILE, out / "INDEX.jsonl"
    clear_stale_stop(stop)                                         # a stale STOP from last time must not end this run (one written after launch stays)
    start_cycle = sum(1 for line in index.read_text(encoding="utf-8").splitlines() if line.strip()) if index.exists() else 0
    cycle, ran = start_cycle, 0
    print(f"loop: {cfg['name']}, starting at cycle {cycle}; create {stop} to stop after the current cycle", flush=True)
    try:
        while not stop.exists() and (max_cycles is None or ran < max_cycles):
            seed = seed_base + cycle * 100
            began = time.perf_counter()
            report_dir = run_experiment({**cfg, "name": f"{cycle:06d}"}, seed, workers, out / "cycles")
            summary = {"cycle": cycle, "seed": seed, "experiment": cfg["name"], "seconds": round(time.perf_counter() - began, 1),
                       "report": str(report_dir.relative_to(out) / "report.md"), "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                       **headline(report_dir)}
            with index.open("a", encoding="utf-8") as f:
                f.write(json.dumps(summary) + "\n")
            (out / "LATEST.json").write_text(json.dumps({**summary, "stopped": False}, indent=2), encoding="utf-8")
            rotate(out / "cycles", keep)
            print(f"cycle {cycle} done in {summary['seconds']}s: " + "; ".join(f"{d}: {v['persona']} {v['median_net_worth']:,}" for d, v in summary["leaders"].items()), flush=True)
            cycle += 1
            ran += 1
    except KeyboardInterrupt:
        print("interrupted: stopping", flush=True)
    latest = out / "LATEST.json"
    if latest.exists():
        latest.write_text(json.dumps({**json.loads(latest.read_text(encoding="utf-8")), "stopped": True}, indent=2), encoding="utf-8")
    print(f"loop: stopped after {ran} cycle(s)", flush=True)
    return ran


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("experiment", type=Path)
    ap.add_argument("--out", type=Path, default=Path("sim/ml/runs/live"))
    ap.add_argument("--seed", type=int, default=1, help="base seed; cycle n uses seed + 100*n")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--keep", type=int, default=20, help="cycle folders to keep")
    ap.add_argument("--max-cycles", type=int)
    a = ap.parse_args()
    run_loop(a.experiment, a.out, seed_base=a.seed, workers=a.workers, keep=a.keep, max_cycles=a.max_cycles)
    sys.exit(0)


if __name__ == "__main__":
    main()
