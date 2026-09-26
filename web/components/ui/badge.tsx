/**
 * AutoGrader · Badge（手写基础组件）
 * ---------------------------------------------------------------------------
 * 语义色板用于状态、档位、置信度分级等中文标签。
 *
 * 色彩纪律：**单强调色 + 灰阶**。除 `danger`（真的出错）外，没有一个变体使用
 * 红/绿/蓝等第二色系 —— 序数与程度由调用方的符号（●●○○）与字重承担。
 * 详见 lib/constants.ts 顶部的「色彩策略」说明。
 */

import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-background text-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        /** 完成 / 命中：暖棕轻度着色（唯一强调色） */
        accent: 'border-primary/45 bg-primary/5 text-foreground',
        /** 中性信息：极浅底，用于"附带说明" */
        info: 'border-border bg-card text-foreground',
        /** 需注意但非错误：虚线边 + 弱字色，靠"形"而非"色"提示 */
        warning: 'border-dashed border-rule bg-transparent text-muted-foreground',
        /** 真的出错（构建失败 / 契约校验不通过）才用它 */
        danger: 'border-destructive/50 bg-destructive/5 text-destructive',
      },
    },
    defaultVariants: { variant: 'muted' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
