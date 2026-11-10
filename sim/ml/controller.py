"""Start/stop control of the simulation loop as a child process (no GUI code, so it can be tested)."""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Any


STARTED_ENV = "SIM_STARTED_AT"
CLOCK_SLACK = 2.0   # seconds


def clear_stale_stop(path: Path) -> None:
    """For the loops at startup: remove a STOP left over from an earlier run, but keep one the app wrote after launching this process
    (the child takes seconds to import, and Stop pressed in that time must not be lost). Run by hand there is no launch time, so any
    existing STOP counts as stale."""
    try:
        started = float(os.environ.get(STARTED_ENV, "inf"))
    except ValueError:
        started = float("inf")
    if started != started:        # NaN: treat like "no launch time"
        started = float("inf")
    try:
        if path.exists() and path.stat().st_mtime < started - CLOCK_SLACK:     # file times are coarse; a stale STOP is minutes old, not seconds
            path.unlink()
    except OSError:
        pass


class Controller:
    def __init__(self, command: list[str], out_dir: Path, cwd: Path) -> None:
        self.command, self.out_dir, self.cwd = command, out_dir, cwd   # command/out_dir may be replaced between runs (the app's mode switch)
        self.proc: subprocess.Popen | None = None
        self.lines: "queue.Queue[str]" = queue.Queue()

    @property
    def stop_file(self) -> Path:
        return self.out_dir / "STOP"

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self) -> bool:
        """Launch the loop. Does nothing (returns False) if it is already running."""
        if self.running():
            return False
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.stop_file.unlink(missing_ok=True)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        env = {**os.environ, STARTED_ENV: repr(time.time())}      # lets the child tell a stale STOP from one written after this launch
        self.proc = subprocess.Popen(self.command, cwd=self.cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding="utf-8", errors="replace", bufsize=1, creationflags=flags, env=env)
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()
        return True

    def _pump(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            self.lines.put(line.rstrip("\n"))
        self.lines.put("[process ended]")

    def request_stop(self) -> None:
        """Ask for a clean stop: the cycle in progress finishes, then the loop ends."""
        if self.running():
            self.out_dir.mkdir(parents=True, exist_ok=True)
            self.stop_file.write_text("stop requested\n", encoding="utf-8")

    def force_stop(self) -> None:
        """Kill the loop and everything it started (Node bridges, worker processes). Loses the cycle in progress."""
        if self.running():
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.proc.pid)], capture_output=True)
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    def state(self) -> str:
        if not self.running():
            return "idle"
        return "stopping" if self.stop_file.exists() else "running"

    def status(self) -> dict[str, Any]:
        index = self.out_dir / "INDEX.jsonl"
        cycles = sum(1 for line in index.read_text(encoding="utf-8").splitlines() if line.strip()) if index.exists() else 0
        latest = self.out_dir / "LATEST.json"
        return {"state": self.state(), "cycles": cycles, "latest": json.loads(latest.read_text(encoding="utf-8")) if latest.exists() else None}

    def drain(self) -> list[str]:
        out = []
        while True:
            try:
                out.append(self.lines.get_nowait())
            except queue.Empty:
                return out
