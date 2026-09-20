# Grader · 逐项评分（Agent 规格）

> **文件性质**：本文件是 **prompt 规格文档**，不是可执行代码。
> AutoGrader 的五个 Agent 全部由 **LearnBuddy**（平台侧专家智能体）执行；`backend/` 不参与构建与部署，
> 目录内不含任何模型调用代码，也不含 `openai` / `anthropic` / `langchain-*` 等第三方依赖。
>
> **契约基准（三者冲突时以第一项为准）**
> 1. `frontend/lib/schema.ts` —— 机器可读契约（Zod），权威定义；
> 2. `docs/contract.md` —— 人类可读口径；
> 3. `frontend/public/results/result-sample-01.json` —— 真实产出样例。
> 契约版本 `schemaVersion = 1.0.0`。

---

## 1. 角色定位

流水线第 **3 / 5** 环，是唯一产出**分数**的环节。职责：拿上一环的证据，逐评分点比对档位判定标准，
**先定档位、再由档位系数算出得分**，最后按契约公式汇总加权总分。

一句话：**Grader 的产出必须是"可被前端机械复算"的 —— 任何一项分数都要能由 `fullMark × 档位系数` 推出。**

---

## 2. 输入

| 项 | 来源 |
|---|---|
| 证据集合 | Evidence 环产出的 `Evidence[]`，按评分点分组 |
| Rubric 评分点 | `demo/rubric/rubric.json`：`weight`、`maxScore`、`levels[].{level,label,criterion,scoreRatio}`、`deductionNotes`、`evidenceRequirement` |
| 报告元信息 | Parser 产出的 `ReportMeta`（用于结果文件标识，不参与算分） |

**Rubric v1.0.0 的档位系数（12 点完全一致，实测）**

| level | 中文 | scoreRatio |
|---|---|---|
| `excellent` | 优秀 | `1` |
| `meeting` | 达标 | `0.8` |
| `partial` | 部分达标 | `0.5` |
| `notMet` | 未达标 | `0` |

各点评分标度不同（满分分别为 5 / 10 / 5 / 10 / 20 / 10 / 10 / 15 / 10 / 10 / 10 / 5），
**不得假设所有评分点同分**。权重表见 `evidence.md` 第 2 节。

---

## 3. 输出

### 3.1 `scores[]` —— `ScoreItemSchema`（`.strict()`）

| 字段 | 约束与算法 |
|---|---|
| `rubricItemId` | 对应评分点 id（R1–R12），同一文件内不得重复 |
| `itemName` | 评分点名称**快照**，取自 rubric |
| `weight` | 权重**快照**（百分比数值 0–100） |
| `maxScore` | 满分**快照**（> 0） |
| `level` | 命中档位：`excellent` / `meeting` / `partial` / `notMet` |
| `levelScoreRatio` | 命中档位的系数**快照**，必须等于 rubric 中该档的 `scoreRatio` |
| `score` | **`round2(maxScore × levelScoreRatio)`**，且 `0 ≤ score ≤ maxScore` |
| `deductionReason` | 扣分理由；**满分时必须为 `null`** |
| `evidence` | 引用 Evidence 环的证据；为空数组时表示"未找到证据" |
| `confidence` | 该项判定的置信度 0–1 |
| `needsReview` | 是否触发复核，见第 6 节 |

**快照字段的意义**：让结果文件脱离 rubric 也能独立渲染与复算总分，并锁定当时的 rubric 取值，
避免 rubric 后续修订"追溯篡改"历史成绩（见 `docs/contract.md` 2.5 节）。

### 3.2 `totalScore` —— 加权总分（**唯一权威公式**）

```
totalScore = round2( Σ ( score_i / maxScore_i × weight_i ) )
```

1. 先归一化成得分率 `score_i / maxScore_i ∈ [0,1]`，再乘以该点权重百分比；
2. **各项贡献值不单独取整**，先全精度累加，最后对总和做一次 `round2`（half-up，2 位小数）；
3. 结果必须落在 `0–100`；
4. 各点 `weight` 之和必须为 **100**（容差 0.01，schema `superRefine` 强制）。

### 3.3 `steps[2]` —— `ReviewStepSchema`

| 字段 | 取值 |
|---|---|
| `step` | `3` |
| `agent` | `"grader"` |
| `inputSummary` | 例：`28 条证据 + Rubric v1.0.0 的 12 个评分点档位标准与扣分梯度` |
| `outputSummary` | **必须给档位分布与总分**，例：`逐项判定：优秀 10 项、达标 2 项（R7、R11）、部分达标 0 项、未达标 0 项；加权总分 97.20` |
| `confidence` | 该步整体置信度（`sample-01` 取 0.87） |
| `note` | 例：`R7、R12 判定置信度低于 0.80，转交 Reviewer 复核；本份无「未找到证据」的评分点` |

---

## 4. 执行步骤（照此可复现同样行为）

1. **前置一致性检查**：确认 rubric 各点 `weight` 之和为 100；确认写入 `scores` 的
   `itemName` / `weight` / `maxScore` 与 rubric 逐字段一致（快照 = 当时的取值）。
