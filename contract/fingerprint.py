#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AutoGrader · 结果指纹算法（契约冻结版 1.1.0 · 路径 0.3）

算法来源：v0.1 `frontend/lib/schema.ts:371-376` 的 `resultFingerprint` docstring。
本模块是那次定义的**可执行移植**，并把跨语言复算所需的三条规范化规则写死（见下）。

算法
----
1. 深拷贝输入对象，把 `provenance.resultFingerprint` 置为 `""`（自指字段必须置空，
   否则改一个字就会连锁改指纹，永远对不上）；
2. 对所有对象**递归按键的字典序排序**；
3. 把所有数字**四舍五入到 2 位小数**；
4. 序列化为**无空格 UTF-8 JSON**；
5. 取 **SHA-256 十六进制小写**，加前缀 `sha256:`。

三条跨语言规范化规则（缺一不可，否则 Python 与 JS 复算结果不等）
------------------------------------------------------------------
R1 数字：一律先按 **JS `round2` 语义**取 2 位小数
   —— 即 `Math.round((v + Number.EPSILON) * 100) / 100`，`Number.EPSILON = 2.220446049250313e-16`。
   **不得用 Python 内置 `round()`**：它是银行家舍入（round-half-to-even），在 `.xx5`
   边界上与 JS 的 half-up 分叉（`round(2.675, 2)` → `2.67`，而 JS → `2.68`）。
   序列化时整数不写小数点（`5.0` → `5`），小数去掉尾随零（`97.20` → `97.2`）。
   这样 Python 的输出与 JS `JSON.stringify` 对同一值的输出逐字相同
   （值域 0–100，不触及 JS 的指数记法阈值）。
R2 `null` 与缺失键：**「字段不存在」= 不出现该键；「无值」= 显式 `null`**。
   两者不可混用。本算法**保留**显式 `null`（参与哈希）、不补键。
R3 键序：两侧都必须**递归排序**，不得依赖语言默认序
   （JS 的 `JSON.stringify` 会把整数样式键前置，Python 字典保插入序）。
   Python 侧用本模块；JS 侧见同目录 `fingerprint.mjs`。

用法
----
    python3 fingerprint.py --input <result.json>          # 打印该文件的指纹
    python3 fingerprint.py --input <result.json> --check   # 与文件中声明值比对
    python3 fingerprint.py --self-test

仅标准库；无网络、无 AI；纯函数（不修改入参）。
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import sys

FINGERPRINT_PREFIX = "sha256:"
ROUND_DP = 2

# JS Number.EPSILON —— 与 v0.1 `round2()` 逐位对齐所必需
JS_EPSILON = 2.220446049250313e-16


# --------------------------------------------------------------------------- #
# R1 数字规范化
# --------------------------------------------------------------------------- #
def _js_round(x: float) -> float:
    """JS `Math.round` 语义：half-up（.5 向 +∞ 进位），非 Python 的银行家舍入。"""
    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)


def js_round2(value: float) -> float:
    """与 v0.1 `schema.ts` 的 `round2()` 逐位等价。契约要求两侧统一使用本函数。"""
    return _js_round((float(value) + JS_EPSILON) * 100) / 100


def _num(value: float) -> str:
    """按 R1 输出数字：整数不带小数点，小数去掉尾随零。"""
    r = js_round2(value)
    if r == 0:
        return "0"
    if r == int(r) and abs(r) < 1e16:
        return str(int(r))
    text = ("%.*f" % (ROUND_DP, r)).rstrip("0").rstrip(".")
    return text or "0"


def _dumps(value) -> str:
    """无空格 JSON 序列化：字典键递归字典序排序，数字按 R1 输出。"""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _num(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_dumps(x) for x in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys(), key=lambda k: str(k)):
            parts.append(json.dumps(str(key), ensure_ascii=False) + ":" + _dumps(value[key]))
        return "{" + ",".join(parts) + "}"
    raise TypeError("指纹序列化遇到不支持的类型：%s" % type(value).__name__)


def canonical_json(obj) -> str:
    """返回参与哈希的规范化 JSON 文本。供第三方逐步复算与排错使用。"""
    return _dumps(_blank_fingerprint(obj))


# --------------------------------------------------------------------------- #
# 自指字段置空
# --------------------------------------------------------------------------- #
def _blank_fingerprint(obj):
    """深拷贝并把 `provenance.resultFingerprint` 置为 ""。不修改入参。

    ⚠️ 键**必须存在**（不存在则补上）：契约的算法是「置为 `''`」，
    而 `{"resultFingerprint": ""}` 与「根本没有这个键」序列化出的文本**不同**。
    若生产者不补键、校验者补键，两侧复算必然不等——这是跨实现复算不一致的经典来源。
    """
    clone = copy.deepcopy(obj)
    if isinstance(clone, dict):
        prov = clone.get("provenance")
        if isinstance(prov, dict):
            prov["resultFingerprint"] = ""
    return clone


