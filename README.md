# AutoGrader

**由 LearnBuddy 专家智能体真实驱动的计算机专业实验报告智能评阅系统。**

粤港澳大湾区 AI Coding 创新大赛（LearnBuddy 版）· 方向一「AI + 教学管理助手」。
选题定义：支持计算机专业实验报告自动解析、评分点逐项核查、成绩评语智能生成的智能评阅教学平台。

> **本 README 的性质**：**评审导向**。只写本仓库里已存在、可实测的事实，未完成项一律显式标注。
> 每条关键论断都给出「去哪验」，便于评委独立复核。

---

## 一、一句话看懂

**AI 跑在 LearnBuddy 里，产品放在浏览器里，证据留在仓库和对话记录里。**

AutoGrader 不是一个「网页里塞个 AI 调用」的作品。它刻意把 AI 推理放在
**LearnBuddy 对话侧**（专家智能体在那里运行），产出结构化的 `ReviewResult` JSON 提交进仓库；
而**浏览器端运行时零 AI 调用、零后端**，只做两件事：确定性渲染，以及用纯前端规则引擎复核。

这个选择叫 **Compile-time AI**，换来的三件事正是本作品要证明的：

| 换来什么 | 凭什么成立 |
|---|---|
| **结果可复现** | 同一份 `ReviewResult` 在任何机器上渲染出完全相同的页面；分数由纯算术得出，无模型参与 |
| **过程可审计** | 每个分数都能追到评分点 → 证据引用 → 报告原文的逐字位置；摘要与原文由工具逐字比对，**不做任何模糊归一化** |
| **质量可评测** | 12 份样例 × 教师金标准 → 四项指标可独立复算，且与上一版公布值**逐值一致** |

## 二、三项交付物

| # | 交付物 | 角色 | 状态 |
|---|---|---|---|
| 一 | **专家智能体包**（Prompt + Skills + Tools + Workflow + Evaluation） | 能力本体，AI 在这里跑 | ✅ **五件套 + 打包层全部落地**，已通过官方校验并注册到市场 |
| 二 | **Web Demo 产品展示页** | 产品形态（在线链接 + 源码仓库） | ✅ **7 个路由全部落地并实测**；⬜ 线上链接待发布 |
| 三 | **评审材料包**（PPT / 3 分钟视频 / 对话记录归档） | 佐证链 | 🟡 **对话记录归档已交付**（见 §六）；⬜ PPT 与视频待产出 |

**上一轮（v0.1）资产**在**同级目录** `../AutoGrader`（线上 `https://mendai1307.github.io/AutoGrader/`）：
5 页面静态站、12 份合成样例 + 教师金标准 + 12 份真实评阅结果（MAE 3.05）。
本项目以它为**复用基线**，并把「v0.1 资产」移植为 1.2.0 契约下的合规数据（见 §五）。

## 三、怎么跑、怎么验（三条命令）

工具链只用 **Python 标准库**（无第三方依赖、无网络调用、无 AI 调用）。约定 `python3` 优先、`python` 回退。

### 3.1 跑 Web Demo（交付物二）

```bash
cd web
npm ci
npm run build && npm run preview     # 本地起静态站
```

`npm run build` 已串联**三道构建期门禁**——任一道不过就不出产物：

| 门禁 | 检查什么 |
|---|---|
| `sync-assets` | 把随包资产同步进 `web/`，使其**自包含**（站点不依赖后端） |
| `contract-check` | Zod 契约与 JSON Schema 的**对象层/字段差异**（实测 23 个对象层 / 132 字段零差异） |
| `check-fonts` | 中文字体子集的**码位覆盖**（防止真机出现豆腐块） |

另有单独的跨端对拍与产物自检：

```bash
npm run audit:cross-end    # 浏览器端规则引擎 ↔ 工具链 T2，同一输入必须同结论（实测 12/12）
npm run preview:check      # 起静态服务并冒烟
npm run typecheck          # tsc --noEmit（应 0 错）
```

### 3.2 验六件工具与契约（交付物一）

