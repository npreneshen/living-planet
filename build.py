#!/usr/bin/env python3
"""Reassemble the standalone Interactive Globe HTML from src/ modules.

The app ships as ONE self-contained HTML file (works offline, from a
file:// URL, no server, no build toolchain). This repo splits that file
into reviewable modules purely for GitHub's benefit — vendor libraries,
data payloads, app code and markup live in separate files so diffs and
code review stay sane. This script is the inverse of that split: it
concatenates the modules, in the exact order recorded in
src/manifest.json, back into the single distributable file.

Usage:
    python build.py                 # writes dist/interactive-globe.html
    python build.py -o my.html      # custom output path
    python build.py --check FILE    # build, then byte-compare against FILE

No dependencies beyond the Python 3 standard library.

How it works: manifest.json is an ordered list of segments. "raw"
entries are verbatim HTML chunks (head, page shell, modal markup).
"script"/"style" entries are the INNER code of one <script>/<style>
block, stored as .js/.css so GitHub renders them properly; each entry
also records the block's exact original opening tag (some scripts carry
attributes, e.g. <script data-grib="jpx">), so re-wrapping reproduces
the original file byte-for-byte.
"""
import argparse, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLOSE = {"script": "</script>", "style": "</style>"}


def build():
    with open(os.path.join(HERE, "src", "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    parts = []
    for entry in manifest:
        path = os.path.join(HERE, entry["path"])
        with open(path, encoding="utf-8", newline="") as f:
            body = f.read()
        if entry["type"] == "raw":
            parts.append(body)
        else:
            parts.append(entry["open"] + body + CLOSE[entry["type"]])
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-o", "--out", default=os.path.join("dist", "interactive-globe.html"),
                    help="output path (default: dist/interactive-globe.html)")
    ap.add_argument("--check", metavar="FILE",
                    help="also byte-compare the build against FILE and exit non-zero on mismatch")
    args = ap.parse_args()

    html = build()
    out = os.path.join(HERE, args.out) if not os.path.isabs(args.out) else args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    digest = hashlib.sha256(html.encode("utf-8")).hexdigest()
    print("wrote %s  (%.2f MB)" % (out, len(html.encode("utf-8")) / 1e6))
    print("sha256 %s" % digest)

    if args.check:
        with open(args.check, encoding="utf-8", newline="") as f:
            ref = f.read()
        if ref == html:
            print("check: byte-identical to %s" % args.check)
        else:
            print("check: MISMATCH against %s" % args.check)
            sys.exit(1)


if __name__ == "__main__":
    main()
