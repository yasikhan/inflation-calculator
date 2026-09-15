#!/usr/bin/env python3
"""Stamp assets/*.css and assets/*.js in index.html with a content hash.

A static site has no build step, so a hand-written ?v= token gets forgotten
exactly when it matters: the markup ships and the browser keeps serving the
asset it already had. The token is the file's own hash here, so editing an
asset changes its URL and nothing else does.

Run after touching anything in assets/.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"


def stamp():
    html = PAGE.read_text(encoding="utf-8")

    def swap(match):
        attr, path = match.group(1), match.group(2)
        asset = ROOT / path
        if not asset.exists():
            sys.exit(f"stamp: {path} does not exist")
        digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
        print(f"  {path}  ?v={digest}")
        return f'{attr}="{path}?v={digest}"'

    out = re.sub(r'(href|src)="(assets/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"', swap, html)
    if out != html:
        PAGE.write_text(out, encoding="utf-8")
        print("index.html updated")
    else:
        print("index.html already current")


if __name__ == "__main__":
    stamp()
