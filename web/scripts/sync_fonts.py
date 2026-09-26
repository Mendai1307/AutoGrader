#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AutoGrader · MiSans 字体子集提取（开发期工具，非构建必需）
===========================================================================
为什么需要它
---------------------------------------------------------------------------
参考设计（LBEILC/RhineLabUI）的排版骨架由 MiSans 四档字重撑起。上游包
`misans-webfont@4.3.1` 的 tarball 是 **113 MB**（10 字重 × 188 个 unicode-range
分片），直接入库不可接受；实测其中 4 档全量即 24.4 MB。

本脚本按「站点实际会出现的字符集」裁剪分片：只拷必要分片，四档从 24.4 MB
降到约 5.3 MB。产物提交进仓库，使 `web/` 自包含 —— **构建时不需要本脚本、
不需要 misans-webfont、不需要网络**。

字符集口径（三者取并集）
---------------------------------------------------------------------------
  1. GB2312 可编码的全部码位         —— 覆盖任何正常简体中文正文
  2. 站点内容实际字符                 —— 扫描 web/ 源码与数据资产
  3. 常用标点 / 符号区               —— U+2000–206F、U+3000–303F
（注：`—` U+2014 不在 GB2312 内，但落在分片 0 的范围内，故仍被覆盖。）

上游包的两处缺陷（本脚本已在产物中修正）
---------------------------------------------------------------------------
  a. `font-weight` 全部写成 400（仅 bold 是 700），且四个字重的 font-family
     各不相同（"MiSans Light" / "MiSans" / "MiSans Demibold"）。若不修正，
     600 字重只会由 400 字面**合成**，四档形同虚设。
     → 产物统一为 font-family:"MiSans" + 显式 font-weight 300/400/600/700。
  b. `src` 带 `local("MiSans …")`，会让**本机已装字体覆盖固定版本**，导致
     不同机器渲染不一致。
     → 产物剥离 `local()`。

用法
---------------------------------------------------------------------------
  python3 scripts/sync_fonts.py --from <解包后的 misans-webfont 目录>
  python3 scripts/sync_fonts.py --from node_modules/misans-webfont   # 若已安装
  python3 scripts/sync_fonts.py --from <dir> --dry-run               # 只测算不写盘

退出码：0 成功 / 1 产物校验不通过 / 2 入参或源包不可用
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.dirname(HERE)                      # web/
REPO_DIR = os.path.dirname(WEB_DIR)                  # 仓库根
OUT_DIR = os.path.join(WEB_DIR, "public", "fonts")

#: 字重映射：上游目录名 -> 我们声明的 CSS font-weight
WEIGHT_MAP = [
    ("light", 300),
    ("regular", 400),
    ("demibold", 600),
    ("bold", 700),
]

#: 额外纳入的字符区（常用标点与符号），补 GB2312 之外的排版符号
EXTRA_RANGES = [
    (0x2000, 0x206F),   # General Punctuation（含 — U+2014、… U+2026、'' ""）
    (0x3000, 0x303F),   # CJK Symbols and Punctuation（、。「」《》等）
]

