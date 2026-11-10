# sim/ml: machine-learning player simulator

Plan and phases: `docs/ML_PLAYER_SIM_PLAN.md`. Python never re-implements rules: `bridge/bridge.ts` wraps the real `Engine`.

Setup (from the repo root, once; also `cd server && npm ci`):

```
py -3.13 -m venv sim/ml/.venv
sim/ml/.venv/Scripts/python -m pip install -r sim/ml/requirements.txt
```

Phase 0 commands:

```
sim/ml/.venv/Scripts/python -m pytest sim/ml/tests      # determinism, parity with the real server, legal actions
sim/ml/.venv/Scripts/python -m sim.ml.bench             # seasons per minute
```

Defaults: 30 bots, six learner companies, 60 expected companies, and CPU-only
workers (`max(1, os.cpu_count() - 1)`, configurable with `--workers`). Phase 0
controls the first learner company; the other five remain idle. This benchmark
measures one acting random-legal learner, not six concurrently learning agents.
Use `--learners 1` explicitly when comparing with older one-company measurements.

The replay oracle starts the real server on a temporary SQLite database and
compares every company's **rounded** net worth plus tick, money supply, escrow,
ship count and company count. It supports unmodified rules and at most 20
companies because the public leaderboard is capped at 20. Full-precision worth
and full mutable-state equality against the live server are not established.

Phase 1: one command per experiment (writes `sim/ml/results/<name>/report.md`, `report.json`, CSVs, chart):

```
sim/ml/.venv/Scripts/python -m sim.ml.run sim/ml/config/experiments/baseline.yaml --seed 1
sim/ml/.venv/Scripts/python -m sim.ml.run sim/ml/config/experiments/playtest_ordering.yaml --seed 1
```

Personas live in `config/personas.yaml` (all numbers are assumptions); scripted play is `bridge/strategies.ts` (ported from `sim/playtest.ts`).

Each Phase 1 experiment now saves `replay/seed-<seed>-<difficulty>.json` for
every season: accepted commands, tick events, the map snapshot, rules hash,
and final worths. `report.json` links these logs and records a simulator source
hash plus whether the working tree had tracked edits. Reusing an experiment
name/output root replaces its reports and matching logs; use a new `--out`
directory to preserve separate runs. The human-likeness score stays `null`
until real-player calibration exists. The full continuous report schema and
run index remain Phase 3b work.

Phase 1 also writes `daily_economy.csv` (money, escrow, fleets, debt, price
index), `routes.csv`, `ports.csv`, `ship_usage.csv`, and `industry.csv`.
Telemetry observes the engine without changing rules. Industrial transport
counts do not imply conversion; factory production stays `null` because
the engine exposes no authoritative counter. Price growth is separate from
money-supply growth. Raid-notice/quit association is not a causal estimate.

Frustration starts from the company's actual initial net worth, so its starting
ship is not mistaken for earned profit. Configured profit, new-ship, raid-win,
and rank-gain likes relieve frustration. Daily money samples include the final
season day. Churn remains a synthetic hazard model, not measured engagement.

Layout: `bridge/bridge.ts` (JSON lines over stdio), `bridge/parity.mts` (server replay oracle), `bridge_client.py`, `env.py` (Gymnasium), `agents/baselines.py`.

## Phase 2: masked learning on CPU

```powershell
sim/ml/.venv/Scripts/python -m pip install -r sim/ml/requirements-train.txt
sim/ml/.venv/Scripts/python -m sim.ml.train sim/ml/config/experiments/phase2.yaml --workers 4
sim/ml/.venv/Scripts/python -m sim.ml.train sim/ml/config/experiments/phase2-followup.yaml --out sim/ml/runs/phase2-followup --warm-start sim/ml/runs/phase2/best.pt --workers 4
sim/ml/.venv/Scripts/python -m sim.ml.evaluate sim/ml/runs/phase2-followup/best.pt sim/ml/config/experiments/phase2-followup.yaml --out sim/ml/results/phase2-followup-heldout --workers 4
```

The default remains CPU count minus one workers; four were used on the measured
16 GB machine to avoid memory pressure. These are bounded manual runs. All
seasons remain 56 days with 30 bots, six learner companies and 60 expected
companies. One learner acts; multi-agent control is later work.

