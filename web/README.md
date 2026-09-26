# AutoGrader · Web Demo 产品展示页

> 交付物二。**运行时零 AI 调用、零后端、零数据库**：AI 推理在 LearnBuddy 对话侧完成，
> 这里只做确定性渲染 + 浏览器端规则核查。

---

## 一、本地零配置跑起来

需要 **Node.js ≥ 22.6**（构建期脚本用 Node 原生 TypeScript type stripping 反射 Zod 契约，
故不能低于此版本）。**不需要** Python、不需要网络、不需要任何服务端。

```bash
cd web
npm ci          # 装依赖（版本已在 package-lock.json 锁定）
npm run build   # 构建（含三道门禁，见第三节）
npm run preview # 本地静态服务，默认 http://127.0.0.1:3000/
```

`npm run build` 的产物在 `web/out/`，`npm run preview` 会**自动识别**产物里固化的
子路径前缀并按它提供服务，因此不会出现"构建用子路径、服务用根路径"的错配。

### 其他常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（热更新） |
| `npm run preview:check` | 起服务并跑一轮冒烟自检（首页 / 静态资源 / 各路由 / 404 / 路径穿越），全绿才退出 0 |
| `npm run typecheck` | 只做类型检查 |
| `npm run sync:assets` | 从 `backend/` 同步资产进 `web/`（自包含打包用） |
| `npm run check:contract` | 契约一致性门禁（Zod ↔ JSON Schema 字段双向比对 + 12 份资产回归 + 指纹双实现对照） |
| `npm run check:fonts` | MiSans 子集自检（分片完整性、聚合摘要、字符覆盖） |
| `npm run audit:cross-end` | **跨端一致性对拍**：同一份输入分别喂 Web 端与工具链 T1/T2，逐条比对 |
| `npm run sync:fonts` | 重新裁剪 MiSans 子集（**开发期可选**，需要 `misans-webfont` 包，见 `public/fonts/PROVENANCE.md`） |

---

## 二、部署到 GitHub Pages

CI 已配好：`.github/workflows/deploy.yml`。步骤：

1. **建仓库并推代码**（仓库根就是本工作区，不是 `web/`）：

   ```bash
   cd <仓库根>
   git add -A
   git commit -m "web demo"
   git remote add origin https://github.com/<你>/<仓库名>.git
   git push -u origin main
   ```

2. **把 Pages 的来源设为 GitHub Actions**：仓库 → Settings → Pages → Source 选
   **GitHub Actions**（不要选 "Deploy from a branch"）。

3. 推完后 Actions 会自动跑：`跨端对拍 → 构建（含三道门禁）→ 产物冒烟自检 → 上传 → 发布`。
   发布完成后地址是 `https://<你>.github.io/<仓库名>/`。

**关于子路径**：项目站点需要 `/仓库名` 前缀，而"用户站点"（仓库名恰为 `<你>.github.io`）
必须没有前缀。workflow 里已按仓库名自动判定，**不要在 `next.config.mjs` 里改默认值** ——
默认是空串，因此本地构建天然跑在根路径，所见即所得。

---

## 三、三道构建门禁（为什么 build 会失败）

`npm run build` 串联了三道门禁。它们存在的意义是：**坏数据与掉字不许出包**，
而不是等运行时在页面上报错。

| 门禁 | 检查什么 | 失败即构建失败 |
|---|---|---|
| `sync-assets.mjs` | 从 `backend/` 同步 rubric / 金标准 / 样例 / 规则集 / 评测基线，并生成 `lib/*.generated.*` | 源与产物都没有时报错；产物齐全时按"自包含构建"继续 |
| `contract-check.mjs` | ① `lib/schema.ts`（Zod）与 `contract/*.schema.json` 的字段集合**逐层双向一致**；② 12 份结果资产 + 契约夹具全部通过校验；③ 指纹两套实现（`lib/fingerprint.ts` ↔ `contract/fingerprint.mjs`）逐位相同 | 任一不等即失败 |
| `check-fonts.mjs` | MiSans 分片文件齐全、聚合摘要与清单一致、四档字重齐备；**数据资产里的字符必须全部被字体覆盖** | 数据资产掉字即失败（源码文案掉字只告警） |

