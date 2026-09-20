/**
 * AutoGrader · 核查器 ①：章节完整性
 * ============================================================================
 * 判定实验报告是否具备应有的章节骨架。
 *
 * 两段式匹配（保证既不漏检、也不过检）：
 *   1. 标题行正则匹配（主路径）：对 Markdown 标题行做归一化（去 # / 编号 / 列表标记），
 *      再按「最长别名优先」规则判定该标题归属哪一必备章节；
 *   2. 关键词回退（兜底）：对疑似「伪标题行」（归一化后长度很短、形如
 *      「**实验目的**」「一、实验原理」的独立行）做同样的最长别名匹配。
 *
 * 每个章节最多被一行认领，且一行只归属一个章节，避免「结果分析」被
 * 同时算作「实验结果」与「数据分析」造成双重计数。
 *
 * 纯函数、确定性、零依赖。
 */

import type { ChapterHit, ChapterInspection } from './types';
import { headingText, isHeadingLine, normalizeLine, scanDocument } from './markdown';

/** 必备章节规则 */
export interface ChapterRule {
  /** 章节键 */
  key: string;
  /** 章节中文名（用于结论文案） */
  label: string;
  /**
   * 别名清单。判定时对某一行取「命中的最长别名」所在的规则，
   * 因此不同规则之间允许存在包含关系（如「结果」与「结果分析」），
   * 但同一个裸词只能出现在一条规则里，否则会双重命中。
   */
  aliases: readonly string[];
}

/**
 * 七个必备章节及其别名。
 * 别名全部为具体词组或明确的章节裸词，刻意不收「环境」「结果」这类会在
 * 正文里大量出现的短词之外的模糊词——裸词已足够，因为回退匹配还要求该行
 * 必须是「伪标题行」（短行）。
 */
export const CHAPTER_RULES: readonly ChapterRule[] = [
  {
    key: 'purpose',
    label: '实验目的',
    aliases: ['实验目的与要求', '实验目的', '实验目标', '目的与要求', '实验要求', '目的'],
  },
  {
    key: 'principle',
    label: '实验原理',
    aliases: ['实验原理与背景', '原理阐述', '实验原理', '基本原理', '相关原理', '理论背景', '原理'],
  },
  {
    key: 'environment',
    label: '实验环境',
    aliases: [
      '实验环境与工具',
      '软硬件环境',
      '实验环境',
      '环境配置',
      '实验平台',
      '运行环境',
      '开发环境',
      '实验条件',
      '环境',
    ],
  },
  {
    key: 'steps',
    label: '实验步骤',
    aliases: ['实验步骤与方法', '实验步骤', '实验过程', '操作步骤', '实施过程', '实验方法', '步骤'],
  },
  {
    key: 'result',
    label: '实验结果',
    aliases: ['实验结果与分析', '实验结果', '运行结果', '实验数据', '实验现象', '结果'],
  },
  {
    key: 'analysis',
    label: '数据分析与讨论',
    aliases: [
      '数据分析与讨论',
      '结果分析与讨论',
      '结果分析',
      '结果与分析',
      '数据分析',
      '分析与讨论',
      '实验分析',
      '讨论与分析',
      '分析',
      '讨论',
    ],
  },
  {
    key: 'summary',
    label: '总结与反思',
    aliases: [
      '问题排查与反思',
      '实验总结与反思',
      '总结与反思',
      '总结与展望',
      '实验总结',
      '问题与总结',
      '结果与总结',
      '心得体会',
      '小结与反思',
      '小结',
      '总结',
      '反思',
      '结语',
    ],
  },
];

/**
 * 伪标题行的最大归一化长度。
 * 回退匹配只在「看起来像标题」的短行上生效，避免把正文句子里的
 * 「原理」「步骤」等词误判为章节。
 */
export const PSEUDO_HEADING_MAX_LENGTH = 24;

/** 一次候选择中的匹配结果 */
interface CandidateMatch {
  ruleKey: string;
  alias: string;
  aliasLength: number;
}

/**
 * 对一段已经归一化的文本做「最长别名优先」匹配。
 * 无命中返回 null。
 */
function matchRule(text: string): CandidateMatch | null {
  let best: CandidateMatch | null = null;
  for (const rule of CHAPTER_RULES) {
    for (const alias of rule.aliases) {
      if (!text.includes(alias)) continue;
      if (best === null || alias.length > best.aliasLength) {
        best = { ruleKey: rule.key, alias, aliasLength: alias.length };
      }
    }
  }
  return best;
}

/**
 * 逐项核查必备章节。
 * items 顺序恒等于 CHAPTER_RULES 顺序，结果完全确定。
 */
export function inspectChapters(rawText: string): ChapterInspection {
  const doc = scanDocument(rawText);
  const claimed = new Map<string, ChapterHit>();

  // 第一段：标题行匹配
  for (const line of doc.prose) {
    if (!isHeadingLine(line.text)) continue;
    const title = headingText(line.text);
    if (title === null || title === '') continue;
    const normalized = normalizeLine(line.text);
    const matched = matchRule(normalized);
    if (matched === null) continue;
    recordClaim(claimed, matched, line.line, line.text.trim(), 'heading');
  }

  // 第二段：伪标题行关键词回退
  for (const line of doc.prose) {
    if (isHeadingLine(line.text)) continue;
    const normalized = normalizeLine(line.text);
    if (normalized === '' || normalized.length > PSEUDO_HEADING_MAX_LENGTH) continue;
    const matched = matchRule(normalized);
    if (matched === null) continue;
    recordClaim(claimed, matched, line.line, line.text.trim(), 'keyword');
  }

  const items: ChapterHit[] = CHAPTER_RULES.map((rule) => {
    const hit = claimed.get(rule.key);
    if (hit !== undefined) return hit;
    return {
      key: rule.key,
      label: rule.label,
      present: false,
      line: null,
      source: null,
      matchedBy: 'none',
      alias: null,
    };
  });

  const missingKeys = items.filter((item) => !item.present).map((item) => item.key);

  return {
    required: CHAPTER_RULES.length,
    found: items.length - missingKeys.length,
    missingCount: missingKeys.length,
    items,
    missingKeys,
  };
}

/**
 * 认领一个章节：同一章节只保留最早出现的命中（行号最小者）；
 * 由于按文档顺序遍历，先到先得即为最早。
 */
function recordClaim(
  claimed: Map<string, ChapterHit>,
  matched: CandidateMatch,
  line: number,
  source: string,
  mode: 'heading' | 'keyword',
): void {
  if (claimed.has(matched.ruleKey)) return;
  const rule = CHAPTER_RULES.find((item) => item.key === matched.ruleKey);
  claimed.set(matched.ruleKey, {
    key: matched.ruleKey,
    label: rule === undefined ? matched.ruleKey : rule.label,
    present: true,
    line,
    source,
    matchedBy: mode,
    alias: matched.alias,
  });
}
