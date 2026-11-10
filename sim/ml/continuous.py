"""The continuous run (plan section 6b / Phase 3b):  python -m sim.ml.run --continuous sim/ml/config/experiments/live.yaml [--resume]

Each cycle: collect league worlds with the current persona agents, learn (PPO on the persona corrections and value heads), evaluate on
fixed held-out worlds against fixed baselines (scripted plan every 4 h, last cycle's agent), analyse (dominant strategy, exploit
candidates, inflation, quit spikes, pirate imbalance, regression, persona collapse), write a schema-validated report, checkpoint.

Stops cleanly when a file named STOP appears in the run folder or on Ctrl-C: the cycle in progress finishes, a final report is written and
the checkpoint saved. `--resume` continues the newest run folder of that name. Safety rails: never writes config/rules.json or touches git;
rotates old cycle folders; pauses while disk space is low; stops with a clear message if the loss goes non-finite or the personas collapse
into one behaviour, or the human-like players stall at the start worth on every difficulty for `stall_stop_cycles` cycles. On --resume the
checkpoint's code identity (git commit, sim/ml hash, rules hash; stored in state.json) is compared with the running code and any change is
warned about and noted in that cycle's report. Nothing here is measured on real players: human_likeness stays null until a real export exists.
"""
from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import yaml

from .bridge_client import REPO, SERVER_DIR, Bridge, find_node
from .league import run_league
from .league_eval import persona_sensitivity, slots_for, worker as eval_worker
from .league_train import DIFFICULTIES, trainable, update_persona, world_slots
from .persona_policy import PersonaPolicy, from_phase2, load_persona_policy
from .controller import clear_stale_stop
from .gemini_ideas import GEMINI_FLAG, ask as gemini_ask, due as gemini_due, record as gemini_record
from .ideas import cycle_ideas
from .personas.mood import MOODS, cycle_summary
from .personas.persona import HUMAN_PERSONAS
from .policy import seed_everything
from .report import cycle as cyc
from .run import git_commit, source_metadata
from .season import run_season

RUNS_ROOT = REPO / "sim" / "ml" / "runs"


def _ignore_sigint() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C is handled by the main process, which lets the cycle finish


class Stop:
    """True once STOP exists in the run folder or Ctrl-C was pressed."""

    def __init__(self, run_dir: Path) -> None:
        self.file, self.signalled = run_dir / "STOP", False
        signal.signal(signal.SIGINT, self._on_signal)

    def _on_signal(self, *_: Any) -> None:
        self.signalled = True
        print("Ctrl-C: finishing the current cycle, then stopping", flush=True)

    def __bool__(self) -> bool:
        return self.signalled or self.file.exists()


def find_run(name: str, resume: bool, run_id: str | None = None) -> tuple[str, Path]:
    """The run folder: --run-id picks one explicitly (the app does, so it knows where STOP goes); otherwise a new timestamped one,
    or with --resume the newest earlier run of that name."""
    if run_id:
        path = RUNS_ROOT / run_id
        if resume and not (path / "checkpoints" / "state.json").exists():
            raise SystemExit(f"--resume: {path} has no checkpoint")
        return run_id, path
    existing = sorted(p for p in RUNS_ROOT.glob(f"{name}-*") if (p / "checkpoints" / "state.json").exists())
    if resume:
        if not existing:
            raise SystemExit(f"--resume: no earlier run named {name!r} with a checkpoint under {RUNS_ROOT}")
        return existing[-1].name, existing[-1]
    run_id = f"{name}-{time.strftime('%Y%m%d-%H%M%S')}"
    return run_id, RUNS_ROOT / run_id


def rotate(directory: Path, last: int, every: int, suffix: str = "") -> None:
    """Delete generated cycle folders/files except the newest `last` and every `every`-th cycle."""
    items = sorted(p for p in directory.iterdir() if p.name.split(".")[0].replace("cycle-", "").isdigit() and p.name.endswith(suffix))
    for p in items[:-last] if last > 0 else items:
        n = int(p.name.split(".")[0].replace("cycle-", ""))
        if every and n % every == 0:
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()


