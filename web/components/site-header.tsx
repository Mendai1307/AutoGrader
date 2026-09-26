/**
 * AutoGrader · 顶部导航（Server Component）
 * 通过 active 属性高亮当前页，不引入 usePathname，保持零客户端 JS。
 */

import Link from 'next/link';
import { Blocks, GitBranch, LayoutGrid, Scale } from 'lucide-react';
import type { ComponentType } from 'react';

import { NAV_ITEMS, SITE_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';

const NAV_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  '/': Blocks,
  '/grade': LayoutGrid,
  '/eval': Scale,
  '/trace': GitBranch,
};

export interface SiteHeaderProps {
  /** 当前激活的路由 */
  active: string;
}

export function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Blocks className="h-4 w-4" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">{SITE_NAME}</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.href];
            const isActive = item.href === active;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {Icon === undefined ? null : <Icon className="h-3.5 w-3.5" />}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
