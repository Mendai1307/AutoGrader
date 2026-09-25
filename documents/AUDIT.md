# AutoGrader_rebirth · 项目审查与缺陷清单（AUDIT）

> **审查日期**：2026-09-25
> **审查对象**：`E:/Mendai/Documents/tencent_cloud_aigc/AutoGrader_rebirth`
> **审查方式**：交付物一全部 26 个文件逐份精读 + **脚本实跑取证**（6 个自检 / T1→T2 串联 / T4、T5 对 v0.1 真实资产复算 / **T1 对 3 个真实 docx 实跑**）
> **本轮改动**：**未修改任何源代码**。本文件为新建文档。
> **本文件性质**：缺陷登记与修复依据。**不是**交付物，不需随包；归档位置由用户决定。

---

## 0. 结论摘要

1. **规格层扎实，实现层有洞。** Skills 8 项 + Tools 6 项的规格自洽、交叉引用规范（总分口径只在 S4 定义一次）、6 个脚本无第三方依赖、T4/T5 共用同一计算实现——这部分工程质量高于同期多数参赛项目。
2. **但唯一的闸门链是断的。** T5 的 schema 与指纹两重校验因契约未冻结而长期 `skipped`；T3 的证据忠实闸门存在**静默全过**路径；T5 的档位互斥校验是**死代码**。
3. **最严重的一条不在闸门上，在事实层：T1 对真实 DOCX 完全识别不出标题**，导致 T2 对任何 docx 主动断言「六个章节全部缺失」，而 T1 报 `status: ok`。**这是静默失败**——`S2-report-parser.md` 的「常见失败场景」自己点名了这一条。
4. **进度瓶颈不在写代码，在路径 0.1。** 契约一旦冻结：T5 满血、路径二可开工、S7 的模式 3 可落地、Evaluation 层可对准字段名。这是收益最集中的一步。
5. **交付物二 / 三仍为 0–5%**，是 5 项必交材料里风险最集中的一段——尤以 PPT（连带跨专业 +2）与 Demo 视频为甚。

**严重度分布：P0 阻断 6 条 ｜ P1 正确性 10 条 ｜ P2 一致性 11 条 ｜ P3 可选 6 条。**

---

## 1. 审查范围与实测证据

### 1.1 已读对象

| 对象 | 规模 |
|---|---|
| `项目总纲与同步状态.md` | 213 行 |
| `AutoGrader 项目目标定义书_v1.0.docx` | 234 段（Python 只读提取） |
| `AutoGrader 步骤路径规划书_v1.0.docx` | 115 段（同上） |
| `agents/agent/SYSTEM_PROMPT.md` | 13,852 B / 6,447 字符 |
| `agents/skills/` S0–S7 + README | 8 + 1 份 |
| `agents/tools/` T1–T6 + README + `rules/default.rules.json` + `scripts/` 6 个 | 14 份 |
| `工具使用说明.txt` | 74 行 |
| **交叉对照**：v0.1 `frontend/lib/schema.ts` | **589 行（完整读取）** |
| **交叉对照**：v0.1 `frontend/public/results/result-sample-01.json` | 真实资产 |

### 1.2 实测取证结论（可复算）

| # | 验证项 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | 6 个脚本 `--self-test` | 5 个 exit 0；`asset_store` exit 1（**本环境只读 TEMP 所致，非项目回归**，见 §6.2） | 见 §6.2 |
| 2 | **T1 对真实 docx** | **3/3 文件 `structure=[]`、heading 块 0 个、`failures=[]`、exit 0、`status: ok`** | ❌ **P0-1** |
| 3 | **T1→T2 串联（真实 docx）** | **6 条结构规则全部输出「缺失」** | ❌ **P0-1** |
| 4 | T5 `--kind rubric`（合法 Rubric） | exit 1、`total.recompute` 报 `score 必须是数字，实际为 None` | ❌ **P0-2** |
| 5 | T5 档位重叠（`bands=[0,6],[5,10]`） | `slots.range-and-bands` 报 **pass**、无 `band.overlap` | ❌ **P0-3** |
| 6 | T5 跑 v0.1 真实结果 | exit 1、`items.missing`、`weight.sum=0.0`（误导） | ❌ **P0-4** |
| 7 | T3 顶层键写成 `candidates` 或 `{}` | `summary={0,0,0}`、**exit 0 = 全部有效** | ❌ **P1-7** |
| 8 | T4 `--items` 指向裸数组 | `AttributeError` traceback、exit 1（应 2） | ❌ **P1-7** |
| 9 | T4 `--items` 指向 `{}` | **exit 0**、total 0.0、`isPartial false` | ❌ **P1-7** |
| 10 | T4 权重和 = 60 | `upperBound` 返回 **100.0**（真实上限 60） | ❌ **P1-8** |
| 11 | T4 `--mode rank` 缺 `confidence` | `rankKey` 全 0.0、`confidence` 全默认 1.0、exit 0 | ❌ **P1-9** |
| 12 | T5 `errors` + `skipped` 并存 | exit **1**（规格要求 3） | ❌ **P1-11** |
| 13 | T2 `--report` 裸数组 | traceback、exit 1（应 2） | ❌ **P1-7** |
| 14 | T2 `--corpus` 目录不存在 | `FileNotFoundError` traceback、exit 1（应 2） | ❌ **P1-7** |
| 15 | T1 `--input` 文件不存在 | `FileNotFoundError` traceback、exit 1（应 2） | ❌ **P1-7** |
| 16 | T1 `--input` 非法扩展名 | exit 2 + `unsupported-format` | ✅ 一致 |
| 17 | T6 `--op list --kind template` | `count:0` + **exit 1**（缺省资产根不存在） | ❌ **P2-22** |
| 18 | T6 `--op put --kind template` | exit 2（只读保护生效） | ✅ 一致 |
| 19 | T6 `--op get` 不存在的 id | exit 1 + `未命中；不得用相似项顶替` | ✅ 一致 |
| 20 | 总分口径（T4 实跑） | `8/10×40 + 6/10×30 = 50.0`、`W_r=30`、上界 70 | ✅ 口径正确 |
| 21 | 等级映射门禁 | `W_r=0` 但 `included≠100` → `grade=null` | ✅ 符合 §3.4 |
| 22 | 无网络 / 无 AI 依赖（全文 grep） | 无 `requests`/`socket`/`openai` 等 | ✅ 一致 |
| 23 | T5 与 T4 共用实现 | `import deterministic_calculator as T4` | ✅ 一致 |
| 24 | `python3` 可用性 | **本机 PATH 上不存在**（仅 `python`、`py`） | ⚠ **P0-5** |