def real_sessions() -> int:
    meta = REPO / "data" / "real" / "meta.json"
    try:
        m = json.loads(meta.read_text(encoding="utf-8"))
        return 0 if m.get("synthetic") else int(m.get("players", 0))
    except (OSError, ValueError):
        return 0


def determinism_check() -> dict[str, Any]:
    task = dict(seed=3, difficulty="normal", players={"base_plan": 1, "base_oldDefault": 1}, n_bots=6, expected_companies=60)
    a, b = run_season(task), run_season(task)
    return {"checked": True, "ok": a["digest"] == b["digest"], "detail": "same scripted season twice, state digests " + ("equal" if a["digest"] == b["digest"] else "DIFFER")}


def parity_check() -> dict[str, Any]:
    """Bridge command log vs the real server's event-log replay (needs <= 20 companies, default rules)."""
    with Bridge() as br:
        w = br.call("reset", seed=11, difficulty="normal", n_bots=14, n_learners=6, expected_companies=60)
        for t in range(0, w["seasonHours"], 4):
            for company in w["learners"]:
                br.call("play", company=company, params=dict(strat="plan"))
            br.call("step", commands=[], hours=min(4, w["seasonHours"] - t))
        path = Path(os.environ.get("TEMP", ".")) / f"manifest-parity-{os.getpid()}.json"
        br.call("dump_log", path=str(path))
    try:
        out = subprocess.run([find_node(), "--no-warnings", "--import", "tsx", str(REPO / "sim" / "ml" / "bridge" / "parity.mts"), str(path)], cwd=SERVER_DIR,
                             capture_output=True, text=True, encoding="utf-8", timeout=300)
        verdict = json.loads(out.stdout.strip().splitlines()[-1])
        return {"checked": True, "ok": bool(verdict["ok"]), "detail": f"{verdict.get('compared')} company worths and world totals compared; mismatches: {verdict.get('mismatches')}"}
    except Exception as e:  # a failed check is reported, never fatal to the run
        return {"checked": True, "ok": None, "detail": f"parity check could not run: {e}"}
    finally:
        path.unlink(missing_ok=True)


def code_identity(rules_hash: str) -> dict[str, Any]:
    """What code this process runs: git commit, whether the tree is dirty, a hash of the tracked sim/ml sources, and the rules hash."""
    meta = source_metadata()
    return {"git_commit": git_commit(), "working_tree_dirty": meta.get("working_tree_dirty"), "simulator_hash": meta.get("simulator_hash"), "rules_hash": rules_hash}


def _label(ident: dict[str, Any]) -> str:
    out = str(ident.get("git_commit") or "unknown") + ("+dirty" if ident.get("working_tree_dirty") else "")
    if ident.get("simulator_hash"):
        out += f" (sim/ml {str(ident['simulator_hash'])[:10]})"
    return out + (f" rules {str(ident['rules_hash'])[:10]}" if ident.get("rules_hash") else "")


def resume_notes(saved: dict[str, Any] | None, now: dict[str, Any]) -> list[str]:
    """data_quality notes for the first cycle after --resume: empty when the checkpoint's code matches this process's code.
    `saved` is the checkpoint's code identity (or, for checkpoints written before it was stored, one rebuilt from the last report)."""
    if not saved or not any(saved.get(k) is not None for k in ("git_commit", "simulator_hash", "rules_hash")):
        return ["code on resume could not be compared: the checkpoint records no git commit"]
    changed = [k for k in ("git_commit", "working_tree_dirty", "simulator_hash", "rules_hash")
               if saved.get(k) is not None and now.get(k) is not None and saved[k] != now[k]]
    notes = [f"code changed on resume: {_label(saved)} -> {_label(now)} (differs: {', '.join(changed)}); results before and after this cycle may not be comparable"] if changed else []
    if not changed and saved.get("simulator_hash") is None and (saved.get("working_tree_dirty") or now.get("working_tree_dirty")):
        notes.append(f"uncommitted edits on resume could not be compared (checkpoint has no sim/ml hash): {_label(saved)} -> {_label(now)}")
    return notes


