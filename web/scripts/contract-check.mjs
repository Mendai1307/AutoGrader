#!/usr/bin/env node
/**
 * AutoGrader · 契约一致性门禁（构建期第二步）
 * ===========================================================================
 * 拦的是这一类事故：**前端 Zod 契约与冻结契约 JSON Schema 悄悄分叉**。
 * 分叉之后，前端"校验通过"与工具链 T5"校验通过"不再是同一件事，
 * 结果文件会在一端合法、在另一端报错，而没人知道是为什么。
 *
 * 本脚本做四件事
 * ---------------------------------------------------------------------------
 *   ① **字段集合双向比对**：把 web/lib/schema.ts 的 Zod 结构递归展开，
 *      与 contract/ReviewResult.schema.json + Rubric.schema.json 逐层比对。
 *      多一个键 = 前端自造字段；少一个键 = 漏实现契约字段。任一不等即失败。
 *   ② **未覆盖 $defs 报告**：合同里的每个 `$defs` 条目都要能被比到，
 *      否则说明"有定义没被检查"，属静默漏检。
 *   ③ **12 份资产 + 夹具全量校验**：任何一份不合规即失败（数据坏了不许出包）。
 *   ④ **指纹双实现等价**：对同一批文档分别跑 web/lib/fingerprint.ts 与
 *      contract/fingerprint.mjs，结果必须逐字相同 —— 这是"前端复算指纹"
 *      这件事成立的唯一依据。
 *
 * 实现要点
 * ---------------------------------------------------------------------------
 *   - 直接用 Node 22 的类型剥离加载 .ts（`import('../lib/schema.ts')`），
 *     不再引入构建步骤；副作用是容器里 Node 必须 ≥ 22.6。
 *   - Zod 的 `.strict().refine()` 会产出 ZodEffects，需 `innerType()` 解包；
 *     optional / nullable 需 `unwrap()`；数组取 `element`。
 *
 * 退出码：0 全部通过 / 1 有硬失败 / 2 环境或文件不可用
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');
const CONTRACT_DIR = path.join(REPO_DIR, 'contract');

const failures = [];
const warnings = [];
const lines = [];

function ok(name, detail) {
  lines.push(`  ✓  ${name.padEnd(34, ' ')} ${detail}`);
}
function fail(name, detail) {
  failures.push(`${name}：${detail}`);
  lines.push(`  ✗  ${name.padEnd(34, ' ')} ${detail}`);
}
function warn(name, detail) {
  warnings.push(`${name}：${detail}`);
  lines.push(`  !  ${name.padEnd(34, ' ')} ${detail}`);
}

/* ==========================================================================
 * 载入两侧契约
 * ========================================================================== */

const reviewSchemaFile = path.join(CONTRACT_DIR, 'ReviewResult.schema.json');
const rubricSchemaFile = path.join(CONTRACT_DIR, 'Rubric.schema.json');

if (!fs.existsSync(reviewSchemaFile) || !fs.existsSync(rubricSchemaFile)) {
  console.error('[contract-check] 失败：找不到冻结契约文件。');
  console.error(`  期望：${reviewSchemaFile}`);
  console.error(`  期望：${rubricSchemaFile}`);
  console.error('  若该脚本在只有 web/ 的目录下运行，请先用 --skip-contract-json 跳过①②。');
  process.exit(2);
}

const reviewJson = JSON.parse(fs.readFileSync(reviewSchemaFile, 'utf8'));
const rubricJson = JSON.parse(fs.readFileSync(rubricSchemaFile, 'utf8'));

let zod;
try {
  zod = await import('../lib/schema.ts');
} catch (error) {
  console.error('[contract-check] 失败：无法加载 web/lib/schema.ts。');
  console.error('  需要 Node ≥ 22.6（类型剥离）。当前版本：' + process.version);
  console.error('  底层错误：' + error.message);
  process.exit(2);
}

/* ==========================================================================
 * Zod 解包工具
 * ========================================================================== */

/** 递归解包 ZodEffects / Optional / Nullable / Default / Brand，拿到"真实类型" */
function unwrapZod(schema) {
  let current = schema;
  for (let i = 0; i < 32; i += 1) {
    const typeName = current?._def?.typeName;
    if (typeName === 'ZodEffects') {
      current = current.innerType();
      continue;
    }
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodReadonly' ||
      typeName === 'ZodBranded' ||
      typeName === 'ZodCatch'
    ) {
      current = current.unwrap();
      continue;
    }
    if (typeName === 'ZodPipeline') {
      current = current._def.out;
      continue;
    }
    return current;
  }
  return current;
}

