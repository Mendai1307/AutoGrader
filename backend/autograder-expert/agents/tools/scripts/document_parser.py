#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T1 · 文档解析器（document-parser）

把实验报告转成**带坐标的结构对象**，为 T3 的取证与 T5 的证据校验提供可回链锚点。

只建结构与坐标：不判断内容对错、不补全缺失、不改写一个字。

每个块同时给两栏文本（AUDIT P2-17）：
  - `rawText` —— **原文逐字**，未经任何规范化（T3 的逐字比对与 digest 用它）
  - `text`    —— 空白规范化后的版本（供统计与关键词匹配用）
规格承诺「原文逐字」指的是 `rawText`；T3 的「不做任何模糊归一化」因此才成立。

DOCX 标题识别（AUDIT P0-1）。判定顺序：
  1. 段落级 `w:outlineLvl`（0–8 → 1–9 级；**9 表示正文，不算标题**）
  2. 段落样式（`w:pStyle`）经 `word/styles.xml` 解析出的**样式级** `w:outlineLvl`（含 `w:basedOn` 上溯）
  3. 段落样式**名称**匹配 `heading N` / `标题 N` / `標題 N`（样式名可能是数字 styleId，
     真名在 styles.xml；两者都覆盖）
**识别不到任何标题但正文非空时，必须写入 failures 并降级 status**，禁止报 `ok`
——否则下游 T2 会把「未识别」当成「六个章节全缺失」，违反 L1「未知优于否定」。

用法：
  python3 document_parser.py --input <report.docx|.md|.txt|.pdf> [--out <path>]
  python3 document_parser.py --stdin --format md
  python3 document_parser.py --self-test
  （若平台 Bash 无 python3，改用 python，见 tools/README）

退出码：0 全部成功 ｜ 1 部分成功（failures 非空）｜ 2 输入不可读 / 非法

仅标准库；无网络、无 AI；纯函数（同一输入 → 逐位相同输出）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import zlib
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

RE_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
RE_FENCE = re.compile(r"^\s*```")
RE_FIGURE_MD = re.compile(r"!\[[^\]]*\]\([^)]*\)")
RE_FORMULA_MD = re.compile(r"^\s*\$\$")
RE_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
RE_TEST_CASE = re.compile(r"(def\s+test_|@Test|TEST_CASE|assert[\(\s])")

# 段落样式**名称**形式的标题（样式名可能是 `Heading 1` / `heading 1` / `标题 1` / `标题1` / `標題 1`）
RE_DOCX_HEADING_NAME = re.compile(r"^\s*(?:heading|标题|標題)\s*([1-9])\s*$", re.IGNORECASE)

# OOXML：outlineLvl 取值 0–8 为大纲层级，**9 表示正文**（不是标题）
DOCX_OUTLINE_BODY = 9
DOCX_BASED_ON_MAX_HOPS = 4


class InputError(Exception):
    """输入不可读或非法（→ 退出码 2，结构化报错）。"""


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def sha256_bytes(b: bytes) -> str:
    return "sha256:" + hashlib.sha256(b).hexdigest()


def sha256_text(t: str) -> str:
    return sha256_bytes(t.encode("utf-8"))


def clean_text(t: str) -> str:
    """只做空白规范化，不改动任何实质字符。不用于需要逐字的场合（那用 rawText）。"""
    return re.sub(r"[ \t]+", " ", t).strip()


def norm_style_name(name: str) -> str:
    """样式名归一：全角空格与连续空白折叠，便于正则匹配（不改实质字符）。"""
    return re.sub(r"\s+", " ", (name or "").replace("\u3000", " ")).strip()


