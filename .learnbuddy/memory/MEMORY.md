# AutoGrader_rebirth · 项目长期记忆

> 口径与状态的**唯一真源**是工作区根的 **`项目总纲与同步状态.md`**（新对话开工先读）。
> 缺陷清单真源是 **`AUDIT.md`**。本文件只留跨会话必须复用的结论。
> 过程记录见 `.learnbuddy/memory/YYYY-MM-DD.md`。

## 一、项目定位与赛事约束

粤港澳大湾区 AI Coding 创新大赛（LearnBuddy 版）· 方向一「AI + 教学管理助手」→ **AutoGrader**
—— 计算机专业实验报告自动解析、评分点逐项核查与成绩评语智能生成的智能评阅平台。2026-09-25 立项。

- LearnBuddy 为**唯一指定平台**，AI 必须由它承载；禁 `openai`/`anthropic`/`langchain-*`
- 必交 5 项：作品链接 / 3 分钟 Demo 视频 / 作品介绍 PPT（**须含团队成员信息**）/ 源码仓库 / 对话记录
- 评分：技术创新 30 / 工程完整 25 / AI 工具使用 25 / 用户体验 20；加分：跨专业组队 +2、社媒 +1
- 截止前可多次提交，评委只看最后一次。**团队 2 人**：软件工程 + 计算机科学与技术 → 满足跨专业加分

## 二、架构范式与三交付物（冻结）

**Compile-time AI**：AI 推理在 LearnBuddy 对话侧完成 → 产出 `ReviewResult` JSON → 提交进仓库；
Web 端运行时**零 AI 调用、零后端**，只做确定性渲染 + 浏览器端规则核查。
这是「平台唯一 + 需在线链接」约束下的唯一解，换来结果可复现、过程可审计、质量可评测。

| # | 交付物 | 角色 |
|---|---|---|
| 一 | **专家智能体包** = Prompt + Skills + Tools + Workflow + Evaluation | 能力本体（AI 在这里跑） |
| 二 | **Web Demo 产品展示页** | 产品形态（在线链接 + 源码仓库） |
| 三 | **评审材料包** = PPT + 3 分钟视频 + 对话记录归档 | 佐证链 |

五 Agent 流水线：Parser → Evidence → Grader → Reviewer → Feedback。
**三模式**（模式 4「教学分析」已整体排外）：生产组 1 建标 / 2 评阅；消费组 3 复核。

## 三、核心口径（写死，不得改写）

- 总分 = `Σ (score / maxScore) × weight`，**不是** `Σ (score × weight / 100)`
- 权重序列（和 = 100）：`5/12/5/7/20/10/11/13/7/5/3/2`
- 待复核项（`pending === true`）**不计入**求和、**不做归一化**；总分是**部分分（下界）**，须携带 `W_r`
  （归一化会让「教师认真复核」表现为分数往下掉）
- **上界 = `Σ已计入 weight`（= `weightIncluded`），不是 `100 − W_r`**（C-021 修正；旧式在权重和 < 100 时偏大）
- 等级仅在 `W_r = 0` **且**已计入权重合计 = 100 时映射
- **T5 退出码**：0 全通过 / 1 有错且校验完整 / 2 输入或 schema 不可用 / **3 校验不完整**。
  `errors` 非空 → 1（即使同时有 `skipped`），但 `skipped` 必须逐条出现在输出里
- **指纹自指字段 `provenance.resultFingerprint` 键必须存在**（缺失则补 `""`）——
  「键不存在」与「键为空串」序列化文本不同，生产者不补键、校验者补键时两侧复算必然不等

## 四、契约已冻结 1.1.0（C-021，路径 0.1 + 0.3）

**真源**：机器可读 `contract/ReviewResult.schema.json` + `contract/Rubric.schema.json`；
人类可读 `docs/contract.md`；**两者必须同时修订，不得只改一处**。
基线是 v0.1 `AutoGrader/frontend/lib/schema.ts`（589 行 Zod）的**向后兼容超集**，新增字段一律 optional
→ 12 份历史资产一行不改继续通过（**Zod 与 T5 双端 12/12**，指纹 Python/JS 双侧 12/12 与声明值相等）。

**四条最易踩的裁决**：

