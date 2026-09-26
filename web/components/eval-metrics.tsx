'use client';

/**
 * AutoGrader · 一致性评测的**浏览器端现算**面板（2.7）
 * ===========================================================================
 * 为什么要有这个文件
 * ---------------------------------------------------------------------------
 * 判据 2.7 要求「页面可复算：展示公式与中间量，人工可用计算器核对」。
 * 只是把构建期算好的数字印在页面上，读者只能选择"相信"；本文件把**原始数据**
 * （每份报告的金标准逐项档位、AI 逐项档位与置信度、rubric 权重）通过 props 传进浏览器，
 * 由**这段可被查看的代码**在运行时现算 MAE / 命中率 / 一致率 / ECE。
 *
 * 于是页面上的每个数字都能被追到一行 JS，而不是一个固化的字面量。
 *
 * 口径来源：全部函数在 `lib/analysis.ts`（纯函数，与工具链 `evaluate.py` 逐条对齐）。
 * 本文件只负责「把输入喂进去 + 把结果画出来」，不定义任何口径。
 *
 * 视觉纪律：TONE（单强调色 + 灰阶 + 深浅阶）与形状符号，不用红绿；图表为手写 SVG。
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  CircleAlert,
  CircleCheckBig,
  Gauge,
  Info,
  LayoutGrid,
  Scale,
  Sigma,
  Target,
  TrendingUp,
} from 'lucide-react';

import { CalibrationChart } from '@/components/charts/calibration-chart';
import { DeviationChart } from '@/components/charts/deviation-chart';
import { HitRateChart } from '@/components/charts/hit-rate-chart';
import { ScoreComparisonChart } from '@/components/charts/score-comparison-chart';
import { Note } from '@/components/note';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import {
  buildLevelPairs,
  computeCalibration,
  computeItemHits,
  computeLevelAgreement,
  computeMae,
  CONF_BUCKETS,
  countByTier,
  countLevels,
  countScoreBands,
  DELTA_DEFINITION,
  ECE_DEFINITION,
  GOLD_SCORE_DEFINITION,
  HIT_RATE_DEFINITION,
  LEVEL_AGREEMENT_DEFINITION,
  MAE_DEFINITION,
  type AiItemEntry,
  type AiLevelEntry,
  type EvalRow,
  type GoldLevelEntry,
} from '@/lib/analysis';
import { LEVEL_META, STATUS_META, TIER_META, TIER_ORDER, TONE, deltaTone, ratioTone } from '@/lib/constants';
import type { ScoreLevel } from '@/lib/schema';
import { cn, formatDelta, formatNumber, formatScore } from '@/lib/utils';

/* ==========================================================================
 * 输入契约（由 Server Component 从 web/public/ 读好后传入，全部可 JSON 序列化）
 * ========================================================================== */

export interface EvalReportInput {
  reportId: string;
  title: string;
  tier: string;
  goldTotalScore: number;
  /** AI 加权总分；未产出结果为 null */
  aiTotalScore: number | null;
  /** 结果状态：ok / missing / invalid（与 lib/data.ts 的 ResultState 判别值一致） */
  resultStatus: 'ok' | 'missing' | 'invalid';
  /** 金标准逐项档位（rubricItemId → level） */
  goldLevels: Record<string, ScoreLevel>;
  /** AI 逐项档位与置信度（rubricItemId → { level, confidence }） */
  aiItems: Record<string, { level: ScoreLevel | null; confidence: number | null }>;
}

export interface EvalMetricsInput {
  reports: EvalReportInput[];
  rubric: { id: string; name: string; weight: number }[];
  rubricVersion: string;
}

