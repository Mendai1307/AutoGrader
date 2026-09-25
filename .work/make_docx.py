#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""由 markdown 生成 docx（本地 editor_sdk 通道）。

链路：create_doc → doc_insert_markdown(markdown=file://<abs md>) → save_file(file_path=…)

用法：python make_docx.py <in.md> <out.docx>
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

SK = r"H:\LearnBuddy\resources\app.asar.unpacked\resources\builtin-skills\tencent-local-office-edit"
RE_FID = re.compile(r"file_id=([^\s,]+)")


def call(tool: str, **kw) -> str:
    args = ["python3", "edsdk.py", "call", tool]
    for k, v in kw.items():
        args.append("%s=%s" % (k, v))
    proc = subprocess.run(args, cwd=SK, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0 or ("error" in out.lower() and "file_id=" not in out):
        raise RuntimeError("调用 %s 失败（exit=%s）：%s" % (tool, proc.returncode, out[:600]))
    return out


def main(argv: list[str]) -> int:
    src, dst = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    if not os.path.isfile(src):
        print(json.dumps({"error": "输入 md 不存在: %s" % src}, ensure_ascii=False))
        return 2

    created = call("create_doc")
    m = RE_FID.search(created)
    if not m:
        print(json.dumps({"error": "create_doc 未返回 file_id", "raw": created[:400]},
                         ensure_ascii=False))
        return 2
    fid = m.group(1)

    ins = call("doc_insert_markdown", file_id=fid, idx=0,
               markdown="file://" + src.replace("\\", "/"))
    saved = call("save_file", file_id=fid, file_path=dst)

    print(json.dumps({
        "src": os.path.basename(src), "dst": dst, "file_id": fid,
        "insert_out": ins.strip().splitlines()[-1][:200] if ins.strip() else "",
        "save_out": saved.strip().splitlines()[-1][:200] if saved.strip() else "",
        "size": os.path.getsize(dst) if os.path.isfile(dst) else None,
    }, ensure_ascii=False, indent=2))
    return 0 if os.path.isfile(dst) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
