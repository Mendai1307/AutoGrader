/**
 * AutoGrader · 统计卡片（Server Component）
 */

import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  /** 值区配色，默认继承前景色 */
  valueClassName?: string;
  className?: string;
}

export function StatCard({ label, value, hint, icon, valueClassName, className }: StatCardProps) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon === undefined ? null : <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', valueClassName)}>
        {value}
      </div>
      {hint === undefined ? null : (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </Card>
  );
}
