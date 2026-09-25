#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T5 · 契约校验器（contract-validator）

对 **Rubric** 与 **ReviewResult** 两类契约做合规性校验与事实性复算，
产出**结构化错误清单**——每条带机器可读 `code` 与 JSON 路径，
以便 S5 的「按错误清单重试」直接消费，无需再解析自然语言。

只校验合规性，不改写内容。**校验通过 ≠ 判断正确。**

六项检查（与 S5 的六项校验对齐）
-----------------------------------
  1. `schema.structure`      JSON Schema 断言 + 结构级不变式
  2. `weights.sum`           权重和 = 100（scores 与内嵌 rubric 各一次）
  3. `band.levels`           档位模型（levels 互斥 / 单调 / 可判定，及 score 与档位一致）
  4. `evidence.present`      证据存在性 + 引用有效性（`citationValid`）
  5. `total.recompute`       总分复算（复用 T4 同一实现）
  6. `fingerprint.recompute` 指纹复算（复用契约指纹算法）

用法：
  python3 contract_validator.py --kind review-result --input <result.json>
      [--schema <schema.json>] [--fingerprint-algo <algo.py>]
  python3 contract_validator.py --kind rubric --input <rubric.json>
  python3 contract_validator.py --self-test

`--schema` 与 `--fingerprint-algo` **缺省从随包 `contract/` 目录解析**
（自脚本位置向上逐级查找 `contract/`）；找不到才降级。

退出码：
  0 全部通过 ｜ 1 校验失败（errors 非空）｜ 2 输入不可读 / 畸形 / **schema 用了不支持的关键字**
  3 降级运行（因依赖缺失跳过部分校验）—— **CI 门禁中视为不通过**

仅标准库；无网络、无 AI；纯函数。
总分复算**复用 T4 的实现**（`deterministic_calculator.py`），不另写一套口径。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# 本脚本 import 同目录的 T4 时，Python 默认会在脚本目录写 `__pycache__/`——那会污染交付包
# （随包 `rules/` 与脚本同处一个目录树）。关掉字节码落盘：T4 仍被正常导入、共用同一实现，
# 只是不再生成 .pyc。**只影响本进程**，不改其它脚本的行为。
sys.dont_write_bytecode = True

import deterministic_calculator as T4  # noqa: E402  共用同一实现，不得各写一套

WEIGHT_SUM_TOLERANCE = 0.01
SCORES_KEY = "scores"

DEFAULT_SCHEMA_BY_KIND = {
    "rubric": "Rubric.schema.json",
    "review-result": "ReviewResult.schema.json",
}
DEFAULT_FINGERPRINT_ALGO = "fingerprint.py"

LEVEL_RANK = {"excellent": 3, "meeting": 2, "partial": 1, "notMet": 0}

VAGUE_CRITERION_KEYWORDS = (
    "较好", "一般", "较差", "良好", "态度认真", "内容完整", "基本合理",
    "比较完整", "认真完成", "整体不错", "差不多", "还行",
)

# JSON Schema 子集：**断言关键字**（会实际校验）
SUPPORTED_ASSERTIONS = frozenset({
    "type", "enum", "const",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "pattern",
    "minItems", "maxItems", "minProperties", "maxProperties",
    "properties", "required", "additionalProperties", "items",
    "oneOf", "anyOf", "allOf", "not", "$ref",
})
# JSON Schema 子集：**注解关键字**（读入但不校验）
SUPPORTED_ANNOTATIONS = frozenset({
    "$schema", "$id", "title", "description", "$comment", "examples", "default",
    "$defs", "definitions", "deprecated", "readOnly", "writeOnly",
})
SUPPORTED_KEYWORDS = SUPPORTED_ASSERTIONS | SUPPORTED_ANNOTATIONS


class SchemaError(Exception):
    """schema 本身不可用：用了不支持的关键字、$ref 不可解析等。"""


# --------------------------------------------------------------------------- #
# $ref 解析（仅本地 `#/...` 与同目录文件引用；不引入外部网络解析）
# --------------------------------------------------------------------------- #
_schema_file_cache: dict[str, dict] = {}


def load_schema_file(path: str) -> dict:
    path = os.path.abspath(path)
    if path not in _schema_file_cache:
        with open(path, "r", encoding="utf-8") as f:
            _schema_file_cache[path] = json.load(f)
    return _schema_file_cache[path]


def _pointer(root, pointer: str):
    if not pointer or pointer == "/":
        return root
    cur = root
    for token in pointer.lstrip("/").split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, list):
            try:
                cur = cur[int(token)]
            except (ValueError, IndexError):
                raise SchemaError("$ref 指向不存在的数组下标：%s" % pointer)
        elif isinstance(cur, dict) and token in cur:
            cur = cur[token]
        else:
            raise SchemaError("$ref 指向不存在的路径：%s" % pointer)
    return cur


def deref(schema, base_path, root):
    """展开 `$ref` 链，返回 (schema 节点, 所属文件绝对路径, 当前根节点)。

    - `#/...` 解析为**当前根节点**内的 JSON Pointer；
    - `xxx.json` / `xxx.json#/...` 解析为**同目录**文件（相对当前文件位置）。
    内联传入（无来源文件）的 schema 只能使用 `#/...` 形式。
    """
    depth = 0
    while isinstance(schema, dict) and "$ref" in schema:
        depth += 1
        if depth > 32:
            raise SchemaError("$ref 链路过深（疑似循环引用）")
        ref = schema["$ref"]
        if not isinstance(ref, str) or not ref:
            raise SchemaError("$ref 必须是非空字符串，实际为 %r" % (ref,))
        file_part, _, fragment = ref.partition("#")
        if file_part:
            if not base_path:
                raise SchemaError("schema 未来自文件，无法解析相对 $ref：%s" % ref)
            base_path = os.path.normpath(
                os.path.join(os.path.dirname(base_path), file_part)
            )
            root = load_schema_file(base_path)
        schema = _pointer(root, fragment) if fragment else root
    return schema, base_path, root


