#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AutoGrader · Evaluation 层 · 一致性评测脚本（evaluate）

一条命令跑完全部指标，产出**机器可读 JSON**（缺省写标准输出）与可选的**人读 Markdown 报告**。

四项指标（口径见同目录 `../metrics.md`，与 v0.1 `frontend/lib/analysis.ts` 同源）：
  1. `mae`               总分 MAE = (1/N) × Σ |AI 加权总分 − 教师金标准分|
  2. `itemHitRates`      逐项命中率（12 行）= hits / comparable，命中判据 = 档位完全一致
  3. `levelAgreement`    档位一致率（总体）= Σhits / Σcomparable（与 2 同口径的汇总值）
  4. `confidenceCalibration`  置信度校准（分桶表 + ECE），分桶阈值取自 `docs/contract.md` §八

可比性规则（必须显式，不得含糊）：
  - 每份报告先定 `status`：`ok` / `invalid`（读不出或契约校验不过）/ `missing`（无对应结果文件）
  - **MAE 只用 `status === 'ok'` 的行**
  - **逐项/档位/校准只用「该份 ok 且该项在 AI 与金标准两侧都存在」的项**
  - 缺结果或缺标注一律**不计入分母**，且逐条列进 `excluded` —— 与 L1「未知优于否定」一致

用法：
  python3 evaluate.py --results <结果目录> --gold <金标准 manifest.json>
                      [--rubric <rubric.json>] [--out <metrics.json>] [--report <report.md>]
  python3 evaluate.py --self-test

退出码：0 全部 ok ｜ 1 有 missing / invalid 份（评测仍完成，但可比样本不全）
        2 输入不可读 / 非法 ｜ 3 降级（金标准缺 expectedItemScores → 部分指标跳过）

仅标准库；无网络、无 AI；纯函数（同一输入 → 逐位相同输出，**不写时间戳 / 主机名 / 随机值**）。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys

# 本脚本的自测会用 importlib 加载 `contract/fingerprint.py` 做舍入对齐校验，
# 那一步会在随包交付目录里留下 `__pycache__`。关掉字节码落盘（与 T5 的同类处理保持一致）：
# 对齐校验照常进行，只是不再写 .pyc。**只影响本进程**。
sys.dont_write_bytecode = True

# 与契约一致的 JS 语义 round2（half-up）；不得用 Python 内置 round()（银行家舍入）
JS_EPSILON = 2.220446049250313e-16

SCHEMA_VERSION = "1.2.0"
LEVEL_ORDER = ("excellent", "meeting", "partial", "notMet")

# 置信度分桶阈值：直接取自 `docs/contract.md` §八（HIGH = 0.80 / MEDIUM = 0.60），不另行发明
CONF_BUCKETS = (
    ("low", None, 0.60),
    ("medium", 0.60, 0.80),
    ("high", 0.80, None),
)


class BadInput(Exception):
    """输入不可读或形状不符（→ 退出码 2）。"""


# --------------------------------------------------------------------------- #
# 数字
# --------------------------------------------------------------------------- #
def round2(value: float) -> float:
    """JS 语义 round2。自测中有一项与 `contract/fingerprint.py` 的 js_round2 逐值对齐。"""
    x = (float(value) + JS_EPSILON) * 100
    return (math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)) / 100


def _load_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except OSError as exc:
        raise BadInput("文件不可读：%s（%s）" % (path, exc)) from exc
    except json.JSONDecodeError as exc:
        raise BadInput("JSON 非法：%s（%s）" % (path, exc)) from exc