# --------------------------------------------------------------------------- #
# 结构累积器
# --------------------------------------------------------------------------- #
class Builder:
    def __init__(self) -> None:
        self.blocks: list[dict] = []
        self.failures: list[dict] = []
        self.headings: list[dict] = []
        self._stack: list[tuple[int, str]] = []
        self._section_no = 0
        self._para_no = 0
        self._code_buf: list[str] | None = None
        # 有标题样式但正文为空的段落数：不建节点、不建块（无文字可引用），但计数外露，不静默丢弃
        self.empty_headings = 0

    # -- 章节 ---------------------------------------------------------------
    def add_heading(self, level: int, title: str, raw: str | None = None) -> None:
        if not title:
            self.empty_headings += 1
            return
        self._section_no += 1
        self._para_no = 0
        hid = "s%04d" % self._section_no
        while self._stack and self._stack[-1][0] >= level:
            self._stack.pop()
        parent = self._stack[-1][1] if self._stack else None
        self.headings.append(
            {"id": hid, "title": title, "level": level, "parent": parent, "children": []}
        )
        self._stack.append((level, hid))
        # 标题本身也是一个可被引用的结构块
        self.add_block("heading", title, raw=raw)

    # -- 块 -----------------------------------------------------------------
    def add_block(self, kind: str, text: str, page=None, raw: str | None = None) -> None:
        if not text and not raw:
            return
        self._para_no += 1
        self.blocks.append(
            {
                "blockId": "b%05d" % (len(self.blocks) + 1),
                "kind": kind,
                "anchor": "%d.%d" % (self._section_no, self._para_no),
                "page": page,
                "rawText": text if raw is None else raw,
                "text": text,
            }
        )

    def fail(self, reason: str, anchor=None) -> None:
        self.failures.append({"reason": reason, "anchorIfAny": anchor})

    # -- 代码块（markdown 围栏用）-------------------------------------------
    def open_code(self) -> None:
        self._code_buf = []

    def push_code(self, line: str) -> None:
        if self._code_buf is not None:
            self._code_buf.append(line)

    def close_code(self) -> None:
        if self._code_buf is None:
            return
        raw = "\n".join(self._code_buf)
        body = raw.strip("\n")
        if body.strip():
            self.add_block("code", body, raw=body)
        else:
            self.fail("empty-code-block")
        self._code_buf = None

    # -- 结构树 -------------------------------------------------------------
    def tree(self) -> list[dict]:
        index = {h["id"]: h for h in self.headings}
        roots: list[dict] = []
        for h in self.headings:
            p = h["parent"]
            if p and p in index:
                index[p]["children"].append(_strip(h))
            else:
                roots.append(_strip(h))
        return roots


def _strip(h: dict) -> dict:
    return {
        "id": h["id"],
        "title": h["title"],
        "level": h["level"],
        "children": h["children"],
    }


# --------------------------------------------------------------------------- #
# Markdown / 纯文本
# --------------------------------------------------------------------------- #
def parse_markdown(text: str, b: Builder) -> None:
    for line in text.splitlines():
        if RE_FENCE.match(line):
            if b._code_buf is None:
                b.open_code()
            else:
                b.close_code()
            continue
        if b._code_buf is not None:
            b.push_code(line)
            continue

        m = RE_HEADING.match(line)
        if m:
            b.add_heading(len(m.group(1)), clean_text(m.group(2)), raw=m.group(2))
            continue
        if RE_FORMULA_MD.match(line) or line.strip().startswith("\\begin{equation}"):
            b.add_block("formula", clean_text(line), raw=line)
            continue
        if RE_FIGURE_MD.search(line):
            b.add_block("figure", clean_text(line), raw=line)
            continue
        if RE_TABLE_ROW.match(line):
            b.add_block("table", clean_text(line), raw=line)
            continue
        t = clean_text(line)
        if t:
            b.add_block("text", t, raw=line)
    b.close_code()


def parse_plain(text: str, b: Builder) -> None:
    for line in text.splitlines():
        t = clean_text(line)
        if t:
            b.add_block("text", t, raw=line)