def _check_keywords(schema: dict, path: str) -> None:
    unknown = sorted(set(schema.keys()) - SUPPORTED_KEYWORDS)
    if unknown:
        raise SchemaError(
            "schema 在 %s 使用了不支持的关键字 %s；"
            "本校验器只支持 %s。禁止静默跳过——请显式扩展子集或改写 schema。"
            % (path, unknown, sorted(SUPPORTED_ASSERTIONS))
        )


# --------------------------------------------------------------------------- #
# JSON Schema 子集校验
# --------------------------------------------------------------------------- #
def _jtype_ok(v, t: str) -> bool:
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "null":
        return v is None
    raise SchemaError("schema.type 取值不支持：%r" % (t,))


def _same(a, b) -> bool:
    """严格相等：布尔与数字不得互相等同（Python 里 True == 1）。"""
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return a == b


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _probe(node, schema, base_path, root) -> list:
    """在独立错误收集器里跑一遍，用于 oneOf / anyOf / not 的判定。"""
    sub: list = []
    validate_schema(node, schema, "$", sub, base_path, root)
    return sub


def validate_schema(node, schema, path: str, errs: list, base_path, root) -> None:
    """按 JSON Schema 子集校验。关键字不支持时抛 SchemaError（→ 退出码 2）。"""
    schema, base_path, root = deref(schema, base_path, root)
    if isinstance(schema, bool):
        raise SchemaError("不支持布尔形式的 schema 节点（%s）" % path)
    if not isinstance(schema, dict):
        raise SchemaError("schema 节点必须是对象，%s 处实际为 %s" % (path, type(schema).__name__))
    _check_keywords(schema, path)

    def add(code: str, expected, actual, hint: str) -> None:
        errs.append({"code": code, "jsonPath": path,
                     "expected": expected, "actual": actual, "fixHint": hint})

    # ---- 组合关键字 ----
    if "allOf" in schema:
        for sub in schema["allOf"]:
            validate_schema(node, sub, path, errs, base_path, root)
    if "anyOf" in schema:
        if not any(not _probe(node, s, base_path, root) for s in schema["anyOf"]):
            add("schema.anyOf", "至少命中一个分支", None, "未命中 anyOf 的任何分支")
    if "oneOf" in schema:
        hits = sum(1 for s in schema["oneOf"] if not _probe(node, s, base_path, root))
        if hits != 1:
            add("schema.oneOf", "恰好命中一个分支", "命中 %d 个" % hits,
                "oneOf 要求恰好一个分支成立")
    if "not" in schema:
        if not _probe(node, schema["not"], base_path, root):
            add("schema.not", "不得命中", "命中", "该值命中 not 分支")

    # ---- 类型 ----
    t = schema.get("type")
    if t and not _jtype_ok(node, t):
        add("schema.type", t, type(node).__name__, "检查该字段类型")
        return

    # ---- 取值 ----
    if "const" in schema and not _same(node, schema["const"]):
        add("schema.const", schema["const"], node, "取值必须等于 const")
    if "enum" in schema and not any(_same(node, cand) for cand in schema["enum"]):
        add("schema.enum", schema["enum"], node, "取值须在枚举内")

    # ---- 数值 ----
    if _is_num(node):
        if "minimum" in schema and node < schema["minimum"]:
            add("schema.minimum", ">= %s" % schema["minimum"], node, "低于下界")
        if "maximum" in schema and node > schema["maximum"]:
            add("schema.maximum", "<= %s" % schema["maximum"], node, "高于上界")
        if "exclusiveMinimum" in schema:
            bound = schema["exclusiveMinimum"]
            if isinstance(bound, bool):
                raise SchemaError(
                    "exclusiveMinimum 须为数字（draft-07）；布尔写法不支持（%s）" % path
                )
            if node <= bound:
                add("schema.exclusiveMinimum", "> %s" % bound, node, "未超过下界")
        if "exclusiveMaximum" in schema:
            bound = schema["exclusiveMaximum"]
            if isinstance(bound, bool):
                raise SchemaError(
                    "exclusiveMaximum 须为数字（draft-07）；布尔写法不支持（%s）" % path
                )
            if node >= bound:
                add("schema.exclusiveMaximum", "< %s" % bound, node, "未低于上界")

    # ---- 字符串 ----
    if isinstance(node, str):
        if "minLength" in schema and len(node) < schema["minLength"]:
            add("schema.minLength", ">= %s" % schema["minLength"], len(node), "字符串过短")
        if "maxLength" in schema and len(node) > schema["maxLength"]:
            add("schema.maxLength", "<= %s" % schema["maxLength"], len(node), "字符串过长")
        if "pattern" in schema:
            import re
            try:
                matched = re.search(schema["pattern"], node) is not None
            except re.error as exc:
                raise SchemaError("schema.pattern 不是合法正则（%s）：%s" % (path, exc))
            if not matched:
                add("schema.pattern", schema["pattern"], node, "不符合正则")

    # ---- 数组 ----
    if isinstance(node, list):
        if "minItems" in schema and len(node) < schema["minItems"]:
            add("schema.minItems", ">= %s" % schema["minItems"], len(node), "条目数不足")
        if "maxItems" in schema and len(node) > schema["maxItems"]:
            add("schema.maxItems", "<= %s" % schema["maxItems"], len(node), "条目数过多")
        sub = schema.get("items")
        if sub is not None:
            if not isinstance(sub, dict):
                raise SchemaError(
                    "items 只支持对象形式（单 schema 逐项应用），%s 处实际为 %s"
                    % (path, type(sub).__name__)
                )
            for i, item in enumerate(node):
                validate_schema(item, sub, "%s[%d]" % (path, i), errs, base_path, root)

    # ---- 对象 ----
    if isinstance(node, dict):
        props = schema.get("properties") or {}
        for key in schema.get("required") or []:
            if key not in node:
                errs.append({"code": "schema.required", "jsonPath": "%s.%s" % (path, key),
                             "expected": key, "actual": None, "fixHint": "缺少必填字段"})
        if "minProperties" in schema and len(node) < schema["minProperties"]:
            add("schema.minProperties", ">= %s" % schema["minProperties"], len(node), "字段数不足")
        if "maxProperties" in schema and len(node) > schema["maxProperties"]:
            add("schema.maxProperties", "<= %s" % schema["maxProperties"], len(node), "字段数过多")
        for key, sub in props.items():
            if key in node:
                validate_schema(node[key], sub, "%s.%s" % (path, key), errs, base_path, root)
        extra = schema.get("additionalProperties")
        if extra is not None:
            unknown_keys = [k for k in node if k not in props]
            if extra is False:
                for k in unknown_keys:
                    errs.append({
                        "code": "schema.additionalProperties",
                        "jsonPath": "%s.%s" % (path, k),
                        "expected": "未声明的字段一律拒绝",
                        "actual": k,
                        "fixHint": "契约启用 additionalProperties:false，禁止自由发挥新增字段",
                    })
            elif isinstance(extra, dict):
                for k in unknown_keys:
                    validate_schema(node[k], extra, "%s.%s" % (path, k), errs, base_path, root)
            elif not isinstance(extra, bool):
                raise SchemaError("additionalProperties 只支持布尔或对象（%s）" % path)