```bash
# 六个工具自测（61 项断言，应全部通过、退出码 0）
cd backend/autograder-expert/agents/tools/scripts
for f in document_parser rule_inspector citation_resolver \
         deterministic_calculator contract_validator asset_store; do
  python3 "$f.py" --self-test; echo "$f exit=$?"
done

# 指纹算法跨语言一致（Python 与 JS 两侧必须逐字相同）
python3 contract/fingerprint.py --input <result.json> --check
node    contract/fingerprint.mjs --input <result.json> --check

# 契约校验：六项检查（Rubric 与 ReviewResult 两类）
python3 contract_validator.py --kind review-result --input <result.json>
```

**退出码（全局约定，CI 依赖它）**：`0` 正常 ｜ `1` 可继续但需注意 ｜ `2` 输入不可读或非法 ｜
**`3` 降级运行（校验没跑全 → CI 视为不通过）**。

### 3.3 出评测报告并过回归门禁

```bash
EV=backend/autograder-expert/agents/evaluations
python3 $EV/scripts/evaluate.py --results web/public/results \
  --gold "<金标准 manifest.json>" --out /tmp/metrics.json --report /tmp/metrics.md
python3 $EV/scripts/regression_gate.py \
  --baseline $EV/baselines/2026-09-26.json --current /tmp/metrics.json --text
```

### 3.4 打包专家包（可选）

```bash
python3 backend/autograder-expert/build_expert.py --validate --register
# 另有 --dry-run 预演 / --package 打 zip / --tools-dir 指定校验器目录
```

## 四、Web Demo 有什么（7 个路由）

| 路由 | 页面 | 看点 |
|---|---|---|
| `/` | 首页 | 三句话讲清范式：推理在对话侧 / Web 只做确定性渲染 / 每个结论可回溯 |
| `/agents` | 智能体构成 · 五件套 | Prompt / Skills / Tools / Workflow / Evaluation 各自职责与落点 |
| `/grade` | 评阅工作台 | 12 份评阅结果列表与详情入口 |
| `/report/[id]` | 评阅结果详情 | **指纹现场复算**（`ProvenanceBlock` 显示「复算一致/不一致」+ 复算值）+ `total` 口径面板（`weightIncluded` / `weightExcluded` / `upperBound` / `isPartial` / 未计入项） |
| `/upload` | 上传核查 | 浏览器端**零依赖**解析 docx，并复刻工具链 T2 的 13 条规则——**同一份输入，浏览器与智能体侧结论必须一致** |
| `/eval` | 一致性评测 | 总分 MAE / 逐项命中率 / 档位一致率 / 置信度校准 ECE，**浏览器端现算**（每个数字都能追到一行可查看的 JS）+ 4 张零依赖 SVG 图 |
| `/trace` | 工作流溯源 | 五 Agent 编排逐环展示，指纹复算结论与 `/report/[id]` **同源** |

**两处刻意的工程取舍（不是缺陷，特此说明）**：

1. **`/eval` 用「分区堆叠」而非页签**——本项是 `output: 'export'` 纯静态站，页签只渲染当前那一个，
   **非活动页签的内容根本不进 HTML**（实测 12 个 `<svg>` 全是图标、`role="img"` 计 0），
   等于「图看不到、也核验不了」。改用始终渲染的分区堆叠后，内容可检索、可核验、无 JS 也能看。
2. **需要「内容始终在 HTML 里」时用原生 `<details>`**——「保持页面简洁」不能退化成「把内容拿掉」；
   收起时正文仍在静态 HTML 里，渲染核验脚本专门断言这一点。

## 五、硬口径速查（写死，不得改写）

- **总分** = `Σ (score / maxScore) × weight` —— **不是** `Σ (score × weight / 100)`
- **权重序列**（和 = 100）：`5 / 12 / 5 / 7 / 20 / 10 / 11 / 13 / 7 / 5 / 3 / 2`
- **待复核项不计入求和、不做归一化** → 总分是**部分分（下界）**，必须携带 `W_r`
  （归一化会让「教师认真复核」表现为分数往下掉）
