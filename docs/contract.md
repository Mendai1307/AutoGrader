# ReviewResult 数据契约

> 面向人阅读的契约说明。机器可读版本在 [`frontend/lib/schema.ts`](../frontend/lib/schema.ts)，
> 可运行示例在 [`frontend/public/results/_example.json`](../frontend/public/results/_example.json)。
> 三者冲突时，**以 `schema.ts` 为准**，并同步修正本文档与示例。

本契约是全系统的枢纽，同时约束：

1. LearnBuddy 侧五 Agent 流水线（Parser → Evidence → Grader → Reviewer → Feedback）的输出格式；
2. 前端 TypeScript 类型（由 `z.infer` 从 schema 推导，禁止另写一份重复定义）；
3. 仓库内的静态 JSON 资产 `frontend/public/results/*.json`。

---

## 一、对象关系总览

```
ReviewResult                      顶层评阅结果
├── report        ReportMeta      报告元信息
├── rubric?       Rubric          rubric 完整快照（建议随结果固化）
│   └── items[]   RubricItem      评分点
│       └── levels[] RubricItemLevel  判定档位（优秀/达标/部分达标/未达标）
├── scores[]      ScoreItem       逐项评分
│   └── evidence[] Evidence       该项引用的证据
├── review        ReviewRecord    复核记录
│   └── adjustments[] ReviewAdjustment  逐项复核意见与置信度变化
├── feedback      ReviewFeedback  面向学生的评语
├── steps[]       ReviewStep      五 Agent 中间产物
└── provenance    ReviewProvenance 溯源与审计信息
```

通用约定：

- 全部对象使用 Zod `.strict()`，**未知字段一律拒绝**，防止 AI 自由发挥污染资产；
- 置信度统一为 **0–1 浮点数**，禁止 0–100 整数或百分比字符串；
- 金额/分数类数值统一保留 **2 位小数**；
- 学生身份一律使用**泛指代号**（如"学生A"），严禁真实姓名 / 学号 / 学校名。

---

## 二、字段语义与取值口径

### 2.1 ReviewResult（顶层）

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `schemaVersion` | string | ✅ | 生成该结果所用契约版本，形如 `1.0.0`，须与 `provenance.schemaVersion` 一致 |
| `report` | ReportMeta | ✅ | 报告元信息，见 2.2 |
| `rubricVersion` | string | ✅ | 引用的 rubric **纯版本号**（如 `1.2.0`）；若内嵌 `rubric`，须等于 `rubric.version` |
| `rubric` | Rubric | ⬜ | rubric 完整快照。建议随结果固化，使资产脱离 rubric 库也能独立渲染 |
| `scores` | ScoreItem[] | ✅ | 逐项评分，至少 1 项，`rubricItemId` 不得重复，权重之和须为 100 |
| `totalScore` | number | ✅ | 加权总分，`0–100`，口径见第四节 |
| `review` | ReviewRecord | ✅ | Reviewer 复核记录（含意见与置信度变化） |
| `feedback` | ReviewFeedback | ✅ | 面向学生的评语 |
| `steps` | ReviewStep[] | ✅ | 五 Agent 流水线步骤，建议 5 步 |
| `provenance` | ReviewProvenance | ✅ | 溯源与审计信息，见第五节 |

### 2.2 ReportMeta（报告元信息）

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `reportId` | string | ✅ | 报告唯一 id，如 `lab-report-2026-os-017` |
| `title` | string | ✅ | 报告标题 |
| `course` | string | ✅ | 所属课程 |
| `studentCode` | string | ✅ | 学生代号，**泛指**（学生A / 学生B），不得含真实身份信息 |

### 2.3 Rubric / RubricItem / RubricItemLevel（评分点定义）

**Rubric**

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `id` | string | ✅ | rubric 唯一 id，如 `rubric-os-thread-lab` |
| `version` | string | ✅ | rubric 版本号，`MAJOR.MINOR.PATCH` |
| `title` | string | ✅ | rubric 标题 |
| `items` | RubricItem[] | ✅ | 评分点列表，各点 `weight` 之和必须为 100 |

