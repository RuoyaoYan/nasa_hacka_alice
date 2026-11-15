#!/usr/bin/env python3
"""Refresh the MEDA copy in data/weather.js from NASA's Perseverance weather feed.

    python3 tools/weather/snapshot_meda.py

The game reads the live feed in the browser when it can; this copy is the
fallback for offline demos and for browsers that block the request.
"""
import datetime
import json
import re
import urllib.request
from pathlib import Path

FEED = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json"
KEEP = ("terrestrial_date", "sol", "ls", "season", "min_temp", "max_temp", "pressure", "sunrise", "sunset")
TARGET = Path(__file__).resolve().parents[2] / "data" / "weather.js"


def main() -> None:
    with urllib.request.urlopen(FEED, timeout=30) as r:
        feed = json.load(r)
    sols = sorted(feed.get("sols", []), key=lambda s: int(s["sol"]))[-7:]
    if not sols:
        raise SystemExit("The feed returned no sols; data/weather.js was left unchanged.")
    rows = ",\n".join("        " + json.dumps({k: s.get(k, "--") for k in KEEP}, ensure_ascii=False) for s in sols)
    js = TARGET.read_text(encoding="utf-8")
    js = re.sub(r'copied: "[^"]*"', f'copied: "{datetime.date.today().isoformat()}"', js, count=1)
    js = re.sub(r"(sols: \[\n)(.*?)(\n      \])", lambda m: m.group(1) + rows + m.group(3), js, count=1, flags=re.S)
    TARGET.write_text(js, encoding="utf-8")
    print(f"Updated {TARGET} with MEDA sols {sols[0]['sol']} to {sols[-1]['sol']}.")


if __name__ == "__main__":
    main()