- **上界 = 已计入权重合计**（`weightIncluded`），**不是** `100 − W_r`
- **等级**仅在 `W_r = 0` 且已计入权重合计 = 100 时映射
- 每个评分点 `maxScore` 是教师自定标度，**占比只由 `weight` 决定**
- **契约版本 1.2.0**：以 v0.1 Zod 契约为基线的**向后兼容超集**，新增字段一律 optional
  → 12 份历史资产一行不改，**同时通过 Zod（前端契约）与 T5（工具链六项检查）双端校验**（12/12）

**契约的机器真源**在 `contract/*.schema.json`，人类可读说明在 `docs/contract.md`（含 13 条不变式）。

## 六、对话记录归档（交付物三 · 已交付）

研发全程的对话已归档至 **`documents/dev_log/`**（对应《步骤路径规划书》**§3.3**）：

| 文件 | 作用 |
|---|---|
| `README.md` | **审阅指引**：三级可追溯结构 / 加工方式如实声明 / 建议阅读路径 |
| `对话记录索引.md` | **39 轮逐轮索引**，五要素齐备（日期 / 目的 / 结论 / 产物 / 对话 ID）+ 指向转录的可点击链接 |
| `C-000-C-000.md` … `C-034-C-038.md` | **9 份逐字转录** |

**规模**：39 轮（C-000 – C-038，**连续无缺号**）/ 9 份会话 / 112 次用户输入 / 812 次助手回复 /
2186 次工具调用。原始记录 33 MB / 7501 行 → 归档 11 份 / 874 KB（约 1/38）。

**加工口径（如实声明）**：凡属「谁说了什么」的，**一字未改**（用户输入与助手回复逐字保留）；
凡属「机器跑了什么」的，压成一行（工具名 + 关键参数 + 成功与否）；工具返回正文、内部推理、
系统注入内容已移除。**含 2 轮被中断 / 无结论的会话（C-000、C-027），未做美化删除。**

导出脚本带**完整性断言**：磁盘上每个会话记录文件都必须被登记，否则中止导出——
**不存在「挑了好看的几轮放进来」的可能**。

## 七、当前进度（如实）

| 交付物 | 状态 |
|---|---|
| **一 · 专家智能体包** | ✅ **全部落地**。五件套已齐；契约冻结 **1.2.0**；六脚本自测 **61 项**全通过；打包层装配成平台合规专家包，**已通过官方 `validate_expert.py` 校验并注册到 my-experts 市场**（专家中心可召唤）。⬜ 唯一遗留：**头像**（`avatars/` 为空，需图像生成，未执行） |
| **二 · Web Demo** | ✅ **7 个路由全部落地并实测**：`tsc` 0 错、三道门禁全绿、跨端对拍 12/12、渲染核验 38/38、`next build` 静态页 21/21。⬜ **线上链接待发布** |
| **三 · 评审材料包** | 🟡 **对话记录归档已交付**（§六）。⬜ 作品介绍 PPT、3 分钟 Demo 视频待产出 |

**评测数据（12 份资产 × 教师金标准）**：总分 MAE **3.05**、差档 MAE **8.0**、
最大偏差 **14.0（`sample-04`）**、档位一致率 **0.74**（106/144）、ECE **0.12** ——
前三项与 v0.1 公布值**逐值一致**（独立复现，不是照抄）。

## 八、已知未闭合项（如实列出，不遮掩）

| # | 项 | 说明 |
|---|---|---|
| 1 | **线上链接** | 部署工作流（`.github/workflows/deploy.yml`）已就位（Node 22 → 跨端对拍 → 三道门禁 → `preview:check` → deploy-pages），**待用户建仓后取得链接** |
| 2 | 专家包**头像** | `avatars/` 为空 → 配置指向的 `avatars/expert.png` 暂缺。官方校验器对本项**只告警不报错**，故包仍然有效。生成头像需图像生成工具（产生额外额度消耗），未执行 |
| 3 | **本机产不出 `out/`** | 宿主 `safe-delete` 拦截所致（**环境问题，非代码问题**）。构建本身成功：`next build` 的编译 ✓ / 类型检查 ✓ / 静态页生成 21/21 ✓ |
| 4 | 两种编排形态的实跑对照 | `workflow/W2` 给出**可校验的等价性判据**；真正的「两种形态跑同一份报告」需**真实 LearnBuddy 会话** |
| 5 | **PPT 与 3 分钟视频** | 交付物三尚未产出 |
| 6 | `LICENSE` | 未添加 |
| 7 | 三个技能状态 | 模式 1 建标待 **S0 路由扩展**；模式 2 评阅待**批量参数**（需新增契约字段 + 归属 Skill，**当前未设计**）；模式 3 复核**已无外部阻塞** |

