"""md -> docx for analysis/outputs. Usage: python3 md2docx.py file.md [out.docx]
Handles headings, paragraphs, bullets, pipe tables. Inline **bold** and `code` markers are stripped.
"""
import re
import sys

from docx import Document


def clean(s):
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`(.+?)`", r"\1", s)
    s = re.sub(r"\[(.+?)\]\((.+?)\)", r"\1", s)
    return s.replace("→", "->").strip()


def convert(src, dst):
    doc = Document()
    lines = open(src).read().splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("|") and i + 1 < len(lines) and set(lines[i + 1].replace("|", "").strip()) <= set("-: "):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if not set(lines[i].replace("|", "").strip()) <= set("-: "):
                    rows.append([clean(c) for c in lines[i].strip().strip("|").split("|")])
                i += 1
            width = max(len(r) for r in rows)
            table = doc.add_table(rows=0, cols=width)
            table.style = "Table Grid"
            for r in rows:
                cells = table.add_row().cells
                for n, val in enumerate(r[:width]):
                    cells[n].text = val[:1000]
            doc.add_paragraph()
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            doc.add_heading(clean(m.group(2)), level=min(len(m.group(1)), 4))
        elif re.match(r"^\s*[-*]\s+", ln):
            doc.add_paragraph(clean(re.sub(r"^\s*[-*]\s+", "", ln)), style="List Bullet")
        elif re.match(r"^\s*\d+\.\s+", ln):
            doc.add_paragraph(clean(re.sub(r"^\s*\d+\.\s+", "", ln)), style="List Number")
        elif ln.strip():
            doc.add_paragraph(clean(ln))
        i += 1
    doc.save(dst)


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1].rsplit(".", 1)[0] + ".docx")
    print("ok", sys.argv[1])
