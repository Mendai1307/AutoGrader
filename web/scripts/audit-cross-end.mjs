#!/usr/bin/env node
/**
 * AutoGrader · 跨端一致性对拍（浏览器端规则引擎 ↔ 工具链 T2）
 * ===========================================================================
 * 规划书 1.3.2 的完成判据写着：「跨端一致性（与 Web 端核查器输出一致）
 * 待交付物二建立后校验」。本脚本就是那次校验。
 *
 * 怎么做到"只差在实现、不差在输入"
 * ---------------------------------------------------------------------------
 * 两侧喂**同一份 T1 产物**（`--report` 指向同一个 JSON）：
 *   左：python3 tools/scripts/rule_inspector.py   （工具链 T2，Python）
 *   右：web/lib/rules-engine.ts                   （Web 端核查器，TypeScript）
 * 语料目录、默认规则集也完全相同。于是任何差异都只能来自规则引擎本身，
 * 不会被"两个解析器切块不同"这类噪声掩盖。
 *
 * 比对项
 * ---------------------------------------------------------------------------
 *   · facts 逐条：ruleId / kind / fact 文案 / value / threshold / evidenceAnchor
 *     （fact 文案是最严的一项——模板渲染差一个空格都算不一致）
 *   · notCovered / notCoveredReasons
 *   · stats（自行复算的统计特征）
 *   · reportIntegrity.summaryMismatches
 *   · rulesetDigest（含规则集摘要本身）
 *   · exitCode（T2 的退出码语义）
 *
 * 用法：node scripts/audit-cross-end.mjs [--report <t1.json> ...] [--verbose]
 *   不带 --report 时，自动对 `public/assets/samples/*.md` 先跑 T1 再对拍。
 * 退出码：0 全部一致 / 1 有差异 / 2 环境不可用（缺 python3 或工具链）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');
const TOOLS_DIR = path.join(REPO_DIR, 'backend', 'autograder-expert', 'agents', 'tools');
const RULES_FILE = path.join(WEB_DIR, 'public', 'assets', 'default.rules.json');
const CORPUS_DIR = path.join(WEB_DIR, 'public', 'assets', 'corpus');
const SAMPLES_DIR = path.join(WEB_DIR, 'public', 'assets', 'samples');

const VERBOSE = process.argv.includes('--verbose');

function argOf(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && i + 1 < process.argv.length) values.push(process.argv[i + 1]);
  }
  return values;
}

/* ==========================================================================
 * 前置检查
 * ========================================================================== */

const t1Script = path.join(TOOLS_DIR, 'scripts', 'document_parser.py');
const t2Script = path.join(TOOLS_DIR, 'scripts', 'rule_inspector.py');

for (const [label, file] of [
  ['T1 脚本', t1Script],
  ['T2 脚本', t2Script],
  ['默认规则集', RULES_FILE],
]) {
  if (!fs.existsSync(file)) {
    console.error(`[audit-cross-end] 环境不可用：找不到${label} ${file}`);
    if (label !== '默认规则集') {
      console.error('  本脚本需要工具链源码（backend/autograder-expert/agents/tools）。');
    } else {
      console.error('  请先运行 node scripts/sync-assets.mjs。');
    }
    process.exit(2);
  }
}

const py = (() => {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-V'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  console.error('[audit-cross-end] 环境不可用：找不到 python3 / python');
  process.exit(2);
})();

/* ==========================================================================
 * 载入 Web 端引擎与规则集
 * ========================================================================== */

const engine = await import(new URL('../lib/rules-engine.ts', import.meta.url).href);
const defaultRules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));

