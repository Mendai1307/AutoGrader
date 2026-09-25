#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性核对脚本（非交付物）：回读新生成的 docx，逐条验证改动面与未改项。

判据：
  1. 应存在的新表述 —— 必须命中
  2. 应清除的旧表述 —— 必须零命中
  3. 应保留的对照项 —— 必须仍在（含 v1.0 原稿）
  4. 标题数 / 状态不得劣化
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T1 = os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools",
                  "scripts", "document_parser.py")


def parse(path):
    p = subprocess.run([sys.executable, T1, "--input", path], capture_output=True)
    return json.loads(p.stdout.decode("utf-8"))


def all_text(doc):
    parts = []
    for b in doc.get("blocks") or []:
        parts.append(b.get("text") or "")
    return "\n".join(parts)


GOAL = os.path.join(ROOT, "AutoGrader 项目目标定义书_v1.1.docx")
GOAL_V10 = os.path.join(ROOT, "AutoGrader 项目目标定义书_v1.0.docx")
PLAN = os.path.join(ROOT, "AutoGrader 步骤路径规划书_v1.1.docx")
PLAN_V10 = os.path.join(ROOT, "AutoGrader 步骤路径规划书_v1.0.docx")

g, g10, p, p10 = parse(GOAL), parse(GOAL_V10), parse(PLAN), parse(PLAN_V10)
gt, g10t, pt, p10t = all_text(g), all_text(g10), all_text(p), all_text(p10)

print("== 解析状态 / 标题数 ==")
for tag, d in (("目标定义书 v1.1", g), ("目标定义书 v1.0", g10),
               ("规划书 v1.1", p), ("规划书 v1.0", p10)):
    print("  %-16s status=%-7s headings=%2d failures=%d"
          % (tag, d["status"], d["summary"]["headings"], len(d["failures"])))

checks = {}

# ---- 1. 应存在的新表述 -----------------------------------------------------
checks["目标定义书_新号I1"] = "I1" in gt and "五 Agent 评阅流水线" in gt
checks["目标定义书_新号I5"] = "I5" in gt
checks["目标定义书_范围失控风险"] = "范围失控风险" in gt
checks["规划书_新号M1"] = "M1" in pt and "JSON 骨架先行" in pt
checks["规划书_新号M6"] = "M6" in pt and "评测集回归" in pt

# ---- 2. 应清除的旧表述 -----------------------------------------------------
checks["目标定义书_旧T号已清"] = "\nT1 |" not in gt and "\nT5 |" not in gt
checks["规划书_旧S号已清"] = "\nS1 |" not in pt and "\nS6 |" not in pt
checks["目标定义书_36小时风险已清"] = "控制 36 小时风险" not in gt

# ---- 3. 应保留的对照项 -----------------------------------------------------
checks["目标定义书_§4.3的A1A5仍在"] = "A1" in gt and "构建形态 A" in gt
checks["目标定义书_版本说明的36小时压力保留"] = "36 小时压力" in gt
checks["目标定义书_六项检查保留"] = "六项检查" in gt or "工具链六项" in gt
checks["规划书_三模式总览保留"] = "三模式总览" in pt
checks["规划书_六项检查保留"] = "六项检查" in pt
checks["规划书_完整Rubric式S号仍在(§1.2)"] = "S7 复核与解释" in pt

# ---- 4. v1.0 原稿未被动过 --------------------------------------------------
checks["v1.0目标定义书_仍是旧T号"] = "\nT1 |" in g10t and "\nT5 |" in g10t
checks["v1.0目标定义书_仍有36小时风险"] = "36 小时风险" in g10t
checks["v1.0规划书_仍是旧S号"] = "\nS1 |" in p10t and "\nS6 |" in p10t

bad = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print("  %s %s" % ("PASS" if v else "FAIL", k))
print("\n结果：%d/%d 通过；失败=%s" % (len(checks) - len(bad), len(checks), bad or "无"))
sys.exit(1 if bad else 0)