### 1.3 目录事实核对

| 记载 | 实际 |
|---|---|
| 总纲记 `agents/workflow/`「目录已建，内容未落」 | **目录存在，0 文件** → 总纲**正确** |
| 总纲记 `agents/evaluations/`「目录已建，内容未落」 | 目录存在，0 文件 → 正确 |
| — | 工作区根存在未登记的 `工具使用说明.txt` |
| — | **无** `.codebuddy-plugin/plugin.json`，**无** `agents/<agentName>.md` |
| — | `web/`、`materials/`、`docs/`、`.github/` **均不存在** |
| — | **本工作区不是 git 仓库**；无 `.gitignore` / `README` / `LICENSE` |

---

## 2. P0 · 阻断级（6 条）

> 优先级定义：**P0 = 不解决则后续返工或无法交付**。

### P0-1｜T1 在真实 DOCX 上完全识别不出标题 → 结构树恒为空，却报「成功」

**这是全项目最严重的缺陷。** 实测 3 个真实 docx，全部：`structure = []`、`heading` 块 **0 个**、`failures = []`、**exit 0**、`status: ok`。

| 文件 | 实际标题数 | T1 检出 | 退出码 / 状态 |
|---|---|---|---|
| `AutoGrader 项目目标定义书_v1.0.docx` | 26（`w:outlineLvl` 0/1） | **0** | exit 0 / ok |
| `AutoGrader 步骤路径规划书_v1.0.docx` | 17（`w:outlineLvl` 0/1） | **0** | exit 0 / ok |
| `.work/handbook.docx` | **28**（style 名 `heading 1/2/3`） | **0** | exit 0 / ok |

`handbook.docx` 实测到的标题样例：`一、赛事概览`、`1.1 赛事定位`、`1.2 赛事亮点`、`二、赛题设置`、`方向一：AI + 教学管理助手`——**全部未被识别**。

**两个独立根因（两种 DOCX 编码各中一个）：**

| # | 触发文件 | 根因 |
|---|---|---|
| 1 | 项目自己的两份 docx（`office-edit` 产出） | `w:pStyle` **全部缺失**（233/233、442/442 段都没有）；标题**只由 `w:outlineLvl`（0/1）标记**。而 `_docx_para`（`document_parser.py:179-214`）只读 `w:pStyle`，**从不读 `w:outlineLvl`** |
| 2 | `handbook.docx`（真实 Word 文件） | `w:pStyle w:val` 是**数字 styleId**（`'1'`/`'2'`/`'3'`），真名在 `word/styles.xml` 里是 `heading 1`/`heading 2`/`heading 3`。`document_parser.py:202` 直接拿 `w:val` 去匹配 `^(?:Heading\|heading\|标题)\s*([1-6])$`，**从不开 `styles.xml`** → 必然不中 |

**实测连带影响（T1→T2 串联）：**

```
file: AutoGrader 项目目标定义书_v1.0.docx
T1 exit 0 status ok | structure roots: 0 | heading blocks: 0
structure.chapter.analysis    -> 章节「结果分析」缺失 | value=False | evidenceAnchor=None
structure.chapter.environment -> 章节「实验环境」缺失 | value=False | evidenceAnchor=None
structure.chapter.principle   -> 章节「实验原理」缺失 | value=False | evidenceAnchor=None
structure.chapter.results     -> 章节「实验结果」缺失 | value=False | evidenceAnchor=None
structure.chapter.steps       -> 章节「实验步骤」缺失 | value=False | evidenceAnchor=None
structure.chapter.summary     -> 章节「实验总结」缺失 | value=False | evidenceAnchor=None
```

1. T2 的 `check_structure`（`rule_inspector.py:97-113`）**只扫 `kind=="heading"` 的块** → 对**任何** docx 都断言「缺失」。这是**主动的否定断言**，同时违反：
   - T1 规格「不得把『解析不到』表述为『缺失』」
   - `S2-report-parser.md` 规则 3「解析不到一律报『未解析』」
   - `SYSTEM_PROMPT` §1.4 L1「未知优于否定」与 §8.1「不得把『未找到证据』表述为『学生没有做』」
2. `_section_no` 恒为 0（`add_heading` 从不触发）→ 所有 anchor 退化为 `0.1/0.2/0.3…`，「章节坐标」这一核心交付能力消失。
3. **`roots=0` + `status: ok` = 静默失败**。这正是 `S2-report-parser.md` 自己点名的场景：
   > 「章节标题识别错误，导致下游所有取证定位整体偏移——**这种情况不会报错，最危险**。」

   **规格预判了它，实现就中了它。**

