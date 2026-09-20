# 实验报告：有界缓冲区的生产者—消费者同步

- 课程：操作系统原理
- 实验者：学生B
- 学院：某某大学计算机学院
- 实验编号：OS-Lab-04

---

## 1 实验目的

1. 掌握进程/线程同步中"生产者—消费者"这一经典模型的建模方法。
2. 学会用信号量（`sem_t`）实现缓冲区空/满的同步，用互斥量保护缓冲区结构的读写。
3. 通过改变缓冲区容量与线程配比，观察程序吞吐与阻塞次数的变化。

## 2 实验原理

生产者—消费者问题的核心是两类约束：一是**互斥约束**，缓冲区是共享结构，任意时刻只能有一个线程修改它的读写指针；二是**同步约束**，缓冲区满时生产者必须等待，缓冲区空时消费者必须等待。

实现上通常设三个信号量：`empty` 初值为缓冲区容量 N，表示还能放多少个；`full` 初值为 0，表示已放了多少个；`mutex` 初值为 1，用于保护缓冲区本身。生产者先 `sem_wait(&empty)` 再 `sem_wait(&mutex)`，放入后依次 `sem_post(&mutex)`、`sem_post(&full)`；消费者顺序相反。这里两条 `sem_wait` 的顺序不能颠倒，否则会出现持有互斥量等待 `empty` 的情况，导致对方也拿不到互斥量而死锁。

pthread 的互斥量是二值信号量的一种实现，信号量则更通用，可表示资源计数。实验中用 `sem_wait`/`sem_post` 完成 PV 操作。

缓冲区采用环形结构实现：用 `in` 和 `out` 两个下标分别记录下一个写入位置和下一个读取位置，每次写入或读取后对容量取模，就可以让缓冲区循环使用，避免数据搬移。环形缓冲区的判空与判满不能只看两个下标是否相等，本实验借助 `empty` 与 `full` 两个计数信号量来区分这两种状态，因此下标本身不需要额外的判满逻辑。

死锁是本实验中另一个需要注意的问题。当多个线程各自持有一把锁又去申请对方持有的锁时，就会形成循环等待。本实验通过"先申请资源信号量、再申请互斥量"的统一顺序避免了循环等待，因为资源信号量不构成互斥资源，不会形成持有并等待的条件。

## 3 实验环境

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04.3 LTS（内核 5.15.0-91-generic） |
| 编译器 | gcc 11.4.0 |
| 线程库 | POSIX threads（NPTL 2.35，glibc 2.35） |
| CPU | 4 核 8 线程 x86_64 |

编译命令：`gcc -O2 -pthread -o pc pc.c`
运行命令：`./pc <生产者数> <消费者数> <缓冲区容量> <每线程生产数>`

![图3-1 实验环境版本信息截图（示意图）](figures/os-02-fig1.png)

## 4 实验步骤

1. 编写 `pc.c`，实现环形缓冲区与生产者、消费者线程函数。
2. 编译：`gcc -O2 -pthread -o pc pc.c`。
3. 运行默认配置 `./pc 2 2 8 50000`，观察输出。
4. 固定缓冲区容量为 8，改变线程数为 1/2/4，各运行 3 次。
5. 固定线程数为 2/2，改变缓冲区容量为 4/8/64，各运行 3 次。
6. 记录每次的耗时与校验值。

## 5 核心代码