const corpus = fs.existsSync(CORPUS_DIR)
  ? fs
      .readdirSync(CORPUS_DIR)
      .filter((n) => /\.(md|txt)$/i.test(n))
      .sort()
      .map((name) => ({ name, text: fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8') }))
  : [];

/* ==========================================================================
 * 取待对拍的 T1 产物
 * ========================================================================== */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autograder-x2-'));

/** 用 Python 侧 T1 解析一份文档，返回 T1 JSON 对象 */
function runT1(inputFile) {
  const out = path.join(tmpDir, path.basename(inputFile) + '.t1.json');
  const res = spawnSync(
    py,
    [t1Script, '--input', inputFile, '--out', out],
    { encoding: 'utf8' },
  );
  if (!fs.existsSync(out)) {
    throw new Error(`T1 未产出结果（exit ${res.status}）：${res.stderr || res.stdout}`);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** 用 Python 侧 T2 核查一份 T1 产物 */
function runT2(t1File) {
  const out = path.join(tmpDir, path.basename(t1File) + '.t2.json');
  const res = spawnSync(
    py,
    [t2Script, '--report', t1File, '--corpus', CORPUS_DIR, '--out', out],
    { encoding: 'utf8' },
  );
  if (!fs.existsSync(out)) {
    throw new Error(`T2 未产出结果（exit ${res.status}）：${res.stderr || res.stdout}`);
  }
  return { doc: JSON.parse(fs.readFileSync(out, 'utf8')), exitCode: res.status };
}

const explicitReports = argOf('--report');
let cases = [];

if (explicitReports.length > 0) {
  cases = explicitReports.map((file) => ({ label: path.basename(file), t1File: path.resolve(file) }));
} else {
  const samples = fs.existsSync(SAMPLES_DIR)
    ? fs.readdirSync(SAMPLES_DIR).filter((n) => n.endsWith('.md')).sort()
    : [];
  if (samples.length === 0) {
    console.error('[audit-cross-end] 环境不可用：既没有 --report，也找不到 public/assets/samples/*.md');
    process.exit(2);
  }
  for (const name of samples) {
    const input = path.join(SAMPLES_DIR, name);
    const t1 = runT1(input);
    const t1File = path.join(tmpDir, name + '.t1.json');
    fs.writeFileSync(t1File, JSON.stringify(t1), 'utf8');
    cases.push({ label: name, t1File });
  }
}

/* ==========================================================================
 * 对拍
 * ========================================================================== */

/** 只保留参与比对的字段（顺序固定，便于逐字比较） */
function normalizeFact(fact) {
  const out = {
    ruleId: fact.ruleId,
    kind: fact.kind,
    source: fact.source,
    fact: fact.fact,
    evidenceAnchor: fact.evidenceAnchor ?? null,
    value: fact.value === undefined ? null : fact.value,
  };
  if (fact.threshold !== undefined) out.threshold = fact.threshold;
  if (fact.matchedHeading !== undefined) out.matchedHeading = fact.matchedHeading;
  if (fact.matchedPattern !== undefined) out.matchedPattern = fact.matchedPattern;
  if (fact.bestMatch !== undefined) out.bestMatch = fact.bestMatch;
  return out;
}

/**
 * 键序无关的深度规范化。
 * JSON 对象的键序不承载语义，两侧语言/序列化器的排序策略也不同
 * （T2 落盘时按字母序排键）。比"值"而不是比"文本顺序"，否则会报出一堆假差异。
 * 数组顺序**保留**——数组顺序是有语义的（例如 facts 按 ruleId 排序是刻意的）。
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

/** 规范化后逐字比较 */
function sameJson(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

const failures = [];
let caseIndex = 0;

console.log('');
console.log('  [audit-cross-end] 跨端一致性对拍：Web 端 ↔ 工具链（T1 + T2）');
console.log('  ' + '─'.repeat(76));
console.log(`  Python: ${py}   语料: ${corpus.length} 份   样例: ${cases.length} 份`);
console.log('  ' + '─'.repeat(76));

/* ==========================================================================
 * 阶段 A：解析器对拍（Web 端 lib/parse.ts ↔ 工具链 T1）
 * ---------------------------------------------------------------------------
 * 只有"块切得一样"，后面"规则判得一样"才有意义。
 * 比对 blocks 全量（blockId/kind/anchor/text/rawText）、结构树、统计、status
 * 与 sourceFile.digest。
 * ========================================================================== */

const parseModule = await import(new URL('../lib/parse.ts', import.meta.url).href);

console.log('');
console.log('  阶段 A · 解析器对拍（lib/parse.ts ↔ T1）');

for (const testCase of cases) {
  const sampleFile = path.join(SAMPLES_DIR, testCase.label);
  if (!fs.existsSync(sampleFile)) {
    console.log(`  ·  ${testCase.label.padEnd(22, ' ')} 跳过（源文件不在 samples/，只做阶段 B）`);
    continue;
  }
  const pyT1 = JSON.parse(fs.readFileSync(testCase.t1File, 'utf8'));
  const jsT1 = parseModule.parseTextDocument(fs.readFileSync(sampleFile, 'utf8'), testCase.label, 'md');

  const diffs = [];
  if (!sameJson(pyT1.summary, jsT1.summary)) diffs.push('统计 summary');
  if (!sameJson(pyT1.structure, jsT1.structure)) diffs.push('结构树 structure');
  if (!sameJson(pyT1.blocks, jsT1.blocks)) diffs.push('结构块 blocks');
  if (pyT1.status !== jsT1.status) diffs.push(`status ${pyT1.status}/${jsT1.status}`);
  if ((pyT1.sourceFile?.digest ?? '') !== jsT1.sourceFile.digest) diffs.push('sourceFile.digest');
  if ((pyT1.emptyHeadingParagraphs ?? 0) !== jsT1.emptyHeadingParagraphs) diffs.push('空标题段计数');

  if (diffs.length === 0) {
    console.log(
      `  ✓  ${testCase.label.padEnd(22, ' ')} blocks ${pyT1.blocks.length} 个全量一致 · ` +
        `结构树 ${pyT1.structure.length} 根 · status ${pyT1.status}`,
    );
  } else {
    failures.push(`阶段A ${testCase.label}：${diffs.join('、')}`);
    console.log(`  ✗  ${testCase.label.padEnd(22, ' ')} ${diffs.join('、')}`);
  }
}

/* ==========================================================================
 * 阶段 B：规则引擎对拍（Web 端 lib/rules-engine.ts ↔ 工具链 T2）
 * ========================================================================== */

console.log('');
console.log('  阶段 B · 规则引擎对拍（lib/rules-engine.ts ↔ T2）');

for (const testCase of cases) {
  caseIndex += 1;
  const pyResult = runT2(testCase.t1File);
  const t1Doc = JSON.parse(fs.readFileSync(testCase.t1File, 'utf8'));

  let jsResult;
  try {
    jsResult = engine.runRules(t1Doc, { defaultRules, corpus });
  } catch (error) {
    failures.push(`${testCase.label}：JS 引擎抛错 ${error.message}`);
    console.log(`  ✗  ${testCase.label.padEnd(22, ' ')} JS 引擎异常`);
    continue;
  }

  const pyFacts = pyResult.doc.facts.map(normalizeFact);
  const jsFacts = jsResult.facts.map(normalizeFact);

  const diffs = [];

  // 1. facts 条数与逐条内容
  if (pyFacts.length !== jsFacts.length) {
    diffs.push(`facts 条数 Python=${pyFacts.length} / JS=${jsFacts.length}`);
  }
  const max = Math.max(pyFacts.length, jsFacts.length);
  for (let i = 0; i < max; i += 1) {
    const a = pyFacts[i];
    const b = jsFacts[i];
    if (!sameJson(a, b)) {
      diffs.push(`facts[${i}] 不一致：\n        Python ${JSON.stringify(a)}\n        JS     ${JSON.stringify(b)}`);
    }
  }

  // 2. notCovered 与原因
  if (JSON.stringify(pyResult.doc.notCovered) !== JSON.stringify(jsResult.notCovered)) {
    diffs.push(
      `notCovered 不一致：Python ${JSON.stringify(pyResult.doc.notCovered)} / JS ${JSON.stringify(jsResult.notCovered)}`,
    );
  }
  const pyReasons = pyResult.doc.notCoveredReasons ?? {};
  const jsReasons = jsResult.notCoveredReasons;
  for (const key of new Set([...Object.keys(pyReasons), ...Object.keys(jsReasons)])) {
    if (pyReasons[key] !== jsReasons[key]) {
      diffs.push(`notCoveredReasons["${key}"] 不一致：Python ${JSON.stringify(pyReasons[key])} / JS ${JSON.stringify(jsReasons[key])}`);
    }
  }

  // 3. stats（自行复算的统计特征）
  if (!sameJson(pyResult.doc.stats, jsResult.stats)) {
    diffs.push(`stats 不一致：Python ${JSON.stringify(pyResult.doc.stats)} / JS ${JSON.stringify(jsResult.stats)}`);
  }

  // 4. 自洽性核对
  if (!sameJson(pyResult.doc.reportIntegrity?.summaryMismatches ?? [], jsResult.reportIntegrity.summaryMismatches)) {
    diffs.push('summaryMismatches 不一致');
  }

  // 5. 规则集摘要（对字节敏感）
  if (pyResult.doc.rulesetDigest?.rulesetDigest !== jsResult.rulesetDigest.rulesetDigest) {
    diffs.push(
      `rulesetDigest 不一致：Python ${pyResult.doc.rulesetDigest?.rulesetDigest} / JS ${jsResult.rulesetDigest.rulesetDigest}`,
    );
  }

  // 5b. 摘要块其余字段（只读性/规则数/停用清单）
  if (!sameJson(pyResult.doc.rulesetDigest, jsResult.rulesetDigest)) {
    diffs.push(
      `rulesetDigest 明细不一致：Python ${JSON.stringify(pyResult.doc.rulesetDigest)} / JS ${JSON.stringify(jsResult.rulesetDigest)}`,
    );
  }

  // 6. 退出码语义
  if (pyResult.exitCode !== jsResult.exitCode) {
    diffs.push(`exitCode 不一致：Python ${pyResult.exitCode} / JS ${jsResult.exitCode}`);
  }

  if (diffs.length === 0) {
    console.log(
      `  ✓  ${testCase.label.padEnd(22, ' ')} facts ${pyFacts.length} 条逐条一致 · ` +
        `notCovered ${jsResult.notCovered.length} · exit ${jsResult.exitCode} · digest ${jsResult.rulesetDigest.rulesetDigest.slice(7, 15)}…`,
    );
    if (VERBOSE) {
      for (const fact of jsFacts) console.log(`        · ${fact.ruleId} = ${JSON.stringify(fact.value)}  ${fact.fact}`);
    }
  } else {
    failures.push(`${testCase.label}：${diffs.length} 处差异`);
    console.log(`  ✗  ${testCase.label.padEnd(22, ' ')} ${diffs.length} 处差异`);
    for (const d of diffs.slice(0, 6)) console.log(`        ${d}`);
  }
}

/* ==========================================================================
 * 汇总
 * ========================================================================== */

console.log('  ' + '─'.repeat(76));
if (failures.length > 0) {
  console.log(`  ${failures.length} / ${caseIndex} 份存在差异`);
  console.log('');
  // 清理临时目录（尽力而为，失败不影响结论）
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
}
console.log(`  全部一致（${caseIndex} 份）—— 跨端一致性成立`);
console.log('');
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}
