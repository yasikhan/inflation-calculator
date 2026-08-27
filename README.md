# The Evolution of the Dollar

Measuring the relative value of the dollar using the gold and silver standard — an
inflation calculator anchored to metal rather than to CPI, with the official CPI shown
alongside for contrast.

Enter an amount, the year you had it, and the year you want it priced in. The amount is
converted into ounces of gold and ounces of silver at the first year's price, then back into
dollars at the second year's price. The ounce is the fixed quantity; only the dollars on
either side of it move.

$250 in 1965 is 7.042 oz of gold or 193.68 oz of silver, which is $31,635.39 or $13,819.92
in 2026 dollars. Official CPI puts the same $250 at $2,627.72.

Static site, no build step and no dependencies — GitHub Pages serves the repo root directly.

## Data

`data/metals.json` holds gold and silver prices at the beginning and end of every year from
1900 to the present, plus annual CPI-U for contrast. Each year is valued at the midpoint of
its opening and closing price.

| Span | Series | Source |
|---|---|---|
| 1968– | Gold, silver | Daily London fixes, [LBMA](https://prices.lbma.org.uk/) — each year's first and last fix |
| 1900–1967 | Silver | [USGS Data Series 140](https://www.usgs.gov/centers/national-minerals-information-center/historical-statistics-mineral-commodities-united) unit value, which tracks the annual New York price to within about 0.3% |
| 1900–1967 | Gold | The administered price: $20.67 until 1933, $35.00 from 1934 |
| 1913– | CPI-U | [FRED CPIAUCNS](https://fred.stlouisfed.org/series/CPIAUCNS) |

Before 1968 there was one published figure per year, so the opening and closing prices are
the same and each year is flagged `"basis": "annual"`. CPI-U does not exist before 1913, and
those years carry no CPI rather than an extrapolation.

The open/close midpoint is not the same as a year's average, and in a violent year the two
part company: silver opened 1980 at $39.95 and closed it at $15.50, a midpoint of $27.73
against a true annual mean near $20.98. Each year also carries a `mean` field computed from
every daily fix, if you would rather work from that.

## Refreshing the data

```sh
python3 scripts/build_data.py --refresh
```

Stdlib only, no packages needed. Raw upstream responses are cached in `data/raw/`; without
`--refresh` the script rebuilds from that cache.

## Running it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. It needs to be served rather than opened as a `file://`
URL, because the page fetches `data/metals.json`.

## Publishing

Push to GitHub, then enable Pages on the default branch with the root folder as the source.
`.nojekyll` is present so `assets/` is served verbatim.
