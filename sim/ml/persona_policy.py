"""Persona-conditioned policy: the Phase 2 candidate policy plus small persona-dependent corrections.

Layout of an observation: [global | k x candidate | persona]. The base policy never sees the persona part, and every
correction is zero-initialised, so a freshly wrapped Phase 2 checkpoint behaves exactly like the original until it is
trained. Corrections: a per-candidate score from (persona, candidate features), a persona-dependent greediness, and a
persona-dependent value offset (returns depend on what each persona rewards). Kept in its own module so policy.py,
which the Phase 2 work edits, is untouched.
"""
from __future__ import annotations

import io

import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

from .env import ACTION_KINDS, CAND_FEATURES, EXTENDED_FEATURES, LEARNING_GLOBAL_FEATURES
from .personas.persona import PERSONA_DIM, VECTOR_NAMES
from .policy import CandidatePolicy, load_policy

MASKED = -1e8   # base logits at or below this are padding

# Hand-set prior (logit offsets): what each persona weight does to the appetite for an action kind, and to the weight put on the quoted
# profit. These are ASSUMPTIONS in the same sense as config/personas.yaml: they make personas differ by construction, and training then
# refines them (the heads stay trainable). Before this, zero-initialised corrections never moved and every persona acted alike.
KIND_PRIOR = {("buyShip", "w_new_ship"): 3.0, ("raid", "w_raid_win"): 3.0, ("raid", "pirate"): 2.0, ("empty", "w_empty_run"): -6.0,
              ("wait", "w_idle"): -2.0, ("carry", "w_empty_run"): -1.0}
PROFIT_PRIOR = {"w_big_deal": 1.5, "w_thin_margin": 1.0}
SMALL_HULL_PRIOR = {"pirate": 4.0}   # a pirate persona prefers the small fast hull when buying a ship (buyShip is one action kind for all hulls)
CAPACITY_FEATURE, SMALL_HULL = 20, 0.4   # candidate feature "capacity / 100"; below 0.4 means the 30-hold pirate ship


class PersonaPolicy(nn.Module):
    def __init__(self, base: CandidatePolicy | None = None, persona_dim: int = PERSONA_DIM, hidden: int = 32) -> None:
        super().__init__()
        self.base = base or CandidatePolicy()
        self.k, self.persona_dim = self.base.k, persona_dim
        self.architecture, self.hidden = self.base.architecture, self.base.hidden
        self.adjust = nn.Sequential(nn.Linear(persona_dim + EXTENDED_FEATURES, hidden), nn.Tanh(), nn.Linear(hidden, 1))
        self.greed = nn.Linear(persona_dim, 1)
        self.value_adjust = nn.Sequential(nn.Linear(persona_dim + 3, hidden), nn.Tanh(), nn.Linear(hidden, 1))
        self.kind_head = nn.Linear(persona_dim, len(ACTION_KINDS), bias=False)    # persona -> appetite per action kind
        self.profit_head = nn.Linear(persona_dim, 1, bias=False)                  # persona -> weight on quoted profit
        self.small_head = nn.Linear(persona_dim, 1, bias=False)                   # persona -> appetite for buying a small hull
        for last in (self.adjust[-1], self.greed, self.value_adjust[-1], self.kind_head, self.profit_head, self.small_head):
            nn.init.zeros_(last.weight)
            if last.bias is not None:
                nn.init.zeros_(last.bias)

    @torch.no_grad()
    def apply_prior(self) -> "PersonaPolicy":
        """Fill the kind and profit heads from the hand-set prior above."""
        for (kind, entry), weight in KIND_PRIOR.items():
            self.kind_head.weight[ACTION_KINDS.index(kind), VECTOR_NAMES.index(entry)] = weight
        for entry, weight in PROFIT_PRIOR.items():
            self.profit_head.weight[0, VECTOR_NAMES.index(entry)] = weight
        for entry, weight in SMALL_HULL_PRIOR.items():
            self.small_head.weight[0, VECTOR_NAMES.index(entry)] = weight
        return self

    @property
    def value_std(self) -> torch.Tensor:
        return self.base.value_std

    def forward(self, obs: torch.Tensor, mask: torch.Tensor):
        persona, core = obs[:, -self.persona_dim:], obs[:, :-self.persona_dim]
        distribution, value = self.base(core, mask)
        candidates = core[:, LEARNING_GLOBAL_FEATURES:].reshape(-1, self.k, EXTENDED_FEATURES)
        pad = distribution.logits <= MASKED
        shifted = distribution.logits.masked_fill(pad, 0.0)
        scale = torch.exp(self.greed(persona).clamp(-1, 1))
        offset = self.adjust(torch.cat((persona[:, None, :].expand(-1, self.k, -1), candidates), dim=-1)).squeeze(-1)
        kinds = candidates[:, :, CAND_FEATURES:CAND_FEATURES + len(ACTION_KINDS)]
        small_buy = kinds[:, :, ACTION_KINDS.index("buyShip")] * (candidates[:, :, CAPACITY_FEATURE] < SMALL_HULL).float()
        offset = (offset + (kinds * self.kind_head(persona)[:, None, :]).sum(-1) + self.profit_head(persona) * candidates[:, :, 1]
                  + self.small_head(persona) * small_buy)
        logits = (shifted * scale + offset).masked_fill(pad, -1e9)
        glob = core[:, :3]   # season progress, cash, worth: all the value offset needs
        value = value + self.value_adjust(torch.cat((persona, glob), dim=-1)).squeeze(-1) * self.base.value_std
        return Categorical(logits=logits), value

    @torch.no_grad()
    def act(self, obs: np.ndarray, mask: np.ndarray, deterministic: bool = False) -> tuple[int, float, float]:
        distribution, value = self(torch.as_tensor(obs[None]), torch.as_tensor(mask[None]))
        action = distribution.logits.argmax(-1) if deterministic else distribution.sample()
        return int(action.item()), float(distribution.log_prob(action).item()), float(value.item())

    def save(self, path, **metadata) -> None:
        buffer = io.BytesIO()
        self.base.save(buffer)
        torch.save({"base": buffer.getvalue(), "persona_state": {k: v for k, v in self.state_dict().items() if not k.startswith("base.")},
                    "persona_dim": self.persona_dim, **metadata}, path)


def load_persona_policy(path) -> PersonaPolicy:
    data = torch.load(path, map_location="cpu", weights_only=True)
    base = load_policy(io.BytesIO(data["base"]))
    model = PersonaPolicy(base, data["persona_dim"])
    # strict=False: checkpoints from before the kind/profit heads existed load with those heads at zero.
    model.load_state_dict({**{f"base.{k}": v for k, v in base.state_dict().items()}, **data["persona_state"]}, strict=False)
    model.eval()
    return model


def from_phase2(path, prior: bool = True) -> PersonaPolicy:
    """Wrap a Phase 2 checkpoint. With prior=False it behaves exactly like the original until trained; with the prior (default)
    personas already differ in what they want, and the heads stay trainable."""
    model = PersonaPolicy(load_policy(path))
    if prior:
        model.apply_prior()
    model.eval()
    return model
