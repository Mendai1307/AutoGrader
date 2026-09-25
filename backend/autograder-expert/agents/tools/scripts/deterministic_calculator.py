#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T4 · 确定性计算器（deterministic-calculator）

按冻结口径完成全部**纯算术**：部分分总分、`W_r`、上界、等级映射、复核排序键。

口径写死：总分 = Σ (score / maxScore) × weight  —— 不是 Σ (score × weight / 100)
待复核项**不计入**求和，**不做归一化**（归一化会导致复核时总分回撤）。
上界 = **已计入权重合计**（不是 `100 − W_r`；后者仅在权重和恰为 100 时等价）。

**所有数字必须由本工具产出，不接受模型口算。**

入参（契约冻结版 1.2.0）
----------------------
顶层键为 **`scores[]`**（不是 `items[]`），逐项字段名与 `contract/ReviewResult.schema.json`
逐字一致：

    {"scores": [
      {"rubricItemId": "R1", "itemName": "…", "score": 8, "maxScore": 10,
       "weight": 5, "pending": false, "confidence": 0.9},
      …
    ]}

`score` 在 `pending === true` 时**允许为 `null`**（该项尚无终值）。
`confidence` 缺省 `1.0`；`errorCost` 缺省取该项 `weight`（出错代价与权重同阶）。

用法：
  python3 deterministic_calculator.py --input <result.json> --mode total
  python3 deterministic_calculator.py --input <result.json> --mode rank
  python3 deterministic_calculator.py --self-test
  （`--items` 为 `--input` 的兼容别名）

退出码：0 正常 ｜ 1 输入缺项或非法（结构化报错，不出近似值）｜ 2 输入不可读

仅标准库；无网络、无 AI；纯函数。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

DEFAULT_BANDS = [("A", 90.0), ("B", 80.0), ("C", 70.0), ("D", 60.0), ("F", 0.0)]
# `--grade-bands` 的档位名序列。与 `DEFAULT_BANDS` 一致地**跳过 E**（高校常用 A/B/C/D/F）。
# 旧实现用 A/B/C/D/E… 生成，与默认档位语义不连续（AUDIT P2-24 ④）。
BAND_NAMES = ["A", "B", "C", "D", "F", "G", "H", "I"]

SCORES_KEY = "scores"

JS_EPSILON = 2.220446049250313e-16


class BadInput(Exception):
    pass


def round2(value: float) -> float:
    """与 v0.1 `schema.ts` 的 `round2()`、以及 `contract/fingerprint.py` 的 `js_round2` 逐位等价。

    契约规定两侧统一用 **JS 语义**（half-up，`+ Number.EPSILON`）；
    **不得用 Python 内置 `round()`**（银行家舍入，`.xx5` 边界会与 JS 分叉）。
    本函数是就地实现（T4 不引入跨目录依赖）；自测里有一项专门**与契约实现对齐校验**。
    """
    x = (float(value) + JS_EPSILON) * 100
    return (math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)) / 100


