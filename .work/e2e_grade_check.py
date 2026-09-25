#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性核对脚本（非交付物）：精确复现「T4 产出的 grade 过不了冻结 schema」。

用例完全自洽：每项 score = maxScore × levelScoreRatio，权重和 = 100，
非 pending，故 T4 会映射等级；指纹用契约算法真实回填。
预期：除 `total.grade` 外无其它错误。
"""
import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts")
OUT = os.path.join(ROOT, ".work", "e2e_flow")
os.makedirs(OUT, exist_ok=True)
PY = sys.executable


def call(script, *args):
    p = subprocess.run([PY, os.path.join(SCRIPTS, script)] + list(args), capture_output=True)
    try:
        return p.returncode, json.loads(p.stdout.decode("utf-8", "replace"))
    except Exception:
        return p.returncode, {}


LEVELS = [{"level": "excellent", "label": "优秀", "criterion": "c1", "scoreRatio": 1.0},
          {"level": "meeting", "label": "达标", "criterion": "c2", "scoreRatio": 0.8},
          {"level": "partial", "label": "部分达标", "criterion": "c3", "scoreRatio": 0.5},
          {"level": "notMet", "label": "未达标", "criterion": "c4", "scoreRatio": 0.0}]
ITEMS = [("R1", "a", 60, 10, "excellent", 1.0, 10),
         ("R2", "b", 40, 10, "meeting", 0.8, 8)]

t4_in = os.path.join(OUT, "t4_clean.json")
with open(t4_in, "w", encoding="utf-8") as f:
    json.dump({"scores": [{"rubricItemId": i, "itemName": n, "weight": w, "maxScore": m,
                           "score": s, "pending": False, "confidence": 0.9,
                           "needsReview": False}
                          for i, n, w, m, _lv, _r, s in ITEMS]}, f, ensure_ascii=False)
code, t4 = call("deterministic_calculator.py", "--input", t4_in, "--mode", "total")
print("[T4] exit=%d total=%s weightIncluded=%s isPartial=%s grade=%r"
      % (code, t4.get("total"), t4.get("weightIncluded"), t4.get("isPartial"), t4.get("grade")))

result = {
    "schemaVersion": "1.1.0", "taskType": "review",
    "report": {"reportId": "r-001", "title": "t", "course": "c", "studentCode": "S1"},
    "rubricVersion": "1.0.0",
    "rubric": {"id": "rb", "version": "1.0.0", "title": "rb",
               "items": [{"id": i, "name": n, "weight": w, "maxScore": m,
                          "evidenceRequirement": "e", "deductionNotes": "d", "levels": LEVELS}
                         for i, n, w, m, _lv, _r, _s in ITEMS]},
    "scores": [{"rubricItemId": i, "itemName": n, "weight": w, "maxScore": m,
                "level": lv, "levelScoreRatio": r, "score": s,
                "suggestedScore": s, "overriddenByTeacher": False,
                "deductionReason": None if s == m else "扣分",
                "evidence": [{"id": "E1", "kind": "text", "location": {"section": "1.1"},
                              "quote": "q", "confidence": 0.9, "citationValid": True}],
                "confidence": 0.9, "needsReview": False, "pending": False}
               for i, n, w, m, lv, r, s in ITEMS],
    "totalScore": t4["total"],
    "total": {"weightIncluded": t4["weightIncluded"], "weightExcluded": t4["weightExcluded"],
              "upperBound": t4["upperBound"], "isPartial": t4["isPartial"],
              "grade": t4["grade"]},
    "review": {"triggered": False, "triggerReason": None, "opinion": "ok",
               "overallConfidenceBefore": 0.9, "overallConfidenceAfter": 0.9, "adjustments": []},
    "feedback": {"overall": "o", "strengths": ["s"], "improvements": ["i"], "tone": "neutral"},
    "steps": [{"step": 1, "agent": "parser", "inputSummary": "i", "outputSummary": "o",
               "confidence": 0.9}],
    "provenance": {"generatorAgent": "AutoGrader Expert",
                   "generatedAt": "2026-09-25T23:00:00+08:00",
                   "sourceConversationId": "x", "resultFingerprint": "",
                   "schemaVersion": "1.1.0"},
}
spec = importlib.util.spec_from_file_location(
    "fp", os.path.join(ROOT, "contract", "fingerprint.py"))
fpmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fpmod)
result["provenance"]["resultFingerprint"] = fpmod.fingerprint(result)

for tag, gval in (("grade=%r（T4 原样）" % t4["grade"], t4["grade"]),
                  ("grade=None（把等级抹掉）", None)):
    doc = json.loads(json.dumps(result))
    doc["total"]["grade"] = gval if tag.startswith("grade=None") else gval
    doc["provenance"]["resultFingerprint"] = fpmod.fingerprint(doc)
    p = os.path.join(OUT, "result_grade_%s.json" % ("none" if gval is None else gval))
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    code, t5 = call("contract_validator.py", "--kind", "review-result", "--input", p)
    print("[T5] %-28s exit=%d exitReason=%s errors=%s"
          % (tag, code, t5.get("exitReason"),
             [(e["code"], e["jsonPath"]) for e in (t5.get("errors") or [])]))
