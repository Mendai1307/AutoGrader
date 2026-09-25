# T4 · 确定性计算器

| 项 | 内容 |
|---|---|
| Tool ID | T4 |
| 名称 | 确定性计算器（`deterministic-calculator`） |
| 形态 | 命令行脚本，python3，标准输出 JSON |
| 服务于 | S4 总分计算、S7 复核清单生成 |
| 调用方式 | 平台内置 `Bash` 工具调起 |
| 打包落点 | `skills/<skill-name>/scripts/` 首选；或插件根 `bin/` |
| 脚本 | [`scripts/deterministic_calculator.py`](./scripts/deterministic_calculator.py) |
| 契约 | `contract/ReviewResult.schema.json`（字段名以此为唯一真源） |

## 职责

按冻结口径完成全部**纯算术**：部分分总分、`W_r`、上界、等级映射、复核排序键。

## 确定性边界

**做**：

- 部分分总分 `Σ (score / maxScore) × weight`
- `weightIncluded`（已计入权重合计）、`weightExcluded`（= `W_r`）、`upperBound`
- `isPartial`、等级映射
- 复核清单排序键（低置信 × 高出错代价）

**绝不做**：任何语义判断。**所有数字必须由本工具产出，不接受模型口算。**

## 输入

| 参数 | 说明 |
|---|---|
| `--input <path>` | 契约形状的 JSON，**顶层键 `scores[]`**（`--items` 为兼容别名） |
| `--mode <total\|rank>` | 计算总分，或生成复核排序键 |
| `--grade-bands <逗号分隔下界>` | 可选；覆盖等级分段 |
| `--out <path>` | 可选；结果写文件，缺省写标准输出 |

逐项读取字段（与契约逐字一致）：`rubricItemId` / `score` / `maxScore` / `weight` /
`pending` / `confidence` / `needsReview`。

### 完整入参样例（含顶层包裹键）

```json
{
  "scores": [
    {"rubricItemId": "R3", "itemName": "核心代码正确性与规范", "weight": 20,
     "maxScore": 15, "score": 12, "pending": false, "confidence": 0.9,
     "needsReview": false},
    {"rubricItemId": "R5", "itemName": "结果分析与讨论", "weight": 10,
     "maxScore": 10, "score": null, "pending": true, "confidence": 0.55,
     "needsReview": true}
  ]
}
```

- 顶层**必须是对象**，且**必须有 `scores` 数组**（不是 `items`）。形状不符 → 退出码 `1`，结构化报错
- `pending === true` 时 `score` **允许为 `null`**；非 pending 项缺失 `score` → 退出码 `1`
- `confidence`：`--mode total` 不消费它，缺省 `1.0`；
  **`--mode rank` 强制要求每项都给出**（缺任何一项 → 退出码 `1`，结构化报错）。
  不得默认 `1.0`——那会让 `rankKey` 全为 `0`、排序静默退化成 `rubricItemId` 字母序，
  而输出**看起来完全合法**，教师会照着错误的优先级复核
- `errorCost`：**非契约字段**，仅 `--mode rank` 用；缺省取该项 `weight`（出错代价与权重同阶）

## 输出

单个 JSON 对象（`--mode total`）：

- `total`：**部分分（下界）**，= `Σ (score / maxScore) × weight`（仅计入非 `pending` 项）
- `weightIncluded`：已计入权重的项之权重和
- `weightExcluded`：`W_r`，未计入权重合计
- `upperBound`：**`= weightIncluded`（已计入权重合计）** —— ⚠️ **不是 `100 − W_r`**
- `isPartial`：`weightExcluded > 0`
- `grade` / `gradeNote`：等级仅在 `weightExcluded = 0` 且 `weightIncluded = 100` 时映射，否则 `null` 并给出 `gradeNote`
- `detail`：逐项代入值（`rubricItemId` / `score` / `maxScore` / `weight` / `contribution` / `counted`）

`--mode rank`：

- `ranked`：每项含 `rubricItemId` / `confidence` / `errorCost` / `rankKey` / `pending` / `needsReview` / `order`
- `rankFormula`：`(1 - confidence) × errorCost`

## 退出码与失败

| 码 | 含义 | 下游必须怎么做 |
|---|---|---|
| 0 | 正常 | — |
| 1 | 输入缺项或非法（顶层非对象 / 缺 `scores` / 空数组 / `maxScore ≤ 0` / 非 pending 项 `score` 缺失或越界 / **`--mode rank` 缺 `confidence`**） | **结构化报错，不出近似值**；不得静默跳过该项 |
| 2 | 输入文件不可读 / 非法 JSON | 结构化报错，**不得硬猜** |

> **形状不符必须走退出码 1 的结构化报错**，不得抛出未捕获异常，也不得把空输入当成正常输入。

## 依赖与实现约束

- 口径写死，**不得改写**：`Σ (score / maxScore) × weight`
  **不是** `Σ (score × weight / 100)`
- 待复核项（`pending === true`）**不计入**求和，**不做归一化**（归一化会导致复核时总分回撤）
- 权重序列不得改写（和 = 100）：`5/12/5/7/20/10/11/13/7/5/3/2`；
  `maxScore` 由教师自定，不影响占比
- **`upperBound` = 已计入权重合计**。旧式 `100 − W_r` 只在权重和恰为 100 时等价，
  权重和小于 100 时会给出偏大的上界（和 = 60 时返回 100，真实上限 60）
- 纯算术、纯函数；与 T5 的总分复算**共用同一实现**，不得各写一套

## 对应 Skill

S4 · 总分计算｜S7 · 复核清单生成
