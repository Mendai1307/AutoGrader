/**
 * AutoGrader · 结果指纹算法（契约冻结版 1.1.0）· JS 侧对照实现
 * ============================================================================
 * 与 `fingerprint.py` **必须逐位等价**。契约规定两侧都要做同样的规范化，
 * 只给单侧实现会导致前端复算不一致 → 误报「结果已被修改」。
 *
 * 算法：递归字典序排键 + `provenance.resultFingerprint` 置空
 *       + 数字按 JS `round2` 取 2 位小数 + 无空格 UTF-8 JSON + SHA-256 十六进制小写。
 *
 * 三条规范化规则详见 `fingerprint.py` 的模块说明与 `docs/contract.md`。
 *
 * 用法（Node 18+ / 浏览器均可，依赖 Web Crypto）：
 *   node contract/fingerprint.mjs --input <result.json> [--check]
 *   node contract/fingerprint.mjs --self-test
 */

export const FINGERPRINT_PREFIX = 'sha256:';

const JS_EPSILON = Number.EPSILON;

/**
 * 与 v0.1 `schema.ts` 的 `round2()` 逐位等价（half-up，非银行家舍入）。
 * 注：本函数就是 v0.1 的原始实现，保留 `+ Number.EPSILON` 一项——
 * Python 侧若使用内置 `round()`，在 `.xx5` 边界会与之分叉。
 */
export function jsRound2(value) {
  return Math.round((value + JS_EPSILON) * 100) / 100;
}

function num(value) {
  const r = jsRound2(value);
  if (r === 0) return '0';
  return String(r);
}

function dump(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return num(value);
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(dump).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + dump(value[k]));
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError('fingerprint: unsupported type ' + t);
}

/** 深拷贝并把 `provenance.resultFingerprint` 置为 ''。不修改入参。
 *
 *  ⚠️ 键**必须存在**（不存在则补上）：契约的算法是「置为 ''」，
 *  而 `{"resultFingerprint": ""}` 与「根本没有这个键」序列化出的文本不同。
 *  若生产者不补键、校验者补键，两侧复算必然不等。
 */
export function blankFingerprint(obj) {
  const clone = typeof structuredClone === 'function'
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
  if (clone && typeof clone === 'object' && clone.provenance
      && typeof clone.provenance === 'object') {
    clone.provenance.resultFingerprint = '';
  }
  return clone;
}

/** 返回参与哈希的规范化 JSON 文本。供第三方逐步复算与排错使用。 */
export function canonicalJson(obj) {
  return dump(blankFingerprint(obj));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 返回 `"sha256:<64位小写十六进制>"`。纯函数，不修改入参。 */
export async function fingerprint(obj) {
  const bytes = new TextEncoder().encode(canonicalJson(obj));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return FINGERPRINT_PREFIX + toHex(digest);
}

async function selfTest() {
  const doc = {
    schemaVersion: '1.0.0',
    scores: [{ rubricItemId: 'R1', score: 8.0, maxScore: 10, weight: 5 }],
    provenance: { resultFingerprint: 'sha256:' + '0'.repeat(64), schemaVersion: '1.0.0' },
  };
  const expected = await fingerprint(doc);

  const doc2 = JSON.parse(JSON.stringify(doc));
  doc2.provenance.resultFingerprint = 'sha256:' + 'f'.repeat(64);
  const okSelfRef = (await fingerprint(doc2)) === expected;

  const okRound = jsRound2(2.675) === 2.68 && jsRound2(0.125) === 0.13;
  const okNum = num(5.0) === '5' && num(97.2) === '97.2' && num(0) === '0';
  const okKeyOrder = dump({ b: 1, a: 2 }) === '{"a":2,"b":1}';
  const okNull = dump({ a: null }) === '{"a":null}' && dump({}) === '{}';
  const okPure = doc.provenance.resultFingerprint === 'sha256:' + '0'.repeat(64);

  const noKey = { schemaVersion: '1.0.0', provenance: { schemaVersion: '1.0.0' } };
  const emptyKey = { schemaVersion: '1.0.0', provenance: { schemaVersion: '1.0.0', resultFingerprint: '' } };
  const okKeyPresent = (await fingerprint(noKey)) === (await fingerprint(emptyKey))
    && dump(blankFingerprint({ a: 1 })) === '{"a":1}';

  const out = {
    tool: 'fingerprint.mjs',
    version: '1.1.0',
    sampleFingerprint: expected,
    checks: {
      selfReferenceBlanked: okSelfRef,
      jsRoundingParity: okRound,
      numberNormalization: okNum,
      keyOrderIndependent: okKeyOrder,
      nullVsMissing: okNull,
      pureFunction: okPure,
      selfReferenceKeyAlwaysPresent: okKeyPresent,
    },
  };
  console.log(JSON.stringify(out, null, 2));
  return Object.values(out.checks).every(Boolean) ? 0 : 1;
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  if (argv.includes('--self-test')) return selfTest();

  const input = arg('--input');
  if (!input) {
    console.log(JSON.stringify({ tool: 'fingerprint.mjs', error: 'need --input' }));
    return 2;
  }
  const fs = await import('node:fs/promises');
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(input, 'utf8'));
  } catch (e) {
    console.log(JSON.stringify({ tool: 'fingerprint.mjs', error: String(e.message) }));
    return 2;
  }

  const computed = await fingerprint(doc);
  const out = { tool: 'fingerprint.mjs', version: '1.1.0', file: input, computed };
  let code = 0;
  if (argv.includes('--check')) {
    const declared = doc && doc.provenance ? doc.provenance.resultFingerprint : null;
    out.declared = declared;
    out.match = declared === computed;
    code = out.match ? 0 : 1;
  }
  console.log(JSON.stringify(out, null, 2));
  return code;
}

const isNodeCli = typeof process !== 'undefined' && Array.isArray(process.argv)
  && typeof process.argv[1] === 'string'
  && /fingerprint\.mjs$/.test(process.argv[1]);
if (isNodeCli) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