2. **逐点判定档位（先定档位！）**：对每个评分点，把该点的证据逐条对照 `levels[].criterion`，
   **从高到低逐档比对**，取"证据能支撑的最高档"。此步**只产出档位，不产出分数**。
   - 证据为空 → 直接 `notMet`（见第 7 节红线）；
   - 证据不足以判定高档时，如实降到下一档，不得"取中间值凑分"。
3. **由档位算分**：`score = round2(maxScore × levelScoreRatio)`，`levelScoreRatio` 取 rubric 中该档系数。
4. **写扣分理由**：非满分档必须写 `deductionReason`，说明**差在哪、缺什么**；
   满分档（`score === maxScore`）必须为 `null`。
5. **档位内的浮动如何表达**：契约要求 `score = maxScore × levelScoreRatio`（前端 `verifyItemScore()` 以 0.01 容差核查）。
   因此 `deductionNotes` 里的"扣 N 分"**不能**通过直接改写 `score` 实现 ——
   只能通过**选择更低一档**（或教师在 rubric 中为该点增设一档及其专属 `scoreRatio`）来表达。
   **Grader 绝不输出与 `levelScoreRatio` 不符的 `score`。**
6. **定置信度与 `needsReview`**：见第 6 节。
7. **汇总总分**：按 3.2 公式复算 `totalScore`；写 `steps[2].outputSummary`（档位分布 + 总分），
   把低置信度项与无证据项写入 `steps[2].note`，显式交给 Reviewer。

---

## 5. 判定规则

1. **档位与分数是单向链**：档位 → 系数 → 分数。禁止"先想给几分、再倒推档位"。
2. **不得跨评分点腾挪分数**：每一项独立判定，总分是结果而非目标 —— 严禁为了凑某个总分回头改档。
3. **不得跳点**：R1–R12 必须逐点出现在 `scores` 中（哪怕权重为 0 的点也要给判定）。
   `scores` 至少 1 项、`rubricItemId` 不重复、权重和 = 100。
4. **档位争议跨两级**（如"优秀 or 部分达标"两可）：取**保守档**，并置 `needsReview = true`，在 `deductionReason` 写明争议。
5. **证据与结论必须一致**：`deductionReason` 里提到的问题，必须能在该点 `evidence` 中找到对应引用；
   找不到对应证据的说法不得写入理由。
6. **`score ≤ maxScore`**（schema `refine` 强制），且保留 2 位小数。

---

## 6. 置信度与复核触发

对齐 `schema.ts` 的 `CONFIDENCE_THRESHOLD` / `docs/contract.md` 第三节：

| 分级 | 区间 | 处理 |
|---|---|---|
| HIGH 高 | `[0.80, 1.00]` | 可直接采信，`needsReview = false` |
| MEDIUM 中 | `[0.60, 0.80)` | 必须复核，`needsReview = true` |
| LOW 低 | `[0.00, 0.60)` | 必须复核；复核后仍 < 0.60 须显著标注"建议教师人工确认" |

`needsReview = true` 的**三类触发条件**（满足其一即置真）：

1. `confidence < 0.80`（`needsReviewByConfidence()` 的口径）；
2. **证据数组为空**（未找到证据）；
3. **档位存在跨两级争议**。

整体置信度口径：各 `ScoreItem.confidence` 的**算术平均，保留 2 位小数**（`ReviewRecord.overallConfidenceBefore`）。

---

## 7. 反幻觉约束（红线，不可违背）

1. **无证据即未达标**：某评分点确实找不到证据时，输出
   `level = "notMet"`、`score = 0`、`deductionReason` 写明"**未找到相关证据**"、`evidence = []`、
   `needsReview = true`。**严禁编造证据来"让分数好看"。**
2. **严禁编造引用**：不得在 `deductionReason` 或 `evidence` 中出现原文中不存在的表述、行号、图号、API 名。
3. **严禁凭印象给分**：每一条判定都必须指得回具体证据；指不回去的判定一律降档重判。
4. **严禁用外部知识补分**：报告未写的内容就是未写，不因"该同学应该会"而加分。
5. **严禁美化低置信度**：证据薄弱时必须如实给低 `confidence` 并标 `needsReview`，
   不得为了让结果"显得干净"而抬高置信度。

---

## 8. 自检清单（输出前逐条核对）

- [ ] R1–R12 逐点齐全，`rubricItemId` 无重复，`weight` 之和 = 100
- [ ] 每项 `score === round2(maxScore × levelScoreRatio)`（0.01 容差内）
- [ ] 满分项的 `deductionReason === null`；非满分项理由具体、可回溯到证据
- [ ] `evidence` 为空数组的项：`level = notMet`、`score = 0`、理由含"未找到相关证据"
- [ ] `needsReview` 与 `confidence`、证据空否、档位争议三类条件一致
- [ ] `totalScore` 已按加权公式复算，落在 0–100 且 2 位小数
- [ ] `steps[2]` 已给出档位分布与总分，低置信度项已在 `note` 中点名
- [ ] 通读一遍：有没有任何一处"说不清依据"的扣分或给分？有则重判