# --------------------------------------------------------------------------- #
# DOCX
# --------------------------------------------------------------------------- #
def load_docx_styles(z: zipfile.ZipFile) -> tuple[dict, dict, dict]:
    """返回 (styleId→样式名, styleId→样式级 outlineLvl, styleId→basedOn)。

    读不到 styles.xml / 解析失败时返回空表——此时退化为「按样式名或段落级 outlineLvl 判定」。
    """
    names: dict[str, str] = {}
    outline: dict[str, int] = {}
    based_on: dict[str, str] = {}
    try:
        raw = z.read("word/styles.xml")
    except KeyError:
        return names, outline, based_on
    try:
        root = ET.fromstring(raw)
    except Exception:  # noqa: BLE001
        return names, outline, based_on

    for st in root.findall(W + "style"):
        sid = st.get(W + "styleId")
        if not sid:
            continue
        nm = st.find(W + "name")
        if nm is not None:
            names[sid] = (nm.get(W + "val") or "").strip()
        bo = st.find(W + "basedOn")
        if bo is not None and bo.get(W + "val"):
            based_on[sid] = bo.get(W + "val").strip()
        ppr = st.find(W + "pPr")
        if ppr is not None:
            ol = ppr.find(W + "outlineLvl")
            if ol is not None:
                v = (ol.get(W + "val") or "").strip()
                if v.isdigit():
                    outline[sid] = int(v)
    return names, outline, based_on


def _style_outline_level(style_id: str, outline: dict, based_on: dict) -> int | None:
    """样式级 outlineLvl，沿 `w:basedOn` 上溯（有界）。"""
    cur = style_id
    for _ in range(DOCX_BASED_ON_MAX_HOPS):
        if not cur:
            return None
        if cur in outline:
            return outline[cur]
        cur = based_on.get(cur, "")
    return None


def docx_heading_level(
    style_id: str,
    para_outline: int | None,
    names: dict,
    outline: dict,
    based_on: dict,
) -> int | None:
    """判定该段落的标题级别；不是标题则返回 None。

    顺序：段落级 outlineLvl → 样式级 outlineLvl → 样式名匹配。
    `outlineLvl == 9` 表示正文，**不算标题**（直接返回 None，不再退化到样式名判定）。
    """
    lvl = para_outline
    if lvl is None:
        lvl = _style_outline_level(style_id, outline, based_on)
    if lvl is not None:
        return None if lvl >= DOCX_OUTLINE_BODY else lvl + 1

    # 样式名（无 styles.xml 时退化为直接拿 pStyle 的 val 当名字试一次）
    name = norm_style_name(names.get(style_id) or style_id)
    m = RE_DOCX_HEADING_NAME.match(name)
    if m:
        return int(m.group(1))
    return None


def _docx_para(el, b: Builder, names: dict, outline: dict, based_on: dict) -> None:
    texts: list[str] = []
    has_drawing = False
    for node in el.iter():
        if node.tag == W + "t":
            texts.append(node.text or "")
        elif node.tag == W + "drawing":
            has_drawing = True
        elif node.tag == W + "tab":
            texts.append("\t")
        elif node.tag == W + "br":
            texts.append("\n")

    style = ""
    para_outline: int | None = None
    ppr = el.find(W + "pPr")
    if ppr is not None:
        st = ppr.find(W + "pStyle")
        if st is not None:
            style = (st.get(W + "val") or "").strip()
        ol = ppr.find(W + "outlineLvl")
        if ol is not None:
            v = (ol.get(W + "val") or "").strip()
            if v.isdigit():
                para_outline = int(v)

    raw = "".join(texts)
    t = clean_text(raw)

    level = docx_heading_level(style, para_outline, names, outline, based_on)
    if level is not None:
        b.add_heading(level, t or raw.strip(), raw=raw)
        return

    if "Code" in style or "代码" in style:
        b.add_block("code", raw.rstrip(), raw=raw.rstrip())
        return

    if t:
        b.add_block("text", t, raw=raw)
    if has_drawing:
        b.add_block("figure", "[图片]", raw="[图片]")


