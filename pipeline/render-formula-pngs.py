"""Render extracted LaTeX formulas to PNG cards for overlay use.

Reads data/<stem>_formulas.json and produces <out_dir>/formulas/formula_<id>.png.
Falls back to text labels if a formula's LaTeX can't be rendered by mathtext.

Usage:
  python tools/render-formula-pngs.py <formulas.json> <out_dir>
"""
import json
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def sanitize_latex_for_mathtext(latex: str) -> str:
    """matplotlib's mathtext supports a subset of LaTeX. Strip the most common
    unsupported macros so we can render simple equations."""
    s = latex
    # common \text{...} and \operatorname{...} → just the content
    s = re.sub(r"\\text\{([^{}]*)\}", r"\\mathrm{\1}", s)
    s = re.sub(r"\\operatorname\{([^{}]*)\}", r"\\mathrm{\1}", s)
    # \Big, \Bigg, \big, \bigg sizing commands — drop them (mathtext auto-sizes)
    s = re.sub(r"\\[Bb]igg?[lr]?", "", s)
    # \left and \right size modifiers — drop them; mathtext handles bare delimiters
    s = re.sub(r"\\left([\(\[\{])", r"\1", s)
    s = re.sub(r"\\right([\)\]\}])", r"\1", s)
    # LLM-hallucinated double close brace: \sqrt{x}} → \sqrt{x}
    s = re.sub(r"\}\}(?=[^{]*$|\\)", "}", s)
    # Collapse doubled close braces that outnumber open ones in simple cases.
    while s.count("{") < s.count("}"):
        # Drop the first extraneous closing brace
        s = re.sub(r"\}", "", s, count=1)
    # \mathbb{R} etc — mathtext has \mathbb
    return s


def render_formula(latex: str, out_path: Path, dpi: int = 180):
    fig = plt.figure(figsize=(7.5, 2.4), dpi=dpi)
    ax = fig.add_subplot(111)
    ax.axis("off")
    text = f"${sanitize_latex_for_mathtext(latex)}$"
    try:
        ax.text(
            0.5, 0.5, text,
            ha="center", va="center",
            fontsize=22,
            color="#0a0a0a",
        )
    except Exception:
        ax.text(
            0.5, 0.5, latex,
            ha="center", va="center",
            fontsize=14,
            color="#333",
            family="monospace",
        )
    fig.patch.set_facecolor("#fafafa")
    fig.savefig(out_path, bbox_inches="tight", facecolor="#fafafa", dpi=dpi)
    plt.close(fig)


def main():
    if len(sys.argv) < 3:
        print("usage: render-formula-pngs.py <formulas.json> <out_dir>", file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) / "formulas"
    out_dir.mkdir(parents=True, exist_ok=True)

    data = json.loads(src.read_text())
    formulas = data.get("formulas", [])
    rendered = []
    for f in formulas:
        fid = f.get("id") or f.get("name", "").lower().replace(" ", "_")
        if not fid:
            continue
        latex = f.get("latex", "").strip()
        if not latex:
            continue
        out_path = out_dir / f"formula_{fid}.png"
        try:
            render_formula(latex, out_path)
        except Exception as e:
            print(f"  skip {fid}: {e}", file=sys.stderr)
            continue
        rendered.append({
            "id": f"formula_{fid}",
            "kind": "formula",
            "caption": f.get("name", fid),
            "latex": latex,
            "png": f"formulas/formula_{fid}.png",
        })

    manifest_path = out_dir.parent / "formula_assets.json"
    manifest_path.write_text(json.dumps({"assets": rendered}, indent=2))
    print(f"Rendered {len(rendered)} formulas → {manifest_path}")


if __name__ == "__main__":
    main()
