"""Phase 3 held-out evaluation: optimal vs human-like agents, persona distinctness, persona sensitivity.

    python -m sim.ml.league_eval sim/ml/runs/phase3/final.pt sim/ml/config/experiments/phase3.yaml --out sim/ml/results/phase3

Per (seed, difficulty) the same world is played five ways, each with 8 learner companies against 30 bots:
  H  eight human-like personas (policy, persona schedule, imperfect perception, mistakes, churn)
  O  eight "optimal" agents (same policy, a check-in every game hour, perfect perception, never quits)
  P1 eight scripted `plan` players checking in every hour        P4 the same every 4 hours (playtest.ts style)
  S  the eight Phase 1 scripted personas (schedules and churn, no learning)
Criteria declared before the run (a failed criterion is reported as failed, never re-defined):
  C1 every persona's nearest other persona is farther (standardised fingerprint) than its own seed-to-seed spread
  C2 no collapse: min pairwise action-distribution KL between personas > 1e-3, and < 95% of states where all personas agree
  C3 zero rejected actions
The optimal-vs-human gap (O vs H, O vs P1) is reported with no threshold: the plan asks only that it be reported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np
import torch
import yaml

from .env import LEARNING_GLOBAL_FEATURES, EXTENDED_FEATURES
from .league import K, run_league
from .persona_policy import PersonaPolicy, load_persona_policy
from .personas.persona import HUMAN_PERSONAS, PERSONA_DIM, load_personas
from .policy import seed_everything
from .report.render import write_csv, _plain
from .run import git_commit, source_metadata
from .season import run_season

CONDITIONS = ("H", "O", "P1", "P4", "S")
FEATURES = ("visits_per_active_day", "decisions_per_visit", "wait_share", "trade_share", "empty_share", "special_share",
            "grain", "fuel", "ore", "machinery", "voyage_hours", "mistakes_per_decision", "first_buy_day")
SEASON_DAYS = 56


def slots_for(condition: str) -> list[dict]:
    if condition == "H":
        return [dict(persona=n, flavour="human", train=False) for n in HUMAN_PERSONAS]
    if condition == "O":
        return [dict(persona="optimal", flavour="optimal") for _ in HUMAN_PERSONAS]
    if condition == "P1":
        return [dict(persona="base_plan_1h", control="scripted") for _ in HUMAN_PERSONAS]
    return [dict(persona="base_plan", control="scripted") for _ in HUMAN_PERSONAS]


def worker(task: dict) -> dict:
    if task["condition"] == "S":
        r = run_season(dict(seed=task["seed"], difficulty=task["difficulty"], players={n: 1 for n in HUMAN_PERSONAS},
                            n_bots=30, expected_companies=60, map_seed=task["map_seed"], replay_path=task.get("replay_path")))
        players = [dict(seed=p["seed"], difficulty=p["difficulty"], persona=p["persona"], final_worth=p["final_worth"],
                        quit_tick=p["quit_tick"], rejected=0, control="scripted", flavour="human") for p in r["players"]]
        return dict(condition="S", seed=task["seed"], difficulty=task["difficulty"], players=players, digest=r["digest"],
                    bot_worths=r["bot_worths"], episodes=[])
    r = run_league(task)
    return {**r, "condition": task["condition"]}


def fingerprint(p: dict[str, Any]) -> dict[str, float]:
    """Behavioural summary of one policy-driven player in one season."""
    kinds, decisions = p["kinds"], max(1, p["decisions"])
    days = max(1.0, (p["quit_tick"] if p["quit_tick"] is not None else SEASON_DAYS * 24) / 24)
    trades = max(1, sum(p["goods"]))
    plain = ("wait", "trade", "carry", "empty", "sell")
    n_voy = max(1, kinds.get("trade", 0) + kinds.get("carry", 0) + kinds.get("empty", 0))
    return {
        "visits_per_active_day": p["visits"] / days, "decisions_per_visit": p["decisions"] / max(1, p["visits"]),
        "wait_share": kinds.get("wait", 0) / decisions, "trade_share": kinds.get("trade", 0) / decisions,
        "empty_share": kinds.get("empty", 0) / decisions,
        "special_share": sum(v for k, v in kinds.items() if k not in plain) / decisions,
        **{g: p["goods"][i] / trades for i, g in enumerate(("grain", "fuel", "ore", "machinery"))},
        "voyage_hours": p["voyage_hours"] / n_voy, "mistakes_per_decision": p["mistakes"] / decisions,
        "first_buy_day": (p["first_buy_tick"] / 24) if p["first_buy_tick"] is not None else SEASON_DAYS + 1.0,
    }


def distinctness(prints: dict[str, list[dict[str, float]]]) -> dict[str, Any]:
    """Between-persona vs within-persona distance on standardised fingerprints (criterion C1)."""
    names = list(prints)
    allv = np.array([[f[k] for k in FEATURES] for n in names for f in prints[n]], dtype=float)
    mu, sd = allv.mean(0), allv.std(0)
    sd[sd < 1e-9] = 1.0
    z = {n: np.array([[(f[k] - m) / s for k, m, s in zip(FEATURES, mu, sd)] for f in prints[n]]) for n in names}
    dist = lambda a, b: float(np.linalg.norm(a - b) / np.sqrt(len(FEATURES)))
    means = {n: z[n].mean(0) for n in names}
    within = {n: float(np.mean([dist(a, b) for a, b in combinations(z[n], 2)])) if len(z[n]) > 1 else float("nan") for n in names}
    between = {(a, b): dist(means[a], means[b]) for a, b in combinations(names, 2)}
    rows = []
    for n in names:
        other = {m: between[tuple(sorted((n, m), key=names.index))] for m in names if m != n}
        nearest = min(other, key=other.get)
        rows.append(dict(persona=n, within=within[n], nearest=nearest, nearest_distance=other[nearest],
                         ratio=other[nearest] / within[n] if within[n] > 0 else float("inf")))
    # Informational (not a pass/fail criterion): leave one world out, name the persona by the nearest other-world centroid.
    hits = total = 0
    for n in names:
        for i in range(len(z[n])):
            cent = {m: (np.delete(z[m], i, axis=0).mean(0) if m == n and len(z[m]) > 1 else z[m].mean(0)) for m in names}
            hits += min(names, key=lambda m: dist(z[n][i], cent[m])) == n
            total += 1
    return {"per_persona": rows, "pairwise": {f"{a}|{b}": d for (a, b), d in between.items()}, "identification_accuracy": hits / max(1, total),
            "chance_accuracy": 1 / len(names),
            "c1_pass": all(r["ratio"] > 1 for r in rows), "failing": [r["persona"] for r in rows if not r["ratio"] > 1]}


@torch.no_grad()
def persona_sensitivity(model: PersonaPolicy, observations: np.ndarray, masks: np.ndarray, names: tuple[str, ...]) -> dict[str, Any]:
    """How much the persona vector changes the action distribution on identical states (criterion C2)."""
    library = load_personas()
    core = torch.as_tensor(observations[:, :-PERSONA_DIM])
    mask = torch.as_tensor(masks)
    dists, logits = {}, {}
    for n in names + ("_none",):
        vec = torch.zeros(PERSONA_DIM) if n == "_none" else torch.as_tensor(library[n].vector())
        d, _ = model(torch.cat((core, vec.expand(len(core), -1)), dim=1), mask)
        dists[n], logits[n] = d, d.logits.argmax(-1)
    kl = lambda a, b: float(torch.distributions.kl_divergence(dists[a], dists[b]).mean())
    pair = {f"{a}|{b}": 0.5 * (kl(a, b) + kl(b, a)) for a, b in combinations(names, 2)}
    agree = float((torch.stack([logits[n] for n in names]) == logits[names[0]]).all(0).float().mean())
    return {"states": len(core), "mean_pair_kl": float(np.mean(list(pair.values()))), "min_pair_kl": float(min(pair.values())),
            "min_pair": min(pair, key=pair.get), "argmax_all_agree": agree,
            "kl_to_persona_free": {n: kl(n, "_none") for n in names}, "pairs": pair,
            "c2_pass": min(pair.values()) > 1e-3 and agree < 0.95}


def analyse(results: list[dict[str, Any]]) -> dict[str, Any]:
    diffs = sorted({r["difficulty"] for r in results}, key=["easy", "normal", "hard"].index)
    players = [dict(p, condition=r["condition"]) for r in results for p in r["players"]]
    med = lambda v: float(np.median(v)) if v else float("nan")
    cohort: dict[str, dict[str, float]] = {d: {c: med([p["final_worth"] for p in players if p["condition"] == c and p["difficulty"] == d]) for c in CONDITIONS} for d in diffs}
    bots = {d: med([w for r in results if r["difficulty"] == d and r["condition"] == "P4" for w in r["bot_worths"]]) for d in diffs}
    per_persona = []
    for d in diffs:
        for n in HUMAN_PERSONAS:
            rows = [p for p in players if p["condition"] == "H" and p["difficulty"] == d and p["persona"] == n]
            s_rows = [p for p in players if p["condition"] == "S" and p["difficulty"] == d and p["persona"] == n]
            per_persona.append(dict(difficulty=d, persona=n, n=len(rows), median_worth=med([p["final_worth"] for p in rows]),
                                    quit_rate=float(np.mean([p["quit_tick"] is not None for p in rows])) if rows else float("nan"),
                                    scripted_persona_median=med([p["final_worth"] for p in s_rows]),
                                    scripted_persona_quit_rate=float(np.mean([p["quit_tick"] is not None for p in s_rows])) if s_rows else float("nan")))
    gap = {d: {"optimal_median": cohort[d]["O"], "human_cohort_median": cohort[d]["H"],
               "optimal_over_human": cohort[d]["O"] / cohort[d]["H"] if cohort[d]["H"] > 0 else None,
               "plan_hourly_median": cohort[d]["P1"], "optimal_over_plan_hourly": cohort[d]["O"] / cohort[d]["P1"] if cohort[d]["P1"] > 0 else None,
               "plan_4h_median": cohort[d]["P4"], "scripted_personas_median": cohort[d]["S"], "bots_median": bots[d]} for d in diffs}
    prints: dict[str, list[dict[str, float]]] = defaultdict(list)
    for p in players:
        if p["condition"] == "H":
            prints[p["persona"]].append(fingerprint(p))
    paired = {}
    for r in results:
        paired.setdefault((r["seed"], r["difficulty"]), {})[r["condition"]] = med([p["final_worth"] for p in r["players"]])
    exploits = [dict(seed=s, difficulty=d, optimal=v["O"], plan_hourly=v["P1"], ratio=v["O"] / v["P1"])
                for (s, d), v in sorted(paired.items()) if {"O", "P1"} <= set(v) and v["P1"] > 0 and v["O"] / v["P1"] > 1.5]
    return {"difficulties": diffs, "cohorts": cohort, "gap": gap, "per_persona": per_persona,
            "distinctness": distinctness(dict(prints)) if prints else None,
            "rejected_actions": sum(p.get("rejected", 0) for p in players), "worlds": len(paired),
            "exploit_candidates_o_over_p1_gt_1_5": exploits}


def clean(x: Any) -> Any:
    """Strict-JSON copy: NaN and infinity become null."""
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else float(x)
    return x


def render(out: Path, cfg: dict, analysis: dict, sensitivity: dict, control: dict, results: list[dict], meta: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    a, d = analysis, analysis["distinctness"]
    m = lambda x: "-" if x is None or x != x else f"{x:,.0f}"
    r2 = lambda x: "-" if x is None else f"{x:.2f}x"
    L = ["# Phase 3 held-out evaluation", "",
         f"{a['worlds']} worlds ({', '.join(a['difficulties'])}; seeds {cfg['heldout_seeds']}), 5 conditions each, 8 learner companies + 30 bots, "
         f"git `{meta['git']}`, checkpoint `{meta['checkpoint_sha256'][:12]}`. Persona numbers and churn are assumptions; nothing here is measured human behaviour.", "",
         "## Optimal vs human-like (median net worth per learner)", "",
         "| difficulty | optimal | human-like | optimal/human | plan hourly | optimal/plan hourly | plan 4h | scripted personas | bots |", "|---|---|---|---|---|---|---|---|---|"]
    for dif, g in a["gap"].items():
        L.append(f"| {dif} | {m(g['optimal_median'])} | {m(g['human_cohort_median'])} | {r2(g['optimal_over_human'])} | {m(g['plan_hourly_median'])} | "
                 f"{r2(g['optimal_over_plan_hourly'])} | {m(g['plan_4h_median'])} | {m(g['scripted_personas_median'])} | {m(g['bots_median'])} |")
    L += ["", "The optimal agent is the Phase 2 learned policy with hourly check-ins and no noise; Phase 2's acceptance gate was NOT met, so it is "
          "a reference agent, not a proven skill ceiling. `plan hourly` is the scripted strategy at the same cadence.", "",
          "## Per persona (human-like policy vs the Phase 1 scripted persona)", "",
          "| difficulty | persona | n | median worth | quit rate | scripted persona worth | scripted quit rate |", "|---|---|---|---|---|---|---|"]
    for r in a["per_persona"]:
        L.append(f"| {r['difficulty']} | {r['persona']} | {r['n']} | {m(r['median_worth'])} | {r['quit_rate']:.0%} | {m(r['scripted_persona_median'])} | {r['scripted_persona_quit_rate']:.0%} |")
    L += ["", "## C1 persona distinctness (standardised behaviour fingerprints)", "",
          "| persona | seed-to-seed spread | nearest other persona | distance | ratio | |", "|---|---|---|---|---|---|"]
    for r in d["per_persona"]:
        L.append(f"| {r['persona']} | {r['within']:.2f} | {r['nearest']} | {r['nearest_distance']:.2f} | {r['ratio']:.2f} | {'ok' if r['ratio'] > 1 else 'NOT DISTINCT'} |")
    L += ["", f"**C1: {'PASS' if d['c1_pass'] else 'FAIL'}**" + ("" if d["c1_pass"] else f" (not distinct: {', '.join(d['failing'])})"), "",
          "## C2 persona sensitivity (same states, different persona vector)", "",
          f"Trained model, {sensitivity['states']} sampled decision states: mean pairwise symmetric KL {sensitivity['mean_pair_kl']:.4f}, "
          f"minimum {sensitivity['min_pair_kl']:.4f} ({sensitivity['min_pair']}), all personas pick the same top action in {sensitivity['argmax_all_agree']:.0%} of states. "
          f"Untrained control (the wrapped Phase 2 policy): mean KL {control['mean_pair_kl']:.4f}, agreement {control['argmax_all_agree']:.0%}.", "",
          f"**C2: {'PASS' if sensitivity['c2_pass'] else 'FAIL'}**", "",
          f"## C3 legality\n\nRejected actions across all policy players: {a['rejected_actions']}. **C3: {'PASS' if a['rejected_actions'] == 0 else 'FAIL'}**", "",
          "## Exploit candidates", ""]
    ex = a["exploit_candidates_o_over_p1_gt_1_5"]
    L.append("None: no world had optimal > 1.5x plan-hourly." if not ex else "Worlds where the optimal median beat plan-hourly by more than 1.5x (flagged for review, NOT confirmed exploits; replay logs are in replay/):")
    for e in ex:
        L.append(f"- seed {e['seed']} {e['difficulty']}: optimal {m(e['optimal'])} vs plan hourly {m(e['plan_hourly'])} ({e['ratio']:.2f}x)")
    L += ["", "## Limits", "",
          f"- {len(cfg['heldout_seeds'])} held-out seeds per difficulty; medians are descriptive, not statistical proof.",
          "- Policy base is frozen Phase 2; only persona corrections were trained (see league_train.py). Training was bounded and short.",
          "- Human-likeness is not measured: no real-player data exists yet (Phase 4). Quits come from a hand-set hazard model.",
          "- No rule changes are suggested here. `config/rules.json` was not read for writing.", ""]
    (out / "report.md").write_text("\n".join(L), encoding="utf-8")
    flat = [dict(condition=r["condition"], **{k: v for k, v in p.items()}) for r in results for p in r["players"]]
    write_csv(out / "players.csv", flat)
    (out / "report.json").write_text(json.dumps(clean({"meta": meta, "config": cfg, "analysis": analysis, "sensitivity": sensitivity, "untrained_control": control,
                                                        "digests": [{k: r[k] for k in ("condition", "seed", "difficulty", "digest")} for r in results]}),
                                                 indent=2, default=_plain, allow_nan=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("--out", type=Path, default=Path("sim/ml/results/phase3"))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    seed_everything(cfg["seed"])
    model = load_persona_policy(args.checkpoint)
    state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    tasks = []
    for seed in cfg["heldout_seeds"]:
        for diff in cfg["difficulties"]:
            for cond in CONDITIONS:
                t = dict(condition=cond, seed=seed, difficulty=diff, map_seed=f"heldout-{seed}", slots=slots_for(cond), state=state,
                         hidden=model.hidden, architecture=model.architecture, replay_path=str((args.out / "replay" / f"{cond}-{seed}-{diff}.json").resolve()))
                if cond == "H":   # keep decision states for the persona-sensitivity test
                    t["slots"] = [dict(s, train=True) for s in t["slots"]]
                tasks.append(t)
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(worker, tasks)
    rng = np.random.default_rng(cfg["seed"])
    rows = [r for res in results if res["condition"] == "H" for ep in res["episodes"] for r in ep["rows"]]
    pick = rng.choice(len(rows), size=min(2000, len(rows)), replace=False)
    observations = np.stack([rows[i][0] for i in pick])
    masks = np.stack([rows[i][1] for i in pick])
    for res in results:
        res["episodes"] = []
    sensitivity = persona_sensitivity(model, observations, masks, HUMAN_PERSONAS)
    from .persona_policy import from_phase2
    control = persona_sensitivity(from_phase2(cfg["warm_start"]), observations, masks, HUMAN_PERSONAS)
    meta = dict(git=git_commit(), **source_metadata(), checkpoint_sha256=hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(), device="cpu")
    analysis = analyse(results)
    render(args.out, cfg, analysis, sensitivity, control, results, meta)
    print((args.out / "report.md").read_text(encoding="utf-8"), flush=True)


if __name__ == "__main__":
    main()
