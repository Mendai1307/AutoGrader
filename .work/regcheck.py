# 只读检查：本机 LearnBuddy 自定义协议注册状态
# 用法: python regcheck.py
import winreg

SEP = chr(92)
BASE = "Software" + SEP + "Classes" + SEP


def q(k, name):
    try:
        return winreg.QueryValueEx(k, name)[0]
    except Exception:
        return "(none)"


for scheme in ["learnbuddy", "learnbuddy-2", "workbuddy", "workbuddy-2"]:
    try:
        k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, BASE + scheme)
    except FileNotFoundError:
        print("[--] %-14s NOT REGISTERED" % scheme)
        continue
    except Exception as e:
        print("[!!] %-14s ERROR %s" % (scheme, e))
        continue
    print("[OK] %-14s default=%r  URL Protocol=%r" % (scheme, q(k, ""), q(k, "URL Protocol")))
    try:
        ck = winreg.OpenKey(winreg.HKEY_CURRENT_USER, BASE + scheme + SEP + "shell" + SEP + "open" + SEP + "command")
        print("       command = %r" % q(ck, ""))
    except Exception as e:
        print("       command = MISSING (%s)" % e)
    k.Close()

# 顺带列出 Classes 下所有含 buddy 的协议键
print()
print("--- HKCU\\Software\\Classes 中名字含 buddy 的项 ---")
try:
    k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software" + SEP + "Classes")
    i = 0
    while True:
        try:
            name = winreg.EnumKey(k, i)
        except OSError:
            break
        i += 1
        if "buddy" in name.lower():
            try:
                sk = winreg.OpenKey(winreg.HKEY_CURRENT_USER, BASE + name)
                print("  %-20s -> %r" % (name, q(sk, "")))
            except Exception:
                print("  %-20s -> (unreadable)" % name)
except Exception as e:
    print("  枚举失败:", e)
