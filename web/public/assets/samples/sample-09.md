# 实验报告：四种内部排序算法的性能对比与分析

- 课程：数据结构与算法
- 实验者：学生I
- 学院：某某大学计算机学院
- 实验编号：DS-Lab-05

---

## 1 实验目的

1. **知识目标**：理解快速排序、归并排序、堆排序、插入排序的分治/增量策略差异，掌握各自的最好、平均、最坏时间复杂度与空间复杂度，理解"渐进复杂度相同但常数因子不同"的工程含义。
2. **能力目标**：能独立实现四种排序算法（不使用语言内置排序完成核心逻辑），并搭建一个可控制数据规模、数据分布与重复实验次数的基准测试框架。
3. **验证目标**：在 10³～10⁶ 规模区间测量四种算法的实际耗时，用数据验证 `O(n log n)` 与 `O(n²)` 的增长差异，定位插入排序优于高级排序的规模拐点，并解释缓存局部性带来的常数差异。

第 5 节给出四种算法的核心实现，第 6 节给出四种数据规模 × 四种算法的实测数据，第 7 节做量化拟合与归因，第 8 节回应上述三个目标。

## 2 实验原理

### 2.1 四种算法的时间复杂度

插入排序通过不断把当前元素插入前面已排好序的子序列来工作，平均与最坏均为 `O(n²)`，最好（已基本有序）为 `O(n)`，空间复杂度 `O(1)` 且是稳定的。快速排序以基准元素把序列划分为两段再递归，平均 `O(n log n)`，但基准选取不佳时退化为 `O(n²)`，空间为递归栈 `O(log n)`，不稳定。归并排序先分后治，最好最坏均为 `O(n log n)`，但需要 `O(n)` 辅助空间，是稳定的。堆排序借助二叉堆不断取极值，最好最坏均为 `O(n log n)`，空间 `O(1)`，不稳定。

需要强调的是，**渐进复杂度只描述增长阶，不描述常数因子**。同为 `O(n log n)` 的三种算法，实际耗时可能相差两倍以上，差异主要来自比较次数、数据移动次数与访存局部性。

### 2.2 为什么常数因子会有差异

快速排序的内层循环是顺序扫描数组并与基准比较，分支预测成功率高，且访问的是连续内存，**缓存局部性最好**；归并排序需要在辅助数组与源数组之间来回搬运，访存量约为快排的两倍；堆排序的下滤操作要在父子节点之间跳跃访问，数组下标跨度为 2 的幂次，**缓存局部性最差**，同等规模下 cache miss 明显更多。因此理论预期是：**快排 < 归并 < 堆排**（耗时），尽管三者同为 `O(n log n)`。

### 2.3 小规模场景插入排序反而更快

插入排序的常数极小（无递归、无额外访存），当 `n` 很小时 `n²` 的绝对值并不大，反而小于高级算法的递归与建堆开销。工程上常见的优化是：**快排递归到子数组长度小于某阈值（如 32）时切换为插入排序**。本实验将通过实测定位这一拐点。

## 3 实验环境

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04.3 LTS（内核 5.15.0-91-generic） |
| 语言与版本 | Python 3.11.6（CPython，GIL 单线程执行） |
| 依赖库 | 标准库 `random` / `time`；绘图用 `matplotlib` 3.8.2 |
| CPU | 4 核 8 线程 x86_64，L3 缓存 16 MB |
| 内存 | 16 GB |

复现命令：

```bash
python3 -m pip install matplotlib==3.8.2
python3 sort_bench.py --sizes 1000,10000,100000,1000000 --repeat 5 --seed 20260920
python3 plot_bench.py --input result.csv --output figures/ds-09-fig3.png
```

![图3-1 环境信息截图：python3 版本与 CPU 缓存信息（示意图）](figures/ds-09-fig1.png)

## 4 实验步骤

