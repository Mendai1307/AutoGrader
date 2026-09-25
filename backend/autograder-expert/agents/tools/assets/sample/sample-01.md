# 实验报告：多线程共享计数器的同步与互斥

- 课程：操作系统原理
- 实验者：学生A
- 学院：某某大学计算机学院
- 实验编号：OS-Lab-03

---

## 1 实验目的

本次实验围绕"多线程并发访问共享资源"这一核心问题展开，具体目标有三条：

1. **知识目标**：理解临界区、互斥与同步三者的区别，理解竞态条件（race condition）产生的根本原因——共享变量的"读—改—写"序列在指令层面不是原子的。
2. **能力目标**：能够使用 POSIX 信号量（`sem_wait` / `sem_post`）与互斥量（`pthread_mutex_t`）两种机制保护临界区，并能独立写出可复现的并发测试程序。
3. **验证目标**：定量测量加锁前后程序的吞吐量变化，用数据说明"安全性"与"性能"之间的权衡关系，并验证加速比随线程数变化的趋势。

后文第 5 节给出实现代码，第 6 节给出三种配置下的实测数据，第 7 节对数据做量化归因，第 8 节回应上述三个目标。

## 2 实验原理

### 2.1 竞态条件的成因

`counter++` 在 C 语言中看起来是一条语句，编译后通常展开为三条机器指令：从内存 load 到寄存器、寄存器加一、store 回内存。当两个线程几乎同时执行这条语句时，可能出现如下交错序列：线程 T1 读出 100，尚未写回；线程 T2 也读出 100，加一后写回 101；随后 T1 也写回 101。两次自增只产生了一次效果，这就是丢失更新（lost update）。因此，**只要存在共享的可变状态，且对该状态的修改不是原子的，就必须引入互斥**。

### 2.2 互斥与同步的区别

互斥（mutual exclusion）保证同一时刻只有一个线程进入临界区，解决的是"资源独占"问题；同步（synchronization）保证线程之间按某种先后顺序推进，解决的是"协作时序"问题。互斥量本质上是初值为 1 的信号量，属于二值信号量；而计数信号量初值可为 N，允许 N 个线程同时进入，常用于限流而非互斥。本实验保护计数器应当使用初值为 1 的信号量或互斥量，而不是计数信号量。

### 2.3 PV 操作为何能保证互斥

信号量的 P 操作（`sem_wait`）是一个原子地"减一并判断是否小于零"的过程，V 操作（`sem_post`）原子地"加一并唤醒等待者"。由于减一与判断由内核保证原子性，**最多只有一个线程能把信号量从 1 减到 0 并成功进入临界区**，其余线程在 P 操作上阻塞，直到持有者执行 V 操作释放。这就在不依赖忙等的前提下建立了互斥。

### 2.4 加锁的代价

加锁并非免费：临界区串行化会使原本可并行的计算退化为串行，同时线程在锁上的阻塞与唤醒会带来上下文切换和内核态切换开销。因此线程数增加时，加锁版本的吞吐量并不会线性增长，甚至在锁竞争剧烈时出现下降。这一预期将在第 7 节用实测数据检验。

## 3 实验环境

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04.3 LTS（内核 5.15.0-91-generic） |
| 编译器 | gcc 11.4.0（`-O2 -pthread`） |
| C 运行库 | glibc 2.35 |
| 线程库 | POSIX threads（NPTL 2.35） |
| CPU | 4 核 8 线程，x86_64 |
| 编译命令 | `gcc -O2 -pthread -o counter counter.c` |
| 运行命令 | `./counter <线程数> <每线程自增次数> <模式>` |

![图3-1 实验环境信息截图 uname 与 gcc 版本（示意图）](figures/os-01-fig1.png)

## 4 实验步骤

1. **环境准备**：确认 `gcc` 与 pthread 头文件可用，执行 `gcc --version` 与 `uname -a` 记录版本信息（图 3-1）。
2. **编写无保护版本**：先实现不加锁的 `worker_unsafe`，用于复现竞态条件。
3. **编译与运行**：`gcc -O2 -pthread -o counter counter.c`，以 `./counter 4 1000000 unsafe` 运行，重复 5 次记录结果。
4. **加入互斥量版本**：实现 `worker_mutex`，以 `./counter 4 1000000 mutex` 运行，重复 5 次。
5. **加入信号量版本**：实现 `worker_sem`，以 `./counter 4 1000000 sem` 运行，重复 5 次。
6. **改变并发规模**：线程数取 1 / 2 / 4 / 8，重复步骤 4，记录吞吐量。
7. **结果导出**：把每次运行的计数结果与耗时写入 CSV，再用脚本汇总为表 6-1、表 6-2。

## 5 核心代码

### 5.1 共享变量与三种工作线程