`ManifestEnv(extended_actions=True, k=32)` offers ship purchase/scrap, buy
orders, sell listings, purchases from listings, cancellations and legal raids
alongside voyages, selling and waiting. Non-voyage legality is checked by
the actual Engine on an isolated object graph. Rules and map are shared as
immutable inputs; administrative commands are forbidden in the probe.
Candidate sets are representative, not an exhaustive command space.

The learning observation is 683 floats: 11 global features (including explicit
difficulty), plus 32 candidates with 21 features each. Candidate features
include kind, engine-quoted economics, capacity and a public-data planning
score. Expert labels are returned separately and never enter the neural
observation. The scorer shares weights across candidates, so it cannot learn
an expert's array position or raw port IDs. The legacy 104-feature mode remains
available for Phase 0 compatibility.

Imitation uses the existing `plan` script on engine copies, plus an explicit
freighter-growth heuristic. PPO uses clipped objectives, masks, a value head,
and discounting by elapsed game hours. The follow-up anchors updates to expert
examples and selects checkpoints by the worst relative validation-difficulty
performance. Models, demonstrations and training histories are saved under
the ignored run directory; evaluations save every agent's replay log.

The first 101–106 held-out test failed on Hard. It remains preserved as evidence.
The follow-up uses new 201–208 test seeds, separately from all training and
validation seeds. Evaluation compares against the unprojected original six
scripts and `plan` with fleet purchases on matched worlds. A median gate is
descriptive evidence, not statistical proof. Order-book legality is exercised
in integration fixtures; the background bots do not place orders, so training
has limited counterparties and does not establish good order-book strategies.

Neither recorded experiment cleared the all-difficulty gate: the first failed
on Hard; the follow-up passed Hard but failed Easy and Normal. Phase 2 remains
unaccepted and Phase 3 must not be treated as started. Preserve these failed
tests when improving training rather than repeatedly selecting on test seeds.

Recorded experiment results and validation limits are in
`docs/evidence/ml-phase2/`. No report claims human-likeness or economic balance.

## Phase 3: persona-conditioned league agents (done-test not met)

```powershell
sim/ml/.venv/Scripts/python -m sim.ml.league_train sim/ml/config/experiments/phase3.yaml --out sim/ml/runs/phase3 --workers 4
sim/ml/.venv/Scripts/python -m sim.ml.league_eval sim/ml/runs/phase3/final.pt sim/ml/config/experiments/phase3.yaml --out sim/ml/results/phase3 --workers 4
```

`persona_policy.py` wraps the frozen Phase 2 policy with persona corrections; `league.py` plays several learner companies in one world (current policy,
frozen older policy, scripted persona), with check-in schedules, imperfect perception, mistakes and churn for the human-like flavour and hourly,
exact, greedy play for the `optimal` flavour. The held-out evaluation failed its persona-distinctness and no-collapse criteria; see
`docs/evidence/ml-phase3/`. The optimal agent did not beat scripted `plan` at the same cadence.

## Phase 4: server fidelity and real-data tools

```powershell
sim/ml/.venv/Scripts/python -m sim.ml.fidelity --ticks 240 --tick-ms 600        # replay a bridge season on a real server over WebSocket
sim/ml/.venv/Scripts/python -m sim.ml.realdata.export path/to/manifest.db --out data/real   # anonymised session export (real data)
sim/ml/.venv/Scripts/python -m sim.ml.realdata.priors --scenario organic --out data/estimated/organic   # literature-derived estimate
sim/ml/.venv/Scripts/python -m sim.ml.realdata.pipeline --synthetic-demo        # exercise likeness + fitting on an invented fixture
```

There is no real playtester data yet. The fixture (`realdata/synthetic.py`) and the estimates (`config/human_priors.yaml`, sources in
`docs/HUMAN_BEHAVIOUR_PRIORS.md`) are flagged in every output and can only produce a `fixture_score`; `human_likeness` stays null. Exports
hash names with a discarded salt, drop bots and timestamps, and refuse to finish if a name leaks. `data/` is git-ignored.

## The Start / Stop window