# --------------------------------------------------------------------------- #
# 事实性校验
# --------------------------------------------------------------------------- #
def check_weights(items: list, errs: list, path_prefix: str = SCORES_KEY) -> float:
    total = 0.0
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        w = it.get("weight")
        if not _is_num(w):
            errs.append({"code": "weight.type", "jsonPath": "%s[%d].weight" % (path_prefix, i),
                         "expected": "number", "actual": w, "fixHint": "weight 必须是数字"})
            continue
        if w < 0:
            errs.append({"code": "weight.negative", "jsonPath": "%s[%d].weight" % (path_prefix, i),
                         "expected": ">= 0", "actual": w, "fixHint": "权重不得为负"})
        total += float(w)
    total = round(total, 6)
    if abs(total - 100.0) > WEIGHT_SUM_TOLERANCE:
        errs.append({"code": "weight.sum", "jsonPath": "%s[].weight" % path_prefix,
                     "expected": 100.0, "actual": total,
                     "fixHint": "权重和必须等于 100；不得自行归一化或补齐"})
    return total


def check_bands(levels: list, errs: list, path: str, clues: list) -> None:
    """档位模型检查（契约以 levels[]{level,label,criterion,scoreRatio} 表达档位）。

    - 硬错误：levels 空、level 重复、scoreRatio 越界、criterion 空、scoreRatio 非严格单调
    - 线索（不改退出码）：四档不齐、criterion 用词不可判定
    之所以把「可判定性」降为线索：严格的语义可判定性属 S1 的判断，T5 只能做关键词黑名单这一确定性部分。
    """
    if not isinstance(levels, list) or not levels:
        errs.append({"code": "band.empty", "jsonPath": path,
                     "expected": "至少 1 个档位", "actual": levels,
                     "fixHint": "每个评分点必须给出判定档位"})
        return

    seen = set()
    ranked = []
    for j, lv in enumerate(levels):
        jp = "%s[%d]" % (path, j)
        if not isinstance(lv, dict):
            errs.append({"code": "band.not-object", "jsonPath": jp,
                         "expected": "object", "actual": type(lv).__name__,
                         "fixHint": "档位必须是对象"})
            continue
        level = lv.get("level")
        if level in LEVEL_RANK:
            if level in seen:
                errs.append({"code": "band.duplicate-level", "jsonPath": "%s.level" % jp,
                             "expected": "同一评分点内 level 互斥", "actual": level,
                             "fixHint": "同一档位重复定义，同一份报告可落两档"})
            seen.add(level)
        else:
            errs.append({"code": "band.unknown-level", "jsonPath": "%s.level" % jp,
                         "expected": sorted(LEVEL_RANK), "actual": level,
                         "fixHint": "档位标识不在契约枚举内"})
        ratio = lv.get("scoreRatio")
        if not _is_num(ratio) or ratio < 0 or ratio > 1:
            errs.append({"code": "band.ratio-range", "jsonPath": "%s.scoreRatio" % jp,
                         "expected": "[0, 1]", "actual": ratio,
                         "fixHint": "得分系数必须在 0–1"})
        else:
            ranked.append((LEVEL_RANK.get(level, -1), float(ratio), level))
        criterion = lv.get("criterion")
        if not isinstance(criterion, str) or not criterion:
            errs.append({"code": "band.empty-criterion", "jsonPath": "%s.criterion" % jp,
                         "expected": "非空字符串", "actual": criterion,
                         "fixHint": "档位必须给出可判定的标准"})
        elif any(k in criterion for k in VAGUE_CRITERION_KEYWORDS):
            clues.append({"code": "band.vague-criterion", "jsonPath": "%s.criterion" % jp,
                          "detail": "判据含不可判定措辞：%s" % criterion,
                          "note": "这是线索，不是结论；可判定性判断属 S1"})

    ranked.sort(key=lambda x: x[0])
    for (ra, va, la), (rb, vb, lb) in zip(ranked, ranked[1:]):
        if rb > ra and not (vb > va):
            errs.append({"code": "band.ratio-not-monotonic", "jsonPath": path,
                         "expected": "高档次 scoreRatio 严格大于低档次",
                         "actual": "%s=%s, %s=%s" % (la, va, lb, vb),
                         "fixHint": "档位系数必须随档次严格单调，否则档位不互斥"})
            break

    if len(seen) < 4:
        clues.append({"code": "band.incomplete-levels", "jsonPath": path,
                      "detail": "只定义了 %d 档（优秀/达标/部分达标/未达标 四档未齐）" % len(seen),
                      "note": "这是线索，不是结论；教师可以只设两档"})