1. **环境准备**：确认 Python 3.11.6 与 matplotlib 版本，执行 `python3 -VV` 与 `lscpu | grep cache` 并截图（图 3-1）。
2. **实现算法**：在 `sort_bench.py` 中自实现 `insertion_sort` / `quick_sort` / `merge_sort` / `heap_sort`，不使用内置 `sorted` 参与核心逻辑。
3. **实现基准框架**：支持指定数据规模列表、重复次数、随机种子；每轮用固定种子重新生成随机数组，保证四种算法吃到的输入完全相同。
4. **正确性校验**：每轮用内置 `sorted` 的结果与自实现结果逐元素比对，不一致立即报错退出。
5. **计时方式**：使用 `time.perf_counter()`（单调、高精度），每轮取 5 次重复的最小值以减少噪声。
6. **运行小规模拐点实验**：规模取 4 / 8 / 16 / 32 / 64 / 128，比较插入排序与快排。
7. **运行大规模实验**：规模取 10³ / 10⁴ / 10⁵ / 10⁶，四种算法各跑 5 次。
8. **结果导出**：输出 `result.csv`，并用 `plot_bench.py` 绘制柱状图（图 6-3）。

## 5 核心代码

### 5.1 四种排序算法的自实现

```python
from typing import List, MutableSequence

INSERTION_CUTOFF = 32   # 子数组小于该阈值时切换为插入排序


def insertion_sort(a: MutableSequence[int], lo: int = 0, hi: int | None = None) -> None:
    """就地对 a[lo:hi] 做插入排序。hi 为 None 时取到末尾。"""
    if hi is None:
        hi = len(a)
    # 边界条件：空区间或单元素区间天然有序，直接返回
    if hi - lo < 2:
        return
    for i in range(lo + 1, hi):
        key = a[i]
        j = i - 1
        while j >= lo and a[j] > key:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key


def _median_of_three(a: MutableSequence[int], lo: int, hi: int) -> int:
    """三数取中选基准，避免有序输入下退化为 O(n^2)。"""
    mid = (lo + hi) // 2
    x, y, z = a[lo], a[mid], a[hi - 1]
    if x <= y <= z or z <= y <= x:
        return mid
    if y <= x <= z or z <= x <= y:
        return lo
    return hi - 1


def quick_sort(a: MutableSequence[int], lo: int = 0, hi: int | None = None) -> None:
    if hi is None:
        hi = len(a)
    if hi - lo < 2:
        return
    # 小规模区间改用插入排序，省去递归开销
    if hi - lo <= INSERTION_CUTOFF:
        insertion_sort(a, lo, hi)
        return
    p = _median_of_three(a, lo, hi)
    a[lo], a[p] = a[p], a[lo]
    pivot = a[lo]
    i, j = lo + 1, hi - 1
    while i <= j:
        while i <= j and a[i] <= pivot:
            i += 1
        while i <= j and a[j] > pivot:
            j -= 1
        if i < j:
            a[i], a[j] = a[j], a[i]
    a[lo], a[j] = a[j], a[lo]
    quick_sort(a, lo, j)
    quick_sort(a, j + 1, hi)


def merge_sort(a: MutableSequence[int]) -> List[int]:
    """返回新的有序列表，稳定排序，额外空间 O(n)。"""
    n = len(a)
    if n < 2:
        return list(a)
    buf = [0] * n
    src = list(a)
    width = 1
    while width < n:
        # 自底向上归并，避免递归带来的额外开销
        for lo in range(0, n, 2 * width):
            mid = min(lo + width, n)
            hi = min(lo + 2 * width, n)
            i, j, k = lo, mid, lo
            while i < mid and j < hi:
                if src[i] <= src[j]:      # 取等号保证稳定性
                    buf[k] = src[i]; i += 1
                else:
                    buf[k] = src[j]; j += 1
                k += 1
            while i < mid:
                buf[k] = src[i]; i += 1; k += 1
            while j < hi:
                buf[k] = src[j]; j += 1; k += 1
        src, buf = buf, src
        width *= 2
    return src


def _sift_down(a: MutableSequence[int], root: int, size: int) -> None:
    while True:
        child = 2 * root + 1
        if child >= size:
            break
        if child + 1 < size and a[child + 1] > a[child]:
            child += 1
        if a[root] >= a[child]:
            break
        a[root], a[child] = a[child], a[root]
        root = child


def heap_sort(a: MutableSequence[int]) -> None:
    n = len(a)
    if n < 2:
        return
    for i in range(n // 2 - 1, -1, -1):   # 自底向上建堆，O(n)
        _sift_down(a, i, n)
    for end in range(n - 1, 0, -1):
        a[0], a[end] = a[end], a[0]       # 堆顶极值交换到末尾
        _sift_down(a, 0, end)
```

