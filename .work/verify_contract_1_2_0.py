#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性核对脚本（非交付物）：契约 1.2.0 修订的回归验证。

三项：
  A) 六脚本自测（61 项）
  B) 定向用例：T4 满权重产出 grade='A' 的完整结果 → T5 必须 exit 0 六项全过
  C) 12 份历史资产（v0.1 同级目录）在**随包契约**下重跑 → 必须 12/12 通过且 skipped 为空；
     并用契约指纹算法逐一复算，与声明值相等
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts")
V01 = os.path.normpath(os.path.join(ROOT, "..", "AutoGrader", "frontend", "public", "results"))
PY = sys.executable


def run(script, *args):
    p = subprocess.run([PY, os.path.join(S, script)] + list(args), capture_output=True)
    txt = p.stdout.decode("utf-8", "replace")
    try:
        return p.returncode, json.loads(txt)
    except Exception:
        return p.returncode, {"_raw": txt[:300]}


# ---- A) 自测 ---------------------------------------------------------------
tot = 0
bad = []
for f in ("document_parser", "rule_inspector", "citation_resolver",
          "deterministic_calculator", "contract_validator", "asset_store"):
    code, d = run(f + ".py", "--self-test")
    checks = d.get("checks") or {}
    tot += len(checks)
    bad += ["%s:%s" % (f, k) for k, v in checks.items() if not v]
print("A) 六脚本自测：%d 项，失败 %d 项 %s" % (tot, len(bad), bad or ""))

# ---- B) 定向用例：grade 值域 ------------------------------------------------
res = os.path.join(ROOT, ".work", "e2e_flow", "result_grade_A.json")
code, t5 = run("contract_validator.py", "--kind", "review-result", "--input", res)
print("B) grade='A' 的完整结果 → T5 exit=%d valid=%s exitReason=%s errors=%s skipped=%s"
      % (code, t5.get("valid"), t5.get("exitReason"),
         [(e["code"], e["jsonPath"]) for e in (t5.get("errors") or [])],
         t5.get("skipped")))
print("   checks=%s" % [(c["check"], c["status"]) for c in (t5.get("checks") or [])])

# ---- C) 12 份历史资产回归 ---------------------------------------------------
print("C) 历史资产回归（目录：%s）" % V01)
if not os.path.isdir(V01):
    print("   ⚠️ 找不到 v0.1 资产目录，跳过")
else:
    files = sorted(f for f in os.listdir(V01)
                   if f.startswith("result-sample-") and f.endswith(".json"))
    ok_t5 = ok_fp = 0
    for name in files:
        path = os.path.join(V01, name)
        c5, d5 = run("contract_validator.py", "--kind", "review-result", "--input", path)
        good5 = (c5 == 0 and not (d5.get("errors") or []) and not (d5.get("skipped") or []))
        ok_t5 += 1 if good5 else 0
        p = subprocess.run([PY, os.path.join(ROOT, "contract", "fingerprint.py"),
                            "--input", path, "--check"], capture_output=True)
        try:
            dfp = json.loads(p.stdout.decode("utf-8", "replace"))
        except Exception:
            dfp = {}
        goodfp = (p.returncode == 0 and dfp.get("match") is True)
        ok_fp += 1 if goodfp else 0
        if not (good5 and goodfp):
            print("   !! %s T5(exit=%d,err=%d,skip=%d) fp(exit=%d,match=%s)"
                  % (name, c5, len(d5.get("errors") or []), len(d5.get("skipped") or []),
                     p.returncode, dfp.get("match")))
    print("   T5 六项全过：%d/%d ｜ 指纹复算相符：%d/%d" % (ok_t5, len(files), ok_fp, len(files)))