def check_evidence(items: list, errs: list) -> int:
    """证据存在性 + 引用有效性。

    契约允许 `evidence` 为空数组（「未找到证据」是合法结论），
    但此时该项必须标 `needsReview === true`——这正是 v0.1 对 needsReview 的定义
    （「置信度 < 0.80、**证据缺失**或档位存在争议时为 true」）。
    """
    flagged = 0
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        ev = it.get("evidence")
        empty = not ev
        if empty:
            flagged += 1
            if it.get("needsReview") is not True:
                errs.append({
                    "code": "evidence.missing-without-review",
                    "jsonPath": "scores[%d].evidence" % i,
                    "expected": "证据为空时 needsReview === true",
                    "actual": it.get("needsReview"),
                    "fixHint": "证据缺失必须标为待复核，不得静默放行",
                })
        if isinstance(ev, list):
            for j, e in enumerate(ev):
                if isinstance(e, dict) and e.get("citationValid") is False:
                    errs.append({
                        "code": "evidence.citation-invalid",
                        "jsonPath": "scores[%d].evidence[%d].citationValid" % (i, j),
                        "expected": True, "actual": False,
                        "fixHint": "T3 判定该引用坐标无效或引用不忠实，该证据作废",
                    })
    return flagged


def check_slots(items: list, errs: list, rubric: dict | None) -> None:
    """逐项：score 区间、score 与档位系数一致、level 与 levelScoreRatio 对应内嵌 rubric。"""
    lvl_index: dict[str, dict] = {}
    if isinstance(rubric, dict) and isinstance(rubric.get("items"), list):
        for ri in rubric["items"]:
            if isinstance(ri, dict) and isinstance(ri.get("levels"), list):
                lvl_index[ri.get("id")] = {
                    lv.get("level"): lv.get("scoreRatio")
                    for lv in ri["levels"] if isinstance(lv, dict)
                }

    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        jp = "scores[%d]" % i
        rid = it.get("rubricItemId")
        ms = it.get("maxScore")
        sc = it.get("score")
        pending = it.get("pending") is True
        if not _is_num(ms) or ms <= 0:
            errs.append({"code": "slot.maxScore", "jsonPath": "%s.maxScore" % jp,
                         "expected": "> 0", "actual": ms, "fixHint": "maxScore 必须为正数"})
            continue
        if sc is None:
            if not pending:
                errs.append({"code": "slot.score.missing", "jsonPath": "%s.score" % jp,
                             "expected": "number（非 pending 项必须有终值）", "actual": None,
                             "fixHint": "仅 pending === true 的项允许 score 为 null"})
            continue
        if not _is_num(sc):
            errs.append({"code": "slot.score.type", "jsonPath": "%s.score" % jp,
                         "expected": "number", "actual": sc, "fixHint": "score 必须是数字"})
            continue
        if sc < 0 or sc > ms:
            errs.append({"code": "slot.score.range", "jsonPath": "%s.score" % jp,
                         "expected": "[0, %s]" % ms, "actual": sc,
                         "fixHint": "score 越出 [0, maxScore]"})
        ratio = it.get("levelScoreRatio")
        if _is_num(ratio):
            expected = round(float(ms) * float(ratio), 2)
            if abs(float(sc) - expected) > WEIGHT_SUM_TOLERANCE:
                errs.append({"code": "band.score-ratio-mismatch", "jsonPath": "%s.score" % jp,
                             "expected": "maxScore × levelScoreRatio = %s" % expected,
                             "actual": sc,
                             "fixHint": "score 必须等于 maxScore × levelScoreRatio"})
        if rid in lvl_index:
            table = lvl_index[rid]
            level = it.get("level")
            if level not in table:
                errs.append({"code": "band.level-not-in-rubric",
                             "jsonPath": "%s.level" % jp,
                             "expected": sorted(k for k in table if k),
                             "actual": level,
                             "fixHint": "该项档位不在内嵌 rubric 为该点定义的档位集内"})
            elif _is_num(ratio) and abs(float(ratio) - float(table[level])) > 1e-9:
                errs.append({"code": "band.ratio-not-in-rubric",
                             "jsonPath": "%s.levelScoreRatio" % jp,
                             "expected": table[level], "actual": ratio,
                             "fixHint": "档位系数快照与内嵌 rubric 的档位定义不一致"})


