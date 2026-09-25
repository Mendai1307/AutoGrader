#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读探测 docx 的标题标记方式：w:pStyle / w:outlineLvl / styles.xml 映射。

用法：python probe_docx.py <a.docx> [b.docx ...]
不写任何文件。
"""
from __future__ import annotations

import collections
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def probe(path: str) -> None:
    print("=" * 78)
    print(path)
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            xml = z.read("word/document.xml")
            styles_xml = z.read("word/styles.xml") if "word/styles.xml" in names else None
    except Exception as exc:  # noqa: BLE001
        print("  读取失败：", exc)
        return

    root = ET.fromstring(xml)
    body = root.find(W + "body")
    paras = [p for p in body.iter(W + "p")] if body is not None else []
    print("  段落总数 =", len(paras))

    style_vals: collections.Counter = collections.Counter()
    outline_vals: collections.Counter = collections.Counter()
    no_style = 0
    for p in paras:
        ppr = p.find(W + "pPr")
        st = None
        ol = None
        if ppr is not None:
            st_el = ppr.find(W + "pStyle")
            if st_el is not None:
                st = (st_el.get(W + "val") or "").strip()
            ol_el = ppr.find(W + "outlineLvl")
            if ol_el is not None:
                ol = (ol_el.get(W + "val") or "").strip()
        if st is None:
            no_style += 1
        else:
            style_vals[st] += 1
        if ol is not None:
            outline_vals[ol] += 1

    print("  无 w:pStyle 的段落 =", no_style)
    print("  w:pStyle 取值分布（前 12）= ", style_vals.most_common(12))
    print("  w:outlineLvl 取值分布 =", dict(outline_vals))

    # styles.xml 映射
    id2name: dict[str, str] = {}
    if styles_xml is None:
        print("  ⚠ 无 word/styles.xml")
    else:
        sroot = ET.fromstring(styles_xml)
        for st in sroot.findall(W + "style"):
            sid = st.get(W + "styleId")
            nm = st.find(W + "name")
            nm_val = (nm.get(W + "val") if nm is not None else None)
            if sid:
                id2name[sid] = nm_val or ""
        print("  styles.xml 样式数 =", len(id2name))
        for sid in list(style_vals)[:12]:
            print("    styleId %-10r -> name %r" % (sid, id2name.get(sid, "<未找到>")))

    # 标题样例：outlineLvl 0/1 的段落文本 + pStyle 映射后含 heading 的段落
    print("  --- outlineLvl 0/1 段落样例（前 6）---")
    n = 0
    for p in paras:
        ppr = p.find(W + "pPr")
        if ppr is None:
            continue
        ol = ppr.find(W + "outlineLvl")
        if ol is None or (ol.get(W + "val") or "") not in ("0", "1"):
            continue
        txt = "".join(t.text or "" for t in p.iter(W + "t")).strip()
        if txt:
            print("    lvl=%s  %r" % (ol.get(W + "val"), txt[:60]))
            n += 1
            if n >= 6:
                break

    print("  --- pStyle 经 styles.xml 映射后命中 heading 的段落样例（前 6）---")
    n = 0
    for p in paras:
        ppr = p.find(W + "pPr")
        if ppr is None:
            continue
        st_el = ppr.find(W + "pStyle")
        if st_el is None:
            continue
        sid = (st_el.get(W + "val") or "").strip()
        nm = (id2name.get(sid) or "").strip()
        if nm.lower().startswith("heading"):
            txt = "".join(t.text or "" for t in p.iter(W + "t")).strip()
            if txt:
                print("    sid=%s name=%r -> %r" % (sid, nm, txt[:60]))
                n += 1
                if n >= 6:
                    break
    print()


if __name__ == "__main__":
    for a in sys.argv[1:]:
        probe(a)
