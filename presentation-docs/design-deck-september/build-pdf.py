#!/usr/bin/env python3
"""Render the .dc.html artboards into one print-ready HTML, in canvas.json order.

Each artboard's <helmet> CSS is scoped to its own slide container so the
per-slide table/chart rules (.ax, .vl, td, ...) cannot collide across slides.
"""
import json, re, sys, pathlib

here = pathlib.Path(__file__).parent
order = [a["file"] for a in json.loads((here / "canvas.json").read_text())["artboards"]]

HELMET = re.compile(r"<helmet>\s*<style>(.*?)</style>\s*</helmet>", re.S)
BODY = re.compile(r"</helmet>(.*?)</x-dc>", re.S)


def scope_css(css: str, sel: str) -> str:
    """Prefix every rule's selector list with `sel`; `body` becomes `sel` itself."""
    out = []
    for block in css.split("}"):
        if "{" not in block:
            continue
        raw_sel, body = block.split("{", 1)
        parts = []
        for one in raw_sel.split(","):
            one = one.strip()
            if not one:
                continue
            parts.append(sel if one == "body" else f"{sel} {one}")
        if parts:
            out.append("%s{%s}" % (", ".join(parts), body.strip()))
    return "\n".join(out)


slides, styles = [], []
for i, name in enumerate(order):
    src = (here / name).read_text()
    m_css, m_body = HELMET.search(src), BODY.search(src)
    if not m_body:
        sys.exit(f"no <x-dc> body found in {name}")
    sid = f"s{i}"
    if m_css:
        styles.append(scope_css(m_css.group(1), f"#{sid}"))
    slides.append(f'<div class="slide" id="{sid}">{m_body.group(1).strip()}</div>')

html = f"""<!doctype html>
<html><head><meta charset="utf-8">
<title>SayaKaya August Review</title>
<style>
  @page {{ size: 1280px 720px; margin: 0; }}
  html, body {{ margin: 0; padding: 0; background: #ffffff; }}
  .slide {{
    width: 1280px; height: 720px; overflow: hidden;
    page-break-after: always; break-after: page; position: relative;
  }}
  .slide:last-child {{ page-break-after: auto; break-after: auto; }}
  * {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
{chr(10).join(styles)}
</style></head>
<body>
{chr(10).join(slides)}
</body></html>
"""
out = here / "deck-print.html"
out.write_text(html)
print(f"wrote {out} — {len(slides)} slides")
