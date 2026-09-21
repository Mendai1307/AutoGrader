# 五 Agent 流水线总览

> 本文说明 AutoGrader 评阅能力的**执行结构**：五个 Agent 如何分工、如何交接、
> 置信度如何传递、什么情况下触发复核。
>
> **最重要的前提**：这五个 Agent 的**执行者是 LearnBuddy 平台**（开发期对话侧），
> 不是 `backend/` 里的任何进程。`backend/agents/` 下存放的是五个 Agent 的 **prompt 规格文档**
> （`parser.md` / `evidence.md` / `grader.md` / `reviewer.md` / `feedback.md`），
> **不含任何模型调用代码**，也不依赖 `openai` / `anthropic` / `langchain-*`。
>
> 配套文档：[`architecture.md`](architecture.md)（架构与数据流）、[`contract.md`](contract.md)（数据契约）、
> [`prompt-design.md`](prompt-design.md)（prompt 设计原则）、[`testing.md`](testing.md)（验证说明）。

---

## 一、总览

```
报告原文（Markdown）
   │
   ▼
[1] Parser   ── 解析结构：章节树 / 代码块 / 插图 / 表格            → steps[0]
   │
   ▼
[2] Evidence ── 对齐 12 个评分点，逐点摘录可引用的原文（逐字）      → steps[1] + Evidence[]
   │
   ▼
[3] Grader   ── 先定档位、再由档位系数算分，汇总加权总分           → steps[2] + ScoreItem[] + totalScore
   │
   ▼
[4] Reviewer ── 对低把握判定做二次复核（唯一可改分的环节）         → steps[3] + ReviewRecord（含 adjustments[]）
   │
   ▼
[5] Feedback ── 转译为学生可读的评语（总体评价 / 亮点 / 改进建议） → steps[4] + ReviewFeedback
   │
   ▼
编排层 ── 补齐 provenance、计算结果指纹、落盘 result-{reportId}.json
```

一句话记忆：**Parser 找位置 → Evidence 找证据 → Grader 定档算分 → Reviewer 复核把关 → Feedback 说人话。**

| # | Agent | 中文职能 | 一句话职责 | 输入 | 输出 |
|---|---|---|---|---|---|
| 1 | Parser | 报告解析 | 把原始报告切分为结构化章节树，并定位代码块与插图 | 报告原文 | 章节树 · 代码块 · 插图索引 |
| 2 | Evidence | 证据提取 | 对齐评分点，逐点定位可引用的原文片段，逐字摘录不改写 | 章节树 + Rubric | 证据条目（text/code/figure/table）+ 单条置信度 |
| 3 | Grader | 逐项评分 | 按档位判定标准与扣分梯度给出档位、得分与判定置信度 | 证据条目 + 档位标准 | 逐项得分 + 加权总分 + 档位分布 |
| 4 | Reviewer | 复核质检 | 对置信度低于 0.80 的判定做二次比对，上调置信度或改判档位 | 低置信度判定 + 证据原文 | 复核意见 + 置信度变化（before → after） |
| 5 | Feedback | 评语生成 | 汇总评分明细与复核意见，产出面向学生的亮点与可执行建议 | 评分明细 + 复核意见 + 证据摘要 | 评语（总体评价 / 亮点 / 改进建议） |

> 该表与前端 `/trace` 页面展示的五 Agent 元信息同源（`frontend/lib/constants.ts` 的 `AGENTS`），
> 因此文档描述与实际界面不会出现口径分裂。

---

## 二、串接关系与交接物（契约级）

每一步在 `ReviewResult.steps[]` 中留下一条 `ReviewStep` 记录 —— 这正是 `/trace` 页面
回答"AI 是不是黑箱"的数据来源。

