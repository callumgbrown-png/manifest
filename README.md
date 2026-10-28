# Manifest

A browser-based freight economy MMO where every price comes from players.

## Economy simulator (week 1)

```
python tools/generate_map.py     # writes config/map.json
python sim/simulate.py --seasons 10 --companies 300
```

- `config/rules.json` — all economy rules (prices, fees, ships), shared with the future server.
- `sim/simulate.py` — bot trading companies play full seasons; results go to `results/`.
- Override a rule for one run: `--set ship.fuel_per_100_distance=3`
- Change the bot mix: `--mix greedy=0.5,casual=0.5`

Status: work in progress. Early runs show too many ships chasing too little cargo; production rates are being tuned.