/** 取对象的字段 map；非对象返回 null */
function zodShape(schema) {
  const s = unwrapZod(schema);
  if (s?._def?.typeName !== 'ZodObject') return null;
  return s.shape;
}

/** 取数组元素 schema；非数组返回 null */
function zodElement(schema) {
  const s = unwrapZod(schema);
  if (s?._def?.typeName !== 'ZodArray') return null;
  return s.element;
}

/* ==========================================================================
 * JSON Schema 解包工具
 * ========================================================================== */

/**
 * 解析 $ref。
 *
 * ⚠️ 关键点：`#/...` 必须**相对于"当前所在文档的根"**解析，不能一律拿 ReviewResult 当根。
 *    合同里 `rubric` 字段是 `{"$ref": "Rubric.schema.json"}`（跨文件），
 *    而 Rubric 文档内部又有 `{"$ref": "#/$defs/RubricItem"}` ——
 *    若把后者也拿去 ReviewResult 里找，就会误判成"契约侧未定义对象"。
 *    这正是本脚本第一次运行时抓出来的假失败，修法是把 docRoot 一路带下去。
 */
function resolveRef(ref, docRoot) {
  if (ref.endsWith('.json')) {
    const file = path.join(CONTRACT_DIR, path.basename(ref));
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { node: parsed, docRoot: parsed };
  }
  if (ref.startsWith('#/')) {
    let node = docRoot;
    for (const seg of ref.slice(2).split('/')) node = node?.[seg];
    return node ? { node, docRoot } : null;
  }
  return null;
}

/** 把节点解到"对象形态"：解 $ref（带文档上下文）；对 oneOf/anyOf/allOf 取第一个对象分支 */
function resolveJsonObject(node, docRoot = reviewJson) {
  let current = node;
  let root = docRoot;
  for (let i = 0; i < 32 && current; i += 1) {
    if (current.$ref) {
      const resolved = resolveRef(current.$ref, root);
      if (resolved === null) return null;
      current = resolved.node;
      root = resolved.docRoot;
      continue;
    }
    if (current.type === 'object' || current.properties) return { obj: current, docRoot: root };
    const branches = current.oneOf ?? current.anyOf ?? current.allOf;
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        const resolved = resolveJsonObject(branch, root);
        if (resolved !== null) return resolved;
      }
    }
    return null;
  }
  return null;
}

/**
 * 被比对过的 $defs 名字，按**所属文档**分别记录。
 * 目的：合同里若有"有定义却没被检查"的条目，属静默漏检，必须报出来。
 */
const touchedDefs = { ReviewResult: new Set(), Rubric: new Set() };

function noteRef(ref, docRoot) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref ?? '');
  if (!m) return;
  const which = docRoot === rubricJson ? 'Rubric' : 'ReviewResult';
  touchedDefs[which].add(m[1]);
}

/* ==========================================================================
 * ① 递归比对字段集合
 * ========================================================================== */

const mismatches = [];
let comparedObjects = 0;
let comparedFields = 0;

/**
 * 逐层比对一对（Zod schema, JSON Schema 节点）。
 * 只在"两侧都解到对象"时比字段；碰到没有 properties 的自由对象则跳过。
 */
function compare(label, zodSchema, jsonNode, docRoot) {
  const shape = zodShape(zodSchema);
  if (shape === null) return; // 前端这边不是对象（标量/数组），不作为对象比

  const resolved = jsonNode ? resolveJsonObject(jsonNode, docRoot) : null;
  if (resolved === null) {
    mismatches.push(`${label}：web 侧是对象，契约侧不是对象或未定义`);
    return;
  }

  const props = resolved.obj.properties;
  if (props === undefined) return; // 契约侧不约束字段（自由对象），跳过

  comparedObjects += 1;
  const zodKeys = Object.keys(shape).sort();
  const jsonKeys = Object.keys(props).sort();

  const onlyZod = zodKeys.filter((k) => !jsonKeys.includes(k));
  const onlyJson = jsonKeys.filter((k) => !zodKeys.includes(k));

  if (onlyZod.length > 0) {
    mismatches.push(`${label}：web 侧多出契约没有的字段 → ${onlyZod.join(', ')}`);
  }
  if (onlyJson.length > 0) {
    mismatches.push(`${label}：web 侧缺契约要求的字段 → ${onlyJson.join(', ')}`);
  }
  comparedFields += zodKeys.filter((k) => jsonKeys.includes(k)).length;

  // 递归：只对共同字段继续深入
  for (const key of zodKeys.filter((k) => jsonKeys.includes(k))) {
    const childZod = shape[key];
    const childJson = props[key];
    if (childJson?.$ref) noteRef(childJson.$ref, resolved.docRoot);

    // 数组：下探元素
    const elem = zodElement(childZod);
    const jsonElem = childJson?.items ?? null;
    if (elem !== null && jsonElem !== null) {
      if (jsonElem.$ref) noteRef(jsonElem.$ref, resolved.docRoot);
      compare(`${label}.${key}[]`, elem, jsonElem, resolved.docRoot);
      continue;
    }

    compare(`${label}.${key}`, childZod, childJson, resolved.docRoot);
  }
}