# --------------------------------------------------------------------------- #
# 金标准
# --------------------------------------------------------------------------- #
def load_gold(path: str) -> tuple[list, dict]:
    """返回 (reports, meta)。

    reports 每项形如 `{"id", "title", "tier", "goldTotalScore", "levels": {rubricItemId: level}}`。
    `expectedItemScores` 缺失时记 **降级**（逐项 / 档位 / 校准三项跳过），不是错误。
    """
    doc = _load_json(path)
    if not isinstance(doc, dict):
        raise BadInput("金标准顶层必须是对象，实际为 %s" % type(doc).__name__)
    reports = doc.get("reports")
    if not isinstance(reports, list) or not reports:
        raise BadInput("金标准缺少非空 `reports` 数组；实际顶层键为 %s" % sorted(doc.keys()))

    out = []
    degraded = False
    for i, r in enumerate(reports):
        if not isinstance(r, dict):
            raise BadInput("reports[%d] 不是对象" % i)
        rid = r.get("id")
        if not rid:
            raise BadInput("reports[%d] 缺少 `id`" % i)
        gold_score = r.get("goldTotalScore")
        if isinstance(gold_score, bool) or not isinstance(gold_score, (int, float)):
            raise BadInput("reports[%s].goldTotalScore 必须是数字，实际为 %r" % (rid, gold_score))
        levels: dict[str, str] = {}
        names: dict[str, str] = {}
        eis = r.get("expectedItemScores")
        if eis is None:
            degraded = True
        elif not isinstance(eis, list):
            raise BadInput("reports[%s].expectedItemScores 必须是数组" % rid)
        else:
            for e in eis:
                if not isinstance(e, dict):
                    raise BadInput("reports[%s].expectedItemScores 含非对象项" % rid)
                iid, lv = e.get("rubricItemId"), e.get("level")
                if iid is None:
                    raise BadInput("reports[%s] 的 expectedItemScores 项缺少 rubricItemId" % rid)
                if e.get("itemName"):
                    names.setdefault(str(iid), str(e["itemName"]))
                if lv is not None:
                    if lv not in LEVEL_ORDER:
                        raise BadInput("reports[%s] 的档位 %r 不在契约枚举内" % (rid, lv))
                    levels[str(iid)] = lv
        out.append({"id": str(rid), "title": r.get("title"), "tier": r.get("tier"),
                    "goldTotalScore": float(gold_score), "levels": levels, "names": names})

    meta = {"rubricId": doc.get("rubricId"), "rubricVersion": doc.get("rubricVersion"),
            "schemaVersion": doc.get("schemaVersion"),
            "totalScoreFormula": doc.get("totalScoreFormula"),
            "reportCount": len(out), "degradedNoItemScores": degraded}
    return out, meta


# --------------------------------------------------------------------------- #
# AI 结果
# --------------------------------------------------------------------------- #
def scan_results(dir_path: str) -> dict[str, str]:
    """返回 {reportId 或 文件名: 文件路径}。目录不存在 → BadInput。"""
    if not os.path.isdir(dir_path):
        raise BadInput("结果目录不存在：%s（这不是「没有结果」，而是**目录未建立**）" % dir_path)
    found: dict[str, str] = {}
    for name in sorted(os.listdir(dir_path)):
        if not name.lower().endswith(".json"):
            continue
        if name.startswith("_"):
            continue  # 约定：以 `_` 开头的是契约示例，不算真实结果
        found[name] = os.path.join(dir_path, name)
    return found


def parse_result(path: str) -> dict:
    """读一份 ReviewResult，返回最小可用视图；形状不符抛 BadInput（由调用方记 invalid）。"""
    doc = _load_json(path)
    if not isinstance(doc, dict):
        raise BadInput("顶层必须是对象")
    report = doc.get("report")
    if not isinstance(report, dict) or not report.get("reportId"):
        raise BadInput("缺少 report.reportId")
    total_score = doc.get("totalScore")
    if isinstance(total_score, bool) or not isinstance(total_score, (int, float)):
        raise BadInput("totalScore 必须是数字")
    scores = doc.get("scores")
    if not isinstance(scores, list) or not scores:
        raise BadInput("scores 必须是非空数组")
    items = {}
    for s in scores:
        if not isinstance(s, dict) or not s.get("rubricItemId"):
            raise BadInput("scores 项缺少 rubricItemId")
        conf = s.get("confidence")
        items[str(s["rubricItemId"])] = {
            "level": s.get("level"),
            "score": s.get("score"),
            "confidence": None if conf is None else float(conf),
            "needsReview": bool(s.get("needsReview", False)),
            "pending": bool(s.get("pending", False)),
        }
    return {"reportId": str(report["reportId"]), "totalScore": float(total_score), "items": items}


