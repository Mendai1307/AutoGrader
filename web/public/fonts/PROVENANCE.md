# MiSans 字体子集 · 来源与许可

本目录下的字体文件是 **MiSans** 的**按需子集**，不是完整字体包。此文件说明它们的来历、
裁剪口径与复现方式。

---

## 一、来源

| 项 | 值 |
|---|---|
| 字体 | MiSans |
| 出品 | 北京小米移动软件有限公司（Beijing Xiaomi Mobile Software Co., Ltd.）与汉仪字库 |
| 分发包 | npm `misans-webfont` |
| 包版本 | 4.3.1（其 `package.json` 内声明为 4.003.1） |
| 源字体版本 | Version 4.003 |
| 版权声明 | `Copyright © 2020-2023 Beijing Xiaomi Mobile Software Co.,Ltd. All Rights Reserved.` |
| 授权 | MiSans 为小米官方免费商用字体，使用需保留版权与许可说明（即本文件） |

上游包以 `cn-font-split` 切分为 **10 个字重 × 每个约 188 个 unicode-range 分片**，
tarball 体积 **113 MB**。本项目只取其中四档、并按站点字符集裁剪。

---

## 二、裁剪口径

**为什么必须裁剪**：四档全量入库是 24.4 MB，对一个静态站与一个参赛仓库都过重。

**取哪四档**（对应上游目录 → 我们声明的 CSS 字重）：

| 上游目录 | 声明字重 | 用途 |
|---|---|---|
| `misans-light` | 300 | 大号辅助文字、弱化层级 |
| `misans-regular` | 400 | 正文 |
| `misans-demibold` | 600 | 小标题、强调 |
| `misans-bold` | 700 | 页面主标题 |

**选哪些分片**：字符集口径 = **GB2312 可编码的全部码位 ∪ 站点实际内容字符 ∪ 常用标点区
（U+2000–206F、U+3000–303F）**，取与该集合相交的全部分片。

结果：**四档合计 56 / 56 / 56 / 57 个分片，225 个 woff2 文件，约 5.3 MB**。
GB2312 的 7541 个码位因此全部可渲染；落在集合外的生僻字与 emoji 会回退到后备字体栈
（`PingFang SC` / `Microsoft YaHei` / `system-ui`），属预期行为。

> 构建期由 `scripts/check-fonts.mjs` 复核：`public/` 下**会被逐字渲染**的数据资产，
> 其中每一个字符都必须被覆盖，否则构建失败。这条防止"新文案引入了子集外的字"这类掉字事故。

---

## 三、上游包的两处缺陷（本产物已修正）

裁剪脚本不只做拷贝，还修掉了上游生成 CSS 的两个问题 —— 不修则四档字重形同虚设：

1. **`font-weight` 全写成 400**（仅 `bold` 是 700），且四个字重的 `font-family`
   各不相同（`MiSans Light` / `MiSans` / `MiSans Demibold`）。
   若不修正，600 字重只会由 400 字面**合成**出来，字重层次丢失。
   → 产物统一为 `font-family:"MiSans"` + 显式 `font-weight: 300 / 400 / 600 / 700`。

2. **`src` 带 `local("MiSans …")`**，会让**本机已装的 MiSans 覆盖固定版本**，
   导致不同机器渲染不一致。
   → 产物剥离 `local()`。

---

## 四、如何复现

裁剪脚本：`web/scripts/sync_fonts.py`（开发期工具，**构建时不需要**）。

```bash
# 1) 取一份上游包（选择一个）：
npm pack misans-webfont@4.3.1          # 得到 .tgz，解包到某目录
# 或： npm install -D misans-webfont && 用 node_modules/misans-webfont

# 2) 生成子集（--from 指向解包后的包目录，其中应含 package.json 与 misans/）：
cd web
python3 scripts/sync_fonts.py --from <解包目录>
python3 scripts/sync_fonts.py --from <解包目录> --dry-run   # 只测算不写盘
python3 scripts/sync_fonts.py --from <解包目录> --prune     # 额外清理残留分片
```

脚本是**非破坏性**的：只写不删，残留文件默认只报告（要清理须显式 `--prune`）。
这与本项目 `build_expert.py` 的结论一致 —— 装配/同步类脚本不应具备破坏性。

产物：

```
public/fonts/
├── misans.css          统一的 @font-face 表（url() 为相对路径，故与部署子路径无关）
├── SUBSET.json         子集清单：来源版本、四档分片号、字符集口径、聚合摘要
├── misans/<字重>/<n>.woff2
└── PROVENANCE.md       本文件
```

`SUBSET.json` 里的 `aggregateDigest` 是对全部分片（路径 + sha256）的聚合摘要，
构建期由 `check-fonts.mjs` 复核 —— 有人手改分片而没重新生成清单时会立刻报错。

---

## 五、引用方式

字体通过 `app/layout.tsx` 里的一个 `<link rel="stylesheet">` 引入（href 拼接部署子路径）。
样式表内部所有 `url()` 都是**相对路径**（`./misans/300/12.woff2`），因此无论在根路径还是
GitHub Pages 项目子路径下都能正确解析，无需在 CSS 里感知 basePath。