Double-click `Start Simulator.bat` (or `sim/ml/.venv/Scripts/python -m sim.ml.app`). **Start** runs `sim.ml.loop`: the baseline experiment over and over on fresh
seeds (10 parallel workers, about 16 s a cycle), one report per cycle under `sim/ml/runs/live/cycles/`, plus `INDEX.jsonl` and `LATEST.json`. **Stop** finishes the
cycle in progress and ends cleanly; closing the window does the same. This repeats scripted measurements: nothing learns between cycles (the learning loop of
plan section 6b is Phase 3b, not built). To try a rule change, add `rules_overrides` to the experiment file (in memory only; `config/rules.json` is never written).

## Phase 3b: the continuous training run

```powershell
sim/ml/.venv/Scripts/python -m sim.ml.run --continuous sim/ml/config/experiments/live.yaml            # new run under sim/ml/runs/live-<time>/
sim/ml/.venv/Scripts/python -m sim.ml.run --continuous sim/ml/config/experiments/live.yaml --resume   # continue the newest one
```

Create a file named `STOP` in the run folder (or press Ctrl-C, or use the app's Stop) to stop after the current cycle; a final report is written and
the checkpoint saved. Open `LATEST.json` first, then follow it to `cycles/<n>/report.json`; `SCHEMA.md` in the run folder explains every field.
In the window, pick **Train** (and tick "Continue last training run") before pressing Start. A cycle takes several minutes. The agent being trained
is the persona layer on top of the frozen Phase 2 policy; the Phase 2 gate (beating scripted `plan`) is still unmet, and `human_likeness` stays null
until a real playtester export exists.

## Moods, players' ideas and Gemini ideas (training runs)

**Moods** (`personas/mood.py`). Human-like players have five moods in [0, 1]: anger, fear, elation, boredom, guilt. Events raise them (raided, arrested, forced sale, near broke, big loss, profit, new ship, raid win, rank gain/fall, no move, stuck rank) and they fade by half-life. They change mistake rate, price overconfidence, attention and impulses (revenge raid, safe wait, ship splurge), never what the engine allows. Also: conscience (guilt after a raid win or arrest makes the player skip raids), goods memory (goods that lost money are avoided), and focus after two losing visits in a row. Persona settings: `emotionality` (0 = off), `conscience`, `rumination`.
All magnitudes are assumptions. Only the fear and elation half-lives and the 2x loss factor have a cited source (`docs/PSYCHOLOGY_PRIORS.md`).
Open caveats: a 3-season probe showed mood-on players ending with a much lower median net worth and more quits than mood-off, and a reviewer judged some in-mood mistake rates implausibly high. Strength was kept at the user's request, pending a sweep.

**Per-cycle outputs** in the run folder: `moods.jsonl` (mean peak moods, impulses, mistakes in vs out of mood), `ideas.jsonl` (players' ideas), `ideas_gemini.jsonl` (Gemini answers), `gemini_state.json` (back-off and daily call count). The log prints `cycle N: moods ...`, `cycle N: players' ideas this cycle: ...` and `cycle N: Gemini ideas: ...` (or `unavailable (reason)`). Failures here are logged and never stop training.

**Players' ideas** (`ideas.py`) are templated: each player picks up to two from a fixed catalogue according to its own complaints and likes. This shows what simulated players complain about, not that real players want it.

**Gemini ideas** (`gemini_ideas.py`) are off by default. Turn on with `gemini: {enabled: true, model: auto, every_cycles: 20, max_per_day: 10}` in the experiment yaml, or with the window's always-on slider (writes a `GEMINI` flag file into the run folder), or ask once with the "Ask Gemini for ideas" button. The key comes only from the `GEMINI_API_KEY` environment variable (PowerShell: `setx GEMINI_API_KEY "your key"`, then reopen the app). Only aggregate synthetic numbers are sent. Model `auto` picks the newest Flash the key can list. Overload errors are retried after 5, 15 and 30 s; a failed cycle is retried with back-off (2 min doubling to 1 h), at most 10 attempts a day. Ideas are labelled LLM-generated, need your approval, and nothing edits `config/rules.json`. API use may be billed on your Google account.

**STOP file**: a STOP written after the run was launched (for example by the app's Stop button) is no longer deleted by the child process at startup; only a STOP older than the launch is treated as stale and removed.
