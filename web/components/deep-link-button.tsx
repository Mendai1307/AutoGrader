'use client';

/**
 * AutoGrader · 深链唤起 LearnBuddy（2.6）
 * ---------------------------------------------------------------------------
 * 这一页的价值主张是「结果可复核」。复核要在 **LearnBuddy 对话侧**发生，
 * 所以网页必须能把用户送过去，并且**在任何情况下都产生可见结果**。
 *
 * 三级降级（缺一级都算死按钮，故三级都必须实装）
 * ---------------------------------------------------------------------------
 *   ① **深链**：顶层真实 `<a href="learnbuddy://task?...">`。
 *      必须是 `<a>`，不能用 `location.href` —— 平台侧会丢弃脚本发起的协议跳转。
 *      点了之后浏览器不会给任何回调，只能**间接探测**：监听 `visibilitychange` /
 *      `blur`，若 1200ms 后页面**仍然可见**，判定「没装客户端」。
 *   ② **剪贴板**：判定未安装后立刻把 prompt 复制进剪贴板并给出提示
 *      （「已复制，粘贴到 LearnBuddy」），同时**保留「再试深链」**（用户可能刚装完）。
 *      剪贴板 API 在非安全上下文不可用 → 退到 `execCommand('copy')` 临时 textarea。
 *   ③ **兜底链接**：`<details>` 里给出 prompt 全文供手动复制，并给出到
 *      `/report/[id]` 的常规链接（不依赖任何协议处理器）。
 *
 * prompt 为什么这么短
 * ---------------------------------------------------------------------------
 * `SYSTEM_PROMPT.md` 有 1.6 万字节，而深链 `prompt` 解码后上限 8000 字符、
 * 整条 URL 还受 Windows 命令行 32767 上限约束 —— **全文内联不可行**。
 * 正解：深链只带「目标 + 任务 + 提示词所在 raw 地址」，全文由智能体用
 * 内置 `WebFetch` 去读。若智能体读不到，prompt 里已写明「直接向用户索取」。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CircleCheck, ClipboardCopy, Info, RefreshCw } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DEEP_LINK_ACTIONS,
  DEEP_LINK_PROMPT_LIMIT,
  DEEP_LINK_SCHEME,
  REPO_RAW_BASE,
  SYSTEM_PROMPT_REPO_PATH,
} from '@/lib/constants';
import { cn } from '@/lib/utils';

export type DeepLinkAction = keyof typeof DEEP_LINK_ACTIONS;

export interface DeepLinkButtonProps {
  reportId: string;
  title: string;
  action?: DeepLinkAction;
  /** 判定「客户端未安装」的等待时长 */
  fallbackDelayMs?: number;
  className?: string;
}

/** 样例报告在仓库里的位置（与工具链随包资产根一致） */
const SAMPLE_ASSET_DIR = 'backend/autograder-expert/agents/tools/assets/sample';
/** 金标准 manifest（复核时可对照教师分） */
const GOLD_ASSET_DIR = 'backend/autograder-expert/agents/tools/assets/gold';

/**
 * 推导仓库 raw 根。
 * 优先用固定常量；没填就按 GitHub Pages 站点推导（`<owner>.github.io/<repo>/`）。
 * **推导不出就返回 null** —— 宁可降级，也不编造一个仓库名。
 */
export function deriveRepoRawBase(location: { hostname: string; pathname: string } | null): string | null {
  if (REPO_RAW_BASE !== '') return REPO_RAW_BASE.replace(/\/+$/, '');
  if (location === null) return null;

  const matched = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  if (matched === null) return null;

  const owner = matched[1];
  // 用户站点（<owner>.github.io/）没有仓库段，raw 根无从推导
  const repo = location.pathname.split('/').filter((seg) => seg !== '')[0];
  if (repo === undefined) return null;

  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
}

/** 构造深链 prompt。导出以便单测/人工核对字符数。 */
export function buildDeepLinkPrompt(input: {
  reportId: string;
  title: string;
  action: DeepLinkAction;
  repoRawBase: string | null;
}): string {
  const { reportId, title, action, repoRawBase } = input;

  const lines: string[] = [
    '【AutoGrader 触发】',
    `目标报告：${reportId}《${title}》`,
    `任务：${DEEP_LINK_ACTIONS[action]}，产出符合 ReviewResult 契约的评阅结果。`,
  ];

  if (repoRawBase === null) {
    // 拿不到 raw 根时如实降级，并告诉智能体该怎么办 —— 不留一个必然失败的步骤
    lines.push(
      '系统提示词：我这边无法给出仓库地址，请你向我索要 AutoGrader 专家包的系统提示词，',
      '或直接以你已安装的 AutoGrader 专家身份继续。',
    );
  } else {
    lines.push(
      `系统提示词全文（请用内置能力**逐字读取**，不要凭记忆转述）：`,
      `${repoRawBase}/${SYSTEM_PROMPT_REPO_PATH}`,
      `该报告原文：${repoRawBase}/${SAMPLE_ASSET_DIR}/${reportId}.md`,
      `教师金标准（供复核对照）：${repoRawBase}/${GOLD_ASSET_DIR}/gold-manifest.json`,
      '若读取失败（例如拿到的是网页外壳而非文件内容），请直接告诉我，我会把提示词粘贴给你。',
    );
  }

  return lines.join('\n');
}

