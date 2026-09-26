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

/* ==========================================================================
 * 档位一致率与置信度校准（2.7 补齐）
 * ==========================================================================
 * ⚠️ 口径**移植自工具链** `backend/autograder-expert/agents/evaluations/scripts/evaluate.py`
 *    （`comparable_pairs` / `compute_item_hits` / `compute_calibration`），不是另起一套。
 *    两侧必须逐值一致，否则网页与评测脚本会给出两个数 —— 那比没有这个指标更糟。
 *
 * 三条容易写错的细节，全部照抄工具链：
 *   ① **可比对** = 「该份结果 status ok」且「该项在 AI 与金标准两侧都有档位」；
 *      命中 = 「AI 档位 === 金标准档位」。
 *   ② **档位一致率**是**汇总值**（Σhits ÷ Σcomparable），不是逐项命中率的平均。
 *   ③ **ECE** 用的是**已展示的 2 位小数**的 accuracy 与 meanConfidence 之差，
 *      为的是让读者能拿计算器手工复算（先 round2 再加权，顺序不能颠倒）。
 * ========================================================================== */

/** 置信度分桶阈值：直接取自 `docs/contract.md` §八（HIGH = 0.80 / MEDIUM = 0.60），不另行发明 */
export const CONF_BUCKETS: readonly { name: string; lo: number | null; hi: number | null }[] = [
  { name: 'low', lo: null, hi: 0.6 },
  { name: 'medium', lo: 0.6, hi: 0.8 },
  { name: 'high', lo: 0.8, hi: null },
];

/** 一个可比对的评分点：AI 档位、金标准档位、是否命中、以及 AI 给的置信度 */
export interface LevelPair {
  reportId: string;
  rubricItemId: string;
  aiLevel: ScoreLevel;
  goldLevel: ScoreLevel;
  hit: boolean;
  /** AI 对该项的置信度；缺失为 null（会从 ECE 中剔除但进 `itemsWithoutConfidence`） */
  confidence: number | null;
}

/** 一份报告的 AI 逐项档位与置信度 */
export interface AiItemEntry {
  reportId: string;
  items: Readonly<Record<string, { level: ScoreLevel | null; confidence: number | null }>>;
}

/**
 * 构造可比对集合（对应工具链的 `comparable_pairs`）。
 * 输入顺序、键排序都无关紧要：结果按 (reportId, rubricItemId) 排序后返回，保证可复算。
 */
export function buildLevelPairs(
  gold: readonly GoldLevelEntry[],
  ai: readonly AiItemEntry[],
): LevelPair[] {
  const goldByReport = new Map(gold.map((entry) => [entry.reportId, entry.levels]));
  const pairs: LevelPair[] = [];

  for (const entry of ai) {
    const goldLevels = goldByReport.get(entry.reportId);
    if (goldLevels === undefined) continue;

    for (const itemId of Object.keys(goldLevels).sort()) {
      const goldLevel = goldLevels[itemId];
      const mine = entry.items[itemId];
      if (goldLevel === undefined || mine === undefined || mine.level === null) continue;
      pairs.push({
        reportId: entry.reportId,
        rubricItemId: itemId,
        aiLevel: mine.level,
        goldLevel,
        hit: mine.level === goldLevel,
        confidence: mine.confidence,
      });
    }
  }

  pairs.sort((a, b) =>
    a.reportId === b.reportId
      ? a.rubricItemId.localeCompare(b.rubricItemId)
      : a.reportId.localeCompare(b.reportId),
  );
  return pairs;
}

export interface LevelAgreement {
  /** 可比评分点数 */
  comparable: number;
  /** 档位一致的评分点数 */
  hits: number;
  /** 汇总一致率 0–1；无可比项时为 null */
  rate: number | null;
}

/** 档位一致率（汇总口径）。与逐项命中率同判据，只是汇总方式不同。 */
export function computeLevelAgreement(pairs: readonly LevelPair[]): LevelAgreement {
  const comparable = pairs.length;
  const hits = pairs.filter((pair) => pair.hit).length;
  return {
    comparable,
    hits,
    rate: comparable === 0 ? null : round2(hits / comparable),
  };
}