/* ==========================================================================
 * 现算：唯一的计算入口，四个面板共用
 * ========================================================================== */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function useEvalMetrics(input: EvalMetricsInput) {
  return useMemo(() => {
    const { reports, rubric } = input;

    /* ---- 1. 逐份总分行（偏差 = AI − 金标准）---- */
    const rows: EvalRow[] = reports.map((report) => ({
      reportId: report.reportId,
      title: report.title,
      tier: report.tier,
      goldTotalScore: report.goldTotalScore,
      aiTotalScore: report.aiTotalScore,
      delta: report.aiTotalScore === null ? null : round2(report.aiTotalScore - report.goldTotalScore),
      status: report.resultStatus,
    }));

    /* ---- 2. 档位两侧输入 ---- */
    const goldLevels: GoldLevelEntry[] = reports.map((report) => ({
      reportId: report.reportId,
      levels: report.goldLevels,
    }));

    const okReports = reports.filter((report) => report.resultStatus === 'ok');

    const aiLevels: AiLevelEntry[] = okReports.map((report) => {
      const levels: Record<string, ScoreLevel> = {};
      for (const [itemId, cell] of Object.entries(report.aiItems)) {
        if (cell.level !== null) levels[itemId] = cell.level;
      }
      return { reportId: report.reportId, levels };
    });

    const aiItems: AiItemEntry[] = okReports.map((report) => ({
      reportId: report.reportId,
      items: report.aiItems,
    }));

    /* ---- 3. 四项指标 ---- */
    const mae = computeMae(rows);
    const itemHits = computeItemHits(rubric, goldLevels, aiLevels);

    const hitTotal = itemHits.reduce((sum, item) => sum + item.hits, 0);
    const hitComparable = itemHits.reduce((sum, item) => sum + item.comparable, 0);

    const levelPairs = buildLevelPairs(goldLevels, aiItems);
    const levelAgreement = computeLevelAgreement(levelPairs);
    const calibration = computeCalibration(levelPairs);
    const calibrationTotal = calibration.buckets.reduce((sum, bucket) => sum + bucket.n, 0);

    // 两条构造路径必须一致：按项汇总 vs 按对构造。不等就说明逻辑分叉，宁可不显示
    if (levelAgreement.hits !== hitTotal || levelAgreement.comparable !== hitComparable) {
      throw new Error(
        `[eval] 档位一致率的两条构造路径不一致：` +
          `itemHits Σ = ${hitTotal} / ${hitComparable}，levelPairs Σ = ${levelAgreement.hits} / ${levelAgreement.comparable}`,
      );
    }

    /* ---- 4. 描述性分布（金标准侧）---- */
    const goldScores = reports.map((report) => report.goldTotalScore);
    const goldAverage =
      goldScores.length === 0
        ? 0
        : round2(goldScores.reduce((sum, score) => sum + score, 0) / goldScores.length);
    const tierBuckets = countByTier(reports, TIER_ORDER);
    const bandBuckets = countScoreBands(goldScores);
    const goldLevelBuckets = countLevels(reports.flatMap((report) => Object.values(report.goldLevels)));

    return {
      rows,
      mae,
      itemHits,
      hitTotal,
      hitComparable,
      levelPairs,
      levelAgreement,
      calibration,
      calibrationTotal,
      goldScores,
      goldAverage,
      tierBuckets,
      bandBuckets,
      goldLevelBuckets,
      generatedCount: okReports.length,
      reportCount: reports.length,
    };
  }, [input]);
}

/** 置信度桶的中文名（阈值取自契约 §八，不在这里重写） */
const CONF_BUCKET_LABEL: Readonly<Record<string, string>> = { low: '低', medium: '中', high: '高' };

/** 由 CONF_BUCKETS 反推区间文案，避免阈值出现第二处真源 */
function confBucketRange(name: string): string {
  const bucket = CONF_BUCKETS.find((item) => item.name === name);
  if (bucket === undefined) return '—';
  const lo = bucket.lo === null ? '0.00' : bucket.lo.toFixed(2);
  const hi = bucket.hi === null ? '1.00' : bucket.hi.toFixed(2);
  return bucket.hi === null ? `[${lo}, ${hi}]` : `[${lo}, ${hi})`;
}

/* ==========================================================================
 * 面板 1 · 指标卡
 * ========================================================================== */

