/**
 * AutoGrader · 核查器 ⑤：相似度比对（SimHash + 汉明距离）
 * ============================================================================
 * 用途：同一次作业内多份报告的查重（近重复检测），为 Rubric R12「原创性」
 * 提供客观线索——注意，它只给出「两篇文本的指纹有多接近」，不判定谁抄谁，
 * 也绝不作为抄袭结论，最终判断必须由教师完成。
 *
 * 算法（全部自实现，不引入分词库）：
 *   1. 归一化：剥离 Markdown 结构符号、图片与链接 URL，保留文字与代码内容；
 *   2. 分词：中文按「字级 2-gram」滑窗切片（无需词典，对中文同样有效），
 *      英文按连续字母串小写化；
 *   3. 加权：以词频为权重；
 *   4. 哈希：每个 token 通过两路 FNV-1a 变体得到 64 位指纹（hi/lo 两个 32 位半区）；
 *   5. simhash：按位加权求和，权重 > 0 置 1，否则置 0（平局置 0，保证确定）；
 *   6. 距离：64 位汉明距离；相似度 = 1 - 距离 / 64。
 *
 * 确定性说明：
 *   - 累加前对 token 做字典序排序，结果与 Map 插入顺序无关；
 *   - 不使用随机数、哈希种子、时间或平台相关 API。
 *
 * 纯函数、零依赖，Node 与浏览器结果一致。
 */

import type { SimilarityGrade, SimilarityInput, SimilarityPair } from './types';

/** simhash 位数 */
export const SIMHASH_BITS = 64;

/** simhash 十六进制字符串长度（64 / 4） */
export const SIMHASH_HEX_LENGTH = SIMHASH_BITS / 4;

/**
 * 近重复判定阈值：相似度 ≥ 0.95（汉明距离 ≤ 3 位）视为高度疑似重复。
 * 64 位 simhash 的经验取值——距离 3 位以内基本可判定为同一文本的变体。
 */
export const SIMILARITY_DUPLICATE_THRESHOLD = 0.95;

/**
 * 人工复核阈值：相似度 ≥ 0.80（汉明距离 ≤ 12 位）建议人工复核。
 * 该档位只表示「指纹接近、值得看一眼」，不构成任何抄袭判断；
 * 同主题、同实验的报告天然会落在这个区间，教师需结合 Rubric R12 综合判断。
 */
export const SIMILARITY_SUSPICIOUS_THRESHOLD = 0.8;

/** FNV-1a 32 位偏移基准 */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 32 位质数 */
const FNV_PRIME = 0x01000193;

/** 第二路哈希的初始扰动，用于生成独立的另一半 32 位 */
const FNV_SECOND_SEED = 0x9e3779b9;

/**
 * 归一化文本：仅剥离 Markdown 结构符号与 URL，保留正文与代码内容。
 * 刻意不做去停用词——2-gram 本身已足够稳健，去停用词反而降低区分度。
 */