**修法**（三处，缺一不可）：
- `_docx_para` 增加 `w:outlineLvl` 回退（`val` 0→level 1，1→level 2，…）
- 解析 `word/styles.xml`，建立 `styleId → styleName` 映射后再做标题正则匹配
- **正文非空但 `structure` 为空时，必须写 `fail()` 并降级 `status`**，禁止报 ok

---

### P0-2｜T5 的 `--kind rubric` 永远不可能通过 → 模式 1「建标」被彻底堵死

对一个**完全合法的 Rubric** 运行 `--kind rubric`：

```
exit=1  valid=False
error codes = ['evidence.missing', 'evidence.missing', 'total.recompute']
  total.recompute: "P1.score 必须是数字，实际为 None"
```

**根因**：`contract_validator.py:222-229` 无条件把 `items` 丢给 `recompute_total()` → `deterministic_calculator.py:49` 对**每一项**都强制要求数字 `score`；而 Rubric 按定义**没有** `score`。同时 `check_evidence`（`:159-168`）也无条件对 Rubric 跑，产出 2 条**假的** `evidence.missing`。

**为什么是 P0**：`S1-rubric-builder.md` 执行规则 6 明写「保存前**必须**经 S5 三重校验通过方可入库」，而 S5 的三重校验（`S5-contract-assembler.md:28`）第一重就是 T5 契约校验 → **任何 Rubric 都存不进去，模式 1 直接死**。

这也解释了为什么 T6 的 `rubric` 类别至今只有接口层、`agents/tools/assets/` 目录始终没建——**下游根本走不到那一步**。

**修法**：按 `kind` 分流。`rubric` 只跑 schema / 权重和 / 档位 / 可判定性，**跳过** `total.recompute` 与 `evidence.present`；`review-result` 保持现状。

---

### P0-3｜T5 的档位互斥校验是死代码，且静默返回「通过」

给 Rubric 塞明显重叠的 `bands: [{from:0,to:6},{from:5,to:10}]`：

```
exit=1  error codes = ['evidence.missing', 'evidence.missing', 'total.recompute']
checks = [..., {'check':'slots.range-and-bands','status':'pass'}, ...]   ← 报「通过」
```

**根因**：`contract_validator.py:127-128` 的 `if sc is None: continue` 排在 `:137-139` 的 `check_bands()` 调用**之前**。Rubric 的 `score` 恒为 `None` → **`check_bands` 永不执行**。

**影响**：
- `S1-rubric-builder.md` 输出承诺「一致性自查报告：权重和、**档位互斥性**、可判定性逐项结论」→ **档位互斥没有任何工具兜底**。
- `S1` 执行规则 4「档位必须互斥且穷尽」→ 规格要求，零执行。
- `T5-contract-validator.md` 的「做」清单列有「档位区间互斥且穷尽」→ 规格承诺，零实现。

**修法**：把 `check_bands` 提到 `score` 判断**之前**，使其独立于 `score`；顺带补 `lo <= hi`（区间不倒置）与「穷尽」（无缝无洞）两项检查。

**⚠ 前置裁决**：T5 的 `check_bands` 读的是 `{from, to}` **数值区间**；而 v0.1 契约的档位模型是 `levels[]{level, label, criterion, scoreRatio}`（**等级 + 得分系数**），**两者不可调和**。详见《契约冻结方案.md》冲突二。

---

### P0-4｜`ReviewResult` 契约存在两份互不兼容的候选，Tools 层两边都不认

拿 v0.1 的**真实资产** `result-sample-01.json`（`totalScore: 97.2`）跑 `T5 --kind review-result`：

```
exit=1  valid=False
  items.missing  $.items        -> NoneType
  weight.sum     items[].weight -> 0.0        ← 明明权重和是 100，属误导性二次错误
  recomputed: None
```

**v0.1 真实契约结构（已完整读取 `schema.ts` 589 行）**：

```
ReviewResult: schemaVersion / report{reportId,title,course,studentCode} / rubricVersion /
              rubric? / scores[] / totalScore / review / feedback / steps[] / provenance
ScoreItem:    rubricItemId, itemName, weight, maxScore, level, levelScoreRatio,
              score, deductionReason, evidence[], confidence, needsReview
Evidence:     id, kind, location, quote, confidence, note
```

**新设计（`SYSTEM_PROMPT` §7.2 + T4/T5 代码）**：顶层 `items[]`，字段 `pointId` / `score` / `maxScore` / `weight` / `pending` / `confidence`。

**字段名系统性冲突（11 处）**：

| # | 概念 | v0.1 契约 | 新 §7.2 + T4/T5 |
|---|---|---|---|
| 1 | 逐项数组 | `scores[]` | `items[]` |
| 2 | 评分点 id | `rubricItemId` | `pointId` |
| 3 | 名称 | `itemName` | `pointName` |
| 4 | 复核标记 | `needsReview` | `pending` |
| 5 | 总分 | `totalScore`（`.max(100)`） | `total.value` |
| 6 | 档位 | `level` + `levelScoreRatio` | `suggestedBand` |
| 7 | 证据坐标 | `evidence[].location` | `evidence[].anchor` |
| 8 | 引用有效 | — | `evidence[].citationValid` |
| 9 | 建议分 | — | `suggestedScore` |
| 10 | 终值归属 | — | `overriddenByTeacher` |
| 11 | 部分分 | — | `total.weightExcluded` / `total.upperBound` |

