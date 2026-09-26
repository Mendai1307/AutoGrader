/**
 * AutoGrader · Progress（手写基础组件）
 * 纯 div 实现，支持自定义轨道/填充色，用于分数进度与置信度条。
 */

import { cn } from '@/lib/utils';

export interface ProgressProps {
  /** 当前值 */
  value: number;
  /** 满值，默认 100 */
  max?: number;
  className?: string;
  /** 填充条样式，默认 bg-primary */
  barClassName?: string;
  /** 无障碍标签 */
  label?: string;
}

export function Progress({ value, max = 100, className, barClassName, label }: ProgressProps) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width]', barClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
