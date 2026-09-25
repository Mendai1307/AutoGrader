# AutoGrader · ReviewResult 契约说明（冻结版 1.1.0）

> **状态**：✅ **已冻结**（2026-09-25，路径 0.1 + 路径 0.3 同时闭合）
> **冻结基线**：v0.1 `frontend/lib/schema.ts`（589 行 Zod 契约，`SCHEMA_VERSION = '1.0.0'`）
> **路线**：以 v0.1 为基线的**向后兼容超集**——新增字段一律 optional，故 12 份历史资产一行不改。
> **机器可读真源**：`contract/ReviewResult.schema.json`、`contract/Rubric.schema.json`
> **本文件职责**：人类可读的口径说明。与机器 schema 冲突时，以**本文件 + schema** 同时修订为准，不得只改一处。

---

## 一、契约文件清单

| 文件 | 作用 |
|---|---|
| `contract/ReviewResult.schema.json` | 评阅结果契约（JSON Schema draft-07，含 `additionalProperties: false`） |
| `contract/Rubric.schema.json` | 评分量规契约（`--kind rubric` 用它的根；`ReviewResult.rubric` 也引用它） |
| `contract/fingerprint.py` | 结果指纹算法（路径 0.3 交付物，T5 通过 `--fingerprint-algo` 加载） |
| `contract/fingerprint.mjs` | 同一算法的 **JS 侧对照实现**（前端复算用，Web Crypto） |
| `docs/contract.md` | 本文件 |

**`$ref` 策略**：只使用**本地** `#/$defs/…` 与**同目录文件**引用（`Rubric.schema.json`）。
`ReviewResult.rubric` 用 `{"$ref": "Rubric.schema.json"}` 指向整份文件，**不复制** Rubric 定义——
避免「同一份结构写两处，改一处漏一处」。

---

## 二、版本与 `schemaVersion` 递增规范

- 语义化版本 `MAJOR.MINOR.PATCH`，形如 `^\d+\.\d+\.\d+$`
- **`1.0.0`** = v0.1 历史资产所遵循的版本；**`1.1.0`** = 本次冻结版本（新增 optional 字段 = MINOR）
- 递增规则：新增 **optional** 字段 → MINOR；新增 **required** 字段或改已有字段语义 → MAJOR；
  纯文档/注释修订 → PATCH
- ⚠️ 顶层 `schemaVersion` 与 `provenance.schemaVersion` **必须同时更新且一致**
  （由 T5 的 `schema.structure` 检查强制，错误码 `schemaVersion.mismatch`）
- Evaluation 层据 `schemaVersion` 区分新旧资产，见第七节

---

## 三、顶层字段表

标注：`[旧]` = v0.1 原样保留 ｜ `[窄]` = 字段名保留、语义收窄 ｜ `[新]` = 新增 optional

| 字段 | 类型 | 必填 | 标注 | 说明 |
|---|---|:--:|:--:|---|
| `schemaVersion` | string | ✅ | [旧] | 见第二节 |
| `taskType` | enum | — | [新] | `rubric-build` \| `review` \| `replay`（对应三种模式：1 建标 / 2 评阅 / 3 复核） |
| `report` | object | ✅ | [旧] | `{reportId, title, course, studentCode}`；`studentCode` 严禁真实姓名/学号 |
| `rubricVersion` | string | ✅ | [旧] | 必须与内嵌 `rubric.version` 一致 |
| `rubricRef` | object | — | [新] | `{id, digest}`；`digest` 建议复用指纹算法 |
| `rubric` | object | — | [旧] | 完整 Rubric 快照，见 `Rubric.schema.json` |
| `scores` | array | ✅ | [旧] | 逐项评分，`minItems: 1`，`rubricItemId` 不得重复 |
| `totalScore` | number | ✅ | [窄] | **语义收窄为**「按已生效终值求和的部分分」，0–100 |
| `total` | object | — | [新] | 部分分元数据，见第五节 |
| `review` | object | ✅ | [旧] | Reviewer（AI 自检）复核记录 |
| `feedback` | object | ✅ | [旧] | `{overall, strengths[≥1], improvements[≥1], tone}` |
| `steps` | array | ✅ | [旧] | 五 Agent 流水线，`minItems: 1` |
| `provenance` | object | ✅ | [旧] | 溯源与审计，含 `resultFingerprint` |
| `reviewMeta` | object | — | [新] | `{mode: teacher-participated \| ai-only, status: draft \| confirmed}` |
| `doubts` | array | — | [新] | S3 疑点清单 |
| `reviewChecklist` | array | — | [新] | S7 入口 A 产出的复核清单 |
| `selfCheck` | object | — | [新] | S5 三重校验结论 |