compare('ReviewResult', zod.ReviewResultSchema, reviewJson, reviewJson);
compare('Rubric', zod.RubricSchema, rubricJson, rubricJson);

if (mismatches.length === 0) {
  ok('① 字段集合双向相等', `${comparedObjects} 个对象层 / ${comparedFields} 个字段，无差异`);
} else {
  fail('① 字段集合双向相等', `${mismatches.length} 处不一致`);
  for (const item of mismatches.slice(0, 12)) lines.push(`        · ${item}`);
  if (mismatches.length > 12) lines.push(`        · …另有 ${mismatches.length - 12} 处`);
}

/* ==========================================================================
 * ② 未覆盖的 $defs（静默漏检检查）
 * ========================================================================== */

// 这些是叶子类型（标量/枚举/可空包装），本来就不会作为"对象层"被比到
const LEAF_DEFS = new Set([
  'SchemaVersion',
  'Confidence',
  'ScoreLevel',
  'Grade',
  'NullableString',
  'NullableScore',
  'CheckStatus',
]);

const defReports = [];
let silentGaps = [];
for (const [docName, doc] of [
  ['ReviewResult', reviewJson],
  ['Rubric', rubricJson],
]) {
  const defs = Object.keys(doc.$defs ?? {});
  const nonLeaf = defs.filter((d) => !LEAF_DEFS.has(d));
  const untouched = nonLeaf.filter((d) => !touchedDefs[docName].has(d));
  defReports.push(`${docName} ${defs.length} 个定义（非叶子 ${nonLeaf.length}）`);
  if (untouched.length > 0) {
    silentGaps.push(`${docName}：${untouched.join(', ')}`);
  }
}

if (silentGaps.length === 0) {
  ok('② $defs 无静默漏检', `${defReports.join(' · ')}，均已比对`);
} else {
  fail('② $defs 无静默漏检', `未被比对的非叶子定义 → ${silentGaps.join('；')}`);
}

/* ==========================================================================
 * ③ 资产与夹具全量校验
 * ========================================================================== */

const resultsDir = path.join(WEB_DIR, 'public', 'results');
const resultFiles = fs.existsSync(resultsDir)
  ? fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  : [];

let assetOk = 0;
const assetBad = [];
for (const file of resultFiles) {
  const doc = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
  const verdict = zod.validateReviewResult(doc);
  if (verdict.ok) assetOk += 1;
  else assetBad.push({ file, issues: verdict.issues });
}
if (assetBad.length === 0 && resultFiles.length > 0) {
  ok('③ 历史资产全量校验', `${assetOk} / ${resultFiles.length} 通过`);
} else if (resultFiles.length === 0) {
  fail('③ 历史资产全量校验', 'public/results/ 下找不到任何结果文件');
} else {
  fail('③ 历史资产全量校验', `${assetBad.length} / ${resultFiles.length} 不合规`);
  for (const bad of assetBad.slice(0, 4)) {
    lines.push(`        · ${bad.file}`);
    for (const issue of bad.issues.slice(0, 3)) {
      lines.push(`            ${issue.path} → ${issue.message.slice(0, 100)}`);
    }
  }
}

// 夹具：覆盖 1.0.0 资产覆盖不到的取值域（total.grade 非 null、taskType 等）
const fixturesDir = path.join(WEB_DIR, 'fixtures');
const fixtureFiles = fs.existsSync(fixturesDir)
  ? fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort()
  : [];