**加重情节**：
- v0.1 契约**全对象 `.strict()`**（未知字段一律拒绝）→ 新字段会被直接拒。
- `totalScore` 是 `.max(100)` 的**单一数值**，无法表达「部分分 + 上界」。
- T5 的极简 JSON Schema 子集（`validate_schema`，`:59-93`）**不支持 `additionalProperties`** → `.strict()` 这条最强的防幻觉机制**即使冻结了也表达不出来**。

**后果**：路径 0.1 的完成判据「12 份既有结果全部通过 zod 校验」按现设计**不可达**。

**修法**：一次性冻结契约。**推荐路线与完整对齐表见《契约冻结方案.md》**——结论是**以 v0.1 为基线做向后兼容的超集扩展**，新增字段一律 optional，使 12 份历史资产**无需改写即继续通过校验**。

---

### P0-5｜专家包打包层完全不存在，且工具调用方式存在未验证的硬风险

**打包层现状（全部为 0）**：

| 平台要求 | 现状 |
|---|---|
| `.codebuddy-plugin/plugin.json`（仅 `agents[]` + `skills[]`） | ❌ 无 |
| `agents/<agentName>.md`（frontmatter **严禁** `tools:`） | ❌ 无（只有 `SYSTEM_PROMPT.md`） |
| `skills/<name>/SKILL.md`（须为**目录**） | ❌ 8 个技能是**扁平 `.md`** |
| 落点 `$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/<name>/` | ❌ 未打包 |
| `tools/` 是平台**不认可**的落点 | ❌ 未映射到 `skills/<s>/scripts/` 或 `bin/` |

**后果**：交付物一当前**无法被平台识别为专家包**，距「评委装得上、问得出」还差整体一跳。

**⚠ 本轮新增的硬风险（未验证）**：本机 PATH 上 **`python3` 不存在**——

```
python   -> E:\ProgramData\anaconda3\python.exe
python3  -> NOT FOUND
py       -> C:\Windows\py.exe  (3.11.9)
```

而 `tools/README.md`、六份 T 规格、全部脚本 docstring 都写 `python3 scripts/xxx.py`。
C-012 的推断「内置技能普遍以 `python3` 调起 → 执行环境具备 python3」**未经实测，本机反证**。

→ **打包前必须在 LearnBuddy 内置 Bash 里实测 `python3 -V` / `python -V`**；若缺失，六个工具会全部 `command not found`，全部规格与脚本 docstring 需同步改为 `python` 或加 shim。
（本轮无法在 Git Bash 复测——沙箱禁止 bash 创建 signal pipe，见 §6.1。）

---

### P0-6｜Workflow 与 Evaluation 两层为空

| 层 | 落点 | 现状 |
|---|---|---|
| Workflow | `agents/workflow/` | **目录存在，0 文件** |
| Evaluation | `agents/evaluations/` | 目录存在，0 文件 |

**待落内容**（依规划书 1.4 / 1.5）：
- Workflow：五 Agent 编排规格（每环输入/输出/置信度/证据引用齐备）、编排形态（单会话分步 + 多会话分环）、失败处理（回退与重试路径）
- Evaluation：① 指标定义（总分 MAE / 逐项命中率 / 档位一致率 / 置信度校准，每项可由原始数据复算）② 评测脚本（一条命令出报告）③ 回归门禁（指标劣化即不通过）

**后果**：直接削弱「技术创新性 30 分」与「AI 工具使用 25 分」的证据链。这是**分值最高、成本最低**的一块。

**依赖**：Evaluation 依赖 v0.1 的 12 份样例 + 教师金标准 + 12 份评阅结果——**是否搬入本工作区尚未确认**（见 P2-22）。

---

## 3. P1 · 正确性（会造成静默错误，10 条）

### P1-7｜入参形状不符 → 静默全过 / 裸 traceback（六个脚本五种表现）

| 脚本 | 输入 | 实测 | 应为 |
|---|---|---|---|
| T3 | 顶层键写成 `candidates` 或 `{}` | `summary={0,0,0}`、**exit 0 = 全部有效** | exit 2 |
| T4 | `--items` 裸数组 | `AttributeError` traceback、exit 1 | exit 2 |
| T4 | `--items` 指向 `{}` | **exit 0**、total 0.0、`isPartial false` | exit 2 |
| T5 | `--input` 裸数组 | `AttributeError` traceback、exit 1 | exit 2 |
| T2 | `--report` 裸数组 | traceback、exit 1 | exit 2 |
| T2 | `--corpus` 目录不存在 | `FileNotFoundError` traceback、exit 1 | exit 2 |
| T1 | `--input` 文件不存在 | `FileNotFoundError` traceback、exit 1 | exit 2 |

**T3 那条最致命**：T3 是「证据不得改写」这条纪律的**唯一硬闸门**（`T3-citation-resolver.md` 原文：「没有本工具，这条纪律只能写在 Prompt 里靠模型自觉；有了它，篡改引用会直接校验失败」）。入参形状一偏，闸门**静默全过**——这条纪律实际上就不成立了，而且是**零报错地**不成立。

**共同根因**：T3/T4/T5 三份规格的「输入」一节**均未写明入参顶层包裹键是 `items`**；按规格字面实现（裸数组或其它键名）就会踩中。

**修法**（统一）：
1. 三份规格补写**完整入参样例**（含顶层包裹键）
2. 六个脚本统一加**形状前置校验**：顶层必须是对象且含 `items` 数组，否则 `exit 2` + 结构化 JSON 报错
3. `main()` 级 `try` 包裹 `run()`，禁止裸 traceback

---

### P1-8｜T4 `upperBound` 数学错误（规格也错）

**实测**：权重和只有 60 时，`upperBound` 仍返回 **100.0**（该场景下真实上限是 60）。