```c
#include <pthread.h>
#include <semaphore.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_THREADS 64

typedef enum { MODE_UNSAFE, MODE_MUTEX, MODE_SEM } sync_mode_t;

/* 共享状态：计数器与两种同步原语 */
static long long counter = 0;
static pthread_mutex_t counter_mutex = PTHREAD_MUTEX_INITIALIZER;
static sem_t counter_sem;

typedef struct {
    long long loops;      /* 每线程自增次数 */
    sync_mode_t mode;     /* 本次运行使用的同步模式 */
} worker_arg_t;

static double now_seconds(void) {
    struct timespec ts;
    /* clock_gettime 失败直接退出，避免用错误的时间基准算出错误吞吐 */
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        perror("clock_gettime");
        exit(EXIT_FAILURE);
    }
    return ts.tv_sec + ts.tv_nsec * 1e-9;
}

static void *worker_unsafe(void *arg) {
    const long long loops = ((worker_arg_t *)arg)->loops;
    for (long long i = 0; i < loops; i++) {
        counter++;             /* 无保护：三条指令可被打断 */
    }
    return NULL;
}

static void *worker_mutex(void *arg) {
    const long long loops = ((worker_arg_t *)arg)->loops;
    for (long long i = 0; i < loops; i++) {
        pthread_mutex_lock(&counter_mutex);
        counter++;
        pthread_mutex_unlock(&counter_mutex);
    }
    return NULL;
}

static void *worker_sem(void *arg) {
    const long long loops = ((worker_arg_t *)arg)->loops;
    for (long long i = 0; i < loops; i++) {
        sem_wait(&counter_sem);   /* P 操作：原子减一并判断是否阻塞 */
        counter++;
        sem_post(&counter_sem);   /* V 操作：原子加一并唤醒等待者 */
    }
    return NULL;
}
```

### 5.2 主流程与错误处理

```c
int main(int argc, char *argv[]) {
    if (argc != 4) {
        fprintf(stderr, "usage: %s <threads> <loops-per-thread> <unsafe|mutex|sem>\n", argv[0]);
        return EXIT_FAILURE;
    }

    int nthreads = atoi(argv[1]);
    long long loops = atoll(argv[2]);
    const char *mode_str = argv[3];

    /* 参数校验：线程数与循环次数必须为正，且不超过预设上限 */
    if (nthreads <= 0 || nthreads > MAX_THREADS || loops <= 0) {
        fprintf(stderr, "invalid argument: threads in (0, %d], loops > 0\n", MAX_THREADS);
        return EXIT_FAILURE;
    }

    sync_mode_t mode;
    if (strcmp(mode_str, "unsafe") == 0) {
        mode = MODE_UNSAFE;
    } else if (strcmp(mode_str, "mutex") == 0) {
        mode = MODE_MUTEX;
    } else if (strcmp(mode_str, "sem") == 0) {
        mode = MODE_SEM;
        /* 初值为 1 的二值信号量才是互斥信号量 */
        if (sem_init(&counter_sem, 0, 1) != 0) {
            perror("sem_init");
            return EXIT_FAILURE;
        }
    } else {
        fprintf(stderr, "unknown mode: %s\n", mode_str);
        return EXIT_FAILURE;
    }

    pthread_t tid[MAX_THREADS];
    worker_arg_t arg = { loops, mode };
    double start = now_seconds();

    for (int i = 0; i < nthreads; i++) {
        void *(*fn)(void *) =
            (mode == MODE_UNSAFE) ? worker_unsafe :
            (mode == MODE_MUTEX)  ? worker_mutex : worker_sem;
        int rc = pthread_create(&tid[i], NULL, fn, &arg);
        if (rc != 0) {                 /* 必须检查返回值，否则会漏掉线程 */
            fprintf(stderr, "pthread_create failed at %d: %s\n", i, strerror(rc));
            return EXIT_FAILURE;
        }
    }

    for (int i = 0; i < nthreads; i++) {
        int rc = pthread_join(tid[i], NULL);
        if (rc != 0) {
            fprintf(stderr, "pthread_join failed at %d: %s\n", i, strerror(rc));
            return EXIT_FAILURE;
        }
    }

    double elapsed = now_seconds() - start;
    long long expected = (long long)nthreads * loops;

    printf("mode=%-6s threads=%2d expected=%lld actual=%lld loss=%lld elapsed=%.4fs throughput=%.2f ops/s\n",
           mode_str, nthreads, expected, counter, expected - counter, elapsed,
           (double)expected / elapsed);

    if (mode == MODE_SEM) {
        sem_destroy(&counter_sem);
    }
    return EXIT_SUCCESS;
}
```

## 6 实验结果

### 6.1 三种模式的正确性对比（4 线程 × 每线程 100 万次自增，重复 5 次取平均）

| 模式 | 期望值 | 实测平均值 | 平均丢失次数 | 结果是否正确 |
|---|---:|---:|---:|---|
| unsafe | 4,000,000 | 2,187,436 | 1,812,564 | 否 |
| mutex | 4,000,000 | 4,000,000 | 0 | 是 |
| sem | 4,000,000 | 4,000,000 | 0 | 是 |

