# AutoGrader_rebirth · 项目长期记忆

> 完整过程记录见 `.learnbuddy/memory/2026-09-25.md`；口径与状态的唯一真源是工作区根的
> **`项目总纲与同步状态.md`**。本文件只留跨会话必须复用的结论。

## 一、项目定位与赛事约束

粤港澳大湾区 AI Coding 创新大赛（LearnBuddy 版）· 方向一「AI + 教学管理助手」→ **AutoGrader**
—— 计算机专业实验报告自动解析、评分点逐项核查与成绩评语智能生成的智能评阅平台。2026-09-25 立项。

- LearnBuddy 为**唯一指定平台**，AI 必须由它承载；禁 `openai`/`anthropic`/`langchain-*`
- 必交 5 项：作品链接 / 3 分钟 Demo 视频 / 作品介绍 PPT（**须含团队成员信息**）/ 源码仓库 / LearnBuddy 对话记录
- 评分：技术创新 30 / 工程完整 25 / AI 工具使用 25 / 用户体验 20；加分：跨专业组队 +2、社媒传播 +1
- 截止前可多次提交，评委只看最后一次
- **团队 2 人**：软件工程 + 计算机科学与技术 → 满足跨专业加分

## 二、架构范式与三交付物（已冻结）

**Compile-time AI**：AI 推理在 LearnBuddy 对话侧完成 → 产出 `ReviewResult` JSON → 提交进仓库；
Web 端运行时**零 AI 调用、零后端**，只做确定性渲染 + 浏览器端规则核查。
这是"平台唯一 + 需在线链接"约束下的唯一解，换来结果可复现、过程可审计、质量可评测。

| # | 交付物 | 角色 |
|---|---|---|
| 一 | **专家智能体包** = Prompt + Skills + Tools + Workflow + Evaluation | 能力本体（AI 在这里跑） |
| 二 | **Web Demo 产品展示页** | 产品形态（在线链接 + 源码仓库） |
| 三 | **评审材料包** = PPT + 3 分钟视频 + 对话记录归档 | 佐证链 |

耦合枢纽：Zod 定义的 `ReviewResult` 契约（三部分共用）。五 Agent 流水线：Parser → Evidence → Grader → Reviewer → Feedback。

## 三、核心口径（写死，不得改写）

- 总分 = `Σ (score / maxScore) × weight`，**不是** `Σ (score × weight / 100)`
- 权重序列（和 = 100）：`5/12/5/7/20/10/11/13/7/5/3/2`
- 待复核项**不计入**总分求和、**不做归一化**；总分是**部分分（下界）**，须携带 `W_r`
  （理由：归一化会让"教师认真复核"表现为分数往下掉）
- **上界 = `Σ已计入 weight`（= `weightIncluded`），不是 `100 − W_r`**（2026-09-25 冻结时修正）。
  旧式只在权重和恰为 100 时等价，权重和 < 100 时给出偏大上界
- 等级仅在 `W_r = 0` **且**已计入权重合计 = 100 时映射

## 三之二、契约已冻结 1.1.0（路径 0.1 + 0.3 闭合，2026-09-25）

**真源**：机器可读 `contract/ReviewResult.schema.json` + `contract/Rubric.schema.json`；
人类可读 `docs/contract.md`；两者必须同时修订，不得只改一处。

**基线路线**：以 v0.1 `AutoGrader/frontend/lib/schema.ts`（589 行 Zod）为基线的**向后兼容超集**，
**新增字段一律 optional** → 12 份历史资产一行不改继续通过。

**四条最易踩的裁决**（都写死了）：

1. **`scores[]` / `rubricItemId` / `itemName`** 采用 v0.1 命名（不是 `items[]` / `pointId` / `pointName`）
2. **`needsReview` 与 `pending` 并存、语义正交**：`needsReview` = 需要教师看一眼（**不影响总分**）；
   `pending` = 尚无终值（**不计入求和**，计入 `W_r`）。**合并会打爆 12 份资产的总分**（30 项
   `needsReview: true` 会被误当 pending），前端 `verifyTotalScore` 全数失败
