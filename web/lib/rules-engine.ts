/**
 * AutoGrader · 浏览器端规则引擎（工具链 T2「客观核查器」的前端对应实现）
 * ===========================================================================
 * ⚠️ 本文件是 `backend/autograder-expert/agents/tools/scripts/rule_inspector.py`
 *    的**移植**，不是另写一套核查逻辑。两者对同一份输入必须产出**同一组事实
 *    （facts）与同一个 rulesetDigest** —— 否则"上传核查"与"智能体侧核查"会给出
 *    两套结论，这正是规划书 1.3.2 要求跨端一致性校验的原因。
 *
 * 跨端一致性的验证方式：`scripts/audit-cross-end.mjs` 把同一份 markdown 分别喂给
 * 本引擎与 Python 侧的 T2，逐条比对 `facts` 与 `rulesetDigest`。
 *
 * 移植时逐项对齐的细节（都是会改变输出的地方，不是风格问题）
 * ---------------------------------------------------------------------------
 *   1. `render()` 的模板语义：先展开条件式 `{name:真值文本|假值文本}`，
 *      再展开简单式 `{name}`；简单式取值用 `str()` 风格（非严格 JSON）。
 *   2. 结构规则的**排他分配**：候选按 `(模式长度降序, ruleId, 标题序)` 排序，
 *      一个标题最多命中一条规则；模式长度用**码位数**（与 Python `len()` 一致）。
 *   3. 统计特征**从 blocks 独立复算**，不读报告自带的 summary；字数按码位数计。
 *   4. 相似度用 shingle(5) + Jaccard，取严格大于的更好者，`round(…, 4)` 按
 *      **Python 的 half-even**（不是 JS 的 half-up）—— 见 `pyRound()`。
 *   5. 规则集摘要：按 ruleId 排序后做**Python 风格**的规范化 JSON（键递归排序、
 *      分隔符带空格、非 ASCII 不转义）再取 SHA-256 —— 见 `pythonJsonDumps()`。
 *   6. 未知规则类别进 `notCovered`，不臆断。
 *
 * 三条纪律（与 T2 同源，不得违反）
 * ---------------------------------------------------------------------------
 *   · **自行复算**：统计特征不转述来源的 summary；不一致即视为自相矛盾。
 *   · **未知优于否定**：一个标题都没有时，章节存在性**无法判定** → 全部进
 *     `notCovered`，**绝不输出「缺失」**（否则"没解析出来"会被扩写成"章节缺失"）。
 *   · **结构规则不串味**：一个标题最多满足一条结构规则。
 *
 * 纯函数、零依赖、无网络；浏览器与 Node 均可运行。
 */

/* ==========================================================================
 * 类型
 * ========================================================================== */

/** 一条核查规则（形状与 default.rules.json 的条目一致，字符串键 `ruleId` 而非 `id`） */
export interface RuleDefinition {
  ruleId: string;
  /** 规则类别：structure / code / statistics / similarity */
  kind: 'structure' | 'code' | 'statistics' | 'similarity' | string;
  /** 类别内的细分工种（仅作说明，不参与判定） */
  aspect?: string;
  /** 事实模板，支持 `{name}` 与 `{name:真值文本|假值文本}` 两种占位 */
  factTemplate?: string;
  /** 该规则的可核查参数（如 patterns / minChars / shingleSize） */
  params?: Record<string, unknown>;
  /** 是否启用；缺省视为启用 */
  enabled?: boolean;
  /** 一句话说明（展示用） */
  description?: string;
  /** 合并时注入：default / teacher */
  source?: string;
}

/** 规则集 */
export interface RuleSet {
  ruleSetId: string;
  version: string;
  /** 层次：默认层只读，教师层可覆盖同名 ruleId */
  layer?: string;
  readOnly?: boolean;
  rules: RuleDefinition[];
}

/** T1 结构块（本引擎只依赖这几个字段） */
export interface RuleBlock {
  blockId?: string;
  kind: string;
  anchor?: string | null;
  /** 规范化文本（**注意**：T2 用的是 text 而非 rawText） */
  text?: string;
  [key: string]: unknown;
}

/** 被核查的报告对象（T1 出参的子集） */
export interface RuleReport {
  blocks: RuleBlock[];
  summary?: unknown;
  /** T1 的 sourceFile 是**对象** `{path, digest}`，不是字符串 */
  sourceFile?: { path?: string; digest?: string };
  [key: string]: unknown;
}

