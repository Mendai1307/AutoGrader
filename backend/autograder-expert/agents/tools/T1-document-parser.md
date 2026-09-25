# T1 · 文档解析器

| 项 | 内容 |
|---|---|
| Tool ID | T1 |
| 名称 | 文档解析器（`document-parser`） |
| 形态 | 命令行脚本，python3，标准输出 JSON |
| 服务于 | S2 报告解析 |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 打包落点 | `skills/<skill-name>/scripts/` 首选；或插件根 `bin/` |
| 脚本 | [`scripts/document_parser.py`](./scripts/document_parser.py) |

## 职责

把实验报告转成**带坐标的结构对象**，为 S3 的取证提供可回链锚点。

## 确定性边界

**做**：章节切分 / 代码块识别 / 图表定位 / 为每个结构单元分配原文坐标（章节号 · 段落序号 · 页）。

**绝不做**：

- 判断内容对错
- 补全缺失内容
- 改写、润色、概括原文
- 把「解析不到」表述为「缺失」

## 两栏文本（`rawText` / `text`）

每个块同时给两栏：

| 栏 | 含义 | 谁用 |
|---|---|---|
| `rawText` | **原文逐字**，未经任何空白规范化（行首缩进、制表符原样保留） | **T3 的逐字比对与摘要**；契约 `evidence[].quote` 应取自这一栏 |
| `text` | 空白规范化后的版本（连续空格 / 制表符合并、首尾去空白） | 统计特征、关键词匹配、T2 的结构与相似度核查 |

**为什么必须分两栏**：T3 承诺「逐字比对**不做任何模糊归一化**」，
但若 T1 在交给 T3 之前就已把空白改掉，那条承诺在源头就失效了——
第三方拿源文件复算必然不等。

## DOCX 标题识别

真实 DOCX 有**两种互不相干的标题标记方式**，只认其中一种会全盘漏检：

| # | 触发来源 | 标记方式 | 判定依据 |
|---|---|---|---|
| 1 | `tencent-local-office-edit` 等生成器产出的 docx | **全部段落无 `w:pStyle`**，标题只由段落级 `w:outlineLvl`（0/1…）标记 | 段落级 `w:outlineLvl` |
| 2 | 真实 Word 文件 | `w:pStyle` 的 `val` 是**数字 styleId**（如 `1`/`2`），真名在 `word/styles.xml` 里是 `heading 1`/`heading 2` | 解析 `styles.xml` 建 `styleId → 样式名` 映射后再匹配 |

判定顺序（`docx_heading_level()`）：

1. **段落级** `w:outlineLvl`——`0–8` → 标题级别 `1–9`；**`9` 表示正文，不算标题**
2. **样式级** `w:outlineLvl`（经 `w:pStyle` 查 `styles.xml`，沿 `w:basedOn` 有界上溯）
3. **样式名**匹配 `heading N` / `标题 N` / `標題 N`（兼容全角空格与无空格写法）

`Title`（文档大标题）与 `List Bullet` 等**不算章节标题**；`TOC 标题N`（`outlineLvl=9`）同样不算。

### ⚠️ 静默失败闸门（必须保留）

**正文非空但一个标题都没识别出来时，必须写入 `failures` 并降级 `status`**，禁止报 `ok`。

理由：一旦报 ok，下游 T2 会把「标题识别失败」扩写成「六个章节**全部缺失**」——
这是**主动的否定断言**，违反 `SYSTEM_PROMPT` §1.4 L1「未知优于否定」与
`S2-report-parser.md` 规则 3。规格自己预判过这个场景（S2「常见失败场景」：
「章节标题识别错误，导致下游所有取证定位整体偏移——**这种情况不会报错，最危险**」）。

## 输入

| 参数 | 说明 |
|---|---|
| `--input <path>` | 待解析文件（docx / pdf / md / txt），**须真实存在** |
| `--stdin` | 从标准输入读纯文本 |
| `--format <ext>` | 可选；覆盖按扩展名推断的格式 |
| `--out <path>` | 可选；结果写文件，缺省写标准输出 |

### 完整入参样例

```bash
python3 document_parser.py --input "/abs/path/report.docx" --out "/abs/path/t1.json"
python3 document_parser.py --stdin --format md
```

## 输出

单个 JSON 对象：

- `status`：`ok` | `partial` | `failed`
- `structure`：章节树，节点含 `id` / `title` / `level` / `children`
- `blocks`：块列表，每项含 `blockId` / `kind` / `anchor` / `page` / **`rawText`** / **`text`**
  - `kind` 取值：`heading` | `text` | `code` | `figure` | `table` | `formula`
  - **标题本身也是一个块**（`heading`），带自己的坐标，可被引用、也可被 T2 的结构核查定位
- `failures`：解析失败位置清单，每项含 `reason` / `anchorIfAny`
  - `structure-not-recognized`｜有正文但未识别到任何标题（章节存在性**无法判定**）
- `sourceFile`：输入文件路径 + 内容摘要指纹
- `summary`：统计特征（`blockCount` / `textChars` / `codeBlocks` / `codeLines` / `figures` /
  `tables` / `testCases` / `headings`）。**全部可由 `blocks` 复算**——T2 会自行复算并交叉核对
- `emptyHeadingParagraphs`：**有标题样式但无文字**的段落数。这类段落既不入 `structure` 也不入
  `blocks`（无文字可引用），但计数外露以免「静默丢弃」；正常文件为 `0`

> ⚠️ `summary.headings` 与 `structure` 里的标题节点数**必须相等**（空标题段已排除），
> 否则 T2 的交叉核对会误报不一致。

## 退出码与失败

| 码 | 含义 | 下游必须怎么做 |
|---|---|---|
| 0 | 全部解析成功 | 正常进入取证 |
| 1 | 部分成功（`failures` 非空，含 `structure-not-recognized`） | 把未解析位置当**未知**处理，**不得当缺失** |
| 2 | 输入不可读 / 不存在，或完全失败（如无文字层的扫描件、不支持的扩展名） | 结构化报错，**不得硬猜内容** |

## 依赖与实现约束

- 禁止任何网络调用与 AI 调用
- 纯函数：同一输入文件 → 逐位相同的输出（时间戳等易变字段须可关闭）
- 脚本以**绝对路径**调用，不依赖当前工作目录
- `main()` 级 `try` 包裹 `run()`：**任何异常都必须是结构化 JSON + 退出码 2，禁止裸 traceback**
- **PDF 抽取同时匹配 `Tj`（单串）与 `TJ`（数组）两种文本算子**——只认 `Tj` 会让现代 PDF 全部抽不到，
  且失败信息会被误报为「无文字层（可能为扫描件）」，属归因错误

## 对应 Skill

S2 · 报告解析