### 3.1 `scores[]`（ScoreItem）

| 字段 | 类型 | 必填 | 标注 | 说明 |
|---|---|:--:|:--:|---|
| `rubricItemId` | string | ✅ | [旧] | 原 `pointId`；**契约采用 v0.1 命名** |
| `itemName` | string | ✅ | [旧] | 原 `pointName` |
| `weight` | number 0–100 | ✅ | [旧] | 权重快照 |
| `maxScore` | number > 0 | ✅ | [旧] | 满分快照（教师自定标度） |
| `level` | enum | ✅ | [旧] | 建议档位 `excellent \| meeting \| partial \| notMet` |
| `levelScoreRatio` | number 0–1 | ✅ | [旧] | 档位得分系数快照；`score` 必须等于 `maxScore × levelScoreRatio` |
| `score` | number \| null | ✅ | [窄] | **终值**。`pending === true` 时允许 `null` |
| `suggestedScore` | number | — | [新] | **AI 建议分**（R2 必需） |
| `overriddenByTeacher` | boolean | — | [新] | 缺省 `false`（R2 必需） |
| `deductionReason` | string \| null | ✅ | [旧] | 满分时为 `null` |
| `evidence` | array | ✅ | [旧] | 允许空数组（「未找到证据」是合法结论，但须标 `needsReview`） |
| `confidence` | number 0–1 | ✅ | [旧] | |
| `needsReview` | boolean | ✅ | [旧] | 「需要教师看一眼」，**不影响总分** |
| `pending` | boolean | — | [新] | 缺省 `false`；「尚无终值，**不计入总分求和**」 |

### 3.2 `evidence[]` 与 `location`

| 字段 | 类型 | 必填 | 标注 | 说明 |
|---|---|:--:|:--:|---|
| `id` / `kind` / `quote` / `confidence` | — | ✅ | [旧] | `kind ∈ text \| code \| figure \| table`；`quote` 必须逐字 |
| `location` | object | ✅ | [旧] | `minProperties: 1`；`{section?, lineStart?, lineEnd?, figureNo?, tableNo?}` |
| `note` | string | — | [旧] | |
| `citationValid` | boolean | — | [新] | = T3 `resolved[].valid`；本域缺省表示「未经校验」 |
| `blockRef` | object | — | [新] | `{blockId, anchor, digest}` = T3 的 `blockId` / `anchor` / `blockDigest` |

### 3.3 其余子结构

| 结构 | 字段 | 标注 |
|---|---|---|
| `total` | `{weightIncluded, weightExcluded, upperBound, isPartial, grade}`（全部 required） | [新] |
| `Doubt` | `{rubricItemId✅, detail✅, kind?}` | [新] |
| `ChecklistEntry` | `{rubricItemId✅, confidence✅, rankKey?, pending?, note?}` | [新] |
| `SelfCheck` | `{schema✅, recompute✅, fingerprint✅, skipped[]?, errors[]?}`；状态值 ∈ `pass \| fail \| skipped` | [新] |
| `Rubric` | `{id, version, title, items[≥1]}` | [旧] |
| `RubricItem` | `{id, name, weight, maxScore, evidenceRequirement, levels[≥1], deductionNotes}` | [旧] |
| `RubricItemLevel` | `{level, label, criterion, scoreRatio}` | [旧] |

