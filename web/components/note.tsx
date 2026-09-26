/**
 * AutoGrader · 说明块（二级菜单形态）
 * ---------------------------------------------------------------------------
 * 页面正文只留结论，把「为什么这么算 / 口径怎么定的 / 数据从哪来」这类**注释性长句**
 * 收进这里，默认收起、点击展开。
 *
 * 为什么用原生 `<details>` 而不是 JS 弹层或页签：
 *   ① **内容仍留在 HTML 里** —— 静态导出后依然可被检索与核验，也满足"证据可查看"的要求；
 *   ② **无 JS 也能展开** —— 纯静态站不该把说明藏在脚本状态后面（页签的坑已经踩过一次）；
 *   ③ 零依赖、零状态，不引入任何客户端组件。
 *
 * 纯函数组件，Server / Client 两侧都能渲染。
 *
 * ⚠️ 折叠标记必须用 **lucide 图标**，不能用文字字形（`▸` U+25B8 等）：
 *    MiSans 子集是**按源码实际用到的码位**裁的（`npm run sync:fonts`），
 *    自己敲一个几何符号进源码，`check:fonts` 的 C1 会报「可能被渲染的码位未覆盖」，
 *    真机上就会显示成豆腐块 —— 图标走 SVG，不进字体子集，天然没有这个问题。
 */

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface NoteProps {
  /** 收起时显示的标签；默认「说明」 */
  summary?: string;
  /** 展开后的内容，通常是一到两段短句 */
  children: ReactNode;
  className?: string;
}

export function Note({ summary = '说明', children, className }: NoteProps) {
  return (
    <details className={cn('group rounded-md border border-border bg-secondary/25 px-3 py-2', className)}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight
          aria-hidden
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
          strokeWidth={2.5}
        />
        {summary}
      </summary>
      <div className="mt-2 space-y-1.5 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/**
 * 一行式脚注：内容很短、且**属于结论本身**（例如「容差 ±2」），
 * 不适合藏起来，就直接渲染成一行淡色小字。
 */
export function Footnote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-relaxed text-muted-foreground', className)}>{children}</p>;
}
