#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T6 · 资产库（asset-store）

按条件检索与存取四类资产。只做**确定性匹配**——不做语义检索、不做推荐、不用相似项顶替。

| kind     | 资产                     | 读写     |
|----------|--------------------------|----------|
| template | Rubric 样板库（内置）    | 只读     |
| rubric   | 教师已保存的 Rubric      | 可读可写 |
| sample   | 样例报告库               | 只读     |
| gold     | 教师金标准               | 只读     |

三类只读是硬约束：它保护「样板是起点，不是标准」这条边界——
教师可以选样板、改样板、另存为 rubric，但不能就地改写样板库本身。

两条诚实性约束（AUDIT 修复）：
  - **「目录不存在」≠「库为空」**（P2-22）：资产根或类别目录不存在时**退出码 2**并说明
    「资产未随包」；只有目录存在而查询无命中才用退出码 1。
    否则下游 S1 会把「资产根本没随包」读成「库里确实没有样板」，走错分支。
  - **`--id` 与写入扩展名受约束**（P2-23）：`--id` 含路径分隔符或 `..` 一律拒绝（防越出 store）；
    源文件扩展名不在 `.json` / `.md` 内一律拒绝——否则写入的文件 `list` / `get` **都看不见**。

用法：
  python3 asset_store.py --op list --kind template [--tag xx] [--contains text]
  python3 asset_store.py --op get  --kind rubric --id <id>
  python3 asset_store.py --op put  --kind rubric --id <id> --from <path>
  python3 asset_store.py --self-test

退出码：0 正常 ｜ 1 未命中（目录存在但结果为空）｜ 2 资产非法 / 目录不可读 / 对只读类别写入

仅标准库；无网络、无 AI；除 put 外纯函数；put 幂等（同内容同 digest 不重复写）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STORE = os.path.normpath(os.path.join(HERE, "..", "assets"))

KINDS = ("template", "rubric", "sample", "gold")
READ_ONLY = ("template", "sample", "gold")
EXTS = (".json", ".md")


class StoreError(Exception):
    """资产根 / 类别目录不可读，或写入请求非法（→ 退出码 2）。"""


def digest_bytes(b: bytes) -> str:
    return "sha256:" + hashlib.sha256(b).hexdigest()


def kind_dir(store: str, kind: str) -> str:
    if kind not in KINDS:
        raise StoreError("未知 kind：%s（可选 %s）" % (kind, " / ".join(KINDS)))
    return os.path.join(store, kind)


def require_kind_dir(store: str, kind: str) -> str:
    """类别目录必须真实存在——「不存在」不得被当成「空库」。"""
    if not os.path.isdir(store):
        raise StoreError(
            "资产根不存在：%s。这不是「库里没有样板」，而是**资产未随包**——"
            "请先建立资产根并放入资产（目录不可读用退出码 2，未命中才用 1）" % store)
    d = kind_dir(store, kind)
    if not os.path.isdir(d):
        raise StoreError("资产类别目录不存在：%s（同上：属未随包，不是未命中）" % d)
    return d


def safe_item_id(item_id: str) -> str:
    """`--id` 不得越出 store：拒绝路径分隔符与 `..`（AUDIT P2-23）。"""
    if not item_id or item_id.strip() != item_id:
        raise StoreError("--id 不得为空或含首尾空白：%r" % item_id)
    if os.sep in item_id or "/" in item_id or (os.altsep and os.altsep in item_id):
        raise StoreError("--id 不得含路径分隔符：%r" % item_id)
    if item_id in (".", "..") or item_id.startswith(".."):
        raise StoreError("--id 不得为相对父目录：%r" % item_id)
    if os.path.basename(item_id) != item_id:
        raise StoreError("--id 不得含目录成分：%r" % item_id)
    return item_id


