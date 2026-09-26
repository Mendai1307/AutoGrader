/**
 * AutoGrader · Separator（手写基础组件）
 *
 * ⚠️ 当前未被引用（全量检索 `app/`、`components/`、`lib/` 除本文件自身外无任何 import）。
 * 原计划删除该文件，但删除动作被本机删除守卫拦截（`SAFE_DELETE_FAIL_CLOSED`），
 * 故按原样保留并在此标注。它是 shadcn/ui 风格的基础组件，属可随时复用的展示层资产，
 * 保留不影响构建与产物体积（未被引用即不会进入打包结果）。
 */

import { cn } from '@/lib/utils';

export interface SeparatorProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ className, orientation = 'horizontal' }: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}