export function normalizeForSimhash(text: string): string {
  let result = text;
  // 围栏标记行
  result = result.replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm, ' ');
  // 图片与链接：整体移除（含题注与 URL），避免「（示意图）」这类模板文字拉高相似度
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  result = result.replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
  // 标题井号、列表/引用标记、强调与行内代码标记
  result = result.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, ' ');
  result = result.replace(/^[ \t]*[-*+][ \t]+/gm, ' ');
  result = result.replace(/^[ \t]*>[ \t]*/gm, ' ');
  result = result.replace(/[`*]/g, ' ');
  result = result.replace(/\|/g, ' ');
  return result;
}

/**
 * 中文分词（字级 2-gram）与英文词切分。
 * 返回 token 序列，顺序为文档出现顺序（确定性）。
 */
export function tokenizeForSimhash(text: string): string[] {
  const normalized = normalizeForSimhash(text);
  const tokens: string[] = [];

  const words = normalized.match(/[A-Za-z][A-Za-z0-9_]+/g);
  if (words !== null) {
    for (const word of words) tokens.push(word.toLowerCase());
  }

  const runs = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g);
  if (runs !== null) {
    for (const run of runs) {
      const chars = Array.from(run);
      if (chars.length === 1) {
        tokens.push(run);
        continue;
      }
      for (let i = 0; i + 1 < chars.length; i += 1) {
        tokens.push(`${chars[i] ?? ''}${chars[i + 1] ?? ''}`);
      }
    }
  }

  return tokens;
}

/** 64 位哈希的两个 32 位半区（均为无符号整数） */
export interface TokenHash {
  hi: number;
  lo: number;
}

/** FNV-1a 32 位（返回无符号整数） */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff;
    // 乘以 FNV 质数，用移位加法避免 32 位乘法溢出带来的精度问题
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** 计算单个 token 的 64 位哈希（hi/lo 两个独立 32 位半区） */
export function hashToken(token: string): TokenHash {
  const lo = fnv1a32(token, FNV_OFFSET_BASIS);
  const hi = fnv1a32(`\u0001${token}\u0002`, FNV_SECOND_SEED ^ FNV_PRIME);
  return { hi, lo };
}

/**
 * 计算文本的 simhash 指纹，返回 16 位小写十六进制字符串。
 * 空文本（无任何 token）返回全 0 指纹。
 */
export function computeSimhash(text: string): string {
  const tokens = tokenizeForSimhash(text);

  const weights = new Map<string, number>();
  for (const token of tokens) {
    weights.set(token, (weights.get(token) ?? 0) + 1);
  }

  const accumulator = new Float64Array(SIMHASH_BITS);
  // 按字典序遍历，保证累加顺序与 Map 插入顺序无关
  const keys = Array.from(weights.keys()).sort();

  for (const key of keys) {
    const weight = weights.get(key) ?? 0;
    const hash = hashToken(key);
    for (let bit = 0; bit < 32; bit += 1) {
      const lowBit = (hash.lo >>> bit) & 1;
      const highBit = (hash.hi >>> bit) & 1;
      accumulator[bit] = (accumulator[bit] ?? 0) + (lowBit === 1 ? weight : -weight);
      accumulator[32 + bit] = (accumulator[32 + bit] ?? 0) + (highBit === 1 ? weight : -weight);
    }
  }

  let lowWord = 0;
  let highWord = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    if ((accumulator[bit] ?? 0) > 0) lowWord += 1 << bit;
    if ((accumulator[32 + bit] ?? 0) > 0) highWord += 1 << bit;
  }

  return `${(lowWord >>> 0).toString(16).padStart(8, '0')}${(highWord >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/** 把 simhash 十六进制字符串规范化为 64 位二进制字符串 */
function simhashToBits(value: string): string {
  const hex = value.trim().toLowerCase().replace(/^0x/, '');
  if (hex === '' || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`非法 simhash 指纹：${JSON.stringify(value)}（应为十六进制字符串）`);
  }
  // 超长时保留低 64 位，过短时左侧补零
  const tail = hex.length > SIMHASH_HEX_LENGTH ? hex.slice(hex.length - SIMHASH_HEX_LENGTH) : hex;
  const padded = tail.padStart(SIMHASH_HEX_LENGTH, '0');
  let bits = '';
  for (const char of padded) {
    bits += Number.parseInt(char, 16).toString(2).padStart(4, '0');
  }
  return bits;
}

/**
 * 两个 simhash 指纹之间的汉明距离（0–64）。
 * 位数不同时按 64 位对齐比较，缺失位视为 0。
 */
export function hammingDistance(a: string, b: string): number {
  const bitsA = simhashToBits(a);
  const bitsB = simhashToBits(b);
  let distance = 0;
  for (let i = 0; i < SIMHASH_BITS; i += 1) {
    if ((bitsA[i] ?? '0') !== (bitsB[i] ?? '0')) distance += 1;
  }
  return distance;
}

/**
 * 两个 simhash 指纹之间的相似度，取值 0–1（= 1 - 汉明距离 / 64）。
 * 完全相同时为 1，完全互补时为 0。
 */
export function similarityOf(a: string, b: string): number {
  const distance = hammingDistance(a, b);
  return 1 - distance / SIMHASH_BITS;
}

/** 便捷函数：直接比较两段文本的相似度（内部各自计算 simhash） */
export function similarityBetweenTexts(textA: string, textB: string): number {
  return similarityOf(computeSimhash(textA), computeSimhash(textB));
}

/** 按相似度给出分级 */
export function gradeSimilarity(similarity: number): SimilarityGrade {
  if (similarity >= SIMILARITY_DUPLICATE_THRESHOLD) return 'duplicate';
  if (similarity >= SIMILARITY_SUSPICIOUS_THRESHOLD) return 'suspicious';
  return 'distinct';
}

/**
 * 两两比对一批报告，返回全部报告对（C(n,2) 组）的相似度。
 * 排序：相似度降序 → 报告 A id 升序 → 报告 B id 升序（确定性）。
 * 传入顺序不影响结果。
 */
export function pairwiseSimilarities(inputs: readonly SimilarityInput[]): SimilarityPair[] {
  const ordered = inputs
    .slice()
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const fingerprints = ordered.map((item) => computeSimhash(item.text));
  const pairs: SimilarityPair[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const left = ordered[i];
      const right = ordered[j];
      const leftHash = fingerprints[i];
      const rightHash = fingerprints[j];
      if (left === undefined || right === undefined) continue;
      if (leftHash === undefined || rightHash === undefined) continue;
      const distance = hammingDistance(leftHash, rightHash);
      const similarity = 1 - distance / SIMHASH_BITS;
      pairs.push({
        a: left.id,
        b: right.id,
        distance,
        similarity,
        grade: gradeSimilarity(similarity),
      });
    }
  }

  return pairs.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      (left.a < right.a ? -1 : left.a > right.a ? 1 : 0) ||
      (left.b < right.b ? -1 : left.b > right.b ? 1 : 0),
  );
}

/**
 * 从两两比对结果中挑出相似度最高的一对。
 * 空数组或无配对时返回 null。
 */
export function mostSimilarPair(pairs: readonly SimilarityPair[]): SimilarityPair | null {
  return pairs.length === 0 ? null : (pairs[0] ?? null);
}
