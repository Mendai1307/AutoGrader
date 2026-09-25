# Tools 层 · 随包资产根

> 本目录是 T6 资产库（`scripts/asset_store.py`）的**缺省资产根**（`--store` 的缺省值 = 本目录）。
> 四类资产按 `kind` 分目录存放。

```
assets/
├── README.md      # 本文件（在资产根，不在任何 kind 目录内 → T6 不会把它当资产列出）
├── template/      # 样板库（只读）—— S1 建标的起点
├── rubric/        # 教师已保存的 Rubric（可读可写）—— 初始为空
├── sample/        # 样例报告库（只读）—— 演示与回归用
└── gold/          # 教师金标准（只读）—— Evaluation 层对照用
```

## 一、四类资产

| `kind` | 读写 | 现状 | 内容 |
|---|---|---|---|
| `template` | **只读** | **1 份** | `rubric-cs-lab-report-generic.json` —— 高校计算机专业实验报告通用 Rubric（R1–R12，权重和 = 100，档位模型为 `levels[]{level,label,criterion,scoreRatio}`） |
| `rubric` | **可读可写** | **空**（仅 `.gitkeep`） | 教师自己保存的 Rubric。T6 的 `--op put` 只允许写这一类 |
| `sample` | **只读** | **12 份** | `sample-01.md` … `sample-12.md` —— 合成脱敏样例报告（优 / 良 / 中 / 差 各 3 份） |
| `gold` | **只读** | **1 份** | `manifest.json` —— 教师金标准：12 份报告的 `goldTotalScore` 与逐项 `expectedItemScores[].level` |

**来源透明**：以上内容全部复制自上一轮（v0.1）仓库的 `demo/` 目录，**逐字节一致**
（已用 SHA-256 摘要核对），本轮**未改动**其中任何一个字节。

## 二、怎么用（可复算）

```bash
cd backend/autograder-expert/agents/tools/scripts

python3 asset_store.py --op list --kind template          # → 1 项，退出码 0
python3 asset_store.py --op list --kind sample            # → 12 项，退出码 0
python3 asset_store.py --op list --kind gold              # → 1 项，退出码 0
python3 asset_store.py --op list --kind rubric            # → 0 项，退出码 1（未命中）
python3 asset_store.py --op get  --kind template --id rubric-cs-lab-report-generic
```

### ⚠️ `rubric` 返回退出码 1 是**正确语义**，不是缺陷

按 `T6-asset-store.md` 的约定：**「目录不存在」→ 退出码 2（资产未随包）**，
**「目录存在但查询未命中」→ 退出码 1**。`rubric/` 目录存在而内容为空 →
「教师还没保存过自己的 Rubric」，故返回 **1**。
**绝不能**把它读成「资产没装好」——那会走错 S1 的分支（这正是 P2-22 当初修掉的问题）。

## 三、两条已知限制（如实记录，属设计约束而非缺陷）

1. **样板不能带 `tags`**：T6 的 `list --tag` 过滤读的是文件里的 `meta.tags` 或顶层 `tags` 字段，
   而样板是**契约形状的 Rubric**（`additionalProperties: false`，只允许 `id` / `version` / `title` / `items`），
   **不能塞额外字段**。因此样板的 `tags` 恒为空数组，`--tag` 过滤对 `template` 无效
   —— 过滤只能靠 `--contains` 做精确子串匹配。要按标签组织样板，需要先扩展契约（**未做**）。
2. **`gold/manifest.json` 的 `title` 取自文件名**：该 manifest 没有顶层 `title` 字段，
   T6 于是回落到文件主干名（列表里显示为 `manifest`）。这是 T6 的既定回落行为，不是解析失败。

## 四、维护纪律

- `template` / `sample` / `gold` 三类**只读**：新增资产＝**丢文件进对应目录**，不修改既有文件
- `rubric/` 由教师的 `--op put` 写入；T6 只接受 `.json` / `.md`，且 `--id` 不得含路径成分
- 新增样板请遵循契约形状（见 `contract/Rubric.schema.json`），否则 S1 与 T5 会在后续环节拦下它
- 本目录已随专家包打进 `bin/assets/`（见打包映射说明），平台侧由内置 `Bash` 以**绝对路径**调用