def saved_code(state: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any] | None:
    """The checkpoint's code identity; older checkpoints lack it, so fall back to the last report's run metadata."""
    if isinstance(state.get("code"), dict):
        return state["code"]
    if previous is None:
        return None
    run = previous.get("run", {})
    return {k: run.get(k) for k in ("git_commit", "working_tree_dirty", "simulator_hash", "rules_hash")}


def stall_streak(streak: int, stalled: list[str], evaluated: list[str], ran_eval: bool) -> int:
    """Consecutive evaluated cycles in which the human-like cohort stalled on every evaluated difficulty; a skipped evaluation leaves it as is."""
    if not ran_eval:
        return streak
    return streak + 1 if evaluated and set(stalled) >= set(evaluated) else 0


def realism_step(state: dict[str, Any], metrics: dict[str, Any], eval_results: list[dict[str, Any]], health: dict[str, Any], limits: dict[str, Any],
                 season_hours: int, seed: int) -> tuple[dict[str, Any], bool, dict[str, Any]]:
    """Realism of this cycle's evaluation (estimated targets only): fills metrics["realism"], advances state["realism_drift_streak"] and decides
    whether best_realism.pt is due. Returns (overall human-like recruited {distance, auc}, save best?, realism_drift evidence for findings_from).
    A skipped evaluation leaves the carried-over metrics, the streak and the best untouched."""
    if eval_results:
        metrics["realism"] = cyc.realism_from(eval_results, season_hours, seed)
    now = cyc.realism_headline(metrics) if eval_results else {"distance": None, "auc": None}
    best = (state.get("best_realism") or {}).get("distance")
    state["realism_drift_streak"] = cyc.realism_drift_streak(int(state.get("realism_drift_streak", 0)), now["distance"], best, limits)
    start = cyc.start_worth(eval_results, limits)
    stall = bool(health["stop_conditions"].get("human_like_stall")) or bool(cyc.stalled_difficulties(metrics, start, limits))   # the finding or the stop
    due = bool(eval_results) and cyc.best_realism_due(now["distance"], best, stall, metrics, start, limits)
    drift = {"streak": state["realism_drift_streak"], "distance": now["distance"], "best": best, "best_cycle": (state.get("best_realism") or {}).get("cycle")}
    return now, due, drift


