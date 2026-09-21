# AutoGrader 对话记录归档

> **归档性质**：本目录下 5 份文档，由 LearnBuddy 会话期间沉淀的**项目记忆与决策文档**整理而成，用于赛事评审回溯。
> 它**不是**逐字对话原文，**不含**任何虚构的时间戳、虚构的对话内容或推测性陈述；文中出现的每一个事实、数字与文件路径，均可在本仓库或工作区素材中逐项查证（查证方式见第三节）。

---

## 一、这些记录从何而来

本归档的素材分两类：**LearnBuddy 项目记忆**（工作区侧，非仓库内）与**仓库内既有文档**。

| # | 素材 | 位置 | 在归档中的用途 |
|---|---|---|---|
| 1 | 项目记忆 · 2026-09-20 | `.learnbuddy/memory/2026-09-20.md`（工作区，非仓库内） | 开发全过程：架构决策、SubAgent 派遣记录、评阅生产、关键数据 → 01/02/03 |
| 2 | 项目记忆 · 2026-09-21 | `.learnbuddy/memory/2026-09-21.md`（工作区） | 项目进度审查、外部简报逐项核实、修复规划 → 04 |
| 3 | 项目长期记忆 | `.learnbuddy/memory/MEMORY.md`（工作区） | 需长期遵守的决策：链接策略、Compile-time AI 范式、合规红线、五 Agent 流水线 |
| 4 | LearnBuddy 能力 × 流程融合 | `docs/learnbuddy-usage.md`（仓库内） | 赛事硬约束、LearnBuddy 能力映射、八阶段开发流程 → 01 |
| 5 | 交付形态与技术栈修订 | `docs/deliverable-strategy.md`（仓库内） | 约束提取表、三个核心矛盾、范式切换论证、技术栈修订表 → 01 |
| 6 | 决策看板 | `docs/decision-board.html`（仓库内） | 同上决策的可视化呈现 |
| 7 | 外部审查简报 | `AutoGrader_v0.1项目审查简报.md`（仓库根，2026-09-20） | 审查指控原文 → 04 |

> 说明：`2026-09-21.md` 中把该简报记为工作区素材《AutoGrader 项目审查简报.md》；
> 仓库内实际文件名为 `AutoGrader_v0.1项目审查简报.md`（仓库根）。本归档以**实际文件名**为准。

**本轮未使用**（也未曾获得）LearnBuddy 平台的原始对话导出文件。因此本归档**不对任何对话轮次做逐字引用**，
只复述记忆与决策文档中已经固化的结论，并把结论锚定到可查证的仓库产物上。

---

## 二、如何对应到代码产物（provenance 索引）

`frontend/public/results/*.json` 的 `provenance.sourceConversationId` 一律指向本目录的**仓库相对路径 + 锚点**，
`provenance.sourceTurnId` 记录产出该结果的 SubAgent 批次代号。完整对应关系如下。

| `sourceConversationId` | `sourceTurnId` | 覆盖的结果 JSON | 对应归档章节 |
|---|---|---|---|
| `conversations/03-评阅生产与一致性评测.md#批次A` | `wave3-grading-A` | `result-sample-01` … `result-sample-04` | 03 · 批次A |
| `conversations/03-评阅生产与一致性评测.md#批次B` | `wave3-grading-B` | `result-sample-05` … `result-sample-08` | 03 · 批次B |
| `conversations/03-评阅生产与一致性评测.md#批次C` | `wave3-grading-C` | `result-sample-09` … `result-sample-12` | 03 · 批次C |
| `conversations/README.md#契约示例` | （不填，见下） | `_example.json` | 本文件 · 第四节 |

补充说明：

- `_example.json` 是**契约示例**，不是真实评阅结果，因此它的 `sourceConversationId` 指向本说明文件而非评阅生产章节；
  其 `sourceTurnId` **留空**——契约（`docs/contract.md` §2.9）把该字段定义为可选，示例既然不承载真实轮次，
  就不填任何无法查证的伪轮次标识。
- 12 份真实评阅结果的 `sourceTurnId` 取 SubAgent 批次代号（`wave3-grading-A/B/C`），
  该代号可回溯到 `conversations/02-多Agent协作开发记录.md` 的派遣记录表与
  `conversations/03-评阅生产与一致性评测.md` 的批次章节。

---

## 三、如何查证（三条独立路径）

1. **结果完整性**：`provenance.resultFingerprint` 按 `docs/contract.md` 第五节算法独立复算 ——
   将整个 `ReviewResult` 对象按字典序递归排序键、把 `provenance.resultFingerprint` 置为 `""`、
   序列化为无空格 UTF-8 JSON 后取 SHA-256 十六进制小写。不一致即说明结果被改动过。
2. **总分口径**：`totalScore` 按契约公式 `round2(Σ(score_i / maxScore_i × weight_i))` 复算。
   逐项档位与得分另可按 `score ≈ maxScore × levelScoreRatio` 复核。
3. **对照教师金标准**：教师金标准（`goldTotalScore` 与逐项 `expectedItemScores`）见
   `demo/sample-reports/manifest.json`；样例报告原文见 `demo/sample-reports/sample-01.md` … `sample-12.md`。
   一致性评测结论见 `conversations/03-评阅生产与一致性评测.md`，页面入口为 `/eval`。

代码侧对照：契约 `frontend/lib/schema.ts`、口径说明 `docs/contract.md`、
评阅口径复算 `frontend/lib/analysis.ts`、确定性核查器 `frontend/lib/inspectors/`。

---

<a name="契约示例"></a>

## 四、契约示例（`_example.json`）

`frontend/public/results/_example.json` 是**契约的可运行示例**，不是任何一份真实报告的评阅产物：
其 `report`（`lab-report-2026-os-017` / 学生A）为演示用元信息，`rubric` 内嵌 `rubric-os-thread-lab` v1.2.0 快照，
5 个评分点（R1–R5）演示了「优秀 / 达标 / 部分达标 / 未达标」四档与置信度分级、
`review.adjustments` 的两次复核（R3 `0.58 → 0.71`、R4 `0.74 → 0.88`，均 `changed: false`）。

其 `provenance.sourceConversationId` 指向本文件（`conversations/README.md#契约示例`），
用意是：**仓库内不再有任何指向不存在对话的溯源标识**。

---

## 五、目录索引

| 文件 | 内容 |
|---|---|
| `01-需求澄清与技术选型.md` | 赛事硬约束提取、三个核心矛盾、Runtime AI → Compile-time AI 范式切换论证、技术栈修订决策、双形态交付 |
| `02-多Agent协作开发记录.md` | Orchestrator 模式、SubAgent 派遣记录、各批产出与验收结论、遗留项 |
| `03-评阅生产与一致性评测.md` | 批次 A/B/C 划分、12 份评阅与教师金标准逐份对比、MAE 3.05 与档位误差、核查器发现 |
| `04-审查与修复记录.md` | 外部审查简报的指控、逐项核实结论（哪些属实、哪些已过时）、本轮修复内容、仍未闭环项 |

> 锚点说明：本目录的章节锚点采用「直观名 + 原始 HTML 锚点」双写（如 `<a name="批次A"></a>`）。
> 在 GitHub 等渲染器下，Markdown 标题的自动锚点会把 ASCII 字母小写化（`### 批次A` → `#批次a`）；
> 若 `#批次A` 未能跳转，可用小写形式 `#批次a` 作为等价锚点。