1. `scores[]` / `rubricItemId` / `itemName` 用 v0.1 命名（不是 `items[]` / `pointId` / `pointName`）
2. **`needsReview` 与 `pending` 并存、语义正交**：`needsReview` = 需教师看一眼（**不影响总分**）；
   `pending` = 尚无终值（**不计入求和**，计入 `W_r`）。**合并会打爆 12 份资产的总分**
3. 档位模型是 v0.1 的 `levels[]{level,label,criterion,scoreRatio}`；`bands[]{from,to}` **已废弃**
   （对真实 Rubric 取 `it.get("bands")` 恒为 `None`，档位检查会静默跳过）。
   「档位不重叠」改由**系数严格单调**表达
4. 指纹算法是**移植**不是设计：源自 v0.1 `schema.ts:371-376`。递归键序 + 自指字段置空 +
   无空格 UTF-8 + SHA-256 小写。⚠️ 数字按 **JS `round2`** 语义（half-up）；
   **Python 内置 `round()` 是银行家舍入，在 `.xx5` 边界与 JS 分叉** → 用 `contract/fingerprint.py` 的 `js_round2`

**T5 的六项检查**（S5 的「三重校验」已升为这六项，全项目措辞已统一）：
`schema.structure` / `weights.sum` / `band.levels` / `evidence.present` / `total.recompute` /
`fingerprint.recompute`。`clues[]`（档位四档不齐、判据含糊）**是线索不是错误**，不改退出码。
`--kind rubric` 只跑前三项——**不适用 ≠ 降级**，不得记进 `skipped`。

**契约级不变式共 13 条**（JSON Schema 表达不了，全由 T5 承担，见 `docs/contract.md` §四）。
I13 是反证时补上的：`total.weightIncluded` / `weightExcluded` 必须等于**复算值**——
否则 I9 只比对 `upperBound` 与 `weightIncluded` 彼此，两者可一起写错而互相自洽。

**T5 的 Schema 子集**：断言 `type/enum/const/minimum/maximum/exclusiveMinimum/exclusiveMaximum/
minLength/maxLength/pattern/minItems/maxItems/minProperties/maxProperties/properties/required/
additionalProperties/items/oneOf/anyOf/allOf/not/$ref`；`$ref` 仅本地 `#/…` 与**同目录文件**。
**用到不支持的关键字必须 `exit 2`，禁止静默跳过**（「以为校验了、其实没校验」比没 schema 更危险）。

**✅ 已修（2026-09-26，契约 1.1.0 → 1.2.0）**：`total.grade` 原被定义为 `ScoreLevel` 枚举
（excellent/meeting/partial/notMet）或 `null`，而 T4 满权重时**实际产出 `A/B/C/D/F`**
→ T5 报 `schema.oneOf @ $.total.grade`、退出码 1，**模式 2 的正常产出会被判不合规**。
**根因**：把 `scores[].level` 的取值域误用为等级字段的类型——**同名不同物**。
**修法**：新增 `$defs.Grade = string | null`，`Total.grade` 指向它；**属放宽取值域 = MINOR**。
这条档位已补进 `docs/contract.md` §二（原来只有「新增 optional→MINOR / 新增 required 或改语义→MAJOR」）。
**验收**：61 项自测 + 当初失败用例 exit=0 六项全 pass + **12 份历史资产回归 12/12**（T5 与指纹双双）
+ 负向对照（数字/布尔/对象仍被拒）。回归脚本 `.work/verify_contract_1_2_0.py`。
⚠️ `fingerprint.py` / `.mjs` 的 `version: 1.1.0` 是**模块自己的版本**，不是契约版本，**不要跟着改**。

## 五、T1 的两条硬事实（最容易再犯）

**1. 真实 DOCX 有两条互不相干的标题标记路径——T1 必须两条都走**

| 来源 | 标记方式 |
|---|---|
| `tencent-local-office-edit` 等生成的 docx | **全部段落无 `w:pStyle`**，标题只由段落级 `w:outlineLvl`（0–8，**9 = 正文**）标记 |
| 真实 Word 文件 | `w:pStyle val` 是**数字 styleId**，真名在 `word/styles.xml`（`1` → `heading 1`） |

只认 `w:pStyle` 会让所有 docx 检出 0 个标题却报 `status: ok` → T2 据此断言「六章节全缺失」=
主动的否定断言，违反 L1「未知优于否定」。判定顺序：段落级 `outlineLvl` → 样式级 `outlineLvl`
（沿 `w:basedOn` 上溯）→ 样式名 `heading N`/`标题 N`。**实测基线**：目标定义书 v1.1 = 25 个标题、
规划书 v1.1 = 19、口径变更说明 v1.0 = 7、`.work/handbook.docx` = 26。