/** 一条核查事实 */
export interface RuleFact {
  ruleId: string;
  kind: 'structure' | 'code' | 'statistics' | 'similarity';
  fact: string;
  evidenceAnchor: string | null;
  value: boolean | number | null;
  source: string;
  threshold?: number;
  matchedHeading?: string;
  matchedPattern?: string;
  bestMatch?: string | null;
}

/** 自行复算出的统计特征 */
export interface RecomputedStats {
  blockCount: number;
  textChars: number;
  codeBlocks: number;
  codeLines: number;
  figures: number;
  tables: number;
  testCases: number;
  headings: number;
}

/** 规则集摘要 */
export interface RulesetDigest {
  rulesetDigest: string;
  defaultRuleSetId: string | null;
  defaultVersion: string | null;
  teacherRuleSetId: string | null;
  ruleCount: number;
  disabled: string[];
}

/** 核查结果（形状与 T2 出参一致） */
export interface RuleInspectionResult {
  tool: 'T2';
  facts: RuleFact[];
  notCovered: string[];
  notCoveredReasons: Record<string, string>;
  stats: RecomputedStats;
  declaredSummary: unknown;
  reportIntegrity: {
    /** T1 的 sourceFile 对象原样透传（含 path 与 digest） */
    blocksSource: { path?: string; digest?: string } | undefined;
    summaryMismatches: { key: string; declared: unknown; recomputed: unknown }[];
    summaryConsistent: boolean;
  };
  rulesetDigest: RulesetDigest;
  /** 对应 T2 的退出码语义：0 正常 / 1 有规则未覆盖 / 2 报告自相矛盾 */
  exitCode: 0 | 1 | 2;
}

/* ==========================================================================
 * 正则（与 Python 侧逐条一致）
 * ========================================================================== */

/** 与 T2 的 RE_TOKEN 一致：标识符或单个汉字 */
const RE_TOKEN = /[A-Za-z_][A-Za-z0-9_]*|[\u4e00-\u9fff]/g;

/** 与 T2 的 RE_TEST_CASE 一致 */
const RE_TEST_CASE = /(def\s+test_|@Test|TEST_CASE|assert[\(\s])/;

const RE_TPL_SIMPLE = /\{(\w+)\}/g;
const RE_TPL_COND = /\{(\w+):([^|{}]*)\|([^|{}]*)\}/g;

/** 同 T2 的 STAT_KEYS */
const STAT_KEYS: Readonly<Record<string, keyof RecomputedStats>> = {
  minChars: 'textChars',
  minFigures: 'figures',
  minCodeLines: 'codeLines',
  minTestCases: 'testCases',
  minCodeBlocks: 'codeBlocks',
  minTables: 'tables',
};

/* ==========================================================================
 * 小工具（对齐 Python 语义）
 * ========================================================================== */

/** 码位数（等价 Python 的 len(str)） */
function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** 子串出现次数（等价 Python 的 str.count） */
function countOccurrences(text: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Python 风格的四舍五入（**half-even**，银行家舍入）。
 * ⚠️ 不能用 JS 的 `Math.round`（half-up）：在恰好 `.5` 的边界两者会分叉，
 *    而相似度是整数比值算出来的，理论上可能踩到该边界。
 *    这里按"缩放到整数后判断距离 .5 的偏差"实现，边界时取偶。
 */
export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const m = 10 ** digits;
  const scaled = value * m;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff > 0.5) return (floor + 1) / m;
  if (diff < 0.5) return floor / m;
  return (floor % 2 === 0 ? floor : floor + 1) / m;
}

/**
 * Python `json.dumps(obj, ensure_ascii=False, sort_keys=True)` 的等价实现。
 * 用于复现 T2 的 rulesetDigest —— 摘要对**字节**敏感，分隔符与键序都必须一致。
 */
export function pythonJsonDumps(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    // Python 用 repr 输出最短往返表示；JS 的默认数字转字符串同样是最短往返
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(pythonJsonDumps).join(', ') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ': ' + pythonJsonDumps(obj[k])).join(', ') + '}';
  }
  throw new TypeError('pythonJsonDumps: unsupported type ' + typeof value);
}

/** 与 T2 的 render() 一致：先条件式，再简单式 */
export function render(template: string, values: Record<string, unknown>): string {
  let out = template.replace(RE_TPL_COND, (_match, name: string, yes: string, no: string) =>
    values[name] ? yes : no,
  );
  out = out.replace(RE_TPL_SIMPLE, (_match, name: string) => {
    const v = values[name];
    return v === undefined || v === null ? '' : String(v);
  });
  return out;
}

