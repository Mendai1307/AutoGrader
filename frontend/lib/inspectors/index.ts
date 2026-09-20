/**
 * AutoGrader · 浏览器端确定性核查器（统一入口）
 * ============================================================================
 * 本模块把五个纯函数核查器组装成一份 InspectionReport，并依据核查事实产出一组
 * InspectionFinding。它是「Compile-time AI」范式中 Web 侧的那一半：
 *
 *   LearnBuddy 对话侧（构建期）：语义理解、证据归纳、判分、评语 → ReviewResult JSON
 *   浏览器端（运行时，本模块）：章节 / 代码 / 统计量 / 图表引用 / 查重指纹 → 客观事实
 *
 * 本模块不做 AI、不发网络请求、不碰 DOM、不读写文件，也不生成任何主观评分——
 * 它只陈述「机器能确切判定」的事实，让静态 Demo 具备真实感，并为教师的最终判断
 * 提供可核验的线索。
 *
 * 确定性契约：同样输入必然得到逐字段相同的输出。因此 inspectReport 不写入
 * generatedAt（时间戳由调用方在展示时按需补充）。
 */

import type {
  InspectionCategory,
  InspectionFinding,
  InspectionLevel,
  InspectionReport,
} from './types';
import { INSPECTION_CATEGORIES } from './types';
import { inspectChapters } from './chapters';
import { inspectCode } from './code';
import { inspectFigures } from './figures';
import { inspectStats } from './stats';

/* ==========================================================================
 * 0. 判据常量（集中声明，便于教师按课程要求调整）
 * ========================================================================== */

/** 字数下限判据：低于此值判为「篇幅严重不足」（error） */
export const WORD_COUNT_MIN_ERROR = 600;

/** 字数下限判据：低于此值提示「篇幅偏短」（warn） */
export const WORD_COUNT_MIN_WARN = 1200;

/** 代码正文行数下限：低于此值提示「核心代码量偏少」（warn） */
export const CODE_LINE_MIN_WARN = 20;

/** 结果图数量判据：少于该值不足以支撑结论（对应 Rubric R7 优秀档要求 ≥ 3 张） */
export const FIGURE_COUNT_MIN_WARN = 3;

/** 缺失章节数达到该值时，整体判为「结构严重缺失」（error） */
export const CHAPTER_MISSING_ERROR_THRESHOLD = 4;

/* ==========================================================================
 * 1. 结论构造
 * ========================================================================== */

/** 四个子核查结果的组合（buildFindings 的入参） */
export type InspectionFacts = Pick<InspectionReport, 'chapters' | 'codes' | 'stats' | 'figures'>;

