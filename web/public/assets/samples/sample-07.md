# 实验报告：简单的 TCP 客户端与服务端通信程序

- 课程：计算机网络
- 实验者：学生G
- 学院：某某大学计算机学院
- 实验编号：NET-Lab-02

---

## 1 实验目的

1. 了解 socket 编程的基本流程，学会编写客户端和服务端程序。
2. 实现一个简单的字符串收发程序，服务端把客户端发来的内容原样返回。

## 2 实验原理

socket 是应用层和传输层之间的接口，程序通过它来收发数据。服务端需要先创建套接字，绑定地址和端口，然后监听，有客户端连进来时接受连接，之后就可以收发了。客户端创建套接字后直接连接服务端地址即可。TCP 是可靠的协议，数据不会丢失也不会乱序，所以一般不需要自己处理丢包问题。

socket 编程里比较重要的几个概念是地址和端口。地址用来确定是哪一台机器，端口用来确定这台机器上的哪一个程序，两者合起来才能唯一确定通信的双方。本机测试时可以用回环地址，也就是 127.0.0.1，这样数据不经过网卡，直接在协议栈内部转一圈就回来了。端口一般要选 1024 以上的，因为 1024 以下的端口被系统占用了。

服务端的几个函数作用各不相同。bind 是把套接字和地址绑定起来，listen 是让套接字进入监听状态并指定等待队列的长度，accept 是从已经完成连接的队列里取出一个连接并返回一个新的套接字，之后的数据收发都用这个新的套接字，原来的监听套接字继续负责接受新的连接。客户端没有 bind 和 listen，直接 connect 服务端的地址就可以了。

## 3 实验环境

- 操作系统：Ubuntu 22.04.3 LTS
- 编译器：gcc 11.4.0
- 网络环境：本机回环 127.0.0.1，端口 8888

## 4 实验步骤

1. 写服务端程序，编译。
2. 写客户端程序，编译。
3. 先运行服务端再运行客户端，输入字符串看返回结果。

## 5 核心代码

```c
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

int main() {
    int s, c;
    char b[100];
    struct sockaddr_in a;
    s = socket(AF_INET, SOCK_STREAM, 0);
    a.sin_family = AF_INET;
    a.sin_port = 8888;
    a.sin_addr.s_addr = 0;
    bind(s, (struct sockaddr*)&a, sizeof(a));
    listen(s, 1);
    c = accept(s, NULL, NULL);
    while (1) {
        recv(c, b, 100, 0);
        printf("get: %s\n", b);
        send(c, b, 100, 0);
    }
    close(c);
    close(s);
    return 0;
}
```

```c
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

int main() {
    int s;
    char b[100];
    struct sockaddr_in a;
    s = socket(AF_INET, SOCK_STREAM, 0);
    a.sin_family = AF_INET;
    a.sin_port = 8888;
    a.sin_addr.s_addr = 0;
    connect(s, (struct sockaddr*)&a, sizeof(a));
    while (1) {
        scanf("%s", b);
        send(s, b, 100, 0);
        recv(s, b, 100, 0);
        printf("echo: %s\n", b);
    }
    return 0;
}
```

## 6 实验结果

编译运行之后，客户端输入字符串，服务端能收到并打印出来，客户端也能收到返回的内容，通信是正常的。

![程序运行的截图（示意图）](figures/net-07-fig1.png)

## 7 问题与总结

做的时候碰到过连不上的情况，检查了一下发现是端口写错了，改过来就可以了。还有一次服务端先关掉了，客户端还在发数据，就出了点问题，重启之后恢复正常。

这次实验完成了 socket 程序的基本编写，客户端和服务端可以互相收发数据，对 socket 编程的流程有了一个初步的认识。以后还需要在错误处理和多客户端支持方面继续改进。
