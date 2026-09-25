#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构造一份契约 1.1.0 形状的 ReviewResult，用于验证冻结新增机制（不是只验历史资产）。

覆盖的新增字段与不变式：
  taskType / rubricRef / total / reviewMeta / doubts / reviewChecklist / selfCheck
  scores[].pending（含 score=null）/ suggestedScore / overriddenByTeacher
  evidence[].citationValid / blockRef
  I6 / I7 / I8 / I9 / I10 / I11 / I12

用法：python make_1_1_0.py <源资产 1.0.0.json> <输出 1.1.0.json>
只读源资产；只写输出文件。
"""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts"))

import deterministic_calculator as T4  # noqa: E402


def load_fingerprint():
    spec = importlib.util.spec_from_file_location(
        "contract_fp", os.path.join(ROOT, "contract", "fingerprint.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str]) -> int:
    src, dst = argv[0], argv[1]
    fp = load_fingerprint()

    with open(src, "r", encoding="utf-8") as f:
        doc = json.load(f)
    doc = copy.deepcopy(doc)

    doc["schemaVersion"] = "1.1.0"
    doc["provenance"]["schemaVersion"] = "1.1.0"
    doc["taskType"] = "review"
    doc["rubricRef"] = {"id": doc["rubric"]["id"], "digest": fp.fingerprint(doc["rubric"])}

    scores = doc["scores"]
    # I7：教师改过终值 → 必须保留 AI 建议分，且建议分 ≠ 终值
    scores[0]["suggestedScore"] = round(max(0.0, scores[0]["score"] - 2.0), 2)
    scores[0]["overriddenByTeacher"] = True
    # I6：pending ⟹ needsReview，且 score 允许为 null
    last = scores[-1]
    last["pending"] = True
    last["needsReview"] = True
    last["score"] = None

    # 证据新增字段
    for s in scores:
        for e in s["evidence"]:
            e["citationValid"] = True
            e["blockRef"] = {"blockId": "b%05d" % (abs(hash(e["id"])) % 99999),
                             "anchor": e["location"].get("section", "1.1"),
                             "digest": "sha256:" + "0" * 64}

    # 用 T4 算 total（部分分 + W_r + 上界）
    out, _ = T4.run({"scores": scores}, "total", T4.DEFAULT_BANDS)
    doc["totalScore"] = out["total"]
    doc["total"] = {
        "weightIncluded": out["weightIncluded"],
        "weightExcluded": out["weightExcluded"],
        "upperBound": out["upperBound"],
        "isPartial": out["isPartial"],
        "grade": out["grade"],
    }
    doc["reviewMeta"] = {"mode": "teacher-participated", "status": "draft"}
    doc["doubts"] = [{"rubricItemId": last["rubricItemId"],
                      "detail": "该项证据不足以落档，已标待复核", "kind": "evidence-missing"}]
    doc["reviewChecklist"] = [{"rubricItemId": last["rubricItemId"],
                               "confidence": last["confidence"],
                               "rankKey": round((1 - last["confidence"]) * last["weight"], 6),
                               "pending": True}]
    doc["selfCheck"] = {"schema": "pass", "recompute": "pass", "fingerprint": "pass",
                        "skipped": [], "errors": []}
    doc["provenance"]["resultFingerprint"] = fp.fingerprint(doc)

    with open(dst, "w", encoding="utf-8") as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "src": src, "dst": dst,
        "totalScore": doc["totalScore"], "total": doc["total"],
        "pendingItem": last["rubricItemId"],
        "overriddenItem": scores[0]["rubricItemId"],
        "fingerprint": doc["provenance"]["resultFingerprint"],
    }, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