#: 扫描站点内容时纳入的文件后缀
CONTENT_EXTS = {".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".md", ".css", ".html"}
#: 扫描时跳过的目录名
SKIP_DIRS = {"node_modules", ".next", "out", ".git", "fonts"}

#: 额外必须覆盖的内容根（工作区其他目录里的数据资产，会被 sync-assets 拷进 web/）
EXTRA_CONTENT_ROOTS = [
    os.path.join(REPO_DIR, "backend", "autograder-expert", "agents", "tools", "assets"),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def fail(msg: str, code: int = 2):
    print("[sync_fonts] 失败：%s" % msg, file=sys.stderr, flush=True)
    sys.exit(code)


# ---------------------------------------------------------------------------
# 字符集
# ---------------------------------------------------------------------------

def gb2312_codepoints() -> set:
    """GB2312 可编码的全部码位。"""
    out = set()
    for cp in range(0x20, 0x10000):
        try:
            chr(cp).encode("gb2312")
            out.add(cp)
        except (UnicodeEncodeError, ValueError):
            pass
    return out


def scan_content_codepoints(roots) -> set:
    """扫描文本文件，收集出现的全部码位。"""
    out = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                if os.path.splitext(name)[1].lower() not in CONTENT_EXTS:
                    continue
                path = os.path.join(dirpath, name)
                try:
                    with open(path, "r", encoding="utf-8") as fh:
                        out.update(ord(c) for c in fh.read())
                except (UnicodeDecodeError, OSError):
                    continue
    return out


# ---------------------------------------------------------------------------
# 解析上游 CSS
# ---------------------------------------------------------------------------

FACE_RE = re.compile(r"@font-face\s*\{([^}]*)\}", re.S)
URL_RE = re.compile(r'url\("\./(\d+)\.woff2"\)')
RANGE_RE = re.compile(r"unicode-range\s*:\s*([^;}]+)")


def parse_range(spec: str) -> set:
    """把 `U+0-1,U+A,U+20-7A` 展开为码位集合。"""
    out = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if part.upper().startswith("U+"):
            part = part[2:]
        if "-" in part:
            lo, hi = part.split("-", 1)
            out.update(range(int(lo, 16), int(hi, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def read_weight_faces(src_dir: str, weight_dir: str):
    """返回 [(shard_index, unicode_range_set)]，按 shard 编号排序。"""
    css_path = os.path.join(src_dir, "misans", "misans-%s" % weight_dir, "result.css")
    if not os.path.isfile(css_path):
        fail("源包缺少 %s" % css_path)
    with open(css_path, "r", encoding="utf-8") as fh:
        css = fh.read()

    faces = []
    for body in FACE_RE.findall(css):
        url = URL_RE.search(body)
        rng = RANGE_RE.search(body)
        if not url or not rng:
            continue
        faces.append((int(url.group(1)), parse_range(rng.group(1))))
    if not faces:
        fail("%s 未解析到任何 @font-face" % css_path)
    faces.sort(key=lambda item: item[0])
    return faces


def needed_shards(faces, charset: set) -> list:
    """挑出与 charset 相交的分片编号。"""
    need = []
    for idx, rng in faces:
        if rng & charset:
            need.append(idx)
    return need


# ---------------------------------------------------------------------------
# 产物
# ---------------------------------------------------------------------------

def build_css(src_dir: str, per_weight: dict) -> str:
    """生成统一的 @font-face 表（单一家族名 + 显式字重 + 无 local()）。"""
    lines = [
        "/* 由 web/scripts/sync_fonts.py 生成，请勿手改。",
        " * 字体：MiSans（小米 / 汉仪），许可见同目录 PROVENANCE.md。",
        " * 上游 misans-webfont 的两处缺陷已在本产物修正：",
        " *   1) font-family 统一为 \"MiSans\"，字重显式声明（上游全写成 400 且家族名各异）；",
        " *   2) 剥离 src 中的 local()，避免本机字体覆盖固定版本。",
        " * 分片按站点字符集裁剪，未覆盖的字符回退到后备字体栈。",
        " */",
        "",
    ]
    for weight_dir, css_weight, shards in per_weight:
        lines.append("/* ---- MiSans weight %d（上游 misans-%s，%d 个分片）---- */"
                     % (css_weight, weight_dir, len(shards)))
        for idx, rng in shards:
            spec = render_range(rng)
            lines.append(
                '@font-face{font-family:"MiSans";src:url("./misans/%d/%d.woff2")'
                'format("woff2");font-style:normal;font-weight:%d;'
                "font-display:swap;unicode-range:%s;}" % (css_weight, idx, css_weight, spec)
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def render_range(rng: set) -> str:
    """把码位集合压缩为 `U+4E00-4E05,U+4E10` 形式。"""
    cps = sorted(rng)
    parts = []
    start = prev = cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        parts.append(range_text(start, prev))
        start = prev = cp
    parts.append(range_text(start, prev))
    return ",".join(parts)


def range_text(lo: int, hi: int) -> str:
    if lo == hi:
        return "U+%X" % lo
    return "U+%X-%X" % (lo, hi)


def aggregate_digest(entries) -> str:
    """对 (相对路径, 文件 sha256) 排序后求聚合摘要。"""
    h = hashlib.sha256()
    for rel, digest in sorted(entries):
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(digest.encode("ascii"))
        h.update(b"\n")
    return "sha256:" + h.hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="从 misans-webfont 提取站点所需的 MiSans 分片")
    ap.add_argument("--from", dest="src", required=True,
                    help="解包后的 misans-webfont 包目录（含 package.json 与 misans/）")
    ap.add_argument("--out", dest="out", default=OUT_DIR, help="产物目录（默认 web/public/fonts）")
    ap.add_argument("--dry-run", action="store_true", help="只测算，不写盘")
    ap.add_argument("--prune", action="store_true", help="删除产物目录中的残留分片（默认只报告）")
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.isdir(os.path.join(src, "misans")):
        fail("源目录下找不到 misans/：%s" % src)
    if not os.path.isfile(os.path.join(src, "package.json")):
        fail("源目录下找不到 package.json：%s" % src)
    with open(os.path.join(src, "package.json"), "r", encoding="utf-8") as fh:
        pkg = json.load(fh)
    pkg_version = str(pkg.get("version", "unknown"))

    # ---- 字符集 ----
    gb = gb2312_codepoints()
    content = scan_content_codepoints([WEB_DIR] + EXTRA_CONTENT_ROOTS)
    punctuation = set()
    for lo, hi in EXTRA_RANGES:
        punctuation.update(range(lo, hi + 1))
    charset = gb | content | punctuation
    log("字符集：GB2312 %d + 站点内容 %d + 标点区 %d  →  并集 %d 个码位"
        % (len(gb), len(content), len(punctuation), len(charset)))

    # ---- 逐字重挑分片 ----
    per_weight = []
    entries = []
    total_bytes = 0
    for weight_dir, css_weight in WEIGHT_MAP:
        faces = read_weight_faces(src, weight_dir)
        need = needed_shards(faces, charset)
        picked = [(idx, rng) for idx, rng in faces if idx in set(need)]
        size = 0
        for idx, _ in picked:
            p = os.path.join(src, "misans", "misans-%s" % weight_dir, "%d.woff2" % idx)
            if not os.path.isfile(p):
                fail("源包缺少分片文件 %s" % p)
            size += os.path.getsize(p)
        total_bytes += size
        per_weight.append((weight_dir, css_weight, picked))
        log("  MiSans %-3d  分片 %3d / %3d   %6.2f MB"
            % (css_weight, len(picked), len(faces), size / 1048576))

    covered = set()
    for _, _, picked in per_weight:
        for _, rng in picked:
            covered |= rng
    uncovered = sorted(charset - covered)
    log("裁剪后四档合计 %.2f MB；字符集未覆盖 %d 个码位"
        % (total_bytes / 1048576, len(uncovered)))
    if uncovered:
        log("  未覆盖示例：%s" % "".join(chr(c) for c in uncovered[:40]))

    # 站点内容字符是否全部覆盖 —— 这直接决定会不会出现豆腐块。
    # 未覆盖的「站点内容」字符需要分别判断：渲染出来的文案必须换掉，
    # 而脚本自身的控制台字符（如 serve.mjs 的 ➜）不影响页面。
    content_uncovered = sorted(content - covered)
    if content_uncovered:
        log("  ⚠ 站点内容中有 %d 个码位未被覆盖（需确认是否为渲染文案）：%s"
            % (len(content_uncovered), "".join(chr(c) for c in content_uncovered)))
    else:
        log("  ✓ 站点内容字符 100% 被覆盖")

    if args.dry_run:
        log("--dry-run：未写盘。")
        return 0

    # ---- 写盘：分片 ----
    #
    # 注意：这里**原地写入**，不用「先建 staging 再整目录 rename」的做法。
    # 原因：Windows 上 os.replace() 对目录会报 WinError 5（拒绝访问），
    # 且整目录替换属于破坏性操作 —— 本项目在 build_expert.py 已经踩过这个坑，
    # 结论是「装配/同步类脚本不应具备破坏性」。残留文件只报告，不自动删除，
    # 要清理须显式传 --prune。
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    expected = set()
    for weight_dir, css_weight, picked in per_weight:
        target = os.path.join(out, "misans", str(css_weight))
        os.makedirs(target, exist_ok=True)
        for idx, _ in picked:
            src_file = os.path.join(src, "misans", "misans-%s" % weight_dir, "%d.woff2" % idx)
            dst_file = os.path.join(target, "%d.woff2" % idx)
            rel = "misans/%d/%d.woff2" % (css_weight, idx)
            expected.add(rel.replace("/", os.sep))
            shutil.copyfile(src_file, dst_file)
            entries.append((rel, sha256_file(dst_file)))

    for name in ("misans.css", "SUBSET.json"):
        expected.add(name)

    digest = aggregate_digest(entries)

    # ---- 写盘：CSS ----
    css = build_css(src, per_weight)
    with open(os.path.join(out, "misans.css"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(css)

    # ---- 写盘：子集清单 ----
    subset = {
        "generatedBy": "web/scripts/sync_fonts.py",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"package": pkg.get("name", "misans-webfont"), "version": pkg_version},
        "family": "MiSans",
        "weights": [
            {
                "cssFontWeight": css_weight,
                "sourceDir": "misans-%s" % weight_dir,
                "shardCount": len(picked),
                "shards": [idx for idx, _ in picked],
            }
            for weight_dir, css_weight, picked in per_weight
        ],
        "charsetBasis": {
            "gb2312Codepoints": len(gb),
            "siteContentCodepoints": len(content),
            "extraRanges": ["U+%04X-%04X" % (lo, hi) for lo, hi in EXTRA_RANGES],
            "unionCodepoints": len(charset),
            "uncoveredCodepoints": len(uncovered),
        },
        "fileCount": len(entries) + 1,
        "totalBytes": total_bytes,
        "aggregateDigest": digest,
        "note": ("分片裁剪口径为「GB2312 ∪ 站点内容 ∪ 常用标点区」。"
                 "落在集合外的生僻字/emoji 会回退到后备字体栈，属预期行为。"
                 "构建期由 scripts/check-fonts.mjs 复核站点内容是否全被覆盖。"),
    }
    with open(os.path.join(out, "SUBSET.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(subset, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # ---- 残留报告（默认不删）----
    stale = []
    font_root = os.path.join(out, "misans")
    if os.path.isdir(font_root):
        for dirpath, _dirnames, filenames in os.walk(font_root):
            for name in filenames:
                rel = os.path.relpath(os.path.join(dirpath, name), out)
                if rel not in expected:
                    stale.append(rel.replace(os.sep, "/"))
    if stale:
        log("  残留 %d 个文件（默认保留）" % len(stale))
        if args.prune:
            for rel in stale:
                os.remove(os.path.join(out, rel.replace("/", os.sep)))
            log("  --prune 已删除 %d 个残留文件" % len(stale))
        else:
            log("  如需清理请重新运行并追加 --prune")

    log("已写出 %s" % out)
    log("  %d 个 woff2 + misans.css + SUBSET.json，聚合摘要 %s" % (len(entries), digest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
