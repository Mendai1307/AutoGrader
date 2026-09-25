#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T2 · 客观核查器（rule-inspector）

按规则集对 T1 产出的结构对象做**确定性核查**，产出客观事实。

只出事实，不出结论：相似度 0.87 是事实；「抄袭」不是本工具能说的话。

规则集＝内置默认层 + 教师层，按 ruleId 合并（教师同名覆盖、新名追加）。
引擎与规则分离：换规则集不换代码。

三条纪律（AUDIT 修复）：
  - **P1-13 自行复算**：统计特征一律从 `blocks` 复算，**不转述** T1 的 `summary`；
    两者不一致即视为报告自相矛盾 → 退出码 2（`reportIntegrity.mismatches` 给出逐项差异）
  - **L1 未知优于否定**：`blocks` 里**一个标题都没有**时，结构规则无法判定章节存在性
    → 全部进 `notCovered` 并在 `notCoveredReasons` 里写明原因，
    **不得输出「缺失」**（否则 T1 的识别失败会被扩写成「六个章节全缺失」）
  - **结构规则不串味**：一个标题最多满足一条结构规则，按**模式长度降序**排他分配，
    避免「结果→结果分析」这类宽泛模式让多条规则同时声称命中

用法：
  python3 rule_inspector.py --report <report.json> [--rules <teacher.json>]
                           [--default-rules <default.rules.json>] [--corpus <dir>]
  python3 rule_inspector.py --self-test

退出码：0 正常 ｜ 1 部分规则未覆盖 ｜ 2 规则集非法 / 报告不可读 / 报告自相矛盾

仅标准库；无网络、无 AI；纯函数。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_RULES = os.path.normpath(os.path.join(HERE, "..", "rules", "default.rules.json"))

RE_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|[\u4e00-\u9fff]")
RE_TPL_SIMPLE = re.compile(r"\{(\w+)\}")
RE_TPL_COND = re.compile(r"\{(\w+):([^|{}]*)\|([^|{}]*)\}")
RE_TEST_CASE = re.compile(r"(def\s+test_|@Test|TEST_CASE|assert[\(\s])")


class InputError(Exception):
    """输入不可读或不合法（→ 退出码 2，结构化报错）。"""


# --------------------------------------------------------------------------- #
# 规则集
# --------------------------------------------------------------------------- #
def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except OSError as exc:
        raise InputError("文件不可读：%s（%s）" % (path, exc)) from exc
    except json.JSONDecodeError as exc:
        raise InputError("JSON 非法：%s（%s）" % (path, exc)) from exc


def merge_rules(default: dict, teacher: dict | None) -> tuple[list[dict], dict]:
    merged: dict[str, dict] = {}
    for r in default.get("rules") or []:
        if "ruleId" not in r:
            raise ValueError("默认规则缺 ruleId")
        merged[r["ruleId"]] = dict(r, source="default")
    if teacher:
        if teacher.get("rules") is None or not isinstance(teacher.get("rules"), list):
            raise ValueError("教师规则集缺 rules 数组")
        for r in teacher["rules"]:
            if "ruleId" not in r:
                raise ValueError("教师规则缺 ruleId")
            base = merged.get(r["ruleId"], {})
            item = dict(base)
            item.update(r)
            item["source"] = "teacher"
            merged[r["ruleId"]] = item

    ordered = [merged[k] for k in sorted(merged.keys())]
    digest_src = json.dumps(ordered, ensure_ascii=False, sort_keys=True)
    digest = {
        "rulesetDigest": "sha256:" + hashlib.sha256(digest_src.encode("utf-8")).hexdigest(),
        "defaultRuleSetId": default.get("ruleSetId"),
        "defaultVersion": default.get("version"),
        "teacherRuleSetId": (teacher or {}).get("ruleSetId"),
        "ruleCount": len(ordered),
        "disabled": sorted(r["ruleId"] for r in ordered if not r.get("enabled", True)),
    }
    return ordered, digest


# --------------------------------------------------------------------------- #
# 事实模板渲染（只做事实陈述）
# --------------------------------------------------------------------------- #
def render(tpl: str, values: dict) -> str:
    t = RE_TPL_COND.sub(lambda m: m.group(2) if values.get(m.group(1)) else m.group(3), tpl)
    t = RE_TPL_SIMPLE.sub(lambda m: str(values.get(m.group(1), "")), t)
    return t


