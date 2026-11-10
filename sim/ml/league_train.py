"""Bounded CPU league training for persona-conditioned agents (Phase 3).

    python -m sim.ml.league_train sim/ml/config/experiments/phase3.yaml --out sim/ml/runs/phase3 --workers 4

The Phase 2 policy (the warm start) stays frozen. PPO trains only the persona corrections (per-candidate score offset and
greediness) and the value heads, on persona-shaped rewards from league worlds. Each world has 6 learner slots: three
human-like personas (`current`, training), one optimal-flavour agent (`current`, NOT training: it stays in the world as
a reference opponent and the skill-ceiling baseline, so its hourly greedy play never pulls the shared policy towards
"best at the game"), one human-like persona driven by the frozen warm-start copy (an older opponent), and one scripted
`base_plan` (4-hour check-ins) as a fixed opponent. Personas rotate so every persona gets equal training worlds.

The goal is players that behave like real ones, not the strongest ones, so update_persona normalises advantages within
each persona (a high-earning persona cannot drown out the others) and can add a KL anchor to a frozen reference policy
(`anchor_state`, `anchor_weight`; config key `anchor_weight`, default 0 = off) that keeps the policy near the warm start.
"""
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

from .league import run_league
from .persona_policy import PersonaPolicy, from_phase2
from .personas.persona import HUMAN_PERSONAS
from .policy import CandidatePolicy, seed_everything
from .rollout import advantages
from .run import git_commit, source_metadata

DIFFICULTIES = ("easy", "normal", "hard")


def trainable(model: PersonaPolicy) -> tuple[list, list]:
    for p in model.parameters():
        p.requires_grad_(False)
    actor = [*model.adjust.parameters(), *model.greed.parameters()]
    critic = [*model.base.value_head.parameters(), *model.value_adjust.parameters()]
    for p in actor + critic:
        p.requires_grad_(True)
    return actor, critic


def normalise_by_persona(advantage: np.ndarray, personas: list[str]) -> np.ndarray:
    """Standardise advantages within each persona's rows (one persona's reward scale must not dominate the others)."""
    out = np.asarray(advantage, dtype=np.float64).copy()
    labels = np.asarray(personas, dtype=object)
    for name in dict.fromkeys(personas):
        idx = labels == name
        a = out[idx]
        out[idx] = (a - a.mean()) / max(float(a.std()), 1e-6)
    return out


def reference_policy(model: PersonaPolicy, state: dict) -> PersonaPolicy:
    """A frozen copy of `model`'s architecture loaded with `state` (the KL anchor's reference)."""
    reference = PersonaPolicy(CandidatePolicy(model.k, model.hidden, model.architecture), model.persona_dim)
    reference.load_state_dict(state)
    for p in reference.parameters():
        p.requires_grad_(False)
    return reference.eval()


def update_persona(model: PersonaPolicy, episodes: list[dict], optimizer, epochs: int, gamma: float, seed: int,
                   anchor_state: dict | None = None, anchor_weight: float = 0.0) -> dict:
    """Clipped PPO with masks and hour discounts, over episodes from several personas at once.

    Advantages are normalised per episode persona (episodes carry "persona"; missing = one shared group). With
    `anchor_state` and `anchor_weight` > 0 the loss gains anchor_weight * KL(reference || current) on each batch, where the
    reference is a frozen PersonaPolicy built from `anchor_state` (cf. the behaviour-cloning anchor in agents/ppo.py)."""
    rows = [r for ep in episodes for r in ep["rows"]]
    adv, returns = zip(*(advantages(ep["rows"], gamma) for ep in episodes))
    obs = torch.as_tensor(np.stack([r[0] for r in rows]))
    masks = torch.as_tensor(np.stack([r[1] for r in rows]))
    actions = torch.as_tensor([r[2] for r in rows])
    old_log = torch.as_tensor([r[4] for r in rows])
    targets = torch.as_tensor(np.concatenate(returns))
    labels = [str(ep.get("persona", "_all")) for ep in episodes for _ in ep["rows"]]
    advantage = torch.as_tensor(normalise_by_persona(np.concatenate(adv), labels), dtype=targets.dtype)
    reference = reference_policy(model, anchor_state) if anchor_state is not None and anchor_weight else None
    generator = torch.Generator().manual_seed(seed)
    actor, critic = [g["params"] for g in optimizer.param_groups]
    losses, clipped, kls = [], [], []
    model.train()
    for _ in range(epochs):
        for batch in torch.randperm(len(rows), generator=generator).split(256):
            distribution, values = model(obs[batch], masks[batch])
            ratio = (distribution.log_prob(actions[batch]) - old_log[batch]).exp()
            surrogate = torch.minimum(ratio * advantage[batch], ratio.clamp(0.8, 1.2) * advantage[batch])
            loss = (-surrogate.mean() + 0.5 * ((values - targets[batch]) / model.value_std).square().mean()
                    - 0.001 * distribution.entropy().mean())
            if reference is not None:
                with torch.no_grad():
                    anchor_dist, _ = reference(obs[batch], masks[batch])
                kl = torch.distributions.kl_divergence(anchor_dist, distribution).mean()
                loss = loss + anchor_weight * kl
                kls.append(float(kl.detach()))
            if not torch.isfinite(loss):
                raise RuntimeError("non-finite PPO loss; training stopped")
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(actor, 0.5)
            torch.nn.utils.clip_grad_norm_(critic, 0.5)
            optimizer.step()
            losses.append(float(loss.detach()))
            clipped.append(float(((ratio - 1).abs() > 0.2).float().mean()))
    model.eval()
    out = {"samples": len(rows), "loss": losses[-1], "clip_fraction": float(np.mean(clipped))}
    if reference is not None:
        out["anchor_kl"] = float(np.mean(kls))
    return out