> ⚠️ **方案未定义内部字段的结构**：`Doubt` / `ChecklistEntry` / `SelfCheck` 的内部字段在
> 《契约冻结方案》中只给出了名字（`Doubt[]`、`ChecklistEntry[]`、`{schema, recompute, fingerprint, skipped[], errors[]}`），
> 未给出字段清单。本节按「最小可用形状」落定，其中 `Doubt` 与 `ChecklistEntry` 均为**最小集**
> （S3 的疑点、S7 的排序键可后续以 optional 字段追加，属 MINOR 变更）。

---

## 四、契约级不变式（JSON Schema 无法表达，由 T5 的 `schema.structure` 承担）

| # | 不变式 | 错误码 |
|---|---|---|
| I1 | `scores[].weight` 之和 = 100（容差 0.01） | `weight.sum` |
| I2 | 内嵌 `rubric.items[].weight` 之和 = 100 | `weight.sum` |
| I3 | 同一 `rubricItemId` 不得重复 | `scores.duplicate-rubricItemId` |
| I4 | 内嵌 `rubric.version === rubricVersion` | `rubric.version-mismatch` |
| I5 | 顶层 `schemaVersion === provenance.schemaVersion` | `schemaVersion.mismatch` |
| I6 | `pending === true` ⟹ `needsReview === true` | `pending.requires-needsReview` |
| I7 | `overriddenByTeacher === true` ⟹ `suggestedScore` 存在且 ≠ `score` | `overridden.suggestedScore.missing` / `overridden.same-as-suggested` |
| I8 | `total.isPartial === (total.weightExcluded > 0)` | `total.isPartial-mismatch` |
| I9 | `total.upperBound === total.weightIncluded` | `total.upperBound-mismatch` |
| I10 | `total.grade` 非 `null` ⟹ `weightExcluded === 0` 且 `weightIncluded === 100` | `total.grade-not-allowed` |
| I11 | `score <= maxScore`（number 时） | `slot.score.range` |
| I12 | `score === round2(maxScore × levelScoreRatio)`（容差 0.01） | `band.score-ratio-mismatch` |
| I13 | `total.weightIncluded` / `total.weightExcluded` **必须等于按契约复算的值** | `total.weightIncluded-mismatch` / `total.weightExcluded-mismatch` |

> I1–I4 是 v0.1 `superRefine` 的等价物；I5 是新增（v0.1 仅在注释中约定，未强制）；
> I11 / I12 来自 v0.1 的 `refine` 与 `verifyItemScore`；I6–I10 与 I13 为本次冻结新增。

> ⚠️ **I13 为什么必须有**：I9 只比对 `upperBound` 与 `weightIncluded` **彼此**。
> 若不校验它们与真实权重和的关系，两者可以**一起写错而互相自洽**——
> 例如把 `weightIncluded` 与 `upperBound` 都写成 0，I8 / I9 / I10 全部可以通过，
> 而「部分分必须携带 `W_r`」这条核心口径就落不了地。

---

## 五、总分口径与部分分语义

### 5.1 公式（写死，不得改写）

```
总分 = Σ (score / maxScore) × weight          —— 不是 Σ (score × weight / 100)
权重序列（和 = 100）：5 / 12 / 5 / 7 / 20 / 10 / 11 / 13 / 7 / 5 / 3 / 2
```

各评分点 `maxScore` 为**教师自定标度**，标度大小不影响占比；**占比只由 `weight` 决定**。

### 5.2 待复核项与部分分

- `pending === true` 的项**不计入**总分求和 → `totalScore` 是**部分分（下界）**
- **不做归一化**。理由：归一化会让「教师每确认一项」重新缩放分母，出现**认真复核反而掉分**的界面表现
- 求和的与须显式携带：`total.weightIncluded` / `total.weightExcluded`（`W_r`）

### 5.3 ⚠️ `upperBound` 的正确定义（本轮修正）

| | 旧表述 | 冻结表述 |
|---|---|---|
| 定义 | `100 − W_r` | **`Σ已计入 weight`（= `weightIncluded`）** |
| 权重和 = 100 时 | 与正确定义等价 | 等价 |
| 权重和 < 100 时 | **偏大**（和 = 60 时返回 100，而真实上限是 60） | 正确 |