```
weight sum=60 -> upperBound: 100.0 | gradeNote: 已计入权重合计 60.0 ≠ 100，暂不做等级映射
```

**根因**：`deterministic_calculator.py:102` 的 `upper = round(100.0 - w_ex, 6)` 把 100 写死。正确式应为 `Σ已计入 weight`。

**加重情节**：`T4-deterministic-calculator.md` 与 `SYSTEM_PROMPT` §3.2/§7.2 都把 `100 − W_r` 写成**定义** → **规格本身也错**，三处需一起改。

**修法**：`upperBound = Σ已计入 weight`（= `100 − W_r` 仅在权重和恰为 100 时成立）。规格同步改写为 `Σ已计入 weight`。

---

### P1-9｜T4 `--mode rank` 缺 `confidence` 时静默退化为「按 pointId 字母序」

**实测**：两项都不给 `confidence` →

```
rank, no confidence given -> [('P1', 0.0, 1.0), ('P2', 0.0, 1.0)]   exit 0
                                ↑rankKey 全 0    ↑confidence 全被默认成 1.0
```

**根因**：`deterministic_calculator.py:59` 的 `conf = 1.0 if conf is None else ...`，配合 `:131` 的 `key = (1.0 - confidence) * errorCost` → 全部得 0 → 排序退化为按 `pointId` 的字母序。

**影响**：S7 的全部价值就是「低置信 × 高出错代价」排序（`S7-review-checklist.md` 入口 A 规则 2 明写「排序公式固定…不得随手改」）。缺字段时返回的是一个**看起来完全合法**的排序（实为字母序），教师会照着**错误的优先级**复核——而且没有任何报错。

**修法**：`confidence` 缺失时**不得默认 1.0**。应记 `confidenceMissing: true` 并降级（exit 1 或 3）；或直接拒绝并 `exit 2`。

---

### P1-10｜「待复核项」与 T4 的 `score` 必填互相矛盾 → 按契约填 `null` 就炸

- `SYSTEM_PROMPT` §7.3 明写「任一字段**无法给出**时，填 `null` 或「未找到」」
- §7.2 的 `items[].score` 是**终值**——而**待复核项恰恰是最可能没有终值的那一项**
- 但 `deterministic_calculator.py:49` 的 `normalize` 对**所有**项（含 `pending:true`）强制要求数字 `score`

**后果**：一个 `score: null` 的待复核项会让**整个总分计算** `BadInput` 失败 → **模式 2 一遇到待复核项就出不了总分**。而「待复核项」正是这套设计的常规状态（`SYSTEM_PROMPT` §5.2：低置信 → 标待复核）。

**修法**：`pending === true` 的项豁免 `score` 必填（允许 `null`），且不参与 `maxScore` 越界校验。

---

### P1-11｜T5 退出码优先级与规格相反

**实测**：`errors` 与 `skipped` 同时存在 → `exit 1`。

**根因**：`contract_validator.py:261-265` 的 `if errs: return 1; if skipped: return 3`。

**规格原文**（`T5-contract-validator.md:81`）：「**只要有 `skipped` 项，退出码为 3**」。

**影响**：CI 中 1 与 3 都判不通过，故无放行风险；但失去「结果不可信是因为**依赖缺失**」这一区分度——退出码再也说明不了「是产物错了，还是校验本身没跑全」。

---

### P1-12｜T5 并未做「证据坐标有效性」校验（规格承诺的）

`T5-contract-validator.md` 的「做」清单列有：
> 每条评分点是否带**有效**证据坐标（**复用 T3 的有效性判定结果**）

**实测**：`check_evidence`（`contract_validator.py:159-168`）**只看 `evidence` / `evidenceAnchor` 字段是否存在**，从不调用 T3，也不看 `citationValid`。

**影响**：`SYSTEM_PROMPT` §4.3「证据必须经 T3 引用解析器校验通过」这条纪律在**全链上没有任何强制点**——只靠模型自觉去跑 T3 并如实抄回结果。这与 C-013 宣称的「把一句道德要求变成可执行的闸门」不符。

**另一个连带问题**：`SYSTEM_PROMPT` §7.2 用字段名 `citationValid`，而 T3 实际输出的是 `valid`；**映射规则无任何文档**。

---

### P1-13｜T2 信任 T1 的 `summary` 而不复算

`rule_inspector.py`：`check_code:121` 用 `summary.get("codeBlocks", 0)`；`check_statistics:155-160` 全取 `report["summary"]`。

而 T1 源码注释（`document_parser.py:317`）写的是「统计（**供下游 T2 复算**）」。

**后果**：`report.json` 一旦被改动或由别处生成，T2 会输出**错误事实**且无任何检测手段。T2 的定位是「确定性核查器」，实质却成了「T1 summary 的转述器」。

**修法**：T2 从 `blocks` 自行复算，并与 `summary` 交叉核对；不一致即报错。

---

### P1-14｜四模式只在 Skills 索引里成立，Prompt 与 S0 仍是两链

| 位置 | 现状 |
|---|---|
| `skills/README.md` §一 | **已定义四模式 + 生产组 / 消费组**，并自标「⚠️ `S0` 的路由规格**尚未扩展**到四模式」 |
| `SYSTEM_PROMPT.md` §2（`:51-83`） | **只有流程 A / 流程 B**，无模式 3/4 的路由与边界 |
| `SYSTEM_PROMPT.md` §1.1（`:21-29`） | 「必须做的」六条**不含**模式 3 的只读回放 |
| `SYSTEM_PROMPT.md` §7.2 | `taskType` 仍是 **A / B** |
| `S0-task-router.md` | 输出仍是 `A｜创建评分标准` / `B｜评阅实验报告` |

