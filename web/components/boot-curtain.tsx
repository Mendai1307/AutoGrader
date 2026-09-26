'use client';

/**
 * AutoGrader · 白场入场（Client Component）
 * ===========================================================================
 * 一次**极短、可跳过、不阻塞**的入场过渡。取自参考设计（LBEILC/RhineLabUI）
 * 的"白底开场"意象：纸色铺满 → 一条细线拉出进度 → 淡出交还页面。
 *
 * 三条纪律（避免把装饰做成障碍）
 * ---------------------------------------------------------------------------
 *   1. **不阻塞内容**：遮罩在客户端挂载后才渲染（服务端 HTML 里没有它），
 *      页面内容始终已在 DOM 中；遮罩只是视觉层，最迟 1.2s 必被移除。
 *   2. **可跳过**：任意点击 / 按键 / 滚动立即结束。
 *   3. **只出现一次**：同一会话（sessionStorage）内不再重复，
 *      否则站内跳转每次都要等一遍，反而拖慢演示。
 *   4. 尊重 `prefers-reduced-motion`：直接不显示。
 *
 * 为什么不用 CSS 动画做"自动消失"：CSS 动画不保证在标签页后台时按预期推进，
 * 会出现"回到页面发现遮罩还在"。这里用显式计时器，可靠得多。
 */

import { useEffect, useState } from 'react';

/** 遮罩总时长（毫秒）—— 上限，实际会被跳过逻辑提前结束 */
const HOLD_MS = 900;
/** 淡出时长（毫秒） */
const FADE_MS = 300;

const SESSION_KEY = 'autograder:boot-shown';

export function BootCurtain() {
  /** 'hidden' → 不渲染；'shown' → 显示遮罩；'fading' → 正在淡出 */
  const [phase, setPhase] = useState<'hidden' | 'shown' | 'fading'>('hidden');

  useEffect(() => {
    // 1) 尊重减少动态效果
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // 2) 同一会话只播一次
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === '1') return;
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // 隐私模式下 sessionStorage 可能不可用 —— 那就每次都播，不影响功能
    }

    setPhase('shown');

    let fadeTimer: number | undefined;
    const finish = () => {
      setPhase((current) => (current === 'fading' ? current : 'fading'));
      fadeTimer = window.setTimeout(() => setPhase('hidden'), FADE_MS);
    };

    const holdTimer = window.setTimeout(finish, HOLD_MS);

    let done = false;
    const skip = () => {
      if (done) return;
      done = true;
      window.clearTimeout(holdTimer);
      finish();
    };

    // 3) 任意交互立即跳过
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('wheel', skip, { once: true, passive: true });

    return () => {
      window.clearTimeout(holdTimer);
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-background"
      style={{
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.2, 0.6, 0.2, 1)`,
      }}
    >
      <div className="flex w-[min(420px,72vw)] flex-col items-center gap-5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-semibold tracking-[0.42em] text-foreground">AUTOGRADER</span>
          <span className="h-3 w-px bg-rule" aria-hidden />
          <span className="text-[11px] tracking-[0.18em] text-muted-foreground">ANALYSIS OS</span>
        </div>
        {/* 细线进度：宽度从 0 拉到 100%，时长与 HOLD_MS 同步 */}
        <div className="h-px w-full overflow-hidden bg-border">
          <div
            className="h-full bg-primary"
            style={{
              animation: `boot-progress ${HOLD_MS}ms cubic-bezier(0.35, 0, 0.25, 1) forwards`,
            }}
          />
        </div>
        <span className="text-[11px] tracking-[0.14em] text-muted-foreground">
          正在载入评阅数据
        </span>
      </div>

      {/* 关键帧只在本组件用到，放这里避免污染 globals.css */}
      <style>{`
        @keyframes boot-progress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  );
}