![图6-1 无保护模式下的运行结果截图，actual 明显小于 expected（示意图）](figures/os-01-fig2.png)

![图6-2 互斥量模式的运行结果截图，actual 等于 expected（示意图）](figures/os-01-fig3.png)

### 6.2 并发规模对吞吐量的影响（每线程 100 万次自增，mutex 模式）

| 线程数 | 耗时（s） | 吞吐量（万 ops/s） | 相对 1 线程的加速比 |
|---:|---:|---:|---:|
| 1 | 0.041 | 2439.0 | 1.00 |
| 2 | 0.386 | 518.1 | 0.21 |
| 4 | 1.742 | 229.6 | 0.09 |
| 8 | 3.905 | 204.9 | 0.08 |

![图6-3 线程数 1/2/4/8 四组运行的耗时对比终端截图（示意图）](figures/os-01-fig4.png)

## 7 数据分析与讨论

**第一，无保护版本的丢失率高达 45.3%。** 按表 6-1，丢失次数 1,812,564 占期望值 4,000,000 的 45.31%。这个比例看似高得反常，原因有两个：一是自增循环体极短，临界区占比接近 100%，线程几乎每次都在争抢同一个 cache line；二是 `-O2` 下编译器把自增优化得更紧凑，进一步提高了指令交错的概率。这说明竞态条件不是"偶尔出现的小概率事件"，在临界区占比高的场景中它是必然事件。

**第二，加锁正确性有保证，但性能代价极大。** 对比表 6-1 中三组的耗时（表 6-2 中 4 线程 mutex 耗时 1.742 s，而单线程 mutex 仅需 0.041 s），加锁后单线程版本的 0.041 s 到 4 线程的 1.742 s，耗时涨了约 42 倍，而工作量只涨了 4 倍。也就是说**加速比不是 4 而是 0.09**，即加锁版本比单线程还慢 11 倍。这与第 2.4 节的预期一致：当临界区占比接近 100% 时，加锁不仅消除了并行收益，还额外付出了阻塞、唤醒与上下文切换的代价。

**第三，实测与理论预期的偏差及解释。** 理论预期是"加锁后吞吐随线程数先升后降"，但本次实测（表 6-2）从 1 线程开始就单调下降，没有出现上升段。偏差原因是本实验的临界区占比为 100%，不存在可并行的非临界区计算，因此吞吐上升段在物理上不存在；若把临界区缩短（例如每 1000 次自增才加一次锁，改为批量累加）应能观察到先升后降。这一点我尚未在本次实验中验证，属于后续可改进的方向。

**第四，mutex 与 sem 两种机制性能接近。** sem 模式 4 线程耗时 1.798 s，mutex 为 1.742 s，相差 3.2%，在误差范围内，说明二者的底层实现（futex）是同一套机制，二值信号量与互斥量在语义等价时性能也基本等价。

## 8 问题排查与反思

### 8.1 遇到的问题与排查

**问题一：初次运行时加锁版本结果依然错误。** 现象是 mutex 模式下 `actual` 偶尔小于 `expected`。排查方式是把 `pthread_mutex_t` 从全局变量改为 `main` 中的局部变量并打印地址，发现我最初把锁作为结构体成员传给了每个线程，导致**每个线程锁的是不同的锁对象**，等于没加锁。解决办法是把锁改为静态全局量 `counter_mutex` 并统一初始化，问题消失。定位手段是打印锁对象地址。

**问题二：`sem_init` 初值写成了 8。** 现象是 sem 模式同样出现丢失更新。根因是我误把"允许 8 个线程并发"当成了互斥的语义，忽略了第 2.2 节所说的互斥必须使用初值为 1 的二值信号量。改为 1 后结果正确。

### 8.2 反思与改进

本方案的局限在于临界区占比过高，测出的性能数据只能说明"最坏情况"，不能代表真实业务（真实业务中临界区通常只占很小比例）。改进方向有两条：一是引入批量累加（每线程先在本地累加 1000 次再加锁合并一次），预计可让加速比回到 2 以上；二是改用原子操作 `__atomic_add_fetch` 替代锁，在无冲突路径上避免陷入内核，我计划在下一次实验中对比这三种方案。

## 9 实验总结

本次实验用可复现的数据验证了三点：其一，共享可变状态不加保护必然产生竞态条件，实测丢失率 45.31%；其二，互斥量与二值信号量都能彻底消除丢失更新，二者性能差异仅 3.2%；其三，加锁的代价取决于临界区占比，本实验临界区占比 100% 时，4 线程加速比仅为 0.09，比单线程还慢 11 倍。实验目的中的三个目标均已达成，唯一未验证的是"临界区缩短后加速比回升"这一推论，留待后续实验。

## 参考文献

[1] 操作系统概念（第九版），第 6 章 同步。
[2] POSIX.1-2017，`pthread_mutex_lock`、`sem_wait` 手册页。
