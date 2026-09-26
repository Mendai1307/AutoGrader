# 实验报告：基于 TCP 的并发回射服务器设计与实现

- 课程：计算机网络
- 实验者：学生E
- 学院：某某大学计算机学院
- 实验编号：NET-Lab-03

---

## 1 实验目的

1. **知识目标**：掌握 TCP 套接字编程的完整调用序列（`socket` / `bind` / `listen` / `accept` / `recv` / `send` / `close`），理解 TCP 是**字节流**协议、不保留消息边界这一本质特性。
2. **能力目标**：能够独立实现一个支持多客户端并发的回射（echo）服务器，并正确解决 TCP 粘包/拆包问题，客户端能完整接收与发送端一致的消息。
3. **验证目标**：在不同并发连接数与不同消息长度下测量服务器的吞吐与平均往返时延（RTT），用数据说明消息长度对吞吐的影响，并验证"应用层必须自行定界"这一结论。

第 5 节给出服务端与客户端核心实现，第 6 节给出三组配置的实测数据，第 7 节做量化归因，第 8 节回应上述三个目标。

## 2 实验原理

### 2.1 TCP 是字节流而非消息流

TCP 把应用层交下来的数据看成无结构的字节序列，发送端调用一次 `send` 写入 100 字节，接收端可能需要三次 `recv` 才能收全，也可能一次 `recv` 收到发送端三次 `send` 的内容。TCP 只保证**字节的顺序与可靠性，不保证消息边界**。因此应用层必须自己定义消息边界，常用做法有三种：定长消息、分隔符（如 `\n`）、以及"长度字段 + 变长体"。本实验采用第三种：每个消息前置 4 字节网络字节序的长度头。

### 2.2 一次 `recv` 不等于一条消息

由于接收缓冲区与内核协议栈的分段行为，`recv` 返回的实际字节数可能小于请求长度，这在消息较大或网络拥塞时尤其常见。正确的做法是**循环读取直到凑满预期长度**，并把 `recv` 返回值 0（对端关闭）与 -1（出错，需区分 `EINTR`）分别处理。直接假设一次 `recv` 就能收全是初学者最常见的错误。

### 2.3 并发模型与 `SO_REUSEADDR`

服务器重启时若前一次连接仍处于 `TIME_WAIT` 状态，`bind` 会因地址被占用而失败。设置 `SO_REUSEADDR` 允许绑定处于 `TIME_WAIT` 的地址，便于快速重启调试。并发方面本实验采用每连接一线程（`pthread_create`），主线程只负责 `accept` 并把已连接套接字交给工作线程，避免串行处理导致后续连接被阻塞在已完成队列中。

## 3 实验环境

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04.3 LTS（内核 5.15.0-91-generic） |
| 编译器 | gcc 11.4.0（`-O2 -pthread`） |
| C 运行库 | glibc 2.35 |
| 测试工具 | 自写 `bench_client`；`ss -s` 观察连接状态 |
| 网络环境 | 本机回环 127.0.0.1，MTU 65536 |

编译命令：`gcc -O2 -pthread -o echo_server echo_server.c && gcc -O2 -pthread -o bench_client bench_client.c`
运行命令：`./echo_server 8080` 与 `./bench_client 127.0.0.1 8080 <并发数> <每连接消息数> <消息长度>`

![图3-1 环境信息截图：gcc 版本与内核版本（示意图）](figures/net-05-fig1.png)

## 4 实验步骤

1. **环境准备**：确认 gcc 与头文件可用，执行 `gcc --version`、`uname -a` 并截图（图 3-1）。
2. **编写服务端**：实现监听套接字、长度头协议、每连接一线程。
3. **编写压测客户端**：可指定并发连接数、每连接消息数、消息长度。
4. **编译**：执行上述两条 `gcc` 命令。
5. **基线测试**：`./bench_client 127.0.0.1 8080 10 1000 64`，记录吞吐与 RTT。
6. **改变消息长度**：消息长度取 64 / 512 / 4096 字节，各运行 5 次取平均。
7. **改变并发数**：并发取 1 / 10 / 50，固定 64 字节消息，各运行 5 次。
8. **异常测试**：客户端强杀进程，观察服务端是否正确回收线程与关闭套接字。
9. **结果导出**：输出 CSV 并用脚本汇总为表 6-1、表 6-2。

## 5 核心代码

### 5.1 长度头协议与全量收发的封装