def parse_docx(path: str, b: Builder) -> None:
    try:
        with zipfile.ZipFile(path) as z:
            names, outline, based_on = load_docx_styles(z)
            xml = z.read("word/document.xml")
    except Exception as exc:  # noqa: BLE001
        b.fail("docx-unreadable: %s" % exc)
        return
    try:
        root = ET.fromstring(xml)
    except Exception as exc:  # noqa: BLE001
        b.fail("docx-xml-parse-failed: %s" % exc)
        return

    body = root.find(W + "body")
    if body is None:
        b.fail("docx-no-body")
        return

    for child in body:
        if child.tag == W + "p":
            _docx_para(child, b, names, outline, based_on)
        elif child.tag == W + "tbl":
            for tr in child.findall(W + "tr"):
                cells = []
                for tc in tr.findall(W + "tc"):
                    txt = " ".join(
                        clean_text("".join(n.text or "" for n in p.iter() if n.tag == W + "t"))
                        for p in tc.findall(W + "p")
                    )
                    cells.append(txt)
                row = " | ".join(cells).strip()
                if row.strip("| "):
                    b.add_block("table", row, raw=row)


# --------------------------------------------------------------------------- #
# PDF（保守的文字层抽取）
# --------------------------------------------------------------------------- #
def parse_pdf(path: str, b: Builder) -> None:
    with open(path, "rb") as f:
        data = f.read()

    chunks: list[str] = []
    for m in re.finditer(rb"stream\r?\n", data):
        start = m.end()
        end = data.find(b"endstream", start)
        if end < 0:
            continue
        raw = data[start:end]
        try:
            dec = zlib.decompress(raw)
        except Exception:  # noqa: BLE001
            continue
        # Tj（单串）与 TJ（数组）两种文本算子都要抽，否则现代 PDF 基本抽不到（AUDIT P3-32）
        for tm in re.finditer(rb"\((?:\\.|[^()\\])*\)\s*Tj", dec):
            lit = tm.group(0)[: tm.group(0).rfind(b")")]
            chunks.append(_pdf_unescape(lit[1:]))
        for tm in re.finditer(rb"\[((?:\\.|[^\]\\])*)\]\s*TJ", dec):
            body = tm.group(1)
            for sm in re.finditer(rb"\((?:\\.|[^()\\])*\)", body):
                chunks.append(_pdf_unescape(sm.group(0)[1:-1]))

    if not chunks:
        b.fail("pdf-no-text-layer: 未能抽到任何文字层内容（可能为扫描件），按未解析处理")
        return

    b.fail(
        "pdf-basic-extraction: PDF 采用保守文字层抽取，"
        "不保证段落顺序与完整度；引用前须人工或下游复核"
    )
    for line in "".join(chunks).splitlines():
        t = clean_text(line)
        if t:
            b.add_block("text", t, raw=line)


def _pdf_unescape(lit: bytes) -> str:
    out = bytearray()
    i = 0
    while i < len(lit):
        c = lit[i]
        if c == 0x5C and i + 1 < len(lit):
            nxt = lit[i + 1]
            mapping = {0x6E: 10, 0x72: 13, 0x74: 9, 0x28: 40, 0x29: 41, 0x5C: 92}
            if nxt in mapping:
                out.append(mapping[nxt])
                i += 2
                continue
            if 0x30 <= nxt <= 0x37:
                j = i + 1
                oct_digits = b""
                while j < len(lit) and len(oct_digits) < 3 and 0x30 <= lit[j] <= 0x37:
                    oct_digits += bytes([lit[j]])
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
                continue
        out.append(c)
        i += 1
    return out.decode("utf-8", errors="replace")


# --------------------------------------------------------------------------- #
# 统计（供下游 T2 复算）
# --------------------------------------------------------------------------- #
def summarize(blocks: list[dict]) -> dict:
    text_chars = sum(len(x["text"]) for x in blocks if x["kind"] in ("text", "heading"))
    code_lines = sum(x["text"].count("\n") + 1 for x in blocks if x["kind"] == "code")
    fig = sum(1 for x in blocks if x["kind"] == "figure")
    tbl = sum(1 for x in blocks if x["kind"] == "table")
    return {
        "blockCount": len(blocks),
        "textChars": text_chars,
        "codeBlocks": sum(1 for x in blocks if x["kind"] == "code"),
        "codeLines": code_lines,
        "figures": fig,
        "tables": tbl,
        "testCases": sum(
            1 for x in blocks if x["kind"] == "code" and RE_TEST_CASE.search(x["text"])
        ),
        "headings": sum(1 for x in blocks if x["kind"] == "heading"),
    }


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
SUPPORTED_EXTS = ("docx", "md", "markdown", "txt", "text", "pdf")