# --------------------------------------------------------------------------- #
# 四项指标
# --------------------------------------------------------------------------- #
def build_rows(gold: list, results: dict[str, str]) -> tuple[list, list]:
    """把金标准与 AI 结果按 `reportId` 关联，产出逐份对照行 + 排除清单。"""
    by_id: dict[str, str] = {}
    for name, path in results.items():
        try:
            doc = _load_json(path)
            rid = (doc.get("report") or {}).get("reportId") if isinstance(doc, dict) else None
        except BadInput:
            rid = None
        by_id[str(rid)] = path if rid else None
        if rid is None:
            by_id.setdefault("__unjoinable__", None)

    rows, excluded = [], []
    used_paths: set[str] = set()
    for g in gold:
        path = by_id.get(g["id"])
        if path is None:
            rows.append({"reportId": g["id"], "title": g["title"], "tier": g["tier"],
                         "goldTotalScore": g["goldTotalScore"], "aiTotalScore": None,
                         "delta": None, "itemCount": 0, "status": "missing"})
            excluded.append({"reportId": g["id"], "reason": "missing-result",
                             "detail": "结果目录下没有 reportId 为 %s 的结果文件" % g["id"]})
            continue
        used_paths.add(path)
        try:
            ai = parse_result(path)
        except BadInput as exc:
            rows.append({"reportId": g["id"], "title": g["title"], "tier": g["tier"],
                         "goldTotalScore": g["goldTotalScore"], "aiTotalScore": None,
                         "delta": None, "itemCount": 0, "status": "invalid"})
            excluded.append({"reportId": g["id"], "reason": "invalid-result",
                             "detail": "%s（%s）" % (exc, os.path.basename(path))})
            continue
        rows.append({
            "reportId": g["id"], "title": g["title"], "tier": g["tier"],
            "goldTotalScore": g["goldTotalScore"], "aiTotalScore": ai["totalScore"],
            "delta": round2(ai["totalScore"] - g["goldTotalScore"]),
            "itemCount": len(ai["items"]), "status": "ok", "_ai": ai,
        })
    for name, path in results.items():
        if path not in used_paths:
            excluded.append({"reportId": None, "reason": "unmatched-result-file",
                             "detail": "结果文件 %s 的 reportId 不在金标准内" % os.path.basename(path)})
    return rows, excluded


def compute_mae(rows: list, tier_order: list) -> dict:
    usable = [r for r in rows if r["status"] == "ok"]
    if not usable:
        return {"count": 0, "mae": None, "maxAbsDelta": None, "maxAbsDeltaReportId": None,
                "byTier": []}
    best = max(usable, key=lambda r: (abs(r["delta"]), r["reportId"]))
    by_tier = []
    for tier in tier_order:
        grp = [r for r in usable if r.get("tier") == tier]
        if not grp:
            continue
        gb = max(grp, key=lambda r: (abs(r["delta"]), r["reportId"]))
        by_tier.append({
            "tier": tier, "count": len(grp), "n": len(grp),
            "mae": round2(sum(abs(r["delta"]) for r in grp) / len(grp)),
            "maxAbsDelta": round2(abs(gb["delta"])),
            "maxAbsDeltaReportId": gb["reportId"],
        })
    return {
        "count": len(usable),
        "mae": round2(sum(abs(r["delta"]) for r in usable) / len(usable)),
        "maxAbsDelta": round2(abs(best["delta"])),
        "maxAbsDeltaReportId": best["reportId"],
        # 分组视图：同一公式按金标准的难度档 tier 切分。用途是复现项目已公开披露的「差档 MAE」，
        # 属 MAE 的细分视图，不是新增指标口径；档序取金标准 `reports[]` 中**首次出现的次序**（数据驱动、可复现）。
        "byTier": by_tier,
    }


