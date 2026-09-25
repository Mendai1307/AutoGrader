# AutoGrader Expert · 评阅官

> 面向高校教师的**计算机专业实验报告评阅专家**。
> 按教师自己的评分标准（Rubric）逐评分点核查，每条结论都能回答「凭什么这么说」，并且两下点击就能看到原文凭据。

**本包由 `backend/autograder-expert/build_expert.py` 从仓库源码树自动装配**——
不要在本目录里手改内容；改映射请改 `packaging/expert.manifest.json`，改内容请改仓库里的源文件，然后重新装配。

---

## 一、怎么安装 / 更新

```bash
# 从仓库根目录执行（会自动装配到专家目录、校验、并注册到市场）
python3 backend/autograder-expert/build_expert.py --validate --register
```

装配落点（**平台只在这个目录下检测专家**，放别处无法被识别）：

```
$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/autograder-expert/
```

注册后即可在 **专家中心 → 我的专家** 看到「**评阅官**」，点开即可对话。

## 二、五件套 → 平台布局的映射

平台插件根只认 `agents` / `skills` / `bin` / `avatars` 四个目录（外加 `.codebuddy-plugin/`），
没有「workflow」「evaluation」「tools」这样的槽位。因此五件套按下表映射：

| 五件套 | 仓库源（开发期布局） | 包内落点（平台布局） |
|---|---|---|
| **Prompt** | `agents/agent/SYSTEM_PROMPT.md` | `agents/autograder-expert.md`（frontmatter + 正文；**已按该文件的说明删去头部状态块与文末附录**） |
| **Skills** | `agents/skills/S0…S7.md`（8 份） | `skills/autograder-*/SKILL.md`（8 个技能目录） |
| **Workflow** | `agents/workflow/{README,W1,W2,W3}` | `skills/autograder-workflow/SKILL.md` + `references/W1…W3.md` |
| **Evaluation** | `agents/evaluations/{README,metrics}` | `skills/autograder-evaluation/SKILL.md` + `references/metrics.md` |
| **Tools** | `agents/tools/{README,T1…T6,scripts/,rules/,assets/}` + `agents/evaluations/scripts/` | `skills/autograder-tools/`：`SKILL.md` + `references/T1…T6.md` + `scripts/`（8 个 CLI）+ `rules/` + `contract/` + `assets/` |

**为什么 Tools 与评测脚本放在同一个技能目录下**：这些脚本用**相对自身位置**的方式定位三个同级目录——
`../rules/`（默认规则集）、`../assets/`（随包资产根）、以及向上查找的 `contract/`（契约与指纹算法）。
把它们放在同一个目录下，三处路径解析**无需改动任何一行脚本代码**即可成立。

## 三、包内目录

```
autograder-expert/
├── .codebuddy-plugin/plugin.json      # 专家元数据（展示字段 / 技能清单）
├── README.md                          # 本文件
├── avatars/                           # 头像位（当前为空，见「已知未做」）
├── agents/
│   └── autograder-expert.md           # Prompt 本体
└── skills/
    ├── autograder-task-router/        # S0 入口路由
    ├── autograder-rubric-builder/     # S1 评分标准构建
    ├── autograder-report-parser/      # S2 报告解析
    ├── autograder-evidence-grader/    # S3 取证与逐点判定
    ├── autograder-score-calculator/   # S4 总分计算
    ├── autograder-contract-assembler/ # S5 契约装配与自检
    ├── autograder-feedback-writer/    # S6 评语生成
    ├── autograder-review-checklist/   # S7 复核与解释
    ├── autograder-workflow/           # 编排规格（W1/W2/W3 在 references/）
    ├── autograder-evaluation/         # 评测规格（metrics.md 在 references/）
    └── autograder-tools/              # 确定性工具层 + 评测 CLI
        ├── SKILL.md
        ├── references/T1…T6.md
        ├── scripts/*.py               # 6 个工具 + 2 个评测 CLI
        ├── rules/default.rules.json
        ├── contract/*.schema.json + fingerprint.py/.mjs
        └── assets/{template,rubric,sample,gold}
```

