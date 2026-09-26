/**
 * AutoGrader · 五件套轨道图（Server Component，零依赖）
 * ===========================================================================
 * 用一条竖向轨道 + 长短刻度把「Prompt / Skills / Tools / Workflow / Evaluation」
 * 五层的**落点、数量、职责**画出来，替代五张并列卡片的常见做法。
 *
 * 为什么用 HTML/CSS 而不是 SVG：这是**结构性**示意（层次 + 从属关系 + 计数），
 * 不是数据图。用 DOM 表达可以随文字长度自然伸缩、可被读屏器读取、可随主题换色；
 * 硬画成 SVG 反而要在缩放与文字折行上做妥协。数据图（MAE 对比、分布）才用自绘 SVG。
 *
 * 视觉语言取自参考设计：一条细线轨道 + 长短刻度表示"当前层级"，颜色只用灰阶与
 * 单一强调色（暖棕），不引入第二色系。
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface PieceRow {
  /** 英文层名，如 "Prompt" */
  key: string;
  /** 中文层名 */
  label: string;
  /** 该层的落点（仓库内相对路径） */
  location: string;
  /** 数量标签，如 "8 个技能"；无数量时给 undefined */
  count?: string;
  /** 该层的一句话职责 */
  responsibility: string;
  /** 补充说明（如完成判据） */
  note?: ReactNode;
}

export interface FivePieceDiagramProps {
  rows: readonly PieceRow[];
  className?: string;
}

export function FivePieceDiagram({ rows, className }: FivePieceDiagramProps) {
  return (
    <ol className={cn('relative', className)}>
      {/* 竖向轨道：左起 8px，与刻度列（w-4 居中）的中轴对齐 */}
      <span aria-hidden className="absolute left-2 top-4 bottom-4 w-px bg-rule" />
      {rows.map((row) => (
        <li key={row.key} className="relative flex gap-3 py-3.5">
          {/*
            刻度列：固定 16px 宽、内部居中，于是 3px 的竖条中轴恒在 8px —— 与轨道重合。
            长短表示层级：入口层（Prompt）用长刻度 + 强调色，其余用短刻度 + 灰线。
          */}
          <span aria-hidden className="relative z-10 flex w-4 shrink-0 justify-center">
            <span
              className={cn('mt-1 w-[3px]', row.key === 'Prompt' ? 'h-[22px] bg-primary' : 'h-[15px] bg-rule')}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-mono text-[13px] font-semibold tracking-tight text-foreground">
                {row.key}
              </span>
              <span className="text-[13px] text-foreground">{row.label}</span>
              {row.count === undefined ? null : (
                <span className="tnum text-[11px] text-muted-foreground">{row.count}</span>
              )}
              <code className="ml-auto max-w-full truncate font-mono text-[11px] text-muted-foreground">
                {row.location}
              </code>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {row.responsibility}
            </p>
            {row.note === undefined ? null : (
              <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">{row.note}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