**RubricItem**

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `id` | string | ✅ | 评分点 id，如 `R3`，rubric 内唯一 |
| `name` | string | ✅ | 评分点名称 |
| `weight` | number | ✅ | 权重**百分比数值** `0–100`；同一 rubric 内合计 = 100（容差 0.01） |
| `maxScore` | number | ✅ | 该项满分，教师自定标度（`> 0`，如 10 / 20 / 5），允许各评分点标度不同 |
| `evidenceRequirement` | string | ✅ | 证据要求：命中该点需要什么证据（章节、代码 API、截图内容等） |
| `levels` | RubricItemLevel[] | ✅ | 判定档位，**建议四档齐全**，至少 1 档 |
| `deductionNotes` | string | ✅ | 扣分梯度说明（在档位系数基础上如何浮动作出扣分） |

**RubricItemLevel**

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `level` | enum | ✅ | `excellent` 优秀 / `meeting` 达标 / `partial` 部分达标 / `notMet` 未达标 |
| `label` | string | ✅ | 中文档位名（可与标准标签不同，如"优秀（超额完成）"） |
| `criterion` | string | ✅ | 该档判定标准：达到什么条件才算命中 |
| `scoreRatio` | number | ✅ | 档位得分系数 `0–1`；**单项得分 = `maxScore × scoreRatio`** |

### 2.4 Evidence（证据）

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `id` | string | ✅ | 证据 id，如 `E3`，供 ScoreItem / ReviewStep 交叉引用 |
| `kind` | enum | ✅ | `text` 正文 / `code` 代码 / `figure` 截图 / `table` 表格 |
| `location` | object | ✅ | 来源位置，见下表 |
| `quote` | string | ✅ | 原文片段，**逐字摘录不得改写**；截图类填写图中可辨识的关键信息 |
| `confidence` | number | ✅ | 该条证据本身的置信度 `0–1`（低清截图、OCR 歧义取低值） |
| `note` | string | ⬜ | 证据局限说明 |

`location` 子字段（均为可选，但至少提供一项）：

| 字段 | 类型 | 语义 |
|---|---|---|
| `section` | string | 章节标题/编号，如 `3 实验步骤` |
| `lineStart` / `lineEnd` | int | 行号闭区间，从 1 开始，`lineEnd ≥ lineStart` |
| `figureNo` | string | 图号，如 `图3-2`；`kind='figure'` 时应提供 |
| `tableNo` | string | 表号，如 `表5-1`；`kind='table'` 时应提供 |

### 2.5 ScoreItem（单项评分）

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `rubricItemId` | string | ✅ | 对应评分点 id |
| `itemName` | string | ✅ | 评分点名称**快照** |
| `weight` | number | ✅ | 权重**快照**（百分比数值） |
| `maxScore` | number | ✅ | 该项满分**快照** |
| `level` | enum | ✅ | 命中档位 |
| `levelScoreRatio` | number | ✅ | 命中档位系数**快照**，用于前端校验 `score ≈ maxScore × ratio` |
| `score` | number | ✅ | 该项得分，`0 ≤ score ≤ maxScore`，2 位小数 |
| `deductionReason` | string \| null | ✅ | 扣分理由；**满分时为 `null`** |
| `evidence` | Evidence[] | ✅ | 引用的证据；未找到证据时允许空数组（此时应置未达标档并说明） |
| `confidence` | number | ✅ | 该项判定置信度 `0–1` |
| `needsReview` | boolean | ✅ | 是否触发复核，规则见第三节 |

> 快照字段（`itemName` / `weight` / `maxScore` / `levelScoreRatio`）为**冗余设计**：
> 使结果文件脱离 rubric 也能独立渲染与复算总分，并锁定评分当时的 rubric 取值，避免 rubric 后续修订"追溯篡改"历史成绩。