**性质**：属**已知缺口**（总纲第五节已登记「待 S0 路由扩展」），非隐藏缺陷。但对交付是实打实的阻断：**模式 3（复核，演示价值最高的入口）**与**模式 1**一起无法从规格走到可运行。

---

### P1-15｜三份 Skill 规格的 Tool 依赖声明是错的

与 `tools/README.md` 的「服务矩阵」（`:75-82`）交叉对照后：

| 文件 | 现写 | 应为 | 依据 |
|---|---|---|---|
| `S3-evidence-grader.md:9` | 「确定性核查器（统计特征 / 代码 API / 查重线索）」= **仅 T2**，**通篇未提 T3** | **T2 + T3** | 服务矩阵标 T2/T3 双服务 S3；README `:68` 明写 T3 是「证据忠实」的唯一闸门 |
| `S4-score-calculator.md:9` | 「契约校验器（总分复算）」 | **T4** | 总分计算是 T4；契约校验器是 T5（T5 自己也只是复用 T4） |
| `S7-review-checklist.md:9` | 「**无**」 | **T4** | S7 入口 A 规则 2 的排序键就是 T4 `--mode rank`；服务矩阵标 T4 服务 S7 |

**评价**：S3 漏掉 T3 这一条最要紧——**一个技能规格不声明自己最核心的闸门工具**，等于默认它不存在。

**附带**：Skills 层用中文描述性名称指代工具，Tools 层用 T1–T6 编号，两套命名无映射表。建议 Skills 元信息表统一改用 `T1–T6` 编号（可附中文名）。

---

### P1-16｜S2 承诺的「截图输入」T1 根本没有

- `S2-report-parser.md:18` 输入列：「或纯文本、**截图**形式的报告内容」
- T1 无任何图像 / OCR 路径；`.png` → `unsupported-format` → exit 2

规则 4 的兜底（「全截图 / 无文字层的输入，输出结构化失败结果」）尚在，但**输入承诺与实际能力不符**，会让 Expert 在路由阶段误判「这个我能处理」。

---

## 4. P2 · 一致性（11 条）

| # | 位置 | 问题 |
|---|---|---|
| **P2-17** | `document_parser.py:50-52` `clean_text` | 对每行做 `re.sub(r"[ \t]+", " ", t).strip()` → **改写了原文**。而 T1 规格承诺 `blocks[].text`「**原文逐字**」、T3 规格承诺「逐字比对**不做任何模糊归一化**——不改空白、不改全半角、不忽略标点」。源文件里的连续空格 / 制表 / 行首缩进被吃掉，第三方拿原文复算必然不等。**建议**：拆 `rawText`（逐字）/ `text`（规范化）两栏，T3 用 `rawText` |
| **P2-18** | `citation_resolver.py:78, 87` | `exactText` 两条路径语义不同：给 `quote` → 引文子串；只给 `anchor` → **整块全文**。而 `blockDigest` 恒为**整块** `text` 的 sha256，**不覆盖引文本身** → 契约里 `evidence[].quote` 可能是一整段，摘要也无法证明引文。另：只给 `quote` 且命中多块时静默取 blockId 最小者，**不报歧义** |
| **P2-19** | `citation_resolver.py` rejected 枚举 | 规格列 `anchor-not-found` / `quote-mismatch` / **`anchor-out-of-range`**；实现**从不产出第三项**（`:46, 52, 56, 67, 74`），却多出规格未列的 `no-locator`；`blockId` 未命中也被报成 `anchor-not-found`（字段名误导） |
| **P2-20** | `T5-contract-validator.md` | **自相矛盾**：§输入说 schema / 指纹「可选；**缺省用随包内置**」，§前置依赖说「**当前未随包内置**…缺失即降级」。§输出承诺 `recomputed` 含 `total` / `weightSum` / `fingerprint`，实现返回 `total` / `weightIncluded` / `weightExcluded` / `upperBound`，**无 `weightSum`、无 `fingerprint`** |
| **P2-21** | `contract_validator.py:59-93` | Schema 子集只支持 `type` / `enum` / `minimum` / `maximum` / `required` / `properties` / `items` / `minItems`；**无 `additionalProperties` / `pattern` / `minLength` / `oneOf` / `$ref`** → 撑不起 v0.1 契约的 `.strict()` + union + refine |
| **P2-22** | `asset_store.py:56-57` | 规格明写 exit 2 =「资产非法、**目录不可读**」，但 `list_items` 对不存在的目录 `return []` → **exit 1（未命中）**。而 exit 1 的下游动作是「由 S1 转为『新建标准』路径」→ **「资产根本没随包」被读成「库里确实没有样板」**，走错分支。且缺省资产根 `agents/tools/assets` **不存在**，样板库 / 样例 / 金标准**均未随包** |
| **P2-23** | `asset_store.py` 其他 | ① `--id` / `--from` 无路径穿越防护（`--id ../../x` 可越出 store）② `put` 源文件无扩展名时写入无扩展名文件 → `list` / `get` **都看不见它**（`EXTS` 只认 `.json` / `.md`）③ `put` 只在源是 `.json` 时校验 JSON 合法性 ④ `--tag` 是 AND 语义（`set(tags) <= set(item_tags)`），规格未写明 |
| **P2-24** | `deterministic_calculator.py` 其他 | ① `detail[].contribution` 对 `pending` 项也计算并输出，下游自行累加 `detail` 会得到与 `total` **不同**的数 ② `total = round(total, 6)` 后再比档位线，浮点边界（89.9999996 → 90.0 → A）可能改档 ③ `--grade-bands` / `--out` / `--self-test` 均**未写进 T4 规格的输入表** ④ `_parse_bands` 传参后档位名固定为 A/B/C/D…，与默认档位语义不连续 |
| **P2-25** | `rule_inspector.py` 其他 | ① **`--corpus` 完全未写进 T2 规格输入表**，但没有它 `similarity.shingle` 永远 `notCovered` → **查重能力默认不可用** ② `check_structure` 是子串匹配（`any(pat in title)`），`"结果"` 会被「**结果分析**」命中 → 六条结构规则彼此串味 ③ 完成判据「与浏览器端核查器**输出必须完全一致**」在本工作区**无对照物**（`web/` 未建），当前不可验证 |
| **P2-26** | `项目总纲与同步状态.md` | ① 第三节 Skills 行路径写 `backend/autograder-expert/agent/skills/README.md`——**缺 `s`** ② 第三节 Tools 行只列 4 项能力，实际 6 个 ③ **第三节 Prompt 行标 ✅「暂存稿 v0.1」，但同一文件顶部自称「待修订项：四模式确定后 §2 / §7 需同步调整」**；四模式 C-016 已定稿而暂存稿未随之修订 → 状态应改回 🟡 ④ 第五节路径 0「未定」清单仍含「对话 ID 规范」，但第九节规范已定义且 C-000–C-019 已按规范登记 ⑤ 第五节模式 2「待**批量参数**」，但 SYSTEM_PROMPT / S3 / S4 / S6 均无批量参数定义（仅 `S6:26` 输出括注「（批量时）」）⑥ 第六节目录树未登记工作区根真实存在的 `工具使用说明.txt` ⑦ **第九节表格 C-018 与 C-019 行之间存在空行 → Markdown 表格被截断、渲染断裂** |
| **P2-27** | 两份 docx | **规划书**：① `1.1.3` 判据「按 Prompt 口径**手算**与产物一致」与 `SYSTEM_PROMPT` §3.3「**不接受口算**」直接冲突 ② `1.2` 仍列 5 项旧技能（缺 S0 / S4 / S7）③ `1.3` 仍列 4 项工具（应为 6 项 T1–T6，且「样例检索」实为 T6 **资产库**）④ 全文无四模式 ⑤ **缺「专家包打包与平台合规映射」这一跳**（同 P0-5），路径一止于五件套。**目标定义书**：⑥ 通篇建立在「**36 小时倒排 / 9-26 23:59 截止**」上，与总纲第十节「不做时间规划」冲突 ⑦ P0 含已被废弃的「**备用链接**」⑧ `6.2` 的 D1–D4 **全部已决** ⑨ `4.x` 证据清单指向 rebirth 尚不存在的资产且未标「待移植」 |

