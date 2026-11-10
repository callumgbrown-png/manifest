"""Python side of the JSON-lines bridge (sim/ml/bridge/bridge.ts). One Node process per client."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
SERVER_DIR = REPO / "server"
BRIDGE_TS = REPO / "sim" / "ml" / "bridge" / "bridge.ts"


def find_node() -> str:
    node = shutil.which("node")
    if node:
        return node
    fallback = Path("C:/Program Files/nodejs/node.exe")
    if fallback.exists():
        return str(fallback)
    raise RuntimeError("Node.js not found on PATH (Node 22.13 or newer is required)")


class BridgeError(RuntimeError):
    pass


class Bridge:
    """Blocking request/reply wrapper. Not thread-safe; use one Bridge per worker."""

    def __init__(self) -> None:
        # cwd=server/ so `--import tsx` and the .ts imports resolve exactly as for sim/playtest.ts.
        self.proc = subprocess.Popen(
            [find_node(), "--no-warnings", "--import", "tsx", str(BRIDGE_TS)],
            cwd=SERVER_DIR, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1,
        )
        self._next_id = 0

    def call(self, op: str, **args: Any) -> dict[str, Any]:
        if self.proc.poll() is not None:
            raise BridgeError("bridge process has exited")
        self._next_id += 1
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps({"id": self._next_id, "op": op, **args}) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise BridgeError("bridge closed its output")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise BridgeError(f"{op}: {reply.get('error')}")
        return reply

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.call("close")
            except (BridgeError, BrokenPipeError, OSError):
                pass
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        for stream in (self.proc.stdin, self.proc.stdout):
            if stream:
                try:
                    stream.close()
                except OSError:
                    pass

    def __enter__(self) -> "Bridge":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
