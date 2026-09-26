#!/usr/bin/env python3
"""Vet a freshly built data/metals.json against the committed one.

The weekly refresh runs unattended, so a truncated or stale upstream response
would be committed and published with nobody looking. These series only ever
gain days: a rebuild that drops years, loses its daily fixes or moves its
latest fix backwards is a bad fetch rather than news, and this refuses one.

It also reports whether anything beyond meta.generated moved, so a quiet week
does not land an empty commit.

    python3 scripts/check_data.py <previous metals.json> [new metals.json]
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USAGE = "usage: check_data.py <previous metals.json> [new metals.json]"


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        sys.exit(f"check: cannot read {path}: {exc}")


def substantive(payload):
    """The payload minus meta.generated, which moves on every single run."""
    meta = {k: v for k, v in payload["meta"].items() if k != "generated"}
    return {"meta": meta, "years": payload["years"]}


def problems(old, new):
    found = []
    if new["meta"]["latest_date"] < old["meta"]["latest_date"]:
        found.append("latest fix went backwards: "
                     f"{old['meta']['latest_date']} -> {new['meta']['latest_date']}")
    if new["meta"]["last_year"] < old["meta"]["last_year"]:
        found.append("last year went backwards: "
                     f"{old['meta']['last_year']} -> {new['meta']['last_year']}")
    if new["meta"]["cpi_first_year"] != old["meta"]["cpi_first_year"]:
        found.append("CPI no longer starts at "
                     f"{old['meta']['cpi_first_year']}")

    dropped = sorted(set(old["years"]) - set(new["years"]))
    if dropped:
        found.append(f"{len(dropped)} year(s) dropped, first {dropped[0]}")

    for year, was in sorted(old["years"].items()):
        now = new["years"].get(year)
        if not now:
            continue
        if was["basis"] == "fix" and now["basis"] != "fix":
            found.append(f"{year} lost its daily fixes")
        if not was.get("partial") and now.get("partial"):
            found.append(f"{year} was a complete year and is now partial")
    return found


def check(previous_path, new_path):
    old, new = load(previous_path), load(new_path)

    found = problems(old, new)
    if found:
        # Complaints go to stderr so stdout stays key=value for the caller.
        for line in found[:10]:
            print(f"  ! {line}", file=sys.stderr)
        if len(found) > 10:
            print(f"  ! ... and {len(found) - 10} more", file=sys.stderr)
        sys.exit("check: this rebuild looks wrong, refusing it")

    changed = substantive(old) != substantive(new)
    print(f"changed={'yes' if changed else 'no'}")
    print(f"latest={new['meta']['latest_date']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not 1 <= len(args) <= 2:
        sys.exit(USAGE)
    check(args[0], args[1] if len(args) > 1 else ROOT / "data" / "metals.json")