/** 转义正则元字符（等价 Python 的 re.escape 对 ASCII 标识符的效果） */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ==========================================================================
 * 规则集合并（与 T2 的 merge_rules 一致）
 * ========================================================================== */

export interface MergedRules {
  rules: (RuleSet['rules'][number] & { source: string })[];
  digest: RulesetDigest;
}

export function mergeRules(
  defaultRules: RuleSet,
  teacherRules?: RuleSet | null,
): MergedRules {
  const merged = new Map<string, RuleSet['rules'][number] & { source: string }>();

  for (const rule of defaultRules.rules ?? []) {
    if (!rule.ruleId) throw new Error('默认规则缺 ruleId');
    merged.set(rule.ruleId, { ...rule, source: 'default' });
  }

  if (teacherRules) {
    if (!Array.isArray(teacherRules.rules)) throw new Error('教师规则集缺 rules 数组');
    for (const rule of teacherRules.rules) {
      if (!rule.ruleId) throw new Error('教师规则缺 ruleId');
      const base = merged.get(rule.ruleId) ?? {};
      merged.set(rule.ruleId, { ...base, ...rule, source: 'teacher' });
    }
  }

  const ordered = [...merged.keys()].sort().map((k) => merged.get(k)!);
  const digestSource = pythonJsonDumps(ordered);

  return {
    rules: ordered,
    digest: {
      rulesetDigest: 'sha256:' + sha256Hex(digestSource),
      defaultRuleSetId: defaultRules.ruleSetId ?? null,
      defaultVersion: defaultRules.version ?? null,
      teacherRuleSetId: teacherRules?.ruleSetId ?? null,
      ruleCount: ordered.length,
      disabled: ordered
        .filter((r) => r.enabled === false)
        .map((r) => r.ruleId)
        .sort(),
    },
  };
}

/* ==========================================================================
 * SHA-256（同步实现，避免把整条流程变成 async）
 * ---------------------------------------------------------------------------
 * 只用于规则集摘要；结果指纹走 Web Crypto 的 async 实现（lib/fingerprint.ts）。
 * ========================================================================== */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * 纯 JS 的 SHA-256，小写十六进制输出。
 *
 * @param input 字符串（按 UTF-8 编码）或原始字节。
 *              传字节是为了让 docx 能对**文件原始字节**取摘要 ——
 *              与 T1 的 `sha256_bytes(open(path,'rb').read())` 同源；
 *              若误用"解压后文本"的摘要，两侧 sourceFile.digest 必然不等。
 */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const bitLength = bytes.length * 8;

  // 补位：0x80 + 若干 0，使长度 ≡ 56 (mod 64)，末尾 8 字节为大端比特长度
  const withPadding = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  withPadding.set(bytes);
  withPadding[bytes.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000), false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const temp1 = (hh! + S1 + ch + K256[i]! + w[i]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d! + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a!) >>> 0;
    h[1] = (h[1]! + b!) >>> 0;
    h[2] = (h[2]! + c!) >>> 0;
    h[3] = (h[3]! + d!) >>> 0;
    h[4] = (h[4]! + e!) >>> 0;
    h[5] = (h[5]! + f!) >>> 0;
    h[6] = (h[6]! + g!) >>> 0;
    h[7] = (h[7]! + hh!) >>> 0;
  }

  let out = '';
  for (const value of h) out += value.toString(16).padStart(8, '0');
  return out;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/* ==========================================================================
 * 报告形状与自洽性（与 T2 的 require_report / recompute_stats / compare_stats 一致）
 * ========================================================================== */

export class RuleInputError extends Error {}

/** 入参形状防御：必须是对象且含 blocks 数组 */
export function requireReport(doc: unknown): RuleReport {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new RuleInputError(
      `--report 顶层必须是对象，实际为 ${doc === null ? 'null' : Array.isArray(doc) ? 'array' : typeof doc}`,
    );
  }
  const report = doc as RuleReport;
  if (report.blocks === undefined) {
    throw new RuleInputError(
      `--report 缺少顶层键 'blocks'；实际顶层键为 [${Object.keys(report).sort().join(', ')}]`,
    );
  }
  if (!Array.isArray(report.blocks)) {
    throw new RuleInputError(`--report 的 'blocks' 必须是数组，实际为 ${typeof report.blocks}`);
  }
  return report;
}

