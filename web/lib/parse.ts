/**
 * AutoGrader · 浏览器端文档解析（md / txt / 纯文本粘贴）
 * ===========================================================================
 * ⚠️ 本文件是 `backend/autograder-expert/agents/tools/scripts/document_parser.py`
 *    的 **markdown / plaintext 分支移植**（docx 分支见 lib/docx.ts）。
 *
 * 为什么要逐字移植而不是"自己写个差不多的 md 解析"：
 *   Web 端「上传核查」的结论必须与智能体侧 T2 对同一份文档的结论一致。
 *   若两侧切块不同，`facts` 就会不同 —— 跨端一致性立刻失效。
 *   `scripts/audit-cross-end.mjs` 会用同一份 T1 产物对两侧做逐条比对，
 *   但那只证明"规则引擎一致"；**块切得一样**是这件事的前提，故此处严格对齐。
 *
 * 逐项对齐的细节
 * ---------------------------------------------------------------------------
 *   1. `clean_text()`：只把 `[ \t]+` 折叠成单个空格再 trim，**不改动任何实质字符**。
 *   2. `rawText` 与 `text` 两栏：`text` 用于统计与匹配，`rawText` 保留逐字原文
 *      （行首缩进、制表符原样），供"逐字引用"使用。
 *   3. 块锚点 `anchor = "<章号>.<段号>"`，其中段号在遇到新标题时归零。
 *   4. 空代码块（围栏内只有空白）记为 `empty-code-block` 失败项，不产出块。
 *   5. **静默失败闸门**：有正文却一个标题都没识别到 → 写入
 *      `structure-not-recognized` 并降级 status，绝不报成功。
 *      （否则"没解析出来"会被下游扩写成"六个章节全缺失"——主动的否定断言。）
 */

// ⚠️ 这里**必须带 `.ts` 扩展名**，不要"顺手"改成 './rules-engine'：
//    本文件会被 scripts/*.mjs 用原生 Node ESM 直接 import（Node 22 的 TS type stripping），
//    而原生 ESM 不做扩展名推断，省略扩展名会 ERR_MODULE_NOT_FOUND。
//    Next/webpack 两种写法都能解析，所以带扩展名是唯一两边都通的写法。
//    （tsconfig 已开 allowImportingTsExtensions + noEmit 以允许此写法。）
import { sha256Hex } from './rules-engine.ts';

/* ==========================================================================
 * 正则（与 Python 侧一致）
 * ========================================================================== */