---

## 5. P3 · 可选（6 条）

| # | 内容 |
|---|---|
| **P3-28** | `document_parser.py:436` 的 `return 0 if args.self_test else code` 是**死代码**（`self_test` 已在 `:419-420` 提前返回） |
| **P3-29** | `asset_store.py:162` 的 `--self-test` 依赖 `tempfile.TemporaryDirectory()`，是六个脚本里**唯一**如此的。在不可写 TEMP 的环境（锁定 CI / 受限沙箱）会抛未捕获 `FileNotFoundError` + traceback 且 exit 1，与「断言失败」**不可区分**。**这不是项目回归**，是健壮性缺口。建议改用脚本内相对目录或显式传入 `--tmp` |
| **P3-30** | `contract_validator.py:209` 的 `weights.sum` 用 `any(e["code"].startswith("weight.") for e in errs)` 扫**全部累积错误**，而其余三项检查（`:214, :218, :225`）都用 `before` 计数——唯独这项不一致 |
| **P3-31** | `contract_validator.py:112-115`：`items` 缺失时 `check_weights` 仍报 `weight.sum = 0.0`，**制造误导性二次错误**（一个根因产出两条错，第二条还是错的） |
| **P3-32** | `document_parser.py:270` 的 PDF 抽取只匹配 `Tj` 运算符，**不匹配 `TJ`（数组形式）**——而现代 PDF 绝大多数用 `TJ` → PDF 支持实质上不可用，且失败信息是「无文字层（可能为扫描件）」，**归因错误** |
| **P3-33** | `document_parser.py:202` 的标题正则只认 `Heading N` / `heading N` / `标题 N`；WPS 与部分中文 Word 的样式名（如「标题 1」带全角空格、`标题1` 无空格已覆盖但 `Heading 1` 之外的本地化名）覆盖不全。与 P0-1 同源，修复时应一并扩展 |
| **P3-34** | 工作区根未登记文件 `工具使用说明.txt`（C-012 结论的落盘物）；**工作区不是 git 仓库**，无 `.gitignore` / `README` / `LICENSE`——而「源码仓库」是 5 项必交之一 |

---

## 6. 环境与复现说明

### 6.1 本次审查的环境限制（影响可复现性，须如实标注）

| 限制 | 影响 |
|---|---|
| **DSH 文件策略 = 只读** | **禁止写入任何文件**（含临时目录）。因此无法创建测试夹具，全部测试改为 `python -c` / stdin 内存内构造 |
| **可写 TEMP 不可用** | 实测 `C:\Users\Mendai\AppData\Local\Temp` 存在但**写入被拒**（已用探针确认）→ `asset_store --self-test` 失败，见 §6.2 |
| **PowerShell ConstrainedLanguage 模式** | `[System.IO.*]::`、`[Text.UTF8Encoding]::new()` 等 .NET 静态调用被拒；控制台输出编码为 GBK，中文显示为乱码（**不影响脚本落盘的 UTF-8 正确性**，已用 `json.load` 验证） |
| **Git Bash 不可用** | `bash -lc` 报 `couldn't create signal pipe, Win32 error 5`（沙箱禁止命名管道）→ **无法在 Git Bash 中复测 `python3` 解析**，故 P0-5 的 python3 结论**仅基于 PowerShell PATH 探测** |