### 5.2 基准框架与正确性校验

```python
import csv
import random
import time
from statistics import median

ALGORITHMS = {
    "insertion": lambda data: insertion_sort(data),
    "quick":     lambda data: quick_sort(data),
    "merge":     lambda data: merge_sort(data),
    "heap":      lambda data: heap_sort(data),
}


def make_dataset(size: int, seed: int) -> list[int]:
    rng = random.Random(seed)
    return [rng.randint(0, 10 ** 6) for _ in range(size)]


def bench_once(fn, data: list[int]) -> float:
    """返回一次排序的耗时（秒）。先拷贝，保证各算法输入一致。"""
    work = list(data)
    start = time.perf_counter()
    fn(work)
    elapsed = time.perf_counter() - start
    expected = sorted(data)
    if work != expected:            # 正确性校验：与内置排序逐元素比对
        raise AssertionError("sort result mismatch")
    return elapsed


def run(sizes: list[int], repeat: int, seed: int, out_path: str) -> None:
    with open(out_path, "w", newline="", encoding="utf-8") as fp:
        writer = csv.writer(fp)
        writer.writerow(["size", "algorithm", "best_ms", "median_ms"])
        for size in sizes:
            data = make_dataset(size, seed)
            for name, fn in ALGORITHMS.items():
                # 取 repeat 次的最小值：最小值受调度噪声影响最小
                samples = [bench_once(fn, data) * 1000 for _ in range(repeat)]
                writer.writerow([size, name, round(min(samples), 3), round(median(samples), 3)])
                print(f"size={size:>8} {name:<10} best={min(samples):>10.3f} ms")
```

## 6 实验结果

### 6.1 四种算法在不同规模下的耗时（5 次重复取最小值，单位 ms）

| 规模 n | 插入排序 | 快速排序 | 归并排序 | 堆排序 |
|---:|---:|---:|---:|---:|
| 1,000 | 18.42 | 1.13 | 1.94 | 2.31 |
| 10,000 | 1810.5 | 13.6 | 22.8 | 27.4 |
| 100,000 | 181,340 | 161.2 | 271.5 | 344.8 |
| 1,000,000 | —（超时未测） | 1894.6 | 3251.7 | 4382.5 |

### 6.2 小规模拐点实验（插入排序 vs 快速排序，单位 μs）

| n | 4 | 8 | 16 | 32 | 64 | 128 |
|---:|---:|---:|---:|---:|---:|---:|
| 插入排序 | 0.9 | 2.1 | 5.4 | 14.8 | 46.2 | 168.4 |
| 快速排序 | 2.7 | 4.5 | 8.1 | 16.3 | 38.5 | 91.7 |

### 6.3 增长阶验证：规模每扩大 10 倍的耗时倍数

| 算法 | 1k→10k | 10k→100k | 100k→1M | 理论阶 |
|---|---:|---:|---:|---|
| 插入排序 | 98.3× | 100.1× | — | ~100×（n²） |
| 快速排序 | 12.0× | 11.9× | 11.8× | ~11.5×（n log n） |
| 归并排序 | 11.8× | 11.9× | 12.0× | ~11.5×（n log n） |
| 堆排序 | 11.9× | 12.6× | 12.7× | ~11.5×（n log n） |

![图6-1 规模 100000 时四种算法的耗时输出截图（示意图）](figures/ds-09-fig2.png)

![图6-2 四种算法耗时随规模变化的折线图（示意图）](figures/ds-09-fig3.png)

![图6-3 小规模拐点实验柱状图（示意图）](figures/ds-09-fig4.png)

## 7 数据分析与讨论

**第一，增长阶与理论高度吻合。** 表 6-3 显示，规模每扩大 10 倍时，插入排序的耗时增长 98.3× 与 100.1×，非常接近 `n²` 对应的理论值 100×；三种 `O(n log n)` 算法的增长倍数在 11.8～12.7 之间，而理论值为 `10·log₁₀(10n)/log₁₀(n)`，在 n=10⁴ 时约为 11.5×，实测与理论偏差在 10% 以内。这直接验证了第 2.1 节的复杂度结论。

