#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AutoGrader Expert · 打包装配器（build_expert）

把仓库源码树（开发期布局）**确定性地**装配成平台合规专家包，落到专家目录：

    $WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/autograder-expert/

映射的唯一真源是 `packaging/expert.manifest.json`（改映射改那里，不要改本脚本）。

为什么必须落到那个目录：平台的专家校验器会检查专家目录是否在
`<CONFIG_DIR>/plugins/marketplaces/my-experts/plugins/` 之下，**不在则无法被检测到**。

用法：
  python3 build_expert.py                       # 只装配
  python3 build_expert.py --validate            # 装配 + 跑官方校验器
  python3 build_expert.py --validate --register # 装配 + 校验 + 注册（注册后才在专家中心可见）
  python3 build_expert.py --package             # 装配 + 用官方脚本打成 zip
  python3 build_expert.py --dry-run             # 只打印将写入的文件清单，不落盘

退出码：0 全部成功 ｜ 1 装配/校验/注册有失败 ｜ 2 环境或输入不可用（缺 manifest、找不到官方脚本等）

仅标准库；无网络、无 AI。装配是**确定性**的：同一份源码 → 同一份包（不写时间戳）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "packaging", "expert.manifest.json")

# 官方 expert-manager 技能的已知可能落点（本机默认在 H: 的随包资源里）。
# 找不到时用 --tools-dir 指定。
TOOLS_CANDIDATES = (
    os.path.join(os.environ.get("LEARNBUDDY_RESOURCES", ""), "builtin-skills", "expert-manager"),
    r"H:\LearnBuddy\resources\app.asar.unpacked\resources\builtin-skills\expert-manager",
)


