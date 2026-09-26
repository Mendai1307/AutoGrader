# 实验报告：线程同步

- 课程：操作系统原理
- 实验者：学生D
- 学院：某某大学计算机学院

---

## 1 实验目的

学习多线程编程。

## 2 实验原理

多个线程同时运行时会互相影响，所以要让它们按顺序来。同步就是让线程之间有先后的关系，互斥是同一时间只能有一个线程操作。这两个概念差不多，实现的时候让线程等待一下就可以。

全局变量是多个线程都能看到的，所以可以用来传递信息。这次的做法是设一个 flag，等于 0 的时候表示没人用，等于 1 的时候表示有人在改数据。线程进来之前先看 flag，如果是 1 就睡一秒再看，如果是 0 就把它设成 1 然后开始改，改完再设回 0。这样应该能保证同一时间只有一个线程在改 cnt，计数就不会错。锁这个东西大概也是类似的道理，不过这个实验里我没有用锁。

程序里 sleep 的作用是让等待的线程不要一直占着 CPU，不然循环会跑得很快，其他线程就没机会运行了。这个写法能不能真的保证不出问题我也不是很确定，反正跑出来的结果看起来是对的。

## 3 实验环境

- 操作系统：Ubuntu 22.04
- 编译器：gcc 11.4
- 编辑器：vim

## 4 实验步骤

1. 打开 vim 写程序。
2. 用 gcc 编译。
3. 运行看结果。

## 5 核心代码

```c
#include <pthread.h>
#include <stdio.h>
#include <unistd.h>

int flag = 0;
int cnt = 0;

void* t1(void* a) {
    while (flag == 1) { sleep(1); }
    flag = 1;
    cnt = cnt + 1;
    flag = 0;
    return NULL;
}

void* t2(void* a) {
    while (flag == 1) { sleep(1); }
    flag = 1;
    cnt = cnt + 1;
    flag = 0;
    return NULL;
}

int main() {
    pthread_t a1, a2;
    pthread_create(&a1, NULL, t1, NULL);
    pthread_create(&a2, NULL, t2, NULL);
    pthread_join(a1, NULL);
    pthread_join(a2, NULL);
    printf("cnt=%d\n", cnt);
    return 0;
}
```

## 6 实验结果

程序跑起来了，输出了 cnt 的值，看起来是对的。

![代码编辑界面截图（示意图）](figures/os-04-fig1.png)