function blocksOf(report: RuleReport, kind?: string): RuleBlock[] {
  const out: RuleBlock[] = [];
  for (const block of report.blocks ?? []) {
    if (kind === undefined || block.kind === kind) out.push(block);
  }
  return out;
}

/** **独立复算**统计特征（与 T1 summarize 同口径，但不读 T1 的 summary） */
export function recomputeStats(blocks: readonly RuleBlock[]): RecomputedStats {
  let textChars = 0;
  let codeLines = 0;
  let codeBlocks = 0;
  let figures = 0;
  let tables = 0;
  let testCases = 0;
  let headings = 0;

  for (const block of blocks) {
    const text = block.text ?? '';
    if (block.kind === 'text' || block.kind === 'heading') textChars += codePointLength(text);
    if (block.kind === 'code') {
      codeBlocks += 1;
      codeLines += countOccurrences(text, '\n') + 1;
      if (RE_TEST_CASE.test(text)) testCases += 1;
    }
    if (block.kind === 'figure') figures += 1;
    if (block.kind === 'table') tables += 1;
    if (block.kind === 'heading') headings += 1;
  }

  // ⚠️ 键**按字母序**排列：T2 落盘时对 JSON 键排序，这里跟着排是为了让两侧的
  //    序列化文本可逐字 diff（对象键序本无语义，但可 diff 的输出更便于取证）。
  return {
    blockCount: blocks.length,
    codeBlocks,
    codeLines,
    figures,
    headings,
    tables,
    testCases,
    textChars,
  };
}

/** 交叉核对：只比对双方都有的键；不一致逐项列出 */
export function compareStats(
  recomputed: RecomputedStats,
  declared: unknown,
): { key: string; declared: unknown; recomputed: unknown }[] {
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    return [{ key: '*', declared, recomputed: '（summary 缺失或非对象）' }];
  }
  const decl = declared as Record<string, unknown>;
  const out: { key: string; declared: unknown; recomputed: unknown }[] = [];
  for (const key of Object.keys(recomputed).sort()) {
    if (key in decl && decl[key] !== (recomputed as unknown as Record<string, unknown>)[key]) {
      out.push({
        key,
        declared: decl[key],
        recomputed: (recomputed as unknown as Record<string, unknown>)[key],
      });
    }
  }
  return out;
}

/* ==========================================================================
 * 各类核查
 * ========================================================================== */

/** 结构规则命中信息 */
interface StructureMatch {
  anchor: string | null;
  heading: string;
  pattern: string;
}

/**
 * 把标题按「模式长度降序」**排他分配**给结构规则。
 * 排他的理由：默认规则集的模式偏宽（`结果` / `分析` / `环境` / `步骤`），
 * 不排他时一个「结果分析」标题会同时满足 results 与 analysis 两条规则 —— 事实串味。
 */
export function structureMatches(
  report: RuleReport,
  rules: RuleSet['rules'],
): Record<string, StructureMatch | null> {
  const headings = blocksOf(report, 'heading');
  const candidates: { plen: number; ruleId: string; hi: number; block: RuleBlock; pattern: string }[] = [];

  for (const rule of rules) {
    const params = (rule.params ?? {}) as Record<string, unknown>;
    const label = (params.label as string) ?? rule.ruleId;
    const patterns = (params.patterns as string[]) ?? [label];
    for (const pattern of patterns) {
      if (!pattern) continue;
      for (let hi = 0; hi < headings.length; hi += 1) {
        const block = headings[hi]!;
        if ((block.text ?? '').includes(pattern)) {
          candidates.push({ plen: codePointLength(pattern), ruleId: rule.ruleId, hi, block, pattern });
        }
      }
    }
  }

  // 最长模式优先；同长按 ruleId 与标题序稳定排序
  candidates.sort((x, y) =>
    x.plen !== y.plen ? y.plen - x.plen : x.ruleId !== y.ruleId ? (x.ruleId < y.ruleId ? -1 : 1) : x.hi - y.hi,
  );

  const assigned: Record<string, StructureMatch | null> = {};
  for (const rule of rules) assigned[rule.ruleId] = null;
  const used = new Set<number>();
  for (const candidate of candidates) {
    if (assigned[candidate.ruleId] !== null && assigned[candidate.ruleId] !== undefined) continue;
    if (used.has(candidate.hi)) continue;
    assigned[candidate.ruleId] = {
      anchor: (candidate.block.anchor as string) ?? null,
      heading: candidate.block.text ?? '',
      pattern: candidate.pattern,
    };
    used.add(candidate.hi);
  }
  return assigned;
}