**为什么错**：`100 − W_r` 只在权重和恰为 100 时与 `Σ已计入 weight` 相等。
部分分的取值范围是 `[0, Σ已计入 weight]`——因为每项贡献上限就是它的 `weight`。

### 5.4 等级映射

- **仅当** `weightExcluded === 0` **且** `weightIncluded === 100` 时才映射等级
- 否则 `grade = null`，并在 `gradeNote` 里说明原因（T4 输出）

---

## 六、语义正交的两组标记（易踩坑）

| 标记 | 语义 | 对总分的影响 | 谁在用 |
|---|---|---|---|
| `needsReview` | 该项**需要教师看一眼**（置信度 < 0.80 / 证据缺失 / 档位有争议） | **无** | S7 入口 A 排序 |
| `pending` | 该项**尚无终值**，不计入总分求和 | **有**（计入 `W_r`） | T4 总分、T5 的 I6 |

**为什么并存而不是合并**：12 份历史资产里凡 `needsReview: true` 的项（合计 30 项）若被当作 `pending`
处理，每份的 `totalScore` 都会变化 → 前端 `verifyTotalScore`（容差 0.01）**全数失败** →
前端会把 12 份资产全部误报为「结果已被修改」。

**不变式**：`pending === true` ⟹ `needsReview === true`；反之**不成立**
（可以「需要复核」但已有终值——例如教师复核过后仍标留意）。

---

## 七、评分档位模型：`levels[]` 而非 `bands[]`

档位由 **`RubricItemLevel { level, label, criterion, scoreRatio }`** 表达，
即「**语义等级 + 得分系数 + 可判定判据**」；得分关系 `score = maxScore × scoreRatio`。

**已废弃**：数值区间形式 `bands[]{from, to}`。理由：与 v0.1 的 `levels` **不可调和**
（一个是数值区间，一个是等级 + 系数；连键名都对不上），
且 T5 旧代码对真实 Rubric 取 `it.get("bands")` 恒为 `None`，档位检查**静默跳过**——
「修好死代码也什么都查不到」。

**「档位不重叠」在系数模型下的正确表达**是**系数严格单调**
（`excellent > meeting > partial > notMet`），取代区间重叠检测。

---

## 八、置信度分级

- 统一为 **0–1 浮点数**；禁止 0–100 整数或百分比字符串
- 阈值：`HIGH = 0.80`、`MEDIUM = 0.60`、`REVIEW = 0.80`（低于 0.80 触发复核）
- 分级语义：`high` 可直接采信 / `medium` 须经 Reviewer 复核 / `low` 必须复核且界面显著标注
- **无证据不得给高置信**（Prompt 级约束）；证据为空时 `needsReview` 必须为 `true`（契约级，I6 同族）

---

## 九、结果指纹算法（路径 0.3）

**算法（源自 v0.1 `schema.ts:371-376` docstring，本处为可执行移植）**

1. 深拷贝，把 `provenance.resultFingerprint` 置为 `""`（自指字段必须置空）
2. 递归按**键的字典序**排序所有对象
3. 所有数字按 **JS `round2`** 取 2 位小数
4. 序列化为**无空格 UTF-8 JSON**
5. 取 **SHA-256 十六进制小写**，前缀 `sha256:`

格式：`^(sha256:)?[0-9a-fA-F]{8,128}$`（沿用 v0.1，前缀可省、大小写不敏感）

### 9.1 三条跨语言规范化规则（缺一不可）