def list_items(store: str, kind: str, tags: list[str], contains: str | None) -> list[dict]:
    d = require_kind_dir(store, kind)
    items = []
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        if not os.path.isfile(path):
            continue
        stem, ext = os.path.splitext(name)
        if ext.lower() not in EXTS:
            continue
        with open(path, "rb") as f:
            raw = f.read()
        meta: dict = {}
        if ext.lower() == ".json":
            try:
                doc = json.loads(raw.decode("utf-8"))
                if isinstance(doc, dict):
                    meta = doc.get("meta") or {}
                    if not meta and "title" in doc:
                        meta = {"title": doc.get("title"), "tags": doc.get("tags") or []}
            except Exception:  # noqa: BLE001
                meta = {"title": None, "parseError": "json-invalid"}
        title = meta.get("title") or stem
        item_tags = [str(t) for t in (meta.get("tags") or [])]
        # 多个 --tag 为 AND 语义：条目的标签集合必须包含全部给定标签
        if tags and not set(tags) <= set(item_tags):
            continue
        if contains:
            blob = raw.decode("utf-8", errors="replace")
            if contains not in blob:
                continue
        items.append({
            "id": stem, "kind": kind, "title": title, "tags": sorted(item_tags),
            "ext": ext.lstrip("."), "readOnly": kind in READ_ONLY,
            "digest": digest_bytes(raw), "path": path,
        })
    return items


def get_item(store: str, kind: str, item_id: str) -> dict | None:
    safe_item_id(item_id)
    d = require_kind_dir(store, kind)
    for ext in EXTS:
        path = os.path.join(d, item_id + ext)
        if os.path.isfile(path):
            with open(path, "rb") as f:
                raw = f.read()
            return {
                "item": {"id": item_id, "kind": kind, "ext": ext.lstrip("."),
                         "readOnly": kind in READ_ONLY,
                         "digest": digest_bytes(raw), "path": path},
                "content": raw.decode("utf-8", errors="replace"),
            }
    return None


def put_item(store: str, kind: str, item_id: str, src: str) -> dict:
    if kind in READ_ONLY:
        raise StoreError(
            "kind=%s 为只读，不允许写入（保护「样板是起点，不是标准」）" % kind)
    if kind != "rubric":
        raise StoreError("只允许写入 kind=rubric，实际 %s" % kind)
    safe_item_id(item_id)
    if not os.path.isfile(src):
        raise StoreError("待写入的源文件不存在或不可读：%s" % src)
    src_ext = os.path.splitext(src)[1].lower()
    if src_ext not in EXTS:
        raise StoreError(
            "源文件扩展名 %r 不在 %s 内：写入后会**看不见**（list / get 只认这两个扩展名）"
            % (src_ext or "（无）", " / ".join(EXTS)))
    try:
        with open(src, "rb") as f:
            raw = f.read()
    except OSError as exc:
        raise StoreError("源文件不可读：%s（%s）" % (src, exc)) from exc
    if src_ext == ".json":
        try:
            json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise StoreError("待写入内容不是合法 JSON：%s" % exc) from exc
    d = require_kind_dir(store, kind)
    target = os.path.join(d, item_id + src_ext)
    new_digest = digest_bytes(raw)
    if os.path.isfile(target):
        with open(target, "rb") as f:
            if digest_bytes(f.read()) == new_digest:
                return {"id": item_id, "digest": new_digest, "path": target, "written": False}
    with open(target, "wb") as f:
        f.write(raw)
    return {"id": item_id, "digest": new_digest, "path": target, "written": True}


def run(op: str, store: str, kind: str, item_id: str | None, tags: list[str],
        contains: str | None, src: str | None) -> tuple[dict, int]:
    if op == "list":
        items = list_items(store, kind, tags, contains)
        out = {"tool": "T6", "op": "list", "kind": kind, "store": store,
               "count": len(items), "items": items}
        # 目录存在但无命中 → 1（未命中）；目录不存在已在 list_items 里抛 StoreError
        return out, (0 if items else 1)
    if op == "get":
        if not item_id:
            raise StoreError("get 需要 --id")
        got = get_item(store, kind, item_id)
        if got is None:
            return {"tool": "T6", "op": "get", "kind": kind, "store": store,
                    "item": None, "content": None,
                    "message": "未命中；不得用相似项顶替"}, 1
        return {"tool": "T6", "op": "get", "kind": kind, "store": store, **got}, 0
    if op == "put":
        if not src:
            raise StoreError("put 需要 --from")
        if not item_id:
            item_id = os.path.splitext(os.path.basename(src))[0]
        info = put_item(store, kind, item_id, src)
        return {"tool": "T6", "op": "put", "kind": kind, "store": store, **info}, 0
    raise StoreError("未知 --op：%s" % op)