3. **档位模型是 v0.1 的 `levels[]{level,label,criterion,scoreRatio}`**，
   **`bands[]{from,to}` 已废弃**——后者对真实 Rubric 取 `it.get("bands")` 恒为 `None`，档位检查静默跳过。
   「档位不重叠」改由**系数严格单调**（excellent > meeting > partial > notMet）表达
4. **指纹算法是「移植」不是「设计」**：源自 v0.1 `schema.ts:371-376` docstring。
   递归键序 + `provenance.resultFingerprint` 置空 + 无空格 UTF-8 + SHA-256 小写。
   ⚠️ **数字必须按 JS `round2` 语义**（`Math.round((v+Number.EPSILON)*100)/100`，half-up）；
   **Python 内置 `round()` 是银行家舍入，在 `.xx5` 边界与 JS 分叉** → 用
   `contract/fingerprint.py` 的 `js_round2`。JS 侧对照见 `contract/fingerprint.mjs`

**验收实测（全绿）**：12 份历史资产同时通过 **Zod（v0.1 前端契约）** 与 **T5（工具链）** 双重校验，
12/12 且 `skipped` 为空（T5 不再降级）；指纹 **Python 与 JS 双侧 12/12 与声明值相等**。

**T5 的六项检查**（S5 的「三重校验」已改为这六项）：`schema.structure` / `weights.sum` /
`band.levels` / `evidence.present` / `total.recompute` / `fingerprint.recompute`。
`clues[]`（档位四档不齐、判据用词含糊）**是线索不是错误，不改退出码**。
`--kind rubric` 只跑前三项——**不适用 ≠ 降级**，不得记进 `skipped`。

**契约级不变式共 13 条**（JSON Schema 表达不了，全由 T5 承担，见 `docs/contract.md` 第四节）。
其中 **I13 是本轮在反向验证中补上的**：`total.weightIncluded` / `total.weightExcluded` 必须等于
**复算值**——否则 I9 只比对 `upperBound` 与 `weightIncluded` 彼此，两者可以一起写错而互相自洽，
「部分分必须携带 `W_r`」就落不了地。

**T5 的 Schema 子集**：断言 `type/enum/const/minimum/maximum/exclusiveMinimum/exclusiveMaximum/
minLength/maxLength/pattern/minItems/maxItems/minProperties/maxProperties/properties/required/
additionalProperties/items/oneOf/anyOf/allOf/not/$ref`；`$ref` 仅本地 `#/…` 与**同目录文件**。
**用到不支持的关键字必须 `exit 2`，禁止静默跳过**（「以为自己校验了、其实没校验」比没 schema 更危险）。

**冻结后仍未闭合**：**R1**（读入既有 `ReviewResult` 的通道，S7 模式 3 的前置）、
`agents/workflow/` 与 `agents/evaluations/` 内容、专家包打包层、随包资产根。

## 三之三、AUDIT.md 正确性整轮（2026-09-25）

**`AUDIT.md`（工作区根，33 条）是本项目缺陷登记与修复依据的唯一清单**，新增缺陷沿用它 §9 的模板。
它比审查报告更细，且**逐条给实测输出 + 根因行号 + 修法**。

### 最容易再犯的两条（务必记住）

**1. 真实 DOCX 有两条互不相干的标题标记路径——T1 必须两条都走**

| 来源 | 标记方式 |
|---|---|
| `tencent-local-office-edit` 等生成的 docx | **全部段落无 `w:pStyle`**，标题只由段落级 `w:outlineLvl`（0–8，**9 = 正文，不算标题**）标记 |
| 真实 Word 文件 | `w:pStyle val` 是**数字 styleId**（`1`/`2`），真名在 `word/styles.xml`（`1` → `heading 1`） |

