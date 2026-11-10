# Psychology behind the mood model (sim/ml/personas/mood.py)

Four research agents read web search summaries (not full papers). **Only figures marked (V) were seen in a source; everything else is consensus or my modelling assumption.** None of this is data about Manifest players.

| Model part | Setting | Basis |
|---|---|---|
| Fear half-life 24 h | (V) ~24 h mean | Verduyn & Lavrijsen 2014 (233 students recalling episodes) |
| Elation half-life 30 h | (V) ~35 h mean in the same study | same |
| Anger half-life 8 h | consensus "minutes to hours"; **no verified figure** | assumption |
| Boredom 12 h, guilt 48 h | **no verified figure** | assumption |
| `rumination` stretches anger, fear, guilt (x1 to x2.2) | (V) duration is driven mainly by rumination and event importance | same study |
| Losses count 2x gains (`LOSS_AVERSION`) | (V) mean 1.955, CI 1.82-2.10, 607 estimates | Brown et al., J. Econ. Literature 2024; T&K 1992 gave 2.25 |
| Fading thrill of repeated wins (`habit`) | partial adaptation by consensus; rate is an assumption | Brickman 1978, Diener revisions |
| Guilt wears off with repeated raiding, lighter if wronged first | familiarity with violent games reduces guilt; justified attacks feel easier | Hartmann & Vorderer 2010 |
| Tilt (anger raises mistakes), overconfidence (elation raises price error) | direction only, no effect size or decay time found | poker tilt studies, Barber & Odean (V: frequent traders 11.4%/yr vs 18.5%) |
| `emotionality` ~ neuroticism, `conscience` ~ agreeableness + conscientiousness | (V) r about +.2 to +.3 neuroticism, -.3 conscientiousness, -.2 agreeableness for problem gaming/gambling | meta-analyses (Dudfield 2021 etc.); the persona-to-trait mapping is my judgement |

**Not found:** anger/boredom/guilt durations, tilt decay, hot-hand and sunk-cost sizes, neuroticism-to-reactivity r, share of players who quit after being raided, anything specific to browser economy games.
Bartle shares (10/10/80/1) are folklore and are not used. Sources are listed in the four agent reports (Verduyn & Lavrijsen 2014 doi 10.1007/s11031-014-9445-y; Brown et al. 2024 doi 10.1257/jel.20221698; Hartmann & Vorderer 2010; Przybylski, Rigby & Ryan 2010 doi 10.1037/a0019440).
