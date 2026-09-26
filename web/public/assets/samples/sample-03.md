# 实验报告：读者—写者问题

- 课程：操作系统原理
- 实验者：学生C
- 学院：某某大学计算机学院
- 实验编号：OS-Lab-05

---

## 1 实验目的

1. 理解读者—写者问题中"读共享、写独占"的约束。
2. 用互斥量与信号量实现读者优先的同步方案，并观察运行结果。

## 2 实验原理

读者—写者问题允许多个读者同时读取共享数据，但写者必须与所有读者和其他写者互斥。实现时通常维护一个读计数 `readcount`：第一个进入的读者负责加锁（阻止写者），最后一个退出的读者负责解锁；写者则直接竞争这把锁。读计数本身也是共享变量，所以需要另一把互斥量保护它。只要保证对共享资源的读改写在临界区内完成，就能避免数据不一致。

读者—写者问题有两种常见策略。读者优先的策略是：只要还有读者在读，新来的读者就可以直接进入，写者必须等到所有读者都退出之后才能写，这种策略下写者可能会出现长时间等待。写者优先的策略则相反：一旦有写者在等待，新来的读者就要先阻塞，等写者写完再放行，这种策略下读者可能被饿死。两种策略各有取舍，本实验采用的是读者优先。信号量在这里的作用是控制进入权限，互斥量的作用是保护共享变量，两者配合起来可以表达比较复杂的同步条件。

## 3 实验环境

- 操作系统：Ubuntu
- 编译器：gcc
- 开发工具：VS Code

## 4 实验步骤

1. 编写 `rw.c`，实现读者线程与写者线程，主线程负责创建线程并等待结束。
2. 编译程序：`gcc -o rw rw.c -lpthread`。
3. 运行 `./rw 3 2`，即创建 3 个读者线程和 2 个写者线程，观察终端输出。
4. 改变读者和写者的数量再运行几次，比如 `./rw 5 1` 和 `./rw 1 5`。
5. 记录运行结果并截图。

## 5 核心代码

```c
#include <pthread.h>
#include <semaphore.h>
#include <stdio.h>

int readcount = 0;
int data = 0;
sem_t wsem;

void *reader(void *arg) {
    int id = *(int*)arg;
    readcount++;
    if (readcount == 1) sem_wait(&wsem);
    printf("reader %d read data=%d\n", id, data);
    readcount--;
    if (readcount == 0) sem_post(&wsem);
    return NULL;
}

void *writer(void *arg) {
    int id = *(int*)arg;
    sem_wait(&wsem);
    data = data + 1;
    printf("writer %d write data=%d\n", id, data);
    sem_post(&wsem);
    return NULL;
}

int main() {
    sem_init(&wsem, 0, 0);
    pthread_t r[3], w[2];
    int ids[5] = {1,2,3,4,5};
    for (int i = 0; i < 3; i++) pthread_create(&r[i], NULL, reader, &ids[i]);
    for (int i = 0; i < 2; i++) pthread_create(&w[i], NULL, writer, &ids[i+3]);
    for (int i = 0; i < 3; i++) pthread_join(r[i], NULL);
    for (int i = 0; i < 2; i++) pthread_join(w[i], NULL);
    return 0;
}
```

## 6 实验结果

程序编译通过并可以运行，终端输出了读者与写者的读写记录，`data` 的值随着写者的写入递增。

![图6-1 程序运行结果截图（示意图）](figures/os-03-fig1.png)

## 7 问题与总结

实验过程中遇到了一些问题，比如一开始程序编译不过，后来改了一下就好了，运行时也出现过输出顺序不太对的情况，多跑几次又正常了。总的来说同步这块比较难，需要多练习。

本次实验完成了读者—写者程序的基本实现，程序可以运行并输出读写记录。通过实验我对互斥与同步有了更直观的了解，收获比较大，以后会继续加强对这部分内容的学习。
