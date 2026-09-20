# 验证说明（写实版）

> **本文只写"确实做过"的验证**，并给出可自行复现的方法；未做的一律列在第五节，不做夸大。
> 凡标注"实测/复算"的数字，均为本次整理时直接读取仓库文件、或调用项目自身的纯函数模块复算得出。
>
> 环境：Windows 11 · Node **v22.22.2** · 项目未安装任何测试框架。
> 复现方式统一为：用 `node --experimental-strip-types` **直接 import 项目自身的 `.ts` 模块**
> （`frontend/lib/schema.ts` / `frontend/lib/inspectors/index.ts`），不修改仓库内任何文件。

---

## 一、验证清单（一张表看完）

| # | 验证项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 契约校验（Zod `.strict()`） | `validateReviewResult()` 遍历 13 个 JSON | **13 / 13 通过** |
| 2 | 总分复算 | `verifyTotalScore()`（容差 0.01） | **13 / 13 一致** |
| 3 | 单项得分与档位一致性 | `verifyItemScore()` 逐项核查 | **全部项目通过** |
| 4 | 权重和 = 100 | 复算 `Σ weight`（schema `superRefine` 亦强制） | **13 / 13 均为 100** |
| 5 | 结果指纹复算 | 按契约算法独立实现 SHA-256 复算 | **13 / 13 与声明值一致** |
| 6 | 置信度与复核触发 | `needsReviewByConfidence()` + `review.triggered` | 逐份列出低置信度项；**13/13 `triggered = true`** |
| 7 | 一致性评测指标 | `analysis.ts` 口径复算 MAE / 命中率 / 分布 | **MAE 3.05（N=12）**；命中率 **106/144 = 0.7361** |
| 8 | 核查器 12 份样例 | 运行 `inspectReport()` 与 `similarityBetweenTexts()` | 复现全部既有结论（见第四节） |
| 9 | 构建产物侧核查 | 读取 `frontend/out/` 的 HTML | 报告页含真实分数与指纹；评测页含 MAE 数字 |

---

## 二、契约与口径层验证（第 1–6 项）

### 2.1 契约校验：13 / 13 通过

对 `frontend/public/results/` 下全部 JSON（`_example.json` + `result-sample-01.json` … `result-sample-12.json`）
逐个调用 `validateReviewResult()`：

- 全部返回 `{ ok: true }`，无一条 `issues`；
- 说明 `schemaVersion = 1.0.0`、`.strict()` 无未知字段、枚举取值合法、
  `score ≤ maxScore`、`lineEnd ≥ lineStart`、ISO8601 时间可解析等约束**全部满足**。

### 2.2 总分复算：13 / 13 一致

对每份结果调用 `verifyTotalScore()`，比较"按加权公式复算的总分"与"文件声明的 `totalScore`"，
容差 0.01：

| 文件 | 声明总分 | 复算值 | 一致 |
|---|---|---|---|
| `_example.json` | 79 | 79 | ✅ |
| `result-sample-01.json` | 97.2 | 97.2 | ✅ |
| `result-sample-02.json` | 79.9 | 79.9 | ✅ |
| `result-sample-03.json` | 52.8 | 52.8 | ✅ |
| `result-sample-04.json` | 45.6 | 45.6 | ✅ |
| `result-sample-05.json` | 97.8 | 97.8 | ✅ |
| `result-sample-06.json` | 78.5 | 78.5 | ✅ |
| `result-sample-07.json` | 50.7 | 50.7 | ✅ |
| `result-sample-08.json` | 20.6 | 20.6 | ✅ |
| `result-sample-09.json` | 96 | 96 | ✅ |
| `result-sample-10.json` | 81.5 | 81.5 | ✅ |
| `result-sample-11.json` | 51.6 | 51.6 | ✅ |
| `result-sample-12.json` | 32.1 | 32.1 | ✅ |

### 2.3 单项得分与档位一致性（`score = maxScore × levelScoreRatio`）

对 13 份文件的**每一个评分点**调用 `verifyItemScore()`：全部通过（0.01 容差内）。
意义：分档不是"随手给的分"，而是**由档位系数机械推出的结果** —— 这是"先定档位再算分"能被验证的依据。

### 2.4 权重和 = 100

13 份文件的 `Σ weight` 均为 **100**。schema 的 `superRefine` 会把偏差 > 0.01 的情况直接判为契约错误，
因此"能通过校验"本身即已覆盖此项，本次复算作为双重确认。

### 2.5 结果指纹复算：13 / 13 一致

按 `contract.md` 第五节的算法**独立实现**一遍（键递归字典序排序 → `resultFingerprint` 置 `""` →
无空格 UTF-8 JSON → SHA-256 十六进制小写 → 加 `sha256:` 前缀），与文件中声明的指纹比对：

**13 份全部 `fpMatch = true`。** 意义：这些 JSON 资产**未被事后改动**，
"可审计"中的完整性一环是成立的（复算方法不依赖项目代码，任何人都能自行验证）。

### 2.6 置信度与复核触发

用 `needsReviewByConfidence()` 复算各份的 `< 0.80` 项，逐份结果见
[`ai-agent.md`](ai-agent.md) 第 4.3 节。要点：