# --------------------------------------------------------------------------- #
# 报告形状与自洽性
# --------------------------------------------------------------------------- #
def require_report(doc) -> dict:
    """入参形状防御：必须是对象且含 blocks 数组（AUDIT P1-7）。"""
    if not isinstance(doc, dict):
        raise InputError("--report 顶层必须是对象，实际为 %s；期望 T1 产出的报告对象"
                         % type(doc).__name__)
    blocks = doc.get("blocks")
    if blocks is None:
        raise InputError("--report 缺少顶层键 'blocks'；实际顶层键为 %s"
                         % (sorted(doc.keys()) or "（无）"))
    if not isinstance(blocks, list):
        raise InputError("--report 的 'blocks' 必须是数组，实际为 %s" % type(blocks).__name__)
    for i, blk in enumerate(blocks):
        if not isinstance(blk, dict):
            raise InputError("blocks[%d] 不是对象" % i)
    return doc


def _blocks(report: dict, kind: str | None = None) -> list[dict]:
    out = []
    for b in report.get("blocks") or []:
        if kind is None or b.get("kind") == kind:
            out.append(b)
    return out


def recompute_stats(blocks: list[dict]) -> dict:
    """**独立复算**统计特征（与 T1 summarize 同口径，但不读 T1 的 summary）。"""
    text_chars = sum(len(x.get("text") or "") for x in blocks
                     if x.get("kind") in ("text", "heading"))
    code_lines = sum((x.get("text") or "").count("\n") + 1 for x in blocks
                     if x.get("kind") == "code")
    return {
        "blockCount": len(blocks),
        "textChars": text_chars,
        "codeBlocks": sum(1 for x in blocks if x.get("kind") == "code"),
        "codeLines": code_lines,
        "figures": sum(1 for x in blocks if x.get("kind") == "figure"),
        "tables": sum(1 for x in blocks if x.get("kind") == "table"),
        "testCases": sum(1 for x in blocks if x.get("kind") == "code"
                         and RE_TEST_CASE.search(x.get("text") or "")),
        "headings": sum(1 for x in blocks if x.get("kind") == "heading"),
    }


def compare_stats(recomputed: dict, declared) -> list[dict]:
    """交叉核对：只比对双方都有的键；不一致逐项列出。"""
    if not isinstance(declared, dict):
        return [{"key": "*", "declared": declared, "recomputed": "（summary 缺失或非对象）"}]
    out = []
    for key, got in sorted(recomputed.items()):
        if key in declared and declared[key] != got:
            out.append({"key": key, "declared": declared[key], "recomputed": got})
    return out


# --------------------------------------------------------------------------- #
# 各类核查
# --------------------------------------------------------------------------- #
def structure_matches(report: dict, rules: list[dict]) -> dict[str, dict | None]:
    """把标题按「模式长度降序」**排他分配**给结构规则，返回 ruleId → 命中信息或 None。

    排他的理由：默认规则集的模式偏宽（`结果` / `分析` / `环境` / `步骤`），
    不排他时一个「结果分析」标题会同时满足 `structure.chapter.results` 与
    `structure.chapter.analysis`，两条事实都声称「存在」——事实彼此串味。
    按最长模式优先，使归属唯一且可解释。
    """
    headings = _blocks(report, "heading")
    candidates: list[tuple[int, str, int, dict, str]] = []
    for ri, rule in enumerate(rules):
        p = rule.get("params") or {}
        label = p.get("label", rule["ruleId"])
        for pat in (p.get("patterns") or [label]):
            if not pat:
                continue
            for hi, b in enumerate(headings):
                if pat in (b.get("text") or ""):
                    candidates.append((len(pat), rule["ruleId"], hi, b, pat))
    # 最长模式优先；同长按 ruleId 与标题序稳定排序
    candidates.sort(key=lambda x: (-x[0], x[1], x[2]))
    assigned: dict[str, dict | None] = {r["ruleId"]: None for r in rules}
    used_headings: set[int] = set()
    for _plen, rule_id, hi, b, pat in candidates:
        if assigned[rule_id] is not None or hi in used_headings:
            continue
        assigned[rule_id] = {"anchor": b.get("anchor"), "heading": b.get("text"), "pattern": pat}
        used_headings.add(hi)
    return assigned


