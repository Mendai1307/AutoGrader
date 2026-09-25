#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读统计 v0.1 的 12 份 result-sample 资产结构，为契约冻结的迁移不变性提供事实基础。

用法：python analyze_assets.py <results_dir>
不写任何文件，不修改被读对象。
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

TOP_KEYS = {
    "schemaVersion", "report", "rubricVersion", "rubric", "scores",
    "totalScore", "review", "feedback", "steps", "provenance",
}
SCORE_KEYS = {
    "rubricItemId", "itemName", "weight", "maxScore", "level", "levelScoreRatio",
    "score", "deductionReason", "evidence", "confidence", "needsReview",
}


def main(argv: list[str]) -> int:
    d = argv[0]
    files = sorted(
        f for f in os.listdir(d)
        if f.startswith("result-sample-") and f.endswith(".json")
    )
    print("资产数量 =", len(files))
    print()

    rows = []
    unknown_top = Counter()
    unknown_score = Counter()
    for fn in files:
        with open(os.path.join(d, fn), "r", encoding="utf-8") as fh:
            r = json.load(fh)
        scores = r["scores"]
        wsum = round(sum(s["weight"] for s in scores), 4)
        total = r["totalScore"]
        recomputed = round(sum(s["score"] / s["maxScore"] * s["weight"] for s in scores), 2)
        n_ev_empty = sum(1 for s in scores if not s.get("evidence"))
        n_need = sum(1 for s in scores if s.get("needsReview"))
        n_above = sum(1 for s in scores if s["score"] > s["maxScore"])
        prov = r["provenance"]
        unknown_top.update(set(r.keys()) - TOP_KEYS)
        for s in scores:
            unknown_score.update(set(s.keys()) - SCORE_KEYS)
        rows.append({
            "file": fn,
            "sv": r["schemaVersion"],
            "prov_sv": prov.get("schemaVersion"),
            "items": len(scores),
            "wsum": wsum,
            "total": total,
            "recalc": recomputed,
            "delta": round(abs(total - recomputed), 4),
            "ev_empty": n_ev_empty,
            "needsReview": n_need,
            "score_gt_max": n_above,
            "has_rubric": "rubric" in r,
            "levels_of_rubric_item": (
                len(r["rubric"]["items"][0]["levels"]) if "rubric" in r else None
            ),
            "fp": prov.get("resultFingerprint"),
            "conv": prov.get("sourceConversationId"),
            "turn": prov.get("sourceTurnId"),
        })

    print("file           sv     provSV 项 权重和   总分    复算    delta ev空 need >max rubric levels fp")
    for x in rows:
        print("%-13s %-6s %-6s %2d %7.2f %7.2f %7.2f %6.4f %4d %4d %4d %-6s %-6s %s" % (
            x["file"].replace("result-sample-", "s").replace(".json", ""),
            x["sv"], x["prov_sv"], x["items"], x["wsum"], x["total"], x["recalc"],
            x["delta"], x["ev_empty"], x["needsReview"], x["score_gt_max"],
            "Y" if x["has_rubric"] else "N",
            str(x["levels_of_rubric_item"]), (x["fp"] or "")[:18],
        ))

    print()
    print("权重和非 100 的文件 =", [x["file"] for x in rows if abs(x["wsum"] - 100) > 0.01])
    print("总分复算超容差的文件 =", [x["file"] for x in rows if x["delta"] > 0.01])
    print("schemaVersion 取值 =", sorted({x["sv"] for x in rows}))
    print("provenance.schemaVersion 与顶层不一致的 =", [x["file"] for x in rows if x["sv"] != x["prov_sv"]])
    print("逐项数组长度分布 =", sorted({x["items"] for x in rows}))
    print("needsReview=true 总数 =", sum(x["needsReview"] for x in rows))
    print("evidence 为空数组的项数 =", sum(x["ev_empty"] for x in rows))
    print("score > maxScore 的项数 =", sum(x["score_gt_max"] for x in rows))
    print("顶层未知字段 =", dict(unknown_top) or "无")
    print("ScoreItem 未知字段 =", dict(unknown_score) or "无")
    print("sourceConversationId 非空计数 =", sum(1 for x in rows if x["conv"]))
    print("sourceTurnId 存在的计数 =", sum(1 for x in rows if x["turn"]))
    print("指纹样例 =", rows[0]["fp"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
