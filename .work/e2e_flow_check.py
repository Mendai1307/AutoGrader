#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性核对脚本（非交付物）：按设计的工具链流程端到端实跑。

流程：T1 解析 docx → T2 客观核查 → T3 引用解析 → T4 总分 → T5 契约校验。
并专门验证一处怀疑：T4 产出的 `total.grade`（A/B/C/D/F）能否通过冻结的
`contract/ReviewResult.schema.json`（其 grade 用的是 ScoreLevel 枚举）。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts")
DOCX = os.path.join(ROOT, "AutoGrader 项目目标定义书_v1.1.docx")
OUT = os.path.join(ROOT, ".work", "e2e_flow")
os.makedirs(OUT, exist_ok=True)

PY = sys.executable


def call(script, *args):
    p = subprocess.run([PY, os.path.join(SCRIPTS, script)] + list(args),
                       capture_output=True)
    out = p.stdout.decode("utf-8", "replace")
    try:
        return p.returncode, json.loads(out)
    except Exception:
        return p.returncode, {"_raw": out[:400], "_err": p.stderr.decode("utf-8", "replace")[:400]}


def show(tag, code, doc, keys):
    print("[%s] exit=%d %s" % (tag, code, {k: doc.get(k) for k in keys}))


# ---- T1 ------------------------------------------------------------------
t1_path = os.path.join(OUT, "t1.json")
code, t1 = call("document_parser.py", "--input", DOCX, "--out", t1_path)
show("T1", code, t1, ["status", "emptyHeadingParagraphs"])
print("     headings=%d blocks=%d failures=%d"
      % (len(t1.get("structure") or []), len(t1.get("blocks") or []),
         len(t1.get("failures") or [])))
print("     summary=%s" % (t1.get("summary"),))

# ---- T2 ------------------------------------------------------------------
code, t2 = call("rule_inspector.py", "--report", t1_path)
show("T2", code, t2, ["notCovered", "notCoveredReasons"])
print("     facts=%d  reportIntegrity.summaryConsistent=%s"
      % (len(t2.get("facts") or []), (t2.get("reportIntegrity") or {}).get("summaryConsistent")))
for f in (t2.get("facts") or [])[:6]:
    print("       - %s | %s" % (f["ruleId"], f["fact"]))

# ---- T3 ------------------------------------------------------------------
blocks = t1.get("blocks") or []
text_blocks = [b for b in blocks if b.get("kind") == "text"]
sample = text_blocks[0] if text_blocks else {}
cands = {"items": [
    {"pointId": "R1", "blockId": sample.get("blockId")},
    {"pointId": "R2", "anchor": "999.999"},
    {"pointId": "R3", "quote": "这句在报告里不存在，用来触发 quote-mismatch"},
]}
c_path = os.path.join(OUT, "cands.json")
with open(c_path, "w", encoding="utf-8") as f:
    json.dump(cands, f, ensure_ascii=False)
code, t3 = call("citation_resolver.py", "--report", t1_path, "--candidates", c_path)
show("T3", code, t3, ["summary"])
print("     reasons=%s" % sorted({r["reason"] for r in (t3.get("rejected") or [])}))
print("     resolved keys=%s" % sorted((t3.get("resolved") or [{}])[0].keys()))

# ---- T4（满权重、非 pending → 会产出档位名 A/B/C/D/F）--------------------
payload = {"scores": [
    {"rubricItemId": "R1", "itemName": "a", "score": 9, "maxScore": 10, "weight": 60,
     "pending": False, "confidence": 0.9, "needsReview": False},
    {"rubricItemId": "R2", "itemName": "b", "score": 8, "maxScore": 10, "weight": 40,
     "pending": False, "confidence": 0.9, "needsReview": False},
]}
t4_in = os.path.join(OUT, "t4.json")
with open(t4_in, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)
code, t4 = call("deterministic_calculator.py", "--input", t4_in, "--mode", "total")
show("T4", code, t4, ["total", "weightIncluded", "weightExcluded", "upperBound",
                      "isPartial", "grade", "gradeNote"])

