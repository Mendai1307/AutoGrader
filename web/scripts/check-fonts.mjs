#!/usr/bin/env node
/**
 * AutoGrader · 字体子集自检（构建期门禁）
 * ===========================================================================
 * MiSans 是按字符集裁剪后才入库的（四档共 225 个分片 / 约 5.3 MB，
 * 未裁剪则 24.4 MB）。裁剪带来了一个必须守住的风险：
 * **新写的文案里若出现子集外的字符，页面就会掉字（豆腐块）**。
 *
 * 本脚本把这件事变成构建期可判定的检查，三项：
 *   A. 产物完整性：misans.css 中每个 url() 都指向真实存在的 woff2；
 *      SUBSET.json 的聚合摘要与实际文件一致（防止有人手改分片而不同步清单）。
 *   B. 数据资产覆盖（**硬失败**）：public/ 下的数据（结果 JSON、样例报告、
 *      金标准、规则集）会被页面**逐字渲染**，其中任何字符未被覆盖都是真缺陷。
 *   C. 源码文案覆盖（**警告**）：app/ 与 components/ 里的字符串字面量大多会被渲染，
 *      但源码里也有控制台输出、类名等非渲染文本，故只警告、不失败。
 *
 * 失败时脚本会打印缺失的字符，按提示重跑
 *   python3 scripts/sync_fonts.py --from <misans-webfont 目录>
 * 即可（重跑会把新字符对应的分片纳入子集）。
 *
 * 退出码：0 通过（允许有警告）/ 1 有硬失败 / 2 入参或环境不可用
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');

const FONTS_DIR = path.join(WEB_DIR, 'public', 'fonts');
const CSS_FILE = path.join(FONTS_DIR, 'misans.css');
const SUBSET_FILE = path.join(FONTS_DIR, 'SUBSET.json');

const failures = [];
const warnings = [];
const lines = [];

function ok(name, detail) {
  lines.push(`  ✓  ${name.padEnd(38, ' ')} ${detail}`);
}
function fail(name, detail) {
  failures.push(`${name}：${detail}`);
  lines.push(`  ✗  ${name.padEnd(38, ' ')} ${detail}`);
}
function warn(name, detail) {
  warnings.push(`${name}：${detail}`);
  lines.push(`  !  ${name.padEnd(38, ' ')} ${detail}`);
}

/* ==========================================================================
 * 前置：产物是否存在
 * ========================================================================== */

if (!fs.existsSync(CSS_FILE) || !fs.existsSync(SUBSET_FILE)) {
  console.error('[check-fonts] 失败：字体产物缺失。');
  console.error(`  期望存在：${CSS_FILE}`);
  console.error(`  期望存在：${SUBSET_FILE}`);
  console.error('  生成方式：python3 scripts/sync_fonts.py --from <misans-webfont 目录>');
  process.exit(2);
}

const css = fs.readFileSync(CSS_FILE, 'utf8');
const subset = JSON.parse(fs.readFileSync(SUBSET_FILE, 'utf8'));

/* ==========================================================================
 * A. 产物完整性
 * ========================================================================== */

const urlRe = /url\("\.\/([^"]+)"\)/g;
const declaredFiles = [];
let m;
while ((m = urlRe.exec(css)) !== null) declaredFiles.push(m[1]);

const missingFiles = declaredFiles.filter((rel) => !fs.existsSync(path.join(FONTS_DIR, rel)));
if (declaredFiles.length === 0) {
  fail('A1 CSS 引用分片数', 'misans.css 中没有任何 url() 引用');
} else if (missingFiles.length > 0) {
  fail('A1 分片文件齐全', `缺 ${missingFiles.length} 个，例：${missingFiles.slice(0, 3).join(', ')}`);
} else {
  ok('A1 分片文件齐全', `${declaredFiles.length} 个 url() 全部命中实体文件`);
}

// 磁盘上多出来的分片（不在 CSS 里）只算警告：不影响渲染，但属于体积浪费
const onDisk = [];
const walk = (dir, base) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base);
    else if (entry.name.endsWith('.woff2')) onDisk.push(path.relative(FONTS_DIR, abs).split(path.sep).join('/'));
  }
};
walk(path.join(FONTS_DIR, 'misans'), FONTS_DIR);
const orphan = onDisk.filter((rel) => !declaredFiles.includes(rel));
if (orphan.length > 0) warn('A2 无引用分片', `${orphan.length} 个（不影响渲染，可 --prune 清理）`);
else ok('A2 无引用分片', '0 个');

// 聚合摘要：防"手改分片但没更新清单"
const entries = declaredFiles
  .map((rel) => {
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(FONTS_DIR, rel)))
      .digest('hex');
    return [rel, digest];
  })
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));

const aggregate = (() => {
  const h = crypto.createHash('sha256');
  for (const [rel, digest] of entries) {
    h.update(rel, 'utf8');
    h.update(Buffer.from([0]));
    h.update(digest, 'ascii');
    h.update('\n', 'utf8');
  }
  return 'sha256:' + h.digest('hex');
})();

if (subset.aggregateDigest === aggregate) {
  ok('A3 聚合摘要一致', subset.aggregateDigest.slice(0, 22) + '…');
} else {
  fail(
    'A3 聚合摘要一致',
    `清单声明 ${String(subset.aggregateDigest).slice(0, 22)}…，实测 ${aggregate.slice(0, 22)}…` +
      '（分片被改动但清单未重新生成）',
  );
}