/** 依据四个子核查器的结果产出全部结论（纯函数，顺序确定） */
export function buildFindings(report: InspectionFacts): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  const { chapters, codes, stats, figures } = report;

  /* ---- 章节完整性 ---- */
  if (chapters.missingCount === 0) {
    findings.push({
      id: 'chapters:complete',
      category: 'chapters',
      level: 'info',
      title: `必备章节完整（${chapters.found}/${chapters.required}）`,
      detail: '七个必备章节均已检出，章节结构可通过。',
      evidence: chapters.items
        .filter((item) => item.line !== null)
        .map((item) => `第 ${item.line ?? 0} 行「${item.source ?? item.label}」`)
        .join('；'),
    });
  } else {
    const missing = chapters.items.filter((item) => !item.present);
    findings.push({
      id: 'chapters:missing',
      category: 'chapters',
      level: chapters.missingCount >= CHAPTER_MISSING_ERROR_THRESHOLD ? 'error' : 'warn',
      title: `缺失 ${chapters.missingCount} 个必备章节（命中 ${chapters.found}/${chapters.required}）`,
      detail: `未检出：${missing.map((item) => item.label).join('、')}。判定口径：Markdown 标题行归一化后按别名匹配，未命中标题行时再对疑似伪标题的短行做关键词回退匹配。`,
      evidence: `缺失章节：${missing.map((item) => item.label).join('、')}`,
    });
  }

  /* ---- 代码分析 ---- */
  if (codes.blockCount === 0) {
    findings.push({
      id: 'code:no-block',
      category: 'code',
      level: 'error',
      title: '未检测到任何代码块',
      detail: '全文没有围栏代码块，无法核验核心实现（代码以截图形式给出时同样无法核验）。',
      evidence: `围栏代码块数：0；代码正文行数：${codes.codeLines}`,
    });
  } else {
    findings.push({
      id: 'code:keywords',
      category: 'code',
      level: codes.hitCount === 0 ? 'warn' : 'info',
      title:
        codes.hitCount === 0
          ? '未在代码块中检测到任何关键 API / 算法调用'
          : `关键 API / 算法命中 ${codes.hitCount} 类、共 ${codes.hitOccurrences} 次`,
      detail:
        codes.hitCount === 0
          ? '关键词表覆盖进程/线程同步、Socket 网络编程、排序算法三个主题；代码块内一个关键词都未命中，需人工确认是否回避了实验要求的关键机制。'
          : `命中关键词：${codes.hits.map((hit) => hit.keyword).join('、')}。匹配口径：代码块内词边界精确匹配。`,
      evidence:
        codes.hitCount === 0
          ? `${codes.languages.map((item) => item.languageKey).join('/')} 代码共 ${codes.codeLines} 行，关键词命中 0`
          : codes.hits
              .map((hit) => `${hit.keyword}×${hit.occurrences}（块 ${hit.blocks.join(',')}）`)
              .join('；'),
    });

    if (codes.untaggedBlockCount > 0) {
      findings.push({
        id: 'code:untagged',
        category: 'code',
        level: 'warn',
        title: `${codes.untaggedBlockCount} 个代码块未标注语言`,
        detail: '代码块围栏未给出语言标注，对应 Rubric R10「代码块带语言标注」要求。',
        evidence: codes.blocks
          .filter((block) => !block.hasLanguageTag)
          .map((block) => `第 ${block.startLine} 行（块 ${block.index}）`)
          .join('；'),
      });
    }

    if (codes.unclosedBlockCount > 0) {
      findings.push({
        id: 'code:unclosed',
        category: 'code',
        level: 'warn',
        title: `${codes.unclosedBlockCount} 个代码块围栏未闭合`,
        detail: '围栏未闭合会导致后续正文被误判为代码，请检查 Markdown 语法。',
        evidence: codes.blocks
          .filter((block) => !block.closed)
          .map((block) => `第 ${block.startLine} 行的围栏未闭合`)
          .join('；'),
      });
    }

    if (codes.codeLines < CODE_LINE_MIN_WARN) {
      findings.push({
        id: 'code:few-lines',
        category: 'code',
        level: 'warn',
        title: `代码正文仅 ${codes.codeLines} 行`,
        detail: `核心代码量偏少（判据：少于 ${CODE_LINE_MIN_WARN} 行），可能不足以覆盖实验要求的功能。`,
        evidence: `${codes.blockCount} 个代码块，共 ${codes.codeLines} 行非围栏代码`,
      });
    }
  }

  /* ---- 统计量 ---- */
  if (stats.wordCount < WORD_COUNT_MIN_ERROR) {
    findings.push({
      id: 'stats:too-short',
      category: 'stats',
      level: 'error',
      title: `正文字数仅 ${stats.wordCount} 字，篇幅严重不足`,
      detail: `口径：正文字数 = 汉字数 + 英文单词数，不计代码块与 Markdown 标记。判据：低于 ${WORD_COUNT_MIN_ERROR} 字判为篇幅严重不足。`,
      evidence: `汉字 ${stats.cjkChars} + 英文单词 ${stats.englishWords} = ${stats.wordCount}`,
    });
  } else if (stats.wordCount < WORD_COUNT_MIN_WARN) {
    findings.push({
      id: 'stats:short',
      category: 'stats',
      level: 'warn',
      title: `正文字数 ${stats.wordCount} 字，篇幅偏短`,
      detail: `判据：低于 ${WORD_COUNT_MIN_WARN} 字提示篇幅偏短。`,
      evidence: `汉字 ${stats.cjkChars} + 英文单词 ${stats.englishWords} = ${stats.wordCount}`,
    });
  } else {
    findings.push({
      id: 'stats:volume',
      category: 'stats',
      level: 'info',
      title: `正文字数 ${stats.wordCount} 字`,
      detail: `汉字 ${stats.cjkChars} 字、英文单词 ${stats.englishWords} 个；另有 ${stats.codeLines} 行代码、${stats.tableCount} 张表格未计入字数。`,
      evidence: `全文 ${stats.totalLines} 行，其中非空行 ${stats.nonEmptyLines} 行`,
    });
  }

  /* ---- 图表引用 ---- */
  if (figures.count === 0) {
    findings.push({
      id: 'figures:none',
      category: 'figures',
      level: 'error',
      title: '未检测到任何图片引用',
      detail: '报告没有 Markdown 图片引用，结论缺少结果截图/图表的可视化证据。',
      evidence: 'Markdown 图片引用数：0',
    });
  } else {
    if (figures.count < FIGURE_COUNT_MIN_WARN) {
      findings.push({
        id: 'figures:few',
        category: 'figures',
        level: 'warn',
        title: `结果图仅 ${figures.count} 张`,
        detail: `判据：少于 ${FIGURE_COUNT_MIN_WARN} 张不足以覆盖主要实验场景。`,
        evidence: figures.figures
          .map((figure) => `第 ${figure.line} 行「${figure.alt}」`)
          .join('；'),
      });
    }

    if (figures.unreferencedCount > 0) {
      findings.push({
        id: 'figures:unreferenced',
        category: 'figures',
        level: 'warn',
        title: `${figures.unreferencedCount} 张图未被正文引用`,
        detail:
          '判定口径：正文（不含图片题注本身）中出现该图图号（如「图 3-1」），或出现「如图」「见下图」等泛指措辞，即视为已引用；两者都未出现则判为未引用。',
        evidence: figures.figures
          .filter((figure) => !figure.referenced)
          .map((figure) => `第 ${figure.line} 行「${figure.alt}」（${figure.numberLabel ?? '无图号'}）`)
          .join('；'),
      });
    }

    if (figures.unnumberedCount > 0) {
      findings.push({
        id: 'figures:unnumbered',
        category: 'figures',
        level: 'warn',
        title: `${figures.unnumberedCount} 张图缺少图号`,
        detail: '题注中没有「图N」形式的编号，无法在正文中被精确引用，对应 Rubric R7「每张图须有编号与图题」。',
        evidence: figures.figures
          .filter((figure) => figure.number === null)
          .map((figure) => `第 ${figure.line} 行「${figure.alt}」`)
          .join('；'),
      });
    }

    if (figures.uncaptionedCount > 0) {
      findings.push({
        id: 'figures:uncaptioned',
        category: 'figures',
        level: 'warn',
        title: `${figures.uncaptionedCount} 张图缺少题注`,
        detail: 'Markdown 图片的 alt 文本为空，读者无法判断该图展示了什么。',
        evidence: figures.figures
          .filter((figure) => !figure.captioned)
          .map((figure) => `第 ${figure.line} 行 ${figure.url}`)
          .join('；'),
      });
    }

    if (figures.unreferencedCount === 0 && figures.unnumberedCount === 0) {
      findings.push({
        id: 'figures:ok',
        category: 'figures',
        level: 'info',
        title: `${figures.count} 张图均有编号且被正文引用`,
        detail: '图表编号与正文引用关系完整。',
        evidence: figures.figures
          .map((figure) => `${figure.numberLabel ?? ''}→第 ${figure.referenceLine ?? 0} 行`)
          .join('；'),
      });
    }
  }

  return sortFindings(findings);
}

