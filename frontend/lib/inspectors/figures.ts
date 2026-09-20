/**
 * AutoGrader · 核查器 ④：图表引用核查
 * ============================================================================
 * 提取报告中全部 Markdown 图片引用（`![题注](路径)`），并核查每张图是否被正文引用：
 *   1. 按图号引用：图题为「图3-1」时，正文出现「图 3-1」「图3-1」均算引用；
 *   2. 泛指引用：图题没有编号时，正文出现「如图」「见图」「下图」「如图所示」
 *      等泛指措辞也算被引用（但会单独统计，供 UI 区分强弱证据）；
 *   3. 图片所在行本身、以及其它图片的题注行，都不算「正文引用」。
 *
 * 同时统计缺图号、缺题注的图片，对应 Rubric R7「每张图须有编号与图题」。
 *
 * 纯函数、确定性、零依赖。
 */

import type { FigureInspection, FigureRef, FigureReferenceMode } from './types';
import { matchImages, removeImages, scanDocument } from './markdown';

/** 从图题中解析图号：支持「图3-1」「图 3.1」「Fig.2」「Figure 2」 */
const FIGURE_NUMBER_PATTERN = /(?:图|fig(?:ure)?\.?)\s*(\d+(?:\s*[-–—.．]\s*\d+)?)/i;

/** 泛指引用措辞 */
const GENERIC_REFERENCE_PATTERN =
  /(如图|见图|如下图|见下图|如上图|见上图|下图|上图|右图|左图|如图所示|如下图所示|如上图所示|见下图所示|见上图所示)/;

/**
 * 由图号构造匹配正文的宽松正则：
 * 允许「图」与数字之间、以及序号与子序号之间存在空白，
 * 且子序号分隔符同时接受 `-`、`–`、`—`、`.`、`．`。
 */
function buildNumberPattern(number: string): RegExp {
  const parts = number.split(/\D+/).filter((part) => part !== '');
  if (parts.length === 0) {
    return /^$/;
  }
  if (parts.length === 1) {
    // 单级图号：后面不能再接数字或分隔符，避免「图1」误命中「图12」「图1-1」
    return new RegExp(`图\\s*${parts[0]}(?![\\s]*[-–—.．\\d])`);
  }
  const segments = parts.map((part) => part.replace(/([.*+?^${}()|[\]\\])/g, '\\$1'));
  return new RegExp(`图\\s*${segments.join('\\s*[-–—.．]\\s*')}`);
}

/** 正文引用检索结果 */
interface ReferenceLookup {
  /** 每一行的正文文本（已剔除图片语法，按图号引用检索用） */
  lines: { line: number; text: string }[];
}

/**
 * 提取全部图片引用（不含引用判定）。
 * 仅扫描围栏代码块之外的行——代码块里的 `![...]` 是代码而非图片。
 */
export function extractFigures(rawText: string): FigureRef[] {
  const doc = scanDocument(rawText);
  const figures: FigureRef[] = [];

  for (const line of doc.prose) {
    const images = matchImages(line.text);
    for (const image of images) {
      const numberMatch = FIGURE_NUMBER_PATTERN.exec(image.alt);
      const rawNumber = numberMatch?.[1];
      const number =
        rawNumber === undefined ? null : rawNumber.replace(/[\s．]/g, (ch) => (ch === '．' ? '.' : ''));
      figures.push({
        index: figures.length + 1,
        line: line.line,
        alt: image.alt,
        url: image.url,
        number,
        numberLabel: number === null ? null : `图${number}`,
        captioned: image.alt !== '',
        referenced: false,
        referenceMode: 'none',
        referenceLine: null,
        referenceText: null,
      });
    }
  }

  return figures;
}

/**
 * 构建「正文行」索引：把每一正文行中的图片语法整体剔除（题注与 URL 都不算正文），
 * 这样图片自己的题注不会被当成对自己的引用。
 */
function buildReferenceLines(rawText: string): ReferenceLookup {
  const doc = scanDocument(rawText);
  const lines: { line: number; text: string }[] = [];
  for (const item of doc.prose) {
    lines.push({ line: item.line, text: removeImages(item.text) });
  }
  return { lines };
}

/**
 * 核查全部图片引用情况。
 */
export function inspectFigures(rawText: string): FigureInspection {
  const figures = extractFigures(rawText);
  const lookup = buildReferenceLines(rawText);

  for (const figure of figures) {
    if (figure.number !== null) {
      const pattern = buildNumberPattern(figure.number);
      for (const item of lookup.lines) {
        if (pattern.test(item.text)) {
          figure.referenced = true;
          figure.referenceMode = 'number';
          figure.referenceLine = item.line;
          figure.referenceText = item.text.trim();
          break;
        }
      }
    }
    if (figure.referenced) continue;

    // 无图号或按图号未找到引用时，退回泛指措辞匹配
    for (const item of lookup.lines) {
      if (GENERIC_REFERENCE_PATTERN.test(item.text)) {
        figure.referenced = true;
        figure.referenceMode = 'generic';
        figure.referenceLine = item.line;
        figure.referenceText = item.text.trim();
        break;
      }
    }
  }

  const unreferencedIndexes = figures
    .filter((figure) => !figure.referenced)
    .map((figure) => figure.index);

  return {
    count: figures.length,
    referencedCount: figures.length - unreferencedIndexes.length,
    unreferencedCount: unreferencedIndexes.length,
    genericReferenceCount: figures.filter((figure) => figure.referenceMode === 'generic').length,
    unnumberedCount: figures.filter((figure) => figure.number === null).length,
    uncaptionedCount: figures.filter((figure) => !figure.captioned).length,
    figures,
    unreferencedIndexes,
  };
}

/** 引用方式的中文说明（供 UI 展示） */
export function referenceModeLabel(mode: FigureReferenceMode): string {
  if (mode === 'number') return '按图号引用';
  if (mode === 'generic') return '仅泛指引用（无图号）';
  return '未被正文引用';
}
