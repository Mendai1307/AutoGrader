/**
 * AutoGrader · 通用样式与格式化工具
 * ---------------------------------------------------------------------------
 * 纯函数，不依赖任何运行时数据源，Server / Client 组件均可安全引入。
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 className：clsx 处理条件，tailwind-merge 消解冲突的 Tailwind 类 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 分数展示：去掉无意义的小数零。
 * 79.00 → "79"；78.50 → "78.5"；99.40 → "99.4"；79.25 → "79.25"。
 * 仅影响展示，不回写任何数据（见 docs/contract.md 第四节舍入规则）。
 *
 * 契约 1.2.0 起 `score` 可为 null（尚无终值），此处统一渲染为 "—"，
 * 不用 0 冒充 —— 0 分与"没有终值"是两件事。
 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** 带符号的偏差展示：0.5 → "+0.5"；-2.3 → "-2.3" */
export function formatDelta(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const base = formatScore(Math.abs(value));
  if (value > 0) return `+${base}`;
  if (value < 0) return `-${base}`;
  return '0';
}

/** 置信度展示：0.92 → "92%"；1 → "100%" */
export function formatConfidence(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** 置信度原始值展示：0.92 → "0.92" */
export function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

/**
 * 时间展示：直接保留源文件中的 ISO8601 与偏移量，不做本地时区转换，
 * 以保证同一份 JSON 在任何机器上渲染结果完全一致（确定性渲染要求）。
 * "2026-09-20T10:24:36+08:00" → "2026-09-20 10:24:36 UTC+08:00"
 */
export function formatDateTime(iso: string): string {
  const normalized = iso.replace('T', ' ');
  const matched = /([+-]\d{2}:\d{2}|Z)$/.exec(normalized);
  if (!matched) return normalized;
  const zone = matched[1] === 'Z' ? 'UTC+00:00' : `UTC${matched[1]}`;
  return `${normalized.slice(0, matched.index)} ${zone}`.trim();
}

/** 大数展示：2334 → "2,334" */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** 截断长文本，用于卡片摘要 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