只认 `w:pStyle` 会让**所有 docx 检出 0 个标题却报 `status: ok`** → T2 据此断言
「六个章节全缺失」= 主动的否定断言，违反 L1「未知优于否定」。**实测基线**（2026-09-25）：
`项目目标定义书` 26 个标题、`步骤路径规划书` 17 个、`handbook.docx` 26 个（另有 2 个无文字的空标题段落）。
判定顺序：段落级 `outlineLvl` → 样式级 `outlineLvl`（沿 `w:basedOn` 上溯）→ 样式名 `heading N`/`标题 N`。

**2. T1 的块有两栏文本，引用必须用 `rawText`**

`rawText` = **原文逐字**（行首缩进、制表符原样保留）；`text` = 空白规范化后（供统计与关键词匹配）。
T3 的逐字比对与摘要走 `rawText`——否则 T3 承诺的「不做任何模糊归一化」在 T1 就已经被破坏。

### 本轮已闭合

P0-1（T1 标题识别 + T2 不再断言缺失）、P0-2/P0-3（随契约冻结已解）、P1-7（六脚本入参形状防御统一；
**T3 的静默放行——证据忠实度唯一硬闸门——已堵死**）、P1-9（T4 rank 缺 `confidence` 不再默认 1.0）、
P1-13（T2 自行复算并与 `summary` 交叉核对，不一致即 exit 2）、P1-15（S3 补 T3 / S4 改 T4 / S7 改 T4，
Skills 统一用 T1–T6 编号）、P1-16、P2-17/18/19/22/23、P3-28/29/30/31/32/33。

### 仍未做（下一步）

**Workflow 层 + Evaluation 层 + 打包层**（2026-09-25 用户裁决：**另开对话构建**）、
随包资产根 `agents/tools/assets/` 与四类资产内容、三模式路由（S0 + SYSTEM_PROMPT §2）与 **R1**、
交付物二 / 三、**git 仓库（由用户自行构建）**、两份 docx 的改版（**裁决清单已交，等用户裁决**）。

## 三之四、三条硬口径（2026-09-25 定，后续不得改回）

**1. 模式 4 已整体排外**。设计面**不得再出现**「模式 4 / 教学分析 / CohortReport / T7 聚合器 / 四模式」，
一律用**三模式**：生产组 = 1 建标 / 2 评阅；消费组 = 3 复核。
排除决策的**唯一留痕**在总纲第十节（冻结区，未经批准不改）。
`taskType` 契约取值只有 `rubric-build` / `review` / `replay`。

**2. T5 退出码：`skipped` 非空一律返 3**（P1-11 最终裁决）。
依据 L1「未知优于否定」——**校验没跑全时，错误清单本身也不可靠**（既可能误报，也没覆盖未跑的检查项），
所以不给「看似终局的裁决」而给「本次校验不完整」。
为不丢信息，输出里始终带 `errors[]` / `skipped[]`，并额外给两个机器可读字段：
`exitReason` ∈ `ok` | `errors` | `degraded` | `errors-degraded`，`degraded` 布尔。
（0 全通过 · 1 有错且校验完整 · 2 输入/schema 不可用 · 3 校验不完整）

**3. 指纹算法的自指字段 `provenance.resultFingerprint` 键必须存在**（缺失则补 `""`）。
「键不存在」与「键为空串」会序列化成**不同文本**——生产者不补键、校验者补键时两侧复算必然不等。
这是跨实现复算不一致的经典来源，Python 与 JS 两侧实现都已写死并各自带自测
`selfReferenceKeyAlwaysPresent`。**12 份历史资产不受影响**（它们本来就有该键）。

**T4 的两处补充口径**：`total` 输出**契约一致的 2 位小数**（JS 语义 `round2`），
档位线**一律与报告值比较**，未取整原值另存 `totalRaw`（防「6dp→2dp 进位改档」）；
`--grade-bands` 的档位名与 `DEFAULT_BANDS` 同序列（**跳过 E**：`A/B/C/D/F…`），
非数字 / 越界 / 重复 / 超量一律 `BadInput`（→ 退出码 1）。
T4 的 `round2` 是**就地实现**，自测有一项 `round2MatchesContract` 与 `contract/fingerprint.py` 的
`js_round2` 逐值对齐，防两侧分叉。