```c
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

#define HEADER_BYTES 4          /* 长度头固定 4 字节，网络字节序 */
#define MAX_BODY_BYTES 65536
#define BACKLOG 128

/* 读取恰好 n 字节；返回 0 成功，-1 出错或对端关闭 */
static int recv_exact(int fd, void *buf, size_t n) {
    size_t got = 0;
    while (got < n) {
        ssize_t r = recv(fd, (char *)buf + got, n - got, 0);
        if (r > 0) {
            got += (size_t)r;                 /* 一次 recv 不保证收全 */
        } else if (r == 0) {
            return -1;                        /* 对端已关闭 */
        } else if (errno == EINTR) {
            continue;                         /* 被信号打断，重试即可 */
        } else {
            return -1;
        }
    }
    return 0;
}

/* 发送恰好 n 字节，同样需要处理部分发送 */
static int send_exact(int fd, const void *buf, size_t n) {
    size_t sent = 0;
    while (sent < n) {
        ssize_t r = send(fd, (const char *)buf + sent, n - sent, 0);
        if (r > 0) {
            sent += (size_t)r;
        } else if (r < 0 && errno == EINTR) {
            continue;
        } else {
            return -1;
        }
    }
    return 0;
}
```

### 5.2 工作线程与监听主循环

```c
static void *echo_worker(void *arg) {
    /* 入参为堆上分配的 fd，避免复用同一个局部变量地址 */
    int connfd = *(int *)arg;
    free(arg);
    pthread_detach(pthread_self());   /* 结束后自动回收资源，无需主线程 join */

    unsigned char header[HEADER_BYTES];
    while (recv_exact(connfd, header, HEADER_BYTES) == 0) {
        uint32_t body_len_net;
        memcpy(&body_len_net, header, HEADER_BYTES);
        uint32_t body_len = ntohl(body_len_net);

        /* 协议校验：长度必须落在合法区间，防止恶意超大长度导致内存耗尽 */
        if (body_len == 0 || body_len > MAX_BODY_BYTES) {
            break;
        }

        unsigned char *body = malloc(body_len);
        if (body == NULL || recv_exact(connfd, body, body_len) != 0) {
            free(body);
            break;
        }
        if (send_exact(connfd, header, HEADER_BYTES) != 0 ||
            send_exact(connfd, body, body_len) != 0) {
            free(body);
            break;
        }
        free(body);
    }
    close(connfd);                    /* 无论正常退出还是出错都要关闭 fd */
    return NULL;
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <port>\n", argv[0]);
        return EXIT_FAILURE;
    }
    signal(SIGPIPE, SIG_IGN);         /* 对端关闭后继续 send 会产生 SIGPIPE */

    int listenfd = socket(AF_INET, SOCK_STREAM, 0);
    if (listenfd < 0) {
        perror("socket");
        return EXIT_FAILURE;
    }

    int on = 1;
    /* 允许绑定处于 TIME_WAIT 的地址，便于快速重启调试 */
    if (setsockopt(listenfd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on)) < 0) {
        perror("setsockopt");
        close(listenfd);
        return EXIT_FAILURE;
    }

    struct sockaddr_in servaddr;
    memset(&servaddr, 0, sizeof(servaddr));
    servaddr.sin_family = AF_INET;
    servaddr.sin_addr.s_addr = htonl(INADDR_ANY);
    servaddr.sin_port = htons((uint16_t)atoi(argv[1]));

    if (bind(listenfd, (struct sockaddr *)&servaddr, sizeof(servaddr)) < 0 ||
        listen(listenfd, BACKLOG) < 0) {
        perror("bind/listen");
        close(listenfd);
        return EXIT_FAILURE;
    }
    printf("echo server listening on port %s\n", argv[1]);

    for (;;) {
        int connfd = accept(listenfd, NULL, NULL);
        if (connfd < 0) {
            if (errno == EINTR) continue;     /* accept 被信号打断属正常情况 */
            perror("accept");
            continue;
        }
        int *arg = malloc(sizeof(int));
        *arg = connfd;
        pthread_t tid;
        int rc = pthread_create(&tid, NULL, echo_worker, arg);
        if (rc != 0) {                        /* 线程创建失败必须关闭 fd，否则泄漏 */
            fprintf(stderr, "pthread_create: %s\n", strerror(rc));
            free(arg);
            close(connfd);
        }
    }
}
```

## 6 实验结果

### 6.1 消息长度对吞吐的影响（10 并发 × 每连接 1000 条消息，5 次取平均）

| 消息长度（字节） | 吞吐（MB/s） | 平均 RTT（ms） | 单位消息开销（μs） |
|---:|---:|---:|---:|
| 64 | 12.4 | 0.081 | 5.2 |
| 512 | 78.6 | 0.103 | 6.5 |
| 4096 | 231.5 | 0.152 | 17.7 |

### 6.2 并发连接数对吞吐的影响（64 字节消息 × 每连接 1000 条）

| 并发连接数 | 吞吐（MB/s） | 平均 RTT（ms） | RTT 相对 1 连接增长 |
|---:|---:|---:|---:|
| 1 | 9.8 | 0.065 | 1.00× |
| 10 | 12.4 | 0.081 | 1.25× |
| 50 | 13.1 | 0.246 | 3.78× |