function checkStructure(rule: RuleSet['rules'][number], match: StructureMatch | null): RuleFact {
  const params = (rule.params ?? {}) as Record<string, unknown>;
  const label = (params.label as string) ?? rule.ruleId;
  const present = match !== null;
  const fact = render(rule.factTemplate ?? '{label}{present:存在|缺失}', { label, present });

  const out: RuleFact = {
    ruleId: rule.ruleId,
    kind: 'structure',
    fact,
    evidenceAnchor: match?.anchor ?? null,
    value: present,
    source: rule.source ?? 'default',
  };
  if (match !== null) {
    // 命中依据外露，使「这条事实凭什么成立」可被第三方复核
    out.matchedHeading = match.heading;
    out.matchedPattern = match.pattern;
  }
  return out;
}

function checkCode(
  rule: RuleSet['rules'][number],
  report: RuleReport,
  stats: RecomputedStats,
): RuleFact[] {
  const params = (rule.params ?? {}) as Record<string, unknown>;
  const facts: RuleFact[] = [];

  if ('minCodeBlocks' in params) {
    const actual = stats.codeBlocks;
    const need = params.minCodeBlocks as number;
    const anchor = blocksOf(report, 'code')[0]?.anchor ?? null;
    facts.push({
      ruleId: rule.ruleId,
      kind: 'code',
      source: rule.source ?? 'default',
      fact: render(rule.factTemplate ?? '代码块数量 {actual}（要求至少 {minCodeBlocks}）', {
        actual,
        minCodeBlocks: need,
      }),
      evidenceAnchor: anchor,
      value: actual,
      threshold: need,
    });
  }

  for (const api of (params.requiredApis as string[]) ?? []) {
    const re = new RegExp('\\b' + escapeRegExp(api) + '\\b');
    const hit = blocksOf(report, 'code').find((block) => re.test(block.text ?? '')) ?? null;
    facts.push({
      ruleId: rule.ruleId + ':' + api,
      kind: 'code',
      source: rule.source ?? 'default',
      fact: render('必需 API「{api}」{present:出现|未出现}', { api, present: hit !== null }),
      evidenceAnchor: (hit?.anchor as string) ?? null,
      value: hit !== null,
    });
  }

  if (facts.length === 0) {
    facts.push({
      ruleId: rule.ruleId,
      kind: 'code',
      source: rule.source ?? 'default',
      fact: '该规则未提供可核查参数',
      evidenceAnchor: null,
      value: null,
    });
  }
  return facts;
}

function checkStatistics(rule: RuleSet['rules'][number], stats: RecomputedStats): RuleFact[] {
  const params = (rule.params ?? {}) as Record<string, unknown>;
  const facts: RuleFact[] = [];

  for (const key of Object.keys(params).sort()) {
    const statKey = STAT_KEYS[key];
    if (statKey === undefined) continue;
    const actual = stats[statKey];
    const floor = params[key] as number;
    facts.push({
      ruleId: rule.ruleId + '.' + key,
      kind: 'statistics',
      source: rule.source ?? 'default',
      fact: render(rule.factTemplate ?? `${key} {actual}（要求至少 {${key}}）`, {
        actual,
        [key]: floor,
      }),
      evidenceAnchor: null,
      value: actual,
      threshold: floor,
    });
  }

  if (facts.length === 0) {
    facts.push({
      ruleId: rule.ruleId,
      kind: 'statistics',
      source: rule.source ?? 'default',
      fact: '该规则未提供可核查参数',
      evidenceAnchor: null,
      value: null,
    });
  }
  return facts;
}

