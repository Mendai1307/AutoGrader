#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AutoGrader · Evaluation 层 · 回归门禁（regression-gate）

拿**两次评测的指标 JSON** 做逐指标对比，判定「新版本是否劣化」。CI 直接用退出码判定通过与否。

比较的三项主指标（方向写死，不得含糊）：

| 指标 | 取值路径 | 方向 | 劣化定义 |
|---|---|---|---|
| 总分 MAE | `mae.mae` | **越小越好** | current > baseline + 容差 |
| 档位一致率 | `levelAgreement.rate` | **越大越好** | current < baseline − 容差 |
| 置信度校准 ECE | `confidenceCalibration.ece` | **越小越好** | current > baseline + 容差 |

逐项命中率（`itemHitRates`）**不单独门禁**——它是 12 行明细，用于定位问题，不用于判定，
避免把噪声当门禁；其汇总值已由「档位一致率」承担。

用法：
  python3 regression_gate.py --baseline <基线的 metrics.json> --current <本次的 metrics.json>
                             [--tolerance 0] [--out <gate.json>]
  python3 regression_gate.py --self-test

退出码（与 Tools 层全局约定一致）：0 通过 ｜ 1 **有劣化**（CI 不通过）｜ 2 输入不可读 / 非法
        3 **判定不完整**（基线或本次缺某项指标 → 该指标 skipped）——宁可显式降级，也不给看似终局的裁决。
        同时存在劣化与 skipped 时以 **1** 为准，但 skipped 仍逐条出现在输出里。

仅标准库；无网络、无 AI；纯函数（同一输入 → 逐位相同输出，不写时间戳）。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

JS_EPSILON = 2.220446049250313e-16

# (指标名, 取值路径, 方向, 中文说明)
METRICS = (
    ("mae", ("mae", "mae"), "lower-better", "总分 MAE"),
    ("levelAgreement", ("levelAgreement", "rate"), "higher-better", "档位一致率"),
    ("ece", ("confidenceCalibration", "ece"), "lower-better", "置信度校准 ECE"),
)


class BadInput(Exception):
    """输入不可读或形状不符（→ 退出码 2）。"""


def round2(value: float) -> float:
    """JS 语义 round2（与契约 `js_round2` 一致）。"""
    x = (float(value) + JS_EPSILON) * 100
    return (math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)) / 100


def _dig(doc, path):
    cur = doc
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


def load_metrics(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except OSError as exc:
        raise BadInput("文件不可读：%s（%s）" % (path, exc)) from exc
    except json.JSONDecodeError as exc:
        raise BadInput("JSON 非法：%s（%s）" % (path, exc)) from exc
    if not isinstance(doc, dict) or doc.get("tool") != "evaluate":
        raise BadInput("不是 evaluate.py 产出的指标文件：%s（顶层需含 tool=evaluate）" % path)
    return doc


def compare(baseline: dict, current: dict, tolerance: float) -> tuple[list, dict]:
    rows, skipped = [], []
    for name, path, direction, label in METRICS:
        b, c = _dig(baseline, path), _dig(current, path)
        if b is None or c is None:
            skipped.append("%s（%s）" % (name, label))
            rows.append({"metric": name, "label": label, "direction": direction,
                         "baseline": b, "current": c, "delta": None,
                         "verdict": "skipped", "detail": "基线或本次缺该指标"})
            continue
        b, c = round2(float(b)), round2(float(c))
        delta = round2(c - b)
        if direction == "lower-better":
            regressed = c > b + tolerance
            improved = c < b - tolerance
        else:
            regressed = c < b - tolerance
            improved = c > b + tolerance
        verdict = "regressed" if regressed else ("improved" if improved else "pass")
        rows.append({"metric": name, "label": label, "direction": direction,
                     "baseline": b, "current": c, "delta": delta, "tolerance": tolerance,
                     "verdict": verdict,
                     "detail": "%s：%s → %s（Δ %+g，容差 %g）" % (label, b, c, delta, tolerance)})
    summary = {
        "regressed": [r["metric"] for r in rows if r["verdict"] == "regressed"],
        "improved": [r["metric"] for r in rows if r["verdict"] == "improved"],
        "passed": [r["metric"] for r in rows if r["verdict"] == "pass"],
        "skipped": skipped,
    }
    return rows, summary


def run(baseline_path: str, current_path: str, tolerance: float) -> tuple[dict, int]:
    baseline, current = load_metrics(baseline_path), load_metrics(current_path)
    rows, summary = compare(baseline, current, tolerance)
    degraded = bool(summary["skipped"])
    failed = bool(summary["regressed"])
    out = {
        "tool": "regression-gate",
        "baseline": {"path": os.path.abspath(baseline_path),
                     "sources": baseline.get("sources"),
                     "mae": _dig(baseline, ("mae", "mae")),
                     "levelAgreement": _dig(baseline, ("levelAgreement", "rate")),
                     "ece": _dig(baseline, ("confidenceCalibration", "ece"))},
        "current": {"path": os.path.abspath(current_path),
                    "sources": current.get("sources"),
                    "mae": _dig(current, ("mae", "mae")),
                    "levelAgreement": _dig(current, ("levelAgreement", "rate")),
                    "ece": _dig(current, ("confidenceCalibration", "ece"))},
        "tolerance": tolerance,
        "metrics": rows,
        "summary": summary,
        "verdict": ("fail" if failed else ("degraded" if degraded else "pass")),
        "exitReason": ("errors" if failed and not degraded else
                       "errors-degraded" if failed and degraded else
                       "degraded" if degraded else "ok"),
    }
    if failed:
        return out, 1
    if degraded:
        return out, 3
    return out, 0


def render_text(out: dict) -> str:
    L = ["AutoGrader · 回归门禁判定", ""]
    for r in out["metrics"]:
        mark = {"pass": "PASS", "regressed": "REGRESSED", "improved": "IMPROVED",
                "skipped": "SKIPPED"}[r["verdict"]]
        L.append("  [%-10s] %s" % (mark, r["detail"] if r["verdict"] != "skipped" else
                                   "%s：基线或本次缺该指标" % r["label"]))
    L.append("")
    L.append("  判定：%s（exitReason=%s）" % (out["verdict"], out["exitReason"]))
    if out["summary"]["skipped"]:
        L.append("  未跑全的指标：%s —— 本次判定**不完整**，不给终局裁决" % "、".join(out["summary"]["skipped"]))
    return "\n".join(L)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="AutoGrader 回归门禁（Evaluation 层）")
    ap.add_argument("--baseline", help="基线指标 JSON（evaluate.py 产出）")
    ap.add_argument("--current", help="本次指标 JSON（evaluate.py 产出）")
    ap.add_argument("--tolerance", type=float, default=0.0,
                    help="允许的波动容差（缺省 0 = 严格比较，按 2 位小数）")
    ap.add_argument("--out", help="（可选）判定 JSON 写文件，缺省写标准输出")
    ap.add_argument("--text", action="store_true", help="改输出人读文本")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.baseline or not args.current:
        print(json.dumps({"tool": "regression-gate", "error": "need --baseline and --current"},
                         ensure_ascii=False))
        return 2
    try:
        out, code = run(args.baseline, args.current, args.tolerance)
    except BadInput as exc:
        print(json.dumps({"tool": "regression-gate", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "regression-gate",
                          "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    payload = render_text(out) if args.text else json.dumps(out, ensure_ascii=False,
                                                            indent=2, sort_keys=True)
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8", newline="\n") as f:
                f.write(payload + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "regression-gate", "error": "写输出失败：%s" % exc,
                              "kind": "output-error"}, ensure_ascii=False))
            return 2
    else:
        print(payload)
    return code


