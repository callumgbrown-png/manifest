"""Seeded full-season collection for behaviour cloning, PPO and evaluation."""
from __future__ import annotations

from collections import Counter
import numpy as np

from .env import ManifestEnv
from .policy import CandidatePolicy, seed_everything


def collect(task: dict) -> dict:
    seed_everything(task["seed"])
    model = CandidatePolicy(task.get("k", 32), task.get("hidden", 64), task.get("architecture", "residual"))
    if task.get("state") is not None:
        model.load_state_dict(task["state"])
    model.eval()
    env = ManifestEnv(n_bots=task.get("n_bots", 30), n_learners=6, extended_actions=True, k=model.k,
                      difficulty=task["difficulty"], map_seed=task.get("map_seed"))
    rows, kinds = [], Counter()
    illegal = rejected = 0
    try:
        obs, info = env.reset(seed=task["seed"])
        done = False
        while not done:
            if task.get("expert"):
                action = next((i for i, c in enumerate(info["candidates"]) if c.get("expert")), 0)
                log_prob = value = 0.0
            else:
                action, log_prob, value = model.act(obs, info["action_mask"], task.get("deterministic", False))
            mask = info["action_mask"].copy()
            kinds[info["candidates"][action]["kind"]] += 1
            new_obs, reward, done, _, new_info = env.step(action)
            rows.append((obs, mask, action, reward, log_prob, value, new_info["elapsed_hours"], done))
            illegal += int(new_info["illegal"])
            rejected += new_info["rejected"] is not None
            obs, info = new_obs, new_info
        if task.get("replay_path"):
            env.dump_log(task["replay_path"])
        return {"seed": task["seed"], "difficulty": task["difficulty"], "map_seed": task.get("map_seed"),
                "worth": env.final_worth(), "digest": env.digest()["digest"], "illegal": illegal,
                "rejected": rejected, "rows": rows if not task.get("evaluation") else [], "kinds": dict(kinds)}
    finally:
        env.close()


def advantages(rows: list, gamma: float = 0.999, lam: float = 0.99) -> tuple[np.ndarray, np.ndarray]:
    """Semi-Markov GAE: discount elapsed game hours, including zero-hour sales."""
    result = np.zeros(len(rows), np.float32)
    next_value = gae = 0.0
    for i in reversed(range(len(rows))):
        _, _, _, reward, _, value, hours, done = rows[i]
        discount = gamma ** hours
        continuation = 0.0 if done else 1.0
        delta = reward + discount * next_value * continuation - value
        gae = delta + discount * (lam ** hours) * continuation * gae
        result[i] = gae
        next_value = value
    return result, result + np.asarray([r[5] for r in rows], np.float32)


def monte_carlo_returns(rows: list, gamma: float) -> np.ndarray:
    result = np.zeros(len(rows), dtype=np.float32)
    future = 0.0
    for i in reversed(range(len(rows))):
        future = rows[i][3] + gamma ** rows[i][6] * future * (not rows[i][7])
        result[i] = future
    return result