## 三之五、docx 修订链路（可复用，2026-09-25 实测通过）

**需求**：对既有 docx 做**成批文字修订**，且要保留原文档的章节层级与表格。

**正解三步**（`tencent-local-office-edit` 技能 + T1）：

1. **docx → markdown**（脚本 `.work/docx2md.py`）：调用 T1 的 `run()` 拿 `blocks`，
   再用 `structure` 树把 `heading` 块映射回 `#`/`##` 层级，`table` 块还原成 markdown 表。
   **不要自己写 docx 解析**——T1 已处理 `outlineLvl` / `styles.xml` 两套标题标记，比手写可靠。
2. **改 markdown**：逐条套用修订要求；用 `Write` 直接产出新版本 md（不要在原 md 上反复 Edit）。
3. **markdown → docx**（脚本 `.work/make_docx.py`）：
   `python3 edsdk.py call create_doc` → 取返回里的 `file_id=` →
   `doc_insert_markdown file_id=<id> idx=0 markdown="file://<绝对路径 md>"` →
   `save_file file_id=<id> file_path=<目标 docx>`。
   `markdown` 参数**支持 `file://<绝对路径>`**，避免把整篇长文当调用字符串。

**验证**（脚本 `.work/verify_v11.py`）：新 docx 用 T1 回读，比对「应存在的新表述 / 应清除的旧表述 /
v1.0 对照组仍在」，再对两版 md 做**逐段差异**（`.work` 里的一次性脚本）确认改动面与预期一致。

**三个坑**：

- `edsdk.py` 在技能目录 `H:\LearnBuddy\...\builtin-skills\tencent-local-office-edit\`，用 `python3` 调；
  `create_doc` 返回的是**纯文本**（`file_id=xxx, file_path=xxx`），不是 JSON，要正则取。
- **docx 里的「图」可能是文本框（`wps:wsp` + `w:txbxContent`），不是位图**（`a:blip` 为假时即为此类）。
  此时它的文字已被 T1 作为正文抽出 → md 里的 `[图片]` 占位是**冗余**的，删掉即可；
  但**文本框的版面框线不会复刻**，需在 Word 里手工套文本框才还原。
- 生成后的 docx **不要用 `present_files` 去「打开」**再编辑——会另起实例；
  该技能约定「已用 `present_files` 打开的文档不要再 `open_file`」。

## 四、平台侧硬约束（决定 Tools 层封装，2026-09-25 双源取证）

官方明文：「开发者不可自行添加 tools：所有工具权限由系统统一分配」。系统内置工具仅 9 个：
Read / Write / Grep / Glob / Bash / WebSearch / WebFetch / AgentTool / SendMessage。

本机随包校验器（`expert-manager`）交叉印证：`agent.md` frontmatter 出现 `tools:` → **硬错误**；
插件根只准 `agents` / `skills` / `bin` / `avatars`，禁 `hooks/` `commands/` `.lsp.json`；
`skills[]` 每项必须是**含 `SKILL.md` 的目录**；`plugin.json` 必需。

**四条能力通道**：① 内置工具（不可扩展）② Skill（`skills/<name>/SKILL.md` + `scripts/`）
③ `bin/`（插件根 CLI）④ MCP/连接器（只能声明，不能实现）。

**推论**：确定性能力**只能做成可执行脚本**（CLI + JSON 出参），由内置 `Bash` 调起；
纯函数库没有调用通道；"平台注册工具"不存在。

**专家包固定落点**：`$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/<name>/`
（本机 = `~/.learnbuddy/...`），不在该目录则**无法被检测到**。安装有安全闸，
拿不到"一键全自动"→ 正解是**仓库内直接放已合规的专家包**，prompt 只要求复制 + 跑 register 脚本。

## 五、深链拉起对话（`learnbuddy://`，现场复核过）

