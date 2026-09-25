# AutoGrader Expert · Tools 索引

> 本目录是「AutoGrader Expert」专家智能体包的 **Tools 层**。
> **工具只负责确定性能力；推理与判断由 Expert 的 Skills 完成。**
> 共 6 个工具，均为 **python3 命令行脚本，标准输出 JSON**。

---

## 一、Tool 与 Skill 的分界判据

**三条判据——全中才算 Tool：**

1. **同输入必得同输出**：无随机性、无模型参与、不受时间与环境影响
2. **可被第三方复算**：把输入重跑一遍，得到逐位相同的结果
3. **输出里不出现形容词**：只出事实（「第 3 章缺失」「权重和 = 98」「坐标失效」），不出程度与好恶

**一条反向判据——满足即必须留在 Skill：**

4. 需要「要不要 / 够不够 / 好不好」的取舍——哪怕能写成规则，也不做成 Tool

**两条硬约束：**

- 工具**不得调用任何 AI**（不依赖第三方 AI API，亦不调用平台模型）
- 工具**可以执行教师明文给定的规则，但不得自行引入规则**——规则是数据，工具只是引擎

### 做成 Tool 就会出错的反例

| 反例 | 为什么不能做 |
|---|---|
| 智能评分器：丢进 Rubric + 报告，出分数 | 档位落点依赖语义理解，属推理 |
| 证据充分性判定器：判断「够不够支撑这一档」 | 「够不够」是权衡，不是计算 |
| 相似度 → 抄袭认定器 | 工具能给相似度事实；「认定」是教师的裁决 |
| 评语生成器 | 生成是 AI 能力，不是确定性能力 |
| 章节质量评估器 | 「写得好不好」没有确定性答案 |

---

## 二、目录结构

```
agents/tools/
├── README.md                  # 本文件：索引 + 统一契约 + 判据
├── T1-document-parser.md      # 工具规格（接口与边界）
├── T2-rule-inspector.md
├── T3-citation-resolver.md
├── T4-deterministic-calculator.md
├── T5-contract-validator.md
├── T6-asset-store.md
├── rules/
│   └── default.rules.json     # 内置默认规则集（T2 使用，只读）
└── scripts/
    ├── document_parser.py            # T1
    ├── rule_inspector.py             # T2
    ├── citation_resolver.py          # T3
    ├── deterministic_calculator.py   # T4
    ├── contract_validator.py         # T5
    └── asset_store.py                # T6
```

---

## 三、工具索引

| ID | 工具 | 一句话职责 | 服务于 | 规格 | 脚本 |
|---|---|---|---|---|---|
| T1 | 文档解析器 | 把报告变成「带坐标的结构」 | S2 | [T1](./T1-document-parser.md) | `scripts/document_parser.py` |
| T2 | 客观核查器 | 按规则集产出客观事实，不下结论 | S3 | [T2](./T2-rule-inspector.md) | `scripts/rule_inspector.py` |
| T3 | 引用解析器 | 按坐标还原逐字原文，把「证据忠实」变成硬校验 | S3 | [T3](./T3-citation-resolver.md) | `scripts/citation_resolver.py` |
| T4 | 确定性计算器 | 总分 / `W_r` / 等级 / 复核排序键的纯算术 | S4、S7 | [T4](./T4-deterministic-calculator.md) | `scripts/deterministic_calculator.py` |
| T5 | 契约校验器 | schema + 权重和 + 档位区间 + 总分复算 + 指纹复算 | S1、S5 | [T5](./T5-contract-validator.md) | `scripts/contract_validator.py` |
| T6 | 资产库 | 样板库 / Rubric / 样例 / 金标准的确定性检索与存取 | S0、S1 | [T6](./T6-asset-store.md) | `scripts/asset_store.py` |

### 服务矩阵

| Tool ＼ Skill | S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| T1 文档解析器 | | | ● | | | | | |
| T2 客观核查器 | | | | ● | | | | |
| T3 引用解析器 | | | | ● | | | | |
| T4 确定性计算器 | | | | | ● | | | ● |
| T5 契约校验器 | | ● | | | | ● | | |
| T6 资产库 | ● | ● | | | | | | |

**S6 评语生成不依赖任何工具**——这不是遗漏。它说明这套工具集的性质：
工具只负责「事实」，而写评语不产生事实，只产生表达。工具链上唯一空着的那格，就是纯 AI 的位置。

---

## 四、统一 CLI 契约

| 约定 | 内容 |
|---|---|
| 语言 | python3（仅标准库，**不引入任何第三方包**） |
| 入参 | 一律用 `--key value`；需要时支持 `--stdin` |
| 出参 | **单个 JSON 对象写标准输出**；诊断信息一律走标准错误 |
| 路径 | 调用时用**绝对路径**，脚本不依赖当前工作目录 |
| 纯函数 | 同一输入 → 逐位相同输出（排序稳定；不写时间戳、不写主机名、不写随机值） |
| 网络 | **禁止任何网络调用** |
| AI | **禁止任何 AI 调用** |

### 退出码（全局约定）

| 码 | 含义 | 下游必须怎么做 |
|---|---|---|
| 0 | 正常 | — |
| 1 | 可继续但需注意（部分失败 / 未命中 / 部分规则未覆盖） | 按各工具规格处理，**不得静默忽略** |
| 2 | 输入不可读或非法 | 结构化报错，**不得硬猜** |
| 3 | 降级运行（部分校验因依赖缺失被跳过） | **CI 门禁中视为不通过** |