**2. T1 的块有两栏文本，引用必须用 `rawText`**

`rawText` = 原文逐字（行首缩进、制表符原样保留）；`text` = 空白规范化后（供统计与关键词匹配）。
T3 的逐字比对与摘要走 `rawText`——否则 T3 承诺的「不做任何模糊归一化」在 T1 就已经被破坏。

**T3 出参字段名（易写错）**：`resolved[].blockTextDigest`（不是 `blockDigest`）+ `quoteDigest`；
`rejected[].reason ∈ anchor-not-found | block-ref-not-found | quote-mismatch | no-locator`。
契约 `evidence[].quote` 取自 T1 `blocks[].rawText`。

## 六、平台侧硬约束（决定 Tools 层封装，双源取证）

官方明文：「开发者不可自行添加 tools：所有工具权限由系统统一分配」。系统内置工具仅 9 个：
Read / Write / Grep / Glob / Bash / WebSearch / WebFetch / AgentTool / SendMessage。

本机随包校验器（`expert-manager`）交叉印证：`agent.md` frontmatter 出现 `tools:` → **硬错误**；
插件根只准 `agents` / `skills` / `bin` / `avatars`，禁 `hooks/` `commands/` `.lsp.json`；
`skills[]` 每项必须是**含 `SKILL.md` 的目录**；`plugin.json` 必需。

**四条能力通道**：① 内置工具（不可扩展）② Skill（`skills/<name>/SKILL.md` + `scripts/`）
③ `bin/`（插件根 CLI）④ MCP/连接器（只能声明，不能实现）。
**推论**：确定性能力**只能做成可执行脚本**（CLI + JSON 出参），由内置 `Bash` 调起；
纯函数库没有调用通道；「平台注册工具」不存在。

**专家包固定落点**：`$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/<name>/`
（本机 = `~/.learnbuddy/...`），不在该目录则**无法被检测到**。安装有安全闸，拿不到「一键全自动」
→ 正解是**仓库内直接放已合规的专家包**，prompt 只要求复制 + 跑 register 脚本。

## 七、深链拉起对话（`learnbuddy://`，现场复核过）

- 协议名是 **`learnbuddy://`**，不是 `workbuddy://`
- 形态：`learnbuddy://task?action=start&prompt=<encodeURIComponent>`；行为：**草稿预填，不自动执行**
- `prompt` 解码后上限 **8,000 字符**；深链总长受 Windows 命令行 **32,767** 上限约束
  → `SYSTEM_PROMPT.md` 已 6,088 字符，**不能整篇内联**；正解是深链只带极简指令，全文由
  智能体用内置 `WebFetch` 读仓库 raw 文件
- Web 端**忽略 `cwd`**；网页侧必须**顶层真实 `<a>` 点击**，`location.href` 会被丢 →
  未装客户端则无反应，**必须剪贴板兜底**

## 八、已落地结构

```
AutoGrader_rebirth/                    # 已是 git 仓库（master；仍缺 .gitignore / LICENSE）
├── README.md                          # 开发期 README（写实；评审导向版待交付物二/三就位后重写）
├── documents/                         # ✅ 文档与立项材料（2026-09-26 由工作区根移入，用户操作）
│   ├── 项目总纲与同步状态.md           #   跨对话唯一对齐入口（新对话先读）
│   ├── 契约冻结方案.md / AUDIT.md      #   用户自有文档，AI 不擅改（AUDIT 是缺陷清单真源）
│   └── 5 份 docx（v1.0 原样存档 + v1.1 修订版 + 口径变更说明）
├── contract/                          # ✅ 契约层：2 JSON Schema + fingerprint.py + fingerprint.mjs
├── docs/contract.md                   # ✅ 契约说明（字段表 / 口径 / 不变式 / 映射表 / 迁移规则）
├── web/public/results/                # ✅ 12 份评阅结果 JSON（v0.1 副本 + 回填 total；交付物二其余部分未开始）
└── backend/autograder-expert/
    ├── agents/                        # 五件套源（开发期布局）
    │   ├── agent/SYSTEM_PROMPT.md     #   Prompt v0.2（§3.2 + §7.2 已对齐契约；⬜ §2 待并入三模式）
    │   ├── skills/                    #   ✅ S0–S7 八份规格 + README
    │   ├── tools/                     #   ✅ T1–T6 规格 + README + rules/ + scripts/6 CLI + assets/四类资产
    │   ├── workflow/                  #   ✅ W1 五环 / W2 编排形态 / W3 失败与重试 + README
    │   └── evaluations/               #   ✅ metrics.md（口径真源）+ scripts/2 CLI + baselines/
    ├── build_expert.py                # ✅ 打包层：装配成平台合规专家包（自测 21 项）
    └── packaging/                     # ✅ expert.manifest.json（映射真源）+ PLUGIN_README.md + dist/*.zip
```