- 协议名是 **`learnbuddy://`**，不是 `workbuddy://`（本机未注册后者）
- 形态：`learnbuddy://task?action=start&prompt=<encodeURIComponent>`
- 行为：**草稿预填，不自动执行**（全包无 autoSend）
- `prompt` 解码后上限 **8,000 字符**；深链总长受 Windows 命令行 **32,767** 上限约束
  → `SYSTEM_PROMPT.md` 已 6,088 字符，**不能整篇内联**；正解是深链只带极简指令，全文由
  智能体用内置 `WebFetch` 读仓库 raw 文件
- Web 端**忽略 `cwd`** → 从网页拉起无法指定工作目录，报告文件仍须用户手动拖入
- 网页侧必须**顶层真实 `<a>` 点击**，`location.href` 会被丢；未装客户端则无反应 → 必须剪贴板兜底

## 六、已落地结构（2026-09-25）

```
AutoGrader_rebirth/
├── 项目总纲与同步状态.md      # 跨对话唯一对齐入口
├── 契约冻结方案.md            # 契约冻结的决策方案（D1–D5 已裁决，可作评审材料）
├── contract/                  # ✅ 契约层：2 份 JSON Schema + fingerprint.py + fingerprint.mjs
├── docs/contract.md           # ✅ 契约说明（字段表 / 口径 / 不变式 / 映射表 / 迁移规则）
└── backend/autograder-expert/agents/
    ├── agent/SYSTEM_PROMPT.md # Prompt v0.2（§7.2 已对齐契约；§2 四模式待补）
    ├── skills/                # ✅ 8 个规格 S0–S7 + README 索引（扁平 .md，待目录化）
    ├── tools/                 # ✅ 6 个规格 T1–T6 + README + rules/ + scripts/ 6 个 CLI
    │                          #    T4/T5 已按契约 1.1.0 改造；assets/ 资产根未落
    ├── workflow/              # ⬜ 目录已建，内容未落
    └── evaluations/           # ⬜ 空目录
```

**Skills 8 项**：S0 任务路由 / S1 Rubric 构建 / S2 报告解析 / S3 证据取证与逐点判定 /
S4 总分计算 / S5 结构装配与自检 / S6 评语生成 / S7 复核与解释（两入口）。S3 不拆。
四模式：1 建标 / 2 评阅 / 3 复核（只读回放）/ 4 教学分析（**本期不做**）。

**Tools 6 项**：T1 文档解析器 / T2 客观核查器 / T3 引用解析器 / T4 确定性计算器 /
T5 契约校验器 / T6 资产库。纯函数 CLI（python3 仅标准库，JSON 出参）。
退出码：`0` 正常 / `1` 需注意 / `2` 输入非法 / `3` 降级（CI 视为不通过）。
规则集＝内置默认层（只读）+ 教师层（按 `ruleId` 覆盖/追加）。

**Tool 与 Skill 分界（三条全中才算 Tool）**：① 同输入必得同输出 ② 可被第三方复算
③ 输出里不出现形容词。需要"要不要/够不够/好不好"的取舍即留在 Skill。工具不得调用 AI、
不得自行引入规则。

## 七、多对话同步机制

- 跨对话唯一对齐入口：工作区根 **`项目总纲与同步状态.md`**（新对话开工先读）
- **编辑授权**：AI 可直接编辑该文件的**非冻结区域**（第三 / 五 / 六 / 七 / 八 / 九节的状态性与事实性
  内容）；**冻结区域**为第一、二、三、四、十节 → 改动须逐次征询。每次更新须在对话中说明改了什么
- **第九节「对话归档索引」由 AI 直接维护**，新增/补录/修订不再逐次征询
- **对话 ID 取法**：ID = 会话记录文件的 `sessionId` 字段，与文件名一致。位置
  `C:/Users/Mendai/.learnbuddy/projects/e-Mendai-Documents-tencent_cloud_aigc-AutoGrader_rebirth/<ID>.jsonl`
  一个文件 = 一次对话，同会话多轮共用一个 ID。扫描脚本 `.work/scan_sessions.py`（只读）