export function EvalStatGrid({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);
  const agreement = m.levelAgreement.rate;
  const generated = m.generatedCount;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="已生成评阅结果"
        value={`${generated} / ${m.reportCount}`}
        valueClassName={generated === 0 ? 'text-muted-foreground' : TONE.ok.text}
        hint="构建期扫描 public/results/ 后传入浏览器"
        icon={<CircleCheckBig className="h-3.5 w-3.5" />}
      />
      <StatCard
        label="总分 MAE"
        value={m.mae.mae === null ? '待填充' : formatScore(m.mae.mae)}
        valueClassName={m.mae.mae === null ? 'text-muted-foreground text-lg' : undefined}
        hint={m.mae.mae === null ? 'N = 0，暂无可比样本' : `N = ${m.mae.count} 份 · 越低越好`}
        icon={<Sigma className="h-3.5 w-3.5" />}
      />
      <StatCard
        label="档位一致率"
        value={agreement === null ? '待填充' : `${(agreement * 100).toFixed(0)}%`}
        valueClassName={
          agreement === null ? 'text-muted-foreground text-lg' : TONE[ratioTone(agreement, 0.9, 0.7)].text
        }
        hint={
          m.levelAgreement.comparable === 0
            ? '可比评分点 0 项'
            : `${m.levelAgreement.hits} / ${m.levelAgreement.comparable} 项档位一致`
        }
        icon={<Target className="h-3.5 w-3.5" />}
      />
      <StatCard
        label="最大单份偏差"
        value={m.mae.maxAbsDelta === null ? '待填充' : formatScore(m.mae.maxAbsDelta)}
        valueClassName={
          m.mae.maxAbsDelta === null
            ? 'text-muted-foreground text-lg'
            : TONE[deltaTone(m.mae.maxAbsDelta, 2, 5)].text
        }
        hint={m.mae.maxAbsDelta === null ? '无样本时不做任何推断' : `出自 ${m.mae.maxAbsDeltaReportId}`}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

/* ==========================================================================
 * 面板 2 · 偏差与对比（SVG 自绘）
 * ========================================================================== */

export function EvalDeviationPanel({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);
  const usable = m.rows.filter((row) => row.delta !== null);

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle>逐份偏差（AI − 金标准）</CardTitle>
            <Badge variant="muted" className="ml-auto">
              {usable.length} 份可比 · 容差 ±2
            </Badge>
          </div>
          <Note summary="怎么读这张图" className="mt-2">
            <p>向右为 AI 给分偏松、向左为偏严。中间浅色带是 ±2 分容差区间，落在带内即视作同档，带外才需要人工核对。</p>
            <p>条的长度与位置就是全部信息，不需要依赖颜色。</p>
          </Note>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-5">
          {usable.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无可比样本。</p>
          ) : (
            <DeviationChart
              rows={usable.map((row) => ({ reportId: row.reportId, delta: row.delta ?? 0 }))}
              tolerance={2}
            />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex flex-wrap items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <CardTitle>金标准 vs AI（哑铃图）</CardTitle>
            <Badge variant="muted" className="ml-auto">
              0 – 100 分量程
            </Badge>
          </div>
          <Note summary="怎么读这张图" className="mt-2">
            <p>空心圆是教师金标准分，实心圆是 AI 加权总分，两点之间的线段就是差距本身。</p>
            <p>线段最长的几行就是差距最大的几份，不需要读者自己做减法。</p>
          </Note>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-5">
          <ScoreComparisonChart
            rows={m.rows.map((row) => ({ reportId: row.reportId, gold: row.goldTotalScore, ai: row.aiTotalScore }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* ==========================================================================
 * 面板 3 · 置信度校准（ECE）
 * ========================================================================== */

export function EvalCalibrationPanel({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);
  const { calibration, calibrationTotal } = m;
  const points = calibration.buckets.filter((bucket) => bucket.n > 0);

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle>置信度校准（ECE）</CardTitle>
            <Badge variant="muted" className="ml-auto">
              {calibration.ece === null ? '暂无可分桶样本' : `ECE = ${calibration.ece.toFixed(2)} · 越低越好`}
            </Badge>
          </div>
          <Note summary="ECE 怎么算" className="mt-2">
            <p>{ECE_DEFINITION}</p>
            <p>对角线为「说到做到」；实线表示偏自信、虚线表示偏保守；点的大小按该桶样本数。</p>
          </Note>
        </CardHeader>
        <CardContent className="px-4 pb-1 pt-5">
          {points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无可分桶样本。</p>
          ) : (
            <CalibrationChart buckets={calibration.buckets} labels={CONF_BUCKET_LABEL} />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex flex-wrap items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            <CardTitle>分桶明细与展开式</CardTitle>
            <Badge variant="muted" className="ml-auto">
              参与分桶 {calibrationTotal} 个评分点
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>置信度桶</TableHead>
                  <TableHead>区间</TableHead>
                  <TableHead className="text-right">样本数 n</TableHead>
                  <TableHead className="text-right">平均置信度</TableHead>
                  <TableHead className="text-right">实际命中率</TableHead>
                  <TableHead className="text-right">校准差</TableHead>
                  <TableHead className="text-right">加权项</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calibration.buckets.map((bucket) => (
                  <TableRow key={bucket.bucket}>
                    <TableCell className="text-[13px] font-medium">
                      {CONF_BUCKET_LABEL[bucket.bucket] ?? bucket.bucket}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {confBucketRange(bucket.bucket)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{bucket.n}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {bucket.meanConfidence === null ? '—' : bucket.meanConfidence.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {bucket.accuracy === null ? '—' : bucket.accuracy.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {bucket.calibrationGap === null ? '—' : formatDelta(bucket.calibrationGap)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {calibrationTotal === 0 ? '—' : `${bucket.n}/${calibrationTotal}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableCaption>
                校准差 = 实际命中率 − 平均置信度；正值偏保守，负值偏自信。空桶不参与加权。
              </TableCaption>
            </Table>
          </TableWrapper>

          <div className="border-t border-border bg-secondary/20 px-4 py-3">
            <div className="text-[11px] font-medium text-foreground">可手工复算的展开式</div>
            {calibrationTotal === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">暂无可比样本。</p>
            ) : (
              <>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  ECE ={' '}
                  {calibration.buckets
                    .filter((b) => b.n > 0 && b.accuracy !== null && b.meanConfidence !== null)
                    .map(
                      (b) =>
                        `(${b.n}/${calibrationTotal})×|${b.accuracy?.toFixed(2)} − ${b.meanConfidence?.toFixed(2)}|`,
                    )
                    .join(' + ')}{' '}
                  = <span className="font-semibold text-foreground">{calibration.ece?.toFixed(2)}</span>
                </p>
                <Note summary="口径细节" className="mt-2">
                  <p>
                    参与分桶 {calibrationTotal} 个评分点
                    {calibration.itemsWithoutConfidence === 0
                      ? '，全部都有置信度'
                      : `；另有 ${calibration.itemsWithoutConfidence} 个可比评分点未填置信度，已从 ECE 中剔除（不是当作 0）`}
                    。
                  </p>
                  <p>桶内两个比例均先取 2 位小数再加权，与工具链 evaluate.py 的输出逐值可比。</p>
                </Note>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ==========================================================================
 * 面板 4 · 逐项档位命中率（SVG 自绘 + 明细表）
 * ========================================================================== */

export function EvalHitRatePanel({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-secondary/30">
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <CardTitle>逐项档位命中率</CardTitle>
          <Badge variant="muted" className="ml-auto">
            可比评分点 {m.hitComparable} 项
          </Badge>
        </div>
          <Note summary="命中率怎么定" className="mt-2">
            <p>{HIT_RATE_DEFINITION}</p>
            <p>图中虚线为 70% / 90% 参考线：越过 90% 视为稳定，低于 70% 需回到该评分点的判据描述上找原因。</p>
          </Note>
        </CardHeader>
      <CardContent className="pt-5">
        <HitRateChart
          rows={m.itemHits.map((item) => ({
            rubricItemId: item.rubricItemId,
            itemName: item.itemName,
            rate: item.rate,
            hits: item.hits,
            comparable: item.comparable,
          }))}
        />
      </CardContent>

      <CardContent className="p-0">
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>评分点</TableHead>
                <TableHead className="text-right">权重</TableHead>
                <TableHead className="text-right">命中 / 可比</TableHead>
                <TableHead className="w-[14rem]">命中率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.itemHits.map((item) => (
                <TableRow key={item.rubricItemId}>
                  <TableCell>
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">{item.rubricItemId}</span>
                    <span className="text-[13px] font-medium">{item.itemName}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatScore(item.weight)}%</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {item.comparable === 0 ? (
                      <span className="text-muted-foreground">0 / 0</span>
                    ) : (
                      `${item.hits} / ${item.comparable}`
                    )}
                  </TableCell>
                  <TableCell>
                    {item.rate === null ? (
                      <span className="text-xs text-muted-foreground">待填充（无可比样本）</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress
                          value={item.rate * 100}
                          max={100}
                          barClassName={TONE[ratioTone(item.rate, 0.9, 0.7)].bar}
                          label={`${item.itemName} 命中率`}
                        />
                        <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                          {(item.rate * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableCaption>
              命中即 AI 档位与金标准档位完全一致。权重列与 rubric v{input.rubricVersion} 一致，合计 100。
            </TableCaption>
          </Table>
        </TableWrapper>
      </CardContent>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          以上全部数字由浏览器在运行时从原始数据现算，非构建期固化值
        </span>
        <span>一致率口径：Σ命中 ÷ Σ可比（汇总值，不是逐项平均）</span>
        <span>
          可比评分点 {formatNumber(m.hitComparable)} 项 · 金标准份数 {m.reportCount}
        </span>
      </div>
    </Card>
  );
}

/* ==========================================================================
 * 面板 5 · 金标准侧分布（描述性；同样在浏览器端现算计数）
 * ========================================================================== */

export function EvalGoldDistributionPanel({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <CardTitle>难度档位分布</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {m.tierBuckets.map((bucket) => (
            <div key={bucket.tier} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Badge className={TIER_META[bucket.tier]?.chip ?? 'border-border bg-muted text-muted-foreground'}>
                  {bucket.tier}
                </Badge>
                <span className="text-muted-foreground">{TIER_META[bucket.tier]?.desc ?? '—'}</span>
                <span className="ml-auto font-medium tabular-nums">{bucket.count} 份</span>
              </div>
              <Progress value={bucket.count} max={m.reportCount} label={`难度 ${bucket.tier} 的报告数`} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle>分数区间分布</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {m.bandBuckets.map((bucket) => (
            <div key={bucket.label} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{bucket.label}</span>
                <span className="ml-auto font-medium tabular-nums">{bucket.count} 份</span>
              </div>
              <Progress
                value={bucket.count}
                max={m.reportCount}
                barClassName={TONE.ok.bar}
                label={`${bucket.label} 的报告数`}
              />
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            区间为左闭右开，最后一档为「60 分以下」。分布基于教师金标准分，共{' '}
            {formatNumber(m.goldScores.length)} 份。
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <Sigma className="h-4 w-4 text-primary" />
            <CardTitle>逐份教师金标准分</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">
              均值 {formatScore(m.goldAverage)} · 满分 100
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-5">
          {[...m.rows]
            .sort((a, b) => b.goldTotalScore - a.goldTotalScore)
            .map((row) => {
              const report = input.reports.find((item) => item.reportId === row.reportId);
              return (
                <div key={row.reportId} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{row.reportId}</span>
                  <Badge
                    className={cn(
                      'w-14 justify-center',
                      TIER_META[row.tier]?.chip ?? 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    {row.tier}
                  </Badge>
                  <Progress
                    value={row.goldTotalScore}
                    max={100}
                    className="h-2.5 flex-1"
                    barClassName={TONE.ok.bar}
                    label={`${row.reportId} 金标准分`}
                  />
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {formatScore(row.goldTotalScore)}
                  </span>
                  {report?.resultStatus === 'ok' ? null : (
                    <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">待生成</span>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            <CardTitle>金标准逐项档位分布</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">
              共 {m.reportCount * input.rubric.length} 个评分点标注
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-4">
          {m.goldLevelBuckets.map((bucket) => (
            <div key={bucket.level} className="rounded-md border border-border p-3">
              <Badge className={LEVEL_META[bucket.level].chip}>{LEVEL_META[bucket.level].label}</Badge>
              <div className="mt-2 text-xl font-semibold tabular-nums">{bucket.count}</div>
              <div className="text-[11px] text-muted-foreground">
                {(
                  (bucket.count / Math.max(1, m.reportCount * input.rubric.length)) *
                  100
                ).toFixed(0)}
                % 的评分点
              </div>
              <Progress
                value={bucket.count}
                max={Math.max(1, m.reportCount * input.rubric.length)}
                className="mt-2"
                barClassName={TONE.ok.bar}
                label={`${LEVEL_META[bucket.level].label} 占比`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** 无结果时的提示卡（同样由浏览器判断"份数为 0"） */
export function EvalEmptyNotice({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);
  if (m.generatedCount > 0) return null;

  return (
    <Card className={cn('p-5', TONE.notice.card)}>
      <div className="flex items-start gap-3">
        <CircleAlert className={cn('mt-0.5 h-4 w-4 shrink-0', TONE.notice.icon)} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            已生成 0 / {m.reportCount}，评测将在评阅结果产出后自动填充
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            未发现任何 <code className="font-mono">result-{'{reportId}'}.json</code>，
            故 MAE、档位一致率、ECE 与最大偏差均暂无可比样本 —— 不显示估算值或占位数字。
          </p>
          <Note summary="扫描规则与已有数据" className="mt-2">
            <p>
              构建期扫描 <code className="font-mono">public/results/</code>；目录内以{' '}
              <code className="font-mono">_</code> 开头的文件是契约格式示例，不计入统计。
            </p>
            <p>
              教师金标准分 {m.goldScores.length} 份齐全，区间 {formatScore(Math.min(...m.goldScores))}–
              {formatScore(Math.max(...m.goldScores))}，均值 {formatScore(m.goldAverage)}。
            </p>
          </Note>
        </div>
      </div>
    </Card>
  );
}

/* ==========================================================================
 * 面板 6 · 逐份对比表（原始数据表；均值与 MAE 同样现算）
 * ========================================================================== */

function CompareTable({ input }: { input: EvalMetricsInput }) {
  const m = useEvalMetrics(input);
  const aiMean =
    m.mae.count === 0
      ? null
      : round2(m.rows.reduce((sum, row) => sum + (row.aiTotalScore ?? 0), 0) / m.mae.count);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-secondary/30">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <CardTitle>教师金标准分 vs AI 评分</CardTitle>
          <Badge variant="muted" className="ml-auto">
            已生成 {m.generatedCount} / {m.rows.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>报告</TableHead>
                <TableHead>难度</TableHead>
                <TableHead className="text-right">教师金标准分</TableHead>
                <TableHead className="text-right">AI 评分</TableHead>
                <TableHead className="text-right">偏差</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.rows.map((row) => {
                const status = STATUS_META[row.status];
                return (
                  <TableRow key={row.reportId}>
                    <TableCell>
                      <Link href={`/report/${row.reportId}`} className="group block max-w-[22rem]">
                        <span className="font-mono text-[11px] text-muted-foreground">{row.reportId}</span>
                        <span className="block truncate text-[13px] font-medium group-hover:text-primary">
                          {row.title}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={TIER_META[row.tier]?.chip ?? 'border-border bg-muted text-muted-foreground'}>
                        {row.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatScore(row.goldTotalScore)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.aiTotalScore === null ? (
                        <span className="text-muted-foreground">待生成</span>
                      ) : (
                        <span className="font-semibold">{formatScore(row.aiTotalScore)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.delta === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        // 偏差程度靠深浅阶（ok 深 / notice 弱 / bad 赭石），不用第二色系
                        <span className={cn('font-semibold', TONE[deltaTone(Math.abs(row.delta), 2, 5)].text)}>
                          {formatDelta(row.delta)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={status.chip}>{status.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableCaption>
              偏差 = AI 加权总分 − 教师金标准分；AI 评分未产出时留空，不做任何插值或估算。
              本表右侧汇总三项指标，均由浏览器运行时现算。
            </TableCaption>
          </Table>
        </TableWrapper>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
          <span>
            金标准均值{' '}
            <span className="font-medium tabular-nums text-foreground">{formatScore(m.goldAverage)}</span>
          </span>
          <span>
            AI 均值{' '}
            <span className="font-medium tabular-nums text-foreground">
              {aiMean === null ? '待填充' : formatScore(aiMean)}
            </span>
          </span>
          <span>
            总分 MAE{' '}
            <span className="font-medium tabular-nums text-foreground">
              {m.mae.mae === null ? '待填充（N = 0）' : formatScore(m.mae.mae)}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ==========================================================================
 * 整页仪表盘
 * ========================================================================== */

export function EvalDashboard({ input }: { input: EvalMetricsInput }) {
  return (
    <>
      {/* ---------------------------- 指标卡 ---------------------------- */}
      <section className="border-b border-border pb-8">
        <EvalStatGrid input={input} />
      </section>

      {/* ------------------ 口径说明（收起，属二级内容） ------------------ */}
      <section className="pb-8">
        <Note summary="指标定义与口径（6 条）">
          <dl className="grid gap-2 md:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground">总分 MAE</dt>
              <dd>{MAE_DEFINITION}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">逐项命中率</dt>
              <dd>{HIT_RATE_DEFINITION}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">档位一致率</dt>
              <dd>{LEVEL_AGREEMENT_DEFINITION}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">置信度校准（ECE）</dt>
              <dd>{ECE_DEFINITION}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">偏差</dt>
              <dd>{DELTA_DEFINITION}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">教师金标准分</dt>
              <dd>{GOLD_SCORE_DEFINITION}</dd>
            </div>
          </dl>
        </Note>
      </section>

      {/* --------------------------- 空态提示 --------------------------- */}
      <section className="pb-8">
        <EvalEmptyNotice input={input} />
      </section>

      {/* --------------------------- 页内导航 ---------------------------
          刻意**不用 Tabs**：本项目是 `output: 'export'` 的纯静态站，页签内容要等客户端
          状态切换后才挂载 —— 结果是"图不在静态产物里"，既看不到也核验不了。
          改为分区堆叠 + 锚点导航：所有面板始终在 HTML 中，无 JS 也能读全。 */}
      <section className="pb-4">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-3 text-xs">
          <span className="text-muted-foreground">本页分区：</span>
          {[
            ['#sec-section-compare', '逐份对比表'],
            ['#sec-deviation', '偏差与对比图'],
            ['#sec-calibration', '置信度校准'],
            ['#sec-item-hit', '逐项命中率'],
            ['#sec-gold-distribution', '教师金标准分布'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {label}
            </a>
          ))}
        </nav>
      </section>

      <section id="sec-section-compare" className="scroll-mt-4 pb-8">
        <CompareTable input={input} />
      </section>

      <section id="sec-deviation" className="scroll-mt-4 pb-8">
        <EvalDeviationPanel input={input} />
      </section>

      <section id="sec-calibration" className="scroll-mt-4 pb-8">
        <EvalCalibrationPanel input={input} />
      </section>

      <section id="sec-item-hit" className="scroll-mt-4 pb-8">
        <EvalHitRatePanel input={input} />
      </section>

      <section id="sec-gold-distribution" className="scroll-mt-4 pb-8">
        <EvalGoldDistributionPanel input={input} />
      </section>
    </>
  );
}

