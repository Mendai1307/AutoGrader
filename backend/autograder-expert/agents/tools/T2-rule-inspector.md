# T2 · 客观核查器

| 项 | 内容 |
|---|---|
| Tool ID | T2 |
| 名称 | 客观核查器（`rule-inspector`） |
| 形态 | 命令行脚本，python3，标准输出 JSON |
| 服务于 | S3 证据取证与逐点判定 |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 打包落点 | `skills/<skill-name>/scripts/` 首选；或插件根 `bin/` |
| 脚本 | [`scripts/rule_inspector.py`](./scripts/rule_inspector.py) |

## 职责

按规则集对报告结构对象做**确定性核查**，产出客观事实。

## 确定性边界

**做**：章节完整性 / 代码 API 使用 / 统计特征（字数 · 图表数 · 代码行数 · 用例数…）/ 查重线索（相似度分值）。

**绝不做**：

- 给分、定档
- 判定抄袭
- 评价「写得好不好」

> 相似度 `0.87` 是**事实**；「抄袭」不是本工具能说的话。

## 规则集：内置默认 + 教师自定义

本项目已定两层结构，按 `ruleId` 合并：

| 层 | 来源 | 说明 |
|---|---|---|
| 默认层 | 项目内置 `default.rules.json`，**开箱可用** | 覆盖计算机实验报告的通用核查项 |
| 教师层 | 教师自定义 `teacher.rules.json` | 同名 `ruleId` **覆盖**默认；新 `ruleId` **追加** |

合并规则（硬约束）：

1. 教师层同名 `ruleId` **覆盖**默认；新 `ruleId` **追加**
2. 教师可将某条默认规则置 `enabled: false` **停用**，但**默认规则文件本身不得被改写**
3. 每条事实必须带 `source: default | teacher`，**不得静默混同**
4. 两层都没覆盖到的检查项，输出到 `notCovered`，**不猜**

### 规则条目结构

```json
{
  "ruleId": "chapter.required",
  "layer": "default",
  "enabled": true,
  "kind": "structure | code | statistics | similarity",
  "params": {},
  "factTemplate": "第 {chapter} 章 {present:存在|缺失}"
}
```

- `kind` 决定核查类别，`params` 是参数，`factTemplate` 只做**事实陈述**，不得含程度与好恶
- 规则条目**不得包含评分逻辑**——打分属于 S3 与 S4

## 输入

| 参数 | 说明 |
|---|---|
| `--report <path>` | T1 产出的结构对象 JSON（**顶层须为对象且含 `blocks` 数组**） |
| `--rules <path>` | 教师层规则集（可选） |
| `--default-rules <path>` | 默认层规则集（可选，缺省用随包内置） |
| `--corpus <dir>` | **查重语料目录**（可选）。**不提供它，`similarity.shingle` 永远进 `notCovered`——查重能力默认不可用** |
| `--out <path>` | 可选；结果写文件，缺省写标准输出 |

### 完整入参样例

```bash
python3 rule_inspector.py --report /abs/path/t1.json \
                          --rules /abs/path/teacher.rules.json \
                          --corpus /abs/path/corpus \
                          --out /abs/path/t2.json
```

## 输出

单个 JSON 对象：

- `facts`：事实列表，每项含 `ruleId` / `fact` / `evidenceAnchor`（取自 T1 坐标）/ `source`
  - 结构类事实若为「存在」，额外带 `matchedHeading` 与 `matchedPattern`——
    命中依据外露，使「这条事实凭什么成立」可被第三方复核
- `notCovered`：未被任何规则覆盖的检查项
- `notCoveredReasons`：`ruleId → 原因`，说明**为什么没覆盖**（未提供 `--corpus` / 报告无标题 等）
- `stats`：统计特征——**由本工具从 `blocks` 自行复算**，不是转述 T1 的 `summary`
- `declaredSummary`：T1 报的 `summary`，仅供对照
- `reportIntegrity`：`{blocksSource, summaryMismatches[], summaryConsistent}`
- `rulesetDigest`：两层规则集的合并摘要与指纹（用于结果可复现）

## 两条硬纪律

### 一、自行复算（不转述）

统计特征一律从 `blocks` 复算；与 T1 的 `summary` **交叉核对**，不一致即判定报告自相矛盾。
理由：`report.json` 一旦被改动或由别处生成，转述型实现会输出**错误事实**且无任何检测手段——
本工具的定位是「确定性核查器」，不是「T1 summary 的转述器」。

### 二、未知优于否定（L1）

`blocks` 里**一个 `heading` 都没有**时，章节存在性**无法判定** → 全部结构规则进 `notCovered`
并在 `notCoveredReasons` 写明原因，**绝不输出「缺失」**。

理由：T1 识别不出标题时，若 T2 照旧断言「六个章节全缺失」，等于把「未识别」扩写成
「学生没写」——违反 `SYSTEM_PROMPT` §1.4 L1 与 §8.1。

### 三、结构规则不串味

一个标题**最多满足一条**结构规则，按**模式长度降序**排他分配。
理由：默认规则集的模式偏宽（`结果` / `分析` / `环境` / `步骤`），不排他时一个「结果分析」标题会
同时满足 `structure.chapter.results` 与 `structure.chapter.analysis`，两条事实都声称「存在」。
排他后归属唯一且可解释（`matchedHeading` + `matchedPattern`）。

## 退出码与失败

| 码 | 含义 |
|---|---|
| 0 | 正常 |
| 1 | 部分规则未覆盖（`notCovered` 非空） |
| 2 | 规则集非法 / 报告不可读或形状非法 / **报告自相矛盾（`blocks` 与 `summary` 不一致）** → 结构化报错，不猜 |

## 依赖与实现约束

- **引擎与规则分离**：换规则集不换代码
- 禁止网络与 AI 调用；纯函数
- 与浏览器端核查器**输出必须完全一致**（1.3 既定判据）→ 同一套实现跨端复用
  ⚠️ **当前不可验证**：本工作区尚无 `web/`，本判据缺对照物
- `main()` 级 `try` 包裹：**任何异常都必须是结构化 JSON + 退出码 2，禁止裸 traceback**

## 对应 Skill

S3 · 证据取证与逐点判定
