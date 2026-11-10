"""Shared candidate scorer and value head; all tensors stay on CPU."""
from __future__ import annotations

import random
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

from .env import LEARNING_GLOBAL_FEATURES as GLOBAL_FEATURES, EXTENDED_FEATURES, ACTION_KINDS


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)


class CandidatePolicy(nn.Module):
    def __init__(self, k: int = 32, hidden: int = 64, architecture: str = "residual") -> None:
        super().__init__()
        self.k, self.hidden = k, hidden
        self.architecture = architecture
        self.scorer = nn.Sequential(nn.Linear(GLOBAL_FEATURES + EXTENDED_FEATURES, hidden), nn.Tanh(),
                                    nn.Linear(hidden, hidden), nn.Tanh(), nn.Linear(hidden, 1))
        self.value_head = nn.Sequential(nn.Linear(GLOBAL_FEATURES + EXTENDED_FEATURES, hidden), nn.Tanh(), nn.Linear(hidden, 1))
        self.planning_weight = nn.Parameter(torch.tensor(1.0))
        self.eligibility_weight = nn.Parameter(torch.tensor(1.0))
        self.kind_bias = nn.Parameter(torch.zeros(len(ACTION_KINDS)))
        self.forecast_weights = nn.Parameter(torch.zeros(3, 2))
        self.log_temperature = nn.Parameter(torch.tensor(1.0))
        self.register_buffer("value_mean", torch.tensor(0.0))
        self.register_buffer("value_std", torch.tensor(1.0))
        if architecture == "residual":
            nn.init.zeros_(self.scorer[-1].weight)
            nn.init.zeros_(self.scorer[-1].bias)

    def forward(self, obs: torch.Tensor, mask: torch.Tensor):
        global_features = obs[:, :GLOBAL_FEATURES]
        candidates = obs[:, GLOBAL_FEATURES:].reshape(-1, self.k, EXTENDED_FEATURES)
        repeated = global_features[:, None, :].expand(-1, self.k, -1)
        logits = self.scorer(torch.cat((repeated, candidates), dim=-1)).squeeze(-1)
        if self.architecture == "residual":
            logits = (0.25 * logits.tanh() + self.planning_weight * candidates[:, :, 21]
                      + self.eligibility_weight * candidates[:, :, 23]
                      + (candidates[:, :, 6:18] * self.kind_bias).sum(-1))
            forecast = global_features[:, 8:11] @ self.forecast_weights
            logits = logits + (candidates[:, :, 24:26] * forecast[:, None, :]).sum(-1)
            logits = logits * self.log_temperature.clamp(-2, 4).exp()
        logits = logits.masked_fill(~mask.bool(), -1e9)
        pooled = (candidates * mask[:, :, None]).sum(1) / mask.sum(1).clamp_min(1)[:, None]
        value = self.value_head(torch.cat((global_features, pooled), dim=-1)).squeeze(-1) * self.value_std + self.value_mean
        return Categorical(logits=logits), value

    @torch.no_grad()
    def act(self, obs: np.ndarray, mask: np.ndarray, deterministic: bool = False) -> tuple[int, float, float]:
        distribution, value = self(torch.as_tensor(obs[None]), torch.as_tensor(mask[None]))
        action = distribution.logits.argmax(-1) if deterministic else distribution.sample()
        return int(action.item()), float(distribution.log_prob(action).item()), float(value.item())

    def save(self, path, **metadata) -> None:
        torch.save({"state": self.state_dict(), "k": self.k, "hidden": self.hidden, "architecture": self.architecture,
                    "global_features": GLOBAL_FEATURES, "candidate_features": EXTENDED_FEATURES, **metadata}, path)


def load_policy(path) -> CandidatePolicy:
    data = torch.load(path, map_location="cpu", weights_only=True)
    model = CandidatePolicy(data["k"], data["hidden"], data.get("architecture", "legacy"))
    old_global = data.get("global_features", 8)
    old_candidate = data.get("candidate_features", data["state"]["scorer.0.weight"].shape[1] - old_global)
    if old_global != GLOBAL_FEATURES or old_candidate != EXTENDED_FEATURES:
        if old_global > GLOBAL_FEATURES or old_candidate > EXTENDED_FEATURES:
            raise ValueError("unsupported checkpoint observation version")
        for key in ("scorer.0.weight", "value_head.0.weight"):
            old = data["state"][key]
            padded = torch.zeros((old.shape[0], GLOBAL_FEATURES + EXTENDED_FEATURES), dtype=old.dtype)
            padded[:, :old_global] = old[:, :old_global]
            padded[:, GLOBAL_FEATURES:GLOBAL_FEATURES + old_candidate] = old[:, old_global:]
            data["state"][key] = padded
    defaults = model.state_dict()
    for key in defaults:
        data["state"].setdefault(key, defaults[key])
    model.load_state_dict(data["state"])
    model.eval()
    return model