# ---- T5：用 T4 的 grade 组装一份完整 ReviewResult，看冻结 schema 收不收 ----
result = {
    "schemaVersion": "1.1.0",
    "taskType": "review",
    "report": {"reportId": "r-001", "title": "t", "course": "c", "studentCode": "S1"},
    "rubricVersion": "1.0.0",
    "rubric": {"id": "rb", "version": "1.0.0", "title": "rb", "items": [
        {"id": "R1", "name": "a", "weight": 60, "maxScore": 10,
         "evidenceRequirement": "e", "deductionNotes": "d",
         "levels": [{"level": "excellent", "label": "优秀", "criterion": "c1", "scoreRatio": 1.0},
                    {"level": "meeting", "label": "达标", "criterion": "c2", "scoreRatio": 0.8},
                    {"level": "partial", "label": "部分达标", "criterion": "c3", "scoreRatio": 0.5},
                    {"level": "notMet", "label": "未达标", "criterion": "c4", "scoreRatio": 0.0}]},
        {"id": "R2", "name": "b", "weight": 40, "maxScore": 10,
         "evidenceRequirement": "e", "deductionNotes": "d",
         "levels": [{"level": "excellent", "label": "优秀", "criterion": "c1", "scoreRatio": 1.0},
                    {"level": "meeting", "label": "达标", "criterion": "c2", "scoreRatio": 0.8},
                    {"level": "partial", "label": "部分达标", "criterion": "c3", "scoreRatio": 0.5},
                    {"level": "notMet", "label": "未达标", "criterion": "c4", "scoreRatio": 0.0}]}]},
    "scores": [
        {"rubricItemId": "R1", "itemName": "a", "weight": 60, "maxScore": 10,
         "level": "excellent", "levelScoreRatio": 1.0, "score": 9,
         "suggestedScore": 9, "overriddenByTeacher": False, "deductionReason": "x",
         "evidence": [{"id": "E1", "kind": "text",
                       "location": {"section": "1.1"}, "quote": "q",
                       "confidence": 0.9, "citationValid": True}],
         "confidence": 0.9, "needsReview": False, "pending": False},
        {"rubricItemId": "R2", "itemName": "b", "weight": 40, "maxScore": 10,
         "level": "meeting", "levelScoreRatio": 0.8, "score": 8,
         "suggestedScore": 8, "overriddenByTeacher": False, "deductionReason": "y",
         "evidence": [{"id": "E2", "kind": "text",
                       "location": {"section": "1.2"}, "quote": "q2",
                       "confidence": 0.9, "citationValid": True}],
         "confidence": 0.9, "needsReview": False, "pending": False}],
    "totalScore": t4["total"],
    "total": {"weightIncluded": t4["weightIncluded"], "weightExcluded": t4["weightExcluded"],
              "upperBound": t4["upperBound"], "isPartial": t4["isPartial"],
              "grade": t4["grade"]},
    "review": {"triggered": False, "triggerReason": None, "opinion": "ok",
               "overallConfidenceBefore": 0.9, "overallConfidenceAfter": 0.9,
               "adjustments": []},
    "feedback": {"overall": "o", "strengths": ["s"], "improvements": ["i"], "tone": "neutral"},
    "steps": [{"step": 1, "agent": "parser", "inputSummary": "i", "outputSummary": "o",
               "confidence": 0.9}],
    "provenance": {"generatorAgent": "AutoGrader Expert", "generatedAt": "2026-09-25T23:00:00+08:00",
                   "sourceConversationId": "x", "resultFingerprint": "", "schemaVersion": "1.1.0"},
}
# 用契约指纹算法盖上真实指纹
import importlib.util
spec = importlib.util.spec_from_file_location("fp", os.path.join(ROOT, "contract", "fingerprint.py"))
fpmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fpmod)
result["provenance"]["resultFingerprint"] = fpmod.fingerprint(result)

r_path = os.path.join(OUT, "result_1_1_0.json")
with open(r_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

code, t5 = call("contract_validator.py", "--kind", "review-result", "--input", r_path)
show("T5", code, t5, ["valid", "exitReason", "degraded", "skipped"])
print("     checks=%s" % [(c["check"], c["status"]) for c in (t5.get("checks") or [])])
for e in (t5.get("errors") or []):
    print("       ERR %s @ %s expected=%r actual=%r"
          % (e["code"], e["jsonPath"], e["expected"], e["actual"]))
print("     schemaPath=%s" % t5.get("schemaPath"))
