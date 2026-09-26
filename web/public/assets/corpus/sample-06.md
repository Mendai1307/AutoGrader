# 实验报告：基于 TCP 的文件传输程序设计

- 课程：计算机网络
- 实验者：学生F
- 学院：某某大学计算机学院
- 实验编号：NET-Lab-04

---

## 1 实验目的

1. 掌握 TCP 套接字编程中服务端与客户端两侧的调用流程与参数含义。
2. 实现一个能把本地文件完整传输到对端的程序，并在接收端校验文件长度一致。
3. 通过改变文件大小与缓冲区尺寸，观察传输耗时的变化，理解缓冲区大小对系统调用次数的影响。

## 2 实验原理

TCP 提供面向连接、可靠、按序的字节流服务。服务端一侧的调用顺序是 `socket` → `bind` → `listen` → `accept`，客户端一侧是 `socket` → `connect`，双方随后用 `send`/`recv` 收发数据，结束时 `close`。`listen` 的第二个参数是已完成连接队列的长度，超过该长度的新连接会被拒绝或忽略。

文件传输的关键在于区分"文件元数据"与"文件内容"：由于 TCP 不保留消息边界，接收端无法从字节流本身判断文件何时结束，因此需要先发送文件名与文件长度，接收端按长度循环接收，收满即认为传输完成。缓冲区大小决定了每次系统调用搬运的数据量：缓冲区越大，系统调用次数越少，内核态与用户态切换的开销占比越低。

字节序也是本实验需要注意的一个细节。网络协议规定多字节整数在网络上按大端序传输，而 x86 主机内部使用的是小端序。如果直接把结构体或长整数的内存表示发出去，对端解析出来的数值就会出错。本实验传输的元数据只有文件名和文件长度，其中文件名是字节数组，不涉及字节序；文件长度使用 `long` 直接发送，因为收发两端都在同一台主机上，字节序一致，所以没有出现问题。如果要在不同体系结构的机器之间传输，就必须用 `htonl` 和 `ntohl` 做显式转换。

TCP 的流量控制与拥塞控制由内核协议栈自动完成，应用层不需要关心发送速率。但这也意味着发送方调用 `send` 返回成功，只表示数据被复制到了内核发送缓冲区，并不代表对端已经收到。本实验通过先发送文件长度、接收端收满才结束的方式来保证完整性，同时用 md5 校验做最终确认。

## 3 实验环境

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04.3 LTS |
| 编译器 | gcc 11.4.0 |
| C 运行库 | glibc 2.35 |
| 网络环境 | 本机回环 127.0.0.1 |
| CPU | 4 核 8 线程 x86_64 |

![图3-1 实验环境信息截图（示意图）](figures/net-06-fig1.png)

## 4 实验步骤

1. 编写服务端 `filesrv.c`，接收文件名、长度与内容并落盘。
2. 编写客户端 `filecli.c`，读取本地文件并发送。
3. 编译两个程序。
4. 生成 1 MB / 10 MB / 50 MB 三个测试文件。
5. 分别以缓冲区 1024 字节与 8192 字节传输，各运行 3 次记录耗时。
6. 用 `md5sum` 校验收发两端文件是否一致。

## 5 核心代码

### 5.1 服务端接收逻辑

```c
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define PORT 9000
#define BUFSIZE 8192
#define NAMELEN 256

int main(void) {
    int listenfd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(PORT);

    bind(listenfd, (struct sockaddr *)&addr, sizeof(addr));
    listen(listenfd, 5);
    printf("waiting for client...\n");

    int connfd = accept(listenfd, NULL, NULL);

    char name[NAMELEN];
    long filesize;
    recv(connfd, name, NAMELEN, 0);        /* 先收文件名，定长读取 */
    recv(connfd, &filesize, sizeof(filesize), 0);

    FILE *fp = fopen(name, "wb");
    char buf[BUFSIZE];
    long total = 0;
    while (total < filesize) {
        long want = filesize - total;
        if (want > BUFSIZE) want = BUFSIZE;
        long n = recv(connfd, buf, want, 0);
        total += n;
        fwrite(buf, 1, n, fp);
    }
    fclose(fp);
    printf("received %s, %ld bytes\n", name, total);
    close(connfd);
    close(listenfd);
    return 0;
}
```

### 5.2 客户端发送逻辑

```c
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define PORT 9000
#define BUFSIZE 8192
#define NAMELEN 256

int main(int argc, char *argv[]) {
    int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(PORT);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

    connect(sockfd, (struct sockaddr *)&addr, sizeof(addr));

    char name[NAMELEN] = {0};
    strncpy(name, argv[1], NAMELEN - 1);
    FILE *fp = fopen(argv[1], "rb");
    fseek(fp, 0, SEEK_END);
    long filesize = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    send(sockfd, name, NAMELEN, 0);
    send(sockfd, &filesize, sizeof(filesize), 0);

    char buf[BUFSIZE];
    long n;
    while ((n = fread(buf, 1, BUFSIZE, fp)) > 0) {
        send(sockfd, buf, n, 0);
    }
    fclose(fp);
    printf("sent %ld bytes\n", filesize);
    close(sockfd);
    return 0;
}
```

## 6 实验结果

表 6-1 不同文件大小与缓冲区尺寸下的传输耗时（3 次取平均）

| 文件大小 | 缓冲区 1024 B | 缓冲区 8192 B |
|---:|---:|---:|
| 1 MB | 0.042 s | 0.021 s |
| 10 MB | 0.418 s | 0.197 s |
| 50 MB | 2.153 s | 0.986 s |

表 6-2 收发两端文件一致性校验

| 文件大小 | 发送端 md5 | 接收端 md5 | 是否一致 |
|---:|---|---|---|
| 1 MB | 6f1d...a2c | 6f1d...a2c | 是 |
| 10 MB | b90e...4d1 | b90e...4d1 | 是 |
| 50 MB | 37ac...f80 | 37ac...f80 | 是 |

![图6-1 服务端接收完成后的输出截图（示意图）](figures/net-06-fig2.png)

![图6-2 客户端发送完成后的输出截图（示意图）](figures/net-06-fig3.png)

![图6-3 md5sum 校验结果截图（示意图）](figures/net-06-fig4.png)

## 7 结果分析

从表中可以看出，缓冲区从 1024 字节增大到 8192 字节之后，传输耗时都下降了，1 MB 文件从 0.042 s 降到 0.021 s，50 MB 文件从 2.153 s 降到 0.986 s，大概快了一倍左右。文件大小越大，传输耗时也越大，10 MB 比 1 MB 慢了约 10 倍。三个文件的 md5 校验值在收发两端都一致，说明文件内容传输正确，没有丢字节。缓冲区大一些传输会快一些。

## 8 问题与总结

实验里遇到过传输完成后接收端文件大小对不上的情况，看起来是数据没收全，后来调整了接收部分的写法。另外编译的时候头文件顺序不对也报了错。总的来说这次实验把 socket 的整个流程走了一遍，对 bind、listen、accept 这几个函数的作用有了比较清楚的认识。程序运行正常，文件能完整传过去，达到了实验的基本要求。后续可以考虑做成支持多客户端的版本。

## 参考文献

[1] 计算机网络（第 7 版），第 3 章 运输层。
[2] Linux `socket(7)` 手册页。
