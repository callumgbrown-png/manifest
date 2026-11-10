"""A small window with Start and Stop buttons.   Double-click `Start Simulator.bat`, or:
    sim/ml/.venv/Scripts/python -m sim.ml.app

Two modes share the same buttons:
- Measure: sim.ml.loop repeats the scripted baseline experiment on fresh seeds (about 16 s a cycle, a report per cycle under sim/ml/runs/live/).
  Scripted players do not learn.
- Train: sim.ml.run --continuous (Phase 3b): each cycle plays league worlds, trains the persona agents, evaluates on fixed held-out worlds
  against baselines, and writes a schema-validated report plus a checkpoint (minutes per cycle). "Continue last training run" resumes from the
  newest checkpoint.
Stop finishes the cycle in progress and ends cleanly (a training cycle can take several minutes). Closing the window does the same and
force-quits if that takes too long, losing the cycle in progress.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, scrolledtext
from typing import Callable

from .bridge_client import REPO
from .controller import Controller
from .gemini_ideas import GEMINI_FLAG, KEY_VAR, ask_from_run

CONFIG = REPO / "sim" / "ml" / "config" / "experiments"
RUNS = REPO / "sim" / "ml" / "runs"
MEASURE_OUT = RUNS / "live"
WORKERS = 10   # parallel workers in both modes
POLL_MS = 500
CLOSE_GRACE_MS = {"measure": 4000, "train": 20000}


def python_exe() -> str:
    p = Path(sys.executable)
    return str(p.with_name("python.exe") if p.name.lower() == "pythonw.exe" else p)   # the child needs a console-capable interpreter


def latest_training_run() -> Path | None:
    runs = sorted(p for p in RUNS.glob("live-*") if (p / "checkpoints" / "state.json").exists())
    return runs[-1] if runs else None


def build_plan(mode: str, resume: bool = False) -> tuple[list[str], Path]:
    """(command, run folder) for a mode. Training gets an explicit --run-id so the app knows where the STOP file goes."""
    py = python_exe()
    if mode == "measure":
        return [py, "-m", "sim.ml.loop", str(CONFIG / "baseline.yaml"), "--out", str(MEASURE_OUT), "--workers", str(WORKERS)], MEASURE_OUT
    previous = latest_training_run() if resume else None
    run_dir = previous or RUNS / f"live-{time.strftime('%Y%m%d-%H%M%S')}"
    cmd = [py, "-m", "sim.ml.run", "--continuous", str(CONFIG / "live.yaml"), "--run-id", run_dir.name] + (["--resume"] if previous else [])
    return cmd, run_dir


def headline_text(mode: str, latest: dict | None) -> str:
    if not latest:
        return ""
    if mode == "measure":
        leaders = "; ".join(f"{d}: {v['persona']} {v['median_net_worth']:,}" for d, v in latest.get("leaders", {}).items())
        return f"Latest cycle {latest['cycle']}: leader by difficulty - {leaders}"
    med = lambda k: "/".join("-" if latest[k].get(d) is None else f"{latest[k][d]:,.0f}" for d in ("easy", "normal", "hard"))
    return (f"Latest cycle {latest['cycle']} (easy/normal/hard median net worth): human-like {med('human_like_median')}, optimal {med('optimal_median')}, "
            f"scripted plan {med('plan_4h_median')}; {latest['findings']} finding(s), {latest['critical']} critical")


SETTINGS = RUNS / "app_settings.json"   # the runs folder is git-ignored; holds only the slider position, never a key


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(settings: dict) -> None:
    try:
        SETTINGS.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS.write_text(json.dumps(settings), encoding="utf-8")
    except OSError:
        pass


def format_gemini(answer: dict) -> list[str]:
    """Log lines for a Gemini reply (or the reason there is none)."""
    if not answer.get("ok"):
        return [f"--- Gemini: no ideas ({answer.get('error', 'unknown reason')}) ---"]
    lines = [f"--- Gemini ideas ({answer['model']}) - {answer['label']} ---"]
    for n, i in enumerate(answer["ideas"], 1):
        lines.append(f"{n}. {i.get('title', '?')}: {i.get('what', '')}")
        lines.append(f"   answers: {i.get('answers', '')} | risk: {i.get('risk', '')} | test: {i.get('how_to_test', '')}")
    return lines + ["--- saved in ideas_gemini.jsonl in the run folder; each idea needs your approval ---"]


class App:
    def __init__(self, root: tk.Tk, controller: Controller, planner: Callable[[str, bool], tuple[list[str], Path]] | None = None,
                 gemini: Callable[[Path], dict] | None = None) -> None:
        self.root, self.c, self.planner, self.gemini = root, controller, planner, gemini
        self.gemini_results: list[dict] = []     # filled by the worker thread, drained by refresh()
        self.asking = False
        self.mode = tk.StringVar(value="measure")
        self.resume = tk.BooleanVar(value=True)
        root.title("Manifest Simulator")
        root.geometry("800x560")
        top = tk.Frame(root, padx=12, pady=12)
        top.pack(fill="x")
        self.start = tk.Button(top, text="Start", width=14, height=2, bg="#2e7d32", fg="white", font=("Segoe UI", 11, "bold"), command=self.on_start)
        self.stop = tk.Button(top, text="Stop", width=14, height=2, bg="#c62828", fg="white", font=("Segoe UI", 11, "bold"), command=self.on_stop)
        self.ideas = tk.Button(top, text="Ask Gemini\nfor ideas", width=14, height=2, bg="#1565c0", fg="white", font=("Segoe UI", 11, "bold"), command=self.on_gemini)
        self.start.pack(side="left")
        self.stop.pack(side="left", padx=(10, 0))
        self.ideas.pack(side="left", padx=(10, 0))
        self.always = tk.Scale(top, from_=0, to=1, orient="horizontal", length=60, showvalue=False, sliderlength=28, resolution=1, command=self.on_always)
        self.always_label = tk.Label(top, text="", font=("Segoe UI", 9), justify="left", anchor="w")
        initial = 1 if load_settings().get("gemini_always") else 0
        self.always.set(initial)
        self.always_label.configure(text="Gemini ideas:\nALWAYS ON" if initial else "Gemini ideas:\noff")
        self.always_label.pack(side="right", padx=(6, 0))
        self.always.pack(side="right")
        self.state_label = tk.Label(top, text="", font=("Segoe UI", 11), anchor="w", justify="left")
        self.state_label.pack(side="left", padx=16, fill="x", expand=True)
        modes = tk.Frame(root, padx=12)
        modes.pack(fill="x")
        self.radios = [tk.Radiobutton(modes, text="Measure (repeat the scripted experiment)", variable=self.mode, value="measure"),
                       tk.Radiobutton(modes, text="Train (learn, evaluate, report)", variable=self.mode, value="train")]
        for r in self.radios:
            r.pack(side="left", padx=(0, 16))
        self.resume_box = tk.Checkbutton(modes, text="Continue last training run", variable=self.resume)
        self.resume_box.pack(side="left")
        self.headline = tk.Label(root, text="", anchor="w", justify="left", padx=12, pady=6, font=("Segoe UI", 9), wraplength=770)
        self.headline.pack(fill="x")
        self.log = scrolledtext.ScrolledText(root, height=20, state="disabled", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.closing = False
        self.active_mode = "measure"
        self.refresh()

    def on_start(self) -> None:
        if self.planner:
            self.active_mode = self.mode.get()
            self.c.command, self.c.out_dir = self.planner(self.active_mode, self.resume.get())
            self.append(f"--- started: {self.active_mode} mode, run folder {self.c.out_dir} ---")
        else:
            self.append("--- started ---")
        self.apply_always()
        self.c.start()
        self.refresh()

    def apply_always(self) -> None:
        """Make the run folder's GEMINI flag match the slider (the training loop checks it every cycle)."""
        flag = self.c.out_dir / GEMINI_FLAG
        try:
            if self.always.get():
                flag.parent.mkdir(parents=True, exist_ok=True)
                flag.write_text("on\n", encoding="utf-8")
            else:
                flag.unlink(missing_ok=True)
        except OSError:
            pass

    def on_always(self, value: str) -> None:
        on = bool(int(float(value)))
        self.always_label.configure(text="Gemini ideas:\nALWAYS ON" if on else "Gemini ideas:\noff")
        save_settings({**load_settings(), "gemini_always": on})
        if self.c.running():                      # flip it live; otherwise it is applied at Start
            self.apply_always()
            if on and not os.environ.get(KEY_VAR):
                self.append(f"--- Gemini is on but {KEY_VAR} is not set, so cycles will log 'unavailable'. In PowerShell: setx {KEY_VAR} \"your key\" then reopen the app. ---")

    def on_gemini(self) -> None:
        """Ask Gemini for new game ideas about the newest training cycle. The key comes only from the GEMINI_API_KEY environment variable."""
        if self.gemini is None or self.asking:
            return
        run = self.c.out_dir if (self.c.out_dir / "LATEST.json").exists() and (self.c.out_dir / "ideas.jsonl").exists() else latest_training_run()
        if run is None:
            self.append("--- Gemini: no training run yet. Use Train mode for at least one cycle first. ---")
            return
        if not os.environ.get(KEY_VAR):
            self.append(f"--- Gemini: {KEY_VAR} is not set. In PowerShell run:  setx {KEY_VAR} \"your key\"  then close and reopen this app. (The key is never stored by the app.) ---")
            return
        self.asking = True
        self.append(f"--- asking Gemini about the newest cycle of {run.name} (only aggregate simulator numbers are sent) ---")

        def work() -> None:
            try:
                result = self.gemini(run)
            except Exception as e:      # the button must never stay stuck on "Asking..."
                result = {"ok": False, "error": type(e).__name__}
            self.gemini_results.append(result)
        threading.Thread(target=work, daemon=True).start()
        self.refresh_buttons()

    def refresh_buttons(self) -> None:
        self.ideas.configure(state="normal" if self.gemini is not None and not self.asking else "disabled", text="Asking...\n" if self.asking else "Ask Gemini\nfor ideas")

    def on_stop(self) -> None:
        self.c.request_stop()
        self.append("--- stop requested: finishing the current cycle (a training cycle can take several minutes) ---")
        self.refresh()

    def on_close(self) -> None:
        if self.c.running():
            if not messagebox.askyesno("Manifest Simulator", "The simulation is running. Stop it and close? (The cycle in progress may be lost.)"):
                return
            self.closing = True
            self.c.request_stop()
            self.root.after(CLOSE_GRACE_MS.get(self.active_mode, 4000), self.finish_close)
            return
        self.root.destroy()

    def finish_close(self) -> None:
        if self.c.running():
            self.c.force_stop()
        self.root.destroy()

    def append(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def refresh(self) -> None:
        for line in self.c.drain():
            self.append(line)
        while self.gemini_results:
            for line in format_gemini(self.gemini_results.pop(0)):
                self.append(line)
            self.asking = False
        self.refresh_buttons()
        s = self.c.status()
        state = s["state"]
        self.start.configure(state="normal" if state == "idle" else "disabled")
        self.stop.configure(state="normal" if state == "running" else "disabled")
        for widget in (*self.radios, self.resume_box):
            widget.configure(state="normal" if state == "idle" and self.planner else "disabled")
        self.state_label.configure(text={"idle": "Idle", "running": f"Running ({self.active_mode})", "stopping": "Stopping after this cycle..."}[state] + f"   (cycles done: {s['cycles']})")
        text = headline_text(self.active_mode, s["latest"])
        if text:
            self.headline.configure(text=text + f"\nReports: {self.c.out_dir}")
        if not self.closing or self.c.running():
            self.root.after(POLL_MS, self.refresh)


def main() -> None:
    os.chdir(REPO)
    command, out = build_plan("measure")
    root = tk.Tk()
    App(root, Controller(command, out, REPO), build_plan, ask_from_run)
    root.mainloop()


if __name__ == "__main__":
    main()