// 字重完整性：四档都要有
const declaredWeights = new Set(
  [...css.matchAll(/font-weight:\s*(\d+)/g)].map((x) => Number(x[1])),
);
const expectedWeights = [300, 400, 600, 700];
const missingWeights = expectedWeights.filter((w) => !declaredWeights.has(w));
if (missingWeights.length > 0) fail('A4 四档字重齐备', `缺 ${missingWeights.join(', ')}`);
else ok('A4 四档字重齐备', expectedWeights.join(' / '));

/* ==========================================================================
 * 解析 CSS 里声明的 unicode-range，得到"已覆盖码位集合"
 * ========================================================================== */

const covered = new Set();
for (const face of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const range = /unicode-range:([^;}]+)/.exec(face[1]);
  if (!range) continue;
  for (const part of range[1].split(',')) {
    const t = part.trim().replace(/^U\+/i, '');
    if (t === '') continue;
    if (t.includes('-')) {
      const [lo, hi] = t.split('-');
      for (let cp = parseInt(lo, 16); cp <= parseInt(hi, 16); cp += 1) covered.add(cp);
    } else {
      covered.add(parseInt(t, 16));
    }
  }
}
if (covered.size === 0) fail('B0 unicode-range 解析', '一条都没解析到');
else ok('B0 已覆盖码位', `${covered.size} 个码位`);

/* ==========================================================================
 * B. 数据资产覆盖（硬失败）
 * ========================================================================== */

/** 收集某个目录树里文本文件的字符（按后缀过滤，跳过指定目录） */
function collectChars(root, exts, skipDirs, stripComments = false) {
  const out = new Map(); // cp -> 出现该字符的文件（取第一个，便于定位）
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!exts.has(path.extname(entry.name).toLowerCase())) continue;
      let text;
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (stripComments) text = stripCommentsFrom(text);
      const rel = path.relative(WEB_DIR, abs).split(path.sep).join('/');
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) continue; // ASCII 必然覆盖（分片 0 含 U+20–7A）
        if (!out.has(cp)) out.set(cp, rel);
      }
    }
  }
  return out;
}

/**
 * 粗暴剥掉注释，只为**降低误报**：注释里的字符不会被渲染，
 * 但注释里出现的符号（⚠ ✗ 之类）会污染"源码文案覆盖"的结论。
 * （`//` 前一个字符若是 `:` 则保留，避免把 https:// 当成行注释。）
 */
function stripCommentsFrom(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1');
}

const DATA_EXTS = new Set(['.json', '.md', '.txt', '.csv']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);
const SKIP = new Set(['node_modules', '.next', 'out', '.git', 'fonts']);

const dataChars = collectChars(path.join(WEB_DIR, 'public'), DATA_EXTS, SKIP);
const uncoveredData = [...dataChars.entries()].filter(([cp]) => !covered.has(cp));
if (uncoveredData.length === 0) {
  ok('B1 数据资产字符覆盖', `${dataChars.size} 个非 ASCII 码位全部覆盖`);
} else {
  const sample = uncoveredData
    .slice(0, 24)
    .map(([cp, file]) => `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}(${file})`)
    .join('  ');
  fail(
    'B1 数据资产字符覆盖',
    `${uncoveredData.length} 个码位未覆盖 —— 会被页面逐字渲染，必掉字：${sample}`,
  );
}

/* ==========================================================================
 * C. 源码文案覆盖（警告）
 * ========================================================================== */

const srcChars = new Map();
for (const sub of ['app', 'components', 'lib']) {
  for (const [cp, file] of collectChars(path.join(WEB_DIR, sub), SOURCE_EXTS, SKIP, true)) {
    if (!srcChars.has(cp)) srcChars.set(cp, file);
  }
}
const uncoveredSrc = [...srcChars.entries()].filter(([cp]) => !covered.has(cp));
if (uncoveredSrc.length === 0) {
  ok('C1 源码文案字符覆盖', `${srcChars.size} 个非 ASCII 码位全部覆盖`);
} else {
  const isRenderable = (cp) => {
    // 只报"可能被渲染"的：CJK、中文标点、常见符号；控制字符与私用区不报
    return (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0x2000 && cp <= 0x206f) ||
      (cp >= 0x2100 && cp <= 0x27bf)
    );
  };
  const notable = uncoveredSrc.filter(([cp]) => isRenderable(cp));
  if (notable.length === 0) {
    ok('C1 源码文案字符覆盖', `${srcChars.size} 个非 ASCII 码位全部覆盖（余 ${uncoveredSrc.length} 个非渲染字符）`);
  } else {
    warn(
      'C1 源码文案字符覆盖',
      `${notable.length} 个可能被渲染的码位未覆盖：` +
        notable
          .slice(0, 16)
          .map(([cp, file]) => `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}(${file})`)
          .join('  '),
    );
  }
}

/* ==========================================================================
 * 汇总
 * ========================================================================== */

console.log('');
console.log('  [check-fonts] MiSans 子集自检');
console.log('  ' + '─'.repeat(72));
for (const line of lines) console.log(line);
console.log('  ' + '─'.repeat(72));
console.log(
  `  分片 ${declaredFiles.length} 个 · 体积 ${(subset.totalBytes / 1048576).toFixed(2)} MB · ` +
    `源包 ${subset.source?.package ?? '?'}@${subset.source?.version ?? '?'}`,
);

if (failures.length > 0) {
  console.log(`  失败 ${failures.length} 项${warnings.length > 0 ? `／警告 ${warnings.length} 项` : ''}`);
  console.log('');
  process.exit(1);
}
console.log(`  全部通过${warnings.length > 0 ? `（${warnings.length} 项警告）` : ''}`);
console.log('');
