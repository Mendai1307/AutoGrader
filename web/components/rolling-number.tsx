'use client';

/**
 * AutoGrader · 数字滚动（Client Component）
 * ===========================================================================
 * 参考设计里"编号与数字滚动"的那一档动效：目标值变化时用 460ms 把数字滚过去，
 * 而不是硬切。用在总分、份数这类"会变的量"上，让变化本身可被注意到。
 *
 * 为什么不用 CSS 的逐帧滚动：数字要显示的是**实数插值**（0.92 → 0.87 之间要有
 * 中间态），CSS 只能做位移动画、拿不到中间值。这里用 requestAnimationFrame 插值。
 *
 * 纪律：
 *   · 尊重 `prefers-reduced-motion` —— 直接显示目标值，不做插值；
 *   · 卸载时取消动画帧，不留悬挂的回调（用户规定：每轮结束前释放进程与句柄）；
 *   · 等宽数字由 `.tnum` 提供，滚动过程中宽度不跳。
 */

import { useEffect, useRef, useState } from 'react';

export interface RollingNumberProps {
  /** 目标数值 */
  value: number;
  /** 数值 → 文本。默认保留 2 位后去掉尾零（与 lib/utils.ts 的 formatScore 同口径） */
  format?: (value: number) => string;
  /** 滚动时长（毫秒），默认 460ms（参考设计的时长档） */
  durationMs?: number;
  className?: string;
  /** 无障碍标签：滚动中的数字对读屏器是噪声，只播报目标值 */
  label?: string;
}

/** 默认格式化：保留 2 位再去掉无意义的尾零（79.00 → 79；78.50 → 78.5） */
function defaultFormat(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** 减速曲线：起手快、收尾稳（与 globals.css 的微过渡缓动同一族） */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function RollingNumber({
  value,
  format = defaultFormat,
  durationMs = 460,
  className,
  label,
}: RollingNumberProps) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    if (reduced || durationMs <= 0 || from === value) {
      fromRef.current = value;
      setDisplayed(value);
      return;
    }

    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const next = from + (value - from) * easeOutCubic(progress);
      setDisplayed(next);
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        frameRef.current = null;
        fromRef.current = value;
        setDisplayed(value);
      }
    };

    frameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // 记录当前显示位置：下次变化从这里续起，而不是从上一个目标值跳回
      fromRef.current = displayed;
    };
    // displayed 故意不入依赖：它每次插值都会变，入依赖会导致动画被反复重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return (
    <span className={className} aria-label={label}>
      <span aria-hidden className="tnum">
        {format(displayed)}
      </span>
      {label === undefined ? null : <span className="sr-only">{format(value)}</span>}
    </span>
  );
}
