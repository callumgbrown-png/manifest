"""Fidelity check (a): replay one persona's recorded play against the REAL server over WebSocket and compare with the bridge.

    python -m sim.ml.fidelity --ticks 168 --tick-ms 600

The bridge plays a scripted persona alone in a world (no bots, so nothing else depends on timing) and records its commands
by game hour. The same world is put into a throwaway SQLite database (same map, same register event, an account with a
known password), a real `main.ts` server is started on it with a short TICK_MS, and a Python WebSocket client logs in and
sends each command in the same game hour it was recorded in, exactly as a browser would. Then net worth, cash and every
command result are compared. This catches protocol, rate-limit, event-log and view differences the bridge cannot see.
It is not part of training; run it nightly/weekly. Needs `pip install websockets`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from websockets.sync.client import connect

from .bridge_client import Bridge, SERVER_DIR, find_node

def js_round(x: float) -> int:
    """Math.round: halves round up (Python's round() rounds them to even, which is not what the server shows)."""
    return math.floor(x + 0.5)


PASSWORD = "fidelity-test-pw"
ADMIN = "fidelity-admin-token-0123456789"


def record_bridge(seed: int, ticks: int, strat: str, difficulty: str, checkin: int, map_seed: str) -> dict[str, Any]:
    """Play one scripted persona alone for `ticks` game hours; return its commands by hour and the final state."""
    with Bridge() as br:
        w = br.call("reset", seed=seed, difficulty=difficulty, n_bots=0, n_learners=1, expected_companies=60, map_seed=map_seed)
        company = w["learners"][0]
        for t in range(0, ticks + 1):
            if t and t % checkin == 0:
                br.call("play", company=company, params=dict(strat=strat))
            if t < ticks:
                br.call("step", commands=[], hours=1)
        final = br.call("observe", company=company)
        path = Path(tempfile.mkdtemp(prefix="manifest-fidelity-")) / "dump.json"
        br.call("dump_log", path=str(path))
    dump = json.loads(path.read_text())
    commands: dict[int, list[dict]] = {}
    hour, setup = 0, []
    for entry in dump["log"]:
        if entry["k"] == "tick":
            hour += 1
        elif entry["cmd"]["type"] in ("register", "setDifficulty") and hour == 0 and not commands:
            setup.append(entry["cmd"])
        else:
            commands.setdefault(hour, []).append(entry["cmd"])
    return {"dump": dump, "company": company, "commands": commands, "setup": setup, "final": final, "ticks": ticks}


def build_database(path: Path, rec: dict[str, Any]) -> None:
    """A fresh server database: the bridge's map, its register/difficulty events, and a login for the learner."""
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE accounts (name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL, company INTEGER NOT NULL);
      CREATE TABLE world_map (id INTEGER PRIMARY KEY CHECK(id=1), map_json TEXT NOT NULL);""")
    db.execute("INSERT INTO world_map(id,map_json) VALUES(1,?)", (json.dumps(rec["dump"]["map"]),))
    at = "2000-01-01T00:00:00.000Z"
    for cmd in rec["setup"]:
        db.execute("INSERT INTO events(at,kind,payload) VALUES(?,?,?)", (at, cmd["type"], json.dumps(cmd)))
    register = next(c for c in rec["setup"] if c["type"] == "register")
    salt = hashlib.sha256(b"fidelity-salt").hexdigest()[:32]
    digest = hashlib.scrypt(PASSWORD.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024).hex()
    db.execute("INSERT INTO accounts(name,salt,hash,company) VALUES(?,?,?,?)", (register["name"], salt, digest, rec["company"]))
    db.commit()
    db.close()


def start_server(db_path: Path, tick_ms: int) -> tuple[subprocess.Popen, int, list[str]]:
    env = {**__import__("os").environ, "PORT": "0", "DB_PATH": str(db_path), "BOTS": "0", "TICK_MS": str(tick_ms),
           "ADMIN_TOKEN": ADMIN, "EXPECTED_COMPANIES": "60"}
    proc = subprocess.Popen([find_node(), "--no-warnings", "--import", "tsx", "src/main.ts"], cwd=SERVER_DIR, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    lines: list[str] = []
    deadline = time.time() + 60
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        lines.append(line)
        m = re.search(r"running on http://localhost:(\d+)", line)
        if m:
            return proc, int(m.group(1)), lines
    proc.kill()
    raise RuntimeError("server did not start:\n" + "".join(lines))


def replay_on_server(rec: dict[str, Any], tick_ms: int) -> dict[str, Any]:
    name = next(c for c in rec["setup"] if c["type"] == "register")["name"]
    with tempfile.TemporaryDirectory(prefix="manifest-fidelity-db-") as tmp:
        db_path = Path(tmp) / "game.db"
        build_database(db_path, rec)
        proc, port, _ = start_server(db_path, tick_ms)
        try:
            results: list[dict[str, Any]] = []
            late: list[int] = []
            with connect(f"ws://localhost:{port}/ws", max_size=None) as ws:
                ws.send(json.dumps({"type": "login", "name": name, "password": PASSWORD}))
                state: dict[str, Any] = {}
                token = None
                while token is None or not state.get("me"):
                    msg = json.loads(ws.recv(timeout=30))
                    if msg["type"] == "auth":
                        token = msg["token"]
                    elif msg["type"] == "authError":
                        raise RuntimeError(msg["error"])
                    elif msg["type"] == "state":
                        state = msg
                req = 0
                for hour in range(0, rec["ticks"] + 1):
                    while state["world"]["tick"] < hour:           # wait for the server's clock to reach this game hour
                        msg = json.loads(ws.recv(timeout=max(10, 5 * tick_ms / 1000)))
                        if msg["type"] == "state":
                            state = msg
                    if state["world"]["tick"] > hour and rec["commands"].get(hour):
                        late.append(hour)                          # the server moved on before we could act
                    for cmd in rec["commands"].get(hour, []):
                        req += 1
                        ws.send(json.dumps({"type": "cmd", "reqId": req, "cmd": {k: v for k, v in cmd.items() if k != "company"}}))
                        while True:
                            msg = json.loads(ws.recv(timeout=30))
                            if msg["type"] == "result" and msg["reqId"] == req:
                                results.append({"hour": hour, "type": cmd["type"], "ok": msg["ok"], "error": msg.get("error")})
                                break
                            if msg["type"] == "state":
                                state = msg
                # A fresh private view at exactly the final hour.
                ws.send(json.dumps({"type": "resume", "token": token}))
                while True:
                    msg = json.loads(ws.recv(timeout=30))
                    if msg["type"] == "state" and msg.get("me"):
                        state = msg
                        break
            me = state["me"]
            return {"tick": state["world"]["tick"], "worth": me["worth"], "cash": me["cash"], "ships": len(me["ships"]),
                    "results": results, "late_hours": late}
        finally:
            proc.kill()
            proc.wait(timeout=10)


def compare(rec: dict[str, Any], server: dict[str, Any], tolerance: float) -> dict[str, Any]:
    bridge = rec["final"]
    sent = [(h, c["type"]) for h in sorted(rec["commands"]) for c in rec["commands"][h]]
    mismatches = []
    if server["tick"] != rec["ticks"]:
        mismatches.append(f"server tick {server['tick']} != {rec['ticks']}")
    rejected = [r for r in server["results"] if not r["ok"]]
    if rejected:
        mismatches.append(f"{len(rejected)} commands rejected by the server, first: {rejected[0]}")
    if len(server["results"]) != len(sent):
        mismatches.append(f"{len(server['results'])} results for {len(sent)} commands")
    worth_diff = abs(server["worth"] - js_round(bridge["worth"])) / max(1.0, abs(bridge["worth"]))
    cash_diff = abs(server["cash"] - js_round(bridge["cash"])) / max(1.0, abs(bridge["worth"]))
    if worth_diff > tolerance:
        mismatches.append(f"worth: bridge {js_round(bridge['worth'])} server {server['worth']} ({worth_diff:.2%})")
    if cash_diff > tolerance:
        mismatches.append(f"cash: bridge {js_round(bridge['cash'])} server {server['cash']} ({cash_diff:.2%})")
    if server["ships"] != len(bridge["ships"]):
        mismatches.append(f"ships: bridge {len(bridge['ships'])} server {server['ships']}")
    return {"ok": not mismatches, "tolerance": tolerance, "ticks": rec["ticks"], "commands": len(sent),
            "bridge": {"worth": js_round(bridge["worth"]), "cash": js_round(bridge["cash"]), "ships": len(bridge["ships"])},
            "server": {k: server[k] for k in ("worth", "cash", "ships", "tick")}, "worth_diff": worth_diff,
            "late_hours": server["late_hours"], "mismatches": mismatches}


def timing_slipped(server: dict[str, Any], ticks: int) -> bool:
    """The client was too slow for the server clock (so a difference says nothing about the rules)."""
    return bool(server["late_hours"]) or server["tick"] != ticks


def run_fidelity(ticks: int = 168, tick_ms: int = 600, strat: str = "plan", seed: int = 7, difficulty: str = "normal",
                 checkin: int = 4, tolerance: float = 0.005, attempts: int = 3) -> dict[str, Any]:
    """Record once, replay on the server. If the client could not keep up with the server clock (a loaded machine), retry
    with a slower clock rather than report a bogus mismatch; a divergence with good timing fails at once."""
    rec = record_bridge(seed, ticks, strat, difficulty, checkin, f"fidelity-{seed}")
    for attempt in range(1, attempts + 1):
        server = replay_on_server(rec, tick_ms)
        if not timing_slipped(server, ticks) or attempt == attempts:
            result = compare(rec, server, tolerance)
            result.update(attempts=attempt, tick_ms=tick_ms, timing_ok=not timing_slipped(server, ticks))
            return result
        tick_ms *= 2
    raise AssertionError("unreachable")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ticks", type=int, default=168)
    ap.add_argument("--tick-ms", type=int, default=600)
    ap.add_argument("--strat", default="plan")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--difficulty", default="normal")
    ap.add_argument("--tolerance", type=float, default=0.005, help="allowed relative net-worth/cash difference")
    a = ap.parse_args()
    result = run_fidelity(a.ticks, a.tick_ms, a.strat, a.seed, a.difficulty, tolerance=a.tolerance)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
