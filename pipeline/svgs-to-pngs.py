#!/usr/bin/env python3
"""
Batch SVG → PNG renderer for the godot-viz png_icons/ directory.

Usage:
    svgs-to-pngs.py <input.json> <out_dir>

Input is a JSON object mapping node id → SVG string. Outputs <out_dir>/<id>.png
for each entry. Skips empty SVGs. Existing PNGs are overwritten.

Dependencies (Python venv): cairosvg
"""
import sys, os, json, traceback

if len(sys.argv) != 3:
    print("usage: svgs-to-pngs.py <input.json> <out_dir>", file=sys.stderr)
    sys.exit(2)

in_path  = sys.argv[1]
out_dir  = sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

try:
    import cairosvg
except ImportError:
    print("cairosvg not installed (uv pip install cairosvg)", file=sys.stderr)
    sys.exit(2)

with open(in_path) as f:
    svgs = json.load(f)

written = 0
skipped = 0
errors  = 0
for nid, svg in svgs.items():
    if not svg or not isinstance(svg, str) or '<svg' not in svg.lower():
        skipped += 1
        continue
    out = os.path.join(out_dir, f"{nid}.png")
    try:
        # Render at 256x256 — plenty of resolution for a small textured plane.
        cairosvg.svg2png(
            bytestring=svg.encode("utf-8"),
            write_to=out,
            output_width=256,
            output_height=256,
        )
        written += 1
    except Exception as ex:
        errors += 1
        if errors <= 5:
            print(f"  fail {nid}: {type(ex).__name__}: {ex}", file=sys.stderr)

print(f"PNG icons: {written} written, {skipped} skipped, {errors} errors → {out_dir}")