- **13 / 13 份的 `review.triggered` 均为 `true`** —— 复核机制被真实使用；
- **R12「原创性」在 12 份中 12 次全部触发复核**，与"该点属推断性判断、缺少直接文本证据"一致。

---

## 三、一致性评测指标（第 7 项）

以 `demo/sample-reports/manifest.json` 的教师金标准（`goldTotalScore`、`expectedItemScores`）
为基准，对 12 份结果复算（口径与 `frontend/lib/analysis.ts` 一致）：

| 指标 | 复算结果 |
|---|---|
| 总分 MAE（N = 12） | **3.05** |
| 完全一致 | 1 份（`sample-07`） |
| 最大单份偏差 | **14.0**（`sample-04`） |
| 按难度档位平均误差 | 优 **2.00** / 良 **1.53** / 中 **0.67** / 差 **8.00** |
| 逐项档位命中率 | **106 / 144 = 0.7361** |

与 README 第八节公布的数字**逐项一致**（MAE 3.05、完全一致 1 份、最大偏差 14.0、按档位 2.00/1.53/0.67/8.00）。

> 这组数字同时暴露了本作品最大的真实短板：**差档平均误差 8.00 分，是其他档位的 4–12 倍**，
> 即"AI 对质量较差报告的扣分力度弱于人工教师"。该结论已写入 README 第九节，此处不粉饰。

---

## 四、核查器的 12 份样例复现（第 8 项）

`frontend/lib/inspectors/` 是纯函数模块，本次整理**实际运行**了 `inspectReport()`
（对 12 份报告原文）与 `similarityBetweenTexts()`（对 66 个两两配对），复现结论如下：

### 4.1 关键 API 命中数为 0 的两份低分报告（**复现成功**）

| 报告 | 主题 | 章节命中 | 代码块 | 代码行 | **关键词命中** |
|---|---|---|---|---|---|
| `sample-08` | Socket 网络编程 | **0 / 7** | 1 | 12 | **0** |
| `sample-12` | 排序算法性能对比 | 5 / 7 | 1 | 10 | **0** |

与 README 第七节记载一致：`sample-08` 的代码块用的是 `http.server` / `urllib` 等现成模块，
题干要求的 `socket` / `bind` / `listen` / `accept` 在正文中被提及但**代码里并未使用**；
`sample-12` 的代码块只调用 Python 内置 `a.sort()` / `sorted(a)`。
因规则是"**仅在围栏代码块内**做词边界匹配"，故命中为 0 —— 与人工教师给这两份的低分方向一致。

### 4.2 相似度：唯一一对达到复核阈值（**复现成功**）

| 配对 | 相似度 | 判定 |
|---|---|---|
| **`sample-10` ↔ `sample-11`** | **0.84375** | `suspicious`（≥ 0.80，建议人工复核） |
| `sample-09` ↔ `sample-10` | 0.71875 | 正常 |
| `sample-09` ↔ `sample-11` | 0.71875 | 正常 |

66 个两两配对中，**恰好 1 对 ≥ 0.80**，`≥ 0.95`（`duplicate`）**0 对** —— 与 README 记载完全一致。
该提示**仅是"指纹接近、值得教师看一眼"，不构成任何抄袭结论**。

### 4.3 其余观察（本次复现新增的细节）

12 份覆盖了从"优"到"差"的完整梯度，核查器输出与难度档位呈单调关系，例如：
词数从 2336（`sample-01`）降到 421/428（`sample-04`/`sample-12`）；
`sample-04` 与 `sample-12` 触发 `error:stats:too-short`（正文字数低于错误线 600），
`sample-03`/`07`/`11` 触发 `warn:stats:short`（低于告警线 1200）。
这些是**机器可确切判定的客观事实**，不涉及语义评价。

---

## 五、明确"未做"的部分（避免夸大）

1. **没有自动化测试框架**：`frontend/package.json` 的 scripts 只有 `dev` / `build` / `start` / `lint`，
   未引入 jest / vitest / playwright 等；无测试目录、无 CI 配置。
   本项目所有验证都是**一次性、确定性、可复现的复算**，不是回归测试套件。
2. **本次整理未执行 `npm run build`**（按整理约定禁止）。
   第 9 项的构建产物结论来自**仓库中已存在的 `frontend/out/`**（实测 70 文件 / 33 目录），
   而非本次重新构建。
3. **未实现"浏览器端一键复算指纹"**：`contract.md` 第五节的页面侧建议中列举了此功能，
   当前前端只在 `provenance-block.tsx` 中**展示** `resultFingerprint`，**没有** Web Crypto 复算实现，
   也没有"完整 JSON 下载"。指纹是"可复算"的，但复算需在浏览器之外进行。
4. **核查器未接入任何页面**：全量检索后确认 `frontend/app`、`frontend/components`、`frontend/lib`
   均未 import `lib/inspectors`。第四节的结论来自**独立运行该模块**，用户在已部署站点上看不到。
5. **未做**：Cohen's Kappa、置信度校准曲线（`deliverable-strategy.md` 中曾列为规划项）；
   多教师双盲标注；统计显著性检验；跨课程/跨题目泛化实验；性能压测。
