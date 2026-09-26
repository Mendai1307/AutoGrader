/**
 * AutoGrader · 结果指纹算法（JS 侧）· 前端复算用
 * ============================================================================
 * ⚠️ 本文件是 `contract/fingerprint.mjs` 的**移植**，不是另写一套设计。
 *    函数体与其保持逐字同源（只补类型），两侧**必须逐位等价**。
 *    构建期由 `scripts/contract-check.mjs` 用 12 份真实资产 + 夹具
 *    对「本实现」与「contract/fingerprint.mjs」做**行为等价**比对，
 *    不等即让构建失败 —— 防止有人在这里"顺手优化"导致前端误报「结果已被修改」。
 *
 * 算法（契约写死，不得改写）：递归字典序排键
 *   + `provenance.resultFingerprint` 置空
 *   + 数字按 JS `round2` 取 2 位小数
 *   + 无空格 UTF-8 JSON
 *   + SHA-256 十六进制小写，前缀 "sha256:"。
 *
 * 运行环境：浏览器与 Node 18+ 均可（只依赖 Web Crypto，无第三方依赖）。
 *
 * 三条规范化规则（与 Python 侧的等价条件）见 docs/contract.md「结果指纹算法」一节。
 */

export const FINGERPRINT_PREFIX = 'sha256:';

const JS_EPSILON = Number.EPSILON;

/**
 * 与 v0.1 `schema.ts` 的 `round2()` 逐位等价（half-up，非银行家舍入）。
 *
 * ⚠️ 保留 `+ Number.EPSILON` 一项：Python 内置 `round()` 是银行家舍入，
 *    在 `.xx5` 边界会与之分叉（`round(2.675, 2)` → 2.67，本函数 → 2.68）。
 */
export function jsRound2(value: number): number {
  return Math.round((value + JS_EPSILON) * 100) / 100;
}

function num(value: number): string {
  const r = jsRound2(value);
  if (r === 0) return '0';
  return String(r);
}

function dump(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return num(value as number);
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(dump).join(',') + ']';
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + dump(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError('fingerprint: unsupported type ' + t);
}

/**
 * 深拷贝并把 `provenance.resultFingerprint` 置为 ''。不修改入参。
 *
 * ⚠️ 键**必须存在**（不存在则补上）：契约的算法是「置为 ''」，
 *    而 `{"resultFingerprint": ""}` 与「根本没有这个键」序列化出的文本不同。
 *    若生产者不补键、校验者补键，两侧复算必然不等。
 */
export function blankFingerprint<T>(obj: T): T {
  const clone: T =
    typeof structuredClone === 'function'
      ? structuredClone(obj)
      : (JSON.parse(JSON.stringify(obj)) as T);
  const anyClone = clone as unknown as Record<string, unknown>;
  if (anyClone && typeof anyClone === 'object') {
    const prov = anyClone.provenance;
    if (prov && typeof prov === 'object') {
      (prov as Record<string, unknown>).resultFingerprint = '';
    }
  }
  return clone;
}

/** 返回参与哈希的规范化 JSON 文本。供第三方逐步复算与排错使用。 */
export function canonicalJson(obj: unknown): string {
  return dump(blankFingerprint(obj));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 返回 `"sha256:<64位小写十六进制>"`。纯函数，不修改入参。 */
export async function fingerprint(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(obj));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return FINGERPRINT_PREFIX + toHex(digest);
}

/** 指纹比对结果 */
export interface FingerprintCheck {
  /** 按算法复算出的指纹 */
  computed: string;
  /** 结果文件中声明的指纹 */
  declared: string | null;
  /** 两者是否一致（声明为 null 时判为 false，并给 note） */
  match: boolean;
  /** 人类可读的补充说明 */
  note: string;
}

/**
 * 复算某份结果的指纹并与声明值比对。
 * 不一致只说明「文件内容与它自己声称的指纹对不上」——
 * 可能是被改过，也可能是生成时就没补键。界面据此提示，不作结论。
 */
export async function checkFingerprint(result: unknown): Promise<FingerprintCheck> {
  const computed = await fingerprint(result);
  const prov = (result as { provenance?: Record<string, unknown> } | null)?.provenance;
  const raw = prov ? prov.resultFingerprint : null;
  const declared = typeof raw === 'string' && raw.length > 0 ? raw : null;

  if (declared === null) {
    return { computed, declared: null, match: false, note: '结果未声明指纹，无法比对' };
  }
  if (declared === computed) {
    return { computed, declared, match: true, note: '复算一致：内容与声明指纹相符' };
  }
  return {
    computed,
    declared,
    match: false,
    note: '复算不一致：内容与其声明的指纹对不上（可能被修改，或生成时未按算法补键）',
  };
}
