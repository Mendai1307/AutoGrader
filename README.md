# AutoGrader

**由 LearnBuddy 专家智能体真实驱动的计算机专业实验报告智能评阅系统。**

粤港澳大湾区 AI Coding 创新大赛（LearnBuddy 版）· 方向一「AI + 教学管理助手」。
选题定义：支持计算机专业实验报告自动解析、评分点逐项核查与成绩评语智能生成的智能评阅教学平台。

> **本 README 的性质**：**开发期 README**，只陈述当前仓库里已存在、可实测的事实，
> 并显式标注未建项。赛事要求的「评审导向 README」（在线链接 / 启动命令 / 对话记录索引）
> 待交付物二、三就位后重写（见 `AutoGrader 项目目标定义书_v1.1.docx` §4.2 验收标准）。

---

## 一、核心范式：Compile-time AI

**AI 推理全部发生在 LearnBuddy 对话侧**：五 Agent 流水线（Parser → Evidence → Grader → Reviewer → Feedback）
在对话中产出 `ReviewResult` JSON 并提交进仓库；Web 端运行时**零 AI 调用、零后端**，
只做确定性渲染与浏览器端规则核查。

这是在「LearnBuddy 为赛事唯一指定平台」+「必须提供在线链接」双重约束下的解，
换来三件事：**结果可复现、过程可审计、质量可评测**。

> 推论：**确定性能力只能做成可执行脚本**（CLI + JSON 出参），由平台内置 `Bash` 调起。
> 平台**不存在「开发者注册工具」通道**（官方明文：所有工具权限由系统统一分配），
> 因此本仓库的 `tools/` 是**开发期暂存落点**，打包时须映射到 `skills/<技能名>/scripts/` 或插件根 `bin/`。

## 二、怎么跑、怎么验

工具链只用 **Python 标准库**（无第三方依赖、无网络调用、无 AI 调用）。解释器约定 `python3` 优先、`python` 回退。

```bash
# 六个工具的自测（61 项断言，应全部通过、退出码 0）
cd backend/autograder-expert/agents/tools/scripts
for f in document_parser rule_inspector citation_resolver deterministic_calculator contract_validator asset_store; do
  python3 "$f.py" --self-test; echo "$f exit=$?"
done

# 契约层自测与复算
python3 contract/fingerprint.py --self-test
python3 contract/fingerprint.py --input <result.json> --check     # 与声明指纹比对
node   contract/fingerprint.mjs --input <result.json> --check     # JS 侧同一算法（跨语言一致）

# 评测层：一条命令出评测报告（口径真源见 .../evaluations/metrics.md）
EV=backend/autograder-expert/agents/evaluations
python3 $EV/scripts/evaluate.py --results web/public/results \
  --gold "<金标准 manifest.json>" --out /tmp/metrics.json --report /tmp/metrics.md

# 回归门禁：CI 只看退出码（0 通过 / 1 劣化 / 3 判定不完整）
python3 $EV/scripts/regression_gate.py --baseline $EV/baselines/2026-09-26.json \
  --current /tmp/metrics.json --text

# 打包层：把五件套装配成平台合规专家包（--validate / --register 走官方校验器与注册脚本）
python3 backend/autograder-expert/build_expert.py --validate --register
```

`tools/` 六个脚本的典型用法：

```bash
# T1 解析报告（docx / pdf / md / txt）→ 带坐标的结构对象
python3 document_parser.py --input "/abs/report.docx" --out "/abs/t1.json"

# T2 客观核查（规则集驱动，只出事实）
python3 rule_inspector.py --report "/abs/t1.json"

# T3 引用忠实度校验（逐字比对，证据造假在此被拦下）
python3 citation_resolver.py --report "/abs/t1.json" --candidates "/abs/cands.json"

# T4 纯算术：部分分总分 / W_r / 上界 / 等级 / 复核排序键
python3 deterministic_calculator.py --input "/abs/result.json" --mode total

# T5 契约校验（六项检查，Rubric 与 ReviewResult 两类）
python3 contract_validator.py --kind review-result --input "/abs/result.json"
```

**退出码（全局约定）**：`0` 正常 ｜ `1` 可继续但需注意 ｜ `2` 输入不可读或非法 ｜ `3` 降级运行（CI 视为不通过）。

## 三、目录导航

```
AutoGrader_rebirth/
├── 项目总纲与同步状态.md            # 多对话对齐的唯一入口 —— 开工先读
├── AUDIT.md                        # 缺陷登记与修复依据的唯一清单
├── 契约冻结方案.md                  # 契约冻结的决策方案（D1–D5 已裁决）
├── 工具使用说明.md                  # 平台侧「工具调用通道」的取证结论
├── 目标定义书 / 规划书 / 口径变更说明 (docx)   # 立项材料：v1.0 原样存档 + v1.1 修订版
├── contract/                       # ✅ 契约层（机器可读真源）
│   ├── ReviewResult.schema.json    #   JSON Schema draft-07，additionalProperties:false
│   ├── Rubric.schema.json
│   ├── fingerprint.py              #   结果指纹算法（Python 侧）
│   └── fingerprint.mjs             #   同一算法的 JS 侧对照实现
├── docs/contract.md                # ✅ 契约说明（字段表 / 口径 / 13 条不变式 / 映射表 / 迁移规则）
├── backend/autograder-expert/      # 交付物一：专家智能体包
│   ├── agents/                     #   五件套源（开发期布局）
│   │   ├── agent/SYSTEM_PROMPT.md  #     ✅ Prompt
│   │   ├── skills/                 #     ✅ S0–S7 八个技能规格 + README 索引
│   │   ├── tools/                  #     ✅ T1–T6 规格 + README + rules/ + scripts/（6 个 CLI）+ assets/（四类随包资产）
│   │   ├── workflow/               #     ✅ 编排规格：README + W1 五环 / W2 编排形态 / W3 失败与重试
│   │   └── evaluations/            #     ✅ 评测层：README + metrics.md + scripts/（2 个 CLI）+ baselines/
│   ├── build_expert.py             #   ✅ 打包层：装配成平台合规专家包（自测 21 项）
│   └── packaging/                  #   ✅ expert.manifest.json（映射唯一真源）+ PLUGIN_README.md + dist/*.zip
├── web/public/results/             # ✅ 12 份评阅结果 JSON（v0.1 资产的副本 + 回填 `total`）
└── .work/                          # 过程脚本与中间产物（非交付物）
```