# --------------------------------------------------------------------------- #
# 对外接口（T5 以 `--fingerprint-algo <path>` 加载，必须提供本函数）
# --------------------------------------------------------------------------- #
def fingerprint(obj) -> str:
    """返回 `"sha256:<64位小写十六进制>"`。纯函数，不修改入参。"""
    text = canonical_json(obj)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return FINGERPRINT_PREFIX + digest


# --------------------------------------------------------------------------- #
# 自测
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    doc = {
        "schemaVersion": "1.0.0",
        "scores": [{"rubricItemId": "R1", "score": 8.0, "maxScore": 10, "weight": 5}],
        "provenance": {"resultFingerprint": "sha256:" + "0" * 64, "schemaVersion": "1.0.0"},
    }
    expected = fingerprint(doc)

    # 自指字段被置空：改声明值不影响结果
    doc2 = copy.deepcopy(doc)
    doc2["provenance"]["resultFingerprint"] = "sha256:" + "f" * 64
    ok_self_ref = fingerprint(doc2) == expected

    # R1：整数与浮点同值同文本
    ok_int_float = _num(5.0) == "5" and _num(97.20) == "97.2" and _num(0.0) == "0"

    # R1：.xx5 边界必须走 JS half-up，而非 Python 银行家舍入
    ok_rounding = js_round2(2.675) == 2.68 and js_round2(0.125) == 0.13

    # R3：键序不影响结果
    ok_key_order = _dumps({"b": 1, "a": 2}) == '{"a":2,"b":1}'

    # R2：显式 null 参与哈希，缺失键不补
    ok_null_kept = _dumps({"a": None}) == '{"a":null}' and _dumps({}) == "{}"

    # 入参未被修改
    ok_pure = doc["provenance"]["resultFingerprint"] == "sha256:" + "0" * 64

    # 键不存在 vs 键为空串 → 必须得到同一个指纹（否则生产者与校验者复算不等）
    no_key = {"schemaVersion": "1.0.0", "provenance": {"schemaVersion": "1.0.0"}}
    empty_key = {"schemaVersion": "1.0.0",
                 "provenance": {"schemaVersion": "1.0.0", "resultFingerprint": ""}}
    ok_key_present = fingerprint(no_key) == fingerprint(empty_key)
    ok_no_provenance = _dumps(_blank_fingerprint({"a": 1})) == '{"a":1}'

    out = {
        "tool": "fingerprint",
        "version": "1.1.0",
        "algorithm": "recursive-key-sort + blank provenance.resultFingerprint + round2 + no-space UTF-8 + sha256",
        "sampleFingerprint": expected,
        "checks": {
            "selfReferenceBlanked": ok_self_ref,
            "numberNormalization": ok_int_float,
            "jsRoundingParity": ok_rounding,
            "keyOrderIndependent": ok_key_order,
            "nullVsMissing": ok_null_kept,
            "pureFunction": ok_pure,
            "selfReferenceKeyAlwaysPresent": ok_key_present and ok_no_provenance,
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(out["checks"].values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="AutoGrader 结果指纹算法（契约冻结版 1.1.0）")
    ap.add_argument("--input", help="待计算指纹的 ReviewResult JSON")
    ap.add_argument("--check", action="store_true",
                    help="与文件中 provenance.resultFingerprint 声明值比对")
    ap.add_argument("--canonical", action="store_true",
                    help="额外打印参与哈希的规范化 JSON 文本")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.input:
        print(json.dumps({"tool": "fingerprint", "error": "need --input"}, ensure_ascii=False))
        return 2
    try:
        with open(args.input, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"tool": "fingerprint", "error": str(exc)}, ensure_ascii=False))
        return 2

    try:
        got = fingerprint(doc)
    except TypeError as exc:
        print(json.dumps({"tool": "fingerprint", "error": str(exc)}, ensure_ascii=False))
        return 2

    out = {"tool": "fingerprint", "version": "1.1.0", "file": args.input, "computed": got}
    if args.canonical:
        out["canonical"] = canonical_json(doc)
    code = 0
    if args.check:
        want = None
        if isinstance(doc, dict):
            prov = doc.get("provenance")
            if isinstance(prov, dict):
                want = prov.get("resultFingerprint")
        out["declared"] = want
        out["match"] = (want == got)
        code = 0 if out["match"] else 1
    print(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