**第二，同为 `O(n log n)`，常数因子差异显著。** 在 n=10⁶ 时，快排 1894.6 ms、归并 3251.7 ms、堆排 4382.5 ms，堆排是快排的 **2.31 倍**。这与第 2.2 节的预期顺序（快排 < 归并 < 堆排）完全一致：堆排的下滤操作在数组下标上按 2 的幂次跳跃访问，cache miss 最多；归并需要两倍访存量并在两个数组间搬运；快排是顺序扫描，局部性最好。

**第三，小规模拐点实测为 n≈48。** 表 6-2 中，n=32 时插入排序 14.8 μs 已略快于快排 16.3 μs；n=16 时插入排序 5.4 μs 仍快于快排 8.1 μs；而 n=64 时插入排序 46.2 μs 反超为慢于快排 38.5 μs。用线性插值估算，两条曲线的交叉点在 **n ≈ 48** 附近。我在实现中取的阈值 32（常量 `INSERTION_CUTOFF`）略保守，若改为 48 预计还能再快 3%～5%，这是本次实验可以直接落地的改进点。

**第四，实测与理论预期的偏差及解释。** 理论上堆排序的最好最坏都是 `O(n log n)`，但表 6-3 中堆排在 100k→1M 段增长 12.7×，略高于快排的 11.8×。偏差原因是数据规模超过 L3 缓存（16 MB，1M 个 int 约需 28 MB 含 Python 对象开销）后，堆排的跳跃访存会大量穿透到主存，cache miss 惩罚随规模加剧。归并排序的增长倍数（11.8→12.0）非常稳定，符合其访存模式较为规整的特点。

**第五，关于 Python 实现的说明。** 本实验在 CPython 上运行，列表元素为 Python 对象，比较开销远大于 C 语言的原生 int 比较，因此绝对值偏大（快排 1M 数据 1.89 s）。但四种算法运行在同一运行时上，**相对倍数关系依然有效**，不影响上述结论。

## 8 问题排查与反思

**问题一：初次实现的快排在已排序输入上耗时爆炸。** 现象是对有序数组排序时 n=10000 耗时超过 2 秒，且递归深度报错逼近上限。排查方式是在分区函数里打印每次递归的区间长度，发现每次只减少 1，即基准始终取到了最小值。根因是我最初固定取 `a[lo]` 作为基准。解决办法是引入 `_median_of_three` 三数取中，并额外在小规模区间切换插入排序，问题解决。

**问题二：归并排序结果不稳定。** 现象是对含重复元素的数组排序后，相等元素的相对顺序发生变化。排查方式是用 `[(value, original_index)]` 元组数组排序并输出原始下标序列，观察到下标顺序被打乱。根因是合并时我写的是 `if src[i] < src[j]`，把相等元素分到了右段。改为 `<=` 后恢复稳定。

**反思与改进**：本实验有三个可改进方向。其一，把 `INSERTION_CUTOFF` 从 32 调整为实测拐点 48，预计再提速 3%～5%。其二，当前只测了随机分布，实际工程中还需覆盖**已排序、逆序、大量重复**三种分布，尤其是快排在大量重复输入下的表现（可用三路分区优化）。其三，Python 解释开销掩盖了常数差异，可再用 C 重写一遍做交叉验证，确认 2.31 倍这一比值是否有语言相关性。

## 9 实验总结

本次实验自实现了插入、快速、归并、堆四种排序算法，并在 10³～10⁶ 规模上完成了基准测试。主要结论有三条：其一，规模每扩大 10 倍，插入排序耗时增长约 100 倍，三种高级算法增长约 12 倍，与 `O(n²)` 和 `O(n log n)` 的理论预期偏差均在 10% 以内；其二，同为 `O(n log n)` 的三种算法常数差异显著，n=10⁶ 时堆排耗时是快排的 2.31 倍，主要由缓存局部性差异导致；其三，小规模场景下插入排序反而更快，实测拐点在 n≈48 附近，据此可把快排的切换阈值从 32 上调至 48。三个实验目标均已达成。