---

## 五、规则集：内置默认 + 教师自定义

T2 的核查行为由**规则集数据**驱动，引擎与规则分离（换规则集不换代码）。

| 层 | 文件 | 说明 |
|---|---|---|
| 默认层 | `rules/default.rules.json`（随包内置，**只读**） | 覆盖计算机实验报告的通用核查项，开箱可用 |
| 教师层 | 教师自定义（`--rules` 传入） | 按 `ruleId` 覆盖或追加 |

**合并规则（硬约束）：**

1. 教师层同名 `ruleId` **覆盖**默认；新 `ruleId` **追加**
2. 教师可将某条默认规则置 `enabled: false` **停用**，但**默认规则文件本身不得被改写**
3. 每条事实必须带 `source: default | teacher`，**不得静默混同**
4. 两层都未覆盖的检查项进 `notCovered`，**不猜**
5. 规则条目**不得包含评分逻辑**——打分属于 S3 与 S4

---

## 六、平台封装映射（打包时必须做）

平台**不存在「开发者注册工具」通道**——官方明文：「开发者不可自行添加 tools：所有工具权限由系统统一分配」。
本目录是**开发期的暂存落点**，打包时按平台规则映射：

| 本目录 | 打包后落点 |
|---|---|
| `scripts/<tool>.py` | `skills/<skill-name>/scripts/<tool>.py`（首选）；或插件根 `bin/` |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 工具声明 | **不得在 `agent.md` 的 frontmatter 声明 `tools:` 字段**（校验器判为硬错误） |

---

## 七、冻结状态与随包契约

**契约层随包位置**（工作区根，与本目录平级关系见 `docs/contract.md` 第一节）：

```
contract/
├── ReviewResult.schema.json   # 评阅结果契约（T5 --kind review-result 用）
├── Rubric.schema.json         # 评分量规契约（T5 --kind rubric 用）
├── fingerprint.py             # 指纹算法（Python 侧）
└── fingerprint.mjs            # 同一算法的 JS 侧对照实现（前端复算用）
```

| 依赖 | 影响 | 状态 |
|---|---|---|
| `ReviewResult` / `Rubric` schema | T5 的结构校验、T6 的 Rubric 读写 | ✅ **已冻结**（1.1.0，2026-09-25；路径 0.1 闭合） |
| 指纹算法 | T5 的指纹复算 | ✅ **已冻结**（`contract/fingerprint.py`；路径 0.3 闭合） |
| 权重序列（和 = 100）`5/12/5/7/20/10/11/13/7/5/3/2` | T4 总分口径 | ✅ 已冻结 |
| 随包资产根 `agents/tools/assets/` 及四类资产内容 | T6 的 `--store` 缺省值与全部 `list` / `get` | ⬜ **未建立**。脚本已实现；资产内容落位后即可开箱可用。**在此之前所有 `list` 调用会以退出码 2 明确报「资产未随包」**（这是刻意的：不得被读成「库里没有」） |

**T5 的降级行为**：`--schema` 与 `--fingerprint-algo` **缺省自随包 `contract/` 目录解析**
（自脚本位置向上逐级查找）。契约已冻结，**正常情况下不再出现降级态**；
一旦解析不到，对应校验记为 `skipped` 并**以退出码 3 降级返回**，CI 中视为不通过——
宁可显式降级，也不假装通过。

## 八、入参形状防御（六脚本统一，2026-09-25）

**统一规则**：形状不符一律 `exit 2` + 结构化 JSON 报错，`main()` 级 `try` 包裹 `run()`，
**禁止裸 traceback**。形状错与「查询确实没有结果」必须可区分。

| 脚本 | 入参形状要求 | 形状不符的表现 |
|---|---|---|
| T1 | `--input` 指向真实存在且扩展名受支持的文件 | exit 2（此前：`FileNotFoundError` 裸 traceback） |
| T2 | `--report` 顶层为对象且含 `blocks` 数组；`--corpus` 目录可读 | exit 2（此前：裸 traceback） |
| T3 | `--candidates` 顶层键为 `items` 数组；`--report` 含 `blocks` | exit 2（此前：**静默返回全空 + 退出码 0**） |
| T4 | 顶层为对象且含 `scores` 数组 | exit 1（此前：裸 `AttributeError` / 空输入报成功） |
| T5 | 顶层为对象；schema 关键字必须在支持的子集内 | exit 2（此前：schema 未知关键字静默跳过） |
| T6 | `--id` 无路径成分；写入源扩展名在 `.json` / `.md` 内 | exit 2 |

**T3 的静默放行缺陷已修复**：入参顶层键写成 `candidates` 时，此前会输出
`resolved: []` / `rejected: []` / `summary.total: 0` 且**退出码 0（「全部有效」）**——
而 T3 是「证据不得改写」的唯一硬闸门，形状一偏就静默放行。现改为 `exit 2`，
自测中有 `noSilentEmptyPass` 专门守这一点。

## 九、解释器名：`python3` 优先，`python` 回退

六份脚本的 docstring 与本文档示例均写 `python3 xxx.py`。**2026-09-25 实测**：
本机 Bash 环境中 `python3` 可用（随包运行时 `~/.workbuddy/binaries/python/versions/3.13.12/` 在 PATH 上）。

但 `python3` 的存在性依赖宿主环境（Windows 上部分环境只有 `python` / `py`）。
**调用约定**：优先 `python3`；若报 `command not found`，改用 `python`。
两者的标准库与行为一致，脚本不依赖任何第三方包。