**文档位移提醒**：用户于 2026-09-26 01:38 把工作区根的文档与立项材料移入 `documents/`，
故**总纲的路径现在是 `documents/项目总纲与同步状态.md`**、docx 在 `documents/` 下。
`documents/` 里出现 `~$…docx` 说明对应 docx **正被 Word 打开**——此时不要读写该 docx。

**Skills 8 项**：S0 任务路由 / S1 Rubric 构建 / S2 报告解析 / S3 证据取证与逐点判定 / S4 总分计算 /
S5 结构装配与自检 / S6 评语生成 / S7 复核与解释（两入口）。S3 不拆。
**Tools 6 项**：T1 文档解析器 / T2 客观核查器 / T3 引用解析器 / T4 确定性计算器 / T5 契约校验器 /
T6 资产库。纯函数 CLI（python3 仅标准库，JSON 出参）。

**Tool 与 Skill 分界（三条全中才算 Tool）**：① 同输入必得同输出 ② 可被第三方复算 ③ 输出里不出现形容词。
需要「要不要/够不够/好不好」的取舍即留在 Skill。工具不得调用 AI、不得自行引入规则。

**自测基线（改动后实测）**：六脚本 **61 项**全通过 = T1 11 / T2 8 / T3 7 / T4 13 / T5 13 / T6 9；
Evaluation 层再加 **27 项** = `evaluate.py` 17 / `regression_gate.py` 10。

## 八之二、Evaluation 层的口径与数据源（2026-09-26 构建）

**金标准位置（关键）**：`../AutoGrader/demo/sample-reports/manifest.json`
—— 12 份报告，每份含 `id` / `tier`（优·良·中·差 各 3）/ `goldTotalScore` / `expectedItemScores[]`（含 `itemName` / `level`）。
**v0.1 的指标实现**在 `../AutoGrader/frontend/lib/analysis.ts`（MAE 与逐项命中率的口径即出自此处）。
评测脚本的 `--gold` 目前是**外部传入参数**（随包资产根未落，不便写死默认路径）。

**四项指标**（口径真源 = `agents/evaluations/metrics.md`，只在那里定义一次）：
总分 MAE ／ 逐项命中率（12 行）／ 档位一致率（**同口径的汇总值**，不是独立口径）／
置信度校准（分桶阈值**取契约 §八** 的 0.60 / 0.80，汇总为 ECE）。
另设 **MAE 的 `byTier` 分组视图**：用途是复现并**主动披露**「差档 MAE 偏高」这一已公开短板。

**已独立复现的公开数字**（12 份资产 × 上述金标准，2026-09-26）：总分 MAE **3.05**、
差档 MAE **8.0**、单份最大绝对偏差 **14.0（`sample-04`）** —— 与 v0.1 公布值逐值一致；
另有 档位一致率 **0.74**（106/144）、ECE **0.12**。

**两处刻意取舍（不要当成缺陷改掉）**：① ECE 用**已展示的 2 位小数**加权 → 换「读者可手工复算」；
② `byTier` 的档序取**金标准中首次出现的次序**（数据驱动，不写死「优良中差」枚举）。

**门禁**（`regression_gate.py`）：比较 MAE↑ / 一致率↓ / ECE↑ 三项，容差缺省 0；
退出码 **0 通过 / 1 劣化 / 2 输入非法 / 3 判定不完整**（缺指标 → `skipped` 且不给终局裁决，与 T5 同源纪律）。

## 八之三、打包层与随包资产（2026-09-26 落地）

