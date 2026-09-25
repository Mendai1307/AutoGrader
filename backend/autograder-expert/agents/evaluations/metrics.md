# Evaluation 层 · 指标定义（口径真源）

> **本文件是指标口径的唯一定义处。** 脚本、报告、页面一律**不得自行复述或改写**这些口径，
> 需要引用时指向本文件（理由：同一口径写多遍，日后改一处会漏七处——与 `skills/README.md` §五 同一纪律）。
>
> **上游真源**：契约 `contract/ReviewResult.schema.json`（评价对象的形状）、
> `docs/contract.md` §八（置信度阈值）。
> **同源对照**：v0.1 `frontend/lib/analysis.ts`（MAE 与逐项命中率的口径即出自此处，已逐值复现，见 §六）。

---

## 一、输入（两类，均为外部传入，脚本不内置数据）

| 输入 | 形状 | 来源示例 |
|---|---|---|
| **AI 结果集** | 一个目录，内含若干 `ReviewResult` JSON（文件名以 `_` 开头的视为契约示例，**不计入**） | `web/public/results/` |
| **教师金标准** | 一份 manifest JSON，含 `reports[]`；每份有 `id`、`tier`、`goldTotalScore`、`expectedItemScores[]`（每项含 `rubricItemId` / `itemName` / `level`） | v0.1 `demo/sample-reports/manifest.json` |

两者按 **`ReviewResult.report.reportId` ↔ 金标准 `reports[].id`** 关联。

## 二、可比性规则（先定分母，再算指标）

**逐份状态**（每份金标准报告都要落到一个状态，缺一不可）：

| `status` | 含义 |
|---|---|
| `ok` | 结果文件存在、可解析、形状合法 |
| `invalid` | 结果文件存在但**读不出或形状非法**（缺 `report.reportId` / `totalScore` 非数字 / `scores` 非非空数组） |
| `missing` | 结果目录下**没有** `reportId` 能对上的结果文件 |

**两条不可含糊的规则**：

1. **总分 MAE 只用 `status === 'ok'` 的行**（与 v0.1 `analysis.ts` 一致）
2. **逐项命中率 / 档位一致率 / 置信度校准只用「该份 `ok` 且该项在 AI `scores[]` 与金标准 `expectedItemScores[]` 两侧都有 `level`」的项**

**缺结果或缺标注一律不计入分母**，并逐条列入输出里的 `excluded`
（`missing-result` / `invalid-result` / `unmatched-result-file`）——与 L1「未知优于否定」一致：
分母是「可比对的」，不是「应该是的」。

## 三、四项指标

### 3.1 总分 MAE（方向：越小越好）

```
总分 MAE = (1 / N) × Σ | AI 加权总分_i − 教师金标准分_i |
```

- `N` = `status === 'ok'` 的份数；**保留 2 位小数**（JS 语义 `round2`，half-up）
- 随附：`count`（N）、`maxAbsDelta`、`maxAbsDeltaReportId`、逐份 `delta`（= AI − 金标准，**正值表示 AI 偏松**）

**3.1.1 分组视图 `byTier`（同一公式，按难度档切分）**

- 分组键 = 金标准的 `tier`；**档序取金标准 `reports[]` 中首次出现的次序**（数据驱动，不写死枚举）
- 每档给 `count` / `mae` / `maxAbsDelta` / `maxAbsDeltaReportId`
- **用途**：复现并**主动披露**已公开的项目短板——「低分档报告偏差偏大」
  （v0.1 公布「差档平均绝对误差 8.00 分、单份最大 14.0 分」，本轮已逐值复现，见 §六）
- 它是 **MAE 的细分视图**，不是新增指标口径

### 3.2 逐项命中率（方向：越大越好；12 行明细）

```
逐项命中率(项) = 该项「档位完全一致」的份数 ÷ 该项「可比对」的份数
```

- **命中判据写死**：`AI.scores[].level === 金标准.expectedItemScores[].level`（档位完全一致）
- 逐项输出 `comparable` / `hits` / `rate`（保留 2 位小数）；`comparable === 0` 时 `rate = null`
- **不单独作为回归门禁**：它是 12 行明细，用于**定位**问题，不用于判定

### 3.3 档位一致率（方向：越大越好；总体一个数）

```
档位一致率 = Σ hits ÷ Σ comparable        （求和范围与 3.2 完全相同）
```

- **与逐项命中率同口径**，关系是「**汇总 vs 分项**」：同一个命中判据、同一个可比性规则，
  3.3 是全体的加权汇总，3.2 是逐个评分点拆开
