#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 docx 转成 markdown（复用 T1 的解析结果，保证与工具链同一套结构判定）。

用法：python docx2md.py <in.docx> <out.md>
只读 in.docx。
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts"))

import document_parser as T1  # noqa: E402


def to_md(rep: dict) -> str:
    levels: dict[str, int] = {}

    def walk(nodes):
        for n in nodes:
            levels.setdefault(n["title"], n["level"])
            walk(n["children"])

    walk(rep["structure"])

    lines: list[str] = []
    in_table = False
    for blk in rep["blocks"]:
        kind = blk["kind"]
        text = blk["text"]
        if kind == "heading":
            lines.append("")
            lines.append("#" * max(1, min(6, levels.get(text, 1))) + " " + text)
            in_table = False
        elif kind == "table":
            cells = [c.strip() for c in text.split("|")]
            if not in_table:
                lines.append("")
                lines.append("| " + " | ".join(cells) + " |")
                lines.append("|" + "---|" * len(cells))
                in_table = True
            else:
                lines.append("| " + " | ".join(cells) + " |")
        else:
            in_table = False
            lines.append("")
            if kind == "code":
                lines.append("```")
                lines.append(text)
                lines.append("```")
            elif kind == "figure":
                lines.append("[图片]")
            else:
                lines.append(text)
    md = "\n".join(lines)
    while "\n\n\n" in md:
        md = md.replace("\n\n\n", "\n\n")
    return md.strip() + "\n"


def main(argv: list[str]) -> int:
    src, dst = argv[0], argv[1]
    rep, code = T1.run(src, None, None)
    if code == 2:
        print(json.dumps({"error": "T1 解析失败", "status": rep["status"],
                          "failures": rep["failures"]}, ensure_ascii=False))
        return 2
    md = to_md(rep)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(md)
    print(json.dumps({
        "src": os.path.basename(src), "dst": dst,
        "t1Status": rep["status"], "blocks": len(rep["blocks"]),
        "headings": rep["summary"]["headings"], "mdLines": md.count("\n"),
        "emptyHeadingParagraphs": rep.get("emptyHeadingParagraphs", 0),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