## 四、能力边界（写死，不得含混）

- **面向教师，不面向学生**：任何学生视角的请求（「帮我改报告」「我为什么被扣分」）一律拒绝
- **只出建议，不出成绩**：产出的一切处于**建议态**，教师的确认闸门必经；专家**不得**自行宣布任何分数为终值
- **无证据不下结论**：找不到证据写「未找到」，**不得**表述为「没做 / 没写 / 缺失」
- **认定不可做**：复算、统计、相似度是它的；学术诚信认定、是否真正理解、特殊情况裁量是教师的
- **所有数字由确定性工具产出**：不接受模型口算（总分、未计入权重、上界、复核排序键）
- **平台不提供「开发者注册工具」通道**：本包的工具是**可执行 CLI 脚本**，由平台内置 `Bash` 以**绝对路径**调起；`agent.md` 的 frontmatter **不声明** `tools:` 字段

## 五、已知未做（如实标注）

| # | 项 | 说明 |
|---|---|---|
| 1 | **头像（待补，推荐 prompt 见 §六）** | `avatars/` 目前为空（仅有 `.gitkeep`），配置中指向的 `avatars/expert.png` **暂缺**。官方校验器对本项**只告警不报错**，故专家包仍然有效、可正常召唤 |
| 2 | **随包资产内容的标签** | 样板是契约形状的 Rubric（`additionalProperties: false`），**不能携带 `tags` 字段**，故 `--tag` 过滤对样板无效；详见 `skills/autograder-tools/assets/README.md` |
| 3 | **两种编排形态的实跑对照** | 规格已齐（W2 给出可校验判据），实跑需真实 LearnBuddy 会话 |

## 六、如何补头像（本环境缺图像生成工具）

**背景（如实记录）**：本回合尝试调用图像生成工具补头像时，环境返回
`Tool "ImageGen" is not available in the current environment or configuration` ——
即**工具在本环境不可用**，不是参数写错。故按官方头像规范的「生成失败处理」条款，
在此留下**可直接使用的推荐 prompt**。

### 补法（两选一）

**A. 用任意图像生成工具生成后放入**（推荐）

把下面这段 prompt 原样粘进去，生成 **1024×1024** 的图，缩到 **512×512** 存为 PNG/JPG，
放到本包 `avatars/expert.png`（单张 ≤ 500KB）：

```
Professional cartoon-style illustration avatar, a meticulous academic assessment specialist who reviews computer-science lab reports point by point, wearing a smart casual shirt with rolled-up sleeves, holding a rubric scoring sheet with checkboxes and a red pen, calm rigorous and evidence-driven expression, a semi-transparent rubric table with per-item score columns, highlighted verbatim quotation marks, a chained audit-trail link and score band ticks floating in the background. Bust shot, facing forward. Clean simple green-emerald toned background. High quality, professional, natural.
```

**这段 prompt 不是套模板，是按规范从 `agents/autograder-expert.md` 逐项提取的**：

| 组成 | 取值 | 依据 |
|---|---|---|
| 风格前缀 | `Professional cartoon-style illustration avatar,` | 规范固定项 |
| 角色身份 | 逐评分点核查计算机专业实验报告的评鉴专家 | Agent MD 的角色定义 |
| 外观特征 | 卷袖衬衫、手持带勾选框的评分表与红笔 | 「核心能力」：逐点核查与打分 |
| 表情气质 | 冷静、严谨、以证据为准 | 「注意事项」：直言不讳但建设性、不美化 |
| 背景元素 | 半透明量规表、逐字引号高亮、审计链、档位刻度 | 「核心能力」：证据回链、可复算、留痕 |
| 背景色调 | **green-emerald**（绿-祖母绿） | 头像规范中 `10-ProjectQuality` 的指定色调 |
| 质量后缀 | `Bust shot, facing forward. Clean simple … background. High quality, professional, natural.` | 规范固定项 |

**B. 不用插画头像**

直接放任意一张 512×512 的方形 PNG/JPG 到 `avatars/expert.png` 也行 ——
头像只影响展示，**不影响专家的能力与调用**。

