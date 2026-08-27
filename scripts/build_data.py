#!/usr/bin/env python3
"""Build data/metals.json: gold, silver and CPI by year, 1900 to the present.

Sources
  1968-now  LBMA daily gold PM fix and silver fix       prices.lbma.org.uk
  1900-1967 silver, USGS Data Series 140 unit value     usgs.gov
  1900-1967 gold, the administered price (table below)
  1913-now  CPI-U, not seasonally adjusted              FRED CPIAUCNS

Stdlib only. Re-run to refresh; raw responses are cached in data/raw/.
"""

import json
import re
import ssl
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "metals.json"

START_YEAR = 1900
TROY_OZ_PER_TONNE = 32150.7466

SOURCES = {
    "gold_lbma": "https://prices.lbma.org.uk/json/gold_pm.json",
    "silver_lbma": "https://prices.lbma.org.uk/json/silver.json",
    "silver_usgs": "https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/"
                   "production/s3fs-public/media/files/ds140-silver-2021.xlsx",
    "cpi_fred": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS",
}

# The US/London gold price, 1900-1967. Fixed at $20.67 under the Gold Standard
# Act, revalued to $35.00 by the Gold Reserve Act of 1934; the 1940s figures are
# the freer London market. LBMA daily fixes take over from 1968.
GOLD_PRE_1968 = {
    1933: 32.32, 1940: 34.50, 1941: 35.50, 1942: 35.50, 1943: 36.50,
    1944: 36.25, 1945: 37.25, 1946: 38.25, 1947: 43.00, 1948: 42.00,
    1949: 40.50, 1950: 40.25, 1951: 40.00, 1952: 38.70, 1953: 35.50,
    1954: 35.25, 1955: 35.15, 1956: 35.20, 1957: 35.25, 1958: 35.25,
    1959: 35.25, 1960: 36.50, 1961: 35.50, 1962: 35.35, 1963: 35.25,
    1964: 35.35, 1965: 35.50, 1966: 35.40, 1967: 35.50,
}
for _y in range(1900, 1933):
    GOLD_PRE_1968[_y] = 20.67
for _y in range(1934, 1940):
    GOLD_PRE_1968[_y] = 35.00


def fetch(key, filename, refresh=False):
    """Download a source, caching it under data/raw/."""
    path = RAW / filename
    if path.exists() and not refresh:
        print(f"  cached  {filename}")
        return path.read_bytes()
    print(f"  fetch   {filename}")
    req = urllib.request.Request(SOURCES[key], headers={"User-Agent": "Mozilla/5.0"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
        body = resp.read()
    RAW.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body


def lbma_series(body):
    """Daily fixes as {year: [(date, usd_price), ...]} in date order."""
    rows = json.loads(body)
    out = {}
    for row in rows:
        values = row.get("v") or []
        if not values or values[0] in (None, ""):
            continue
        day, price = row["d"], float(values[0])
        if price <= 0:
            continue
        out.setdefault(int(day[:4]), []).append((day, price))
    for year in out:
        out[year].sort()
    return out


def xlsx_rows(body):
    """Rows of an xlsx worksheet as {column_letter: value} dicts."""
    path = RAW / "_tmp.xlsx"
    path.write_bytes(body)
    try:
        with zipfile.ZipFile(path) as zf:
            shared = []
            if "xl/sharedStrings.xml" in zf.namelist():
                blob = zf.read("xl/sharedStrings.xml").decode("utf8", "replace")
                shared = [
                    "".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))
                    for si in re.findall(r"<si>(.*?)</si>", blob, re.S)
                ]
            sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf8", "replace")
    finally:
        path.unlink(missing_ok=True)

    rows = []
    for raw_row in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S):
        cells = {}
        for attrs, body_xml in re.findall(r"<c ([^>]*?)>(.*?)</c>", raw_row, re.S):
            ref = re.search(r'r="([A-Z]+)\d+"', attrs)
            if not ref:
                continue
            value = re.search(r"<v>(.*?)</v>", body_xml, re.S)
            text = value.group(1) if value else ""
            kind = re.search(r't="(\w+)"', attrs)
            if kind and kind.group(1) == "s" and text != "":
                text = shared[int(text)]
            cells[ref.group(1)] = text
        rows.append(cells)
    return rows