- **不要认错**：`~/.learnbuddy/traces/` 与 `~/.learnbuddy/sessions/` 里的都不是对话 ID

## 八、上一轮（v0.1）资产位置 —— 在**同级目录**，不在本工作区

- 代码仓库：`E:/Mendai/Documents/tencent_cloud_aigc/AutoGrader`（GitHub `Mendai1307/AutoGrader`，main）
- 线上主链接：`https://mendai1307.github.io/AutoGrader/`
- v0.1 已有：5 页面静态站、Rubric R1–R12、12 份样例 + 金标准 + 12 份评阅结果（MAE 3.05）、
  浏览器端确定性核查器、GitHub Actions 部署
- v0.1 缺口：专家智能体包、Demo 视频、PPT、真实对话 ID 溯源
- 上一轮记忆：`E:/Mendai/Documents/tencent_cloud_aigc/.learnbuddy/memory/MEMORY.md`
- **弃用项**：v0.1 的「备用链接」已废弃，本项目不再考虑

## 九、协作约定（用户明确）

- **忽略时间限制**：只规划步骤路径与依赖，**不做时间规划与工期倒排**
- **不列风险清单**：不输出风险登记表
- 重要决策要写清"为什么"（Rationale），不能只写"是什么"；关键决策留在对话里由 AI 输出结论
- 每轮结束追加工作区记忆；**先在工作区工作，再交付审核**；只改用户点名的对象，其余只提不做
- **每轮结束前必须释放产物与工作区内文件的进程**：不留后台进程、不留脚本句柄、不留长驻子进程；
  交付前自查一遍。**这条优先于"顺手再跑一下"这类便利性动作**

## 十、环境事实

- `tencent-local-office-edit` 对大文件 / 中文路径 docx 会持续报 `DocEditor::GetOutline: document is not open`
  → 绕法：Python 直接解析 docx（`zipfile` + `word/document.xml`）只读提取，脚本 `.work/extract.py`
- `create_doc` → `doc_insert_markdown`（`markdown` 可传 `file://<绝对路径>` 避免超长参数）→ `save_file` 链路可用
- 进程自查：`tasklist 2>/dev/null | grep -iE "python|node\.exe"`。
  `tasklist //FI` 在 Git Bash 下时灵时不灵；`ps -W` 不可用；`wmic` 被安全策略禁用。
  本机常驻 4 个 `node.exe` 是宿主应用自身驻留，**不得结束**
- 删除类命令有 safe-delete 钩子（转投回收站）；MSYS 风格路径 `/e/...` 会报 must be absolute；
  空目录改用 PowerShell `Remove-Item -LiteralPath "E:\..." -Confirm:$false`
- **不得在 Bash 里内联调用 PowerShell**（会被安全策略拒绝），须改用 PowerShell 工具
- 读取注册表：`reg.exe` 与 PowerShell 均被拦截 → 用 Python `winreg`（脚本 `.work/regcheck.py`）
- **Node 可直接跑 TypeScript，无需安装任何东西**：`node --experimental-strip-types <file.ts>`
  能加载 v0.1 的 `frontend/lib/schema.ts`（zod 3.24.1 已在其 `node_modules` 内），
  用于拿 **v0.1 的 Zod 契约**做双端校验，**完全不修改 v0.1 仓库**。
  会有一条 `MODULE_TYPELESS_PACKAGE_JSON` 警告，无害。
- **本机 Python 与 JS 的舍入不等价**：Python `round()` 是银行家舍入，JS `Math.round` 是 half-up，
  `.xx5` 边界分叉（`round(2.675,2)` → `2.67`，JS → `2.68`）。跨语言复算统一走 `js_round2`。
- **Bash 管道回显中文显示为乱码**（捕获层按 GBK 解码 UTF-8 字节）——**不是脚本缺陷**，
  落盘文件与非管道输出均为合法 UTF-8（已复核）。排查编码问题不要据此改脚本。
