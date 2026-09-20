/**
 * AutoGrader · 一致性评测计算（纯函数）
 * ---------------------------------------------------------------------------
 * 只做数学计算，不读文件、不抛异常。数据由页面从 lib/data.ts 取好后传入。
 *
 * 口径（与 docs/contract.md 一致，页面必须原样标注给教师看）：
 *   - 总分 MAE = (1 / N) × Σ |AI_i − 金标准_i|，N = 已产出评阅结果的报告数；
 *     结果保留 2 位小数（四舍五入 half-up）。
 *   - 逐项命中率 = 档位完全一致的评分点数 / 可比评分点数；
 *     「档位完全一致」指 ScoreItem.level 与教师金标准 level 相同。
 *   - 偏差 delta = AI 总分 − 教师金标准分（正值表示 AI 给分偏松）。
 */

import type { ScoreLevel } from '@/lib/schema';

/** 保留 2 位小数（half-up），与 schema.ts 内部口径一致 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ==========================================================================
 * 逐份对比行
 * ========================================================================== */

export interface EvalRow {
  reportId: string;
  title: string;
  tier: string;
  /** 教师金标准分 */
  goldTotalScore: number;
  /** AI 加权总分；未产出结果时为 null */
  aiTotalScore: number | null;
  /** AI 总分 − 金标准分；未产出结果时为 null */
  delta: number | null;
  status: 'ok' | 'missing' | 'invalid';
}

/** 总分 MAE 结果 */
export interface MaeResult {
  /** 参与计算的报告数（即已产出合法结果的份数） */
  count: number;
  /** 平均绝对误差；无样本时为 null */
  mae: number | null;
  /** 单份最大绝对偏差；无样本时为 null */
  maxAbsDelta: number | null;
  /** 单份最大绝对偏差对应的报告 id；无样本时为 null */
  maxAbsDeltaReportId: string | null;
}

/** 从对比行计算总分 MAE（只用 status === 'ok' 的行） */
export function computeMae(rows: readonly EvalRow[]): MaeResult {
  const usable = rows.filter(
    (row): row is EvalRow & { aiTotalScore: number; delta: number } =>
      row.status === 'ok' && row.aiTotalScore !== null && row.delta !== null,
  );

  if (usable.length === 0) {
    return { count: 0, mae: null, maxAbsDelta: null, maxAbsDeltaReportId: null };
  }

  let sum = 0;
  let maxAbs = -1;
  let maxId = usable[0]?.reportId ?? '';
  for (const row of usable) {
    const abs = Math.abs(row.delta);
    sum += abs;
    if (abs > maxAbs) {
      maxAbs = abs;
      maxId = row.reportId;
    }
  }

  return {
    count: usable.length,
    mae: round2(sum / usable.length),
    maxAbsDelta: round2(maxAbs),
    maxAbsDeltaReportId: maxId,
  };
}

/* ==========================================================================
 * 逐项命中率
 * ========================================================================== */

export interface ItemHitRow {
  rubricItemId: string;
  itemName: string;
  weight: number;
  /** 可比项数：已有 AI 结果且金标准也标注了该项的份数 */
  comparable: number;
  /** 档位与金标准完全一致的项数 */
  hits: number;
  /** 命中率 0–1；无可比项时为 null */
  rate: number | null;
}

/** 一份报告的金标准档位映射（rubricItemId → level） */
export interface GoldLevelEntry {
  reportId: string;
  levels: Readonly<Record<string, ScoreLevel>>;
}

/** 一份报告的 AI 档位映射（rubricItemId → level） */
export interface AiLevelEntry {
  reportId: string;
  levels: Readonly<Record<string, ScoreLevel>>;
}

/**
 * 计算逐项命中率。
 * 以金标准中出现的评分点为准（rubric 12 个），逐点统计 AI 档位是否与其一致。
 */
export function computeItemHits(
  rubricItems: readonly { id: string; name: string; weight: number }[],
  gold: readonly GoldLevelEntry[],
  ai: readonly AiLevelEntry[],
): ItemHitRow[] {
  const goldByReport = new Map(gold.map((entry) => [entry.reportId, entry.levels]));
  const aiByReport = new Map(ai.map((entry) => [entry.reportId, entry.levels]));

  return rubricItems.map((item) => {
    let comparable = 0;
    let hits = 0;

    for (const [reportId, aiLevels] of aiByReport) {
      const goldLevels = goldByReport.get(reportId);
      if (goldLevels === undefined) continue;
      const goldLevel = goldLevels[item.id];
      const aiLevel = aiLevels[item.id];
      if (goldLevel === undefined || aiLevel === undefined) continue;
      comparable += 1;
      if (goldLevel === aiLevel) hits += 1;
    }

    return {
      rubricItemId: item.id,
      itemName: item.name,
      weight: item.weight,
      comparable,
      hits,
      rate: comparable === 0 ? null : round2(hits / comparable),
    };
  });
}

/* ==========================================================================
 * 分布统计
 * ========================================================================== */

/** 难度档位分布 */
export interface TierBucket {
  tier: string;
  count: number;
}

export function countByTier(reports: readonly { tier: string }[], order: readonly string[]): TierBucket[] {
  const counter = new Map<string, number>(order.map((tier) => [tier, 0]));
  for (const report of reports) {
    counter.set(report.tier, (counter.get(report.tier) ?? 0) + 1);
  }
  return order.map((tier) => ({ tier, count: counter.get(tier) ?? 0 }));
}

/** 分数区间分布 */
export interface BandBucket {
  label: string;
  /** 区间下界（含） */
  min: number;
  /** 区间上界（不含；最后一档为含） */
  max: number;
  count: number;
}

const SCORE_BANDS: readonly { label: string; min: number; max: number }[] = [
  { label: '90 分及以上', min: 90, max: Number.POSITIVE_INFINITY },
  { label: '80 – 89.9', min: 80, max: 90 },
  { label: '60 – 79.9', min: 60, max: 80 },
  { label: '60 分以下', min: Number.NEGATIVE_INFINITY, max: 60 },
];

/** 按固定区间统计分数分布 */
export function countScoreBands(scores: readonly number[]): BandBucket[] {
  return SCORE_BANDS.map((band) => ({
    ...band,
    count: scores.filter((score) => score >= band.min && score < band.max).length,
  }));
}

/** 档位分布（用于展示 AI 或金标准的档位倾向） */
export interface LevelBucket {
  level: ScoreLevel;
  count: number;
}

const LEVEL_ORDER: readonly ScoreLevel[] = ['excellent', 'meeting', 'partial', 'notMet'];

export function countLevels(levels: readonly ScoreLevel[]): LevelBucket[] {
  return LEVEL_ORDER.map((level) => ({
    level,
    count: levels.filter((value) => value === level).length,
  }));
}

/** 评测口径说明文案（页面原样渲染，不得改写口径） */
export const MAE_DEFINITION =
  'MAE = (1 / N) × Σ |AI 加权总分_i − 教师金标准分_i|，N 为已产出评阅结果的报告份数，结果保留 2 位小数。';

export const HIT_RATE_DEFINITION =
  '逐项命中率 = 档位与教师金标准完全一致的评分点数 ÷ 可比评分点数；分子分母均只统计「已有 AI 结果且金标准已标注」的项。';

export const DELTA_DEFINITION =
  '偏差 = AI 加权总分 − 教师金标准分，正值表示 AI 给分偏松，负值表示偏严。';

export const GOLD_SCORE_DEFINITION =
  '教师金标准分由教师在 rubric 档位标准下逐项人工标注后按同一加权口径（round2(Σ(score_i / maxScore_i × weight_i))）核算。';
