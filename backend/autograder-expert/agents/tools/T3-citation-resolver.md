# T3 · 引用解析器

| 项 | 内容 |
|---|---|
| Tool ID | T3 |
| 名称 | 引用解析器（`citation-resolver`） |
| 形态 | 命令行脚本，python3，标准输出 JSON |
| 服务于 | S3 证据取证与逐点判定 |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 打包落点 | `skills/<skill-name>/scripts/` 首选；或插件根 `bin/` |
| 脚本 | [`scripts/citation_resolver.py`](./scripts/citation_resolver.py) |

## 职责

把 Expert 给出的候选引用按坐标**还原为逐字原文**，并判定引用是否忠实。

## 为什么必须有它

S3 的铁律是「证据不得改写、不得拼接、不得用类似表述冒充引用」。
**没有本工具，这条纪律只能写在 Prompt 里靠模型自觉；有了它，篡改引用会直接校验失败。**
它把一句道德要求变成可执行的闸门。

## 确定性边界

**做**：校验坐标是否存在；返回该坐标处的逐字原文；比对候选片段与实际原文是否一致。

**绝不做**：

- 判断「哪一段更适合当证据」
- 改写、概括、拼接引用
- 坐标失效时返回「相似段落」顶替

## 输入

| 参数 | 说明 |
|---|---|
| `--report <path>` | T1 产出的结构对象 JSON（顶层键 `blocks`） |
| `--candidates <path>` | 候选引用列表，**顶层键 `items`** |
| `--out <path>` | 可选；结果写文件，缺省写标准输出 |

### 完整入参样例（含顶层包裹键）

```json
{
  "items": [
    {"pointId": "R3", "anchor": "1.2", "quote": "本实验通过 malloc 申请堆内存，验证内存分配行为。"},
    {"pointId": "R5", "blockId": "b00031"},
    {"pointId": "R7", "anchor": "9.9"}
  ]
}
```

- **顶层键必须是 `items`**（不是 `candidates`，也不是裸数组）
- 每条候选给 `anchor`（坐标）、`blockId`（块 id）、`quote`（逐字原文）**之一或以上**
- ⚠️ **`pointId` 对应契约的 `rubricItemId`**。本工具沿用 `pointId` 作为内部中间格式，
  写进 `ReviewResult` 时须改名；完整映射表见 `docs/contract.md` 第 11.2 节

### 出参如何映射进契约的 `evidence[]`

| 本工具输出 | 契约字段 |
|---|---|
| `resolved[].valid` | `evidence[].citationValid` |
| `resolved[].exactText` | `evidence[].quote` |
| `resolved[].blockId` | `evidence[].blockRef.blockId` |
| `resolved[].anchor` | `evidence[].blockRef.anchor` |
| `resolved[].blockDigest` | `evidence[].blockRef.digest` |

**`rejected[]` 里的项不得进入契约的 `evidence[]`**——坐标无效或引用不忠实的证据必须作废。

## 输出

单个 JSON 对象：

- `resolved`：逐条结果，每项含
  - `pointId` / `valid` / `anchor` / `blockId` / `kind`
  - `exactText`：**逐字原文**——给了 `quote` 就是该引文，只给坐标就是该块的 `rawText` 全文
  - `quoteDigest`：**落进契约 `evidence[].quote` 的那段文本**的摘要
  - `blockTextDigest`：整块 `rawText` 的摘要
    （两个摘要都给：引文恰为整块时两者相同，引文为子串时必须不同——否则摘要无法证明引文）
  - `ambiguousHit` / `hitBlockIds`：**只给 `quote` 且命中多个块**时出现
- `rejected`：无效项，每项含 `pointId` / `reason`（+ 触发它的坐标）
  - `anchor-not-found`｜`anchor` 坐标不存在
  - `block-ref-not-found`｜`blockId` 不存在（与上一条分开，字段名才不误导）
  - `quote-mismatch`｜候选片段与原文不一致
  - `no-locator`｜既未给 `anchor` / `blockId`，也未给 `quote`
- `summary`：`{total, valid, rejected, ambiguous}`

**歧义必须报出**：只给 `quote` 而命中多个块时，取 `blockId` 最小者作为**确定解**（可复现），
但必须在结果里标 `ambiguousHit` 与 `hitBlockIds`，并计为「需注意」。

## 退出码与失败

| 码 | 含义 | 下游必须怎么做 |
|---|---|---|
| 0 | 全部有效且无歧义 | 正常进入判定 |
| 1 | 存在无效项，**或存在歧义命中** | 无效项**降置信或标待复核**，不得继续当作有效证据；歧义项须人工确认落点 |
| 2 | 输入不可读 / JSON 非法 / **入参形状不符** | 结构化报错 |

### ✅ 已修复的静默放行缺陷（2026-09-25）

**曾经的行为**：候选文件顶层键若写成 `candidates`（或裸数组），`candidates.get("items") or []`
返回空列表 → 输出 `resolved: []`、`rejected: []`、`summary.total: 0`，且**退出码 0（「全部有效」）**。

**为什么严重**：本工具是「证据不得改写、不得拼接、不得用类似表述冒充引用」这条纪律的**唯一硬闸门**。
形状一偏就**静默放行**——该纪律事实上不成立，而且是**零报错地**不成立。

**现行为**：顶层键不是 `items` 数组时一律 **`exit 2` + 结构化报错**，
报错文本直接给出「缺少顶层键 'items'；实际顶层键为 [...]」。
自测里有一条 `noSilentEmptyPass` 专门守这一点：**形状错与「候选确实为空」必须可区分**
（后者是合法输入，`summary.total = 0` 且退出码 0）。

### 顺带修复

- `--report` 顶层非对象或缺 `blocks` 数组 → `exit 2`，不再裸 traceback
- 逐字比对改用 T1 的 **`rawText`**（此前用 `text`，而 `text` 已被空白规范化）
- 摘要拆成 `quoteDigest` / `blockTextDigest` 两个，覆盖引文本身

## 依赖与实现约束

- 禁止网络与 AI 调用；纯函数
- 逐字比对**不做任何模糊归一化**——不改空白、不改全半角、不忽略标点

## 对应 Skill

S3 · 证据取证与逐点判定