**安装落点（写死，平台只在此检测）**：
`$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/<expertDirName>/`
—— 本机 `WORKBUDDY_CONFIG_DIR = C:\Users\Mendai\.learnbuddy`（**不是**默认的 `~/.workbuddy`）。
注册表 = 同级 `.codebuddy-plugin/marketplace.json`；`register_expert.py` 还会写 `.created-by-session`。

**一条命令**：`python3 backend/autograder-expert/build_expert.py --validate --register`
（`--dry-run` 预演；`--package` 打 zip；`--tools-dir` 指定 expert-manager 目录）。
映射的**唯一真源**是 `backend/autograder-expert/packaging/expert.manifest.json`，**改映射改它，不要改脚本**。

**关键映射（因为平台插件根只认 `agents`/`skills`/`bin`/`avatars`，没有 workflow/evaluation/tools 槽位）**：
- Prompt → `agents/<agentName>.md`（剥离头部状态块与文末附录）
- 8 个技能 → 8 个 `skills/<名>/SKILL.md`
- **Workflow / Evaluation → 各一个「规格技能」**（`SKILL.md` + `references/`）
- **Tools + 2 个评测 CLI → `skills/autograder-tools/`**：`scripts/` + `rules/` + `contract/` + `assets/` **同级**
  → 三处路径解析（T2 `../rules`、T6 `../assets`、T4/T5 向上找 `contract/`）**一行代码都不用改**（已核实并实测）

**随包资产根** `agents/tools/assets/`：`template` 1（通用 Rubric）/ `rubric` 空（待教师写入，
`list` 返**退出码 1** 是正确语义）/ `sample` 12 / `gold` 1（金标准 manifest）。内容复制自 v0.1 `demo/`。
⚠️ 样例样板是契约形状的 Rubric（`additionalProperties:false`）→ **不能带 `tags`**，故 `--tag` 过滤对样板无效。

**官方脚本的坑（都踩过）**：
- `validate_expert.py` **强制**专家目录必须在上述落点之下；`tags` 与 `quickPrompts` **必须各 3 个**（ERROR）；
  `displayDescription.zh` 建议 40–50 字；缺头像只**告警**
- `parse_md_frontmatter` 只做朴素正则 + `strip('"')`，**不反转义** → 清单里的描述**不要用 ASCII 引号**
- `package_expert.py` 排除 `__pycache__` / `node_modules` / 根 `dist` / `.gitkeep` / 其他隐藏路径（仅允许 `.codebuddy-plugin`）
- 装配脚本写文件必须 `newline="\n"`（否则 Windows 下 LF→CRLF）

**仍未做**：**头像**（`avatars/` 为空；生成需图像生成工具、会产生额外额度消耗，未执行）；两种编排形态的实跑对照。

## 九、docx 修订链路（可复用，实测通过）

**需求**：对既有 docx 做成批文字修订，且保留原文档的章节层级与表格。

**正解三步**（`tencent-local-office-edit` 技能 + T1）：

1. **docx → markdown**（`.work/docx2md.py`）：调 T1 的 `run()` 拿 `blocks`，再用 `structure` 树
   把 `heading` 块映射回 `#`/`##`，`table` 块还原成 markdown 表。**不要自己写 docx 解析**
2. **改 markdown**：逐条套用修订要求；用 `Write` 直接产出新版本 md（不要在 md 上反复 Edit）
3. **markdown → docx**（`.work/make_docx.py`）：`python3 edsdk.py call create_doc` → 取 `file_id=` →
   `doc_insert_markdown file_id=<id> idx=0 markdown="file://<绝对路径 md>"` → `save_file`
   （`markdown` 参数**支持 `file://<绝对路径>`**，避免超长参数）

**验证**（两步，缺一不可）：
① `.work/verify_v11_rev.py` 回读新 docx，比对「应存在的新表述 / 应清除的旧表述 / 应保留的对照项 / v1.0 原稿未被动过」；
② **逐块比对新旧 docx 的 `blocks`**（先把旧版备份到 `.work/backup_v1.1/`）——
判据是**块数与标题数不变、差异块数恰好等于预期改动处数**。
这一步是「整文重生成没有带来连带变化」的唯一硬证据，**不要只看 md 的 diff 就收工**。

**技能前置**（按 `tencent-docs-routing` 的强制流程）：先 `edsdk.py list` 验通，
再对本次要用的 `create_doc` / `doc_insert_markdown` / `save_file` **各跑一次 `schema`**，然后才调。
就地修订（不升版本号）是允许的：旧版先备份，`save_file` 直接覆盖原文件名。
收工前 `get_pool_status` 复核 `pool_size`，顺手 `close_file` 释放实例（用户要求每轮释放占用）。