def save_checkpoint(run_dir: Path, model: PersonaPolicy, optimizer: torch.optim.Optimizer, state: dict[str, Any], keep: dict[str, int]) -> None:
    ck = run_dir / "checkpoints"
    ck.mkdir(parents=True, exist_ok=True)
    model.save(ck / "latest.pt", cycle=state["cycle"])
    model.save(ck / f"cycle-{state['cycle']:06d}.pt", cycle=state["cycle"])
    torch.save(optimizer.state_dict(), ck / "optimizer.pt")
    (ck / "state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    rotate(ck, keep["last"], keep["every"], suffix=".pt")


def record_moods_and_ideas(run_dir: Path, cfg: dict[str, Any], cycle: int, report: dict[str, Any], eval_results: list[dict[str, Any]]) -> None:
    """Moods, the players' ideas and the optional Gemini ideas for one cycle: logged, never fatal."""
    try:
        moods = cycle_summary([p for r in eval_results for p in r["players"]])
        if moods["players"]:
            with (run_dir / "moods.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"cycle": cycle, **moods}) + "\n")
            ideas = cycle_ideas([p for r in eval_results for p in r["players"]])
            with (run_dir / "ideas.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"cycle": cycle, **ideas}) + "\n")
            gem = cfg.get("gemini") if isinstance(cfg.get("gemini"), dict) else {}
            # on if the yaml says so, or the app's Gemini slider put a GEMINI flag file in the run folder (can be flipped mid-run)
            if (gem.get("enabled") or (run_dir / GEMINI_FLAG).exists()) and gemini_due(run_dir, cycle, int(gem.get("every_cycles", 20)), time.time(), int(gem.get("max_per_day", 10))):
                answer = gemini_ask(report, ideas, moods, model=gem.get("model", "auto"))
                gemini_record(run_dir, answer["ok"], time.time())      # a failure (e.g. quota used up) is retried later with back-off
                with (run_dir / "ideas_gemini.jsonl").open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"cycle": cycle, **answer}) + "\n")
                print(f"cycle {cycle}: Gemini ideas: " + (", ".join(i.get("title", "?") for i in answer["ideas"][:5]) if answer["ok"] else f"unavailable ({answer['error']})"), flush=True)
            top = "; ".join(f"{i['id']} x{i['votes']}" for i in ideas["ideas"][:3]) or "none"
            print(f"cycle {cycle}: players' ideas this cycle: {top}", flush=True)
            pw = moods["play_when_in_mood"]
            print(f"cycle {cycle}: moods (mean peak) {moods['mean_peak']}; mistakes in vs out of mood: anger {pw['anger']['slip_in_mood']}/{pw['anger']['slip_otherwise']}, "
                  f"fear {pw['fear']['slip_in_mood']}/{pw['fear']['slip_otherwise']}, bored {pw['boredom']['slip_in_mood']}/{pw['boredom']['slip_otherwise']}; "
                  f"{moods['impulses']} emotional choices", flush=True)
    except Exception as e:  # a logging problem must never stop training
        print(f"cycle {cycle}: mood/idea logging failed ({type(e).__name__}: {str(e)[:150]})", flush=True)