def _mk(mae, rate, ece):
    return {"tool": "evaluate", "mae": {"mae": mae}, "levelAgreement": {"rate": rate},
            "confidenceCalibration": {"ece": ece}, "sources": {"results": "x", "gold": "y"}}


def _self_test() -> int:
    import tempfile

    checks: dict[str, bool] = {}
    d = tempfile.mkdtemp()

    def w(name, doc):
        p = os.path.join(d, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        return p

    base = w("base.json", _mk(3.05, 0.75, 0.10))

    # 完全一致 → 通过
    out, code = run(base, w("same.json", _mk(3.05, 0.75, 0.10)), 0.0)
    checks["identicalPasses"] = code == 0 and out["verdict"] == "pass"

    # MAE 变大 → 劣化 → exit 1
    out, code = run(base, w("worse_mae.json", _mk(3.06, 0.75, 0.10)), 0.0)
    checks["maeUpIsRegressed"] = (code == 1 and out["summary"]["regressed"] == ["mae"]
                                  and out["exitReason"] == "errors")

    # 档位一致率变小 → 劣化
    out, code = run(base, w("worse_rate.json", _mk(3.05, 0.74, 0.10)), 0.0)
    checks["rateDownIsRegressed"] = code == 1 and out["summary"]["regressed"] == ["levelAgreement"]

    # ECE 变大 → 劣化
    out, code = run(base, w("worse_ece.json", _mk(3.05, 0.75, 0.11)), 0.0)
    checks["eceUpIsRegressed"] = code == 1 and out["summary"]["regressed"] == ["ece"]

    # 指标变好 → improved，不算劣化
    out, code = run(base, w("better.json", _mk(2.90, 0.80, 0.05)), 0.0)
    checks["improvementPasses"] = (code == 0 and sorted(out["summary"]["improved"]) ==
                                   ["ece", "levelAgreement", "mae"])

    # 容差内 → 通过（0.05 容差下 3.05 → 3.09 仍算通过）
    out, code = run(base, w("within_tol.json", _mk(3.09, 0.75, 0.10)), 0.05)
    checks["toleranceAbsorbs"] = code == 0 and out["verdict"] == "pass"

    # 缺指标 → skipped → exit 3，且**不给终局裁决**
    partial = _mk(3.05, None, 0.10)
    out, code = run(base, w("partial.json", partial), 0.0)
    checks["missingMetricIsExit3"] = (code == 3 and out["exitReason"] == "degraded"
                                      and out["summary"]["skipped"])

    # 劣化 + 缺指标并存 → 以 1 为准，但 skipped 仍逐条保留
    out, code = run(base, w("both.json", _mk(9.99, None, 0.10)), 0.0)
    checks["errorsBeatDegradedButKeepsSkipped"] = (
        code == 1 and out["exitReason"] == "errors-degraded" and out["summary"]["skipped"])

    # 非 evaluate 产物 → BadInput（→ exit 2）
    badp = w("bad.json", {"tool": "something-else"})
    try:
        run(base, badp, 0.0)
        checks["nonEvaluateFileRejected"] = False
    except BadInput:
        checks["nonEvaluateFileRejected"] = True

    # 文件不存在 → BadInput
    try:
        run(os.path.join(d, "__nope__.json"), base, 0.0)
        checks["missingFileRejected"] = False
    except BadInput:
        checks["missingFileRejected"] = True

    bad = [k for k, v in checks.items() if not v]
    print(json.dumps({"tool": "regression-gate", "checks": checks}, ensure_ascii=False,
                     indent=2, sort_keys=True))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