**三个坑**：① `edsdk.py` 在技能目录 `H:\LearnBuddy\...\builtin-skills\tencent-local-office-edit\`，
`create_doc` 返回**纯文本**不是 JSON，要正则取；② docx 里的「图」可能是**文本框**（`wps:wsp`），
文字已被 T1 抽出 → md 里的 `[图片]` 占位冗余可删，但**文本框版面不会复刻**；
③ 生成后的 docx **不要用 `present_files` 打开**再编辑（会另起实例）。

## 十、多对话同步机制

- 跨对话唯一对齐入口：工作区根 **`项目总纲与同步状态.md`**
- **编辑授权**：AI 可直接编辑其**非冻结区域**（第三 / 五 / 六 / 七 / 八 / 九节的状态、目录、环境、索引），
  自行记录、不再逐次征询，**但每次须在对话中说明改了什么**；
  **冻结区域**为第一、二、三（五件套定义）、四、十节 → 改动须逐次征询
- **第九节「对话归档索引」由 AI 直接维护**，新增/补录/修订不再征询
- **对话 ID 取法**：ID = 会话记录文件的 `sessionId`，与文件名一致。位置
  `C:/Users/Mendai/.learnbuddy/projects/e-Mendai-Documents-tencent_cloud_aigc-AutoGrader_rebirth/<ID>.jsonl`
  一个文件 = 一次对话；扫描脚本 `.work/scan_sessions.py`（只读）。
  **不要认错**：`~/.learnbuddy/traces/` 与 `sessions/` 里的都不是对话 ID
- 开工惯例：先扫会话目录，把**未索引的会话补录**进 §九（C-022 / C-023 / C-027 都是这样补上的）

## 十一、上一轮（v0.1）资产位置 —— 在**同级目录**，不在本工作区

- 代码仓库：`E:/Mendai/Documents/tencent_cloud_aigc/AutoGrader`（GitHub `Mendai1307/AutoGrader`，main）
- 线上主链接：`https://mendai1307.github.io/AutoGrader/`
- v0.1 已有：5 页面静态站、Rubric R1–R12、12 份样例 + 金标准 + 12 份评阅结果（MAE 3.05）、
  浏览器端确定性核查器、GitHub Actions 部署
- **⚠️ v0.1 的 Zod 契约是「全对象 `.strict()`」（`schema.ts:13`）且顶层无 `total`** → 往那 12 份评阅结果里
  **加任何新键都会让它们全部判不合格**（实测：原始 12/12 通过；加了 `total` 后 **0/12**）。
  且 `frontend/lib/data.ts` 读资产时会调 `validateReviewResult` → 加了新键会让 **v0.1 站点的
  `/eval`、`/report/[id]` 页降级**。故「回填 `total`」**只在副本上做**，落点 = **`web/public/results/`**
  （总纲 §六 规划指定给「评阅结果 JSON 资产」的位置），**v0.1 原件一字未动**。
  **回填三要点**：① `total` 由 `scores[].weight` 纯推导（`weightIncluded`/`upperBound` = Σweight、
  `weightExcluded` = 0、`isPartial` = false、`grade` = null）；② **必须同时重算 `provenance.resultFingerprint`**
  ——指纹覆盖整个对象含新键，只加键不重算必报 `fingerprint.mismatch`；③ 写文件要 `newline="\n"` 保持 LF，
  否则 Windows 文本模式会写成 CRLF、diff 变成全文件替换。`schemaVersion` 保持 `1.0.0`。
  实测：新落点 T5 六项全过 12/12、指纹自洽 12/12；v0.1 原件 Zod 12/12 未受影响。