def check_structure(rule: dict, match: dict | None) -> dict:
    p = rule.get("params") or {}
    label = p.get("label", rule["ruleId"])
    present = match is not None
    fact = render(rule.get("factTemplate", "{label}{present:存在|缺失}"),
                  {"label": label, "present": present})
    out = {
        "ruleId": rule["ruleId"], "kind": "structure", "fact": fact,
        "evidenceAnchor": (match or {}).get("anchor"), "value": present,
        "source": rule["source"],
    }
    if present:
        # 命中依据外露，使「这条事实凭什么成立」可被第三方复核
        out["matchedHeading"] = match["heading"]
        out["matchedPattern"] = match["pattern"]
    return out


def check_code(rule: dict, report: dict, stats: dict) -> list[dict]:
    p = rule.get("params") or {}
    facts = []
    if "minCodeBlocks" in p:
        actual = stats.get("codeBlocks", 0)
        need = p["minCodeBlocks"]
        anchor = next((b.get("anchor") for b in _blocks(report, "code")), None)
        facts.append({
            "ruleId": rule["ruleId"], "kind": "code", "source": rule["source"],
            "fact": render(rule.get("factTemplate", "代码块数量 {actual}（要求至少 {minCodeBlocks}）"),
                           {"actual": actual, "minCodeBlocks": need}),
            "evidenceAnchor": anchor, "value": actual, "threshold": need,
        })
    for api in p.get("requiredApis") or []:
        hit = next((b for b in _blocks(report, "code")
                    if re.search(r"\b%s\b" % re.escape(api), b.get("text") or "")), None)
        facts.append({
            "ruleId": rule["ruleId"] + ":" + api, "kind": "code", "source": rule["source"],
            "fact": render("必需 API「{api}」{present:出现|未出现}", {"api": api, "present": bool(hit)}),
            "evidenceAnchor": (hit or {}).get("anchor"), "value": bool(hit),
        })
    if not facts:
        facts.append({"ruleId": rule["ruleId"], "kind": "code", "source": rule["source"],
                      "fact": "该规则未提供可核查参数", "evidenceAnchor": None, "value": None})
    return facts


STAT_KEYS = {
    "minChars": "textChars",
    "minFigures": "figures",
    "minCodeLines": "codeLines",
    "minTestCases": "testCases",
    "minCodeBlocks": "codeBlocks",
    "minTables": "tables",
}


def check_statistics(rule: dict, stats: dict) -> list[dict]:
    p = rule.get("params") or {}
    facts = []
    for key, floor in sorted(p.items()):
        if key not in STAT_KEYS:
            continue
        actual = stats.get(STAT_KEYS[key], 0)
        facts.append({
            "ruleId": rule["ruleId"] + "." + key, "kind": "statistics", "source": rule["source"],
            "fact": render(rule.get("factTemplate", "%s {actual}（要求至少 {%s}）" % (key, key)),
                           {"actual": actual, key: floor}),
            "evidenceAnchor": None, "value": actual, "threshold": floor,
        })
    if not facts:
        facts.append({"ruleId": rule["ruleId"], "kind": "statistics", "source": rule["source"],
                      "fact": "该规则未提供可核查参数", "evidenceAnchor": None, "value": None})
    return facts


def _shingles(text: str, n: int) -> set[str]:
    toks = RE_TOKEN.findall(text or "")
    if len(toks) < n:
        return {" ".join(toks)} if toks else set()
    return {" ".join(toks[i:i + n]) for i in range(len(toks) - n + 1)}