| # | 规则 | 为什么 |
|---|---|---|
| **R1 数字** | 先按 **JS `round2`** 取 2 位小数：`Math.round((v + Number.EPSILON) * 100) / 100`，`Number.EPSILON = 2.220446049250313e-16`。**禁止用 Python 内置 `round()`**——它是银行家舍入，在 `.xx5` 边界与 JS 的 half-up 分叉（`round(2.675, 2)` → `2.67`，JS → `2.68`）。序列化时整数不写小数点（`5.0` → `5`），小数去尾随零（`97.20` → `97.2`） | Python 与 JS 对同一 double 的默认输出不保证逐字相同 |
| **R2 `null` vs 缺失键** | **「字段不存在」= 不出现该键；「无值」= 显式 `null`**。两者不可混用。算法**保留**显式 `null`（参与哈希）、**不补键** | JS 的 `JSON.stringify` 丢弃 `undefined` 但保留 `null`；Python 无 `undefined` |
| **R3 键序** | 两侧都必须**递归排序**，不得依赖语言默认序 | JS 会把整数样式的键前置；Python 字典保插入序 |

### 9.2 实测结论（可复算）

- **12 / 12 份历史资产指纹复算与声明值逐一相等**
- **Python 与 JS 两侧对同一资产输出逐字相同**（12/12）
- Python 侧：`python3 contract/fingerprint.py --input <result.json> --check`
- JS 侧：`node contract/fingerprint.mjs --input <result.json> --check`

---

## 十、T5 的六项检查与 JSON Schema 子集

### 10.1 六项检查（与 S5 的「三重校验」对齐）

| # | `checks[].check` | 内容 |
|---|---|---|
| 1 | `schema.structure` | JSON Schema 断言 + 第四节全部不变式 |
| 2 | `weights.sum` | 权重和 = 100（`scores` 与内嵌 `rubric` 各一次） |
| 3 | `band.levels` | 档位：`levels` 非空、`level` 互斥、`scoreRatio` 严格单调、`criterion` 非空、系数与内嵌 rubric 一致、`score` 与档位一致 |
| 4 | `evidence.present` | 证据为空 ⟹ `needsReview === true`；`citationValid === false` 即该项证据作废 |
| 5 | `total.recompute` | 总分复算（**复用 T4 同一实现**，不另写口径） |
| 6 | `fingerprint.recompute` | 指纹复算（复用 `contract/fingerprint.py`） |

**`clues[]` 不是错误**：档位「四档不齐」与「判据用词含糊」（关键词黑名单，如「较好 / 一般 / 内容完整」）
只进 `clues`，**不改退出码**——严格的可判定性是 S1 的语义判断，T5 只做确定性部分。

### 10.2 支持的 JSON Schema 子集

- **断言**：`type`、`enum`、`const`、`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、
  `minLength`、`maxLength`、`pattern`、`minItems`、`maxItems`、`minProperties`、`maxProperties`、
  `properties`、`required`、`additionalProperties`、`items`、`oneOf`、`anyOf`、`allOf`、`not`、`$ref`
- **注解（读入不校验）**：`$schema`、`$id`、`title`、`description`、`$comment`、`examples`、`default`、
  `$defs`、`definitions`、`deprecated`、`readOnly`、`writeOnly`
- **`$ref` 范围**：仅本地 `#/…` 与同目录文件引用；不解析外部网络资源

> ⚠️ **硬约束**：用到**不支持的关键字**时，T5 必须 **`exit 2` + 结构化报错**，**禁止静默跳过**。
> 一份「以为自己校验了、其实没校验」的 schema 比没有 schema 更危险。

---

## 十一、与 T1 / T3 / T4 输出字段的映射表

### 11.1 T1 文档解析器 → `evidence[]`

| 契约字段 | 来源 |
|---|---|
| `evidence[].quote` | T1 `blocks[].text`（逐字，不得改写） |
| `evidence[].kind` | T1 `blocks[].kind` → 同名映射（`text/code/figure/table`；T1 另有 `heading`/`formula` 时不直接作为证据） |
| `evidence[].location.section` | T1 `blocks[].anchor` |
| `evidence[].location.lineStart/lineEnd` | 报告自身行号（T1 提供时） |
| `evidence[].blockRef.blockId` | T1 `blocks[].blockId` |
| `evidence[].blockRef.anchor` | T1 `blocks[].anchor` |
| `evidence[].blockRef.digest` | T3 `resolved[].blockDigest` |