def run_continuous(config_path: Path, resume: bool = False, max_cycles: int | None = None, run_id: str | None = None) -> int:
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    rules = json.loads((REPO / "config" / "rules.json").read_text(encoding="utf-8"))
    rules_hash = hashlib.sha256(json.dumps(rules).encode()).hexdigest()
    run_id, run_dir = find_run(cfg["name"], resume, run_id)
    (run_dir / "cycles").mkdir(parents=True, exist_ok=True)
    (run_dir / "checkpoints").mkdir(exist_ok=True)
    clear_stale_stop(run_dir / "STOP")     # a stale STOP must not end this run; one the app wrote after launching it stays
    stop = Stop(run_dir)
    keep = {"last": cfg.get("keep", {}).get("last", 20), "every": cfg.get("keep", {}).get("every", 10)}
    limits = {**cyc.DEFAULT_THRESHOLDS, **cfg.get("thresholds", {})}
    seed_everything(cfg["seed"])

    model = from_phase2(cfg["warm_start"])
    frozen = {k: v.detach().clone() for k, v in model.state_dict().items()}          # the older opponent in training worlds: the warm start
    state = {"run_id": run_id, "cycle": 0, "world_counter": 0, "started_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    actor, critic = trainable(model)
    optimizer = torch.optim.Adam([dict(params=actor, lr=cfg["lr_actor"]), dict(params=critic, lr=cfg["lr_critic"])])
    previous: dict[str, Any] | None = None
    code = code_identity(rules_hash)
    resume_dq: list[str] = []                     # notes for the first cycle after --resume (code changed since the checkpoint)
    code_change_msg: str | None = None
    stall_stop = int(cfg.get("stall_stop_cycles", 5))   # 0 turns the human_like_stall stop condition off
    anchor_weight = float(cfg.get("anchor_weight", 0.0))  # KL to the warm start (`frozen`) in every update; 0 = off
    season_hours = int(rules.get("season", {}).get("days", 56) * 24)
    if resume:
        ck = run_dir / "checkpoints"
        state = json.loads((ck / "state.json").read_text(encoding="utf-8"))
        model = load_persona_policy(ck / "latest.pt")
        actor, critic = trainable(model)
        optimizer = torch.optim.Adam([dict(params=actor, lr=cfg["lr_actor"]), dict(params=critic, lr=cfg["lr_critic"])])
        optimizer.load_state_dict(torch.load(ck / "optimizer.pt", weights_only=True))
        last = sorted((run_dir / "cycles").glob("*/report.json"))
        previous = json.loads(last[-1].read_text(encoding="utf-8")) if last else None
        state["cycle"] += 1                                                         # the checkpoint holds the last COMPLETED cycle
        print(f"resuming {run_id} at cycle {state['cycle']}", flush=True)
        resume_dq = resume_notes(saved_code(state, previous), code)
        for note in resume_dq:
            print(f"WARNING: {note}", flush=True)
        code_change_msg = next((n for n in resume_dq if n.startswith("code changed on resume")), None)
    state["code"] = code                                                            # saved with every checkpoint
    (run_dir / "SCHEMA.md").write_text(cyc.SCHEMA_MD, encoding="utf-8")
    print(f"run {run_id}: create {stop.file} to stop after the current cycle; reports in {run_dir}", flush=True)

    ran, total_worlds, last_report, stop_reason = 0, state.get("training_worlds_total", 0), None, None
    eval_cfg = cfg["eval"]
    workers = cfg.get("workers", 10)
    with mp.get_context("spawn").Pool(workers, initializer=_ignore_sigint) as pool:
        while not stop and (max_cycles is None or ran < max_cycles):
            cycle, began = state["cycle"], time.time()
            while shutil.disk_usage(run_dir).free < cfg.get("min_free_gb", 2) * 2**30 and not stop:
                print("low disk space: paused (free space or create STOP)", flush=True)
                time.sleep(30)
            if stop:
                break
            print(f"cycle {cycle}: started (collect, learn, evaluate, report)", flush=True)
            old_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            # 1. collect
            tasks, seeds = [], []
            for _ in range(cfg["worlds_per_cycle"]):
                seed = 100000 + state["world_counter"]
                tasks.append(dict(seed=seed, difficulty=DIFFICULTIES[state["world_counter"] % 3], map_seed=f"live-{seed}", slots=world_slots(state["world_counter"]), n_bots=cfg.get("n_bots", 30),
                                  state=old_state, frozen_state=frozen, hidden=model.hidden, architecture=model.architecture, explore=True))
                seeds.append(seed)
                state["world_counter"] += 1
            train_results = pool.map(run_league, tasks)
            total_worlds += len(tasks)
            episodes = [e for r in train_results for e in r["episodes"]]
            rejected = sum(p["rejected"] for r in train_results for p in r["players"])
            # 2. learn
            diverged, update = False, {"samples": 0, "loss": None, "clip_fraction": None}
            try:
                update = update_persona(model, episodes, optimizer, cfg["ppo_epochs"], cfg["gamma"], cfg["seed"] + cycle,
                                        anchor_state=frozen, anchor_weight=anchor_weight)
            except RuntimeError as e:
                diverged = True
                model.load_state_dict(old_state)          # keep the last good weights
                print(f"STOP: {e}", flush=True)
            new_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            del train_results, episodes
            # 3. evaluate on fixed held-out worlds
            report_dir = run_dir / "cycles" / f"{cycle:06d}"
            tmp = report_dir / "_replay"
            tmp.mkdir(parents=True, exist_ok=True)
            run_eval = cycle % eval_cfg.get("every", 1) == 0 and not diverged
            eval_results: list[dict[str, Any]] = []
            sensitivity: dict[str, Any] | None = None
            if run_eval:
                etasks = []
                for s in eval_cfg["seeds"]:
                    for d in eval_cfg["difficulties"]:
                        base = dict(seed=s, difficulty=d, map_seed=f"heldout-{s}", hidden=model.hidden, architecture=model.architecture, n_bots=cfg.get("n_bots", 30))
                        for cond, st in (("H", new_state), ("O", new_state), ("P4", None), ("HP", old_state)):
                            human = cond in ("H", "HP")                       # HP = last cycle's weights as a human-like cohort
                            slots = [dict(sl, train=(cond == "H")) for sl in slots_for("H")] if human else slots_for(cond)
                            replay = tmp / f"{cond}-{s}-{d}.json" if cond in ("O", "P4") else None
                            etasks.append(dict(base, condition="H" if human else cond, tag=cond, slots=slots, state=st,
                                               replay_path=str(replay.resolve()) if replay else None))
                eval_results = pool.map(eval_worker, etasks)
                for r, t in zip(eval_results, etasks):
                    r["condition"] = t["tag"]            # HP = previous agent's human-like cohort
                rows = [x for r in eval_results if r["condition"] == "H" for ep in r["episodes"] for x in ep["rows"]]
                if rows:
                    pick = np.random.default_rng(cfg["seed"] + cycle).choice(len(rows), size=min(1500, len(rows)), replace=False)
                    sensitivity = persona_sensitivity(model, np.stack([rows[i][0] for i in pick]), np.stack([rows[i][1] for i in pick]), HUMAN_PERSONAS)
                for r in eval_results:
                    r["episodes"] = []
            rejected += sum(p.get("rejected", 0) for r in eval_results for p in r["players"])
            # 4. health
            health = {"training": {"updated": not diverged, "loss": update["loss"], "clip_fraction": update["clip_fraction"], "finite": not diverged, "samples": update["samples"],
                                   "anchor_weight": anchor_weight, "anchor_kl": update.get("anchor_kl")},
                      "determinism": determinism_check(),
                      "parity": parity_check() if cfg.get("parity_every", 10) and cycle % cfg["parity_every"] == 0 else {"checked": False, "ok": None, "detail": "not scheduled this cycle"},
                      "legality": {"rejected_actions": int(rejected)},
                      "stop_conditions": {"diverged": diverged, "persona_collapse": bool(sensitivity and sensitivity["mean_pair_kl"] < 1e-4 and sensitivity["argmax_all_agree"] > 0.99),
                                          "low_disk": False}}
            # 5. analyse + 6. report
            metrics = cyc.metrics_from(eval_results, sensitivity) if eval_results else (previous["metrics"] if previous else None)
            if metrics is None:
                raise SystemExit("the first cycle must include an evaluation (eval.every must divide cycle 0)")
            stalled = cyc.stalled_difficulties(metrics, cyc.start_worth(eval_results, limits), limits)
            state["stall_streak"] = stall_streak(int(state.get("stall_streak", 0)), stalled, cyc.evaluated_difficulties(metrics), bool(eval_results))
            health["stop_conditions"]["human_like_stall"] = bool(stall_stop and state["stall_streak"] >= stall_stop)
            realism_now, best_realism, drift = realism_step(state, metrics, eval_results, health, limits, season_hours, cfg["seed"] + cycle)
            def replay_path(r: dict[str, Any]) -> str:
                return "../" + (report_dir / "replay" / f"O-{r['seed']}-{r['difficulty']}.json").relative_to(REPO).as_posix()   # as run from server/
            dest = {(r["seed"], r["difficulty"]): replay_path(r) for r in eval_results if r["condition"] == "O"}
            found = cyc.findings_from(cycle, metrics, previous, eval_results, health, rules, limits, dest, realism_drift=drift)
            report = {"schema_version": "1.0",
                      "run": {"run_id": run_id, "cycle": cycle, "git_commit": code["git_commit"], "working_tree_dirty": code["working_tree_dirty"], "rules_hash": rules_hash,
                              "simulator_hash": code["simulator_hash"], "code_change_on_resume": code_change_msg if ran == 0 else None,
                              "seeds": {"training": seeds, "evaluation": list(eval_cfg["seeds"])}, "difficulty_mix": {d: sum(t["difficulty"] == d for t in tasks) for d in ("easy", "normal", "hard")},
                              "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(began)), "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                              "seconds": round(time.time() - began, 1), "final": False, "stop_reason": None},
                      "progress": {"previous_cycle": previous["run"]["cycle"] if previous else None, "deltas": cyc.deltas_from(metrics, previous),
                                   "baselines": {k: metrics["cohorts"][k] for k in ("plan_4h", "previous_agent", "optimal")}},
                      "metrics": metrics, "findings": found, "health": health,
                      "data_quality": {"training_worlds_this_cycle": len(tasks), "training_worlds_total": total_worlds, "evaluation_worlds": len({(r["seed"], r["difficulty"]) for r in eval_results}),
                                       "real_sessions": real_sessions(), "notes": ["persona parameters, churn and quits are assumptions", "evaluation medians are descriptive, not proof",
                                                                                   "no real playtester data: human_likeness is null"] + ([] if run_eval else ["evaluation skipped this cycle; metrics carried over"])
                                                + (resume_dq if ran == 0 else [])}}
            players_rows = [dict(condition=r["condition"], **{k: v for k, v in p.items() if not isinstance(v, (dict, list)) and k not in ("mood_play", "mood_peak", "lessons")},
                                 **{f"peak_{m}": (p.get("mood_peak") or {}).get(m) for m in MOODS}) for r in eval_results for p in r["players"]]
            cyc.write_cycle(report_dir, report, players_rows)
            wanted = {Path(f["evidence"]["replay_command"].split()[-1]).name for f in found if f["evidence"]["replay_command"]}
            (report_dir / "replay").mkdir(exist_ok=True)
            for f in tmp.glob("O-*.json"):
                if f.name in wanted:
                    shutil.copy(f, report_dir / "replay" / f.name)
            shutil.rmtree(tmp, ignore_errors=True)
            if not any((report_dir / "replay").iterdir()):
                (report_dir / "replay").rmdir()
            cyc.update_run_files(run_dir, report, f"cycles/{cycle:06d}/report.json")
            state.update(cycle=cycle, training_worlds_total=total_worlds)
            if not diverged:
                if best_realism:
                    (run_dir / "checkpoints").mkdir(exist_ok=True)
                    model.save(run_dir / "checkpoints" / "best_realism.pt", cycle=cycle)
                    state["best_realism"] = {"cycle": cycle, **realism_now}
                    print(f"cycle {cycle}: new best_realism.pt (recruited distance {realism_now['distance']:.3f}, AUC {realism_now['auc']})", flush=True)
                save_checkpoint(run_dir, model, optimizer, state, keep)
            rotate(run_dir / "cycles", keep["last"], keep["every"])
            print(f"cycle {cycle}: {len(found)} finding(s), human-like medians {report['metrics']['cohorts']['human_like']}, {report['run']['seconds']:.0f}s", flush=True)
            record_moods_and_ideas(run_dir, cfg, cycle, report, eval_results)
            previous, last_report = report, report
            state["cycle"] = cycle + 1
            ran += 1
            if diverged:
                stop_reason = "training diverged (non-finite loss); last good weights kept"
                break
            if health["stop_conditions"]["persona_collapse"]:
                stop_reason = "personas collapsed into one behaviour (persona sensitivity ~0)"
                break
            if health["stop_conditions"]["human_like_stall"]:
                stop_reason = (f"human-like players stalled at the start net worth on every difficulty for {state['stall_streak']} cycles in a row "
                               f"while optimal earned over {limits.get('stall_optimal_ratio', 2.0)}x it (human_like_stall; stall_stop_cycles={stall_stop})")
                print(f"STOP: {stop_reason}", flush=True)
                break
    if last_report is not None:
        last_report["run"]["final"] = True
        last_report["run"]["stop_reason"] = stop_reason or ("STOP file or Ctrl-C" if stop else "max cycles reached")
        done = run_dir / "cycles" / f"{last_report['run']['cycle']:06d}"
        cyc.write_cycle(done, last_report, [])
        cyc.update_run_files(run_dir, last_report, f"cycles/{last_report['run']['cycle']:06d}/report.json", rewrite_latest_only=True)
    print(f"stopped after {ran} cycle(s)" + (f": {stop_reason}" if stop_reason else ""), flush=True)
    return ran