def check_similarity(rule: dict, report: dict, corpus_dir: str | None) -> dict | None:
    if not corpus_dir:
        return None
    p = rule.get("params") or {}
    n = int(p.get("shingleSize", 5))
    target = "\n".join(b.get("text") or "" for b in _blocks(report, "text"))
    ts = _shingles(target, n)
    if not ts:
        return {"ruleId": rule["ruleId"], "kind": "similarity", "source": rule["source"],
                "fact": "报告正文为空，相似度不适用", "evidenceAnchor": None, "value": None}
    best = 0.0
    best_name = None
    try:
        names = sorted(os.listdir(corpus_dir))
    except OSError as exc:
        raise InputError("--corpus 目录不可读：%s（%s）" % (corpus_dir, exc)) from exc
    for name in names:
        path = os.path.join(corpus_dir, name)
        if not os.path.isfile(path) or not name.lower().endswith((".txt", ".md")):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            other = _shingles(f.read(), n)
        if not other:
            continue
        sim = len(ts & other) / float(len(ts | other))
        if sim > best:
            best, best_name = sim, name
    return {
        "ruleId": rule["ruleId"], "kind": "similarity", "source": rule["source"],
        "fact": render(rule.get("factTemplate", "与语料最高相似度 {maxSimilarity}"),
                       {"maxSimilarity": round(best, 4)}),
        "evidenceAnchor": None, "value": round(best, 4), "bestMatch": best_name,
    }


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def run(report: dict, default_rules: dict, teacher_rules: dict | None,
        corpus_dir: str | None) -> tuple[dict, int]:
    rules, digest = merge_rules(default_rules, teacher_rules)
    blocks = report.get("blocks") or []
    stats = recompute_stats(blocks)
    mismatches = compare_stats(stats, report.get("summary"))

    headings_available = bool(_blocks(report, "heading"))
    structure_rules = [r for r in rules if r.get("kind") == "structure" and r.get("enabled", True)]
    matches = structure_matches(report, structure_rules) if headings_available else {}

    facts: list[dict] = []
    not_covered: list[str] = []
    not_covered_reasons: dict[str, str] = {}

    for rule in rules:
        if not rule.get("enabled", True):
            continue
        kind = rule.get("kind")
        if kind == "structure":
            if not headings_available:
                # L1：一个标题都没有 → 章节存在性无法判定，按未知处理，不得报「缺失」
                not_covered.append(rule["ruleId"])
                not_covered_reasons[rule["ruleId"]] = (
                    "报告 blocks 中不含任何 heading，章节存在性无法判定"
                    "（T1 未识别到标题，属未解析，不是缺失）"
                )
            else:
                facts.append(check_structure(rule, matches.get(rule["ruleId"])))
        elif kind == "code":
            facts.extend(check_code(rule, report, stats))
        elif kind == "statistics":
            facts.extend(check_statistics(rule, stats))
        elif kind == "similarity":
            got = check_similarity(rule, report, corpus_dir)
            if got is None:
                not_covered.append(rule["ruleId"])
                not_covered_reasons[rule["ruleId"]] = "未提供 --corpus，相似度不适用"
            else:
                facts.append(got)
        else:
            not_covered.append(rule["ruleId"])
            not_covered_reasons[rule["ruleId"]] = "未知规则类别：%r" % kind

    facts.sort(key=lambda x: x["ruleId"])
    not_covered.sort()

    out = {
        "tool": "T2",
        "facts": facts,
        "notCovered": not_covered,
        "notCoveredReasons": not_covered_reasons,
        # 统计特征为本工具**自行复算**的值；declaredSummary 是 T1 报的，便于对照
        "stats": stats,
        "declaredSummary": report.get("summary"),
        "reportIntegrity": {
            "blocksSource": report.get("sourceFile"),
            "summaryMismatches": mismatches,
            "summaryConsistent": not mismatches,
        },
        "rulesetDigest": digest,
    }
    # 报告自相矛盾（blocks 与 summary 不一致）→ 报告不可信，退出码 2
    if mismatches:
        return out, 2
    return out, (1 if not_covered else 0)