## 四、硬口径速查（写死）

- **总分** = `Σ (score / maxScore) × weight` —— **不是** `Σ (score × weight / 100)`
- **权重序列**（和 = 100）：`5 / 12 / 5 / 7 / 20 / 10 / 11 / 13 / 7 / 5 / 3 / 2`
- **待复核项不计入求和、不做归一化** → 总分是**部分分（下界）**，必须携带 `W_r`
  （归一化会让「教师认真复核」表现为分数往下掉）
- **上界 = 已计入权重合计**（`weightIncluded`），**不是** `100 − W_r`
- **等级**仅在 `W_r = 0` 且已计入权重合计 = 100 时映射
- 每个评分点 `maxScore` 是教师自定标度，**占比只由 `weight` 决定**
- **契约冻结版 1.2.0**：以 v0.1 Zod 契约为基线的向后兼容超集，新增字段一律 optional
  （1.2.0 相对 1.1.0 只放宽了 `total.grade` 的取值域：四项语义档位 → 等级名或 `null`）
  → 12 份历史资产一行不改，同时通过 **Zod（前端契约）** 与 **T5（工具链六项检查）** 双端校验

## 五、当前进度

| 交付物 | 状态 |
|---|---|
| 一 · 专家智能体包 | ✅ **五件套 + 打包层全部落地**：Prompt / Skills / Tools / Workflow / Evaluation 已齐，契约冻结 **1.2.0**；打包层把它装配成平台合规专家包，**已通过官方校验并注册到市场**（专家中心可召唤） |
| 二 · Web Demo 产品展示页 | ⬜ 未开始（v0.1 静态站为复用基线，见下） |
| 三 · 评审材料包 | ⬜ 未开始 |

**上一轮（v0.1）资产**在**同级目录** `../AutoGrader`（GitHub `Mendai1307/AutoGrader`，线上 `https://mendai1307.github.io/AutoGrader/`）：
5 页面静态站、Rubric R1–R12、12 份合成样例 + 教师金标准 + 12 份真实评阅结果（MAE 3.05）、
浏览器端确定性核查器、GitHub Actions 部署。本项目以它为交付物二的复用基线。

## 六、已知未闭合项（如实列出）

| # | 项 | 说明 |
|---|---|---|
| 1 | 专家包**头像** | `avatars/` 为空（仅 `.gitkeep`）→ 配置里指向的 `avatars/expert.png` 暂缺，官方校验器对本项**只告警不报错**，故包仍然有效。生成头像需用图像生成工具（会产生额外额度消耗），本回合未执行 |
| 2 | 两种编排形态的实跑对照 | `workflow/W2` 给出的是**可校验的等价性判据**；真正的「两种形态跑同一份报告」需**真实 LearnBuddy 会话**（AI 在对话侧运行），本工作区只能保证规格齐备与产物形状可校验 |
| 3 | 本仓库 | **尚未加 `.gitignore` 与 `LICENSE`**；根 README（本文件）为开发期版本 |

**已闭合项（登记以便对照）**：

- `total.grade` 值域冲突 —— 契约已修（**1.2.0**：该字段放宽为「等级名或 `null`」）
- **R1**（读入既有 `ReviewResult` 的通道）—— 走**平台内置读取能力**，不新增工具、不扩展 T6
- **R2**（逐项携带 AI 建议分 / 终值 / 是否被教师改）—— 由不变式 I7 强制
- **Workflow 层**（规划书 1.4.1 / 1.4.2 / 1.4.3）与 **Evaluation 层**（1.5.1 / 1.5.2 / 1.5.3）—— 2026-09-26 解冻并落地
- **随包资产根** `agents/tools/assets/` 与四类资产内容 —— 2026-09-26 落定
- **打包层** —— 2026-09-26 落地：专家包已通过官方校验并注册，专家中心可召唤

## 七、文档索引

| 想知道什么 | 去哪看 |
|---|---|
| 项目目标、口径、进度、目录约定、对话归档索引 | `项目总纲与同步状态.md` |
| 契约字段、13 条不变式、总分与指纹口径、T1/T3/T4 字段映射、迁移规则 | `docs/contract.md`（机器真源 `contract/*.schema.json`） |
| 缺陷清单与修复依据 | `AUDIT.md` |
| 契约冻结的决策过程（D1–D5） | `契约冻结方案.md` |
| 平台侧为什么只能走脚本（四条能力通道与取证） | `工具使用说明.md` |
| 六个工具与八个技能的规格 | `backend/autograder-expert/agents/tools/README.md`、`.../skills/README.md` |

---

**团队**：2 人（软件工程 + 计算机科学与技术），满足「2 个及以上不同专业/院系」加分条件。
