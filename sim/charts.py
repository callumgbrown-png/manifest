"""Chart simulator results: python sim/charts.py [results]"""
import csv, sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

out = Path(sys.argv[1] if len(sys.argv) > 1 else "results")
seasons = sorted(out.glob("season_*.csv"), key=lambda p: int(p.stem.split("_")[1]))
panels = [("money_supply", "Money supply (credits)"), ("median_networth", "Median company net worth"),
          ("grain_price_at_consumers", "Grain price at consumer ports"), ("top1pct_share", "Net worth held by top 1%")]
fig, axes = plt.subplots(2, 2, figsize=(12, 8))
for ax, (col, title) in zip(axes.flat, panels):
    for i, p in enumerate(seasons):
        rows = list(csv.DictReader(open(p)))
        ax.plot([int(r["day"]) for r in rows], [float(r[col]) for r in rows],
                color="#2a6fdb", alpha=0.35 if i else 0.9, linewidth=1.2)
    ax.set_title(title, loc="left", fontsize=11)
    ax.set_xlabel("Day of season")
    ax.spines[["top", "right"]].set_visible(False)
fig.suptitle(f"Manifest economy: {len(seasons)} simulated seasons, 300 bot companies", x=0.06, ha="left", fontsize=13)
fig.tight_layout()
fig.savefig(out / "economy.png", dpi=120)
print("wrote", out / "economy.png")