```c
#include <pthread.h>
#include <semaphore.h>
#include <stdio.h>
#include <stdlib.h>

#define ITEMS_PER_PRODUCER 50000

typedef struct {
    int *buf;
    int capacity;
    int in;
    int out;
    long long produced;
    long long consumed;
} ring_t;

static ring_t g_ring;
static sem_t sem_empty;
static sem_t sem_full;
static pthread_mutex_t ring_mutex = PTHREAD_MUTEX_INITIALIZER;

static void put_item(ring_t *r, int item) {
    r->buf[r->in] = item;
    r->in = (r->in + 1) % r->capacity;
    r->produced++;
}

static int get_item(ring_t *r) {
    int item = r->buf[r->out];
    r->out = (r->out + 1) % r->capacity;
    r->consumed++;
    return item;
}

static void *producer(void *arg) {
    int items = *(int *)arg;
    for (int i = 0; i < items; i++) {
        sem_wait(&sem_empty);              /* 等一个空位 */
        pthread_mutex_lock(&ring_mutex);   /* 保护缓冲区结构 */
        put_item(&g_ring, i);
        pthread_mutex_unlock(&ring_mutex);
        sem_post(&sem_full);               /* 已放数量 +1 */
    }
    return NULL;
}

static void *consumer(void *arg) {
    int items = *(int *)arg;
    for (int i = 0; i < items; i++) {
        sem_wait(&sem_full);               /* 等一个已放元素 */
        pthread_mutex_lock(&ring_mutex);
        get_item(&g_ring);
        pthread_mutex_unlock(&ring_mutex);
        sem_post(&sem_empty);
    }
    return NULL;
}
```

```c
int main(int argc, char *argv[]) {
    int nprod = atoi(argv[1]);
    int ncons = atoi(argv[2]);
    int cap = atoi(argv[3]);
    int per_producer = atoi(argv[4]);

    g_ring.capacity = cap;
    g_ring.in = 0;
    g_ring.out = 0;
    g_ring.produced = 0;
    g_ring.consumed = 0;
    g_ring.buf = calloc(cap, sizeof(int));

    sem_init(&sem_empty, 0, cap);
    sem_init(&sem_full, 0, 0);

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    pthread_t ptids[64], ctids[64];
    for (int i = 0; i < nprod; i++)
        pthread_create(&ptids[i], NULL, producer, &per_producer);
    for (int i = 0; i < ncons; i++)
        pthread_create(&ctids[i], NULL, consumer, &per_producer);
    for (int i = 0; i < nprod; i++)
        pthread_join(ptids[i], NULL);
    for (int i = 0; i < ncons; i++)
        pthread_join(ctids[i], NULL);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) * 1e-9;

    printf("cap=%d produced=%lld consumed=%lld elapsed=%.4fs\n",
           cap, g_ring.produced, g_ring.consumed, elapsed);
    free(g_ring.buf);
    return 0;
}
```

## 6 实验结果

配置一：固定容量 8，改变线程数（每生产者 5 万件）。

| 生产者/消费者 | 缓冲区容量 | 生产总数 | 消费总数 | 耗时（s） |
|---|---:|---:|---:|---:|
| 1 / 1 | 8 | 50000 | 50000 | 0.18 |
| 2 / 2 | 8 | 100000 | 100000 | 0.42 |
| 4 / 4 | 8 | 200000 | 200000 | 0.97 |

配置二：固定线程 2/2，改变缓冲区容量。

| 缓冲区容量 | 耗时（s） |
|---:|---:|
| 4 | 0.55 |
| 8 | 0.42 |
| 64 | 0.31 |

![图6-1 默认配置运行结果截图（示意图）](figures/os-02-fig2.png)

![图6-2 三种缓冲区容量下的运行对比截图（示意图）](figures/os-02-fig3.png)

## 7 结果分析

从表中的数据可以看出，线程数增加时耗时也增加了，1/1 配置是 0.18 s，4/4 配置是 0.97 s。缓冲区容量变大之后耗时有所下降，容量 4 时是 0.55 s，容量 64 时是 0.31 s。生产总数与消费总数在每组配置下都相等，说明程序没有丢数据，同步是有效的。整体来看，缓冲区越大程序跑得越快，线程越多程序跑得越慢。

## 8 问题记录与总结

实验过程中遇到过缓冲区满时程序卡住的问题，后来发现是把 `sem_wait(&sem_empty)` 写在了 `pthread_mutex_lock` 之后，调换顺序之后就正常了。此外编译时一开始忘记加 `-pthread` 参数，导致链接报错，加上参数后编译通过。

本次实验完成了生产者—消费者模型的实现，用三个信号量配合互斥量保证了缓冲区访问的正确性，生产与消费总数一致。整体达到实验要求，后续可以在此基础上增加多生产者多消费者的压力测试。

## 参考文献

[1] 操作系统概念（第九版），第 6 章 同步。
