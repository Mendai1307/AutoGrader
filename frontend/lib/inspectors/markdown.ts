/**
 * 内部共享工具：Markdown 文档扫描器
 * ============================================================================
 * 供 chapters / code / stats / figures 四个核查器复用，保证「代码块范围」这一
 * 最基础的事实只被解析一次，避免各核查器口径漂移。
 *
 * 纯函数、确定性、零依赖：不引入任何 npm 包，不使用正则回溯敏感写法。
 */

/** 围栏代码块 */
export interface FenceBlock {
  /** 代码块序号，从 1 开始 */
  index: number;
  /** 原始语言标注（围栏后的第一个词），未标注为空串 */
  language: string;
  /** 起始围栏所在行号（1 起） */
  startLine: number;
  /** 结束围栏所在行号（1 起）；未闭合时为文档最后一行 */
  endLine: number;
  /** 代码正文起始行号 */
  codeStartLine: number;
  /** 代码正文结束行号 */
  codeEndLine: number;
  /** 代码正文行（不含围栏行；未闭合块同样不含起始围栏行） */
  code: string;
  /** 代码正文行数组 */
  codeLines: string[];
  /** 围栏是否正确闭合 */
  closed: boolean;
}

/** 文档中的一行 */
export interface DocumentLine {
  /** 行号，1 起 */
  line: number;
  /** 整行原始文本 */
  text: string;
  /** 该行是否位于围栏代码块内（含围栏行本身） */
  inFence: boolean;
}

/** 扫描结果 */
export interface ScannedDocument {
  /** 全部行 */
  lines: DocumentLine[];
  /** 围栏代码块（按出现顺序） */
  fences: FenceBlock[];
  /** 围栏代码块之外的行（正文行） */
  prose: DocumentLine[];
  /** 原始行数组 */
  rawLines: string[];
}

/** 开放中的围栏状态（内部使用） */
interface OpenFence {
  marker: string;
  language: string;
  startLine: number;
  body: string[];
}

/** 匹配围栏行：最多 3 个前导空格 + 三连以上的反引号或波浪号 */
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/** 匹配纯闭合围栏行（围栏后无内容） */
const FENCE_CLOSE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

/** 匹配 Markdown 标题行 */
const HEADING_PATTERN = /^[ \t]{0,3}(#{1,6})([ \t]+.*?)?[ \t]*$/;

/** 匹配 Markdown 图片语法（可带可选 title） */
const IMAGE_SOURCE = '!\\[([^\\]]*)\\]\\(\\s*<?([^)\\s>]*)>?(?:\\s+"[^"]*")?\\s*\\)';

/** 匹配 Markdown 链接语法（不含图片，靠负向环视排除） */
const LINK_SOURCE = '(?<!!)\\[([^\\]]*)\\]\\(\\s*<?([^)\\s>]*)>?(?:\\s+"[^"]*")?\\s*\\)';

/** 一份图片引用 */
export interface ImageRef {
  /** 题注（alt 文本） */
  alt: string;
  /** 图片路径 */
  url: string;
}

/** 匹配 Markdown 表格数据行（首尾都有竖线） */
export const TABLE_ROW_PATTERN = /^[ \t]*\|.*\|[ \t]*$/;

/**
 * 是否为 Markdown 表格分隔行（如 `|---|---:|` 或 `--- | ---`）。
 * 必须同时满足：含至少一个竖线、含至少两个连续横线、且整行只由竖线/横线/冒号/空白组成。
 * 第三条约束用于把独立的水平分隔线 `---` 排除在外。
 */
export function isTableSeparator(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('|')) return false;
  if (!/-{2,}/.test(trimmed)) return false;
  return /^[|\-: \t]+$/.test(trimmed);
}

/**
 * 逐行扫描 Markdown 文档，识别围栏代码块。
 * 未闭合的围栏一律视为「延续到文档末尾」，保证结果始终确定。
 */
