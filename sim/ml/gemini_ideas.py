"""Ask Google's Gemini model for new game ideas, from the simulator's findings (optional, off unless enabled and a key is set).

- The key is read from the GEMINI_API_KEY environment variable only. It is never written to a file, a log or a report.
- Only aggregate, synthetic simulator summaries are sent (cohort medians, finding types, the players' templated complaints and mood
  averages). No player data, no account names, no files.
- A failure (no key, network, bad reply) is logged and never stops the training loop.
- The ideas are an LLM's suggestions from numbers about synthetic players. They are not evidence that real players want them,
  and every one needs your approval. Nothing here edits config/rules.json.
Enable in the experiment yaml:   gemini: {enabled: true, model: auto, every_cycles: 20, max_per_day: 10}   (model auto = newest Flash your key can use)
Cost: the API may be billed on your Google account depending on your plan and quota; one call per `every_cycles` cycles.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
RETRY_WAITS = (5.0, 15.0, 30.0)    # seconds between quick retries of a 429/500/503 before giving up (the slider then backs off minutes)
LIST_URL ="https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
FALLBACK_LITE = "gemini-3.5-flash-lite"   # docs list it as a current stable Flash-Lite; used only if the model list cannot be fetched
FALLBACK_MODEL = "gemini-3.6-flash"   # only used when the model list cannot be fetched (docs list it as the current stable Flash; 2.5-flash is deprecated)
KEY_VAR = "GEMINI_API_KEY"
GEMINI_FLAG = "GEMINI"   # an empty file with this name in a run folder turns the automatic Gemini ideas on (the app's slider writes it)


def build_prompt(report: dict[str, Any], ideas: dict[str, Any], moods: dict[str, Any]) -> str:
    facts = {
        "game": "Manifest: a browser freight-shipping economy MMO (ships, ports, cargo trades, pirates raiding other players, ranks, leaderboards).",
        "median_net_worth_by_difficulty": report["metrics"]["cohorts"],
        "simulator_findings": [{"type": f["type"], "severity": f["severity"], "summary": f.get("summary", "")} for f in report["findings"]][:12],
        "simulated_players_complaints_and_wants": [{"idea": i["idea"], "why": i["why"], "votes": i["votes"]} for i in ideas["ideas"]][:6],
        "mood_averages": moods.get("mean_peak"),
    }
    return ("You are a game designer. Below are measurements from a simulation of SYNTHETIC players (not real people) in the game described.\n"
            "Propose 5 NEW, concrete feature or rule ideas that would address the problems shown or make the game more fun for the personas.\n"
            "For each give: title, what it is, which finding or complaint it answers, a risk, and how a simulator could test it.\n"
            "Do not claim real players want these. Reply as JSON: {\"ideas\": [{\"title\":..., \"what\":..., \"answers\":..., \"risk\":..., \"how_to_test\":...}]}.\n\n"
            + json.dumps(facts, indent=1))


STATE_FILE = "gemini_state.json"
BACKOFF_FIRST, BACKOFF_MAX = 120.0, 3600.0     # seconds: after a failed call wait 2 min, then 4, 8 ... up to an hour


def _day(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(now))


def due(run_dir: Path, cycle: int, every: int, now: float, max_per_day: int = 10) -> bool:
    """Should this cycle ask Gemini? On schedule (every N cycles), or because the last attempt failed (quota, network, bad reply) and the
    back-off has passed, so it picks up again by itself once your quota returns. Never more than max_per_day attempts per calendar day
    (the free tier allows about 20 a day per model, shared with anything else you run). Survives restarts: state lives in the run folder."""
    state = _state(run_dir)
    if state.get("day") == _day(now) and int(state.get("calls", 0)) >= max_per_day:
        return False
    if state.get("pending"):
        next_try = float(state.get("next_try", 0.0))
        return now >= next_try or next_try - now > BACKOFF_MAX      # a retry time further away than the longest back-off means the clock jumped: try now
    return cycle % max(1, every) == 0


def record(run_dir: Path, ok: bool, now: float) -> None:
    state = _state(run_dir)
    fails = 0 if ok else int(state.get("fails", 0)) + 1
    calls = int(state.get("calls", 0)) + 1 if state.get("day") == _day(now) else 1
    new = {"pending": not ok, "fails": fails, "next_try": 0.0 if ok else now + min(BACKOFF_MAX, BACKOFF_FIRST * 2 ** (fails - 1)),
           "day": _day(now), "calls": calls}
    try:
        (run_dir / STATE_FILE).write_text(json.dumps(new), encoding="utf-8")
    except OSError:
        pass


def _state(run_dir: Path) -> dict[str, Any]:
    try:
        s = json.loads((run_dir / STATE_FILE).read_text(encoding="utf-8"))
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def ask_from_run(run_dir: Path, model: str = "auto", post: Callable[..., dict[str, Any]] | None = None,
                 environ: dict[str, str] | None = None) -> dict[str, Any]:
    """On demand (the app's button): ask Gemini about the newest cycle of a run folder and append the answer to ideas_gemini.jsonl."""
    try:
        latest = json.loads((run_dir / "LATEST.json").read_text(encoding="utf-8"))
        path = (run_dir / latest["report"]).resolve()
        if not path.is_relative_to(run_dir.resolve()):      # LATEST.json must not point outside the run folder
            raise ValueError("report path outside the run folder")
        report = json.loads(path.read_text(encoding="utf-8"))
        last = lambda name: json.loads([x for x in (run_dir / name).read_text(encoding="utf-8").splitlines() if x.strip()][-1])
        ideas, moods = last("ideas.jsonl"), last("moods.jsonl")
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return {"ok": False, "error": "no finished training cycle with moods in this run yet (use Train mode first)"}
    answer = ask(report, ideas, moods, model=model, post=post or _post, environ=environ)
    try:
        with (run_dir / "ideas_gemini.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"cycle": latest.get("cycle"), "on_demand": True, **answer}) + "\n")
    except OSError:
        pass
    return answer


def _post(url: str, body: dict[str, Any], key: str, timeout: float = 60.0) -> dict[str, Any]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:      # the key goes in a header, never in the URL
        return json.loads(resp.read().decode())


def _get(url: str, key: str, timeout: float = 30.0) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"x-goog-api-key": key}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def pick_model(listing: dict[str, Any], lite: bool = False) -> str | None:
    """From a ListModels reply, the newest 'flash' model (or 'flash-lite' when lite=True) that can generate text; stable before preview on
    a tie. Image, audio, live, embedding and similar variants never match."""
    import re
    pattern = r"gemini-(\d+(?:\.\d+)?)-flash" + ("-lite" if lite else "") + r"(-preview[\w.-]*)?"
    best: tuple[tuple[float, int], str] | None = None
    for m in listing.get("models", []):
        name = str(m.get("name", "")).removeprefix("models/")
        if "generateContent" not in (m.get("supportedGenerationMethods") or []):
            continue
        found = re.fullmatch(pattern, name)
        if not found:
            continue
        rank = (float(found.group(1)), 0 if found.group(2) else 1)
        if best is None or rank > best[0]:
            best = (rank, name)
    return best[1] if best else None


def discover(key: str, get: Callable[..., dict[str, Any]] | None = None, lite: bool = False) -> str | None:
    """Ask Google which models this key can use. None if the call fails."""
    try:
        return pick_model((get or _get)(LIST_URL, key), lite)
    except Exception:
        return None


def candidates(model: str, key: str, get: Callable[..., dict[str, Any]] | None) -> list[str]:
    """Models to try in order. 'auto' (default): regular Flash first, then Flash-Lite as the backup. 'auto-lite': Lite first, then regular.
    A named model is tried alone (plus the auto choice if it is unknown)."""
    if model in ("auto-lite", "auto"):
        lite_first = model == "auto-lite"
        try:
            listing = (get or _get)(LIST_URL, key)
        except Exception:
            listing = None
        if listing is None:       # list unavailable: the documented current ids; with a list, only models the key really has
            return [FALLBACK_LITE, FALLBACK_MODEL] if lite_first else [FALLBACK_MODEL, FALLBACK_LITE]
        order = [pick_model(listing, lite_first), pick_model(listing, not lite_first)]
        return [m for m in dict.fromkeys(order) if m]
    return [model]


def ask(report: dict[str, Any], ideas: dict[str, Any], moods: dict[str, Any], model: str = "auto",
        post: Callable[..., dict[str, Any]] = _post, environ: dict[str, str] | None = None,
        get: Callable[..., dict[str, Any]] | None = None, sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    """Returns {"ok": True, "model", "ideas": [...], "label": ...} or {"ok": False, "error": ...}. Never raises.
    Default model "auto": the newest regular Flash model your key can use, falling back to the newest Flash-Lite (lighter, roomier free limits, less often overloaded) when that fails. "auto-lite" tries Lite first. A named model that gets a 404 falls back to the auto choice."""
    key = (environ if environ is not None else os.environ).get(KEY_VAR)
    if not key:
        return {"ok": False, "error": f"{KEY_VAR} is not set"}
    try:
        body = {"contents": [{"parts": [{"text": build_prompt(report, ideas, moods)}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9}}

        def send(name: str) -> dict[str, Any]:
            """One call, with short retries for overload (503, 500) and rate limit (429): they usually clear within seconds."""
            for wait in RETRY_WAITS + (None,):
                try:
                    return post(ENDPOINT.format(model=name), body, key)
                except urllib.error.HTTPError as err:
                    if err.code not in (429, 500, 503) or wait is None:
                        raise
                    sleep(wait)
            raise RuntimeError("unreachable")

        tried = candidates(model, key, get)
        reply, last = None, None
        network_errors = (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError)     # a timeout on one model still tries the backup
        for name in tried:
            try:
                reply, model = send(name), name
                break
            except network_errors as e:
                last = e
        if reply is None and last is not None and model not in ("auto", "auto-lite") and getattr(last, "code", None) == 404:
            for name in candidates("auto-lite", key, get):                # an unknown named model: try what the key offers
                if name != model:
                    try:
                        reply, model = send(name), name
                        break
                    except network_errors as e:
                        last = e
        if reply is None:
            raise last if last is not None else RuntimeError("no model available")
        text = reply["candidates"][0]["content"]["parts"][0]["text"]
        got = json.loads(text)["ideas"]
        if not isinstance(got, list):
            raise ValueError("ideas is not a list")
        return {"ok": True, "model": model, "ideas": [{k: str(v) for k, v in i.items()} for i in got if isinstance(i, dict)][:8],
                "label": "LLM-generated from synthetic-player measurements; not evidence of real demand; needs approval"}
    except Exception as e:      # never raises: any failure (network, bad reply, odd input) becomes {"ok": False}
        return {"ok": False, "error": f"{type(e).__name__}: {str(e).replace(key, '***')[:200]}"}
