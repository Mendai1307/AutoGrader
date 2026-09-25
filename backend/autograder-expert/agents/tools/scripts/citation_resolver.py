#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T3 · 引用解析器（citation-resolver）

把 Expert 给出的候选引用按坐标**还原为逐字原文**，并判定引用是否忠实。

S3 的铁律是「证据不得改写、不得拼接、不得用类似表述冒充引用」。
本工具把这条纪律从 Prompt 里的自觉，变成**可执行的闸门**。

逐字比对的对象是 T1 产出的 **`rawText`**（未经任何空白规范化），
不是 `text`（已规范化）。否则「逐字」这条承诺在 T1 就已经被破坏。

三条诚实性约束（AUDIT 修复）：
  - **入参形状防御**：候选顶层键必须是 `items` 数组；形状不符 → 退出码 2，
    **绝不静默返回空集**（静默返回 `summary.total=0` + 退出码 0 =「全部有效」会让闸门完全失效）
  - **歧义必须报出**：只给 `quote` 且命中多个块时，取 blockId 最小者作为确定解，
    但必须在结果里标 `ambiguousHit` 与 `hitBlockIds`，并计为「需注意」
  - **摘要必须覆盖引文本身**：`quoteDigest` = 落进 `evidence[].quote` 的那段文本的摘要，
    `blockTextDigest` = 整块摘要，两者都给，避免「摘要无法证明引文」

用法：
  python3 citation_resolver.py --report <report.json> --candidates <candidates.json>
  python3 citation_resolver.py --self-test

退出码：0 全部有效 ｜ 1 存在无效项或歧义命中 ｜ 2 输入不可读或形状非法

仅标准库；无网络、无 AI；纯函数。逐字比对**不做任何模糊归一化**。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys


class InputError(Exception):
    """输入不可读或形状非法（→ 退出码 2，结构化报错）。"""


