#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 v1.1 docx：T1 可解析性 + 应存在的修订 + 应清除的旧表述 + v1.0 原样存档 + 故意保留项。

期望值说明：
  · 「应清除」只列**裁决清单要求清除的表述**，不把版本说明里用于解释差异的同一批词算进来。
  · 「故意保留」单列，且必须仍然存在——它们是已声明的例外，不是漏改。
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend", "autograder-expert", "agents", "tools", "scripts"))

import document_parser as T1  # noqa: E402

P11 = os.path.join(ROOT, "AutoGrader 步骤路径规划书_v1.1.docx")
G11 = os.path.join(ROOT, "AutoGrader 项目目标定义书_v1.1.docx")
P10 = os.path.join(ROOT, "AutoGrader 步骤路径规划书_v1.0.docx")
G10 = os.path.join(ROOT, "AutoGrader 项目目标定义书_v1.0.docx")


def text_of(path):
    rep, code = T1.run(path, None, None)
    return "\n".join(b["text"] for b in rep["blocks"]), rep


def main() -> int:
    bad = 0

    print("=== 1. T1 可解析性（v1.0 / v1.1 对照）===")
    for p in (P10, P11, G10, G11):
        t, rep = text_of(p)
        print("  %-46s status=%-8s 标题=%-3d 块=%-4d 字符=%d"
              % (os.path.basename(p), rep["status"], rep["summary"]["headings"],
                 len(rep["blocks"]), len(t)))

    plan, _ = text_of(P11)
    goal, _ = text_of(G11)
    plan10, _ = text_of(P10)
    goal10, _ = text_of(G10)

    def check(label, cond, kind="✅"):
        nonlocal bad
        if not cond:
            bad += 1
        print("  %-46s %s" % (label, kind if cond else "❌"))

    print("\n=== 2. v1.1 应存在的修订 ===")
    for tag, key, src in [
        ("规划书", "v1.1", plan), ("规划书", "三模式总览", plan),
        ("规划书", "打包与平台合规映射", plan), ("规划书", "S0 任务识别与路由", plan),
        ("规划书", "S7 复核与解释", plan), ("规划书", "T5 契约校验器", plan),
        ("规划书", "T6 资产库", plan), ("规划书", "不接受手算", plan),
        ("规划书", "PDF 为保守文字层抽取", plan), ("规划书", "待交付物二建立后校验", plan),
        ("规划书", "v1.0 原件原样存档", plan),
        ("目标定义书", "v1.1", goal), ("目标定义书", "赛事日历与算力资源", goal),
        ("目标定义书", "双端校验", goal), ("目标定义书", "六项检查", goal),
        ("目标定义书", "交付清单（无排期）", goal), ("目标定义书", "已决事项", goal),
        ("目标定义书", "待重建 / 待移植", goal),
        ("目标定义书", "专家包侧：六个 CLI 仅用 Python 标准库", goal),
        ("目标定义书", "部分构建", goal), ("目标定义书", "v1.0 原件原样存档", goal),
    ]:
        check("%s ｜ %s" % (tag, key), key in src)

    print("\n=== 3. v1.1 应清除的旧表述（按裁决清单口径）===")
    for tag, key, src in [
        ("规划书", "四模式", plan),
        ("规划书", "按 Prompt 口径手算", plan),
        ("规划书", "评语写作", plan),        # 旧 Skills 表末行 → 已换 S0–S7（S6 评语生成）
        ("规划书", "样例检索", plan),        # 旧 Tools 表末行 → 已换 T1–T6（T6 资产库）
        ("规划书", "契约组装", plan),        # 旧 Skills 表混称 → 已拆为 S4 / S5
        ("规划书", "三项校验可独立运行", plan),
        ("目标定义书", "倒计时现实", goal),
        ("目标定义书", "36 小时版", goal),
        ("目标定义书", "6.1 风险登记", goal),
        ("目标定义书", "6.2 待用户决策", goal),
        ("目标定义书", "三重校验", goal),
        ("目标定义书", "三条访问路径逐一实测", goal),
        ("目标定义书", "备用链接可靠性说明", goal),
        ("目标定义书", "四模式", goal),
        ("目标定义书", "[图片]", goal),
        ("规划书", "[图片]", plan),
    ]:
        check("%s ｜ %s（应不存在）" % (tag, key), key not in src)

    print("\n=== 4. v1.0 原样存档（对照组：旧表述必须仍在）===")
    for tag, key, src in [
        ("规划书", "按 Prompt 口径手算", plan10),
        ("规划书", "评语写作", plan10),
        ("规划书", "样例检索", plan10),
        ("规划书", "不再考虑\"备用链接\"相关路径", plan10),
        ("目标定义书", "倒计时现实", goal10),
        ("目标定义书", "36 小时版", goal10),
        ("目标定义书", "风险登记", goal10),
        ("目标定义书", "备用链接生命周期不可控", goal10),
        ("目标定义书", "待用户决策", goal10),
        ("目标定义书", "三重校验", goal10),
    ]:
        check("%s ｜ %s（应仍在）" % (tag, key), key in src)

    print("\n=== 5. 已声明的「故意保留」项（不是漏改）===")
    reasons = [
        ("目标定义书", "36 小时风险", "4.5 开头一处措辞。**我的裁决清单把 4.5 判为「与当前口径一致」是误判**；"
                                     "按「用户没提的部分不碰、只提出」的纪律**未改**，等裁决。"),
        ("目标定义书", "原风险登记中仍然有效的两条", "6.1 删除后，其两条有效纪律转为第五章的执行提醒，"
                                                       "故此处保留对来源的说明。"),
        ("目标定义书", "备用链接废弃", "header 版本说明里的差异陈述（说明 v1.1 相对 v1.0 改了什么），"
                                        "不是行动项。"),
        ("规划书", "不再考虑\"备用链接\"相关路径", "「明确排除」章节的排除声明，本就应保留。"),
        ("规划书", "四模式", "v1.1 中已无；此行为占位说明：规划书 v1.0 本就未使用「四模式」一词。"),
    ]
    for tag, key, why in reasons:
        src = plan if tag == "规划书" else goal
        present = key in src
        if key == "四模式":
            check("%s ｜ %s（应为不存在）" % (tag, key), not present)
        else:
            check("%s ｜ %s（已声明保留）" % (tag, key), present)
        print("        └ %s" % why)

    print("\n%s" % ("全部通过 ✅" if bad == 0 else "有 %d 项未通过 ❌" % bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