/** shingle 集合（与 T2 的 _shingles 一致） */
export function shingles(text: string, n: number): Set<string> {
  const tokens = text.match(RE_TOKEN) ?? [];
  if (tokens.length < n) return new Set(tokens.length > 0 ? [tokens.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i += 1) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

/** 语料项：`{ name, text }` */
export interface CorpusEntry {
  name: string;
  text: string;
}

function checkSimilarity(
  rule: RuleSet['rules'][number],
  report: RuleReport,
  corpus: readonly CorpusEntry[] | null,
): RuleFact | null {
  if (corpus === null) return null;

  const params = (rule.params ?? {}) as Record<string, unknown>;
  const n = Number(params.shingleSize ?? 5);
  const target = blocksOf(report, 'text')
    .map((block) => block.text ?? '')
    .join('\n');
  const targetSet = shingles(target, n);

  if (targetSet.size === 0) {
    return {
      ruleId: rule.ruleId,
      kind: 'similarity',
      source: rule.source ?? 'default',
      fact: '报告正文为空，相似度不适用',
      evidenceAnchor: null,
      value: null,
    };
  }

  let best = 0;
  let bestName: string | null = null;
  const names = [...corpus].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of names) {
    if (!/\.(txt|md)$/i.test(entry.name)) continue;
    const other = shingles(entry.text, n);
    if (other.size === 0) continue;
    let intersection = 0;
    for (const s of targetSet) if (other.has(s)) intersection += 1;
    const union = targetSet.size + other.size - intersection;
    const sim = union === 0 ? 0 : intersection / union;
    if (sim > best) {
      best = sim;
      bestName = entry.name;
    }
  }

  // ⚠️ 这里用 pyRound（half-even）而非 JS 的 half-up，是为了与 T2 的 round() 对齐
  const rounded = pyRound(best, 4);
  return {
    ruleId: rule.ruleId,
    kind: 'similarity',
    source: rule.source ?? 'default',
    fact: render(rule.factTemplate ?? '与语料最高相似度 {maxSimilarity}', { maxSimilarity: rounded }),
    evidenceAnchor: null,
    value: rounded,
    bestMatch: bestName,
  };
}

/* ==========================================================================
 * 主流程（与 T2 的 run() 一致）
 * ========================================================================== */

export interface RunRulesOptions {
  defaultRules: RuleSet;
  teacherRules?: RuleSet | null;
  /** 查重语料；为 null 表示"未提供语料"，相似度规则进 notCovered */
  corpus?: readonly CorpusEntry[] | null;
}

export function runRules(reportInput: unknown, options: RunRulesOptions): RuleInspectionResult {
  const report = requireReport(reportInput);
  const { rules, digest } = mergeRules(options.defaultRules, options.teacherRules ?? null);
  const corpus = options.corpus ?? null;

  const blocks = report.blocks ?? [];
  const stats = recomputeStats(blocks);
  const mismatches = compareStats(stats, report.summary);

  const headingsAvailable = blocksOf(report, 'heading').length > 0;
  const structureRules = rules.filter((r) => r.kind === 'structure' && r.enabled !== false);
  const matches = headingsAvailable ? structureMatches(report, structureRules) : {};

  const facts: RuleFact[] = [];
  const notCovered: string[] = [];
  const notCoveredReasons: Record<string, string> = {};

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    switch (rule.kind) {
      case 'structure':
        if (!headingsAvailable) {
          // L1：一个标题都没有 → 章节存在性无法判定，按未知处理，不得报「缺失」
          notCovered.push(rule.ruleId);
          notCoveredReasons[rule.ruleId] =
            '报告 blocks 中不含任何 heading，章节存在性无法判定（未识别到标题，属未解析，不是缺失）';
        } else {
          facts.push(checkStructure(rule, matches[rule.ruleId] ?? null));
        }
        break;

      case 'code':
        facts.push(...checkCode(rule, report, stats));
        break;

      case 'statistics':
        facts.push(...checkStatistics(rule, stats));
        break;

      case 'similarity': {
        const got = checkSimilarity(rule, report, corpus);
        if (got === null) {
          notCovered.push(rule.ruleId);
          notCoveredReasons[rule.ruleId] = '未提供语料，相似度不适用';
        } else {
          facts.push(got);
        }
        break;
      }

      default:
        notCovered.push(rule.ruleId);
        notCoveredReasons[rule.ruleId] = `未知规则类别：'${String(rule.kind)}'`;
    }
  }

  facts.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  notCovered.sort();

  const exitCode: 0 | 1 | 2 = mismatches.length > 0 ? 2 : notCovered.length > 0 ? 1 : 0;

  return {
    tool: 'T2',
    facts,
    notCovered,
    notCoveredReasons,
    stats,
    declaredSummary: report.summary ?? null,
    reportIntegrity: {
      blocksSource: report.sourceFile,
      summaryMismatches: mismatches,
      summaryConsistent: mismatches.length === 0,
    },
    rulesetDigest: digest,
    exitCode,
  };
}