export function scanDocument(raw: string): ScannedDocument {
  const rawLines = raw.split(/\r\n|\r|\n/);
  const lines: DocumentLine[] = [];
  const fences: FenceBlock[] = [];
  let open: OpenFence | null = null;

  for (let i = 0; i < rawLines.length; i += 1) {
    const text = rawLines[i] ?? '';
    const lineNo = i + 1;

    if (open === null) {
      const match = FENCE_PATTERN.exec(text);
      const marker = match?.[1];
      if (match !== null && marker !== undefined) {
        const info = (match[2] ?? '').trim();
        const firstToken = info.split(/\s+/)[0] ?? '';
        open = { marker: marker.charAt(0), language: firstToken, startLine: lineNo, body: [] };
        lines.push({ line: lineNo, text, inFence: true });
        continue;
      }
      lines.push({ line: lineNo, text, inFence: false });
      continue;
    }

    // 已在围栏内
    lines.push({ line: lineNo, text, inFence: true });
    const close = FENCE_CLOSE_PATTERN.exec(text);
    const closeMarker = close?.[1];
    if (close !== null && closeMarker !== undefined && closeMarker.charAt(0) === open.marker) {
      fences.push(buildFence(fences.length + 1, open, lineNo, true));
      open = null;
    } else {
      open.body.push(text);
    }
  }

  if (open !== null) {
    fences.push(buildFence(fences.length + 1, open, rawLines.length, false));
  }

  return {
    lines,
    fences,
    prose: lines.filter((item) => !item.inFence),
    rawLines,
  };
}

/** 由开放围栏构造闭合/未闭合的围栏块 */
function buildFence(index: number, open: OpenFence, endLine: number, closed: boolean): FenceBlock {
  const body = open.body.slice();
  return {
    index,
    language: open.language,
    startLine: open.startLine,
    endLine,
    codeStartLine: open.startLine + 1,
    codeEndLine: closed ? Math.max(open.startLine, endLine - 1) : endLine,
    code: body.join('\n'),
    codeLines: body,
    closed,
  };
}

/** 该行是否为 Markdown 标题行 */
export function isHeadingLine(text: string): boolean {
  return HEADING_PATTERN.test(text);
}

/** 取标题行的标题文本（不含 # 与首尾空白）；非标题行返回 null */
export function headingText(text: string): string | null {
  const match = HEADING_PATTERN.exec(text);
  if (match === null) return null;
  return (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/** 匹配中文/阿拉伯数字编号前缀，如 "1 "、"1.2 "、"一、"、"（3）"、"第 3 章 " */
const NUMBERING_PATTERN =
  /^[ \t]*(?:第[ \t]*[0-9一二三四五六七八九十百]+[ \t]*[章节部分篇]|[0-9]+(?:[ \t]*[.．][ \t]*[0-9]+)*[.、．)）]?|[一二三四五六七八九十]+[、.．)）]|[（(][0-9]+[)）])[ \t]*/;

/** 匹配 Markdown 列表标记，如 "- "、"* "、"1. " */
const LIST_MARKER_PATTERN = /^[ \t]*(?:[-*+]|[0-9]+[.)])[ \t]+/;

/**
 * 归一化一行文本：去掉标题井号、编号前缀、列表标记与强调标记，
 * 用于「关键词回退匹配」与标题文本比对。
 */
export function normalizeLine(text: string): string {
  let result = text.trim();
  const heading = HEADING_PATTERN.exec(result);
  if (heading !== null) {
    result = ((heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '')).trim();
  }
  result = result.replace(LIST_MARKER_PATTERN, '');
  result = result.replace(NUMBERING_PATTERN, '');
  result = result.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
  result = result.replace(/^[ \t]*>+[ \t]*/, '');
  return result.trim();
}

/**
 * 抹去一行中的 Markdown 图片与链接，只保留其可见文字（题注 / 链接文字）。
 * 用于正文计数与正文引用检索。
 */
export function stripLinkMarkup(text: string): string {
  return text
    .replace(new RegExp(IMAGE_SOURCE, 'g'), '$1')
    .replace(new RegExp(LINK_SOURCE, 'g'), '$1');
}

/** 彻底移除一行中的 Markdown 图片语法（题注与 URL 一并移除） */
export function removeImages(text: string): string {
  return text.replace(new RegExp(IMAGE_SOURCE, 'g'), ' ');
}

/** 抽取一行中的全部图片引用（按出现顺序，确定性） */
export function matchImages(text: string): ImageRef[] {
  const pattern = new RegExp(IMAGE_SOURCE, 'g');
  const refs: ImageRef[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    refs.push({ alt: (match[1] ?? '').trim(), url: (match[2] ?? '').trim() });
    match = pattern.exec(text);
  }
  return refs;
}

/** 抽取一行中的全部 Markdown 链接（不含图片，按出现顺序） */
export function matchLinks(text: string): string[] {
  const pattern = new RegExp(LINK_SOURCE, 'g');
  const links: string[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    links.push((match[1] ?? '').trim());
    match = pattern.exec(text);
  }
  return links;
}

/** 转义正则元字符 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