def _num(v, name: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise BadInput("%s 必须是数字，实际为 %r" % (name, v))
    return float(v)


def extract_scores(doc) -> list:
    """入参形状防御：顶层必须是对象，且必须有 `scores` 数组。

    形状不符一律 `BadInput`（→ 退出码 1，结构化报错），
    **不得**因顶层是数组而抛出未捕获异常，**不得**把空输入当成正常输入。
    """
    if not isinstance(doc, dict):
        raise BadInput(
            "入参顶层必须是对象，实际为 %s；期望形如 {\"scores\": [ … ]}"
            % type(doc).__name__
        )
    scores = doc.get(SCORES_KEY)
    if scores is None:
        raise BadInput(
            "入参缺少顶层键 %r；实际顶层键为 %s"
            % (SCORES_KEY, sorted(doc.keys()) or "（无）")
        )
    if not isinstance(scores, list):
        raise BadInput("顶层键 %r 必须是数组，实际为 %s" % (SCORES_KEY, type(scores).__name__))
    if not scores:
        raise BadInput("顶层键 %r 不得为空数组（契约要求至少 1 个评分点）" % SCORES_KEY)
    return scores


def normalize(scores: list) -> list:
    out = []
    for i, it in enumerate(scores):
        if not isinstance(it, dict):
            raise BadInput("scores[%d] 不是对象" % i)
        rid = it.get("rubricItemId")
        if not rid:
            raise BadInput("scores[%d] 缺少 rubricItemId" % i)
        pending = bool(it.get("pending", False))
        max_score = _num(it.get("maxScore"), "%s.maxScore" % rid)
        weight = _num(it.get("weight"), "%s.weight" % rid)
        if max_score <= 0:
            raise BadInput("%s.maxScore 必须大于 0（实际 %s）" % (rid, max_score))
        if weight < 0:
            raise BadInput("%s.weight 不得为负" % rid)

        raw_score = it.get("score")
        if raw_score is None:
            if not pending:
                raise BadInput("%s.score 缺失：仅 pending === true 的项允许 score 为 null" % rid)
            score = None
        else:
            score = _num(raw_score, "%s.score" % rid)
            # pending 项不参与求和，但仍须满足契约的 [0, maxScore] 区间
            if score < 0 or score > max_score:
                raise BadInput("%s.score 越界：%s 不在 [0, %s]" % (rid, score, max_score))

        raw_conf = it.get("confidence")
        conf = 1.0 if raw_conf is None else _num(raw_conf, "%s.confidence" % rid)
        if conf < 0 or conf > 1:
            raise BadInput("%s.confidence 必须在 [0, 1]" % rid)
        err = it.get("errorCost")
        err = weight if err is None else _num(err, "%s.errorCost" % rid)
        out.append(
            {
                "rubricItemId": str(rid),
                "itemName": it.get("itemName"),
                "score": score,
                "maxScore": max_score,
                "weight": weight,
                "pending": pending,
                "needsReview": bool(it.get("needsReview", False)),
                "confidence": conf,
                # rank 模式必须知道置信度是不是**真的给了**：默认 1.0 会让 rankKey 全为 0，
                # 排序静默退化成 rubricItemId 字母序，而教师会照着错误优先级复核（AUDIT P1-9）
                "confidenceGiven": raw_conf is not None,
                "errorCost": err,
            }
        )
    return out


def compute_total(scores: list, bands) -> dict:
    detail = []
    total = 0.0
    w_in = 0.0
    w_ex = 0.0
    for it in scores:
        counted = not it["pending"]
        contrib = (it["score"] / it["maxScore"] * it["weight"]) if counted else 0.0
        if counted:
            total += contrib
            w_in += it["weight"]
        else:
            w_ex += it["weight"]
        detail.append(
            {
                "rubricItemId": it["rubricItemId"],
                "score": it["score"],
                "maxScore": it["maxScore"],
                "weight": it["weight"],
                "contribution": round(contrib, 6),
                "counted": counted,
            }
        )
    total_raw = total
    # 报告值统一到契约口径（**2 位小数、JS 语义**）——契约里 `totalScore` 就是 2 位小数。
    # 旧实现先 round(…, 6)、再用它比档位线，会在 89.9999996 这类值上因「6dp→2dp 的进位」改档
    # （AUDIT P2-24 ②）。现在**档位线一律与报告值 `total` 比较**，与界面/契约看到的数完全一致；
    # 未取整的原值另存 `totalRaw` 供审计。
    total = round2(total_raw)
    w_in = round(w_in, 6)
    w_ex = round(w_ex, 6)
    # 上界 = 已计入权重合计。上限之所以不是 100 − W_r：后者只在权重和恰为 100 时等价，
    # 权重和小于 100 时会给出偏大甚至超过真实上限的值（权重和 60 时旧式返回 100，真实上限 60）。
    upper = w_in
    grade = None
    grade_note = None
    if w_ex > 0:
        grade_note = "存在待复核项（W_r=%s），总分是部分分（下界），暂不做等级映射" % w_ex
    elif w_in != 100.0:
        grade_note = "已计入权重合计 %s ≠ 100，暂不做等级映射" % w_in
    else:
        for name, floor in bands:
            if total >= floor:
                grade = name
                break
    return {
        "tool": "T4",
        "mode": "total",
        "total": total,
        "totalRaw": round(total_raw, 9),
        "weightIncluded": w_in,
        "weightExcluded": w_ex,
        "upperBound": upper,
        "isPartial": w_ex > 0,
        "grade": grade,
        "gradeNote": grade_note,
        "detail": detail,
    }


def compute_rank(scores: list) -> dict:
    # 缺 confidence 就拒绝，不默认 1.0：默认会让 rankKey 全为 0、排序退化为
    # rubricItemId 字母序，而输出看起来**完全合法**——S7 的「低置信 × 高出错代价」
    # 优先级排序会静默失效（AUDIT P1-9）。契约本就要求 confidence 必填。
    missing = [it["rubricItemId"] for it in scores if not it["confidenceGiven"]]
    if missing:
        raise BadInput(
            "rank 模式要求每项都给出 confidence，以下项缺失：%s。"
            "不得默认 1.0——否则 rankKey 全为 0、排序退化为字母序且不报错"
            % ", ".join(missing))
    ranked = []
    for it in scores:
        key = (1.0 - it["confidence"]) * it["errorCost"]
        ranked.append(
            {
                "rubricItemId": it["rubricItemId"],
                "confidence": it["confidence"],
                "errorCost": it["errorCost"],
                "rankKey": round(key, 6),
                "pending": it["pending"],
                "needsReview": it["needsReview"],
            }
        )
    ranked.sort(key=lambda x: (-x["rankKey"], x["rubricItemId"]))
    for i, r in enumerate(ranked, 1):
        r["order"] = i
    return {
        "tool": "T4",
        "mode": "rank",
        "ranked": ranked,
        "rankFormula": "(1 - confidence) × errorCost",
    }


def run(doc, mode: str, bands) -> tuple[dict, int]:
    scores = normalize(extract_scores(doc))
    if mode == "rank":
        return compute_rank(scores), 0
    return compute_total(scores, bands), 0


def _parse_bands(spec: str | None):
    """解析 `--grade-bands`（逗号分隔的档位下界，从高到低）。

    档位名与 `DEFAULT_BANDS` **同一序列**（`A/B/C/D/F…`，跳过 E），不再生成
    `A/B/C/D/E…` 这种与默认档位语义不连续的命名（AUDIT P2-24 ④）。
    非法输入一律 `BadInput`（→ 退出码 1），**不得抛未捕获异常**：
    非数字、越出 [0, 100]、重复下界、档数超过可用档位名。
    """
    if not spec:
        return DEFAULT_BANDS
    raw = [x.strip() for x in spec.split(",") if x.strip()]
    if not raw:
        raise BadInput("--grade-bands 不能为空")
    try:
        vals = [float(x) for x in raw]
    except ValueError as exc:
        raise BadInput("--grade-bands 须是逗号分隔的数字：%s" % exc) from exc
    for v in vals:
        if v < 0 or v > 100:
            raise BadInput("--grade-bands 的档位下界必须在 [0, 100]，实际 %s" % v)
    if len(set(vals)) != len(vals):
        raise BadInput("--grade-bands 含重复下界：%s" % vals)
    if len(vals) > len(BAND_NAMES):
        raise BadInput("--grade-bands 最多 %d 档（可用档位名 %s），实际 %d 档"
                       % (len(BAND_NAMES), "/".join(BAND_NAMES), len(vals)))
    vals.sort(reverse=True)
    return [(BAND_NAMES[i], v) for i, v in enumerate(vals)]


def _self_test() -> int:
    checks = {}

    # 1) 待复核项不计入求和，总分是部分分，上界 = 已计入权重
    payload = {
        "scores": [
            {"rubricItemId": "P1", "score": 8, "maxScore": 10, "weight": 40,
             "pending": False, "confidence": 0.9},
            {"rubricItemId": "P2", "score": 6, "maxScore": 10, "weight": 35,
             "pending": False, "confidence": 0.55},
            {"rubricItemId": "P3", "score": 10, "maxScore": 10, "weight": 25,
             "pending": True, "confidence": 0.4},
        ]
    }
    out, _ = run(payload, "total", DEFAULT_BANDS)
    checks["partialTotal"] = (
        out["total"] == 53.0
        and out["weightIncluded"] == 75.0
        and out["weightExcluded"] == 25.0
        and out["upperBound"] == 75.0
        and out["isPartial"] is True
        and out["grade"] is None
    )

    # 2) 回归：权重和 ≠ 100 时，上界必须等于已计入权重合计（旧式 100 − W_r 会返回 100）
    narrow = {
        "scores": [
            {"rubricItemId": "P1", "score": 8, "maxScore": 10, "weight": 40, "pending": False},
            {"rubricItemId": "P2", "score": 6, "maxScore": 10, "weight": 30, "pending": False},
        ]
    }
    out_narrow, _ = run(narrow, "total", DEFAULT_BANDS)
    checks["upperBoundIsWeightIncluded"] = (
        out_narrow["weightExcluded"] == 0.0
        and out_narrow["upperBound"] == 70.0
        and out_narrow["upperBound"] != 100.0
        and out_narrow["total"] == 50.0
    )

    # 3) pending 项允许 score 为 null，且不得因此报错或计入求和
    null_pending = {
        "scores": [
            {"rubricItemId": "P1", "score": 8, "maxScore": 10, "weight": 60, "pending": False},
            {"rubricItemId": "P2", "score": None, "maxScore": 10, "weight": 40, "pending": True},
        ]
    }
    out_null, _ = run(null_pending, "total", DEFAULT_BANDS)
    checks["pendingNullScoreAllowed"] = (
        out_null["total"] == 48.0
        and out_null["weightExcluded"] == 40.0
        and out_null["upperBound"] == 60.0
    )

    # 4) 非 pending 项给 null → 必须结构化报错，不得静默跳过
    try:
        run({"scores": [{"rubricItemId": "P1", "score": None, "maxScore": 10,
                         "weight": 100, "pending": False}]}, "total", DEFAULT_BANDS)
        checks["nullScoreRejectedWhenNotPending"] = False
    except BadInput:
        checks["nullScoreRejectedWhenNotPending"] = True

    # 5) 入参形状防御：裸数组 / 缺键 / 空数组 / 空对象 → BadInput，不得抛未捕获异常
    shape_ok = True
    for bad in ([], [{"rubricItemId": "P1"}], {}, {"scores": []}, {"items": []}):
        try:
            run(bad, "total", DEFAULT_BANDS)
            shape_ok = False
        except BadInput:
            pass
        except Exception:  # noqa: BLE001
            shape_ok = False
    checks["inputShapeDefended"] = shape_ok

    # 6) 排序键：(1 - confidence) × errorCost，errorCost 缺省取 weight
    #    P1 0.10×40 = 4.00 ｜ P2 0.45×35 = 15.75 ｜ P3 0.60×25 = 15.00
    #    → 顺序 P2, P3, P1；置信度最低(P3)并不必然最前，因为出错代价也参与排序
    out_rank, _ = run(payload, "rank", DEFAULT_BANDS)
    checks["rankOrder"] = (
        [r["rubricItemId"] for r in out_rank["ranked"]] == ["P2", "P3", "P1"]
        and [r["order"] for r in out_rank["ranked"]] == [1, 2, 3]
        and [r["rankKey"] for r in out_rank["ranked"]] == [15.75, 15.0, 4.0]
    )

    # 6b) rank 缺 confidence → 必须报错，不得静默退化成「按 rubricItemId 字母序」
    try:
        run({"scores": [{"rubricItemId": "P1", "score": 8, "maxScore": 10,
                         "weight": 100, "pending": False}]}, "rank", DEFAULT_BANDS)
        checks["rankRequiresConfidence"] = False
    except BadInput:
        checks["rankRequiresConfidence"] = True

    # 7) 口径仍与契约一致（Σ score/maxScore × weight）
    checks["formulaUnchanged"] = abs(
        sum(s["score"] / s["maxScore"] * s["weight"] for s in payload["scores"]
            if not s["pending"]) - out["total"]
    ) < 1e-9

    # 8) P2-24②：档位线一律与**报告值** total 比较（2 位小数、JS 语义），
    #    消除「6dp → 2dp 进位」造成的改档。89.995 在旧实现里是 B（89.995 < 90），
    #    而报告值是 90.0，因此应以 A 呈现，且 totalRaw 保留原值供审计。
    boundary = {"scores": [{"rubricItemId": "P1", "score": 89995, "maxScore": 100000,
                            "weight": 100, "pending": False, "confidence": 0.9}]}
    out_b, _ = run(boundary, "total", DEFAULT_BANDS)
    checks["gradeLineUsesReportedTotal"] = (
        out_b["total"] == 90.0 and out_b["grade"] == "A" and out_b["totalRaw"] == 89.995
    )

    # 9) P2-24④：--grade-bands 的档位名与默认档位同序列（跳过 E），非法输入一律 BadInput
    checks["bandNamesContinuous"] = (
        [n for n, _ in _parse_bands("95,85,75,65,55")] == ["A", "B", "C", "D", "F"]
        and [n for n, _ in _parse_bands(None)] == [n for n, _ in DEFAULT_BANDS]
    )
    band_bad = True
    # 注：空串（`--grade-bands ""`）视为「未指定」→ 用默认档位，不算非法输入
    for bad in ("x", " , ", "90,90,80", "110,90", "-1,90",
                "1,2,3,4,5,6,7,8,9"):
        try:
            _parse_bands(bad)
            band_bad = False
        except BadInput:
            pass
        except Exception:  # noqa: BLE001  任何非 BadInput 异常都算不合格
            band_bad = False
    checks["bandSpecBadInputRejected"] = band_bad
    checks["bandSpecEmptyMeansDefault"] = _parse_bands("") == DEFAULT_BANDS

    # 10) round2 必须与契约实现逐位等价（就地实现 + 对齐校验，防两侧分叉）
    fp_path = None
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    for _ in range(6):
        cand = os.path.join(cur, "contract", "fingerprint.py")
        if os.path.isfile(cand):
            fp_path = cand
            break
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    if fp_path:
        import importlib.util
        spec = importlib.util.spec_from_file_location("_contract_fp", fp_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        vals = [0.0, 2.675, 0.125, 89.995, 97.2, 100.0, 1.005, 0.1 + 0.2]
        checks["round2MatchesContract"] = all(
            round2(v) == mod.js_round2(v) for v in vals
        )
    else:
        checks["round2MatchesContract"] = False

    print(json.dumps({"tool": "T4", "checks": checks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T4 确定性计算器（deterministic-calculator）")
    ap.add_argument("--input", "--items", dest="input",
                    help="契约形状的 JSON（顶层键 scores[]）")
    ap.add_argument("--mode", default="total", choices=["total", "rank"])
    ap.add_argument("--grade-bands")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.input:
        print(json.dumps({"tool": "T4", "error": "need --input"}, ensure_ascii=False))
        return 2
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"tool": "T4", "error": str(exc)}, ensure_ascii=False))
        return 2

    try:
        out, code = run(doc, args.mode, _parse_bands(args.grade_bands))
    except BadInput as exc:
        print(json.dumps({"tool": "T4", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 1

    payload_out = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True)
    if args.out:
        # 与 T1 / T2 / T3 / T6 一致：写输出失败也必须是结构化报错 + 退出码 2，
        # 不得裸 traceback（tools/README §八 的全局约定覆盖全部六脚本）
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload_out + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "T4", "error": "写输出失败：%s" % exc,
                              "kind": "output-error"}, ensure_ascii=False))
            return 2
    else:
        print(payload_out)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
