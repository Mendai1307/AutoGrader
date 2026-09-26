/**
 * AutoGrader · 空态（Server Component）
 * ---------------------------------------------------------------------------
 * 数据未产出时的统一降级展示：说明「缺什么、为什么缺、缺的时候还能看到什么」，
 * 而不是留下一片空白或报错。
 */

import { CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description: ReactNode;
  /** 附加内容：例如仍然可展示的客观统计 */
  children?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'warning';
  className?: string;
}

export function EmptyState({ title, description, children, icon, tone = 'neutral', className }: EmptyStateProps) {
  return (
    <Card
      className={cn(
        'border-dashed p-6',
        // neutral 与 warning 的区分靠「线性与底深」而不是换色（本项目不引入第二色系）
        tone === 'warning' ? 'border-rule bg-secondary/60' : 'border-border bg-secondary/30',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
            tone === 'warning'
              ? 'border-rule bg-muted text-foreground'
              : 'border-border bg-background text-muted-foreground',
          )}
        >
          {icon ?? <CircleDashed className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        </div>
      </div>
      {children === undefined ? null : <div className="mt-4">{children}</div>}
    </Card>
  );
}
