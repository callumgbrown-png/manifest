# Manifest: plan for a machine-learning player simulator

Status: plan; implementation proceeds phase by phase on branch `sim-ml-players` (never `main`). Based on reading engine.ts, main.ts, bots.ts, piratebots.ts, sim/playtest.ts, sim/simulate.py, config/rules.json and the docs.

## 1. Recommended path in one paragraph

Build a small headless Node program around the real Engine that speaks JSON lines over stdio, and wrap it in a Gymnasium environment in Python (`sim/ml/`). Python never re-implements rules, so it can't drift from the game. First get scripted personas (no ML) running full seasons with a report, because that alone will catch most balance problems and gives the ML something to imitate and beat. Then train one persona-conditioned PPO policy with action masking, warm-started by behaviour cloning from the scripted strategies, with an imperfection layer (check-in schedule, price misjudgement, attention limits) so agents behave like people rather than optimisers. Run the real WebSocket server only as an occasional fidelity check. Everything runs on CPU, so cost is effectively zero.

## 2. What the code tells us (facts that shape the plan)

- Engine is I/O-free and deterministic: `apply(Command)`, `advance()` (one game hour), `netWorth`, `inbound()`, `marketOutlook`, `voyageQuote`, `metrics()`. `sim/playtest.ts` already runs whole seasons in-process with no server, so a headless bridge is a small step, not a rewrite.
- Randomness (raids, police) is a seeded hash of tick, ship and counters, so a season is reproducible from (map, rules, seed, command log).
- A player acts only when idle ships are docked. Between check-ins nothing happens, so this is a semi-Markov decision process: decisions are sparse and at human-chosen times.
- Existing player strategies in `playtest.ts` (advice, tripsOnly, oldDefault, newDefault, plan, pirate) only drive the company's first non-pirate ship. They never call `buyShip` as a player, `scrapShip`, `placeOrder`, `placeSell` or `buyFromOrder`. Those are gaps the simulator must fill or explicitly leave out.
- Bots (`bots.ts`) buy at most 3 freighters, never place orders, and have noise via `error` and a floor via `minProfit`. They are the "background population", not a model of a person.
- Information a human sees is in `privateView`/`publicView` (main.ts): cash, ships, notoriety, lockedOutHours, notices (raids, arrests), forcedSales, rank, worthLog, trip log, public inbound cargo. These are also the natural dislike signals (raided, fined, forced to sell a ship, rank dropping).
- Maps are randomised per season (map-generation-pipeline.ts), so a policy must not memorise port IDs.
- The old `sim/simulate.py` models only grain, fuel and the freighter. It is the cautionary example for option (c) below.

## 3. Integration architecture

| Option | Fidelity | Speed | Maintenance | Verdict |
| --- | --- | --- | --- | --- |
| (a) Python clients over WebSocket to a real server | Highest (includes protocol, rate limits, event log) | Slow: real clock, TICK_MS, per-address limits | Medium | Use only for periodic fidelity checks |
| (b) Node bridge around Engine, JSON lines over stdio | Same rules as live game | Fast, many parallel processes | Low: one thin file | Use for all training and experiments |
| (c) Re-implement rules in Python | Drifts (already did once) | Fastest | High: every rule change needs a mirror | Reject |

**Bridge design (`sim/ml/bridge/bridge.ts`)**

- Commands: `reset {seed, difficulty, rules_overrides, n_bots, n_learners, map_seed}`, `observe {company}`, `candidates {company, ship}`, `step {commands[], advance_hours}`, `metrics`, `close`.
- It builds the world exactly as `playtest.ts` does (30 bots via `runBots`, `runPirateBots`, `Engine(rules, map, expectedCompanies)`), so the economy the agents face is the one bots already stress.
- The bridge also exposes candidate trips computed by engine maths (the same profit/bestTrips logic in `playtest.ts` and `bots.ts`), so Python doesn't duplicate price maths.
- Parallelism: one Node process per environment, SubprocVecEnv in Python. Determinism: seed in reset, no `Math.random`/clock, record every committed command.
- Parity oracle: take a command log from the bridge, replay it through the real server's event-log replay path (main.ts replays the events table on restart) and require identical netWorth per company. Run this in CI and before any trusted result. (Check the event payload format when implementing.)
- Fidelity check (a): a small Python WebSocket client (register, cmd, quoteVoyage) replays one persona's season against a local server at fast TICK_MS, nightly or weekly, not in training.