### 2.6 ReviewStep（流水线中间产物）

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `step` | int | ✅ | 步骤序号，从 1 开始 |
| `agent` | enum | ✅ | `parser` / `evidence` / `grader` / `reviewer` / `feedback` |
| `inputSummary` | string | ✅ | 输入摘要：该步拿到了什么 |
| `outputSummary` | string | ✅ | 输出摘要：该步产出了什么（尽量带量化结果） |
| `confidence` | number | ✅ | 该步整体置信度 `0–1` |
| `note` | string | ⬜ | 异常、局限或需人工介入的提示 |

### 2.7 ReviewRecord / ReviewAdjustment（复核记录）

**ReviewRecord**

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `triggered` | boolean | ✅ | 是否触发复核（存在置信度 < 0.80 的评分点时为 `true`） |
| `triggerReason` | string \| null | ✅ | 触发原因；未触发时为 `null` |
| `opinion` | string | ✅ | 复核总体意见 |
| `overallConfidenceBefore` | number | ✅ | 复核前整体置信度 = 各 ScoreItem 置信度算术平均，2 位小数 |
| `overallConfidenceAfter` | number | ✅ | 复核后整体置信度（同一口径，含 Reviewer 上调后的值） |
| `adjustments` | ReviewAdjustment[] | ✅ | 逐项复核记录；未触发时可为空数组 |

**ReviewAdjustment**

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `rubricItemId` | string | ✅ | 被复核的评分点 id |
| `opinion` | string | ✅ | 复核意见 |
| `confidenceBefore` / `confidenceAfter` | number | ✅ | 复核前后置信度 |
| `scoreBefore` / `scoreAfter` | number \| null | ✅ | 复核前后得分；**未调整分数时为 `null`** |
| `changed` | boolean | ✅ | 是否实际改动判定（档位或得分变化） |

### 2.8 ReviewFeedback（学生评语）

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `overall` | string | ✅ | 总体评价：完成度 + 主要短板 |
| `strengths` | string[] | ✅ | 亮点列表，≥ 1 条，须对应具体证据 |
| `improvements` | string[] | ✅ | 改进建议列表，≥ 1 条，须可操作 |
| `tone` | enum | ✅ | `encouraging` 鼓励式 / `neutral` 中性客观 / `critical` 严格指出问题 |

### 2.9 ReviewProvenance（溯源与审计）

| 字段 | 类型 | 必填 | 语义与取值口径 |
|---|---|---|---|
| `generatorAgent` | string | ✅ | 生成智能体标识，如 `learnbuddy://expert/autograder-reviewer` |
| `generatedAt` | string | ✅ | ISO8601 时间，建议带时区偏移（`2026-09-20T10:24:36+08:00`） |
| `sourceConversationId` | string | ✅ | 来源 LearnBuddy 对话 id |
| `sourceTurnId` | string | ⬜ | 来源对话轮次 id，**强烈建议提供**，可精确定位到具体轮次 |
| `resultFingerprint` | string | ✅ | 结果指纹 `sha256:<64位十六进制>`，算法见第五节 |
| `schemaVersion` | string | ✅ | 生成时使用的契约版本，须等于顶层 `schemaVersion` |

---

## 三、置信度分级与复核触发规则

阈值常量定义在 `schema.ts` 的 `CONFIDENCE_THRESHOLD`，语义如下表：

| 分级 | 区间 | 语义 | 是否触发复核 |
|---|---|---|---|
| **HIGH** 高 | `[0.80, 1.00]` | 证据充分且与评分点直接对应，判定可直接采信 | 否 |
| **MEDIUM** 中 | `[0.60, 0.80)` | 证据存在但不完整或存在歧义，须经 Reviewer 复核后方可采信 | **是** |
| **LOW** 低 | `[0.00, 0.60)` | 证据薄弱或未找到有效证据，必须复核 | **是**（且复核后仍 < 0.60 须显著标注并建议教师人工确认） |

规则细则：

1. **触发条件**：`ScoreItem.confidence < 0.80` 即置 `needsReview = true` 并进入 Reviewer 环节；
   除此之外，**证据数组为空**、**档位存在跨两级争议** 也应置 `needsReview = true`。