| 步骤 | `step` | `agent` | 交付给下游的东西 | 进入契约的字段 |
|---|---|---|---|---|
| Parser | 1 | `parser` | 章节树 / 代码块索引 / 插图索引 / 表格索引（**工作交接格式，不落盘**）+ 报告元信息 | `report`、`steps[0]` |
| Evidence | 2 | `evidence` | 按评分点分组的 `Evidence[]` | `steps[1]`（证据明细最终挂在 `ScoreItem.evidence[]` 下） |
| Grader | 3 | `grader` | `ScoreItem[]` + `totalScore` | `scores`、`totalScore`、`steps[2]` |
| Reviewer | 4 | `reviewer` | 复核记录；并**回写** `scores[]`（若改判） | `review`、`steps[3]` |
| Feedback | 5 | `feedback` | 学生评语 | `feedback`、`steps[4]` |
| 编排层 | — | — | `provenance`（含结果指纹） | `provenance` |

**两点须注意的契约事实**：

1. 契约中**没有独立的"章节树"字段**。Parser 的结构化产物只用于环节间交接，
   对外仅以 `steps[0].outputSummary` 的量化摘要形式出现 —— 不要臆造一个不存在的字段。
2. 契约中**没有 "fp" / "rp" 字段**。审计能力由 `provenance`（四件套）、
   `ReviewAdjustment`（置信度/分数的 before-after）、`ScoreItem.deductionReason` 与 `needsReview` 共同承载，
   详见 [`prompt-design.md`](prompt-design.md) 第四节。

---

## 三、置信度传递机制

置信度是流水线的"质量信号"，从最细粒度逐级收敛到一个整体值：

```
Evidence.confidence            单条证据的可信度（低清截图 / 仅有图题 → 0.60 量级）
        │
        ▼
ScoreItem.confidence           该项判定的置信度（证据充分度 + 档位清晰度）
        │
        ├──▶ ScoreItem.needsReview      < 0.80 即置 true（另有两类触发条件）
        │
        ▼
ReviewRecord.overallConfidenceBefore    各 ScoreItem 置信度的算术平均（2 位小数）
        │
        ├─ Reviewer 复核：上调 / 下调 / 改判
        ▼
ReviewRecord.overallConfidenceAfter     同一口径重算
        │
        ▼
steps[i].confidence                     各环节自身的交付质量（ReviewStep 无 needsReview 字段）
```

**分级阈值**（`schema.ts` 的 `CONFIDENCE_THRESHOLD`，三档语义见 `contract.md` 第三节）：

| 分级 | 区间 | 语义 | 是否触发复核 |
|---|---|---|---|
| HIGH 高 | `[0.80, 1.00]` | 证据充分且与评分点直接对应，可直接采信 | 否 |
| MEDIUM 中 | `[0.60, 0.80)` | 证据存在但不完整或有歧义，须复核后方可采信 | **是** |
| LOW 低 | `[0.00, 0.60)` | 证据薄弱或未找到有效证据，必须复核；复核后仍 < 0.60 须显著标注"建议教师人工确认" | **是** |

真实取值参考（`result-sample-01.json`）：Evidence 环节整体 0.86、Grader 0.87、Reviewer 0.87、Feedback 0.90；
逐项判定中 R7（0.76）、R12（0.78）低于 0.80 → 触发复核。

---

## 四、复核触发机制

### 4.1 三类触发条件（满足其一）

1. **置信度不足**：`ScoreItem.confidence < 0.80`（即 `needsReviewByConfidence()` 的口径）；
2. **证据缺失**：该评分点的 `evidence` 为空数组（表示"未找到证据"）；
3. **档位争议**：档位判定存在**跨两级**争议（如"优秀 or 部分达标"两可）。

只要存在任一条件命中的评分点，`ReviewRecord.triggered = true`，`triggerReason` 必须**逐项列明 id 与置信度**。

### 4.2 Reviewer 能做的三件事（且仅此三件）

| 动作 | `changed` | `scoreBefore` / `scoreAfter` |
|---|---|---|
| 维持档位、仅调整置信度 | `false` | 均为 `null` |
| 改判档位（同步改 `levelScoreRatio` / `score` / `deductionReason`，并重算 `totalScore`） | `true` | 填实际数值 |
| 维持原判但标注风险（建议教师人工核验） | `false` | 均为 `null` |

