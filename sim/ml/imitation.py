"""Behaviour cloning from recorded scripted candidate selections."""
from __future__ import annotations

import numpy as np
import torch

from .policy import CandidatePolicy


def clone(model: CandidatePolicy, rows: list, epochs: int = 30, seed: int = 1, returns: np.ndarray | None = None) -> dict:
    obs = torch.as_tensor(np.stack([r[0] for r in rows]))
    masks = torch.as_tensor(np.stack([r[1] for r in rows]))
    actions = torch.as_tensor([r[2] for r in rows])
    targets = torch.as_tensor(returns) if returns is not None else None
    if targets is not None:
        model.value_mean.copy_(targets.mean())
        model.value_std.copy_(targets.std(unbiased=False).clamp_min(0.1))
    generator = torch.Generator().manual_seed(seed)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    losses = []
    for _ in range(epochs):
        for indices in torch.randperm(len(rows), generator=generator).split(256):
            distribution, values = model(obs[indices], masks[indices])
            loss = -distribution.log_prob(actions[indices]).mean()
            if targets is not None:
                loss += 0.5 * ((values - targets[indices]) / model.value_std).square().mean()
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()
            losses.append(float(loss.detach()))
    with torch.no_grad():
        correct = 0
        for batch in torch.arange(len(rows)).split(512):
            distribution, _ = model(obs[batch], masks[batch])
            correct += int((distribution.logits.argmax(-1) == actions[batch]).sum())
        accuracy = correct / len(rows)
    return {"samples": len(rows), "epochs": epochs, "last_loss": losses[-1], "training_accuracy": accuracy,
            "value_prefit": targets is not None, "value_mean": float(model.value_mean), "value_std": float(model.value_std)}
