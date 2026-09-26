/**
 * AutoGrader · 核查器 ③：统计量
 * ============================================================================
 * 统计报告的客观规模指标，供 UI 展示「真实分析」并作为后续核查项的判据。
 *
 * 口径（与 demo/sample-reports/manifest.json 的 wordCountBasis 对齐）：
 *   正文字数 = 汉字数 + 英文单词数；不计代码块、不计 Markdown 标记与空白。
 * 本实现进一步固定为：
 *   - 图片与链接的 URL 不计入，图片题注（alt）与链接文字计入；
 *   - 英文单词 = 连续 [A-Za-z] 字母串；纯数字不计为单词；
 *   - 总行数不计文件末尾换行符产生的最后一个空行。
 *
 * 纯函数、确定性、零依赖。
 */

import type { StatsInspection } from './types';
import {
  TABLE_ROW_PATTERN,
  isHeadingLine,
  isTableSeparator,
  matchImages,
  matchLinks,
  scanDocument,
  stripLinkMarkup,
} from './markdown';

/** CJK 汉字范围：扩展 A（3400–4DBF）、基本区（4E00–9FFF）、兼容汉字（F900–FAFF） */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/** 英文单词：连续 ASCII 字母 */
const ASCII_WORD_PATTERN = /[A-Za-z]+/g;

/** 统计一段文本中的汉字数 */
export function countCjk(text: string): number {
  const matched = text.match(CJK_PATTERN);
  return matched === null ? 0 : matched.length;
}

/** 统计一段文本中的英文单词数 */
export function countEnglishWords(text: string): number {
  const matched = text.match(ASCII_WORD_PATTERN);
  return matched === null ? 0 : matched.length;
}

/** 统计一段正文的「正文字数」= 汉字数 + 英文单词数 */
export function countWords(text: string): number {
  return countCjk(text) + countEnglishWords(text);
}

/**
 * 抽取用于字数统计的正文文本。
 * 规则：跳过围栏代码块；对每一正文行抹去 Markdown 图片/链接语法，只保留可见文字。
 */
export function extractProseText(rawText: string): string {
  const doc = scanDocument(rawText);
  return doc.prose.map((line) => stripLinkMarkup(line.text)).join('\n');
}

/**
 * 统计报告的各项客观指标。
 * 同一输入必然得到完全相同输出：不读时间、不读随机数、不依赖对象键顺序。
 */
export function inspectStats(rawText: string): StatsInspection {
  const doc = scanDocument(rawText);

  const rawLineCount = doc.rawLines.length;
  const trailingBlank = rawLineCount > 0 && (doc.rawLines[rawLineCount - 1] ?? '') === '';
  const totalLines = trailingBlank ? rawLineCount - 1 : rawLineCount;

  let nonEmptyLines = 0;
  let headingCount = 0;
  let imageRefs = 0;
  let linkRefs = 0;
  let tableCount = 0;
  let tableRows = 0;
  let proseText = '';

  for (const line of doc.lines) {
    if (line.text.trim() !== '') nonEmptyLines += 1;
  }

  const prose = doc.prose;
  for (let i = 0; i < prose.length; i += 1) {
    const item = prose[i];
    if (item === undefined) continue;
    const text = item.text;
    if (isHeadingLine(text)) headingCount += 1;

    imageRefs += matchImages(text).length;
    linkRefs += matchLinks(text).length;

    if (isTableSeparator(text)) {
      tableCount += 1;
    } else if (TABLE_ROW_PATTERN.test(text)) {
      // 紧邻分隔行的表格行是表头，不计入数据行
      const next = prose[i + 1];
      if (next === undefined || !isTableSeparator(next.text)) tableRows += 1;
    }

    proseText += `${stripLinkMarkup(text)}\n`;
  }

  let codeLines = 0;
  for (const fence of doc.fences) {
    codeLines += fence.codeLines.length;
  }

  const cjkChars = countCjk(proseText);
  const englishWords = countEnglishWords(proseText);

  return {
    cjkChars,
    englishWords,
    wordCount: cjkChars + englishWords,
    totalLines,
    nonEmptyLines,
    proseLines: doc.prose.length,
    headingCount,
    codeBlockCount: doc.fences.length,
    codeLines,
    imageRefs,
    tableCount,
    tableRows,
    linkRefs,
  };
}