6. **金标准主观性未消除**：`goldTotalScore` 由单人（参赛者）依 Rubric 手工核算，
   **不是多教师独立双盲标注**，因此 MAE 3.05 只能说明"在这 12 份上贴合"，不构成绝对基准。
7. **`backend/` 无可执行验证**：其中只有 prompt 规格文档（`.md`），不存在可运行的评阅实现，
   也因此**不存在"跑一遍后端看结果"的验证路径** —— 这是架构前提，不是缺陷。

### 5.1 整理过程中发现的两处"文档与实现不一致"

均为**只读核查发现**，本次整理未修改相关文件（它们不在允许改动的范围内），仅在此如实记录：

1. **`frontend/app/eval/page.tsx` 的文件头注释已过期**：
   注释仍写着"public/results/ 下尚无真实评阅结果，因此「已生成 0 / 12」，MAE 与命中率暂无可比样本"，
   而实际上 12 份结果文件均已存在，且构建产物 `out/eval/index.html` 中已含 **MAE 3.05**（不再显示"待填充"）。
   属注释未随实现更新，不影响运行时行为。
2. **`README.md` 第四节的合规声明仍称 `backend/agents/` 下是五个 0 字节 `.py` 占位文件**：
   本次整理已在该目录创建五份 `.md` 规格文档（`.py` 的删除被沙箱守卫拦截，见下）。
   README 不在允许改动的范围内，故未同步，**建议由仓库所有者更新该段表述**。

3. **统计口径差异（非错误，但值得知道）**：以 `sample-01` 为例，同一份报告不同环节给出的数字并不等价 ——

   | 量 | Parser 步骤摘要（`steps[0]`） | 核查器实测 | 差异原因 |
   |---|---|---|---|
   | 文件规模 | 255 行 / 13,544 字节 | 255 行 / 13,544 字节 | **完全一致** |
   | 正文字数 | "约 4,000 字" | `wordCount = 2336`（CJK 2203 + 英文词 133） | Parser 为概数且口径更宽（含图表题注等）；核查器只统计正文行 |
   | 代码行数 | "2 段 C 代码块共 128 行" | `codeLines = 126`（非空代码行 109） | 是否计空行/围栏行的口径不同 |
   | 章节数 | "9 个编号章节加参考文献" | `headingCount = 21` | 核查器连加粗伪标题一并计入 |

   这类差异属**统计口径不同**，不影响契约字段（行号、图号、表号等定位信息在两侧是一致的）。
   引用数字时请注明来源，避免把两个口径混着用。

> 另需说明：本次整理尝试删除 `backend/agents/` 下五个 0 字节 `.py` 文件时，
> **被沙箱守卫拦截（`SAFE_DELETE_BULK_REJECTED`）且用户拒绝了授权**，故文件按原样保留。
> 它们仍为 0 字节、不含任何代码；其对应的行为规格已由同目录的 `.md` 文档承载。

---

## 六、如何自行复现（不依赖项目外的任何工具）

```bash
# 0. 前置：Node 22+（本次为 v22.22.2）
cd AutoGrader

# 1. 契约校验 / 总分复算 / 单项核查 / 指纹复算
#    思路：用 --experimental-strip-types 直接 import 项目自身模块，遍历资产
node --experimental-strip-types <你的脚本>.mjs
#   脚本内做的事：
#     const s = await import('file:///.../frontend/lib/schema.ts');
#     for (每个 frontend/public/results/*.json) {
#       s.validateReviewResult(json)   // → 契约校验
#       s.verifyTotalScore(json)       // → 总分复算
#       s.verifyItemScore(item)        // → 单项档位一致性
#       // 指纹：按 contract.md 第五节算法自行复算后与声明值比对
#     }

# 2. 一致性评测指标
#    读取 demo/sample-reports/manifest.json 的 goldTotalScore / expectedItemScores，
#    与各 result-*.json 的 totalScore / scores[].level 比对，按 analysis.ts 口径算 MAE 与命中率

# 3. 核查器
#    注意：Node ESM 无法解析 inspectors 内部的"无扩展名相对导入"（如 './types'），
#    需先复制该目录到临时位置并为这些 import 补上 .ts 后缀，再 import index.ts 调用
#    inspectReport(rawText, reportId) 与 similarityBetweenTexts(a, b)
```

`/eval` 页面本身也是复现入口：页面上的 MAE、逐项命中率与分布均由 `lib/analysis.ts` 的纯函数**实时计算**，
可对照本文件的数字逐项核对。

---

## 七、结论

- **可信的部分**：契约一致性（13/13）、总分口径（13/13）、档位—得分链（全项）、
  结果完整性（指纹 13/13）、评测指标（MAE 3.05）—— 这些都是**确定性、可独立复算**的。
- **不可信/未证的部分**：Web 端不重跑推理；核查器未接线；无回归测试；
  低分档偏差偏大；样本量小、金标准单人标注。
- 一句话：**本项目敢把"AI 评阅"拿来做工程验证，但边界与短板都写在明面上。**
