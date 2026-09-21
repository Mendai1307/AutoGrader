# 架构说明（写实版）

> 本文只描述**仓库里实际存在的东西**。凡标注"实测"的数字，均由本次整理时直接读取文件/复算得出；
> 未实现、未接线的部分单独列出，不做美化。
>
> 相关文档：[`contract.md`](contract.md)（数据契约）、[`ai-agent.md`](ai-agent.md)（五 Agent 流水线）、
> [`prompt-design.md`](prompt-design.md)（prompt 设计原则）、[`testing.md`](testing.md)（验证说明）、
> [`deliverable-strategy.md`](deliverable-strategy.md)（架构范式的论证过程）。

---

## 一、一句话架构

**Compile-time AI（构建期 AI）**：AI 推理发生在**开发期的 LearnBuddy 对话侧**，
产出结构化 `ReviewResult` JSON 固化为仓库资产；Web 端在**运行时零 AI 调用、零后端、零数据库**，
只做确定性渲染与浏览器端规则核查。

```
┌─ 开发期（LearnBuddy 平台侧，AI 只在这里发生）────────────────────────────┐
│  报告原文（demo/sample-reports/*.md）                                    │
│        ↓                                                                │
│  Parser → Evidence → Grader → Reviewer → Feedback   （五 Agent 流水线）  │
│        ↓                                                                │
│  ReviewResult JSON（严格符合 frontend/lib/schema.ts 契约）               │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 提交进仓库（固化为静态资产）
                               ▼
┌─ 构建期（next build，只做确定性校验与渲染）─────────────────────────────┐
│  frontend/lib/data.ts   用 node:fs 读 demo/ 与 public/results/          │
│         ↓               并用 zod 校验每份结果（不合契约即拒绝渲染）       │
│  同时调用 lib/inspectors/ 做客观核查、调用 schema.ts 做分数自证复算，      │
│  结果一并固化进 HTML                                                     │
│         ↓                                                                │
│  frontend/app/*         生成静态 HTML                                   │
│         ↓                                                                │
│  frontend/out/          ← 唯一部署单元（实测 70 个文件 / 33 个目录）      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 静态托管（GitHub Actions 自动发布，见 3.7 节）
                               ▼
┌─ 运行时（浏览器里，零 AI / 零后端 / 零数据库）──────────────────────────┐
│  静态 HTML + 同源 CSS/JS/JSON → 确定性渲染                               │
│  （客观核查面板与分数自证结果都已在构建期算好并写进 HTML，               │
│    运行时只做展示，不发起任何请求、不做任何计算）                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 二、为什么这样设计（对齐赛事约束）

赛事约束（提取过程见 [`deliverable-strategy.md`](deliverable-strategy.md) 第一节）与本架构的对应关系：

| 约束 | 架构含义 | 本仓库的落地方式 |
|---|---|---|
| 以 LearnBuddy 平台为载体，最好不要包含第三方 AI | 仓库内不得出现任何大模型调用与 SDK 依赖 | `frontend/package.json` 依赖只有 `next` / `react` / `react-dom` / `zod` / `tailwind-merge` / `clsx` / `lucide-react` / `class-variance-authority`；**无** `openai` / `anthropic` / `langchain-*` |
| 平台没有开放给网页用的 API | 不存在"前端运行时调 AI"这条路 | AI 推理前移到开发期，产物固化为 JSON |
| 初赛提交 demo 即可，不用部署正式环境 | 不需要生产级后端 / 数据库 / 鉴权 | 无后端进程、无数据库、无密钥 |
| 作品须部署至浏览器环境，提供在线链接 | 必须有 URL，且要稳 | Next.js `output: 'export'` 纯静态导出，任意静态托管可承载 |
| 须提交完整源码仓库，依赖越少越好 | clone 下来要能跑通 | 运行时依赖 8 个包，构建只依赖 Node + npm |
| 需提交对话记录作为评审参考 | 结果必须能回溯到具体对话 | 每份 JSON 的 `provenance.sourceConversationId` / `sourceTurnId` |

**核心取舍**：AI 推理前移，换来三件事 ——
**可复现**（同一份 JSON 永远渲染同一结果，不受模型随机性影响）、
**可审计**（每份结果能回溯到人证与对话轮次）、
**可评测**（有金标准 JSON，才能做 AI vs 教师的一致性对比，见 `/eval`）。
代价同样明确：Web 端**不可重跑推理、无上传入口**（已写入 README 第九节"已知局限"）。

---

## 三、数据流（实测路径）

### 3.1 构建期数据源（`demo/`，不部署）

| 文件 | 内容 | 实测 |
|---|---|---|
| `demo/sample-reports/manifest.json` | 12 份样例元信息 + 教师金标准分（`goldTotalScore`、逐项 `expectedItemScores`）+ 总分公式声明 | 12 条 |
| `demo/sample-reports/sample-01.md` … `sample-12.md` | 12 份样例报告原文（Markdown） | 12 个文件 |
| `demo/rubric/rubric.json` | Rubric：`rubric-cs-lab-report-generic` v1.0.0，12 个评分点（R1–R12），权重和 = 100 | 12 项 |
| `demo/rubric/rubric.md` | 面向人阅读的 Rubric 说明 | — |

### 3.2 构建期静态资产（`frontend/public/results/`）

命名约定 `result-{reportId}.json`，实测 13 个文件：`result-sample-01.json` … `result-sample-12.json`
加一份 `_example.json`（契约格式示例）。**以 `_` 开头的文件被明确排除在"真实结果"之外**
（`data.ts` 的 `listResultFiles()`），不会被当作任何报告的评阅结果渲染。

### 3.3 构建期读取链路（`frontend/lib/data.ts`）

| 函数 | 行为 |
|---|---|
| `findDemoDir()` | 构建期 `cwd` 为 `frontend/`，故按 `../demo` 解析；找不到再退回 `./demo` |
| `getManifest()` / `getRubric()` | `node:fs` 读取 + 进程内缓存；rubric 经 `RubricSchema.parse()` 校验 |
| `getReportMarkdown(id)` | 读原文；文件缺失返回空串，**不抛异常** |
| `listResultFiles()` | 仅 `.json`，排除 `_` 前缀 |
| `getResultState(id)` | 三态返回：`ok`（契约校验通过）/ `missing`（无文件）/ `invalid`（校验失败并附 `issues`） |

**降级策略**：缺结果 → 页面渲染"评阅结果待生成"空态；契约不合法 → 渲染契约错误面板。
两种情形都**不白屏、不抛异常**。

### 3.4 契约枢纽（`frontend/lib/schema.ts`）

同一份 Zod schema 同时约束三件事：**LearnBuddy 的输出格式、前端的 TS 类型（`z.infer` 推导）、
仓库里的 JSON 资产**。全部对象使用 `.strict()`（未知字段一律拒绝），因此 AI 无法"自由发挥"污染资产。

导出的确定性口径函数（纯函数，无副作用）：

| 函数 | 作用 |
|---|---|
| `validateReviewResult(input)` | 唯一校验入口，返回 `{ ok: true, data }` 或 `{ ok: false, issues }` |
| `computeWeightedTotal(scores)` | 总分口径：`round2(Σ(score_i / maxScore_i × weight_i))` |
| `verifyTotalScore(result)` | 核查声明总分与复算值（容差 0.01）；由 `/report/[id]` 的「口径复算」调用 |
| `verifyItemScore(item)` | 核查单项 `score ≈ maxScore × levelScoreRatio`；由 `/report/[id]` 的「单项档位自证」调用 |
| `computeItemScore(maxScore, ratio)` | 由档位系数算应得分 |
| `gradeConfidence(c)` / `needsReviewByConfidence(c)` | 置信度分级（`≥0.80` 高 / `≥0.60` 中 / 其余低）与复核触发（`<0.80`） |

### 3.5 页面（`frontend/app/`，实测 5 个路由文件 + layout）

| 路由 | 文件 | 行数 | 数据来源 |
|---|---|---|---|
| `/` | `app/page.tsx` | 246 | `constants.ts`（导航、五 Agent 元信息、AI 来源声明） |
| `/grade` | `app/grade/page.tsx` | 206 | `data.ts`（12 份样例 + 结果状态徽章） |
| `/eval` | `app/eval/page.tsx` | 609 | `data.ts` + `analysis.ts`（`computeMae` / `computeItemHits` / 分布统计） |
| `/trace` | `app/trace/page.tsx` | 453 | `getContractExample()` 读 `_example.json`，展开一条完整五 Agent 溯源链 + 阈值表 |
| `/report/[id]` | `app/report/[id]/page.tsx` | 625 | `data.ts`（原文 + 逐项评分 + 复核记录 + 评语）；构建期由 `generateStaticParams` 展开为 12 个静态页 |

页面另有两处构建期派生区块（详见第五、第六节）：`InspectionPanel`（客观核查）与分数面板里的
「单项档位自证 / 口径复算」（契约复算）。两处都在构建期算好、随 HTML 固化，运行时不参与计算。

> 上表「行数」为整理时的读数，属参考值；本轮新增了分数自证展示，行数已变动。

### 3.6 展示层与工具层

- `frontend/components/`：9 个业务组件（`agent-pipeline` / `score-item-card` / `provenance-block` /
  `inspection-panel` / `markdown-view` / `site-header` / `site-footer` / `stat-card` / `empty-state`）
  + `ui/` 下 7 个基础组件（`badge` / `button` / `card` / `progress` / `separator` / `table` / `tabs`；
  其中 `separator.tsx` 当前未被任何文件引用，删除动作被本机删除守卫拦截，故保留并在文件头标注）。
- `frontend/lib/constants.ts`：**仅承载展示用的中文名与配色**，口径类常量一律以 `schema.ts` 为准。
- `frontend/lib/analysis.ts`：评测计算纯函数（MAE = `(1/N)Σ|AI_i − 金标准_i|`、逐项档位命中率、分布统计）。
- `frontend/lib/utils.ts`：格式化（`formatScore` / `formatDelta` / `formatNumber`）与 `cn`。
- `frontend/next.config.mjs`：`output: 'export'`、`images.unoptimized: true`、`basePath`/`assetPrefix` 默认 `/AutoGrader`、
  `trailingSlash: true`（每路由输出 `<route>/index.html`）。

### 3.7 部署链路（GitHub Actions 自动发布）

| 项 | 内容 |
|---|---|
| 工作流 | `.github/workflows/deploy.yml` |
| 触发 | `push` 到 `main`；`workflow_dispatch` 手动触发 |
| 步骤 | `checkout`（**完整仓库**，含根 `demo/`）→ Node 22 + npm 缓存 → `npm ci`（`working-directory: frontend`）→ `npm run build`（注入 `NEXT_PUBLIC_BASE_PATH=/AutoGrader`）→ `configure-pages` → `upload-pages-artifact`（`path: frontend/out`）→ `deploy-pages` |
| 权限 / 并发 | `contents: read` `pages: write` `id-token: write`；`group: pages` + `cancel-in-progress: true` |
| 线上状态 | <https://mendai1307.github.io/AutoGrader/> 返回 HTTP 200（2026-09-21 实测） |

两个易踩的点，工作流文件内已注明：

1. 构建步骤**必须**以 `working-directory: frontend` 运行 —— `data.ts` 的 `findDemoDir()`
   按 `cwd/../demo` 解析数据源，这也是 `checkout` 必须是完整仓库的原因（`demo/` 在仓库根）。
2. `NEXT_PUBLIC_BASE_PATH` **显式注入**，不依赖 `next.config.mjs` 的默认值，
   避免默认值被改动后产出错误资源前缀、导致线上白屏。

`frontend/public/.nojekyll` 随产物一同发布，用于关闭 GitHub Pages 的 Jekyll 处理，
确保 `_next/` 目录不被吞掉。

---

## 四、构建产物（`frontend/out/`）

实测：**70 个文件 / 33 个目录**（含 12 个报告详情页与 13 个结果 JSON 拷贝）。
该目录即"唯一部署单元"，README 第一节列出的四条访问路径（GitHub Pages 主链接 / LearnBuddy 内置部署 /
CloudBase 兜底 / 本地 `npm run preview`）**指向同一份产物**，故展示效果一致。

> ⚠️ **产物自带子路径前缀**：默认构建 `basePath`/`assetPrefix` = `/AutoGrader`，
> 即产物内部的资源地址被固化为 `/AutoGrader/_next/...`。因此它**必须挂在 `/AutoGrader/` 子路径下访问**，
> 直接挂到网站根路径（`npx serve frontend/out`）会导致页面能打开但 CSS/JS 全部 404，表现为白屏。
> 本地预览统一走 `frontend/scripts/serve.mjs`（`npm run preview`），它会自动识别并复刻该前缀。

构建期校验的副作用（正面）：只要某份结果 JSON 不符合契约，`/report/[id]` 就会渲染契约错误面板而不是评分明细 ——
因此"构建成功且页面呈现分数"本身就是一次**全量契约校验通过的证据**（详见 [`testing.md`](testing.md)）。

---

## 五、Inspectors 的定位（含实情说明）

`frontend/lib/inspectors/`（8 个文件）是一组**非 AI、但真实运行**的确定性核查器：
纯函数、零外部依赖、不使用随机数与当前时间，Node 与浏览器结果一致。

| 模块 | 核查内容 |
|---|---|
| `chapters.ts` | 章节完整性（7 类必备章节，支持标题式与语义式匹配，排除伪标题） |
| `code.ts` | 代码块统计 + 关键词检测（`KEYWORD_CATALOG`，按实验主题分组，**仅在围栏代码块内**做词边界匹配） |
| `stats.ts` | 统计量（正文字数、代码行数、图表数等）并与阈值比对 |
| `figures.ts` | 图表引用核查（引用方式、题注、无实文件的"示意图占位"） |
| `similarity.ts` | SimHash 查重（两路 FNV-1a + 中文 2-gram，汉明距离换算相似度；`≥0.95` duplicate、`≥0.80` suspicious） |
| `markdown.ts` | 基础行扫描/围栏/图片解析 |
| `types.ts` | 核查器类型定义 |
| `index.ts` | 汇总入口 `inspectReport(rawText, reportId)` → `{ reportId, chapters, codes, stats, figures, findings }` |

**实情（重要）**：

1. **已接线**：核查器由 `lib/data.ts` 的 `getInspection()` / `getSimilarityPairs()` 统一调用，
   渲染在 `/report/[id]` 的「客观核查」区块（`components/inspection-panel.tsx`）。
   全部计算发生在**构建期**，结果随 HTML 固化；运行时不计算、不发请求。
   即：在已部署的静态站里，用户**能**看到核查器输出，构建产物中**有**核查结论文本。
2. 它仍是有价值的资产：本次整理曾在 Node 下**独立运行**该模块并复现出 12 份样例的核查发现
   （结论见 [`testing.md`](testing.md)），说明其逻辑可执行、结果可复算。
   接线后这些结论直接出现在页面上，不再需要单独跑脚本。
3. 它的定位是"**客观事实层**"：不判断代码正确性、不做语义评价、不给出抄袭结论；
   相似度只回答"两篇文本指纹有多接近"，最终结论仍由教师作出。
4. **未做**：全量 66 对相似度的矩阵 / 榜单页面。详情页只展示"与该报告最相似的一对"。

---

## 六、backend/ 的定位（不参与构建与部署）

```
backend/
├── agents/     ← 五 Agent 的 prompt 规格文档：parser.md / evidence.md / grader.md / reviewer.md / feedback.md
│                 （本目录不含任何模型调用代码，也不含 .py 可执行文件）
├── api/        ← 空目录（初赛不引入后端，规划位）
├── models/     ← 空目录（同上）
├── prompts/    ← 空目录（同上）
└── services/   ← 空目录（同上）
```

- 五 Agent 的**真正执行者是 LearnBuddy 平台**。规格文档的作用是：让"另一个 LLM 拿着它就能复现同样的行为"，
  同时给评审一个可核对的"能力说明书"。
- `frontend/next.config.mjs` 与 `package.json` 均**不引用** `backend/`，构建与部署链路中它不出现。
- `api/` / `models/` / `prompts/` / `services/` 是空目录 —— 空目录不被 git 跟踪，
  在 clone 下来的仓库中通常不可见。它们的存在只表达"曾规划过后端分层"，无需阅读。

---

## 七、依赖与配置（纯静态的事实）

- **运行时无后端、无数据库、无鉴权、无网络请求**（除加载同源静态资源）。
- **无密钥**：既没有第三方 AI 的 Key，也没有任何服务连接串。
- **不需要容器编排**：仓库内没有 `Dockerfile`，也没有可用的 Compose 服务定义
  （根目录 `docker-compose.yml` 已改为说明文件，声明本项目为纯静态、不使用容器）。
- **环境变量**：不依赖任何环境变量即可构建与运行。唯一的构建期可选项是
  `NEXT_PUBLIC_BASE_PATH`，用于切换子路径前缀，语义如下（由 `frontend/next.config.mjs` 解析）：

  | 取值 | 解析结果 | 用途 |
  |---|---|---|
  | 未设置 | `/AutoGrader` | GitHub Pages 项目子路径（默认） |
  | 空串 `''` | 无前缀 | 网站根路径部署 / 本地根路径预览 |
  | `/自定义` | `/自定义` | 其他子路径部署 |

  注意「未设置」与「显式置空」语义不同：空串必须能真正清空前缀，否则根路径预览会静默退回
  `/AutoGrader` 并导致根路径 404（这是早期实现用 `||` 回退造成的缺陷，已修复）。
- 部署动作只有一步：**把 `frontend/out/` 作为静态站点发布**。主链接这一步已由
  GitHub Actions 自动化（`.github/workflows/deploy.yml`，见 3.7 节）：`push` 到 `main` 即自动重建并发布，
  无需人工上传；本地 `npm run preview` 与线上使用同一套 basePath 解析逻辑。

---

## 八、这套架构的边界（与 README 第九节一致）

1. Web 端**不可重跑推理、无上传入口** —— 只能浏览既有 12 份样例的评阅链路（架构前提的直接代价）。
2. 结果质量取决于开发期推理：低分档报告的偏差偏大（差档平均绝对误差 8.00 分，`sample-04` 差 14.0 分）。
3. 样例为合成脱敏数据（12 份 = 3 主题 × 4 难度档），样本量小，不具统计显著性。
4. 金标准由单人手工核算，不是多教师双盲标注。
5. 报告中的 `figures/*.png` 未随仓库提供，图表类证据只能依据图题判读。