2. **复核不改变档位的情形**：允许 `changed = false` 但置信度上调（如示例中的 R4：0.74 → 0.88），此时 `scoreBefore/scoreAfter` 均为 `null`。
3. **复核后仍低于 0.60**：结果仍可落盘（不得编造证据），但前端必须显著标注"待教师人工确认"。
4. **证据不足的处理红线**：未找到证据时**不得编造**，应置 `notMet` 档、`score = 0`、`deductionReason` 写明"未找到证据"。
5. 整体置信度口径：各 `ScoreItem.confidence` 的**算术平均**（保留 2 位小数），见 `ReviewRecord.overallConfidence*`。

对应代码：`gradeConfidence()` / `needsReviewByConfidence()` / `CONFIDENCE_SEMANTICS`。

---

## 四、总分计算口径

**唯一权威公式**：

```
totalScore = round2( Σ ( score_i / maxScore_i × weight_i ) )
```

即：**先把每项得分归一化成得分率 `[0,1]`，再乘以该评分点的权重百分比**，结果落在 `0–100`。

舍入规则（必须严格遵守）：

1. **单项得分**：`score_i = round2(maxScore_i × levelScoreRatio_i)`，四舍五入（half-up），保留 2 位小数；
2. **各项贡献值不单独取整**，先全精度累加，最后对总和做一次 `round2`；
3. 存储值固定 2 位小数；页面展示可再降为 1 位或整数（如 `79.00 → 79.0`），但**不得回写**降精度后的值；
4. 浮点比较统一使用容差 `0.01`（`WEIGHT_SUM_TOLERANCE`）。

约束与退化情形：

- 各评分点 `weight` 之和必须为 **100**（容差 0.01），schema 的 `superRefine` 会强制校验；
- 若教师习惯"直接按权重分给分"，可令 `maxScore_i = weight_i`，此时公式退化为 `totalScore = Σ score_i`，与"得分直接相加"的直觉一致；
- 权重为 0 的评分点是合法的（仅作诊断不给分），但仍需在 `scores` 中给出判定。

代码入口：`computeWeightedTotal()` 复算、`verifyTotalScore()` 核查声明值、`verifyItemScore()` 核查单项档位一致性、`computeItemScore()` 由档位系数算应得分。

示例文件校验（可直接复现）：

| 评分点 | 权重 | 满分 | 档位 | 得分 | 贡献 |
|---|---|---|---|---|---|
| R1 实验目的与原理阐述 | 15 | 10 | 优秀 (1.0) | 10 | 15.00 |
| R2 实验环境与步骤记录 | 20 | 10 | 达标 (0.8) | 8 | 16.00 |
| R3 核心代码正确性与规范 | 30 | 20 | 部分达标 (0.5) | 10 | 15.00 |
| R4 实验结果与分析 | 25 | 15 | 优秀 (1.0) | 15 | 25.00 |
| R5 实验总结与文档规范 | 10 | 5 | 达标 (0.8) | 4 | 8.00 |
| **合计** | **100** | — | — | — | **79.00** |

---

## 五、ReviewProvenance 如何支撑"可审计、可回溯"

赛事要求结果**可审计**、且**可回溯到具体对话轮次**。四个字段各司其职，构成一条闭合证据链：

```
结果 JSON ──resultFingerprint──▶ 是否被篡改？（自证完整性）
          ──sourceConversationId / sourceTurnId──▶ 哪次对话、第几轮产出？（回溯到人证）
          ──generatorAgent / generatedAt──▶ 谁、何时产出？（责任主体）
          ──schemaVersion──▶ 用哪版契约解析？（可复现解析）
```

1. **防篡改（结果指纹）**
   算法：将整个 `ReviewResult` 对象**按字典序递归排序键**、把 `provenance.resultFingerprint` 置为 `""`，序列化为**无空格 UTF-8 JSON**，取 **SHA-256 十六进制小写**，加 `sha256:` 前缀。
   校验：任何人（含浏览器端 Web Crypto）按同一规则复算，与文件中声明的指纹比对，不一致即说明结果被修改过。
   > 指纹不覆盖自身，故计算时必须置空，否则陷入循环依赖。

