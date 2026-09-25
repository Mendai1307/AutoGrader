# W1 · 五 Agent 编排规格

> 对应《步骤路径规划书》**1.4.1**：`Parser → Evidence → Grader → Reviewer → Feedback`，
> 每环的**输入 / 输出 / 置信度 / 证据引用**齐备。
>
> 本文件只**汇总**既有设计，不新增能力：每一环的职责来自 `../skills/S*.md`，
> 确定性能力来自 `../tools/T*.md`，字段落点来自 `contract/ReviewResult.schema.json`。

---

## 一、总览与映射

**五环是「同一份报告的认知流水线」，不是五个独立接口。** 每环只做一件事，
把「原始报告」逐级变成「可复算的评阅结论 + 可回链的证据」。

| # | Agent | 承担的 Skill | 依赖 Tool | 契约落点 |
|---|---|---|---|---|
| 1 | **Parser** | `S2` 报告解析 | **T1** 文档解析器 | `steps[].agent = "parser"`；产出供后续所有环节使用的坐标源 |
| 2 | **Evidence** | `S3` 证据取证与逐点判定（**取证段**） | **T2** 客观核查器、**T3** 引用解析器 | `steps[].agent = "evidence"`；`doubts[]` |
| 3 | **Grader** | `S3`（**判定段**）+ `S4` 总分计算 | **T3**（取证闸门）、**T4** 确定性计算器 | `steps[].agent = "grader"`；`scores[]`、`totalScore`、`total` |
| 4 | **Reviewer** | `S5` 结构装配与自检（对内 Agent 即 Reviewer） | **T5** 契约校验器 | `steps[].agent = "reviewer"`；`review`、`selfCheck`、`reviewMeta` |
| 5 | **Feedback** | `S6` 评语生成 | —（不依赖工具） | `steps[].agent = "feedback"`；`feedback` |

> `S7 复核与解释` **不属于这五环**：入口 A 服务于模式 2 内的**教师复核节点**（人，不是环），
> 入口 B 服务于模式 3（评阅完成后的只读回放）。见 `../skills/S7-review-checklist.md`。

**两条贯穿约束**（对每一环都成立，故不重复写在环里）：

1. **契约先行**：任一环的产出都要能装进 `ReviewResult`，不得自创字段
2. **坐标不丢**：凡引用原文，必须同时带 `blockRef{blockId, anchor, digest}`——丢掉坐标的引用等于没有引用

---

## 二、逐环规格

每环四栏：**输入**（拿到什么）、**输出**（交出什么）、**置信度**（怎么来、写进哪）、**证据引用**（怎么来、怎么保证忠实）。

### 1 · Parser

| 栏 | 内容 |
|---|---|
| **输入** | 报告文件（`docx` / `pdf` / `md` / `txt`）；Rubric（决定重点解析哪些结构）；教师已给出的任何判断 |
| **输出** | ① `structure` 章节树；② `blocks[]`——每块含 `blockId` / `kind` / `anchor` / `page` / **`rawText`（原文逐字）** / `text`（空白规范化）；③ `failures[]` 失败位置清单；④ `summary` 统计特征；⑤ `emptyHeadingParagraphs` |
| **置信度** | 本环**不产出评分置信度**（还没到判定）。解析的可靠程度用 `status`（`ok` / `partial` / `failed`）+ `failures[]` 表达；**「未解析」不得被读成「缺失」** |
| **证据引用** | 本环是**全部引用的坐标源头**：后续每一处 `evidence[].blockRef` 都锚在这里。`rawText` 是逐字栏，`text` 只供统计——**引用一律取 `rawText`** |

**硬闸门**：正文非空但一个标题都没识别出来时，必须写入 `failures`（`structure-not-recognized`）并降级 `status`，**禁止报 ok**
——否则下游 T2 会把「未识别」扩写成「章节全缺失」，那是主动的否定断言（违反 L1）。

### 2 · Evidence

| 栏 | 内容 |
|---|---|
| **输入** | Parser 的 `blocks[]` / `structure`；Rubric；教师已给出的判断（**优先级最高**） |
| **输出** | ① 逐评分点的**候选引用**列表（`{"items": [{pointId, anchor \| blockId \| quote}]}`）；② 客观事实（由 T2 按规则集产出）；③ `doubts[]` 疑点清单 |
| **置信度** | 给出**初始置信度**（0–1）。判据：证据是否存在、是否逐字命中、规则是否覆盖。**无证据不得给高置信** |
| **证据引用** | 候选引用**必须经 T3 校验**：`resolved[].valid` → `evidence[].citationValid`；`resolved[].exactText` → `evidence[].quote`；`resolved[].blockTextDigest` → `evidence[].blockRef.digest`。**`rejected[]` 里的项一律不得进入 `evidence[]`** |

**硬闸门**：T3 是「证据不得改写 / 拼接 / 用类似表述冒充引用」这条纪律的**唯一硬闸门**。
T3 退出码非 0（存在无效项或歧义命中）时，**不得继续当作有效证据**——要么换坐标，要么降置信 / 标待复核。