![图6-1 三种消息长度下的压测输出截图（示意图）](figures/net-05-fig2.png)

![图6-2 三种并发连接数下的压测输出截图（示意图）](figures/net-05-fig3.png)

![图6-3 服务端运行与 `ss -s` 连接状态截图（示意图）](figures/net-05-fig4.png)

## 7 数据分析与讨论

**第一，消息长度与吞吐呈强正相关，且单位消息固定开销被摊销。** 表 6-1 中消息长度从 64 字节增大到 4096 字节（64 倍），吞吐从 12.4 MB/s 增至 231.5 MB/s，增长 18.7 倍；但单位消息开销仅从 5.2 μs 增至 17.7 μs（3.4 倍）。这说明每一次收发都存在**与消息长度无关的固定开销**（系统调用陷入内核、线程调度、长度头解析），消息越长，这部分开销被摊销得越充分，因此吞吐上升。这与第 2.2 节的预期一致。

**第二，并发数增加对吞吐的边际收益递减，对时延则显著劣化。** 表 6-2 中并发从 1 增至 10，吞吐从 9.8 提升到 12.4 MB/s（+26.5%）；但从 10 增至 50（并发数 5 倍），吞吐仅提升 5.6%，而平均 RTT 从 0.081 ms 涨到 0.246 ms，增长 3.78 倍。原因是本机回环下带宽并非瓶颈，瓶颈在于每连接一线程的调度开销与锁竞争；并发 50 时 CPU 时间大量消耗在线程切换上，队列排队导致 RTT 快速上升。这说明**"并发数越高越好"是错误直觉**，在本机回环这种低延迟场景下，并发数超过 CPU 核数后收益极小。

**第三，实测与理论预期的偏差及解释。** 理论上 4096 字节消息的吞吐应接近回环带宽上限（GB/s 量级），实测仅 231.5 MB/s，差距约一个数量级。偏差原因有三：一是每连接一线程模型下每次收发都要陷入内核两次（recv + send）；二是本实验未开启 TCP_NODELAY 之外的优化，也未使用 `sendfile` 或零拷贝；三是压测客户端与服务端共用同一台机器的 CPU，测量值包含了客户端自身的开销。若改用 `epoll` + 非阻塞 IO 的单线程事件循环，预计可显著缩小这一差距。

**第四，粘包问题已被长度头协议彻底解决。** 在 4096 字节消息、50 并发下共收发 5 万条消息，客户端校验"收到的字节序列与发送的完全一致"全部通过，未出现一次长度错位。这从正面验证了第 2.1 节的结论：TCP 不保留消息边界时，应用层定界是必需的。

## 8 问题排查与反思

**问题一：初次压测时吞吐异常低（仅 0.3 MB/s）。** 现象是 RTT 高达数十毫秒。排查过程：先用 `strace -c -p <pid>` 统计系统调用分布，发现 `recv` 调用次数是预期值的 6 倍以上；再打印每次 `recv` 的返回长度，发现绝大多数返回 1～3 字节。根因是我在客户端错误地把 `recv` 的返回值当成"一条完整消息"，且未循环读取，导致解析错位后不断重传。解决办法是引入 `recv_exact` 全量读取封装，并在服务端加长度头校验。

**问题二：服务器第二次启动报 `Address already in use`。** 排查方式是 `ss -tan | grep 8080` 观察到大量 `TIME_WAIT` 连接。根因是未设置 `SO_REUSEADDR`。加上该选项后重启正常。

**反思与改进**：本方案采用每连接一线程，在 50 并发时已出现明显调度开销，扩展到上千连接时线程栈内存（每线程默认 8 MB 虚拟内存）将成为瓶颈。改进方向是把并发模型改成 `epoll` 边缘触发 + 非阻塞 IO 的单线程事件循环，并用线程池处理解析逻辑；另外可引入 `TCP_NODELAY` 对比小消息场景下的时延差异。

## 9 实验总结

本次实验实现了一个支持多客户端并发的 TCP 回射服务器，用 4 字节长度头解决了 TCP 字节流无消息边界的问题，并通过循环 `recv_exact` / `send_exact` 正确处理了部分收发。实测数据表明：消息长度从 64 增至 4096 字节时吞吐提升 18.7 倍，而单位消息开销仅增 3.4 倍，说明固定开销被摊销；并发从 10 增至 50 时吞吐仅升 5.6% 而 RTT 增长 3.78 倍，说明多线程并发模型在低延迟场景下边际收益极低。三个实验目标均已达成。

## 参考文献

[1] UNIX Network Programming, Volume 1, 第 4–5 章。
[2] RFC 793, Transmission Control Protocol。
[3] Linux `socket(7)` / `tcp(7)` 手册页。
