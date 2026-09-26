/**
 * AutoGrader · 轻量 Markdown 渲染（Server Component）
 * ---------------------------------------------------------------------------
 * 刻意**不引入任何 Markdown 渲染依赖**：只覆盖实验报告实际用到的子集——
 *   ATX 标题 / 段落 / 围栏代码块（带语言标注与原文行号）/ 有序与无序列表 /
 *   图片占位 / 管道表格 / 水平分割线 / 行内加粗与行内代码。
 * 解析为纯数据块后渲染，过程完全确定，构建期即可完成。
 */

import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ==========================================================================
 * 解析
 * ========================================================================== */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; lines: string[]; startLine: number }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'figure'; alt: string; src: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^(---|\*\*\*|___)\s*$/;
const FENCE_RE = /^```/;
const LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
const TABLE_RE = /^\s*\|/;

function isBlockStart(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === '' ||
    FENCE_RE.test(trimmed) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(trimmed) ||
    TABLE_RE.test(line) ||
    LIST_RE.test(line) ||
    IMAGE_RE.test(trimmed)
  );
}

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** 把 Markdown 原文解析为数据块序列（纯函数，可单测） */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    // 围栏代码块
    if (FENCE_RE.test(trimmed)) {
      const lang = trimmed.slice(3).trim();
      const code: string[] = [];
      i += 1;
      const startLine = i + 1;
      while (i < lines.length && !FENCE_RE.test((lines[i] ?? '').trim())) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // 跳过闭合围栏
      blocks.push({ kind: 'code', lang, lines: code, startLine });
      continue;
    }

    if (trimmed === '') {
      i += 1;
      continue;
    }

    if (RULE_RE.test(trimmed)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(raw);
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: (heading[2] ?? '').trim() });
      i += 1;
      continue;
    }

    const image = IMAGE_RE.exec(trimmed);
    if (image !== null) {
      blocks.push({ kind: 'figure', alt: image[1] ?? '', src: image[2] ?? '' });
      i += 1;
      continue;
    }

    if (TABLE_RE.test(raw)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_RE.test(lines[i] ?? '')) {
        rows.push(lines[i] ?? '');
        i += 1;
      }
      const header = splitRow(rows[0] ?? '');
      const isSeparator = /^[\s|:-]+$/.test(rows[1] ?? '');
      const bodyRows = (isSeparator ? rows.slice(2) : rows.slice(1)).map(splitRow);
      blocks.push({ kind: 'table', header, rows: bodyRows });
      continue;
    }

    if (LIST_RE.test(raw)) {
      const ordered = /^\s*\d+\.\s+/.test(raw);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(LIST_RE, '').trim());
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // 段落：连续非空行合并
    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i] ?? '')) {
      paragraph.push((lines[i] ?? '').trim());
      i += 1;
    }
    if (paragraph.length === 0) {
      // 兜底：保证循环一定前进，避免任何输入导致死循环
      paragraph.push(trimmed);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/* ==========================================================================
 * 行内渲染：**加粗** 与 `行内代码`
 * ========================================================================== */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;
  let matched = INLINE_RE.exec(text);

  while (matched !== null) {
    if (matched.index > cursor) nodes.push(text.slice(cursor, matched.index));
    const token = matched[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${tokenIndex}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${tokenIndex}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    cursor = matched.index + token.length;
    tokenIndex += 1;
    matched = INLINE_RE.exec(text);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * 行内 Markdown 单行渲染（只支持 `**加粗**` 与 `` `行内代码` ``）。
 *
 * 单独导出，供**只渲染一行小字**的场景复用 —— 典型是 `/agents` 页的技能 / 工具摘要：
 * 那些文案取自规格文档的**首个正文行**，按写作惯例带 `**强调**` 与 `` `字段名` ``，
 * 而卡片里只有一小段灰字；若直接当纯文本渲染，页面上会出现**字面的 `**` 与反引号**。
 * 这些摘要套整块 `MarkdownView` 会多出一层块级容器与默认字号，故单给一个行内入口。
 *
 * ⚠️ 修的是**展示层**，不是源文档：`**` 是规格文档里的正常排版，
 * 为了展示而删掉它会把文档自身的强调一并削平。
 */
export function InlineMarkdown({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{renderInline(text, 'inline')}</span>;
}

/* ==========================================================================
 * 渲染
 * ========================================================================== */

export interface MarkdownViewProps {
  source: string;
  className?: string;
}

export function MarkdownView({ source, className }: MarkdownViewProps) {
  const blocks = parseMarkdown(source);

  return (
    <div className={cn('text-sm leading-relaxed text-foreground/90', className)}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.kind) {
          case 'heading': {
            const size =
              block.level === 1
                ? 'mt-1 mb-3 text-xl font-semibold'
                : block.level === 2
                  ? 'mt-7 mb-2.5 border-b border-border pb-1.5 text-base font-semibold'
                  : 'mt-5 mb-2 text-sm font-semibold';
            const Tag = (block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
            return (
              <Tag key={key} className={cn('scroll-mt-16 tracking-tight text-foreground', size)}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }

          case 'paragraph':
            return (
              <p key={key} className="my-3">
                {renderInline(block.text, key)}
              </p>
            );

          case 'code':
            // 代码块用「纸面反相」：底取近黑 ink、字取纸色，与整体暖灰白体系自洽。
            // （不用 slate 等第二色系 —— 本项目的色彩纪律见 lib/constants.ts）
            return (
              <figure key={key} className="my-4 overflow-hidden rounded-lg border border-foreground/90 bg-foreground">
                <figcaption className="flex items-center justify-between border-b border-background/10 px-3 py-1.5 text-[11px] text-background/55">
                  <span className="font-mono uppercase tracking-wide">{block.lang === '' ? 'code' : block.lang}</span>
                  <span className="tabular-nums">
                    原文 L{block.startLine}–L{block.startLine + block.lines.length - 1}
                  </span>
                </figcaption>
                <div className="overflow-x-auto py-2">
                  <pre className="min-w-full text-[12.5px] leading-5">
                    <code className="block font-mono text-background/90">
                      {block.lines.map((codeLine, lineIndex) => (
                        <span key={`${key}-l${lineIndex}`} className="flex">
                          <span className="w-11 shrink-0 select-none pr-3 text-right text-background/30 tabular-nums">
                            {block.startLine + lineIndex}
                          </span>
                          <span className="whitespace-pre pr-4">{codeLine === '' ? ' ' : codeLine}</span>
                        </span>
                      ))}
                    </code>
                  </pre>
                </div>
              </figure>
            );

          case 'list':
            return block.ordered ? (
              <ol key={key} className="my-3 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-i${itemIndex}`}>{renderInline(item, `${key}-i${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="my-3 list-disc space-y-1.5 pl-6 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-i${itemIndex}`}>{renderInline(item, `${key}-i${itemIndex}`)}</li>
                ))}
              </ul>
            );

          case 'figure':
            return (
              <figure
                key={key}
                className="my-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-4 py-6 text-center"
              >
                <ImageOff className="h-5 w-5 text-muted-foreground" />
                <figcaption className="text-xs leading-relaxed text-muted-foreground">
                  {block.alt === '' ? '（无图题）' : block.alt}
                </figcaption>
                <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {block.src}
                </code>
                <span className="text-[11px] text-muted-foreground/80">
                  静态演示未随附图片文件，此处保留图题与原始路径
                </span>
              </figure>
            );

          case 'table':
            return (
              <TableWrapper key={key} className="my-4 rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/60 hover:bg-secondary/60">
                      {block.header.map((cell, cellIndex) => (
                        <TableHead key={`${key}-h${cellIndex}`}>{renderInline(cell, `${key}-h${cellIndex}`)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.rows.map((row, rowIndex) => (
                      <TableRow key={`${key}-r${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <TableCell key={`${key}-r${rowIndex}c${cellIndex}`} className="text-xs">
                            {renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            );

          case 'rule':
            return <hr key={key} className="my-6 border-border" />;

          default:
            return null;
        }
      })}
    </div>
  );
}