## 4. Personas: parameters, likes, dislikes, churn

A persona is a row in `sim/ml/config/personas.yaml`, sampled with jitter so no two simulated players are identical. Every number is an assumption you can tune; nothing here is measured from real players yet.

**Parameter groups**

- Skill and noise: `price_error` (like bots' error, drifting), `lookahead` (1 trip, 2 trips, chain), `info_use` (reads inbound cargo or ignores it), `mistake_rate` (picks a worse option or misreads a quantity).
- Play pattern: `checkins_per_day`, active hours and time zone offset (sleep gaps), `session_length` (how many ships it handles per visit), `patience` (hours of "nothing pays" it tolerates).
- Likes (reward weights): `w_profit`, `w_rank_gain`, `w_new_ship`, `w_big_deal` (single-trip profit above a threshold), `w_preferred_good`, `w_raid_win`.
- Dislikes (penalty weights): `w_raided`, `w_fine_lockout`, `w_empty_run`, `w_upkeep_pain`, `w_idle`, `w_thin_margin`, `w_near_broke`, `w_forced_sale`, `w_no_move` (nothing affordable or profitable at a visit).
- Churn: a hazard model, see below.

**Starting set** (each is a region of the parameter space, not a hard-coded script)

| Persona | Sketch |
| --- | --- |
| Cautious grain hauler | Low risk, avoids thin markets, 3 check-ins a day, hates losses and raids |
| Machinery speculator | Chases big margins in thin markets, tolerates variance, hates idle time |
| Fleet collector | Buys ships as soon as possible, loves new ship events, hates upkeep stalls |
| Pirate | Buys a pirate ship at home, hunts loaded ships, tolerates fines up to a point |
| Casual once-a-day | 1 or 2 check-ins, long patience gaps, makes mistakes, churns on confusion |
| Hardcore optimiser | Every few hours, low noise, uses orders, reads inbound cargo |
| Impulsive beginner | Presses the default action, high mistake rate (the oldDefault/newDefault behaviours) |
| Leaderboard chaser | Reward dominated by rank change, quits if rank stagnates |

**Frustration and churn model.** Each persona carries a frustration state F. It rises on dislike events (raided, locked out, forced sale, near-broke, a visit with no_move, a long idle streak, rank falling), decays with time and resets partly on like events (profitable trip, new ship, rank gain). Quitting is a hazard `P(quit per visit) = sigmoid(a·F + b·boredom − c·recent_progress)` with persona-specific coefficients. Quits are recorded as (persona, day, last_events). A quit stops that company acting, but it still sits in the market (its ship idles), which is realistic and matters for the economy.

## 5. Machine-learning approach

### 5.1 Problem formulation

- Decision point: a persona's check-in, then each docked idle ship in turn (the bridge advances time until the next check-in).
- Observation (fixed length, map-invariant): global features (season progress, difficulty, money supply ratio), own company (cash, net worth, rank percentile, ships by type and state, notoriety, lockout hours, home port), the ship being decided (type, capacity, current port features), and per-candidate features (below). Avoid raw port IDs; use geometry-free features like distance, hours, price, stock relative to target, inbound cargo, projected price from `marketOutlook`.
- Action space via candidates: the bridge returns up to K=16 candidate trips (destination, good, quantity bucket, expected profit, hours, fuel cost, risk of raid exposure) plus special actions: wait, sail empty to one of the top-M promising ports, buy ship (by type, at a docked port), scrap ship, place buy order, list cargo, raid target (top-N from `engine.piracy.targetsFor`). The policy scores candidates; invalid ones are masked: cash, max_ships, lockout, cooldown, pirate home-only purchase.
- Why candidates: it keeps the action space small, works on randomised maps and 40 ports, and reuses engine maths so agents can't invent illegal moves.
- Reward: for persona p, per decision window, `r = w_profit·Δnet_worth/scale + likes − dislikes`, with likes/dislikes from the event list above (notices, forcedSales, rank, trip log). Use net-worth change, not cash change, so holding cargo isn't punished. Normalise by start worth and difficulty.
- Delayed outcomes: a voyage's payoff arrives hours later. Use the semi-MDP discount `γ^hours` and a value head that sees ships in transit and their expected arrival.

### 5.2 Algorithm candidates

| Option | Pros | Cons | When |
| --- | --- | --- | --- |
| Scripted personas only | Cheap, explainable | Finds only what you encode | Phase 1 baseline, always keep |
| PPO + action masking, one policy per persona | Simple | 8 trainings, no sharing | Fine for 2 or 3 personas |
| PPO + masking, one persona-conditioned policy (persona vector as input) | One training, shares market understanding, personas can be mixed and interpolated | Needs balanced sampling, can collapse to the dominant persona | Recommended v1 |
| League/population training (past checkpoints as opponents) | Handles non-stationarity, finds counter-strategies | More compute and bookkeeping | Phase 3 |
| Evolutionary strategies on persona-scripted parameters | Robust, no gradients | Weaker at long-horizon credit | Cheap alternative to compare |

Library: PyTorch + Gymnasium + a small custom PPO (or CleanRL single-file) because masked, variable-candidate actions are awkward in off-the-shelf SB3. Policy network: shared encoder over candidate features with attention or a per-candidate MLP head (set-based, so K and the map can vary). Run on CPU.

### 5.3 Multi-agent setup

Each training world contains the 30 bots plus N learner companies (start N=6) and some scripted personas as opponents. Learners share policy weights (parameter sharing) but different persona vectors, so prices respond to each other's behaviour. Randomise difficulty, map seed, bot count and `expected_companies` per episode so the policy generalises.

### 5.4 Warm start by imitation

Record (observation, chosen candidate) from the scripted strategies in `playtest.ts` (plan, advice, tripsOnly, pirate) and the bot logic, then behaviour-clone before PPO. This avoids a random-play cold start where agents go bankrupt in the first days and learn nothing. Keep the scripted strategies as baselines the learned agent must beat (evaluated on held-out seeds).

### 5.5 Making agents human-like (not perfect optimisers)

- Only decide at check-ins drawn from the persona's schedule (with jitter, sleep gaps, missed days).
- Add price misjudgement like `misjudge()` in bots.ts to the candidate features the agent sees.
- Limited attention: the agent sees only the top-K candidates sampled with persona noise, and sometimes ignores inbound-cargo information.
- Mistakes: with probability `mistake_rate` take a non-argmax action or the form's default.
- Train two flavours and compare them:
  - Optimal agent: instant check-ins, no noise. Its job is finding exploits and the skill ceiling.
  - Human-like agents: imperfect, persona-conditioned. Their job is predicting experience: who wins, who gets stuck, who quits.
  - The gap between them is itself a result: a huge gap means the game rewards skill (or an exploit) far more than intended.

### 5.6 Churn predictor: is it worth it?

Not as a learned model yet. With no real sessions the "ground truth" would just be my hazard model, so training on it teaches nothing. For v1, use the hand-set hazard model and report quit rates. Revisit a learned churn model only after Phase 4, when real playtester sessions exist.

### 5.7 Believability and later calibration

- Now: sanity checks against intuition (median player earns what the docs/economy-v1 expectations say, oldDefault beginners do worst, pirates lose to police above some notoriety).
- Later (Phase 4): the server's append-only SQLite events table already records every command with a timestamp. From Discord playtesters' sessions, derive aggregates only (check-ins per day, trips per session, time to first ship purchase, when activity stops) and fit persona parameters to them. No emails, no names; strip or hash account names before analysis. This respects the "no personal data" rule.

## 6. Outputs per experiment

`python -m sim.ml.run experiments/<name>.yaml --seed 1` produces `results/<name>/report.md` plus charts (matplotlib) and CSVs:

- Net-worth distribution by persona and difficulty (box plot), median and spread vs the economy expectations in `docs/economy-v1-summary.json`.
- Dominant strategy test: does any persona beat the others by more than a set margin on all difficulties?
- Inequality: top-1% share and Gini (compare with `metrics().top1pctShare`), money supply and inflation per day (`moneySupply`, escrow).
- Usage: goods, ship classes, routes and ports used; empty-run share; machinery/ore chain throughput.
- Pirates and police: raids won/lost/captured, arrests, victims' subsequent quit rate, pirate profit vs honest trader profit.
- New-player view: net worth and quit rate at game hour 24, 48, 168.
- Quit analysis: where and why each persona quits (last events before quit).
- Exploit candidates: action sequences where the optimal agent earns far above the human-like cohort, with the trade log.
- Suggested rule tweaks, each with evidence and the exact `rules.json` key, labelled "needs Dave's approval". The program never writes to `config/rules.json`; it can run what-if overrides in memory (same mechanism as `RULES=` in `playtest.ts`).

## 6b. Continuous mode, AI-readable reports, and "more like a real player over time"

### Continuous loop

`python -m sim.ml.run --continuous experiments/live.yaml` runs until you stop it. Each cycle:

1. Collect: play a batch of seeded seasons (random map, difficulty, bot count, persona mix) with the current agents.
2. Learn: update the policy (PPO), and if real-player data exists, also learn from it (below).
3. Evaluate: replay held-out seeds against fixed baselines (scripted personas, last cycle's agent) so progress is measured, not assumed.
4. Analyse: run the exploit, balance and quit checks.
5. Report: write the cycle's report (below) and update the trend files.
6. Checkpoint, then start the next cycle.

Stopping: Ctrl-C, or creating a file named `STOP` in the run folder. Both finish the current cycle cleanly, save a checkpoint and write a final report. A later start with `--resume` continues from the last checkpoint. Safety rails: it never edits `config/rules.json`, never touches main, rotates old cycle folders (keeps the last N plus every Mth), pauses itself if disk is low, and stops with a clear message if training diverges (NaN loss, collapse to one persona).

### "Becomes more like a real player"

Be clear about what drives this:

- With no real-player data, the loop makes agents better and more varied (stronger opponents, more strategies found). It does not make them more human, because nothing in the loop knows what a human does. Humanness then comes only from the imperfection layer (check-in schedules, price misjudgement, mistakes), which is an assumption.
- With real-player data, drop anonymised session aggregates and command sequences from the playtesters' events table into `data/real/` (no names or emails; account names hashed). Each cycle then also:
  - Imitation: trains the policy to predict what real players did in the same situation (behaviour cloning), so it picks up their habits and mistakes.
  - Human-likeness discriminator: a small classifier learns to tell real sessions from simulated ones. The simulated agents get a reward bonus for fooling it (adversarial imitation, in the style of GAIL). This is what makes them drift toward real behaviour over cycles.
  - Persona fitting: an optimiser (CMA-ES) adjusts the persona parameters (check-in rate, patience, mistake rate, churn coefficients) so simulated statistics match real ones.
- Every report carries a human-likeness score (distance between simulated and real distributions: check-ins per day, trips per session, time to first ship purchase, activity decay). Before real data exists this field is null, never a made-up number.

### AI-readable report format

Every cycle writes a folder `runs/<run_id>/cycles/<000123>/` containing:

- `report.json`: the machine-readable source of truth, with a versioned schema (`schema_version`). Fixed field names, numbers with units, no prose-only facts. Top-level keys: `run` (run id, cycle, git commit, hash of rules.json, seeds, difficulty mix), `progress` (cycle-over-cycle deltas and baselines), `metrics` (net worth by persona and difficulty, Gini, top-1% share, money supply per day, inflation, goods/ships/routes usage, raids/arrests, quit rates, new-player outcomes at hour 24/48/168, human-likeness score), `findings`, `health` (training stability, determinism check, parity check), `data_quality` (how many seasons, how many real sessions).
- `findings.jsonl`: one finding per line, each with `id`, `severity` (info, warn, critical), `type` (exploit, dominant_strategy, inflation, quit_spike, pirate_imbalance, regression), `confidence`, `evidence` (metric names, values, seed list, replay command), `suggested_rule_key` and `suggested_change` where relevant, and `needs_approval: true`.
- `report.md`: a short human summary generated from the JSON (headline, top findings, what changed since last cycle). Optional chart PNGs for you; AIs don't need them.
- CSVs for raw tables, plus a `replay/` folder with the command logs for any flagged exploit so it can be reproduced on the real server.

At the run level: `LATEST.json` (pointer to the newest cycle and its headline), `INDEX.jsonl` (one summary line per cycle, append-only), `trend.json` (key metrics across all cycles), and `SCHEMA.md` (plain-language description of every field, written for an AI to read first). An AI can open `LATEST.json`, follow it to `report.json`, and act without reading anything else.

## 7. Project structure

```
sim/ml/
  bridge/bridge.ts          # JSON-lines wrapper over Engine, bots, pirate bots
  env.py                    # Gymnasium env: reset/step, candidates, masks
  personas/                 # persona schema, sampler, check-in scheduler, churn hazard
  agents/scripted.py        # port of playtest strategies via the bridge
  agents/ppo.py, policy.py  # PPO + masking, persona-conditioned encoder
  imitation.py              # behaviour cloning from scripted logs
  evaluate.py               # held-out seeds, baselines, statistical tests
  report/                   # charts and report.md generation
  config/personas.yaml, experiments/*.yaml
  tests/                    # determinism, parity, mask, reward tests
```

Run from one command (`make sim-ml EXP=baseline`, or `--continuous` for the endless loop). Every run stores config, git commit, seeds and command logs so any result can be reproduced.

Hourly task integration: leave training out of the hourly job. Let the hourly task run a cheap smoke experiment (scripted personas, 2 seeds, one difficulty, a few minutes) and flag regressions (a persona's median worth moving beyond a tolerance, new quits, money-supply drift). Training runs are manual or nightly on your machine, so no paid compute is involved.

## 8. Phased roadmap (effort figures are estimates for one developer; measure in Phase 0)

| Phase | Deliverable | "Done" test | Effort | Compute / cost |
| --- | --- | --- | --- | --- |
| 0 | Bridge + Gym env + random agent | One 56-day season runs deterministically twice with identical final worth; parity oracle against server replay passes; throughput measured in seasons per minute | 2 to 4 days | CPU only, 0 EUR |
| 1 | Scripted personas, check-in schedules, churn hazard, full report | Report generated from one command; rediscovers known playtest.ts ordering (plan > oldDefault) | 4 to 7 days | CPU, 0 EUR |
| 2 | Candidate action space, masking, behaviour cloning, first PPO | Learned agent beats the best scripted baseline on held-out seeds and difficulties, no illegal actions | 5 to 10 days | CPU, hours of training, 0 EUR |
| 3 | Persona-conditioned human-like agents, optimal-agent comparison, multi-agent league | Personas show distinct, plausible behaviour; optimal vs human gap reported; no persona collapse | 7 to 12 days | CPU (GPU optional), 0 to a few EUR electricity |
| 3b | Continuous loop (`--continuous`, STOP file, resume, rotation) and the report.json + SCHEMA.md format | Runs overnight unattended, stops cleanly on STOP, resumes, every cycle's report.json validates against the schema | 3 to 5 days | CPU, 0 EUR |
| 4 | WebSocket fidelity check, real-data imitation, human-likeness discriminator, persona fitting | Server run of one persona matches bridge within tolerance; human-likeness score rises across cycles on playtester data | 5 to 8 days | CPU, 0 EUR |

Stop gates: if Phase 1 already answers your pre-launch questions, defer Phase 3. If throughput in Phase 0 is too low for PPO (rough need: tens of thousands of seasons' worth of decisions), cut the number of bots in training worlds or shorten seasons for training and evaluate on full length.

## 9. Testing and risks

Testing the simulator itself: determinism (same seed, same result across processes); bridge vs server parity; mask tests (no masked action ever accepted by `Engine.apply`); reward unit tests on hand-built event sequences; a "do nothing" and "random legal" agent as floor baselines; ablations (remove pirates, remove the persona vector) to confirm each component matters.

| Risk | Mitigation |
| --- | --- |
| Agents exploit a bridge or reward bug, not a game flaw | Parity oracle; review every claimed exploit by replaying it on the real server |
| Reward hacking via persona weights (e.g. farming "new ship" like) | Cap per-event rewards, evaluate by net worth and by quit rate, not by training reward |
| Overfitting to one map or seed | Randomise maps, difficulty, bot count; report on held-out seeds |
| Non-stationarity from co-learning | Fixed scripted opponents in some slots; league checkpoints; track price stability |
| Policy collapse to the dominant persona | Balanced persona sampling; per-persona evaluation |
| Mistaking simulated engagement for fun | Report quits and frustration as stress indicators only; real playtester feedback remains the test for fun |
| Persona numbers are guesses | Keep them in config, run sensitivity sweeps, calibrate in Phase 4 |

## 10. Assumptions and questions (answered)

Assumptions made

- Learners play through the same commands as humans and see only information the client shows.
- The first version targets the current rules (four goods, pirates and police on, difficulty presets) and does not change them.
- Orders (`placeOrder`, `placeSell`, `buyFromOrder`) matter for launch, so the action space includes them from Phase 2.

Defaults chosen for the open questions

- Hardware: CPU only; `os.cpu_count() - 1` parallel workers by default, configurable.
- Players per season: 30 bots plus 6 learner companies in training worlds; `expectedCompanies` 60 as in `sim/playtest.ts`.
- Order features are in scope from Phase 2.
- "Quit" in real-data analysis means no check-in for 3 days; configurable.
- Location: same repo under `sim/ml/`, with its own `requirements.txt`, so the game stays dependency-light.

## Deviations

- Phase 3 re-test (2026-11-07): the persona-vector failure (C1/C2) was addressed and re-tested, with this protocol: ideas developed on seeds 421-424 and 431-434, then ONE final run on untouched seeds 441-444, reported as it came out. Changes: (1) a hand-set persona prior in `persona_policy.py` (what each persona weight does to the appetite for an action kind, quoted profit and buying a small hull), (2) a goods preference in perception (a grain-only persona does not notice ore trades), (3) persona rewards 4x stronger (`reward.UNIT` 0.02 to 0.08, `CAP` 0.05 to 0.20, still capped per term). Result on 441-444 (docs/evidence/ml-phase3/persona-prior-oneshot-441-444.json): **C2 now PASSES** (min pairwise KL 0.0031, 82% of states unanimous, was 0.0000 and 100%), C3 PASS (0 rejected), **C1 still FAILS** (pirate, casual, hardcore, impulsive and leaderboard chaser are not distinct from a neighbour by the pre-declared rule), though a leave-one-world-out nearest-centroid check names the right persona 68% of the time against 12.5% by chance. The pirate persona still made 0 raids. **Be clear about what this means: personas now differ because of my assumptions (the prior), not because anything learned them from outcomes.** The stronger rewards had not yet been used for training when this was measured.
- Phase 3b (2026-11-07): `python -m sim.ml.run --continuous sim/ml/config/experiments/live.yaml [--resume]` is built (`continuous.py`): collect league worlds, learn (PPO on the persona corrections and value heads only; the Phase 2 base stays frozen), evaluate on fixed held-out worlds against the scripted plan (4 h) and last cycle's agent, analyse, write `report.json` (validated against `sim/ml/report/report.schema.json`, v1.0), `findings.jsonl`, `report.md`, `players.csv`, plus `LATEST.json`, `INDEX.jsonl`, `trend.json`, `SCHEMA.md`, checkpoints, STOP file / Ctrl-C, `--resume`, rotation, disk-space pause, and stop on non-finite loss or persona collapse. Departures from the plan: the finding types gained `persona_collapse` and `divergence`; `human_likeness` is always null (no real data); the learning loop does not use real-data imitation or the discriminator reward (Phase 4 gaps); exploit/dominance findings are descriptive hypotheses with `needs_approval: true`, never rule edits. Each cycle takes minutes, not seconds, on this CPU.
- App (2026-11-07): `Start Simulator.bat` opens a window with Start and Stop and a Measure/Train switch; Train runs the continuous loop (optionally continuing the last run). Measure repeats the scripted experiment and learns nothing.

- Phase 3 (2026-11-06): **done-test NOT met.** Built persona-conditioned agents (`persona_policy.py`: zero-initialised persona corrections over the frozen Phase 2 policy), an imperfection layer (`imperfection.py`), persona rewards with per-term caps (`reward.py`), multi-learner league seasons with frozen-checkpoint and scripted opponents (`league.py`, `league_train.py`) and a held-out evaluation with criteria declared in advance (`league_eval.py`, seeds 401-404, 12 worlds x 5 conditions). Results: C3 legality PASS (0 rejected actions); **C1 persona distinctness FAIL** (every persona's nearest neighbour is closer than its own seed-to-seed spread); **C2 no-collapse FAIL** (mean pairwise KL 0.0003, all personas pick the same top action in 100% of states): the trained persona vector is effectively ignored, so persona differences in the human-like cohort come only from schedules, perception, mistakes and churn. Optimal (hourly, greedy) beat the human-like cohort by 1.23x/1.33x/1.28x (easy/normal/hard) but did not beat the scripted `plan` at the same cadence (0.98x/0.85x/0.92x), consistent with the unmet Phase 2 gate; no exploit candidates (no world above 1.5x). Training was 8 iterations of 8 worlds on CPU (about 30 min) with only the persona corrections and value heads trainable. Evidence: `docs/evidence/ml-phase3/`. Likely causes (not tested): too little training, shaping rewards too small next to profit, persona corrections too weakly parameterised.
- Phase 3 evaluated greedy actions for every agent: sampling from the Phase 2 policy made a human-like agent wait often enough to finish far below the optimal agent in a smoke test, so imperfection comes from perception, mistakes and schedules, and only training explores.
- Phase 4 (2026-11-06): done-test **partly** met. Server fidelity PASS: a scripted persona replayed over WebSocket on a real `main.ts` server matched the bridge exactly (10 game days, 77 commands: net worth, cash, ships). The real-data pipeline (anonymised export, session statistics, likeness distance, discriminator, CMA-ES persona fitting) is built and tested, but **there is no real playtester data**, so it was only run on a SYNTHETIC FIXTURE and on literature-derived estimates (`docs/HUMAN_BEHAVIOUR_PRIORS.md`); `human_likeness` is null by design. Not built because they need real command data and the Phase 3b continuous loop: behaviour cloning from real command sequences and the discriminator-reward (GAIL-style) bonus. Phase 3b is still outstanding.
- Phase 4 export derives company ids by replaying the event log through the real Engine (`realdata/idmap.mts`), because ids come from a counter that ships and resting orders also advance.

(Filled in during implementation: anything where the plan conflicted with the code.)

- Phase 2 (2026-11-06): implemented extended candidates/masks, engine-copy legality probes, CPU cloning/PPO, hour discounts, checkpoints and matched held-out comparisons. The 11-worker default caused memory pressure, so recorded experiments used four workers without reducing bot counts or season lengths. The first test failed Hard; a bounded follow-up with new final seeds failed Easy/Normal. **The Phase 2 acceptance gate is unmet; Phase 3 has not started.** Both tests and all replay logs are retained. Learning still controls one of six learner companies; multi-agent control is deferred. Further PPO alone did not reliably improve validation, and the follow-up selected extra imitation over its new PPO updates. See `docs/evidence/ml-phase2/README.md`.

- Phase 1 revalidation (2026-11-06): removed fictitious first-visit progress caused by treating starting cash as initial net worth, connected configured new-ship/raid-win/rank-gain likes to frustration relief, included the final daily money snapshot, and retained a command/tick/map replay log per experiment season. Raw reports explicitly keep human-likeness `null` and identify local simulator edits with a source hash and dirty-tree flag. These are scripted baseline reports; PPO, learned churn and the versioned continuous-report contract remain at their roadmap gates.
- Phase 1 telemetry observes accepted sail commands, arrivals, engine prices, and raid notifications without editing game rules. Industry throughput is reported as ore arriving at and machinery departing factory ports; factory production is `null` because the Engine API exposes no authoritative conversion counter. Price-index growth is separate from money growth, and post-raid quit associations are not causal estimates. Both fixed-map baseline reports and a seeded industrial-map smoke run were executed.

- Phase 0 revalidation (2026-11-06): the existing plan, Phase 0 and Phase 1 commits were already on `sim-ml-players`; they were preserved rather than recreated. Environment, bridge and benchmark defaults were aligned to 30 bots plus six learner companies. The Phase 0 Gym environment controls only the first learner, leaving the other five idle; simultaneous control and learning remain later-phase work. `expectedCompanies` remains 60. Phase 0 uses the wire field `hours` for `step`, rather than the draft's `advance_hours`.

- Python deps are split: `sim/ml/requirements.txt` (Phase 0-1) and `sim/ml/requirements-train.txt` (PyTorch, from Phase 2), so early phases don't pull a ~200 MB wheel.
- Parity oracle: `main.ts` starts a server on import, so it can't be imported. `sim/ml/bridge/parity.mts` instead writes the bridge log into a throwaway SQLite `events` table (plus `world_map`) and starts the real server on it, so the server's own replay loop runs. Limits: default `config/rules.json` only (the server loads that file), and at most 20 companies (the leaderboard shows the top 20). Compared: every company's rounded net worth, plus tick, money supply, escrow, ships and company count.
- Phase 0 `candidates` (trade, carry, sell, sail-empty to the 2 nearest ports, wait) are a minimal version: ship purchases, scrapping, orders and raids are Phase 2.
- Phase 1 churn: the plan's `sigmoid(a*F + b*boredom - c*progress)` has no baseline, so it can't be near zero for a contented player; an offset `d` (default -6) was added. The sigmoid is read as a per-DAY quit chance and converted to the visit by elapsed time, and waiting-type dislikes (no-move, idle, near-broke) are per day of waiting, so a persona's visit rate doesn't change how frustrated it gets. Both were found by a failing test and an early run where 8-visits-a-day players quit within a day.
- Phase 1 scripted play drives every docked non-pirate ship (playtest.ts only drove the first); with one ship it is identical. `newDefault` keeps playtest.ts's dead "press the green button" branch (it never runs there either), so the baseline reproduces the old results.
- Phase 1 `report.json` is the raw aggregate; the versioned schema format of section 6b is Phase 3b. Exploit candidates and rule suggestions need the optimal agent (Phase 3).
- Environment note: this machine had no Node or Git; both were installed with winget (Node 26.13 LTS, Git 2.56). The server declares `node >=22.13`.
- Repo setup: the supplied zip contained no `.git`. The snapshot was imported and committed as a baseline on `main`; `sim-ml-players` branches from that commit.
- Mood layer (2026-11-07, `sim/ml/personas/mood.py`): human-like league players carry five moods in [0, 1] (anger, fear, elation, boredom, guilt) that rise on events (raided, arrested, forced sale, near broke, big loss, profit, new ship, raid win, rank gain/fall, no move, stuck rank) and fade by half-life. They change how the player plays, never what the engine allows: mistake rate (anger, fear, boredom up), price overconfidence (elation), attention (boredom and fear down), and impulses (revenge raid from anger, safe wait from fear, ship splurge from elation). Also added: conscience (guilt after a raid win or arrest makes the player skip raids, wearing off with repeated raiding), goods memory (a good that lost money is avoided, one that paid is liked), and focus (attention rises after two losing visits in a row). Persona settings `emotionality` (0 turns the layer off), `conscience` and `rumination` (stretches anger, fear and guilt half-lives). **Every magnitude is an assumption.** Only the fear (24 h) and elation (30 h) half-lives and the 2x loss factor have a cited source (`docs/PSYCHOLOGY_PRIORS.md`); anger, boredom and guilt durations, event amounts and effect sizes have none.
- Mood outputs and players' ideas (2026-11-07): each continuous cycle appends to the run folder `moods.jsonl` (mean peak mood, impulses, mistake rate in vs out of mood) and `ideas.jsonl` (`ideas.py`), and prints the matching `cycle N: moods ...` and `players' ideas this cycle` log lines. The ideas are templated: each player picks up to two from a fixed catalogue of ten according to its own complaints and likes. They show what simulated players complain about, not that real players want anything.
- Gemini ideas (2026-11-07, `gemini_ideas.py`): off by default; enabled by `gemini:` in the experiment yaml or the app's always-on slider (an empty `GEMINI` flag file in the run folder, checked every cycle) and on demand by the app's "Ask Gemini for ideas" button. The key is read only from the `GEMINI_API_KEY` environment variable; only aggregate synthetic numbers are sent (cohort medians, finding types, templated complaints, mood averages). Model `auto` picks the newest Flash the key can list, with a 404 fallback. A 429/500/503 is retried after 5, 15 and 30 s; a failed cycle is retried with back-off (2 min doubling to 1 h, state in `gemini_state.json`), at most 10 attempts a day. Answers go to `ideas_gemini.jsonl`, labelled as LLM-generated and needing approval. Failures are logged and never stop training. Nothing edits `config/rules.json`.
- STOP-file fix (2026-11-07): the loops used to delete any existing STOP at startup, which also removed a STOP the app wrote in the seconds the child took to import. `clear_stale_stop` (`controller.py`) now removes a STOP only if it is older than the launch time passed in `SIM_STARTED_AT`; run by hand, any existing STOP is still treated as stale.
- Mood layer caveats (open): a 3-season probe showed mood-on players ending with a much lower median net worth and more quits than mood-off, and a reviewer judged some in-mood mistake rates implausibly high. The strength was kept as it is at the user's request, pending a sweep of the magnitudes. Treat mood-on results as a stress test with assumed numbers, not a calibrated model of players.