## 九、目录导航

```
AutoGrader_rebirth/
├── README.md                       # 本文件（评审导向）
├── .gitignore                      # 只排除产物与过程，不排除证据
├── .github/workflows/deploy.yml    # 交付物二构建与部署（含三道门禁）
├── documents/                      # 文档与立项材料
│   ├── 项目总纲与同步状态.md        #   跨对话对齐的唯一入口 —— 开工先读
│   ├── AUDIT.md                    #   缺陷登记与修复依据的唯一清单
│   ├── 契约冻结方案.md              #   契约冻结的决策方案（D1–D5 已裁决）
│   ├── 工具使用说明.md              #   平台侧「工具调用通道」的四条路径取证
│   ├── dev_log/                    #   ✅ 对话记录归档（§3.3）：README + 索引 + 9 份逐字转录
│   └── v1.0 / v1.1 docx            #   立项材料：v1.0 原样存档 + v1.1 修订版 + 口径变更说明
├── contract/                       # ✅ 契约层（机器可读真源）
│   ├── ReviewResult.schema.json    #   JSON Schema draft-07，additionalProperties:false
│   ├── Rubric.schema.json
│   ├── fingerprint.py              #   结果指纹算法（Python 侧）
│   └── fingerprint.mjs             #   同一算法的 JS 侧对照实现
├── docs/contract.md                # ✅ 契约说明（字段表 / 口径 / 13 条不变式 / 映射表 / 迁移规则）
├── web/                            # 交付物二：Web Demo（Next 15 静态导出）
│   ├── app/                        #   7 个路由
│   ├── components/                 #   可复用原语（note / charts / eval-metrics / deep-link-button …）
│   ├── scripts/                    #   三道门禁 + 跨端对拍 + 静态服务 + 字体子集
│   └── public/results/             #   12 份评阅结果 JSON（v0.1 副本 + 回填 total）
└── backend/autograder-expert/      # 交付物一：专家智能体包
    ├── agents/                     #   五件套源
    │   ├── agent/SYSTEM_PROMPT.md  #     Prompt v0.2
    │   ├── skills/                 #     S0–S7 八份规格 + 索引
    │   ├── tools/                  #     T1–T6 规格 + rules/ + scripts/（6 CLI）+ assets/（四类随包资产）
    │   ├── workflow/               #     W1 五环 / W2 编排形态 / W3 失败与重试
    │   └── evaluations/            #     metrics.md（口径真源）+ 2 CLI + baselines/
    ├── build_expert.py             #   打包层（自测 21 项）
    └── packaging/                  #   expert.manifest.json（映射真源）+ PLUGIN_README.md
```

## 十、文档索引

| 想知道什么 | 去哪看 |
|---|---|
| 项目目标、口径、进度、目录约定、对话归档索引 | `documents/项目总纲与同步状态.md` |
| **研发全程的对话与决策过程** | `documents/dev_log/README.md`（从索引进逐字转录） |
| 契约字段、13 条不变式、总分与指纹口径、字段映射、迁移规则 | `docs/contract.md`（机器真源 `contract/*.schema.json`） |
| 缺陷清单与修复依据 | `documents/AUDIT.md` |
| 契约冻结的决策过程（D1–D5） | `documents/契约冻结方案.md` |
| 平台侧为什么只能走脚本（四条能力通道与取证） | `documents/工具使用说明.md` |
| 六个工具 / 八个技能 / 编排 / 评测的规格 | `backend/autograder-expert/agents/{tools,skills,workflow,evaluations}/README.md` |
| 本地怎么跑、怎么部署 | `web/README.md` |

---

**团队**：2 人（**软件工程** + **计算机科学与技术**），「2 个及以上不同专业/院系」
