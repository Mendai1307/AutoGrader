# T5 · 契约校验器

| 项 | 内容 |
|---|---|
| Tool ID | T5 |
| 名称 | 契约校验器（`contract-validator`） |
| 形态 | 命令行脚本，python3，标准输出 JSON |
| 服务于 | S1 Rubric 构建、S5 结构装配与自检 |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 打包落点 | `skills/<skill-name>/scripts/` 首选；或插件根 `bin/` |
| 脚本 | [`scripts/contract_validator.py`](./scripts/contract_validator.py) |
| 契约 | `contract/ReviewResult.schema.json`、`contract/Rubric.schema.json`、`contract/fingerprint.py` |

## 职责

对 **Rubric** 与 **ReviewResult** 两类契约做合规性校验与事实性复算，产出**结构化错误清单**。

## 确定性边界

**做**：

- JSON Schema 结构校验（见「支持的 Schema 子集」）
- 六项检查（见下）
- 产出机器可读错误清单

**绝不做**：

- 改写、修补、补全任何内容——校验器只报告，不修复
- 判断分数是否「合理」
- 因为「只差一点点」而放行
- **遇到不认识的关键字就跳过**

> **校验通过 ≠ 判断正确。** 本工具只回答「合不合规」，不回答「判得对不对」。

## 六项检查（与 S5 的六项校验对齐）

| # | `checks[].check` | 内容 |
|---|---|---|
| 1 | `schema.structure` | JSON Schema 断言 + `docs/contract.md` 第四节全部不变式（权重和、重复 `rubricItemId`、`rubric.version`、`schemaVersion` 一致、`pending`⟹`needsReview`、`overriddenByTeacher`⟹`suggestedScore`、`total.isPartial`、`total.upperBound`、`total.grade` 门禁） |
| 2 | `weights.sum` | 权重和 = 100（容差 0.01）；`scores` 与内嵌 `rubric.items` 各一次 |
| 3 | `band.levels` | 档位模型：`levels` 非空、`level` 互斥、`scoreRatio` 严格单调、`criterion` 非空、系数与内嵌 rubric 一致、`score` 与档位系数一致、`score` 区间 |
| 4 | `evidence.present` | 证据为空 ⟹ `needsReview === true`；`citationValid === false` 即该项证据作废 |
| 5 | `total.recompute` | 总分复算（**复用 T4 同一实现**，不另写一套口径）；并比对**声明侧** `totalScore` / `total.weightIncluded` / `total.weightExcluded` 与复算值（`total.mismatch`、`total.weightIncluded-mismatch`、`total.weightExcluded-mismatch`） |
| 6 | `fingerprint.recompute` | 指纹复算（复用随包 `contract/fingerprint.py`） |

**`clues[]` 与 `errors[]` 分离**：档位「四档不齐」与「判据用词含糊」（关键词黑名单，如
「较好 / 一般 / 内容完整」）只进 `clues`，**不改退出码**——严格的可判定性是 S1 的语义判断，
T5 只做确定性部分，并在输出里明确标注这是**线索**不是结论。

**`--kind rubric` 只跑其中三项**：`schema.structure` / `weights.sum` / `band.levels`。
Rubric 没有证据、总分与指纹，**不适用 ≠ 降级**——后三项对 rubric 既不产生 `checks` 项，
也**不记入 `skipped`**（否则 rubric 校验会永远返回退出码 3）。

### 档位模型：`levels[]`，不是 `bands[]`

档位由 `RubricItemLevel { level, label, criterion, scoreRatio }` 表达
（语义等级 + 得分系数 + 可判定判据），`score = maxScore × scoreRatio`。

**数值区间形式 `bands[]{from,to}` 已废弃**：它与 `levels` 不可调和（一个数值区间、一个等级+系数，
连键名都对不上），且对真实 Rubric 取 `it.get("bands")` 恒为 `None` → 档位检查**静默跳过**。

**「档位不重叠」的正确表达是系数严格单调**（`excellent > meeting > partial > notMet`），
取代数值区间重叠检测。

## 输入

| 参数 | 说明 |
|---|---|
| `--kind <rubric\|review-result>` | 校验对象类型（缺省 `review-result`） |
| `--input <path>` | 待校验 JSON |
| `--schema <path>` | 可选；**缺省自随包 `contract/` 解析**（`Rubric.schema.json` / `ReviewResult.schema.json`） |
| `--fingerprint-algo <path>` | 可选；**缺省自随包 `contract/fingerprint.py`**；须提供 `fingerprint(obj) -> str` |
| `--out <path>` | 可选；结果写文件，缺省写标准输出 |

**缺省解析规则**：自脚本位置（以及当前工作目录）**向上逐级查找 `contract/` 目录**；
找到即按 `--kind` 取对应 schema 与指纹算法。找不到才降级。

### 完整入参样例

`--kind review-result`（顶层键即契约字段，无额外包裹键）：

