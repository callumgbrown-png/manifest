# Human behaviour: what is published, and the estimated players built from it

Written 2026-11-06 for the ML player simulator (`docs/ML_PLAYER_SIM_PLAN.md`). **None of this is measured on Manifest players.** It is
a literature search plus clearly labelled judgement, used to make the simulated players less arbitrary and to give the Phase 4
likeness code something to run on until real playtester exports exist. A score against these estimates is a `fixture_score`;
`human_likeness` stays `null` until real data exists.

Method: four research passes (browser economy games; churn/survival; session timing; trading mistakes and defaults). Each figure
below was read on a page or paper that was opened (PDF text extracted locally where the fetch tool returned raw bytes), except where
marked **unverified**. Nothing is extrapolated. Where a quantity was not found, it says so.

## What the evidence supports

| Question | Finding | Source | Fit to Manifest |
|---|---|---|---|
| Early loss | Classic exact-day retention, Strategy genre: D1 25.39%, D7 8.06%, D30 3.12% | Mistplay via [Segwise](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies) | medium: mobile installs, not testers |
| Early loss | GameAnalytics 2024 (11,600 apps): median D7 3.4-3.9%; "75% of projects have a D28 Retention lower than 3%"; "classic, not Rolling Retention" | [GameAnalytics 2025 report summary](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks) | medium |
| Early loss | "Approximately 80% of the non-playing players have churned the first day they connected" (1.5M players, Age of Ishtaria; churn = 10 days without connecting) | [Periáñez et al.](https://ar5iv.labs.arxiv.org/html/1710.02264) | medium |
| Hazard shape | Quit hazard **falls** with time played: about 0.6/h at the start, 0.3/h after 4 h, about 0.2/h from 10 h (3,753 players, Hipster Sheep); exponential "overestimates early survival" | [Viljanen et al.](https://ar5iv.labs.arxiv.org/html/1701.02359) | low (hours of play, mobile puzzle) |
| Definition matters | One app: D1 43% classic vs 59% rolling vs 32% by 24-hour window | [GoPractice](https://gopractice.io/blog/day-n-retention-rolling-retention-and-the-many-facets-of-the-retention-metric/) | the simulator uses **classic** |
| Churn threshold | Studies use 3, 7, 10 or 13 days of inactivity (Ishtaria chose 9 and 13 days; its per-threshold rates are only in a figure) | [Periáñez et al. 2019](https://ar5iv.labs.arxiv.org/html/1907.03947) | the 3-day "quit" here is at the short end |
| Check-ins | Pardus (browser space-trading MMO): "Players typically log in once a day and perform all their limited movements of the day within a few minutes" (n=1,458) | [PMC3375635](https://pmc.ncbi.nlm.nih.gov/articles/PMC3375635) | **high genre, but Pardus has a daily action budget; Manifest does not** |
| Check-ins | Mobile average "4 sessions per day"; idle games 5.3; midcore 6-7; WoW slides: "more than 80% gamers login less than 2 times per day" | GameAnalytics (above), [GameAnalytics idle post](https://gameanalytics.com/blog/how-to-keep-players-engaged-and-coming-back-to-your-idle-game), [WoW slides](https://www.slideshare.net/mmnet/an-analysis-of-wow-players-game-hours) | medium |
| Time of day | MMO peak 8-10 pm (Fairyland, 51,104 players); 9 pm-1 am (WoW slides); mobile peak local hour 20 | [Fairyland](https://ar5iv.labs.arxiv.org/html/1702.08005), [ByteBrew](https://bytebrew.io/blog/bytebrew-insights-playerplay-times) | medium |
| Weekends | 1.4-1.5x more play at weekends (Fairyland) vs "only slightly" different (WoW slides): sources disagree | same | no weekend effect modelled |
| Gaps | Break times between games are long-tailed with daily and weekly peaks; no fit parameters published | [Axon](https://ar5iv.labs.arxiv.org/html/1703.04696) | supports sleep gaps and skipped days |
| Days active | 2.3, 3.3, 4.2 days played per week (Miitomo, Candy Crush, Clash Royale; 2016 survey, n not stated) | [Ubergizmo](https://www.ubergizmo.com/2016/05/miitomo-stats-shows-declining-players/) | low |
| Concentration of play | Steam: top 20% of users account for 82.4% of playtime; 90th percentile two-week playtime 8.9 h, "the majority of users exhibit behaviors far below" | [O'Neill et al.](https://zappala.byu.edu/pubs/steam-imc-2016.pdf) | low (PC) |
| Concentration of activity | Pardus actions are heavy-tailed (power-law exponent about -1.18; 7,818 players); mean 117.1 h between trades | [Fuchs & Thurner](https://ar5iv.labs.arxiv.org/html/1407.2006) | high genre |
| Wealth inequality | Pardus Gini 0.653, top 10% hold 49.9%; EVE top 10% hold 98.26% (85.34% among players over 20 h) | [Pardus](https://ar5iv.labs.arxiv.org/html/1403.6342), [EVE, DiGRA 2020](https://blogs.tuni.fi/playlab/game-research-highlights/the-dedicated-get-richer/) | medium-high |
| Skill | Players with better early scores progress faster (r = 0.59 between early variance and later score; n=21,575); spacing practice by 24 h worth about an extra 50% of practice | [Stafford & Dewar](https://eprints.whiterose.ac.uk/id/eprint/83582/1/stafford_and_dewar_postprint.pdf) | medium (not an economic task) |
| Social | WoW: players with no guild churned 1.33x as much | [Khan, arXiv 2006.15735](https://arxiv.org/abs/2006.15735) | Manifest has no guilds |
| Losses and quitting | Aion: deaths and class were "not significant" among 60+ metrics for churn; fewer than 7 levels (about 3 h) meant very high churn risk | [Game Developer](https://www.gamedeveloper.com/design/predicting-churn-data-mining-your-game) | medium |
| Player-killing | ArcheAge: player killing ranks 6th among churners' activity peaks vs 48th for stayers; no effect size, and churners may have been the killers | [arXiv 1703.01500](https://ar5iv.labs.arxiv.org/html/1703.01500) | low |

## What was NOT found (these stay assumptions)

- Day-1/week/month retention, check-ins by lifetime stage, session minutes, and time to first extra-unit purchase for **any slow browser game**
  (OGame, Travian, Tribal Wars, Ikariam, Forge of Empires: nothing published that was found).
- Typical error in human price estimates, shares of optimisers vs beginners, default-acceptance rates, and economic learning curves.
- Any verified effect of **being raided/ganked on quitting.** The one verified direct test (Aion deaths) found no effect; EVE
  "ship destroyed predicts month-4 retention" appears only as a secondhand forum quote (unverified); ArcheAge is confounded.
- Inter-session gap distribution parameters; days active per month.
- Unverified (search snippets only, not used): GameAnalytics 2026 medians 22%/4%/0.7%; AppsFlyer 31.85%/12.18%/5.35%; a PC Gamer "5.1% churn after three losses".

## Estimated players (`config/human_priors.yaml`, `realdata/priors.py`)

`python -m sim.ml.realdata.priors --scenario organic|recruited` draws a population in the same format as a real export. Marked
`synthetic: true`, `kind: literature_prior`.

| Quantity | Value | Basis |
|---|---|---|
| Retention curve, **organic** | D1 25.4%, D7 8.1%, D30 3.1% | cited (Strategy genre) |
| Retention curve, **recruited** | D1 60%, D7 35%, D30 15% | **assumption, no source** (self-selected testers stay longer) |
| Day-56 retention | 55-60% of day 30 | assumption |
| Hazard shape | decreasing, piecewise by day (derived from the curve) | cited shape; numbers derived |
| Sessions per active day | median 2.0, log-normal spread 0.7 | between Pardus (1) and mobile (4-5): assumption |
| Chance a still-engaged player shows on a day | Beta, mean 0.67 (organic) / 0.8 (recruited) | assumption |
| Trips per session | median 1.2 | assumption (no data) |
| Buy an extra ship | 55%, mean 6 active days later | assumption (no data) |

The generator reproduces its own anchors (4,000 players): organic D1/D7/D30 = 26.3%/8.4%/3.1% against 25.4%/8.1%/3.1%; recruited
60.6%/35.8%/16.0% against 60/35/15. Share of sessions from the top 20% of players: 78% (organic), 69% (recruited), against Steam's 82%
playtime share (a comparison, not a fit).

## What this says about the current personas (a check, not a fit)

Likeness of the eight unfitted Phase 1 personas against these estimates (`fixture_score`, 0 to 1; discriminator AUC 0.5 = indistinguishable):

| Estimated population | fixture_score | distance | discriminator AUC | Main gaps |
|---|---|---|---|---|
| organic | 0.056 | 2.89 | 0.99 | sessions/day and active-day fraction: the estimate has 98% of players gone within the 56 days, median 0.06 sessions/day over the whole season |
| recruited | 0.318 | 1.15 | 0.97 | active-day fraction (1.6) and quit (1.4) |

Reading it plainly: the personas are **far more persistent and more active** than anonymous-install retention numbers imply, and their
quit rates (roughly 10-60% over a season) are well below the organic estimate (98% inactive for the last 3 days). That is expected if
Manifest's testers are recruited and motivated, but it is exactly the thing that real data should settle. Do not tune the personas
to the organic numbers: they describe installs from stores, not people invited to play a hobby game.

Other implications for the simulator, each with its confidence:

1. **Raid-related frustration is unsupported.** `w_raided` (1.5-2.5) and `w_fine_lockout` encode that being raided makes people quit.
   The only direct verified test (Aion) found deaths not significant; the supportive evidence is anecdotal. Treat victim churn as unknown
   and run sensitivity sweeps with `w_raided` near 0.
2. **Check-in rate.** 3-8 check-ins a day for several personas is high next to Pardus (about once a day) and WoW (under 2 for 80%).
   Keep `hardcore_optimiser` as the tail, but a population median near 1-3 per active day is better supported.
3. **Inequality.** Pardus (Gini 0.65) and EVE (top 10% hold 98%) are much more unequal than the simulated worlds (Gini about 0.2 with 36 companies).
   Part of this is inactive accounts in real worlds; a 36-company simulation cannot show it. Do not read the simulator's low Gini as a finding.
4. **Skill spread.** A persistent early skill gap that widens is supported (Stafford & Dewar), which the fixed `mistake_rate` per persona does not model.
5. **Hazard shape.** Decreasing hazard is supported. The Phase 1 churn model is a per-day sigmoid driven by frustration and has no age effect; adding
   one (higher quit chance on day 0-1) would match the literature better.

## Limits

Sources are mostly mobile vendors, one PC platform and a few old MMO papers; none measures a slow, hobby, browser freight game. Retention
here is treated as survival, which overstates permanent quits. The 3-day quit definition is the project's default and the literature uses
longer ones. The first real export should replace every row marked assumption.