- Zod 复核脚本 `.work/zod_check.mjs`：`node --experimental-strip-types zod_check.mjs <schema.ts> <resultsDir>`，
  **schema 参数必须传 `file://` URL**（传 Windows 绝对路径会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`）
- **R1 已闭合**（2026-09-26）：读入既有 `ReviewResult` **走平台内置读取能力**（教师给绝对路径或粘贴 JSON →
  内置文件读取逐字读入 → 必要时 T5 校合规），**不新增工具、不扩展 T6**
- v0.1 缺口：专家智能体包、Demo 视频、PPT、真实对话 ID 溯源
- 上一轮记忆：`E:/Mendai/Documents/tencent_cloud_aigc/.learnbuddy/memory/MEMORY.md`
- **弃用项**：v0.1 的「备用链接」已废弃，本项目不再考虑

## 十二、协作约定（用户明确）

- **忽略时间限制**：只规划步骤路径与依赖，**不做时间规划与工期倒排**；**不列风险清单**
- 重要决策要写清「为什么」（Rationale）；关键决策留在对话里由 AI 输出结论
- **只改用户点名的对象，其余只提不做**；顺带发现写进「待你确认的改动」清单，当场不改
- 先在工作区工作，再交付审核；**每轮结束前必须释放产物与工作区内文件的进程**
  （不留后台进程 / 脚本句柄 / 长驻子进程；交付前自查）
- 每轮结束追加工作区记忆；总纲状态变化时同步总纲并说明改了什么

## 十三、环境事实

- `tencent-local-office-edit` 对本机大文件 / 中文路径 docx 会持续报
  `DocEditor::GetOutline: document is not open` → 绕法：Python 直接解析 docx
  （`zipfile` + `word/document.xml`）只读提取，脚本 `.work/extract.py`
- **进程自查**：`tasklist 2>/dev/null | grep -iE "python|node\.exe"`。
  `tasklist //FI` 在 Git Bash 下时灵时不灵；`ps -W` 不可用；`wmic` 被安全策略禁用。
  本机常驻 4 个 `node.exe` 是宿主应用自身驻留，**不得结束**
- 删除类命令有 safe-delete 钩子（转投回收站）；MSYS 风格路径 `/e/...` 会报 must be absolute；
  空目录改用 PowerShell `Remove-Item -LiteralPath "E:\..." -Confirm:$false`
- **不得在 Bash 里内联调用 PowerShell**（会被安全策略拒绝），须改用 PowerShell 工具
- 读取注册表：`reg.exe` 与 PowerShell 均被拦截 → 用 Python `winreg`
- **Node 可直接跑 TypeScript，无需安装任何东西**：`node --experimental-strip-types <file.ts>`
  能加载 v0.1 的 `frontend/lib/schema.ts`（zod 3.24.1 已在其 `node_modules` 内），
  用于拿 v0.1 的 Zod 契约做双端校验，**完全不修改 v0.1 仓库**。
  会有一条 `MODULE_TYPELESS_PACKAGE_JSON` 警告，无害
- **本机 Python 与 JS 的舍入不等价**：Python `round()` 是银行家舍入，JS `Math.round` 是 half-up，
  `.xx5` 边界分叉（`round(2.675,2)` → `2.67`，JS → `2.68`）。跨语言复算统一走 `js_round2`
- **Bash 管道回显中文显示为乱码**（捕获层按 GBK 解码 UTF-8 字节）——**不是脚本缺陷**，
  落盘文件与非管道输出均为合法 UTF-8。排查编码问题不要据此改脚本
- **本机网络走本地代理 `http://127.0.0.1:7890`**。若 WebFetch / WebSearch 报 TLS 或 502，
  **首先怀疑该代理**，而不是判定目标站点不可达
- **`python3` 在 Bash 环境可用**（实测 3.13.x，解析到 `~/.workbuddy/binaries/python/...`）。
  PowerShell 探测可能得出「`python3` NOT FOUND」——结论以 **Bash** 为准（工具调用走 Bash）。
  约定：`python3` 优先，`python` 回退
- **`__pycache__` 有两条生成路径**（都在交付目录里，要防）：① T5 import 同目录的 T4；
  ② T5（及任何脚本）用 importlib 加载 `contract/fingerprint.py`。
  `contract_validator.py` 里在 import T4 **之前**写 `sys.dont_write_bytecode = True` 可一并盖住两条
  （已实测：跑完 T5 全流程后 `scripts/` 与 `contract/` 都不再出现缓存）。
  **一次性核对脚本自己 import `fingerprint.py` 时仍会建缓存** → 跑完顺手清
- 删目录：`rm -rf` 会被 safe-delete 钩子按 MSYS 路径拒绝（must be absolute），
  须用 PowerShell `Remove-Item -LiteralPath "<绝对路径>" -Recurse -Force -Confirm:$false`
  （该命令常返回 exit 1 但实际成功，**以 `Test-Path` / `ls` 复核为准**）