# --------------------------------------------------------------------------- #
# 结构级不变式（v0.1 superRefine 的等价物：JSON Schema 无法表达）
# --------------------------------------------------------------------------- #
def check_structural_invariants(doc: dict, errs: list) -> None:
    scores = doc.get(SCORES_KEY)
    if not isinstance(scores, list):
        return

    seen = set()
    for i, it in enumerate(scores):
        if not isinstance(it, dict):
            continue
        rid = it.get("rubricItemId")
        if rid in seen:
            errs.append({"code": "scores.duplicate-rubricItemId",
                         "jsonPath": "%s[%d].rubricItemId" % (SCORES_KEY, i),
                         "expected": "同一评分点不得重复",
                         "actual": rid,
                         "fixHint": "重复评分点会让权重和虚高"})
        seen.add(rid)

        if it.get("pending") is True and it.get("needsReview") is not True:
            errs.append({"code": "pending.requires-needsReview",
                         "jsonPath": "%s[%d].pending" % (SCORES_KEY, i),
                         "expected": "pending === true ⟹ needsReview === true",
                         "actual": {"pending": True, "needsReview": it.get("needsReview")},
                         "fixHint": "待复核项必然需要复核，两个标记不得矛盾"})

        if it.get("overriddenByTeacher") is True:
            sug = it.get("suggestedScore")
            if not _is_num(sug):
                errs.append({"code": "overridden.suggestedScore.missing",
                             "jsonPath": "%s[%d].suggestedScore" % (SCORES_KEY, i),
                             "expected": "教师改过终值的项必须保留 AI 建议分",
                             "actual": sug,
                             "fixHint": "差异数据是评测层复算 MAE 的唯一来源，不得省略"})
            elif _is_num(it.get("score")) and abs(float(sug) - float(it["score"])) < 1e-9:
                errs.append({"code": "overridden.same-as-suggested",
                             "jsonPath": "%s[%d].overriddenByTeacher" % (SCORES_KEY, i),
                             "expected": "overriddenByTeacher === true ⟹ 终值 ≠ 建议分",
                             "actual": {"suggestedScore": sug, "score": it.get("score")},
                             "fixHint": "终值与建议分相同却标记为教师改过，属伪造差异数据"})

    rubric = doc.get("rubric")
    if isinstance(rubric, dict):
        if rubric.get("version") != doc.get("rubricVersion"):
            errs.append({"code": "rubric.version-mismatch", "jsonPath": "rubricVersion",
                         "expected": rubric.get("version"),
                         "actual": doc.get("rubricVersion"),
                         "fixHint": "rubricVersion 必须与内嵌 rubric.version 一致"})

    prov = doc.get("provenance")
    if isinstance(prov, dict) and prov.get("schemaVersion") != doc.get("schemaVersion"):
        errs.append({"code": "schemaVersion.mismatch", "jsonPath": "schemaVersion",
                     "expected": prov.get("schemaVersion"),
                     "actual": doc.get("schemaVersion"),
                     "fixHint": "顶层 schemaVersion 必须与 provenance.schemaVersion 一致"})

    total = doc.get("total")
    if isinstance(total, dict):
        w_ex = total.get("weightExcluded")
        w_in = total.get("weightIncluded")
        if "isPartial" in total and isinstance(w_ex, (int, float)):
            if bool(total["isPartial"]) != (float(w_ex) > 0):
                errs.append({"code": "total.isPartial-mismatch", "jsonPath": "total.isPartial",
                             "expected": "isPartial === (weightExcluded > 0)",
                             "actual": total["isPartial"],
                             "fixHint": "部分分标记与未计入权重不一致"})
        # upperBound 必须等于已计入权重合计（不是 100 − W_r）
        if _is_num(w_in) and _is_num(total.get("upperBound")):
            if abs(float(total["upperBound"]) - float(w_in)) > WEIGHT_SUM_TOLERANCE:
                errs.append({"code": "total.upperBound-mismatch",
                             "jsonPath": "total.upperBound",
                             "expected": w_in, "actual": total["upperBound"],
                             "fixHint": "上界 = 已计入权重合计；100 − W_r 仅在权重和恰为 100 时等价"})
        grade = total.get("grade")
        if grade is not None:
            ok = _is_num(w_ex) and _is_num(w_in) and float(w_ex) == 0 and float(w_in) == 100
            if not ok:
                errs.append({"code": "total.grade-not-allowed", "jsonPath": "total.grade",
                             "expected": "仅当 weightExcluded = 0 且 weightIncluded = 100 时才映射等级",
                             "actual": {"grade": grade, "weightExcluded": w_ex,
                                        "weightIncluded": w_in},
                             "fixHint": "部分分不得映射等级"})


def recompute_total(scores: list) -> dict:
    payload = {SCORES_KEY: [dict(x) for x in scores]}
    out, _ = T4.run(payload, "total", T4.DEFAULT_BANDS)
    return {"total": out["total"], "weightIncluded": out["weightIncluded"],
            "weightExcluded": out["weightExcluded"], "upperBound": out["upperBound"]}


def check_declared_total(doc: dict, errs: list) -> dict | None:
    scores = doc.get(SCORES_KEY)
    if not isinstance(scores, list) or not scores:
        return None
    try:
        got = recompute_total(scores)
    except T4.BadInput as exc:
        errs.append({"code": "total.recompute", "jsonPath": "$.%s" % SCORES_KEY,
                     "expected": "可复算", "actual": str(exc),
                     "fixHint": "按 T4 口径修正输入"})
        return None
    declared = doc.get("totalScore")
    if _is_num(declared) and abs(float(declared) - got["total"]) > WEIGHT_SUM_TOLERANCE:
        errs.append({"code": "total.mismatch", "jsonPath": "totalScore",
                     "expected": got["total"], "actual": declared,
                     "fixHint": "totalScore 必须等于 Σ (score / maxScore) × weight（仅计入非 pending 项）"})

    # 声明的部分分元数据必须等于按契约复算的值。
    # 少了这一条，`total.weightIncluded` 与 `total.upperBound` 可以一起写错而互相自洽
    # （I9 只比 upperBound 与 weightIncluded，不比它们与真实权重和），
    # 「部分分必须携带 W_r」这条口径就落不了地。
    declared_total = doc.get("total")
    if isinstance(declared_total, dict):
        for key in ("weightIncluded", "weightExcluded"):
            declared_value = declared_total.get(key)
            if _is_num(declared_value) and abs(
                float(declared_value) - float(got[key])
            ) > WEIGHT_SUM_TOLERANCE:
                errs.append({"code": "total.%s-mismatch" % key,
                             "jsonPath": "total.%s" % key,
                             "expected": got[key], "actual": declared_value,
                             "fixHint": "声明的部分分元数据必须等于按契约复算的值"})
    return got