def comparable_pairs(gold: list, rows: list) -> tuple[dict[str, list], list]:
    """返回 (按 rubricItemId 聚合的可比对, 逐项明细)。

    可比对 = 「该份 status ok」且「该项在 AI scores 与金标准 levels 两侧都有 level」。
    每对含 `reportId` / `aiLevel` / `goldLevel` / `confidence` / `hit`。
    """
    gold_by_id = {g["id"]: g for g in gold}
    per_item: dict[str, list] = {}
    flat: list = []
    for row in rows:
        if row["status"] != "ok":
            continue
        g = gold_by_id[row["reportId"]]
        ai = row["_ai"]
        for iid, glevel in sorted(g["levels"].items()):
            a = ai["items"].get(iid)
            if a is None or a["level"] is None:
                continue
            pair = {"reportId": row["reportId"], "rubricItemId": iid,
                    "aiLevel": a["level"], "goldLevel": glevel,
                    "confidence": a["confidence"], "hit": a["level"] == glevel}
            per_item.setdefault(iid, []).append(pair)
            flat.append(pair)
    return per_item, flat


def compute_item_hits(gold: list, per_item: dict[str, list]) -> tuple[list, dict]:
    """12 行逐项命中率 + 总体档位一致率（同一口径的汇总值）。"""
    names: dict[str, str] = {}
    for g in gold:
        for iid, nm in (g.get("names") or {}).items():
            names.setdefault(iid, nm)
    rows = []
    hits_total = comp_total = 0
    for iid in sorted(per_item.keys()):
        pairs = per_item[iid]
        comparable = len(pairs)
        hits = sum(1 for p in pairs if p["hit"])
        hits_total += hits
        comp_total += comparable
        rows.append({
            "rubricItemId": iid,
            "itemName": names.get(iid),
            "comparable": comparable, "hits": hits,
            "rate": round2(hits / comparable) if comparable else None,
        })
    agreement = None if comp_total == 0 else round2(hits_total / comp_total)
    level_agreement = {
        "comparable": comp_total, "hits": hits_total, "rate": agreement,
        "note": "与逐项命中率同口径（命中判据均为「AI 档位 === 金标准档位」）；"
                "本值是**汇总**（Σhits / Σcomparable），逐项值见 itemHitRates。",
    }
    return rows, level_agreement


def _bucket_of(conf: float) -> str | None:
    for name, lo, hi in CONF_BUCKETS:
        if (lo is None or conf >= lo) and (hi is None or conf < hi):
            return name
    return None


def compute_calibration(flat: list) -> tuple[dict, list]:
    """置信度校准：按契约 §八 的阈值分桶，给每桶准确率、平均置信度与校准差，并汇总 ECE。"""
    buckets = {name: {"n": 0, "hits": 0, "confSum": 0.0} for name, _lo, _hi in CONF_BUCKETS}
    no_conf = 0
    for p in flat:
        conf = p["confidence"]
        if conf is None:
            no_conf += 1
            continue
        name = _bucket_of(conf)
        if name is None:
            no_conf += 1
            continue
        b = buckets[name]
        b["n"] += 1
        b["hits"] += 1 if p["hit"] else 0
        b["confSum"] += conf
    total = sum(b["n"] for b in buckets.values())
    table, ece = [], 0.0
    for name, _lo, _hi in CONF_BUCKETS:
        b = buckets[name]
        if b["n"] == 0:
            table.append({"bucket": name, "n": 0, "meanConfidence": None,
                          "accuracy": None, "calibrationGap": None})
            continue
        mean_conf = round2(b["confSum"] / b["n"])
        acc = round2(b["hits"] / b["n"])
        table.append({"bucket": name, "n": b["n"], "meanConfidence": mean_conf,
                      "accuracy": acc, "calibrationGap": round2(acc - mean_conf)})
        ece += (b["n"] / total) * abs(acc - mean_conf)
    return {"ece": round2(ece) if total else None, "buckets": table,
            "itemsWithoutConfidence": no_conf}, table