def _self_test() -> int:
    try:
        tmp_ctx = tempfile.TemporaryDirectory()
        tmp = tmp_ctx.name
    except (OSError, FileNotFoundError) as exc:
        # 受限沙箱 / 锁定 CI 下没有可写临时目录：必须给出**可与断言失败区分**的结构化报错，
        # 不得以裸 traceback + 退出码 1 收场（AUDIT P3-29）
        print(json.dumps({
            "tool": "T6",
            "error": "本环境没有可写临时目录，无法运行自检：%s" % exc,
            "kind": "no-writable-temp",
            "hint": "这不是断言失败；请在可写环境重跑，或改用 create/校验路径",
        }, ensure_ascii=False, indent=2, sort_keys=True))
        return 2

    checks = {}
    with tmp_ctx:
        os.makedirs(os.path.join(tmp, "template"), exist_ok=True)
        os.makedirs(os.path.join(tmp, "rubric"), exist_ok=True)
        with open(os.path.join(tmp, "template", "t1.json"), "w", encoding="utf-8") as f:
            json.dump({"meta": {"title": "通用实验报告样板", "tags": ["通用"]},
                       "items": [{"pointId": "P1", "maxScore": 10, "weight": 100}]}, f,
                      ensure_ascii=False)
        src = os.path.join(tmp, "new.json")
        with open(src, "w", encoding="utf-8") as f:
            json.dump({"meta": {"title": "数据结构实验", "tags": ["数据结构"]},
                       "items": [{"pointId": "P1", "maxScore": 20, "weight": 100}]}, f,
                      ensure_ascii=False)

        r1, c1 = run("list", tmp, "template", None, [], None, None)
        r2, c2 = run("list", tmp, "template", None, ["不存在"], None, None)
        r3, c3 = run("put", tmp, "rubric", "ds", [], None, src)
        r4, c4 = run("get", tmp, "rubric", "ds", None, None, None)
        r5, c5 = run("get", tmp, "rubric", "nope", None, None, None)

        checks["listHit"] = c1 == 0 and r1["count"] == 1
        checks["listMissIsExit1"] = c2 == 1 and r2["count"] == 0
        checks["putThenGet"] = bool(
            c3 == 0 and r3["written"] is True and c4 == 0 and r4["content"])
        checks["getMissIsExit1"] = c5 == 1 and r5["item"] is None

        blocked = False
        try:
            run("put", tmp, "template", "x", [], None, src)
        except StoreError:
            blocked = True
        checks["readOnlyProtected"] = blocked

        # P2-22：类别目录不存在 → StoreError（退出码 2），不得被当成「未命中」
        missing_kind = False
        try:
            run("list", tmp, "gold", None, [], None, None)
        except StoreError:
            missing_kind = True
        checks["missingKindDirIsError2"] = missing_kind

        # 资产根整个不存在 → StoreError
        missing_root = False
        try:
            run("list", os.path.join(tmp, "__nope__"), "template", None, [], None, None)
        except StoreError:
            missing_root = True
        checks["missingStoreRootIsError2"] = missing_root

        # P2-23：--id 越界与非白名单扩展名一律拒绝
        traversal = False
        try:
            run("get", tmp, "rubric", "../../etc/passwd", None, None, None)
        except StoreError:
            traversal = True
        checks["idTraversalRejected"] = traversal

        bad_ext = False
        src_txt = os.path.join(tmp, "noext")
        with open(src_txt, "w", encoding="utf-8") as f:
            f.write("x")
        try:
            run("put", tmp, "rubric", "noext", [], None, src_txt)
        except StoreError:
            bad_ext = True
        checks["nonWhitelistedExtRejected"] = bad_ext

        print(json.dumps({"tool": "T6", "checks": checks}, ensure_ascii=False,
                         indent=2, sort_keys=True))
    return 0 if all(checks.values()) else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="T6 资产库（asset-store）")
    ap.add_argument("--op", default="list", choices=["list", "get", "put"])
    ap.add_argument("--kind", default="template", choices=list(KINDS))
    ap.add_argument("--id")
    ap.add_argument("--tag", action="append", default=[])
    ap.add_argument("--contains")
    ap.add_argument("--from", dest="src")
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    try:
        out, code = run(args.op, args.store, args.kind, args.id, args.tag,
                        args.contains, args.src)
    except StoreError as exc:
        print(json.dumps({"tool": "T6", "error": str(exc), "kind": "invalid-request"},
                         ensure_ascii=False))
        return 2
    except Exception as exc:  # noqa: BLE001  禁止裸 traceback
        print(json.dumps({"tool": "T6", "error": "%s: %s" % (type(exc).__name__, exc),
                          "kind": "internal-error"}, ensure_ascii=False))
        return 2

    print(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