- 脚本输出的 `levelAgreement.note` 会原样写明这层关系，**避免被误读成两个独立口径**

### 3.4 置信度校准（方向：ECE 越小越好）

- **样本** = §二 定义的可比对项（与 3.2 同一批）
- **「判定正确」** = 该项档位与金标准完全一致（与 3.2 同一命中判据）
- **分桶阈值直接取自契约**（`docs/contract.md` §八：`HIGH = 0.80`、`MEDIUM = 0.60`，**不另行发明**）：

  | 桶 | 区间 |
  |---|---|
  | `low` | `confidence < 0.60` |
  | `medium` | `0.60 ≤ confidence < 0.80` |
  | `high` | `confidence ≥ 0.80` |

- 每桶输出：`n`、`meanConfidence`、`accuracy`、`calibrationGap = accuracy − meanConfidence`
  （**正 = 欠自信 / 负 = 过自信**）
- **ECE（期望校准误差）**：

  ```
  ECE = Σ_b ( n_b / N ) × | calibrationGap_b |
  ```

  其中 `N` = 总可比项数（只计入 `n_b > 0` 的桶）。无 `confidence` 的项**不参与**，只计数外露
  （`itemsWithoutConfidence`）。

> ⚠️ **一处刻意的设计**：`calibrationGap_b` 与 `meanConfidence_b` 都用**已展示的 2 位小数**参与 ECE 加权，
> 因此 **ECE 等于表内校准差的加权和，读者可以拿计算器手工复算**。
> 代价是它不等于用全精度中间值算出的 ECE；**可复算优先**——这是本项目的既定取舍。

## 四、输出与退出码

`evaluate.py` 输出（缺省标准输出；`--out` 写文件；`--report` 另出人读 Markdown）：
`rows[]` / `mae` / `itemHitRates[]` / `levelAgreement` / `confidenceCalibration` / `excluded[]` / `skipped[]`。

| 退出码 | 含义 |
|---|---|
| 0 | 全部 `ok`，无排除项 |
| 1 | 有 `missing` / `invalid` 份（**评测仍完成**，但可比样本不全） |
| 2 | 输入不可读 / 非法 |
| 3 | **降级**：金标准缺 `expectedItemScores` → 逐项 / 一致率 / 校准三项**跳过**并列进 `skipped` |

**纯函数**：同一输入 → 逐位相同输出；**不写时间戳 / 主机名 / 随机值**。

## 五、回归门禁（`regression_gate.py`）

比较三项主指标（逐项命中率不单独门禁）：

| 指标 | 方向 | 劣化定义 |
|---|---|---|
| 总分 MAE | 越小越好 | `current > baseline + 容差` |
| 档位一致率 | 越大越好 | `current < baseline − 容差` |
| 置信度校准 ECE | 越小越好 | `current > baseline + 容差` |

- 容差缺省 **0**（严格，按 2 位小数比较），可用 `--tolerance` 放宽
- 退出码：**0 通过 ｜ 1 有劣化 ｜ 2 输入非法 ｜ 3 判定不完整**（基线或本次缺某项指标 → 该指标记 `skipped`）
- **同时存在劣化与 `skipped` 时以 1 为准，但 `skipped` 仍逐条保留**——
  与 T5 的退出码纪律同源：**校验没跑全时，不给「看似终局」的裁决**

## 六、与 v0.1 的一致性复核（独立复现）

用本项目自己的资产（`web/public/results/` 12 份）+ v0.1 的金标准重跑，与 v0.1 已公布数值对照：

| 数字 | v0.1 公布 | 本轮独立复现 | 结论 |
|---|---|---|---|
| 总分 MAE | 3.05 | **3.05** | ✅ 一致 |
| 差档 MAE | 8.00 | **8.0** | ✅ 一致 |
| 单份最大绝对偏差 | 14.0（`sample-04`，差档） | **14.0（`sample-04`，差档）** | ✅ 一致 |

> v0.1 的 README 把差档份数写成「4 份」，而其金标准 manifest 中 `tier = 差` 实为 **3 份**
> （sample-04 / 08 / 12）。**份数口径以金标准数据为准**；MAE 数值不受影响（两处均为 8.00）。

## 七、当前基线

`baselines/2026-09-26.json`（指标）+ `baselines/2026-09-26.report.md`（人读报告）。

**提升基线的动作**：跑出新指标 → 存为 `baselines/<日期>.json` → 在本节登记 →
后续用 `--baseline baselines/<日期>.json` 做门禁比较。**不要覆盖旧基线**（旧基线是回退依据）。