2. **回溯到对话（人证）**
   `sourceConversationId` 定位 LearnBuddy 中的对话，`sourceTurnId` 精确定位到产出本结果的那一轮。
   评审据此可直接翻到对应对话，看到报告原文、五 Agent 的中间推理与最终 JSON 的生成过程 —— 这是"AI 能力真实发生"的主证据。

3. **责任主体与时间**
   `generatorAgent` 标明产出者（专家智能体标识），`generatedAt` 用 ISO8601 带时区记录生成时刻，配合 README 的对话记录索引形成时间线。

4. **可复现解析**
   `schemaVersion` 决定用哪一版契约解析；跨版本时用第二节的递增规范做迁移。

页面侧建议：在报告详情页与 `/trace` 溯源页底部固定展示这四项，并提供**一键复算指纹**与**完整 JSON 下载**。

> 现状（如实标注）：**该建议尚未实现**。前端目前只在 `provenance-block.tsx` 中**展示**已固化的
> `resultFingerprint`，没有 Web Crypto 复算、也没有 JSON 下载入口。
> 已在页面上落地的是**构建期**的契约口径自证 —— `/report/[id]` 分数面板的「单项档位自证」
> 调用 `verifyItemScore()`（核验 `score ≈ maxScore × levelScoreRatio`）、「口径复算」调用
> `verifyTotalScore()`（核验声明总分与加权公式一致）。这两项证明"分数由档位机械推出"，属构建期复算，
> **不等同于**浏览器端 Web Crypto 指纹复算。

---

## 六、schemaVersion 递增规范

版本号遵循 `MAJOR.MINOR.PATCH`，常量 `SCHEMA_VERSION` 定义在 `schema.ts`。

| 级别 | 触发条件（满足其一即 bump） | 对既有资产的影响 |
|---|---|---|
| **MAJOR** | 删除或重命名字段；改变字段类型；**改变取值口径**（总分公式、置信度阈值语义、档位定义）；收紧约束（可选变必填） | 旧资产**必须迁移或重新生成**；新旧不可混用 |
| **MINOR** | 新增**可选**字段；新增枚举值；放宽约束（必填变可选） | 新版解析器可正常读旧资产；因使用 `.strict()`，**旧版解析器会拒绝新资产**，故前端须同步升级 |
| **PATCH** | 仅注释、文案、错误提示、示例数据更新，字段结构与口径不变 | 完全兼容 |

配套规则：

1. bump 时**必须同步更新**三处：`schema.ts` 的 `SCHEMA_VERSION` 常量、本文档、`_example.json`；
2. 资产的 `schemaVersion` 与 `provenance.schemaVersion` 必须相等，且等于当时代码中的 `SCHEMA_VERSION`；代码加载资产时应先比对，不一致则提示"契约版本不匹配"而非静默渲染；
3. MAJOR 变更需在文档中记录迁移步骤（字段映射表），旧资产保留在 `frontend/public/results/legacy/` 下，不就地改写；
4. rubric 有自己的 `version`，与契约版本**相互独立**：rubric 修订不影响 `schemaVersion`，只更新 `rubricVersion`。

---

## 七、校验与使用方式

```ts
import { validateReviewResult, verifyTotalScore, gradeConfidence } from '@/lib/schema';

const result = validateReviewResult(await fetch('/results/xxx.json').then((r) => r.json()));

if (!result.ok) {
  // result.issues: { path: string; message: string }[]，中文错误，可直接渲染
  console.error(result.issues);
} else {
  const check = verifyTotalScore(result.data);      // 总分口径核查
  const grade = gradeConfidence(result.data.scores[0].confidence); // 'high' | 'medium' | 'low'
}
```

约定：

- `validateReviewResult` 是**唯一校验入口**，纯函数、不抛异常、不做业务处理；
- 结构校验（schema）与口径校验（总分、档位一致性）**分离**：前者用于 AI 产出即刻拦截，后者用于前端渲染前复核，两者都通过才渲染；
- 前端类型一律从 schema 推导（`z.infer`），禁止手写重复 interface。