```json
{
  "schemaVersion": "1.2.0",
  "report": {"reportId": "lab-report-2026-os-017", "title": "…",
             "course": "操作系统", "studentCode": "学生A"},
  "rubricVersion": "1.2.0",
  "scores": [
    {"rubricItemId": "R3", "itemName": "…", "weight": 20, "maxScore": 15,
     "level": "meeting", "levelScoreRatio": 0.8, "score": 12,
     "suggestedScore": 12, "overriddenByTeacher": false,
     "deductionReason": null, "confidence": 0.9, "needsReview": false,
     "evidence": [{"id": "E1", "kind": "code",
                   "location": {"section": "3 实验步骤", "lineStart": 42},
                   "quote": "逐字原文…", "confidence": 0.9,
                   "citationValid": true,
                   "blockRef": {"blockId": "b00031", "anchor": "4.2",
                                "digest": "sha256:…"}}]}
  ],
  "totalScore": 88.0,
  "total": {"weightIncluded": 100, "weightExcluded": 0,
            "upperBound": 100, "isPartial": false, "grade": "B"},
  "review": {"triggered": false, "triggerReason": null, "opinion": "…",
             "overallConfidenceBefore": 0.88, "overallConfidenceAfter": 0.88,
             "adjustments": []},
  "feedback": {"overall": "…", "strengths": ["…"], "improvements": ["…"],
               "tone": "neutral"},
  "steps": [{"step": 1, "agent": "parser", "inputSummary": "…",
             "outputSummary": "…", "confidence": 0.95}],
  "provenance": {"generatorAgent": "…", "generatedAt": "2026-09-25T20:00:00+08:00",
                 "sourceConversationId": "…", "sourceTurnId": "…",
                 "resultFingerprint": "sha256:…", "schemaVersion": "1.2.0"}
}
```

`--kind rubric`（根即 Rubric 对象）：

```json
{
  "id": "rubric-os-thread-lab",
  "version": "1.2.0",
  "title": "操作系统实验报告通用 Rubric（实验三）",
  "items": [
    {"id": "R3", "name": "核心代码正确性与规范", "weight": 20, "maxScore": 15,
     "evidenceRequirement": "完整源码块 + 关键 API 调用",
     "levels": [
       {"level": "excellent", "label": "优秀", "criterion": "覆盖全部要点并给出反例", "scoreRatio": 1.0},
       {"level": "meeting", "label": "达标", "criterion": "覆盖全部要点", "scoreRatio": 0.8},
       {"level": "partial", "label": "部分达标", "criterion": "覆盖部分要点", "scoreRatio": 0.5},
       {"level": "notMet", "label": "未达标", "criterion": "未覆盖要点", "scoreRatio": 0.0}
     ],
     "deductionNotes": "缺少环境版本扣 2 分"}
  ]
}
```

## 输出

单个 JSON 对象：

- `valid`：布尔
- `errors[]`：每项含 `code` / `jsonPath` / `expected` / `actual` / `fixHint`
- `checks[]`：六项检查的逐项结论（含通过项）
- `skipped[]`：因依赖缺失被跳过的检查
- `clues[]`：**线索**（非错误，不影响退出码）
- `recomputed`：`total` / `weightIncluded` / `weightExcluded` / `upperBound`
- `schemaPath` / `fingerprintAlgoPath`：本次实际使用的契约文件路径

**错误清单是对外契约**：每条必须带机器可读的 `code` 与 JSON 路径，
以便 S5 的「按错误清单重试」**直接消费**，无需再解析自然语言。

## 退出码与失败

| 码 | 含义 | 下游必须怎么做 |
|---|---|---|
| 0 | 全部校验通过（且无跳过项） | 可交付 |
| 1 | 校验失败（`errors` 非空） | **fail-fast**：按错误清单重试（限定轮次），仍失败标记「待人工」，**不得降级放行** |
| 2 | 输入不可读或畸形 / **schema 用了不支持的关键字** / `$ref` 不可解析 | 结构化报错 |
| 3 | 降级运行（有检查因依赖缺失被跳过） | **CI 门禁中视为不通过**——宁可显式降级，也不假装通过 |

**退出码优先级**：`errors` 非空 → `1`（即使同时存在 `skipped`）。二者并存时以 `1` 为准，
**但 `skipped` 仍必须逐条出现在输出里**，不得因为返回了 `1` 就把「有校验没跑」这件事隐去。

## 支持的 Schema 子集

- **断言**：`type`、`enum`、`const`、`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、
  `minLength`、`maxLength`、`pattern`、`minItems`、`maxItems`、`minProperties`、`maxProperties`、
  `properties`、`required`、`additionalProperties`、`items`、`oneOf`、`anyOf`、`allOf`、`not`、`$ref`
- **注解（读入不校验）**：`$schema`、`$id`、`title`、`description`、`$comment`、`examples`、`default`、
  `$defs`、`definitions`、`deprecated`、`readOnly`、`writeOnly`
- **`$ref` 范围**：仅本地 `#/…` 与**同目录文件**引用（如 `Rubric.schema.json`）；
  不解析外部网络资源

> ⚠️ **硬约束**：用到**不支持的关键字**时，必须 **`exit 2` + 结构化报错**，**禁止静默跳过**。
> 一份「以为自己校验了、其实没校验」的 schema 比没有 schema 更危险。
> 需要新关键字时，**显式扩展本子集并同步本表**，不得靠容错绕过。

## 依赖与实现约束

- 禁止网络与 AI 调用；纯函数
- 总分复算**必须复用 T4**，不得另写一套口径
- 指纹复算与总分复算均须可独立运行、可单独报错
- `additionalProperties: false` 是契约最强的防幻觉机制（对应 v0.1 的 `.strict()`），必须生效

## 前置依赖（已冻结）

| 依赖 | 状态 | 出处 |
|---|---|---|
| `ReviewResult` / `Rubric` schema | ✅ **已冻结**，随包于 `contract/` | 路径 0.1 |
| 指纹算法 | ✅ **已冻结**，随包于 `contract/fingerprint.py` | 路径 0.3 |
| 权重序列（和 = 100）：`5/12/5/7/20/10/11/13/7/5/3/2` | ✅ 已冻结，已内置 | 路径 0.2 |

**实测结论**：12 份历史资产在随包契约下 **12/12 通过全部六项检查，`skipped` 为空**（退出码 0）。
契约冻结后**不再有降级态**，无需外部传入 `--schema` / `--fingerprint-algo`。

## 对应 Skill

S1 · Rubric 构建（经 S5）｜S5 · 结构装配与自检