class BuildError(Exception):
    """环境或输入不可用（→ 退出码 2）。"""


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # newline="\n"：禁止 Windows 文本模式把 \n 写成 \r\n，保证装配可复现
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def yaml_scalar(value) -> str:
    """渲染成稳定的 YAML 标量：数字直出，其余一律双引号包裹（内容含中文与全角标点，加引号最安全）。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_frontmatter(fm: dict) -> str:
    """把 frontmatter 对象渲染成 YAML。**只支持本清单用到的形状**：标量 + 一层 {en,zh} 映射。"""
    order = ["name", "description", "displayName", "profession", "maxTurns"]
    keys = [k for k in order if k in fm] + [k for k in fm if k not in order]
    lines = ["---"]
    for key in keys:
        value = fm[key]
        if isinstance(value, dict):
            lines.append("%s:" % key)
            for sub in ("en", "zh"):
                if sub in value:
                    lines.append("  %s: %s" % (sub, yaml_scalar(value[sub])))
        else:
            lines.append("%s: %s" % (key, yaml_scalar(value)))
    lines.append("---")
    return "\n".join(lines) + "\n"


def extract_body(text: str, start_marker: str | None, end_marker: str | None) -> str:
    """按标记裁剪正文：从第一个以 start_marker 开头的行，到第一个以 end_marker 开头的行之前。"""
    lines = text.split("\n")
    begin = 0
    if start_marker:
        for i, line in enumerate(lines):
            if line.startswith(start_marker):
                begin = i
                break
        else:
            raise BuildError("正文起始标记未找到：%r" % start_marker)
    end = len(lines)
    if end_marker:
        for i in range(begin, len(lines)):
            if lines[i].startswith(end_marker):
                end = i
                break
    return "\n".join(lines[begin:end]).strip() + "\n"


def copy_file(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def copy_tree(src: str, dst: str) -> None:
    """复制目录，剔除 __pycache__ / .pyc（不把编译缓存打进交付包）。"""
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        rel = os.path.relpath(root, src)
        target_root = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target_root, exist_ok=True)
        for name in sorted(files):
            if name.endswith(".pyc"):
                continue
            shutil.copy2(os.path.join(root, name), os.path.join(target_root, name))


# --------------------------------------------------------------------------- #
# 装配
# --------------------------------------------------------------------------- #
def load_manifest() -> dict:
    if not os.path.isfile(MANIFEST):
        raise BuildError("找不到映射清单：%s" % MANIFEST)
    try:
        return json.loads(read_text(MANIFEST))
    except json.JSONDecodeError as exc:
        raise BuildError("映射清单不是合法 JSON：%s" % exc) from exc


def resolve_target(manifest: dict) -> str:
    config_dir = (os.environ.get("WORKBUDDY_CONFIG_DIR") or "").strip()
    if not config_dir:
        config_dir = os.path.join(os.path.expanduser("~"), ".learnbuddy")
    market = manifest.get("targetMarketplace", "").replace("$WORKBUDDY_CONFIG_DIR", config_dir)
    if not market:
        raise BuildError("清单缺少 targetMarketplace")
    return os.path.join(market, manifest["expertDirName"])


def check_in_target(manifest: dict, target: str) -> None:
    """自检：装配目标必须落在专家目录之下（否则平台无法检测到）。"""
    config_dir = (os.environ.get("WORKBUDDY_CONFIG_DIR") or "").strip() or \
        os.path.join(os.path.expanduser("~"), ".learnbuddy")
    required = os.path.join(config_dir, "plugins", "marketplaces", "my-experts", "plugins")
    if os.path.relpath(os.path.abspath(target), os.path.abspath(required)).startswith(".."):
        raise BuildError(
            "装配目标不在专家目录下，平台将无法检测到。\n  要求前缀：%s\n  实际目标：%s" % (required, target))


def build(manifest: dict, target: str, dry_run: bool = False) -> list:
    """装配并返回写入的文件清单（相对 target 的路径）。"""
    src_root = HERE
    written: list = []

    def put(rel: str, text: str):
        written.append(rel)
        if not dry_run:
            write_text(os.path.join(target, rel), text)

    def put_copy(rel: str, src_abs: str):
        written.append(rel)
        if not dry_run:
            copy_file(src_abs, os.path.join(target, rel))

    def put_tree(rel: str, src_abs: str):
        for root, dirs, files in os.walk(src_abs):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            r = os.path.relpath(root, src_abs)
            for name in sorted(files):
                if name.endswith(".pyc"):
                    continue
                rel_file = os.path.join(rel, name) if r == "." else os.path.join(rel, r, name)
                written.append(rel_file.replace("\\", "/"))
        if not dry_run:
            copy_tree(src_abs, os.path.join(target, rel))

    # ---- 1. plugin.json（skills 清单由本脚本按映射算出，不手写） ----
    plugin_json = dict(manifest["pluginJson"])
    plugin_json["skills"] = ["./skills/%s" % s["target"] for s in manifest["skills"]]
    put(".codebuddy-plugin/plugin.json",
        json.dumps(plugin_json, ensure_ascii=False, indent=2) + "\n")

    # ---- 2. README.md + 头像位 ----
    put_copy("README.md", os.path.join(src_root, manifest["readme"]["source"]))
    written.append("avatars/.gitkeep")
    if not dry_run:
        os.makedirs(os.path.join(target, "avatars"), exist_ok=True)
        keep = os.path.join(target, "avatars", ".gitkeep")
        if not os.path.exists(keep):
            write_text(keep, "")

    # ---- 3. Prompt → agents/<agentName>.md ----
    spec = manifest["agent"]
    body = extract_body(read_text(os.path.join(src_root, spec["source"])),
                        spec.get("bodyFrom"), spec.get("bodyTo"))
    put(spec["target"], render_frontmatter(spec["frontmatter"]) + "\n" + body)

    # ---- 4. 各技能 ----
    note = manifest.get("skillNote", "")
    for skill in manifest["skills"]:
        base = "skills/%s" % skill["target"]
        src = os.path.join(src_root, skill["source"])
        body = read_text(src).strip() + "\n"
        if skill.get("kind") in ("bundle", "tools"):
            body = body + note
        put(base + "/SKILL.md", render_frontmatter(skill["frontmatter"]) + "\n" + body)

        for ref in skill.get("references", []):
            put_copy("%s/references/%s" % (base, ref["file"]),
                     os.path.join(src_root, ref["source"]))
        for ref in skill.get("toolSpecs", []):
            put_copy("%s/references/%s" % (base, ref["file"]),
                     os.path.join(src_root, ref["source"]))
        for item in skill.get("scripts", []):
            put_copy("%s/scripts/%s" % (base, item["file"]),
                     os.path.join(src_root, item["source"]))
        for key, rel in (("rulesDir", "rules"), ("contractDir", "contract"), ("assetsDir", "assets")):
            if skill.get(key):
                put_tree("%s/%s" % (base, rel), os.path.join(src_root, skill[key]))

    return sorted(set(written))


def prune_stale(target: str, written: list, keep_top: tuple = ("avatars",)) -> list:
    """删除目标目录里**不在本次装配清单内**的文件，返回被删项。

    与「先整体删目录、再写入」的做法不同：正常情况下这里**删 0 个** ——
    既不会误删用户在 `avatars/` 放的头像，也不会触发宿主「单轮删除超过阈值需确认」的安全闸
    （那个闸会在半途打断装配，留下一个不完整的包）。

    `avatars/` 顶层目录与 `.created-by-session` 会话标记始终保留。
    """
    keep_rel = {f.replace("/", os.sep) for f in written}
    keep_rel.add(".created-by-session")
    removed: list = []
    if not os.path.isdir(target):
        return removed
    for root, dirs, files in os.walk(target, topdown=False):
        rel_root = os.path.relpath(root, target)
        top = rel_root.split(os.sep)[0]
        if rel_root != "." and top in keep_top:
            continue
        for name in sorted(files):
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            if rel.split(os.sep)[0] in keep_top or rel in keep_rel:
                continue
            os.remove(os.path.join(root, name))
            removed.append(rel)
        if rel_root != ".":
            try:
                os.rmdir(root)  # 只在确实已空时成功
                removed.append(rel_root + os.sep)
            except OSError:
                pass
    return removed


# --------------------------------------------------------------------------- #
# 官方脚本
# --------------------------------------------------------------------------- #
def find_tools_dir(explicit: str | None) -> str:
    cands = [explicit] if explicit else []
    cands += [c for c in TOOLS_CANDIDATES if c]
    for cand in cands:
        if cand and os.path.isfile(os.path.join(cand, "scripts", "validate_expert.py")):
            return cand
    raise BuildError(
        "找不到 expert-manager 技能目录（需要其中的 scripts/validate_expert.py）。\n"
        "  已尝试：%s\n  可用 --tools-dir 指定。" % "；".join(c for c in cands if c))


def run_official(tools_dir: str, script: str, args: list) -> tuple[int, str]:
    cmd = [sys.executable, os.path.join(tools_dir, "scripts", script)] + args
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or "")).strip()


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="AutoGrader Expert 打包装配器")
    ap.add_argument("--validate", action="store_true", help="装配后跑官方校验器")
    ap.add_argument("--register", action="store_true", help="校验通过后注册到 marketplace.json")
    ap.add_argument("--package", action="store_true", help="装配后用官方脚本打成 zip")
    ap.add_argument("--session-id", help="注册时写入 .created-by-session 的会话 id")
    ap.add_argument("--tools-dir", help="expert-manager 技能目录（含 scripts/）")
    ap.add_argument("--dry-run", action="store_true", help="只打印将写入的文件，不落盘")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    try:
        manifest = load_manifest()
        target = resolve_target(manifest)
        check_in_target(manifest, target)
    except BuildError as exc:
        print("❌ %s" % exc)
        return 2

    print("📦 装配 AutoGrader Expert")
    print("   源：%s" % HERE)
    print("   目标：%s" % target)
    try:
        files = build(manifest, target, dry_run=args.dry_run)
    except BuildError as exc:
        print("❌ %s" % exc)
        return 2
    print("   ✅ 写入 %d 个文件" % len(files))
    if not args.dry_run:
        removed = prune_stale(target, files)
        print("   ↺ 清理不在本次清单内的残留：%d 个%s"
              % (len(removed), ("（%s）" % "、".join(removed[:5])) if removed else ""))
    if args.dry_run:
        for f in files:
            print("      %s" % f)
        return 0

    exit_code = 0

    if args.validate or args.register or args.package:
        try:
            tools_dir = find_tools_dir(args.tools_dir)
        except BuildError as exc:
            print("❌ %s" % exc)
            return 2

        if args.validate or args.register:
            code, out = run_official(tools_dir, "validate_expert.py", [target])
            print("🔍 官方校验（validate_expert.py）")
            print(_indent(out))
            if code != 0:
                print("❌ 校验未通过，后续步骤中止")
                return 1

        if args.register:
            reg_args = [target]
            if args.session_id:
                reg_args += ["--session-id", args.session_id]
            code, out = run_official(tools_dir, "register_expert.py", reg_args)
            print("📋 注册（register_expert.py）")
            print(_indent(out))
            if code != 0:
                exit_code = 1
            else:
                # 官方脚本本应写 `.created-by-session`；本机实测偶发未落（原因未定）。
                # 这里按**同一内容与同一文件**补写一次，保证「本包由哪次会话装配」这条溯源不丢。
                # 注意：只补这个标记，**不碰 marketplace.json**（注册仍只由官方脚本完成）。
                marker = os.path.join(target, ".created-by-session")
                if args.session_id and not os.path.exists(marker):
                    write_text(marker, args.session_id)
                    print("   ℹ️ 官方注册脚本未写入会话标记，已按同一格式补写：%s" % args.session_id)

        if args.package:
            code, out = run_official(tools_dir, "package_expert.py", [target])
            print("🗜  打包（package_expert.py）")
            print(_indent(out))
            if code != 0:
                exit_code = 1

    print("✅ 完成" if exit_code == 0 else "⚠️ 完成但存在失败项")
    return exit_code


def _indent(text: str) -> str:
    return "\n".join("   " + line for line in text.split("\n"))


# --------------------------------------------------------------------------- #
# 自测
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    checks: dict = {}

    checks["manifestParses"] = bool(load_manifest().get("expertDirName"))

    fm = render_frontmatter({"name": "x", "description": "纯中文描述：无 ASCII 引号",
                             "displayName": {"en": "A", "zh": "甲"}, "maxTurns": 80})
    checks["frontmatterStarts"] = fm.startswith("---\n") and fm.rstrip().endswith("---")
    checks["frontmatterQuotes"] = 'description: "纯中文描述：无 ASCII 引号"' in fm
    checks["frontmatterNested"] = 'displayName:\n  en: "A"\n  zh: "甲"' in fm
    checks["frontmatterNoTools"] = "tools:" not in fm
    # 含 ASCII 引号的字符串必须转义成合法 YAML（官方解析器只做 strip，不会反转义——
    # 所以这里只断言「转义被正确写出」，不断言官方解析器能读回原文）
    checks["frontmatterEscapesQuote"] = '\\"' in render_frontmatter({"description": '含"引号"'})

    body = extract_body("l1\n## 0 · 身份\n内容A\n# 附录\n不应出现\n", "## 0 · 身份", "# 附录")
    checks["extractBody"] = body == "## 0 · 身份\n内容A\n"

    # 官方 frontmatter 解析器（简单正则）必须能读回我们渲染的字段
    m = re.match(r"^---\n(.*?)\n---", fm, re.DOTALL)
    parsed = {}
    for line in (m.group(1) if m else "").split("\n"):
        line = line.strip()
        if ":" in line and not line.startswith("-") and not line.startswith("#"):
            k, _, v = line.partition(":")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if v:
                parsed[k] = v
    checks["officialParserReadsName"] = parsed.get("name") == "x"
    checks["officialParserReadsDescription"] = parsed.get("description") == "纯中文描述：无 ASCII 引号"

    # 目标目录必须是 `<CONFIG_DIR>/plugins/marketplaces/my-experts/plugins/<name>`
    mn = load_manifest()
    tg = resolve_target(mn)
    checks["targetUnderMarketplace"] = tg.replace("\\", "/").endswith(
        "/plugins/marketplaces/my-experts/plugins/%s" % mn["expertDirName"])
    try:
        check_in_target(mn, os.path.join(os.path.dirname(tg), "..", "elsewhere", "x"))
        checks["outsideTargetRejected"] = False
    except BuildError:
        checks["outsideTargetRejected"] = True

    # 每个技能都必须能解析到源文件，且源文件存在
    missing = []
    for skill in mn["skills"]:
        if not os.path.isfile(os.path.join(HERE, skill["source"])):
            missing.append(skill["source"])
        for key in ("references", "toolSpecs", "scripts"):
            for item in skill.get(key, []):
                if not os.path.isfile(os.path.join(HERE, item["source"])):
                    missing.append(item["source"])
        for key in ("rulesDir", "contractDir", "assetsDir"):
            if skill.get(key) and not os.path.isdir(os.path.join(HERE, skill[key])):
                missing.append(skill[key] + "/")
    checks["allSourcesExist"] = not missing
    if missing:
        print("   缺失源：%s" % missing)

    # 映射清单的展示字段必须满足官方校验：tags/quickPrompts 各 3 个且首条与 defaultInitPrompt 一致
    pj = mn["pluginJson"]
    checks["threeTags"] = len(pj.get("tags", [])) == 3
    checks["threeQuickPrompts"] = len(pj.get("quickPrompts", [])) == 3
    checks["initPromptIsFirst"] = (pj.get("quickPrompts") and
                                   pj["quickPrompts"][0]["zh"] == pj["defaultInitPrompt"]["zh"])
    dd = pj.get("displayDescription", {}).get("zh", "")
    checks["descZhLength40to50"] = 40 <= len(dd) <= 50
    checks["categoryIdValid"] = pj.get("categoryId") in {
        "01-ProductDesign", "02-Engineering", "03-GameSpatial", "04-DataAI", "05-MarketingGrowth",
        "06-ContentCreative", "07-SalesCommerce", "08-FinanceInvestment", "09-OperationsHR",
        "10-ProjectQuality", "11-SecurityCompliance", "12-IndustryConsultant"}
    checks["nameKebab"] = bool(re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", pj.get("name", "")))
    checks["pluginEqualsName"] = pj.get("plugin") == pj.get("name")
    checks["agentNameMatchesTarget"] = mn["agent"]["target"].endswith("%s.md" % pj["agentName"])
    checks["noTodoPlaceholders"] = "[TODO" not in json.dumps(mn, ensure_ascii=False)

    # 增量清理：只删「不在本次清单内」的文件；avatars/ 与会话标记必须保留
    # （防误删用户自己放的头像；也避免「整体删除」触发宿主的安全删除闸而把装配打断在半途）
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "agents"))
        os.makedirs(os.path.join(td, "avatars"))
        os.makedirs(os.path.join(td, "skills", "old-skill"))
        for rel in ("agents/a.md", "avatars/expert.png", ".created-by-session",
                    "skills/old-skill/SKILL.md", "stray.txt"):
            open(os.path.join(td, rel), "w").close()
        removed = prune_stale(td, ["agents/a.md"])
        left = set()
        for root, _dirs, fs in os.walk(td):
            for f in fs:
                left.add(os.path.relpath(os.path.join(root, f), td).replace("\\", "/"))
        checks["pruneKeepsDeclared"] = "agents/a.md" in left
        checks["pruneKeepsAvatars"] = "avatars/expert.png" in left
        checks["pruneKeepsSessionMarker"] = ".created-by-session" in left
        checks["pruneRemovesStale"] = ("stray.txt" not in left
                                       and "skills/old-skill/SKILL.md" not in left)
        checks["pruneReportsRemoved"] = any("stray" in r for r in removed)

    bad = [k for k, v in checks.items() if not v]
    print(json.dumps({"tool": "build-expert", "checks": checks}, ensure_ascii=False,
                     indent=2, sort_keys=True))
    return 0 if not bad else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BuildError as exc:  # 兜底：不裸 traceback
        print("❌ %s" % exc)
        sys.exit(2)