def load(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except OSError as exc:
        raise InputError("文件不可读：%s（%s）" % (path, exc)) from exc
    except json.JSONDecodeError as exc:
        raise InputError("JSON 非法：%s（%s）" % (path, exc)) from exc


def require_report(doc) -> dict:
    if not isinstance(doc, dict):
        raise InputError("--report 顶层必须是对象，实际为 %s；期望 T1 产出的报告对象"
                         % type(doc).__name__)
    blocks = doc.get("blocks")
    if not isinstance(blocks, list):
        raise InputError("--report 的 'blocks' 必须是数组，实际为 %s"
                         % ("缺失" if blocks is None else type(blocks).__name__))
    return doc


def require_candidates(doc) -> list:
    """顶层键必须是 `items` 数组——形状不符一律报错，禁止静默放过。"""
    if not isinstance(doc, dict):
        raise InputError(
            "--candidates 顶层必须是对象，实际为 %s；期望形如 {\"items\": [ … ]}"
            % type(doc).__name__)
    items = doc.get("items")
    if items is None:
        raise InputError(
            "--candidates 缺少顶层键 'items'；实际顶层键为 %s"
            % (sorted(doc.keys()) or "（无）"))
    if not isinstance(items, list):
        raise InputError("--candidates 的 'items' 必须是数组，实际为 %s" % type(items).__name__)
    for i, c in enumerate(items):
        if not isinstance(c, dict):
            raise InputError("items[%d] 不是对象" % i)
    return items


def block_text(block: dict) -> str:
    """逐字文本：优先 `rawText`（T1 新增），回退 `text` 以兼容旧报告。"""
    raw = block.get("rawText")
    return raw if isinstance(raw, str) else (block.get("text") or "")


def build_index(report: dict) -> tuple[dict, dict]:
    by_anchor: dict[str, dict] = {}
    by_id: dict[str, dict] = {}
    for b in report.get("blocks") or []:
        if not isinstance(b, dict):
            continue
        by_anchor.setdefault(str(b.get("anchor")), b)
        by_id[str(b.get("blockId"))] = b
    return by_anchor, by_id


def resolve_one(c: dict, by_anchor: dict, by_id: dict) -> tuple[dict | None, dict | None]:
    point_id = c.get("pointId")
    anchor = c.get("anchor")
    block_id = c.get("blockId")
    quote = c.get("quote")

    if anchor is None and block_id is None and quote is None:
        return None, {"pointId": point_id, "reason": "no-locator"}

    block = None
    if anchor is not None:
        block = by_anchor.get(str(anchor))
        if block is None:
            return None, {"pointId": point_id, "reason": "anchor-not-found", "anchor": anchor}
    elif block_id is not None:
        block = by_id.get(str(block_id))
        if block is None:
            return None, {"pointId": point_id, "reason": "block-ref-not-found",
                          "blockId": block_id}

    ambiguous = False
    hit_ids: list[str] = []
    if block is None:
        # 仅给了 quote：在全部块里找逐字命中的位置
        hits = [
            b for b in by_id.values()
            if quote and quote in block_text(b)
        ]
        hits.sort(key=lambda x: str(x.get("blockId")))
        if not hits:
            return None, {"pointId": point_id, "reason": "quote-mismatch"}
        block = hits[0]
        ambiguous = len(hits) > 1
        hit_ids = [str(b.get("blockId")) for b in hits]

    text = block_text(block)
    if quote is not None and quote not in text:
        return None, {
            "pointId": point_id,
            "reason": "quote-mismatch",
            "anchor": block.get("anchor"),
            "blockId": block.get("blockId"),
        }

    exact = text if quote is None else quote
    resolved = {
        "pointId": point_id,
        "valid": True,
        "anchor": block.get("anchor"),
        "blockId": block.get("blockId"),
        "kind": block.get("kind"),
        "exactText": exact,
        # quoteDigest 覆盖落进 evidence[].quote 的那段文本本身
        "quoteDigest": _digest(exact),
        # blockTextDigest 覆盖整块逐字文本
        "blockTextDigest": _digest(text),
    }
    if ambiguous:
        resolved["ambiguousHit"] = True
        resolved["hitBlockIds"] = hit_ids
    return resolved, None


def _digest(t: str) -> str:
    return "sha256:" + hashlib.sha256(t.encode("utf-8")).hexdigest()


def run(report: dict, candidates) -> tuple[dict, int]:
    report = require_report(report)
    by_anchor, by_id = build_index(report)
    items = require_candidates(candidates)
    resolved: list[dict] = []
    rejected: list[dict] = []

    for c in items:
        ok, bad = resolve_one(c, by_anchor, by_id)
        if ok:
            resolved.append(ok)
        else:
            rejected.append(bad)

    n_ambiguous = sum(1 for r in resolved if r.get("ambiguousHit"))
    out = {
        "tool": "T3",
        "resolved": resolved,
        "rejected": rejected,
        "summary": {
            "total": len(resolved) + len(rejected),
            "valid": len(resolved),
            "rejected": len(rejected),
            "ambiguous": n_ambiguous,
        },
    }
    return out, (0 if (not rejected and not n_ambiguous) else 1)


def _self_test() -> int:
    checks = {}
    report = {
        "blocks": [
            {"blockId": "b00001", "kind": "text", "anchor": "1.1",
             "rawText": "    使用 malloc 申请内存。", "text": "使用 malloc 申请内存。"},
            {"blockId": "b00002", "kind": "text", "anchor": "1.2",
             "rawText": "未调用 free 释放。", "text": "未调用 free 释放。"},
            {"blockId": "b00005", "kind": "text", "anchor": "1.9",
             "rawText": "未调用 free 释放。", "text": "未调用 free 释放。"},
        ]
    }
    cands = {"items": [
        {"pointId": "P1", "anchor": "1.1", "quote": "    使用 malloc 申请内存。"},
        {"pointId": "P2", "anchor": "9.9"},
        {"pointId": "P3", "anchor": "1.2", "quote": "调用了 free 释放。"},
        {"pointId": "P4", "quote": "未调用 free 释放。"},
        {"pointId": "P5"},
        {"pointId": "P6", "blockId": "b99999"},
        {"pointId": "P7", "anchor": "1.2", "quote": "free"},
    ]}
    out, code = run(report, cands)
    reasons = sorted(r["reason"] for r in out["rejected"])
    checks["reasonEnumComplete"] = reasons == [
        "anchor-not-found", "block-ref-not-found", "no-locator", "quote-mismatch"]

    # 逐字比对走 rawText：带前导空格的引文必须命中（若走 text 就会 quote-mismatch）；
    # 摘要必须覆盖引文本身——引文=整块时两摘要相同，引文⊂整块时两摘要必须不同
    p1 = next(r for r in out["resolved"] if r["pointId"] == "P1")
    p7 = next(r for r in out["resolved"] if r["pointId"] == "P7")
    checks["verbatimUsesRawText"] = (
        p1["exactText"] == "    使用 malloc 申请内存。"
        and p1["quoteDigest"].startswith("sha256:")
        and p1["blockTextDigest"] == p1["quoteDigest"]
        and p7["exactText"] == "free"
        and p7["blockTextDigest"] != p7["quoteDigest"]
    )

    # 歧义命中必须报出，并计为「需注意」（退出码 1）
    p4 = next(r for r in out["resolved"] if r["pointId"] == "P4")
    checks["ambiguousHitReported"] = (
        code == 1
        and out["summary"]["ambiguous"] == 1
        and p4.get("ambiguousHit") is True
        and p4["hitBlockIds"] == ["b00002", "b00005"]
        and p4["blockId"] == "b00002"          # 确定性取 blockId 最小者
    )

    # 入参形状防御：形状不符一律 InputError，绝不静默返回空集（AUDIT P1-7 的核心）
    shape_ok = True
    for bad in ({"candidates": []}, {}, [], {"items": {}}, {"items": [1]}):
        try:
            run(report, bad)
            shape_ok = False
        except InputError:
            pass
    checks["candidateShapeDefended"] = shape_ok

    # 反向证明：形状不符时不再产出「全空 + 退出码 0」这种静默放行
    try:
        run(report, {"candidates": [{"pointId": "X", "anchor": "1.1"}]})
        checks["noSilentEmptyPass"] = False
    except InputError:
        checks["noSilentEmptyPass"] = True

    # 合法但全空的候选：total=0 时仍返回 0（确实没有候选），与「形状错」可区分
    out_empty, code_empty = run(report, {"items": []})
    checks["emptyCandidateListIsOk"] = code_empty == 0 and out_empty["summary"]["total"] == 0

    # --report 形状防御
    try:
        run([], {"items": []})
        checks["reportShapeDefended"] = False
    except InputError:
        checks["reportShapeDefended"] = True

    print(json.dumps({"tool": "T3", "checks": checks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T3 引用解析器（citation-resolver）")
    ap.add_argument("--report")
    ap.add_argument("--candidates")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.report or not args.candidates:
        print(json.dumps({"tool": "T3", "error": "need --report and --candidates"},
                         ensure_ascii=False))
        return 2
    try:
        doc = load(args.report)
        cands = load(args.candidates)
        out, code = run(require_report(doc), cands)
    except InputError as exc:
        print(json.dumps({"tool": "T3", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "T3", "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    payload = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True)
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "T3", "error": "写输出失败：%s" % exc}, ensure_ascii=False))
            return 2
    else:
        print(payload)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