`sample-01` 的真实做法是第一种 + 风险提示：R7 `0.76 → 0.82`、R12 `0.78 → 0.86`，
整体置信度 `0.88 → 0.89`，**档位与得分一律未改**，且 R7 保留"建议教师核验截图真实性"的提示。

### 4.3 触发是常态而非例外（实测）

对 `frontend/public/results/` 全部 13 个 JSON 复算 `needsReviewByConfidence()` 的结果：

| 结果文件 | 置信度 < 0.80 的评分点 |
|---|---|
| `_example.json` | R3、R4 |
| `result-sample-01.json` | R7、R12 |
| `result-sample-02.json` | R7、R12 |
| `result-sample-03.json` | R5、R7、R12 |
| `result-sample-04.json` | R2、R5、R12 |
| `result-sample-05.json` | R7 |
| `result-sample-06.json` | R7、R9、R12 |
| `result-sample-07.json` | R1、R12 |
| `result-sample-08.json` | R11、R12 |
| `result-sample-09.json` | R7 |
| `result-sample-10.json` | R10、R12 |
| `result-sample-11.json` | R1、R4、R12 |
| `result-sample-12.json` | R2、R12 |

两点观察：

- **13 份文件的 `review.triggered` 全部为 `true`** —— 复核机制是被真实使用的，不是装饰；
- **R12「原创性」在 12 份中 12 次全部触发复核**：原创性属推断性判断，缺少直接文本证据，
  这正是复核环节存在的意义（也说明流水线没有为了"好看"而抬高置信度）。

---

## 五、反幻觉：全流水线统一红线

五个 Agent 各自文档中都有一节"反幻觉约束"，**核心是同一条**：

> **找不到证据时必须输出"未找到相关证据"，并判定为未达标（`notMet` / `score = 0`）；
> 严禁编造引用原文、行号、图号。**

各环节的具体落点：

| 环节 | 红线要点 |
|---|---|
| Parser | 缺章节写"未检出"；不编行号；不描述未随附图片的内容（只能依据图题判读） |
| Evidence | `quote` 必须逐字可检索；无证据就**不产出证据**并在 `note` 声明；不虚构位置 |
| Grader | 无证据 → `notMet` + `score = 0` + 理由写明"未找到相关证据"；不为了让分数好看而补证据 |
| Reviewer | 无法核实时**维持低置信**；不得以"复核过了"为由制造可信度；不得伪造 `changed` |
| Feedback | 评语中的一切引用必须来自结果文件；不替学生补全意图；不美化掩盖 `notMet` 与低置信度 |

支撑这套红线的工程手段（结构化契约、逐字引用、可机械复算）见 [`prompt-design.md`](prompt-design.md)。

---

## 六、与证据链的衔接

每个 Agent 的产物最终都落到"可审计"上：

```
对话侧：sourceConversationId / sourceTurnId   → 这份结果出自哪次对话、哪一轮
         generatorAgent / generatedAt         → 谁、何时产出
契约侧：schemaVersion                          → 用哪版契约解析（可复现）
完整性：resultFingerprint（SHA-256）           → 结果是否被改动过
过程侧：steps[0..4]（含 confidence 与 note）   → 每一环各自判断了什么
判分侧：evidence[].quote / location            → 每条结论的原文依据
复核侧：adjustments[] 的 before → after        → 哪些判定被复核、是否改分
```

`/trace` 页面用 `_example.json` 展开一条完整的溯源链样例；
`/report/[id]` 页面展示单份结果的逐项证据、复核记录、溯源信息，以及构建期的**分数自证**
（`verifyItemScore()` 单项档位复算 + `verifyTotalScore()` 总分口径复算）。
**当前前端只展示 `resultFingerprint`，未实现契约中建议的"一键复算指纹"**（详见 [`testing.md`](testing.md) 第五节）。