/** 拼深链 URL（`prompt` 必须 encodeURIComponent） */
export function buildDeepLinkHref(prompt: string): string {
  return `${DEEP_LINK_SCHEME}?action=start&prompt=${encodeURIComponent(prompt)}`;
}

/**
 * 复制文本。`navigator.clipboard` 在非安全上下文（http 非 localhost 等）不可用，
 * 故备一条 `execCommand('copy')` 的非标准路径；两条都失败返回 false，
 * 由调用方把 prompt 全文亮出来供手动复制。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    document.body.removeChild(area);
    return done;
  } catch {
    return false;
  }
}

type Phase = 'idle' | 'probing' | 'fallback';

export function DeepLinkButton({
  reportId,
  title,
  action = 'review',
  fallbackDelayMs = 1200,
  className,
}: DeepLinkButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [copied, setCopied] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState<string>('');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftPage = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // 探测「客户端是否接管了这次跳转」：页面失焦/隐藏 = 大概率拉起了客户端
  useEffect(() => {
    if (phase !== 'probing') return;

    const onLeave = () => {
      leftPage.current = true;
      clearTimer();
      setPhase('idle');
    };

    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('blur', onLeave);
      clearTimer();
    };
  }, [phase, clearTimer]);

  // 卸载时清掉未触发的定时器（比 "结束前释放" 更早，防内存泄漏）
  useEffect(() => clearTimer, [clearTimer]);

  const handleClick = useCallback(() => {
    // prompt 需要 location，只能在客户端算
    const base = deriveRepoRawBase(
      typeof window === 'undefined'
        ? null
        : { hostname: window.location.hostname, pathname: window.location.pathname },
    );
    const text = buildDeepLinkPrompt({ reportId, title, action, repoRawBase: base });
    setPrompt(text);

    if (phase === 'fallback') return; // 已是兜底态，按钮变成「再试深链」，不再重复探测

    leftPage.current = false;
    setPhase('probing');
    clearTimer();
    timer.current = setTimeout(() => {
      // 页面还在这儿 → 没有客户端接管 → 进入兜底态
      if (leftPage.current) return;
      setPhase('fallback');
      void copyText(text).then(setCopied);
    }, fallbackDelayMs);
  }, [action, clearTimer, fallbackDelayMs, phase, reportId, title]);

  const href = prompt === '' ? buildDeepLinkHref(buildDeepLinkPrompt({ reportId, title, action, repoRawBase: null }))
    : buildDeepLinkHref(prompt);

  const tooLong = prompt.length > DEEP_LINK_PROMPT_LIMIT;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {/* ① 顶层真实 <a>：必须是 <a>，脚本跳转会被平台丢弃 */}
        <a
          href={href}
          onClick={handleClick}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'gap-1.5')}
        >
          {phase === 'fallback' ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              再试深链
            </>
          ) : (
            <>
              <ArrowUpRight className="h-3.5 w-3.5" />
              {action === 'recheck' ? '在 LearnBuddy 里复核这份结果' : '在 LearnBuddy 里评阅这份报告'}
            </>
          )}
        </a>

        {/* ③ 兜底链接：不依赖任何协议处理器，永远可达 */}
        <Link
          href={`/report/${reportId}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          <Info className="h-3.5 w-3.5" />
          查看本页结果明细
        </Link>
      </div>

      {/* ② 剪贴板兜底提示 */}
      {phase === 'fallback' ? (
        <Card className="border-rule bg-secondary/60 p-3">
          <div className="flex items-start gap-2">
            {copied === true ? (
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <ClipboardCopy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <div className="min-w-0 flex-1 text-xs leading-relaxed">
              {copied === true ? (
                <p className="font-medium">
                  没检测到 LearnBuddy 客户端，
                  <strong className="font-semibold">任务指令已复制到剪贴板</strong>
                  {' '}—— 打开 LearnBuddy 直接粘贴发送即可。
                </p>
              ) : (
                <p className="font-medium">
                  没检测到 LearnBuddy 客户端，浏览器也拒绝了自动复制 —— 请展开下方指令
                  <strong className="font-semibold">手动复制</strong>。
                </p>
              )}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  查看 / 手动复制任务指令（{prompt.length} 字符）
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2 font-mono text-[11px] leading-relaxed">
                  {prompt}
                </pre>
              </details>
            </div>
          </div>
        </Card>
      ) : null}

      {tooLong ? (
        <p className="text-[11px] text-muted-foreground">
          指令 {prompt.length} 字符，已超过平台 {DEEP_LINK_PROMPT_LIMIT} 字符上限 —— 这是一个缺陷，请反馈。
        </p>
      ) : null}
    </div>
  );
}
