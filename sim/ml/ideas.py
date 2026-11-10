"""Game ideas proposed by the simulated players.

Each human-like player, at the end of a season, proposes up to two ideas that answer what hurt or bored it: raids, fines, forced sales,
running out of cash, idle ships, a stuck rank, or what it enjoyed (ships, raid wins). The idea comes from a fixed catalogue
(a template, not creativity), picked and weighted by the player's own events and peak moods. This tells you which complaints
the simulated players have, never whether real players want the idea. Every idea needs your approval and a rules change is a
suggestion only: nothing here edits config/rules.json.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

# id -> (idea, which sim evidence triggers it, how it could be tried)
CATALOGUE: dict[str, dict[str, str]] = {
    "raid_insurance": {"idea": "Optional insurance or a convoy escort so a raid costs less than a whole cargo",
                       "why": "players were raided and got scared or angry", "try": "new mechanic; approximate with a lower pirate loot share in a what-if"},
    "fine_warning": {"idea": "A warning or a shorter lockout before a fine or confiscation",
                     "why": "players were arrested/fined and got angry", "try": "what-if on the lockout/fine rule values"},
    "sale_grace": {"idea": "A grace period before a forced sale",
                   "why": "players had cargo or ships force-sold", "try": "what-if on the forced-sale timer"},
    "broke_loan": {"idea": "A small emergency loan or starter contract when nearly broke",
                   "why": "players ran low on cash and got afraid", "try": "new mechanic; approximate with extra starting cash in a what-if"},
    "offline_orders": {"idea": "Queue a route for a ship while away from the game",
                       "why": "players found ships idle or unable to move between check-ins", "try": "new mechanic (standing orders)"},
    "goals": {"idea": "Weekly goals or small challenges with a reward",
              "why": "players got bored while their rank was stuck", "try": "new mechanic"},
    "size_divisions": {"idea": "Leaderboards by company size, so a small company can still climb",
                       "why": "players watched their rank fall", "try": "new mechanic (UI + scoring)"},
    "ship_looks": {"idea": "Ship customisation and a fleet showcase",
                   "why": "players enjoyed buying ships", "try": "cosmetic; the sim cannot measure it"},
    "bounties": {"idea": "Bounties and rewards for pirates who raid the right targets",
                 "why": "players enjoyed winning raids but had few targets", "try": "what-if on raid loot or a bounty rule"},
    "return_loads": {"idea": "A board of return loads so ships do not sail empty",
                     "why": "players sailed empty or made thin-margin trades", "try": "UI; approximate with better planner hints"},
}


def propose(player: dict[str, Any]) -> list[tuple[str, float]]:
    """Up to two (idea id, strength 0..1) for one finished player, strongest first. Empty for players with no moods (optimal, scripted)."""
    peak = player.get("mood_peak")
    if not peak:
        return []
    events = Counter(player.get("quit_events") or [])
    kinds = player.get("kinds") or {}
    visits = max(1, player.get("visits", 1))
    score = {
        "raid_insurance": max(peak["fear"] * (player.get("raided", 0) > 0), min(1.0, player.get("raided", 0) / 3) * peak["anger"]),
        "fine_warning": min(1.0, player.get("arrested", 0) / 2) * max(peak["anger"], 0.4),
        "sale_grace": min(1.0, events["forced-sale"] / 2),
        "broke_loan": min(1.0, events["near-broke"] / 2) * max(peak["fear"], 0.4),
        "offline_orders": min(1.0, (events["no-move"] + events["idle"]) / 3) * max(peak["boredom"], 0.4),
        "goals": peak["boredom"] * 0.7 * (1.0 if events["rank-gain"] == 0 else 0.5),
        "size_divisions": min(1.0, events["rank-falling"] / 2),
        "ship_looks": min(1.0, kinds.get("buyShip", 0) / 3) * max(peak["elation"], 0.3),
        "bounties": min(1.0, kinds.get("raid", 0) / 3) * max(peak["elation"], 0.3) if kinds.get("raid", 0) else 0.0,
        "return_loads": min(1.0, kinds.get("empty", 0) / max(1.0, 0.25 * visits)) * 0.6,
    }
    ranked = sorted(((k, round(v, 3)) for k, v in score.items() if v >= 0.3), key=lambda kv: (-kv[1], kv[0]))
    return ranked[:2]


def cycle_ideas(players: list[dict[str, Any]]) -> dict[str, Any]:
    """Votes this cycle: per idea the number of players proposing it, their mean strength, and which personas proposed it."""
    votes: dict[str, dict[str, Any]] = {}
    moody = [p for p in players if p.get("mood_peak")]
    for p in moody:
        for idea, strength in propose(p):
            v = votes.setdefault(idea, {"votes": 0, "strength": 0.0, "personas": Counter()})
            v["votes"] += 1
            v["strength"] += strength
            v["personas"][p["persona"]] += 1
    ranked = [{"id": k, **CATALOGUE[k], "votes": v["votes"], "mean_strength": round(v["strength"] / v["votes"], 2), "personas": dict(v["personas"])}
              for k, v in sorted(votes.items(), key=lambda kv: (-kv[1]["votes"], -kv[1]["strength"], kv[0]))]
    return {"players": len(moody), "ideas": ranked,
            "note": "templated from simulated players' complaints and likes; not a measure of what real players want"}