/* ==========================================================================
 * 2. 排序与统计辅助
 * ========================================================================== */

/** 类别 → 展示顺序下标（未知类别排在最后） */
function categoryOrder(category: InspectionCategory): number {
  const index = INSPECTION_CATEGORIES.indexOf(category);
  return index === -1 ? INSPECTION_CATEGORIES.length : index;
}

/**
 * 结论排序：类别顺序 → 结论 id 字典序。
 * 显式排序使输出与「push 顺序」解耦，保证确定性。
 */
export function sortFindings(findings: readonly InspectionFinding[]): InspectionFinding[] {
  return findings
    .slice()
    .sort(
      (left, right) =>
        categoryOrder(left.category) - categoryOrder(right.category) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

/** 统计各严重级别的结论条数 */
export function countFindingsByLevel(
  findings: readonly InspectionFinding[],
): Record<InspectionLevel, number> {
  const counts: Record<InspectionLevel, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.level] += 1;
  return counts;
}

/* ==========================================================================
 * 3. 主入口
 * ========================================================================== */

/**
 * 对一份报告全文做完整的确定性核查。
 *
 * @param rawText  报告 Markdown 原文
 * @param reportId 报告 id（用于结论与展示关联）
 * @returns 结构化核查结果；不写入 generatedAt，保持纯函数与确定性
 */
export function inspectReport(rawText: string, reportId: string): InspectionReport {
  const chapters = inspectChapters(rawText);
  const codes = inspectCode(rawText);
  const stats = inspectStats(rawText);
  const figures = inspectFigures(rawText);

  const findings = buildFindings({ chapters, codes, stats, figures });

  return { reportId, chapters, codes, stats, figures, findings };
}

/* ==========================================================================
 * 4. 统一再导出
 * ========================================================================== */

export type {
  ChapterHit,
  ChapterInspection,
  ChapterMatchMode,
  CodeBlockInfo,
  CodeHit,
  CodeInspection,
  FigureInspection,
  FigureRef,
  FigureReferenceMode,
  InspectionCategory,
  InspectionFinding,
  InspectionLevel,
  InspectionReport,
  LanguageStat,
  SimilarityGrade,
  SimilarityInput,
  SimilarityPair,
  StatsInspection,
} from './types';
export { INSPECTION_CATEGORIES, INSPECTION_LEVELS } from './types';

export { CHAPTER_RULES, PSEUDO_HEADING_MAX_LENGTH, inspectChapters } from './chapters';
export type { ChapterRule } from './chapters';

export {
  KEYWORD_CATALOG,
  UNKNOWN_LANGUAGE,
  catalogTopics,
  findKeywordOccurrences,
  inspectCode,
  languageLabel,
  normalizeLanguage,
} from './code';
export type { KeywordGroup, KeywordKind, KeywordSpec } from './code';

export {
  extractFigures,
  inspectFigures,
  referenceModeLabel,
} from './figures';

export {
  countCjk,
  countEnglishWords,
  countWords,
  extractProseText,
  inspectStats,
} from './stats';

export {
  SIMHASH_BITS,
  SIMHASH_HEX_LENGTH,
  SIMILARITY_DUPLICATE_THRESHOLD,
  SIMILARITY_SUSPICIOUS_THRESHOLD,
  computeSimhash,
  gradeSimilarity,
  hammingDistance,
  hashToken,
  mostSimilarPair,
  normalizeForSimhash,
  pairwiseSimilarities,
  similarityBetweenTexts,
  similarityOf,
  tokenizeForSimhash,
} from './similarity';
export type { TokenHash } from './similarity';

export { scanDocument, normalizeLine, stripLinkMarkup } from './markdown';
export type { DocumentLine, FenceBlock, ImageRef, ScannedDocument } from './markdown';