def run(path: str | None, text: str | None, fmt: str | None) -> tuple[dict, int]:
    b = Builder()
    name = "<stdin>" if path is None else path

    if path is None:
        fmt = (fmt or "txt").lower()
        if fmt in ("md", "markdown"):
            parse_markdown(text or "", b)
        else:
            parse_plain(text or "", b)
        digest = sha256_text(text or "")
    else:
        if not os.path.isfile(path):
            raise InputError("输入文件不存在或不可读：%s" % path)
        ext = (fmt or (path.rsplit(".", 1)[-1] if "." in path else "")).lower()
        if ext == "docx":
            parse_docx(path, b)
        elif ext in ("md", "markdown"):
            parse_markdown(_read_text(path), b)
        elif ext in ("txt", "text", ""):
            parse_plain(_read_text(path), b)
        elif ext == "pdf":
            try:
                parse_pdf(path, b)
            except OSError as exc:
                raise InputError("PDF 不可读：%s" % exc) from exc
        else:
            b.fail("unsupported-format: %s（支持 %s）" % (ext, " / ".join(SUPPORTED_EXTS)))
        try:
            with open(path, "rb") as f:
                digest = sha256_bytes(f.read())
        except OSError as exc:
            raise InputError("文件不可读：%s" % exc) from exc

    # 静默失败闸门：有正文但一个标题都没识别出来 → 必须显式记录并降级 status
    if not b.headings and any(x["kind"] in ("text", "code", "table") for x in b.blocks):
        b.fail(
            "structure-not-recognized: 未识别到任何标题，章节存在性**无法判定**"
            "（按未知处理，禁止当成「缺失」）"
        )

    n_fail = len(b.failures)
    if not b.blocks and n_fail:
        status = "failed"
        code = 2
    elif n_fail:
        status = "partial"
        code = 1
    else:
        status = "ok"
        code = 0

    report = {
        "tool": "T1",
        "status": status,
        "sourceFile": {"path": name, "digest": digest},
        "structure": b.tree(),
        "blocks": b.blocks,
        "failures": b.failures,
        "summary": summarize(b.blocks),
        # 有标题样式但无文字的段落数（既不入树也不入块，但计数外露，便于人工核查）
        "emptyHeadingParagraphs": b.empty_headings,
    }
    return report, code


def _read_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError as exc:
        raise InputError("文件不可读：%s" % exc) from exc