# --------------------------------------------------------------------------- #
# 报告
# --------------------------------------------------------------------------- #
def render_report(metrics: dict) -> str:
    m, rows, items, cal = metrics, metrics["rows"], metrics["itemHitRates"], metrics["confidenceCalibration"]
    L = []
    L.append("# AutoGrader · 一致性评测报告（由 `evaluate.py` 生成）")
    L.append("")
    L.append("> 口径真源：`evaluations/metrics.md`。数据源：金标准 `%s`、结果目录 `%s`。"
             % (metrics["sources"]["gold"], metrics["sources"]["results"]))
    L.append("")
    L.append("## 一、结论摘要")
    L.append("")
    L.append("| 指标 | 值 |")
    L.append("|---|---|")
    L.append("| 总分 MAE（越小越好） | **%s**（N = %s 份） |" % (m["mae"]["mae"], m["mae"]["count"]))
    L.append("| 档位一致率（越大越好） | **%s**（%s / %s 项） |"
             % (m["levelAgreement"]["rate"], m["levelAgreement"]["hits"], m["levelAgreement"]["comparable"]))
    L.append("| 置信度校准 ECE（越小越好） | **%s** |" % cal["ece"])
    L.append("| 单份最大绝对偏差 | %s（`%s`） |"
             % (m["mae"]["maxAbsDelta"], m["mae"]["maxAbsDeltaReportId"]))
    L.append("")
    if m["mae"].get("byTier"):
        L.append("**按难度档分组的总分 MAE**（同一公式的细分视图；用于**主动披露局限**——低分档偏差通常最大）")
        L.append("")
        L.append("| 难度档 | 份数 | MAE | 单份最大绝对偏差 |")
        L.append("|---|---|---|---|")
        for t in m["mae"]["byTier"]:
            L.append("| %s | %s | **%s** | %s（`%s`） |"
                     % (t["tier"], t["count"], t["mae"], t["maxAbsDelta"], t["maxAbsDeltaReportId"]))
        L.append("")
    L.append("## 二、逐份对照（偏差 = AI − 金标准，正值表示 AI 偏松）")
    L.append("")
    L.append("| reportId | 难度 | 金标准 | AI | 偏差 | 状态 |")
    L.append("|---|---|---|---|---|---|")
    for r in rows:
        L.append("| `%s` | %s | %s | %s | %s | %s |"
                 % (r["reportId"], r["tier"], r["goldTotalScore"],
                    "-" if r["aiTotalScore"] is None else r["aiTotalScore"],
                    "-" if r["delta"] is None else "%+.2f" % r["delta"], r["status"]))
    L.append("")
    L.append("## 三、逐项命中率（命中判据 = AI 档位与金标准档位完全一致）")
    L.append("")
    L.append("| 评分点 | 可比项 | 命中 | 命中率 |")
    L.append("|---|---|---|---|")
    for it in items:
        L.append("| `%s` | %s | %s | %s |"
                 % (it["rubricItemId"], it["comparable"], it["hits"],
                    "-" if it["rate"] is None else "%.4f" % it["rate"]))
    L.append("")
    L.append("## 四、置信度校准（分桶阈值取自 `docs/contract.md` §八：0.60 / 0.80）")
    L.append("")
    L.append("| 桶 | 项数 | 平均置信度 | 实际正确率 | 校准差（正确率 − 置信度） |")
    L.append("|---|---|---|---|---|")
    for b in cal["buckets"]:
        L.append("| %s | %s | %s | %s | %s |"
                 % (b["bucket"], b["n"], b["meanConfidence"], b["accuracy"], b["calibrationGap"]))
    L.append("")
    L.append("ECE = %s；无 `confidence` 的项 %d 个（不参与校准计算）。"
             % (cal["ece"], cal["itemsWithoutConfidence"]))
    L.append("")
    if metrics["excluded"]:
        L.append("## 五、被排除的样本（未计入任何分母）")
        L.append("")
        L.append("| reportId | 原因 | 说明 |")
        L.append("|---|---|---|")
        for e in metrics["excluded"]:
            L.append("| %s | `%s` | %s |" % (e["reportId"] or "-", e["reason"], e["detail"]))
        L.append("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def run(results_dir: str, gold_path: str) -> tuple[dict, int, int]:
    """返回 (metrics, exit_code, skipped_count)。"""
    gold, gold_meta = load_gold(gold_path)
    results = scan_results(results_dir)
    rows, excluded = build_rows(gold, results)

    degraded = bool(gold_meta["degradedNoItemScores"])
    skipped: list = []
    if degraded:
        skipped.append("itemHitRates / levelAgreement / confidenceCalibration：金标准缺 expectedItemScores")

    per_item, flat = ({}, []) if degraded else comparable_pairs(gold, rows)
    item_hits, level_agreement = ([], {"comparable": 0, "hits": 0, "rate": None,
                                       "note": "金标准缺 expectedItemScores，本指标未计算"}) \
        if degraded else compute_item_hits(gold, per_item)
    calibration, _ = ({"ece": None, "buckets": [], "itemsWithoutConfidence": 0}, []) \
        if degraded else compute_calibration(flat)

    # 难度档顺序：取金标准 `reports[]` 中首次出现的次序（数据驱动，不写死枚举）
    tier_order: list = []
    for g in gold:
        t = g.get("tier")
        if t is not None and t not in tier_order:
            tier_order.append(t)

    metrics = {
        "tool": "evaluate",
        "contractSchemaVersion": SCHEMA_VERSION,
        "sources": {"results": os.path.abspath(results_dir), "gold": os.path.abspath(gold_path)},
        "goldMeta": gold_meta,
        "rows": [{k: v for k, v in r.items() if k != "_ai"} for r in rows],
        "mae": compute_mae(rows, tier_order),
        "itemHitRates": item_hits,
        "levelAgreement": level_agreement,
        "confidenceCalibration": calibration,
        "excluded": excluded,
        "skipped": skipped,
    }
    n_bad = sum(1 for r in rows if r["status"] != "ok")
    n_unmatched = sum(1 for e in excluded if e["reason"] == "unmatched-result-file")
    if degraded:
        code = 3
    elif n_bad or n_unmatched:
        code = 1
    else:
        code = 0
    return metrics, code, len(skipped)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="AutoGrader 一致性评测（Evaluation 层）")
    ap.add_argument("--results", help="AI 评阅结果目录（*.json）")
    ap.add_argument("--gold", help="教师金标准 manifest.json")
    ap.add_argument("--rubric", help="（可选）rubric.json，仅用于记录来源")
    ap.add_argument("--out", help="（可选）指标 JSON 写文件，缺省写标准输出")
    ap.add_argument("--report", help="（可选）人读 Markdown 报告写文件")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.results or not args.gold:
        print(json.dumps({"tool": "evaluate", "error": "need --results and --gold"},
                         ensure_ascii=False))
        return 2
    try:
        metrics, code, _ = run(args.results, args.gold)
    except BadInput as exc:
        print(json.dumps({"tool": "evaluate", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "evaluate", "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    payload = json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True)
    try:
        if args.out:
            with open(args.out, "w", encoding="utf-8", newline="\n") as f:
                f.write(payload + "\n")
        else:
            print(payload)
        if args.report:
            with open(args.report, "w", encoding="utf-8", newline="\n") as f:
                f.write(render_report(metrics))
    except OSError as exc:
        print(json.dumps({"tool": "evaluate", "error": "写输出失败：%s" % exc,
                          "kind": "output-error"}, ensure_ascii=False))
        return 2
    return code


# --------------------------------------------------------------------------- #
# 自测
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    import tempfile

    checks: dict[str, bool] = {}

    checks["jsRoundingParity"] = all(
        round2(v) == e for v, e in ((2.675, 2.68), (0.125, 0.13), (89.995, 89.99 + 0.01), (97.2, 97.2))
    )

    gold = {"rubricId": "rb", "rubricVersion": "1.0.0", "schemaVersion": "1.0.0",
            "reports": [
                {"id": "s1", "title": "A", "tier": "优", "goldTotalScore": 90,
                 "expectedItemScores": [
                     {"rubricItemId": "R1", "itemName": "项一", "level": "excellent"},
                     {"rubricItemId": "R2", "itemName": "项二", "level": "meeting"}]},
                {"id": "s2", "title": "B", "tier": "良", "goldTotalScore": 80,
                 "expectedItemScores": [
                     {"rubricItemId": "R1", "itemName": "项一", "level": "meeting"},
                     {"rubricItemId": "R2", "itemName": "项二", "level": "meeting"}]},
            ]}
    res = {
        "s1": {"schemaVersion": "1.2.0",
               "report": {"reportId": "s1", "title": "A", "course": "c", "studentCode": "x"},
               "totalScore": 88.0,
               "scores": [{"rubricItemId": "R1", "level": "excellent", "score": 10,
                           "confidence": 0.9, "needsReview": False},
                          {"rubricItemId": "R2", "level": "partial", "score": 5,
                           "confidence": 0.5, "needsReview": True}]},
        "s2": {"schemaVersion": "1.2.0",
               "report": {"reportId": "s2", "title": "B", "course": "c", "studentCode": "y"},
               "totalScore": 84.0,
               "scores": [{"rubricItemId": "R1", "level": "meeting", "score": 8,
                           "confidence": 0.7, "needsReview": False},
                          {"rubricItemId": "R2", "level": "meeting", "score": 8,
                           "confidence": 0.7, "needsReview": False}]},
    }
    with tempfile.TemporaryDirectory() as d:
        gp = os.path.join(d, "gold.json")
        with open(gp, "w", encoding="utf-8") as f:
            json.dump(gold, f, ensure_ascii=False)
        rd = os.path.join(d, "results")
        os.makedirs(rd)
        for k, v in res.items():
            with open(os.path.join(rd, "result-%s.json" % k), "w", encoding="utf-8") as f:
                json.dump(v, f, ensure_ascii=False)

        metrics, code, _ = run(rd, gp)
        # 偏差：s1 = |88-90| = 2；s2 = |84-80| = 4 → MAE = 3.00
        checks["maeValue"] = metrics["mae"]["mae"] == 3.0 and metrics["mae"]["count"] == 2
        checks["maeMaxAbs"] = (metrics["mae"]["maxAbsDelta"] == 4.0
                               and metrics["mae"]["maxAbsDeltaReportId"] == "s2")
        # 分组视图：档序取金标准中首次出现的次序（优 → 良），值仍用同一 MAE 公式
        checks["maeByTier"] = ([(t["tier"], t["count"], t["mae"]) for t in metrics["mae"]["byTier"]]
                               == [("优", 1, 2.0), ("良", 1, 4.0)])
        # 命中：R1 2/2；R2 1/2（s1 偏成 partial）→ 总体 3/4
        hits = {r["rubricItemId"]: r for r in metrics["itemHitRates"]}
        checks["itemHits"] = (hits["R1"]["rate"] == 1.0 and hits["R1"]["comparable"] == 2
                              and hits["R2"]["rate"] == 0.5)
        # 评分点名称必须从金标准带出（不得因内部转换而丢成 null）
        checks["itemNameCarried"] = (hits["R1"]["itemName"] == "项一"
                                     and hits["R2"]["itemName"] == "项二")
        checks["levelAgreement"] = (metrics["levelAgreement"]["rate"] == 0.75
                                    and metrics["levelAgreement"]["hits"] == 3
                                    and metrics["levelAgreement"]["comparable"] == 4)
        # 校准（分桶阈值取自契约 `docs/contract.md` §八：<0.60 low / [0.60,0.80) medium / ≥0.80 high）
        #   low    conf 0.5 ×1（判错） → acc 0.00、gap −0.50
        #   medium conf 0.7 ×2（全对） → acc 1.00、gap +0.30
        #   high   conf 0.9 ×1（判对） → acc 1.00、gap +0.10
        #   ECE = 1/4×0.50 + 2/4×0.30 + 1/4×0.10 = 0.30
        cal = {b["bucket"]: b for b in metrics["confidenceCalibration"]["buckets"]}
        checks["calibrationBuckets"] = (
            cal["low"]["n"] == 1 and cal["low"]["accuracy"] == 0.0
            and cal["low"]["calibrationGap"] == -0.5
            and cal["medium"]["n"] == 2 and cal["medium"]["accuracy"] == 1.0
            and cal["medium"]["calibrationGap"] == 0.3
            and cal["high"]["n"] == 1 and cal["high"]["accuracy"] == 1.0
            and cal["high"]["calibrationGap"] == 0.1)
        checks["calibrationEce"] = metrics["confidenceCalibration"]["ece"] == 0.30
        checks["cleanRunIsZero"] = code == 0 and not metrics["excluded"]

        # 缺一份结果 → status missing、MAE 只用 ok 行、退出码 1、进 excluded
        os.remove(os.path.join(rd, "result-s2.json"))
        m2, c2, _ = run(rd, gp)
        checks["missingIsExit1"] = (c2 == 1 and m2["mae"]["count"] == 1 and m2["mae"]["mae"] == 2.0
                                    and any(e["reason"] == "missing-result" for e in m2["excluded"]))
        checks["missingNotCountedInDenominator"] = m2["levelAgreement"]["comparable"] == 2

        # 结果形状非法 → invalid + 退出码 1（不得抛异常、不得静默当 ok）
        with open(os.path.join(rd, "result-s2.json"), "w", encoding="utf-8") as f:
            json.dump({"report": {"reportId": "s2"}, "totalScore": "88"}, f)
        m3, c3, _ = run(rd, gp)
        checks["invalidIsExit1"] = (c3 == 1
                                    and any(r["status"] == "invalid" for r in m3["rows"])
                                    and any(e["reason"] == "invalid-result" for e in m3["excluded"]))

        # 金标准缺 expectedItemScores → 降级 exit 3，且 skipped 逐条列出（对齐 T5 的 P1-11 纪律）
        g2 = json.loads(json.dumps(gold))
        for r in g2["reports"]:
            del r["expectedItemScores"]
        gp2 = os.path.join(d, "gold2.json")
        with open(gp2, "w", encoding="utf-8") as f:
            json.dump(g2, f, ensure_ascii=False)
        m4, c4, n_skip = run(rd, gp2)
        checks["degradedIsExit3"] = c4 == 3 and n_skip >= 1 and m4["confidenceCalibration"]["ece"] is None

        # 目录不存在 → BadInput（→ exit 2），不得裸 traceback
        try:
            run(os.path.join(d, "__nope__"), gp)
            checks["missingDirRaisesBadInput"] = False
        except BadInput:
            checks["missingDirRaisesBadInput"] = True

        # 报告可渲染且含四项指标标题
        md = render_report(m2)
        checks["reportRenders"] = all(k in md for k in ("总分 MAE", "逐项命中率", "置信度校准"))

    # 与契约实现逐值对齐（就地实现 + 对齐校验，防两侧分叉；找不到契约时记 False 而非静默通过）
    fp_path = _find_contract_file("fingerprint.py")
    if fp_path:
        spec = importlib.util.spec_from_file_location("_c_fp", fp_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        vals = [0.0, 2.675, 0.125, 89.995, 97.2, 100.0, 1.005, 0.1 + 0.2, 0.67, 0.75]
        checks["round2MatchesContract"] = all(round2(v) == mod.js_round2(v) for v in vals)
    else:
        checks["round2MatchesContract"] = False

    bad = [k for k, v in checks.items() if not v]
    print(json.dumps({"tool": "evaluate", "checks": checks}, ensure_ascii=False,
                     indent=2, sort_keys=True))
    return 0 if not bad else 1


def _find_contract_file(name: str) -> str | None:
    cur = os.path.dirname(os.path.abspath(__file__))
    for _ in range(7):
        cand = os.path.join(cur, "contract", name)
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent
    return None


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
