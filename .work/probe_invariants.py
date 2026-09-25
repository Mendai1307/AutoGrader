#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读核查 12 份资产对「候选检查项」的满足情况，用于判定 T5 的检查清单能否做到契约忠实。

用法：python probe_invariants.py <results_dir>
不写任何文件。
"""
from __future__ import annotations

import json
import os
import sys


def round2(v: float) -> float:
    import math
    return math.floor(v * 100 + 0.5) / 100


def main(argv: list[str]) -> int:
    d = argv[0]
    files = sorted(f for f in os.listdir(d) if f.startswith("result-sample-") and f.endswith(".json"))

    bad_item_score: list[str] = []
    bad_needs_review: list[str] = []
    ev_empty_high_conf: list[str] = []
    rubric_wsum_bad: list[str] = []
    id_mismatch: list[str] = []
    levels_dup: list[str] = []
    levels_nonmono: list[str] = []
    levels_empty_crit: list[str] = []
    level_not_in_rubric: list[str] = []
    ratio_mismatch: list[str] = []
    score_zero_with_ratio: list[str] = []

    for fn in files:
        with open(os.path.join(d, fn), "r", encoding="utf-8") as fh:
            r = json.load(fh)
        tag = fn.replace("result-sample-", "s").replace(".json", "")
        scores = r["scores"]

        rubric = r.get("rubric")
        if rubric:
            ws = round(sum(i["weight"] for i in rubric["items"]), 4)
            if abs(ws - 100) > 0.01:
                rubric_wsum_bad.append("%s=%s" % (tag, ws))
            rmap = {i["id"]: i for i in rubric["items"]}
            if set(rmap) != {s["rubricItemId"] for s in scores}:
                id_mismatch.append(tag)
            for it in rubric["items"]:
                lv = it["levels"]
                lvs = [x["level"] for x in lv]
                if len(set(lvs)) != len(lvs):
                    levels_dup.append("%s/%s" % (tag, it["id"]))
                ratios = [x["scoreRatio"] for x in lv]
                if ratios != sorted(ratios, reverse=True):
                    levels_nonmono.append("%s/%s=%s" % (tag, it["id"], ratios))
                if any(not x.get("criterion") for x in lv):
                    levels_empty_crit.append("%s/%s" % (tag, it["id"]))

        for s in scores:
            pid = s["rubricItemId"]
            # 契约级：score <= maxScore
            # 派生级：score == round2(maxScore * levelScoreRatio)
            if abs(s["score"] - round2(s["maxScore"] * s["levelScoreRatio"])) > 0.01:
                bad_item_score.append("%s/%s score=%s max*ratio=%s" % (
                    tag, pid, s["score"], round2(s["maxScore"] * s["levelScoreRatio"])))
            # needsReview 与 confidence 的关系（v0.1 注释：confidence<0.80 即应 needsReview）
            if s["confidence"] < 0.8 and not s["needsReview"]:
                bad_needs_review.append("%s/%s conf=%s" % (tag, pid, s["confidence"]))
            if not s["evidence"] and s["confidence"] >= 0.8:
                ev_empty_high_conf.append("%s/%s conf=%s need=%s" % (
                    tag, pid, s["confidence"], s["needsReview"]))
            if rubric and pid in rmap:
                ok = {x["level"] for x in rmap[pid]["levels"]}
                if s["level"] not in ok:
                    level_not_in_rubric.append("%s/%s" % (tag, pid))
                for x in rmap[pid]["levels"]:
                    if x["level"] == s["level"] and abs(x["scoreRatio"] - s["levelScoreRatio"]) > 0.001:
                        ratio_mismatch.append("%s/%s rubric=%s item=%s" % (
                            tag, pid, x["scoreRatio"], s["levelScoreRatio"]))
            if s["levelScoreRatio"] > 0 and s["score"] == 0:
                score_zero_with_ratio.append("%s/%s" % (tag, pid))

    def show(name: str, xs: list[str]) -> None:
        print("%-46s %s %s" % (name, len(xs), xs[:4] if xs else ""))

    show("权重和 != 100（内嵌 rubric）", rubric_wsum_bad)
    show("rubricItemId 集合与 rubric 不一致", id_mismatch)
    show("levels 内 level 重复", levels_dup)
    show("levels 内 scoreRatio 非降序", levels_nonmono)
    show("levels 内 criterion 为空", levels_empty_crit)
    show("score != round2(maxScore*levelScoreRatio)", bad_item_score)
    show("confidence<0.8 但 needsReview=false", bad_needs_review)
    show("evidence 为空且 confidence>=0.8", ev_empty_high_conf)
    show("score 档位不在 rubric 档位集内", level_not_in_rubric)
    show("score 的 levelScoreRatio 与 rubric 档位系数不一致", ratio_mismatch)
    show("levelScoreRatio>0 但 score=0", score_zero_with_ratio)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