const RE_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RE_FENCE = /^\s*```/;
const RE_FIGURE_MD = /!\[[^\]]*\]\([^)]*\)/;
const RE_FORMULA_MD = /^\s*\$\$/;
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/;
const RE_TEST_CASE = /(def\s+test_|@Test|TEST_CASE|assert[\(\s])/;

/** 只做空白规范化，不改动任何实质字符（不用于需要逐字的场合，那用 rawText） */
export function cleanText(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim();
}

/**
 * 等价 Python 的 `str.splitlines()`：在 \r\n / \r / \n / \v / \f / \x85 / \u2028 / \u2029
 * 处切分，且**丢弃行终止符**。
 */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|[\n\r\v\f\x85\u2028\u2029]/);
}

/* ==========================================================================
 * 类型（T1 出参形状）
 * ========================================================================== */

export type BlockKind = 'heading' | 'text' | 'code' | 'figure' | 'table' | 'formula';

export interface ParsedBlock {
  blockId: string;
  kind: BlockKind;
  anchor: string;
  page: number | null;
  /** 原文逐字（保留行首缩进与制表符） */
  rawText: string;
  /** 空白规范化后的文本（供统计与关键词匹配） */
  text: string;
}

export interface StructureNode {
  id: string;
  title: string;
  level: number;
  children: StructureNode[];
}

export interface ParseFailure {
  reason: string;
  anchorIfAny: string | null;
}

export interface ParsedSummary {
  blockCount: number;
  textChars: number;
  codeBlocks: number;
  codeLines: number;
  figures: number;
  tables: number;
  testCases: number;
  headings: number;
}

export interface ParsedDocument {
  tool: 'T1';
  status: 'ok' | 'partial' | 'failed';
  sourceFile: { path: string; digest: string };
  structure: StructureNode[];
  blocks: ParsedBlock[];
  failures: ParseFailure[];
  summary: ParsedSummary;
  emptyHeadingParagraphs: number;
  /** 对应 T1 的退出码语义 */
  exitCode: 0 | 1 | 2;
}

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

/* ==========================================================================
 * 结构累积器（Builder 的移植）
 * ========================================================================== */

interface HeadingRecord {
  id: string;
  title: string;
  level: number;
  parent: string | null;
  children: StructureNode[];
}

class Builder {
  blocks: ParsedBlock[] = [];
  failures: ParseFailure[] = [];
  headings: HeadingRecord[] = [];
  /** 有标题样式但正文为空的段落数（不入树、不入块，但计数外露） */
  emptyHeadingParagraphs = 0;

  private stack: { level: number; id: string }[] = [];
  private sectionNo = 0;
  private paraNo = 0;
  private codeBuf: string[] | null = null;

  addHeading(level: number, title: string, raw?: string): void {
    if (!title) {
      this.emptyHeadingParagraphs += 1;
      return;
    }
    this.sectionNo += 1;
    this.paraNo = 0;
    const id = 's' + String(this.sectionNo).padStart(4, '0');
    while (this.stack.length > 0 && this.stack[this.stack.length - 1]!.level >= level) {
      this.stack.pop();
    }
    const parent = this.stack.length > 0 ? this.stack[this.stack.length - 1]!.id : null;
    this.headings.push({ id, title, level, parent, children: [] });
    this.stack.push({ level, id });
    // 标题本身也是一个可被引用的结构块
    this.addBlock('heading', title, null, raw);
  }

  addBlock(kind: BlockKind, text: string, page: number | null = null, raw?: string): void {
    if (!text && !raw) return;
    this.paraNo += 1;
    this.blocks.push({
      blockId: 'b' + String(this.blocks.length + 1).padStart(5, '0'),
      kind,
      anchor: `${this.sectionNo}.${this.paraNo}`,
      page,
      rawText: raw === undefined ? text : raw,
      text,
    });
  }

  fail(reason: string, anchor: string | null = null): void {
    this.failures.push({ reason, anchorIfAny: anchor });
  }

  openCode(): void {
    this.codeBuf = [];
  }

  pushCode(line: string): void {
    if (this.codeBuf !== null) this.codeBuf.push(line);
  }

  closeCode(): void {
    if (this.codeBuf === null) return;
    const raw = this.codeBuf.join('\n');
    // 等价 Python 的 raw.strip("\n")：只剥首尾换行，不动其它空白
    const body = raw.replace(/^\n+/, '').replace(/\n+$/, '');
    if (body.trim()) this.addBlock('code', body, null, body);
    else this.fail('empty-code-block');
    this.codeBuf = null;
  }

  isInCode(): boolean {
    return this.codeBuf !== null;
  }

  tree(): StructureNode[] {
    const index = new Map(this.headings.map((h) => [h.id, h]));
    const roots: StructureNode[] = [];
    for (const heading of this.headings) {
      const node: StructureNode = {
        id: heading.id,
        title: heading.title,
        level: heading.level,
        children: heading.children,
      };
      const parent = heading.parent === null ? undefined : index.get(heading.parent);
      if (parent !== undefined) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
}

/* ==========================================================================
 * 解析器
 * ========================================================================== */

export function parseMarkdown(text: string, builder: Builder): void {
  for (const line of splitLines(text)) {
    if (RE_FENCE.test(line)) {
      if (!builder.isInCode()) builder.openCode();
      else builder.closeCode();
      continue;
    }
    if (builder.isInCode()) {
      builder.pushCode(line);
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      builder.addHeading(heading[1]!.length, cleanText(heading[2]!), heading[2]);
      continue;
    }
    if (RE_FORMULA_MD.test(line) || line.trim().startsWith('\\begin{equation}')) {
      builder.addBlock('formula', cleanText(line), null, line);
      continue;
    }
    if (RE_FIGURE_MD.test(line)) {
      builder.addBlock('figure', cleanText(line), null, line);
      continue;
    }
    if (RE_TABLE_ROW.test(line)) {
      builder.addBlock('table', cleanText(line), null, line);
      continue;
    }
    const trimmed = cleanText(line);
    if (trimmed) builder.addBlock('text', trimmed, null, line);
  }
  builder.closeCode();
}

export function parsePlain(text: string, builder: Builder): void {
  for (const line of splitLines(text)) {
    const trimmed = cleanText(line);
    if (trimmed) builder.addBlock('text', trimmed, null, line);
  }
}

/** 统计特征（与 T1 的 summarize 同口径） */
export function summarize(blocks: readonly ParsedBlock[]): ParsedSummary {
  let textChars = 0;
  let codeBlocks = 0;
  let codeLines = 0;
  let figures = 0;
  let tables = 0;
  let testCases = 0;
  let headings = 0;

  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'heading') textChars += codePointLength(block.text);
    if (block.kind === 'code') {
      codeBlocks += 1;
      codeLines += countOccurrences(block.text, '\n') + 1;
      if (RE_TEST_CASE.test(block.text)) testCases += 1;
    }
    if (block.kind === 'figure') figures += 1;
    if (block.kind === 'table') tables += 1;
    if (block.kind === 'heading') headings += 1;
  }

  return {
    blockCount: blocks.length,
    textChars,
    codeBlocks,
    codeLines,
    figures,
    tables,
    testCases,
    headings,
  };
}

/* ==========================================================================
 * 入口
 * ========================================================================== */

/** Web 端支持解析的文本格式 */
export type TextFormat = 'md' | 'markdown' | 'txt' | 'text';

/**
 * 解析纯文本文档（md / txt），产出与 T1 同形状的报告对象。
 *
 * @param text      文档全文
 * @param sourceName 来源文件名（写入 sourceFile.path）
 * @param format     格式；缺省按扩展名推断，再缺省按纯文本
 */
export function parseTextDocument(
  text: string,
  sourceName: string,
  format?: TextFormat,
): ParsedDocument {
  const builder = new Builder();

  let resolved: TextFormat;
  if (format !== undefined) {
    resolved = format;
  } else {
    const ext = sourceName.includes('.') ? sourceName.slice(sourceName.lastIndexOf('.') + 1) : '';
    resolved = (ext.toLowerCase() || 'txt') as TextFormat;
  }

  if (resolved === 'md' || resolved === 'markdown') parseMarkdown(text, builder);
  else parsePlain(text, builder);

  // 静默失败闸门：有正文但一个标题都没识别出来 → 显式记录并降级 status
  const hasBody = builder.blocks.some(
    (b) => b.kind === 'text' || b.kind === 'code' || b.kind === 'table',
  );
  if (builder.headings.length === 0 && hasBody) {
    builder.fail(
      'structure-not-recognized: 未识别到任何标题，章节存在性**无法判定**（按未知处理，禁止当成「缺失」）',
    );
  }

  const failureCount = builder.failures.length;
  const status: ParsedDocument['status'] =
    builder.blocks.length === 0 && failureCount > 0 ? 'failed' : failureCount > 0 ? 'partial' : 'ok';
  const exitCode: ParsedDocument['exitCode'] = status === 'failed' ? 2 : status === 'partial' ? 1 : 0;

  return {
    tool: 'T1',
    status,
    // ⚠️ 摘要带 `sha256:` 前缀 —— 与 T1 的 sha256_text() 一致（它返回 "sha256:" + hexdigest）。
    //    漏掉前缀会让 sourceFile.digest 与工具链对不上。
    sourceFile: { path: sourceName, digest: 'sha256:' + sha256Hex(text) },
    structure: builder.tree(),
    blocks: builder.blocks,
    failures: builder.failures,
    summary: summarize(builder.blocks),
    emptyHeadingParagraphs: builder.emptyHeadingParagraphs,
    exitCode,
  };
}

/** 供 docx 分支复用：把 Builder 暴露给 lib/docx.ts */
export function createBuilder(): Builder {
  return new Builder();
}

export type { Builder };
