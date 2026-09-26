/**
 * AutoGrader · Tabs（手写基础组件 · Client Component）
 * 唯一需要交互的基础组件：纯本地状态切换，无任何数据请求。
 */

'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: string;
  /** 可选计数徽标 */
  count?: number;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** 默认选中的 tab */
  defaultValue?: string;
  className?: string;
}

export function Tabs({ items, defaultValue, className }: TabsProps) {
  const firstValue = items[0]?.value ?? '';
  const [active, setActive] = useState<string>(defaultValue ?? firstValue);
  const activeItem = items.find((item) => item.value === active) ?? items[0];

  if (activeItem === undefined) return null;

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <div role="tablist" className="flex flex-wrap gap-1 rounded-lg border border-border bg-secondary/50 p-1">
        {items.map((item) => {
          const selected = item.value === activeItem.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(item.value)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
              {item.count === undefined ? null : (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs',
                    selected ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{activeItem.content}</div>
    </div>
  );
}