# --------------------------------------------------------------------------- #
# 自测
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    checks = {}
    blocks = [
        {"blockId": "b1", "kind": "heading", "anchor": "1.1", "text": "一、实验原理"},
        {"blockId": "b2", "kind": "heading", "anchor": "2.1", "text": "二、实验结果"},
        {"blockId": "b3", "kind": "heading", "anchor": "3.1", "text": "三、结果分析"},
        {"blockId": "b4", "kind": "code", "anchor": "4.1", "text": "int main(){return 0;}\n// more"},
        {"blockId": "b5", "kind": "text", "anchor": "5.1", "text": "结果说明"},
    ]
    stats = recompute_stats(blocks)
    report = {"blocks": blocks, "summary": dict(stats)}
    d = load_json(DEFAULT_RULES)
    teacher = {"ruleSetId": "t", "rules": [
        {"ruleId": "statistics.char_count", "enabled": True, "kind": "statistics",
         "params": {"minChars": 10}, "factTemplate": "正文字数 {actual}（要求至少 {minChars}）"},
        {"ruleId": "code.api.myown", "enabled": True, "kind": "code",
         "params": {"requiredApis": ["malloc"]}, "factTemplate": "必需 API「{api}」{present:出现|未出现}"},
        {"ruleId": "structure.chapter.environment", "enabled": False},
    ]}

    out, code = run(report, d, teacher, None)
    found = {f["ruleId"]: f for f in out["facts"]}
    checks["cleanRunOk"] = (
        code == 1
        and out["notCovered"] == ["similarity.shingle"]
        and found["structure.chapter.principle"]["value"] is True
        and found["code.api.myown:malloc"]["value"] is False
        and found["statistics.char_count.minChars"]["value"] == out["stats"]["textChars"]
        and all("environment" not in f["ruleId"] for f in out["facts"])
        and all(f["source"] in ("default", "teacher") for f in out["facts"])
        and out["reportIntegrity"]["summaryConsistent"] is True
    )

    # P2-25②：一个标题最多满足一条结构规则——「结果」不得抢走「结果分析」
    checks["structureNoCrosstalk"] = (
        found["structure.chapter.results"]["matchedHeading"] == "二、实验结果"
        and found["structure.chapter.analysis"]["matchedHeading"] == "三、结果分析"
        and found["structure.chapter.results"]["matchedPattern"] == "实验结果"
    )
    # 命中依据必须外露
    checks["structureMatchExposed"] = all(
        "matchedHeading" in f for f in out["facts"] if f["kind"] == "structure" and f["value"]
    )

    # P1-13：summary 与 blocks 不一致 → 报告自相矛盾，退出码 2
    bad = {"blocks": blocks,
           "summary": dict(stats, textChars=stats["textChars"] + 999, codeBlocks=0)}
    out_bad, code_bad = run(bad, d, teacher, None)
    keys = {m["key"] for m in out_bad["reportIntegrity"]["summaryMismatches"]}
    checks["summaryMismatchDetected"] = (
        code_bad == 2 and "textChars" in keys and "codeBlocks" in keys
        and out_bad["reportIntegrity"]["summaryConsistent"] is False
        and out_bad["stats"]["codeBlocks"] == 1  # 仍报复算值
    )
    # summary 整体缺失 → 也算不一致（不得静默放过）
    out_nosum, code_nosum = run({"blocks": blocks}, d, teacher, None)
    checks["missingSummaryDetected"] = code_nosum == 2 and len(
        out_nosum["reportIntegrity"]["summaryMismatches"]) == 1

    # L1：blocks 里一个 heading 都没有 → 结构规则进 notCovered，绝不出「缺失」
    no_head = {"blocks": [b for b in blocks if b["kind"] != "heading"]}
    no_head["summary"] = recompute_stats(no_head["blocks"])
    out_nh, code_nh = run(no_head, d, teacher, None)
    # 注意：teacher 把 structure.chapter.environment 停用了，停用规则不进 notCovered
    expected_struct = {
        r["ruleId"] for r in d["rules"]
        if r.get("kind") == "structure" and r["ruleId"] != "structure.chapter.environment"
    }
    checks["noHeadingsNeverAssertsMissing"] = (
        expected_struct <= set(out_nh["notCovered"])
        and not any(f["kind"] == "structure" for f in out_nh["facts"])
        and all("无法判定" in out_nh["notCoveredReasons"][rid] for rid in expected_struct)
        and not any("缺失" in f["fact"] for f in out_nh["facts"])
    )

    # 入参形状防御（AUDIT P1-7）
    shape_ok = True
    for bad_doc in ([], {"x": 1}, {"blocks": {}}, {"blocks": [1]}):
        try:
            require_report(bad_doc)
            shape_ok = False
        except InputError:
            pass
    checks["reportShapeDefended"] = shape_ok

    # --corpus 目录不存在 → InputError（→ 退出码 2），不得裸 traceback
    try:
        run(report, d, teacher, "E:/__no_such_corpus__")
        checks["missingCorpusRaisesInputError"] = False
    except InputError:
        checks["missingCorpusRaisesInputError"] = True

    print(json.dumps({"tool": "T2", "checks": checks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T2 客观核查器（rule-inspector）")
    ap.add_argument("--report")
    ap.add_argument("--rules")
    ap.add_argument("--default-rules", default=DEFAULT_RULES)
    ap.add_argument("--corpus")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.report:
        print(json.dumps({"tool": "T2", "error": "need --report"}, ensure_ascii=False))
        return 2

    try:
        report = require_report(load_json(args.report))
        default_rules = load_json(args.default_rules)
        teacher_rules = load_json(args.rules) if args.rules else None
        out, code = run(report, default_rules, teacher_rules, args.corpus)
    except InputError as exc:
        print(json.dumps({"tool": "T2", "error": str(exc), "kind": "invalid-input"},
                         ensure_ascii=False))
        return 2
    except ValueError as exc:
        print(json.dumps({"tool": "T2", "error": str(exc), "kind": "invalid-ruleset"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "T2", "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    payload = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True)
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "T2", "error": "写输出失败：%s" % exc}, ensure_ascii=False))
            return 2
    else:
        print(payload)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