> ⚠️ **T1 的 `anchor` 是顺序合成坐标**（如报告里的「一、实验原理」→ `anchor="1.1"`，
> 而报告自身的「1.1 设计思路」→ `anchor="2.1"`）。它与报告章节号**数值撞车但语义不同**。
> 映射进 `location.section` 时**必须同时写 `blockRef`**，否则教师界面上会把两者混淆。

### 11.2 T3 引用解析器

| | 内容 |
|---|---|
| 入参（候选引用） | `{"items": [{"pointId": "R1", "anchor": "1.2", "quote": "逐字原文"}, …]}` —— **顶层键是 `items`**；`pointId` 对应契约的 `rubricItemId` |
| 出参 `resolved[]` | `{pointId, valid, anchor, blockId, kind, exactText, blockDigest}` |
| 出参 `rejected[]` | `{pointId, reason}`，`reason ∈ anchor-not-found \| quote-mismatch \| anchor-out-of-range \| no-locator` |
| 与契约的对应 | `resolved[].valid` → `evidence[].citationValid`；`resolved[].exactText` → `evidence[].quote`；`blockId/anchor/blockDigest` → `evidence[].blockRef`。**`rejected[]` 里的项不得进入 `evidence[]`** |

### 11.3 T4 确定性计算器

| | 内容 |
|---|---|
| 入参 | 契约形状的 JSON，**顶层键 `scores[]`**（`--input`，兼容别名 `--items`）；逐项读 `rubricItemId` / `score` / `maxScore` / `weight` / `pending` / `confidence` / `needsReview` |
| `errorCost` | **非契约字段**：只在 `--mode rank` 用；缺省取该项 `weight`（出错代价与权重同阶） |
| 出参 | `total` / `weightIncluded` / `weightExcluded` / `upperBound`（= `weightIncluded`）/ `isPartial` / `grade` / `gradeNote` / `detail[]`（`--mode total`）；`ranked[]`（`--mode rank`） |
| 与契约的对应 | 出参 `total` → 契约 `totalScore`；`weightIncluded`/`weightExcluded`/`upperBound`/`isPartial`/`grade` → 契约 `total.*` |

### 11.4 打包落点

`agents/tools/` 是**开发期暂存落点**。打包时必须映射：
脚本 → `skills/<name>/scripts/` 或插件根 `bin/`；`contract/` 随包复制；
**不得**在 `agents/<agent>.md` 的 frontmatter 声明 `tools:` 字段（校验器判为硬错误）。

---

## 十二、迁移规则

1. **12 份历史资产一行不改**，继续通过 Zod 与 T5 双重校验（已实测 12/12）
2. **禁止自动回填 `suggestedScore`**：历史资产的 `score` 是「AI 直接给的分」，当时没有终值概念。
   把 `score` 复制成 `suggestedScore` 并置 `overriddenByTeacher: false`，等于**伪造一条「AI 建议 = 终值」的评测数据**，
   会让 Evaluation 的总分 MAE 与逐项命中率变成「自己跟自己比」，恒等于 0 误差
3. **用 `schemaVersion` 区分**：`1.0.0` = 历史，`1.1.0` = 新产出；
   差异数据（MAE / 命中率）**只对 `1.1.0` 资产计算**
4. **可以自动做的**（纯推导、不引入新信息）：按现有 `totalScore` 与 `scores[].weight` 推导
   历史资产的 `total` 子对象（`weightIncluded = 100`、`weightExcluded = 0`、`upperBound = 100`、`isPartial = false`），
   使前端对新旧资产同构渲染

---

## 十三、尚未闭合的外部要求

| # | 要求 | 状态 |
|---|---|---|
| **R1** | **读入既有 `ReviewResult` 的通道**（S7 模式 3「解释回放」的前置） | ⬜ **仍缺失**。候选：① 扩展 T6 资产库增加 `result` 类别；② 走平台内置读取能力。本契约冻结**不含**此项 |
| R2 | 契约逐项携带「AI 建议分 + 终值 + 是否被教师改」 | ✅ **已闭合**：`suggestedScore` + `score` + `overriddenByTeacher` 三字段到位，并由 I7 强制 |