# --------------------------------------------------------------------------- #
# 自测
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    checks = {}

    md = "# 一、实验原理\n原理说明。\n\n```c\nint main(){return 0;}\n```\n\n## 二、结果\n| a | b |\n"
    rep, code = run(None, md, "md")
    checks["markdownHeadings"] = (
        code == 0
        and rep["status"] == "ok"
        and rep["summary"]["codeBlocks"] == 1
        and rep["summary"]["textChars"] > 0
        and len(rep["structure"]) == 1
        and rep["structure"][0]["children"][0]["title"] == "二、结果"
    )

    # rawText 逐字：行首缩进与制表符必须原样保留（AUDIT P2-17）
    raw_src = "    缩进四个空格\t制表符\n正文\n"
    rep_raw, _ = run(None, raw_src, "txt")
    blocks_by_raw = {b["rawText"]: b for b in rep_raw["blocks"]}
    checks["rawTextIsVerbatim"] = (
        "    缩进四个空格\t制表符" in blocks_by_raw
        and blocks_by_raw["    缩进四个空格\t制表符"]["text"] == "缩进四个空格 制表符"
    )

    # DOCX 标题判定三分支（用真实 styles.xml 形状离线构造）
    names = {"1": "heading 1", "2": "heading 2", "3": "heading 3",
             "a8": "Title", "a": "List Bullet", "TOC1": "TOC 标题1"}
    outline = {"1": 0, "2": 1, "3": 2, "TOC1": 9}
    based_on = {"1": "a0", "2": "a0", "3": "a0"}
    checks["docxStyleNameToLevel"] = (
        docx_heading_level("1", None, names, outline, based_on) == 1
        and docx_heading_level("2", None, names, outline, based_on) == 2
        and docx_heading_level("3", None, names, outline, based_on) == 3
    )
    checks["docxOutlineLvlWins"] = (
        docx_heading_level("a", 0, names, outline, based_on) == 1
        and docx_heading_level("a", 1, names, outline, based_on) == 2
    )
    checks["docxOutline9IsBody"] = (
        docx_heading_level("a", 9, names, outline, based_on) is None
        and docx_heading_level("TOC1", None, names, outline, based_on) is None
    )
    checks["docxTitleAndBulletAreNotHeadings"] = (
        docx_heading_level("a8", None, names, outline, based_on) is None
        and docx_heading_level("a", None, names, outline, based_on) is None
    )
    # 无 styles.xml：pStyle 直接是名字时仍可识别；是数字 id 时不得误判
    checks["docxStyleNameDirect"] = (
        docx_heading_level("Heading2", None, {}, {}, {}) == 2
        and docx_heading_level("标题 3", None, {}, {}, {}) == 3
        and docx_heading_level("9", None, {}, {}, {}) is None
    )

    # 静默失败闸门：有正文但无标题 → 必须 failures 非空、status 非 ok
    rep_flat, code_flat = run(None, "只有正文没有标题\n第二行\n", "txt")
    checks["structureNotRecognizedIsFlagged"] = (
        code_flat == 1
        and rep_flat["status"] == "partial"
        and any("structure-not-recognized" in f["reason"] for f in rep_flat["failures"])
    )

    # 空输入：无正文也无标题 → 不报 structure-not-recognized（无正文可判）
    rep_empty, code_empty = run(None, "", "txt")
    checks["emptyInputNotFlagged"] = (
        code_empty == 0 and not rep_empty["failures"] and rep_empty["blocks"] == []
    )

    # 空标题段落：不入树、不入块，但计数外露（避免树与 summary.headings 计数不一致）
    bb = Builder()
    bb.add_heading(1, "", raw="")
    bb.add_heading(1, "真标题", raw="真标题")
    bb.add_block("text", "正文", raw="正文")
    rep_empty_h = {
        "structure": bb.tree(),
        "summary": summarize(bb.blocks),
        "emptyHeadingParagraphs": bb.empty_headings,
    }
    checks["emptyHeadingSkippedButCounted"] = (
        len(rep_empty_h["structure"]) == 1
        and rep_empty_h["emptyHeadingParagraphs"] == 1
        and rep_empty_h["summary"]["headings"] == 1
        and len(rep_empty_h["structure"]) == rep_empty_h["summary"]["headings"]
    )

    # 入参形状防御：文件不存在 → InputError（→ 退出码 2），不得裸 traceback
    try:
        run("E:/__no_such_file__.md", None, None)
        checks["missingFileRaisesInputError"] = False
    except InputError:
        checks["missingFileRaisesInputError"] = True

    print(json.dumps({"tool": "T1", "checks": checks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T1 文档解析器（document-parser）")
    ap.add_argument("--input")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--format")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    try:
        if args.stdin:
            rep, code = run(None, sys.stdin.read(), args.format)
        elif args.input:
            rep, code = run(args.input, None, args.format)
        else:
            print(json.dumps({"tool": "T1", "error": "need --input or --stdin"},
                             ensure_ascii=False))
            return 2
    except InputError as exc:
        print(json.dumps({"tool": "T1", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "T1", "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    payload = json.dumps(rep, ensure_ascii=False, indent=2, sort_keys=True)
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "T1", "error": "写输出失败：%s" % exc,
                              "kind": "output-error"}, ensure_ascii=False))
            return 2
    else:
        print(payload)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