# --------------------------------------------------------------------------- #
# 指纹
# --------------------------------------------------------------------------- #
def load_algo(path: str):
    spec = importlib.util.spec_from_file_location("fingerprint_algo", path)
    if spec is None or spec.loader is None:
        raise ValueError("无法加载指纹算法模块：%s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "fingerprint"):
        raise ValueError("指纹算法模块必须提供 fingerprint(obj) -> str")
    return mod.fingerprint


def find_contract_dir(start: str) -> str | None:
    """自 start 起向上逐级查找 `contract/` 目录，也接受从当前工作目录查找。"""
    for base in (start, os.getcwd()):
        cur = os.path.abspath(base)
        for _ in range(10):
            cand = os.path.join(cur, "contract")
            if os.path.isdir(cand):
                return cand
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return None


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def run(kind: str, doc, schema: dict | None, schema_base: str | None,
        algo_path: str | None) -> tuple[dict, int]:
    errs: list = []
    clues: list = []
    checks: list = []
    skipped: list = []

    if not isinstance(doc, dict):
        raise SchemaError("待校验对象顶层必须是 JSON 对象，实际为 %s" % type(doc).__name__)

    # 1 · schema.structure
    if schema is None:
        skipped.append({"check": "schema.structure", "reason": "schema-not-provided"})
    else:
        before = len(errs)
        validate_schema(doc, schema, "$", errs, schema_base, schema)
        if kind == "review-result":
            check_structural_invariants(doc, errs)
        checks.append({"check": "schema.structure",
                       "status": "fail" if len(errs) > before else "pass"})

    is_rubric_doc = kind == "rubric"
    scores = doc.get("items") if is_rubric_doc else doc.get(SCORES_KEY)
    if not isinstance(scores, list):
        scores = []

    # 2 · weights.sum
    # 与其余检查一致，用 before 计数判定（不再扫全部累积错误，AUDIT P3-30）；
    # 且 `scores` 缺失或为空时**不跑**权重检查——否则会在「items 缺失」这个根因上
    # 追加一条内容是错的二次错误 `weight.sum = 0.0`（AUDIT P3-31）
    before_w = len(errs)
    wsum = None
    if isinstance(scores, list) and scores:
        wsum = check_weights(scores, errs, "items" if is_rubric_doc else SCORES_KEY)
    rubric = None if is_rubric_doc else doc.get("rubric")
    if isinstance(rubric, dict) and isinstance(rubric.get("items"), list) and rubric["items"]:
        check_weights(rubric["items"], errs, "rubric.items")
    checks.append({"check": "weights.sum",
                   "status": "fail" if len(errs) > before_w else "pass", "value": wsum})

    # 3 · band.levels（档位模型）
    before = len(errs)
    clue_before = len(clues)
    if is_rubric_doc:
        for i, it in enumerate(scores):
            if isinstance(it, dict):
                check_bands(it.get("levels"), errs,
                            "items[%d].levels" % i, clues)
    else:
        if isinstance(rubric, dict) and isinstance(rubric.get("items"), list):
            for i, it in enumerate(rubric["items"]):
                if isinstance(it, dict):
                    check_bands(it.get("levels"), errs,
                                "rubric.items[%d].levels" % i, clues)
        check_slots(scores, errs, rubric)
    checks.append({"check": "band.levels",
                   "status": "fail" if len(errs) > before else "pass",
                   "clues": len(clues) - clue_before})

    # 4 · evidence.present（Rubric 无证据概念，不适用 → 不产生该检查项，也不记降级）
    missing_ev = None
    if not is_rubric_doc:
        before = len(errs)
        missing_ev = check_evidence(scores, errs)
        checks.append({"check": "evidence.present",
                       "status": "fail" if len(errs) > before else "pass",
                       "missing": missing_ev})

    # 5 · total.recompute（同上，Rubric 无总分）
    recomputed = None
    if not is_rubric_doc:
        before = len(errs)
        recomputed = check_declared_total(doc, errs)
        checks.append({"check": "total.recompute",
                       "status": "fail" if len(errs) > before else "pass",
                       "value": (recomputed or {}).get("total")})

    # 6 · fingerprint.recompute（同上，Rubric 无指纹。
    #     注意：不适用 ≠ 降级——不得把它记进 skipped，否则 rubric 校验永远返回 3）
    if not is_rubric_doc:
        if algo_path is None:
            skipped.append({"check": "fingerprint.recompute",
                            "reason": "fingerprint-algo-not-provided"})
        else:
            try:
                fp = load_algo(algo_path)
                want = None
                prov = doc.get("provenance")
                if isinstance(prov, dict):
                    want = prov.get("resultFingerprint")
                got = fp(doc)
                if want is None:
                    errs.append({"code": "fingerprint.missing",
                                 "jsonPath": "provenance.resultFingerprint",
                                 "expected": "string", "actual": None,
                                 "fixHint": "缺少指纹字段"})
                    checks.append({"check": "fingerprint.recompute", "status": "fail"})
                elif got != want:
                    errs.append({"code": "fingerprint.mismatch",
                                 "jsonPath": "provenance.resultFingerprint",
                                 "expected": want, "actual": got,
                                 "fixHint": "指纹与复算不一致：内容被改动过"})
                    checks.append({"check": "fingerprint.recompute", "status": "fail"})
                else:
                    checks.append({"check": "fingerprint.recompute",
                                   "status": "pass", "value": got})
            except Exception as exc:  # noqa: BLE001
                errs.append({"code": "fingerprint.algo-error", "jsonPath": "$",
                             "expected": "可加载", "actual": str(exc),
                             "fixHint": "检查算法模块路径与 fingerprint 函数"})
                checks.append({"check": "fingerprint.recompute", "status": "fail"})

    errs.sort(key=lambda e: (e["code"], e["jsonPath"]))
    # 退出码优先级（P1-11 的最终裁决）：**`skipped` 非空优先返回 3**。
    # 依据 L1「未知优于否定」——校验没跑全时，错误清单本身也不可靠：
    # 既可能误报，也没有覆盖未跑的检查项。此时应报「本次校验不完整，其结果不可作为判定依据」，
    # 而不是报一个看似终局的「不合规」。为不丢信息，`errors` / `skipped` 始终逐条留在输出里，
    # 并额外给 `exitReason` 与 `degraded` 两个机器可读字段标明本次到底发生了什么。
    if skipped:
        exit_reason = "errors-degraded" if errs else "degraded"
    elif errs:
        exit_reason = "errors"
    else:
        exit_reason = "ok"
    out = {
        "tool": "T5",
        "kind": kind,
        "valid": not errs,
        "exitReason": exit_reason,
        "degraded": bool(skipped),
        "errors": errs,
        "checks": checks,
        "skipped": skipped,
        "clues": clues,
        "recomputed": recomputed,
    }
    if skipped:
        return out, 3
    if errs:
        return out, 1
    return out, 0


def _self_test() -> int:
    item_props = {
        "rubricItemId": {"type": "string", "minLength": 1},
        "weight": {"type": "number", "minimum": 0, "maximum": 100},
        "maxScore": {"type": "number", "exclusiveMinimum": 0},
        "score": {"oneOf": [{"type": "number", "minimum": 0}, {"type": "null"}]},
        "level": {"$ref": "#/$defs/Lvl"},
        "needsReview": {"type": "boolean"},
        "pending": {"type": "boolean"},
        "evidence": {"type": "array"},
    }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["schemaVersion", "scores", "totalScore"],
        "properties": {
            "schemaVersion": {"type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"},
            "scores": {
                "type": "array", "minItems": 1,
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["rubricItemId", "weight", "maxScore", "score"],
                    "properties": item_props,
                },
            },
            "totalScore": {"type": "number", "minimum": 0, "maximum": 100},
            "total": {
                "type": "object", "additionalProperties": False,
                "required": ["weightIncluded", "weightExcluded", "upperBound",
                             "isPartial", "grade"],
                "properties": {
                    "weightIncluded": {"type": "number"},
                    "weightExcluded": {"type": "number"},
                    "upperBound": {"type": "number"},
                    "isPartial": {"type": "boolean"},
                    "grade": {"oneOf": [{"type": "string"}, {"type": "null"}]},
                },
            },
            "provenance": {
                "type": "object", "additionalProperties": False,
                "required": ["schemaVersion"],
                "properties": {"schemaVersion": {"type": "string"},
                               "resultFingerprint": {"type": "string"}},
            },
        },
        "$defs": {"Lvl": {"type": "string",
                          "enum": ["excellent", "meeting", "partial", "notMet"]}},
    }
    base = None  # 内联 schema：`#/...` 直接解析在当前根节点内

    def item(rid, w, ms, sc, level=None, **kw):
        d = {"rubricItemId": rid, "weight": w, "maxScore": ms, "score": sc,
             "needsReview": True}
        if level is not None:
            d["level"] = level
        d.update(kw)
        return d

    def mk(scores, total):
        return {"schemaVersion": "1.2.0", "scores": scores, "totalScore": total,
                "provenance": {"schemaVersion": "1.2.0"}}

    good = mk([item("R1", 60, 10, 8, "meeting"), item("R2", 40, 10, 7, "meeting")], 76.0)
    dirty = mk([item("R1", 60, 10, 12, "nope"), item("R1", 30, 10, 7)], 90.0)
    dirty["extra"] = 1
    bad_total = mk([item("R1", 60, 10, 8, "meeting"), item("R2", 40, 10, 7, "meeting")], 99.0)

    # 随包契约（指纹算法 / Rubric schema）：用于构造 `skipped` 为空的「满血」分支
    contract = find_contract_dir(HERE)
    algo = None
    rubric_schema = None
    rubric_base = None
    if contract:
        cand = os.path.join(contract, DEFAULT_FINGERPRINT_ALGO)
        if os.path.isfile(cand):
            algo = cand
        cand2 = os.path.join(contract, DEFAULT_SCHEMA_BY_KIND["rubric"])
        if os.path.isfile(cand2):
            rubric_schema = load_schema_file(cand2)
            rubric_base = os.path.abspath(cand2)

    def stamp(doc):
        """给「应通过」的用例盖上真实指纹，使其在满血态下真正零错误。"""
        if algo:
            doc["provenance"]["resultFingerprint"] = load_algo(algo)(doc)
        return doc

    stamp(good)

    checks = {}
    # 满血态（算法齐备 → skipped 为空）：有错报 1，无错报 0
    out_good, code_good = run("review-result", good, schema, base, algo)
    out_bad, code_bad = run("review-result", dirty, schema, base, algo)
    out_bt, code_bt = run("review-result", bad_total, schema, base, algo)
    # 降级态（缺指纹算法 → skipped 非空）
    out_skip, code_skip = run("review-result", good, schema, base, None)
    out_dskip, code_dskip = run("review-result", dirty, schema, base, None)

    checks["cleanFullRunIsZero"] = (
        code_good == 0 and out_good["valid"] is True and out_good["errors"] == []
        and out_good["skipped"] == [] and out_good["exitReason"] == "ok"
        and out_good["degraded"] is False
    )
    codes = {e["code"] for e in out_bad["errors"]}
    checks["dirtyFailsWithStructuredCodes"] = code_bad == 1 and {
        "schema.additionalProperties", "schema.enum", "weight.sum",
        "scores.duplicate-rubricItemId", "slot.score.range",
    } <= codes and out_bad["exitReason"] == "errors" and out_bad["degraded"] is False
    checks["totalMismatchDetected"] = (
        code_bt == 1 and "total.mismatch" in {e["code"] for e in out_bt["errors"]}
    )
    # P1-11 最终裁决：`skipped` 非空一律返 3（校验不完整优先，依据 L1），
    # 但 `errors` 与 `skipped` 都必须逐条留在输出里，信息不丢
    checks["cleanDegradedIsThree"] = (
        code_skip == 3 and out_skip["valid"] is True and out_skip["errors"] == []
        and out_skip["exitReason"] == "degraded" and out_skip["degraded"] is True
        and [s["reason"] for s in out_skip["skipped"]] == ["fingerprint-algo-not-provided"]
    )
    dskip_codes = {e["code"] for e in out_dskip["errors"]}
    checks["degradedTakesPrecedenceButKeepsErrors"] = (
        code_dskip == 3 and out_dskip["exitReason"] == "errors-degraded"
        and out_dskip["degraded"] is True and out_dskip["valid"] is False
        and {"schema.additionalProperties", "weight.sum"} <= dskip_codes
    )

    # 声明的 total 元数据与复算不符 → 必须报出（否则 weightIncluded / upperBound 可一起写错而自洽）
    bad_meta = mk([item("R1", 60, 10, 8, "meeting"), item("R2", 40, 10, 7, "meeting")], 76.0)
    bad_meta["total"] = {"weightIncluded": 0, "weightExcluded": 0, "upperBound": 0,
                         "isPartial": False, "grade": None}
    out_meta, code_meta = run("review-result", bad_meta, schema, base, algo)
    mcodes = {e["code"] for e in out_meta["errors"]}
    checks["declaredTotalMetaRecomputed"] = (
        code_meta == 1
        and "total.weightIncluded-mismatch" in mcodes
    )
    good_meta = mk([item("R1", 60, 10, 8, "meeting"), item("R2", 40, 10, 7, "meeting")], 76.0)
    good_meta["total"] = {"weightIncluded": 100, "weightExcluded": 0, "upperBound": 100,
                          "isPartial": False, "grade": None}
    stamp(good_meta)
    out_gm, code_gm = run("review-result", good_meta, schema, base, algo)
    checks["declaredTotalMetaCleanPasses"] = out_gm["errors"] == [] and code_gm == 0

    # P3-30/P3-31：scores 缺失时只报「缺 scores」这一个根因，
    # 不得追加一条内容是错的二次错误 weight.sum = 0.0
    out_ns, code_ns = run("review-result",
                          {"schemaVersion": "1.2.0", "totalScore": 0,
                           "provenance": {"schemaVersion": "1.2.0"}}, schema, base, algo)
    codes_ns = [e["code"] for e in out_ns["errors"]]
    checks["missingScoresNoMisleadingWeightError"] = (
        code_ns == 1 and "schema.required" in codes_ns and "weight.sum" not in codes_ns
        and next(c for c in out_ns["checks"] if c["check"] == "weights.sum")["value"] is None
    )
    out_es, code_es = run("review-result",
                          {"schemaVersion": "1.2.0", "scores": [], "totalScore": 0,
                           "provenance": {"schemaVersion": "1.2.0"}}, schema, base, algo)
    codes_es = [e["code"] for e in out_es["errors"]]
    checks["emptyScoresNoMisleadingWeightError"] = (
        code_es == 1 and "schema.minItems" in codes_es and "weight.sum" not in codes_es
    )

    # 未知关键字必须 exit 2（禁止静默跳过）
    try:
        run("review-result", good, {"type": "object", "uniqueItems": True}, base, None)
        checks["unknownKeywordIsSchemaError"] = False
    except SchemaError:
        checks["unknownKeywordIsSchemaError"] = True
    # 顶层不是对象 → SchemaError，不得抛未捕获异常
    try:
        run("review-result", [1, 2], schema, base, None)
        checks["nonObjectTopLevelRejected"] = False
    except SchemaError:
        checks["nonObjectTopLevelRejected"] = True

    # 档位：非严格单调 → 硬错误；四档不齐 / 用词含糊 → 只是线索（不改退出码）
    # 用随包 Rubric schema 校验，使 skipped 为空（Rubric 文档不适用指纹、证据、总分）
    rub = {
        "id": "r1", "version": "1.0.0", "title": "t",
        "items": [{
            "id": "R1", "name": "n", "weight": 100, "maxScore": 10,
            "evidenceRequirement": "e", "deductionNotes": "d",
            "levels": [
                {"level": "notMet", "label": "未达标", "criterion": "内容完整", "scoreRatio": 0.5},
                {"level": "excellent", "label": "优秀",
                 "criterion": "覆盖全部要点并给出反例", "scoreRatio": 0.4},
            ],
        }],
    }
    out_rub, code_rub = run("rubric", rub, rubric_schema, rubric_base, None)
    rcodes = {e["code"] for e in out_rub["errors"]}
    clue_codes = {c["code"] for c in out_rub["clues"]}
    checks["bandMonotonicityEnforced"] = (
        code_rub == 1 and "band.ratio-not-monotonic" in rcodes
        and "band.vague-criterion" in clue_codes
        and "band.incomplete-levels" in clue_codes
    )
    # 合规档位不得报错
    rub_ok = json.loads(json.dumps(rub))
    rub_ok["items"][0]["levels"] = [
        {"level": "excellent", "label": "优秀", "criterion": "覆盖全部要点并给出反例",
         "scoreRatio": 1.0},
        {"level": "meeting", "label": "达标", "criterion": "覆盖全部要点", "scoreRatio": 0.8},
        {"level": "partial", "label": "部分达标", "criterion": "覆盖部分要点", "scoreRatio": 0.5},
        {"level": "notMet", "label": "未达标", "criterion": "未覆盖要点", "scoreRatio": 0.0},
    ]
    out_rub_ok, code_rub_ok = run("rubric", rub_ok, rubric_schema, rubric_base, None)
    checks["bandCleanRubricPasses"] = out_rub_ok["errors"] == [] and out_rub_ok["clues"] == []

    print(json.dumps({"tool": "T5", "checks": checks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T5 契约校验器（contract-validator）")
    ap.add_argument("--kind", default="review-result", choices=["rubric", "review-result"])
    ap.add_argument("--input")
    ap.add_argument("--schema", help="缺省自随包 contract/ 目录解析")
    ap.add_argument("--fingerprint-algo", help="缺省自随包 contract/ 目录解析")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.input:
        print(json.dumps({"tool": "T5", "error": "need --input"}, ensure_ascii=False))
        return 2
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"tool": "T5", "error": str(exc)}, ensure_ascii=False))
        return 2

    contract_dir = find_contract_dir(HERE)
    schema_path = args.schema
    if not schema_path and contract_dir:
        cand = os.path.join(contract_dir, DEFAULT_SCHEMA_BY_KIND[args.kind])
        if os.path.isfile(cand):
            schema_path = cand
    algo_path = args.fingerprint_algo
    if not algo_path and args.kind != "rubric" and contract_dir:
        cand = os.path.join(contract_dir, DEFAULT_FINGERPRINT_ALGO)
        if os.path.isfile(cand):
            algo_path = cand

    schema = None
    schema_base = None
    if schema_path:
        try:
            schema = load_schema_file(schema_path)
            schema_base = os.path.abspath(schema_path)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"tool": "T5", "error": str(exc)}, ensure_ascii=False))
            return 2

    try:
        out, code = run(args.kind, doc, schema, schema_base, algo_path)
    except SchemaError as exc:
        print(json.dumps({"tool": "T5", "error": str(exc), "kind": "schema-error"},
                         ensure_ascii=False))
        return 2
    except json.JSONDecodeError as exc:
        print(json.dumps({"tool": "T5", "error": str(exc)}, ensure_ascii=False))
        return 2

    out["schemaPath"] = schema_path
    out["fingerprintAlgoPath"] = algo_path
    payload = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True)
    if args.out:
        # 与 T1 / T2 / T3 / T6 一致：写输出失败也必须是结构化报错 + 退出码 2，
        # 不得裸 traceback（tools/README §八 的全局约定覆盖全部六脚本）
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload + "\n")
        except OSError as exc:
            print(json.dumps({"tool": "T5", "error": "写输出失败：%s" % exc,
                              "kind": "output-error"}, ensure_ascii=False))
            return 2
    else:
        print(payload)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
