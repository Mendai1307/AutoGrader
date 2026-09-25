# S5 · 结构装配与自检

| 项 | 内容 |
|---|---|
| Skill ID | S5 |
| 所属任务链 | 横向 · 覆盖流程 B 全链 |
| 对内 Agent | Reviewer（AI 自检） |
| 对外名称 | —（不对教师暴露） |
| 依赖 Tool | **T5 契约校验器**（其 `total.recompute` 复用 T4、`fingerprint.recompute` 复用 `contract/fingerprint.py`） |

## 目标

把上一步产出装配成合规的 `ReviewResult`，并做自校验自修复，
保证「每次都产出合规 JSON」。

## 输入

- S1 / S3 / S4 / S6 任一环节的产出

## 输出

- 通过校验的 `ReviewResult`
- 或：限定轮次后仍失败时，输出「结构化失败 + 待人工」标记

## 执行规则

1. **骨架先行**：先固定输出结构，再填内容，杜绝结构漂移。
2. **六项校验**（T5 实际执行的就是这六项，不是笼统的「三重」）：
   ① `schema.structure` ② `weights.sum` ③ `band.levels`
   ④ `evidence.present` ⑤ `total.recompute` ⑥ `fingerprint.recompute`。
   **任一失败即整体失败**（fail-fast）。
   校验结论写进契约的 `selfCheck` 字段：`{schema, recompute, fingerprint, skipped[], errors[]}`，
   状态值取 `pass` / `fail` / `skipped`。
3. 失败后按错误清单重试，**限定轮次**；仍失败标记「待人工」，
   **不得降级放行**。
   ⚠️ **`skipped` 非空即视为不通过**（退出码 3，CI 同样不通过）——宁可显式降级，也不假装通过。
4. 校验的是**合规性**，不是判断对不对——**不得改写任何判断内容**。
5. 教师看不到自检过程与重试记录（不暴露过程性解释）。
6. **但 AI 建议分与教师终值的差异数据必须保留**——这是评测层复算总分 MAE 与
   逐项命中率的唯一数据源，**不属于**「过程性解释」。
7. **`clues[]` 与 `errors[]` 分开对待**：T5 的 `clues`（如档位四档不齐、判据用词含糊）
   是**线索不是错误**，不阻塞交付，但须转交 S7 / 提示教师。

## 常见失败场景

- 重试时顺手改了评分内容（越界）。
- 无限重试，耗尽预算。
- 校验失败后仍输出半成品。
- 把「校验通过」当成「判断正确」。
- 误把「差异留痕」也当成要清理的过程性信息一并删除，导致评测层断源。
- 只记「三重校验」而不看 `skipped`，把降级运行当成通过。
- 把 T5 的 `clues` 当成错误反复重试，或反过来把 `clues` 直接当结论。

## 依赖关系

- 前置：S1 / S3 / S4 / S6
- 后置：无（校验通过即为可交付）
- **被 S1 / S3 / S4 / S6 共同依赖**
- 依赖 Tool：契约校验器（T5）；六项检查中 `total.recompute` 复用 T4、`fingerprint.recompute` 复用
  `contract/fingerprint.py`