export interface CalibrationBucket {
  bucket: string;
  n: number;
  /** 该桶平均置信度（2 位小数）；n = 0 时为 null */
  meanConfidence: number | null;
  /** 该桶实际命中率（2 位小数）；n = 0 时为 null */
  accuracy: number | null;
  /** 校准差 = accuracy − meanConfidence（2 位小数）；正值表示过于自信 */
  calibrationGap: number | null;
}

export interface Calibration {
  /** 期望校准误差 0–1；无可分桶样本时为 null */
  ece: number | null;
  buckets: CalibrationBucket[];
  /** 置信度缺失、因此未参与 ECE 的项数 */
  itemsWithoutConfidence: number;
}

/** 置信度 → 桶名；落在区间外返回 null（与工具链一致，不兜底塞桶） */
export function bucketOf(confidence: number): string | null {
  for (const { name, lo, hi } of CONF_BUCKETS) {
    if ((lo === null || confidence >= lo) && (hi === null || confidence < hi)) return name;
  }
  return null;
}

/**
 * 置信度校准（ECE）。
 * ECE = Σ_b ( n_b / N ) × |accuracy_b − meanConfidence_b|，其中 accuracy 与 meanConfidence
 * 均取**已展示的 2 位小数**，保证读者可手工复算。
 */
export function computeCalibration(pairs: readonly LevelPair[]): Calibration {
  const acc = new Map<string, { n: number; hits: number; confSum: number }>();
  for (const { name } of CONF_BUCKETS) acc.set(name, { n: 0, hits: 0, confSum: 0 });

  let itemsWithoutConfidence = 0;
  for (const pair of pairs) {
    if (pair.confidence === null) {
      itemsWithoutConfidence += 1;
      continue;
    }
    const name = bucketOf(pair.confidence);
    if (name === null) {
      itemsWithoutConfidence += 1;
      continue;
    }
    const slot = acc.get(name);
    if (slot === undefined) continue;
    slot.n += 1;
    slot.hits += pair.hit ? 1 : 0;
    slot.confSum += pair.confidence;
  }

  const total = [...acc.values()].reduce((sum, slot) => sum + slot.n, 0);

  let eceRaw = 0;
  const buckets: CalibrationBucket[] = CONF_BUCKETS.map(({ name }) => {
    const slot = acc.get(name) ?? { n: 0, hits: 0, confSum: 0 };
    if (slot.n === 0) {
      return { bucket: name, n: 0, meanConfidence: null, accuracy: null, calibrationGap: null };
    }
    const meanConfidence = round2(slot.confSum / slot.n);
    const accuracy = round2(slot.hits / slot.n);
    eceRaw += (slot.n / total) * Math.abs(accuracy - meanConfidence);
    return {
      bucket: name,
      n: slot.n,
      meanConfidence,
      accuracy,
      calibrationGap: round2(accuracy - meanConfidence),
    };
  });

  return {
    ece: total === 0 ? null : round2(eceRaw),
    buckets,
    itemsWithoutConfidence,
  };
}

export const LEVEL_AGREEMENT_DEFINITION =
  '档位一致率 = Σ命中档位数 ÷ Σ可比评分点数（汇总值，不等于逐项命中率的平均）。「可比」= 该份已有评阅结果、且该项在 AI 与教师金标准两侧都标了档位；「命中」= 两侧档位完全相同。';

export const ECE_DEFINITION =
  'ECE（期望校准误差）= Σ_b (n_b ÷ N) × |该桶实际命中率 − 该桶平均置信度|。分桶阈值取契约 §八：低 < 0.60、中 0.60–0.80、高 ≥ 0.80。桶内两个比例均先保留 2 位小数再加权 —— 这样任何读者都能拿计算器手工复现同一个值。ECE 越小表示 AI 的自评置信度越贴合它的实际表现。';