### 3 · Grader

| 栏 | 内容 |
|---|---|
| **输入** | Evidence 的逐项证据包与置信度；Rubric（`maxScore` / `weight` / `levels[]`）；教师终判分（若教师已参与复核） |
| **输出** | ① `scores[]`——每项含 `rubricItemId` / `itemName` / `weight` / `maxScore` / `level` / `levelScoreRatio` / `score` / `suggestedScore` / `deductionReason` / `evidence[]` / `confidence` / `needsReview` / `pending`；② `totalScore`（**部分分，下界**）；③ `total`（`weightIncluded` / `weightExcluded` / `upperBound` / `isPartial` / `grade`） |
| **置信度** | 逐项 `confidence`（0–1）。**低置信 → `needsReview = true`，仍然交付**（不阻塞），但若尚无终值则同时 `pending = true`（**不计入总分求和**）。两者**语义正交**，不得互相替代 |
| **证据引用** | 每项 `evidence[]` 的 `quote` **逐字取自 T1 `rawText`**；`citationValid` 取 T3 结果；`blockRef` 三项齐全 |

**硬闸门**：**所有数字必须由 T4 产出，不接受口算。**
口径写死：`总分 = Σ (score / maxScore) × weight`；上界 = 已计入权重合计（**不是** `100 − W_r`）；
等级仅在 `W_r = 0` 且已计入权重合计 = 100 时映射。输入变则**重算**，不得沿用缓存。

### 4 · Reviewer

| 栏 | 内容 |
|---|---|
| **输入** | `S1` / `S3` / `S4` / `S6` 任一环节的产出（装配前的片段） |
| **输出** | ① 通过校验的完整 `ReviewResult`；或② 限定轮次后仍失败时的「**结构化失败 + 待人工**」标记；③ `selfCheck`（六项结论）；④ `review`（AI 自检记录）；⑤ `steps[]` |
| **置信度** | `review.overallConfidenceBefore` / `overallConfidenceAfter`——**AI 自检前后**的整体置信度，用于呈现自检是否改变了把握程度 |
| **证据引用** | 本环**只校验合规性，不改写任何判断内容**。六项检查：`schema.structure` / `weights.sum` / `band.levels` / `evidence.present` / `total.recompute` / `fingerprint.recompute`，**任一失败即整体失败**（fail-fast） |

**硬闸门**：**`skipped` 非空即视为不通过**（退出码 3）；按错误清单重试须**限定轮次**，仍失败标「待人工」，**不得降级放行**。
`clues[]`（档位四档不齐、判据用词含糊）是**线索不是错误**，不阻塞交付但须转交 S7 / 提示教师。

### 5 · Feedback

| 栏 | 内容 |
|---|---|
| **输入** | Evidence 的证据四元组；Grader 的总分与计算明细；**总分来源二选一**（教师参与了复核 → 教师终判分；未参与 → AI 建议分）；教师选定的措辞档位（中性 / 鼓励 / 严格） |
| **输出** | `feedback`：`overall` / `strengths[≥1]` / `improvements[≥1]` / `tone` |
| **置信度** | **不引入新的置信度**。低置信项在措辞上体现为「本次未确认」这类中性说法，而不是给它编一个确定结论 |
| **证据引用** | **每一句评价性语言都必须挂回「评分点 + 证据」**；无证据的只能写成「报告中未找到相关内容」 |

**硬闸门**：两种总分来源必须走**同一套生成规则、输出结构完全一致**——不得让「教师不参与」变成降级输出。
不生成涉及学术诚信与学生个人情况的表述。

---

## 三、环与环之间的交接物

| 从 → 到 | 交接物 | 形状 |
|---|---|---|
| Parser → Evidence | 结构块 | `t1.json`（T1 输出对象） |
| Evidence → Grader | 候选引用 + T3 结论 + T2 事实 | `items[]` + `t3.json`（`resolved[]` / `rejected[]`）+ `t2.json`（`facts[]` / `notCovered[]`） |
| Grader → Reviewer | 逐项评分 + 总分 | `scores[]` + `totalScore` + `total`（可先用 T4 `--mode total` 校验一遍） |
| Reviewer → Feedback | 通过校验的 `ReviewResult` | 完整契约对象 |
| 任一环 → `steps[]` | 该环的摘要 | `{step, agent, inputSummary, outputSummary, confidence, note?}` |

> 交接物**全部是文件或结构化片段**（不是「上一轮说了什么」）——这是「多会话分环」能成立的前提（见 `W2`）。

---

## 四、对应 Skill / Tool 的规格

- Skills：`../skills/S2-report-parser.md`、`S3-evidence-grader.md`、`S4-score-calculator.md`、
  `S5-contract-assembler.md`、`S6-feedback-writer.md`
- Tools：`../tools/T1-document-parser.md`、`T2-rule-inspector.md`、`T3-citation-resolver.md`、
  `T4-deterministic-calculator.md`、`T5-contract-validator.md`
- 契约：`contract/ReviewResult.schema.json`（`steps[].agent` 的枚举即上表五值）