def usgs_silver(body):
    """Annual silver price 1900-1967 in $/troy oz, from the USGS unit value.

    USGS publishes a unit value in dollars per metric ton of silver content;
    for silver this tracks the annual average New York price to within ~0.3%.
    """
    header, column = None, None
    out = {}
    for cells in xlsx_rows(body):
        if header is None:
            for ref, text in cells.items():
                if text == "Unit value ($/t)":
                    header, column = True, ref
            continue
        year = cells.get("A", "")
        if not re.fullmatch(r"\d{4}", year):
            continue
        try:
            out[int(year)] = float(cells[column]) / TROY_OZ_PER_TONNE
        except (KeyError, ValueError):
            continue
    if column is None:
        sys.exit("USGS: could not find the 'Unit value ($/t)' column")
    return out


def cpi_annual(body):
    """Annual mean CPI-U from FRED's monthly series."""
    monthly = {}
    for line in body.decode("utf8").splitlines()[1:]:
        parts = line.split(",")
        if len(parts) < 2 or parts[1] in (".", ""):
            continue
        monthly.setdefault(int(parts[0][:4]), []).append(float(parts[1]))
    return {y: sum(v) / len(v) for y, v in monthly.items()}


def metal_year(open_price, close_price, mean_price):
    return {
        "open": round(open_price, 4),
        "close": round(close_price, 4),
        "mid": round((open_price + close_price) / 2, 4),
        "mean": round(mean_price, 4),
    }


def build(refresh=False):
    print("Sources:")
    gold_daily = lbma_series(fetch("gold_lbma", "lbma_gold_pm.json", refresh))
    silver_daily = lbma_series(fetch("silver_lbma", "lbma_silver.json", refresh))
    silver_old = usgs_silver(fetch("silver_usgs", "usgs_ds140_silver.xlsx", refresh))
    cpi = cpi_annual(fetch("cpi_fred", "fred_cpiaucns.csv", refresh))

    latest = max(gold_daily[max(gold_daily)][-1][0], silver_daily[max(silver_daily)][-1][0])
    end_year = int(latest[:4])

    years = {}
    for year in range(START_YEAR, end_year + 1):
        entry = {}

        if year in gold_daily and year in silver_daily:
            entry["basis"] = "fix"
            for name, daily in (("gold", gold_daily), ("silver", silver_daily)):
                prices = [p for _, p in daily[year]]
                entry[name] = metal_year(prices[0], prices[-1], sum(prices) / len(prices))
        else:
            # Pre-1968: one administered or annually-averaged figure per year,
            # so the open, close and mean all carry the same value.
            entry["basis"] = "annual"
            gold = GOLD_PRE_1968.get(year)
            silver = silver_old.get(year)
            if gold is None or silver is None:
                sys.exit(f"missing pre-1968 price for {year}")
            entry["gold"] = metal_year(gold, gold, gold)
            entry["silver"] = metal_year(silver, silver, silver)

        # CPI-U begins in 1913. Earlier years carry no CPI at all rather than
        # an extrapolation, and the page says so.
        if year in cpi:
            entry["cpi"] = round(cpi[year], 4)
        if year == end_year:
            entry["partial"] = True
        years[str(year)] = entry

    payload = {
        "meta": {
            "generated": date.today().isoformat(),
            "latest_date": latest,
            "first_year": START_YEAR,
            "last_year": end_year,
            "cpi_first_year": min(cpi),
            "sources": SOURCES,
        },
        "years": years,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n")
    print(f"\nWrote {OUT.relative_to(ROOT)}: {START_YEAR}-{end_year}, latest fix {latest}")
    return payload


if __name__ == "__main__":
    build(refresh="--refresh" in sys.argv)
