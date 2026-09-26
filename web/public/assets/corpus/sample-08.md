# 实验报告：网络程序

- 课程：计算机网络
- 实验者：学生H
- 学院：某某大学计算机学院

本次实验要做一个能传数据的网络程序，老师说要用 socket，我找了一下发现 Python 有现成的模块可以直接用，所以就用现成模块做了，服务端用 http.server 起一个服务，客户端用 urllib 去取，能拿到东西就算完成了。网络程序大概就是本机发出去对方收，收不到就是地址或者端口写错了，重试一下就好，感觉原理上不复杂。

环境是 Ubuntu，用 Python 写代码，编辑器是 VS Code。步骤就是先写一个服务端脚本，再写一个客户端脚本，先起服务端再跑客户端，然后看输出。

服务端用的 http.server 模块是 Python 自带的，不用另外装东西，它启动之后会在本机的一个端口上等着别人来连。客户端用 urllib.request 里的 urlopen 去取，传一个网址进去就能拿到返回的内容，返回的是一个文件对象，再调 read 就能读出字节。据说用 socket 编程要自己写 bind、listen、accept 这些，比较麻烦，用现成模块就省事多了，效果应该是一样的。

```python
import http.server
import urllib.request

PORT = 8000

def run_server():
    handler = http.server.SimpleHTTPRequestHandler
    s = http.server.HTTPServer(('127.0.0.1', PORT), handler)
    s.serve_forever()

def run_client():
    r = urllib.request.urlopen('http://127.0.0.1:%d/data.txt' % PORT)
    print(r.read())

run_server()
run_client()
```

跑的时候服务端起来了，客户端那边报了个错，好像是连不上，我把端口改成 8000 之后还是不行，可能是顺序的问题。后面我把两个函数分开到两个文件里跑，客户端能取到内容了，说明程序是可以工作的。

![代码界面截图（示意图）](figures/net-08-fig1.png)

这次实验基本做完了，网络编程这块还需要多练。