let fixtureOk = 0;
const fixtureBad = [];
for (const file of fixtureFiles) {
  const doc = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
  const verdict = zod.validateReviewResult(doc);
  if (verdict.ok) fixtureOk += 1;
  else fixtureBad.push({ file, issues: verdict.issues });
}
if (fixtureOk > 0 && fixtureBad.length === 0) {
  ok('④ 夹具覆盖扩展取值域', `${fixtureOk} / ${fixtureFiles.length} 通过`);
} else if (fixtureFiles.length === 0) {
  warn('④ 夹具覆盖扩展取值域', 'fixtures/ 下没有夹具，total.grade 等分支未被覆盖');
} else {
  fail('④ 夹具覆盖扩展取值域', `${fixtureBad.length} 个夹具不合规`);
  for (const bad of fixtureBad.slice(0, 3)) {
    lines.push(`        · ${bad.file}`);
    for (const issue of bad.issues.slice(0, 3)) {
      lines.push(`            ${issue.path} → ${issue.message.slice(0, 100)}`);
    }
  }
}

/* ==========================================================================
 * ④ 指纹双实现等价
 * ========================================================================== */

const refFingerprintFile = path.join(CONTRACT_DIR, 'fingerprint.mjs');
if (!fs.existsSync(refFingerprintFile)) {
  warn('⑤ 指纹双实现等价', '找不到 contract/fingerprint.mjs（自包含构建），已跳过');
} else {
  const ref = await import(pathToFileURL(refFingerprintFile).href);
  const mine = await import('../lib/fingerprint.ts');

  const docs = [
    ...resultFiles.map((f) => ({
      label: `public/results/${f}`,
      doc: JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8')),
    })),
    ...fixtureFiles.map((f) => ({
      label: `fixtures/${f}`,
      doc: JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8')),
    })),
    // 边界文档：自指字段缺失 / 为空串 / 键序不同 / 数字需 round2
    {
      label: '(边界) 自指字段缺失',
      doc: { schemaVersion: '1.0.0', provenance: { schemaVersion: '1.0.0' } },
    },
    {
      label: '(边界) 自指字段为空串',
      doc: { schemaVersion: '1.0.0', provenance: { schemaVersion: '1.0.0', resultFingerprint: '' } },
    },
    {
      label: '(边界) 键序颠倒 + round2',
      doc: { b: 2.675, a: { z: 0.125, y: [1, 2.005] }, provenance: {} },
    },
  ];

  let same = 0;
  const diff = [];
  for (const { label, doc } of docs) {
    const a = await ref.fingerprint(doc);
    const b = await mine.fingerprint(doc);
    if (a === b) same += 1;
    else diff.push({ label, ref: a, mine: b });
  }

  // 顺带校验：12 份资产声明的指纹与复算值是否相等（这是"可审计"这句话的凭据）
  let declaredMatch = 0;
  for (const file of resultFiles) {
    const doc = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
    const computed = await mine.fingerprint(doc);
    if (doc?.provenance?.resultFingerprint === computed) declaredMatch += 1;
  }

  if (diff.length === 0) {
    ok('⑤ 指纹双实现等价', `${same} / ${docs.length} 份文档两侧逐字相同`);
  } else {
    fail('⑤ 指纹双实现等价', `${diff.length} 份文档两侧不同`);
    for (const d of diff.slice(0, 3)) {
      lines.push(`        · ${d.label}`);
      lines.push(`            contract: ${d.ref}`);
      lines.push(`            web:      ${d.mine}`);
    }
  }

  if (declaredMatch === resultFiles.length && resultFiles.length > 0) {
    ok('⑥ 资产指纹可复算', `${declaredMatch} / ${resultFiles.length} 份声明值与复算值相等`);
  } else {
    fail(
      '⑥ 资产指纹可复算',
      `${declaredMatch} / ${resultFiles.length} 份相等（不一致说明内容与声明指纹对不上）`,
    );
  }
}

/* ==========================================================================
 * 汇总
 * ========================================================================== */

console.log('');
console.log('  [contract-check] 前端 Zod ↔ 冻结契约 JSON Schema');
console.log('  ' + '─'.repeat(72));
for (const line of lines) console.log(line);
console.log('  ' + '─'.repeat(72));
console.log(`  契约 ${reviewJson.$id ?? '?'} · 前端对齐版本 ${zod.CONTRACT_VERSION}`);

if (failures.length > 0) {
  console.log(`  失败 ${failures.length} 项${warnings.length > 0 ? `／警告 ${warnings.length} 项` : ''}`);
  console.log('');
  process.exit(1);
}
console.log(`  全部通过${warnings.length > 0 ? `（${warnings.length} 项警告）` : ''}`);
console.log('');