> 门禁 ① 里的"双向"是关键：只比一侧会漏掉两种情况 ——
> Zod 有而 Schema 没有（前端擅自加字段）、Schema 有而 Zod 没有（前端漏实现、会静默丢字段）。

---

## 四、目录导览

```
web/
├── app/                     页面（Next.js App Router，静态导出）
│   ├── page.tsx             首页：定位 + 五 Agent 流水线 + 三入口
│   ├── agents/             2.3 智能体五件套（数据由脚本机械抽取自仓库）
│   ├── grade/              评阅工作台（12 份样例）
│   ├── report/[id]/        2.4 结果详情（逐项证据 / 置信度 / 溯源链）
│   ├── upload/             2.5 上传核查（浏览器本地解析 + 规则核查）
│   ├── eval/               2.7 一致性评测（AI vs 教师金标准）
│   └── trace/              溯源与指纹
├── lib/
│   ├── schema.ts           Zod 契约（contract/*.schema.json 的向后兼容超集）
│   ├── fingerprint.ts      结果指纹（contract/fingerprint.mjs 的移植，浏览器可复算）
│   ├── parse.ts            浏览器端 md/txt 解析（T1 的 markdown 分支移植）
│   ├── docx.ts             浏览器端 docx 解析（T1 的 docx 分支移植，零依赖）
│   ├── rules-engine.ts     浏览器端核查引擎（T2 的移植，出参同形）
│   ├── inspectors/         浏览器端确定性核查器（章节 / 代码 / 图表 / 统计 / 相似度）
│   ├── data.ts             构建期数据层（只读 web/ 内路径）
│   ├── analysis.ts         评测指标纯函数（页面里现场复算）
│   └── *.generated.*       由 sync-assets.mjs 生成，**不要手改**
├── components/             展示组件（换肤只改 app/globals.css 的 :root）
├── public/
│   ├── results/            12 份评阅结果（契约 ReviewResult）
│   ├── assets/             同步进来的数据资产（rubric / 金标准 / 样例 / 语料 / 规则集 / 基线）
│   └── fonts/              MiSans 子集（四档 225 个分片，约 5.3 MB）＋ 许可与来源说明
├── fixtures/               构建期契约夹具（覆盖 total.grade 等级映射分支）
└── scripts/                构建期脚本与门禁（详见第三节）
```

### 两条维护约定

1. **`lib/*.generated.*` 与 `public/assets/*` 是脚本产物，别手改**。改内容请改
   `backend/autograder-expert/agents/` 下的源文件，再跑 `npm run sync:assets`。
2. **契约改了要同时改两处**：`contract/*.schema.json`（机器可读真源）与
   `lib/schema.ts`（前端实现）。改完 `npm run check:contract` 会告诉你是否对齐。

---

## 五、设计来历

视觉体系取自参考项目 [`LBEILC/RhineLabUI`](https://github.com/LBEILC/RhineLabUI) 的
`DESIGN.md`：暖灰白底、近黑正文、暖灰辅助文字、灰色细线、暖棕强调、暖杏金选中信号，
细线 + 紧凑排字 + 长短竖线刻度。字体为该参考项目同款 MiSans。

**色彩纪律**：单强调色 + 灰阶。档位、置信度、难度这类**数据语义一律不用红绿** ——
序数由 `●●○○` 这类刻度符号承担，程度由字重与灰阶承担；低饱和赭石仅保留给
"真的出错"（构建失败、契约校验不通过）。理由：红绿在色觉障碍下不可辨，
在黑白打印与低质量投屏上同样失效。

换肤只有一个落点：`app/globals.css` 的 `:root`（颜色以 `hsl(var(--x))` 三元组承载，
组件只写语义类名）。唯一例外是 `lib/constants.ts` 里的档位与置信度映射表，以及
`components/markdown-view.tsx` 里的代码块 —— 后者用"纸面反相"（近黑底 + 纸色字）表达，
同样取自参考设计的明暗关系。

---

## 六、许可与来源

- **MiSans**：小米 / 汉仪出品，随包分片与许可说明见 `public/fonts/PROVENANCE.md`。
- 其余依赖遵循各自原有许可。本项目不使用任何第三方 AI 依赖
  （无 `openai` / `anthropic` / `langchain-*`）。