### 6.2 关于「6 个脚本自测全部通过」的订正

上一份审查报告的「6 个脚本 `--self-test` 全部 **exit 0**」这一结论，**在当前只读环境下无法复现**：

```
document_parser            self-test exit=0
rule_inspector             self-test exit=0
citation_resolver          self-test exit=0
deterministic_calculator   self-test exit=0
contract_validator         self-test exit=0
asset_store                self-test exit=1     ← 仅此一个
```

**归因已完成**：`asset_store._self_test` 调用 `tempfile.TemporaryDirectory()`，而本次会话为**只读文件策略**，`tempfile.gettempdir()` 找不到任何可写目录 →

```
FileNotFoundError: [Errno 2] No usable temporary directory found in
['C:\\Users\\Mendai\\AppData\\Local\\Temp', 'C:\\Windows\\Temp', 'c:\\temp', ...]
```

**结论：这不是项目回归。** 在正常桌面环境下 T6 自检应当通过（其余 5 个脚本的自检都不需要临时目录，故不受影响）。
**但**它揭示一个真实缺口（见 P3-29）：T6 是唯一依赖可写临时目录的自检，在锁定 CI / 受限沙箱下会以 traceback + exit 1 收场。

### 6.3 关于 `python3`

```
python   -> E:\ProgramData\anaconda3\python.exe   (Python 3.13.5)
python3  -> NOT FOUND
py       -> C:\Windows\py.exe                     (3.11.9)
```

**本机 PATH 上没有 `python3`。** 这一条不足以断定「LearnBuddy 环境也没有」（其 Bash 可能自带环境），但**足以推翻 C-012 的推断**——那条推断是「内置技能用 `python3` 调用 ⇒ 环境具备 python3」，属**未实测的推理**。
→ 打包前**必须**在 LearnBuddy 内置 Bash 里实测，见 P0-5。

---

## 7. 与上一轮审查报告的差异

`.work/AutoGrader 项目审查报告_2026-09-25.md`（上轮产出）经逐条复核：

| 类别 | 条目 |
|---|---|
| **确认**（9 条） | P0-2（契约未冻）、P0-4（Evaluation 空）、P0-5（打包层缺）、P0-6/P2-22（T6 资产根与退出码）、P1-7（T3 静默放行）、P1-9（T5 退出码优先级）、P1-11（本文件 P1-14，四模式未并入）、P2-26、P2-27 |
| **修正**（2 条） | ① 上轮记「`agents/workflow/` **目录不存在**」→ **实际存在，只是空**；总纲原文「目录已建，内容未落」是**正确的**，上轮该条为误报 ② 上轮记「6 个脚本自测全部 exit 0」→ 在本环境不可复现，归因见 §6.2（**非项目回归**，但暴露 P3-29） |
| **新增**（12 条） | **P0-1**（T1 DOCX 标题识别全失，最严重）、**P0-3**（T5 档位校验死代码）、**P0-5 的 python3 风险**、**P1-8**（`upperBound` 数学错误）、**P1-9**（rank 静默退化）、**P1-10**（`pending` 与 `score` 必填矛盾）、**P1-12**（T5 未做证据有效性校验）、**P1-13**（T2 不复算）、**P1-15**（三处 Skill Tool 依赖声明错误）、**P1-16**（S2 截图输入无实现）、**P2-21**（Schema 子集缺口）、**P3-32/P3-33**（PDF `TJ`、标题正则） |

---

## 8. 修复优先级建议

**第一步（并行，均为「不修则后续全部返工」）**

1. **冻结 `ReviewResult` 契约** → 见《契约冻结方案.md》。这是路径 0.1，是所有后续步骤的根。
2. **修 P0-1（T1 标题识别）** → 不修则任何格式的实验报告都产不出坐标，S2→S3→S7 整条消费链拿到的是「六个章节全缺失」的**假事实**。
3. **修 P0-2 + P0-3（T5 rubric 分流 + 档位检查提前）** → 不修则模式 1「建标」完全不可用。

**第二步**

4. **P1-7 统一入参形状防御**（六脚本 + 三份规格补入参样例）——成本极低，堵住「静默全过」。
5. **P1-8 / P1-9 / P1-10**（T4 三处）——都是几行改动，但各自会产出**看起来合法的错误结果**。
6. **P1-15 改正三份 Skill 的 Tool 依赖声明**——纯文档，但影响 S3/S4/S7 的可执行性判断。

**第三步**

7. **落 Workflow 层 + Evaluation 层**（P0-6）——交付物一里分值最高、成本最低的一块。
8. **建随包资产根**（P2-22）+ 把 v0.1 的 12 份样例 / 金标准 / 评阅结果搬入。
9. **补四模式路由**（P1-14）+ **打通 R1**（读入既有 `ReviewResult` 的通道）。

**第四步**

10. **打包与平台合规映射**（P0-5）+ **实测 `python3`**。
11. 交付物二（Web Demo）与交付物三（评审材料包）。

---

## 9. 登记项模板（后续新增缺陷请沿用）

```
### P?-NN｜<一句话结论>
**现象**：<实测输出或代码位置>
**根因**：<文件:行号 + 机制>
**影响**：<会导致什么错误行为 / 谁会读到错的东西>
**修法**：<最小改动>
**回归用例**：<如何证明已修>
```

---