def world_slots(world: int) -> list[dict]:
    """Slot layout for training world number `world` (personas rotate through the eight human-like ones). The optimal slot is
    a reference opponent only (train=False): it plays with the current weights but contributes no PPO rows."""
    pick = lambda j: HUMAN_PERSONAS[(3 * world + j) % len(HUMAN_PERSONAS)]
    return [dict(persona=pick(0), flavour="human", train=True), dict(persona=pick(1), flavour="human", train=True),
            dict(persona=pick(2), flavour="human", train=True), dict(persona="optimal", flavour="optimal", train=False),
            dict(persona=pick(3), flavour="human", model="frozen"), dict(persona="base_plan", control="scripted")]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--out", type=Path, default=Path("sim/ml/runs/phase3"))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(cfg["seed"])
    model = from_phase2(cfg["warm_start"])
    frozen = {k: v.detach().clone() for k, v in model.state_dict().items()}
    actor, critic = trainable(model)
    optimizer = torch.optim.Adam([dict(params=actor, lr=cfg["lr_actor"]), dict(params=critic, lr=cfg["lr_critic"])])
    history = {"config": cfg, "git": git_commit(), **source_metadata(), "device": "cpu", "workers": args.workers,
               "torch_version": str(torch.__version__), "iterations": []}
    started = time.perf_counter()
    world_counter = 0
    with mp.get_context("spawn").Pool(args.workers) as pool:
        for iteration in range(cfg["iterations"]):
            state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            tasks = []
            for i in range(cfg["worlds_per_iteration"]):
                seed = 5000 + world_counter
                tasks.append(dict(seed=seed, difficulty=DIFFICULTIES[world_counter % 3], map_seed=f"p3-{seed}", slots=world_slots(world_counter),
                                  state=state, frozen_state=frozen, hidden=model.hidden, architecture=model.architecture, explore=True))
                world_counter += 1
            results = pool.map(run_league, tasks)
            episodes = [e for r in results for e in r["episodes"]]
            if any(p["rejected"] for r in results for p in r["players"]):
                raise RuntimeError("a candidate action was rejected by the engine")
            record = {"iteration": iteration, "episodes": len(episodes), "update": update_persona(
                model, episodes, optimizer, cfg["ppo_epochs"], cfg["gamma"], cfg["seed"] + iteration,
                anchor_state=frozen, anchor_weight=cfg.get("anchor_weight", 0.0))}
            by_persona: dict[str, list[float]] = {}
            for r in results:
                for p in r["players"]:
                    by_persona.setdefault(f"{p['persona']}:{p['flavour']}:{p['model']}", []).append(p["final_worth"])
            record["mean_worth"] = {k: float(np.mean(v)) for k, v in sorted(by_persona.items())}
            record["quits"] = sum(p["quit_tick"] is not None for r in results for p in r["players"])
            history["iterations"].append(record)
            history["elapsed_seconds"] = time.perf_counter() - started
            (args.out / "training.json").write_text(json.dumps(history, indent=2, allow_nan=False), encoding="utf-8")
            model.save(args.out / "latest.pt", config=cfg, iteration=iteration)
            print(json.dumps({"iteration": iteration, "update": record["update"], "elapsed": round(history["elapsed_seconds"])}), flush=True)
    model.save(args.out / "final.pt", config=cfg)
    print(f"Saved {args.out / 'final.pt'}", flush=True)


if __name__ == "__main__":
    main()
