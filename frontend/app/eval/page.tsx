/**
 * AutoGrader · 一致性评测 /eval
 * ---------------------------------------------------------------------------
 * 对比「教师金标准分」与「AI 评分」，回答「评得准不准」：
 *   1. 逐份对比表（含偏差）；
 *   2. 总分 MAE（平均绝对误差）与最大单份偏差；
 *   3. 逐项档位命中率；
 *   4. 难度档位分布与分数区间分布。
 *
 * 现状：public/results/ 下已有 12 份真实评阅结果，因此「已生成 12 / 12」，
 * 总分 MAE 3.05（N = 12）、逐项档位命中率均可比；页面同时保留降级分支，
 * 一旦结果文件缺失即自动回到「待填充」空态，不显示任何估算值。
 */

import type { Metadata } from 'next';
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

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
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
import { Tabs } from '@/components/ui/tabs';
import { LEVEL_META, STATUS_META, TIER_META, TIER_ORDER } from '@/lib/constants';
import { getGeneratedReportIds, getResultState, getRubric, getSampleReports } from '@/lib/data';
import {
  computeItemHits,
  computeMae,
  countByTier,
  countLevels,
  countScoreBands,
  DELTA_DEFINITION,
  GOLD_SCORE_DEFINITION,
  HIT_RATE_DEFINITION,
  MAE_DEFINITION,
  type AiLevelEntry,
  type EvalRow,
  type GoldLevelEntry,
} from '@/lib/analysis';
import type { ScoreLevel } from '@/lib/schema';
import { cn, formatDelta, formatNumber, formatScore } from '@/lib/utils';

export const metadata: Metadata = {
  title: '一致性评测',
  description: '教师金标准分与 AI 评分的逐份对比、总分 MAE、逐项命中率与分布',
};

/** 保留 2 位小数（half-up），仅用于展示层的偏差计算 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toLevelMap(entries: readonly { rubricItemId: string; level: ScoreLevel }[]): Record<string, ScoreLevel> {
  const map: Record<string, ScoreLevel> = {};
  for (const entry of entries) map[entry.rubricItemId] = entry.level;
  return map;
}

export default function EvalPage() {
  const reports = getSampleReports();
  const rubric = getRubric();
  const generatedIds = new Set(getGeneratedReportIds());

  /* ---------------------------- 数据组装 ---------------------------- */

  const rows: EvalRow[] = reports.map((report) => {
    const state = getResultState(report.id);
    const aiTotalScore = state.status === 'ok' ? state.data.totalScore : null;
    return {
      reportId: report.id,
      title: report.title,
      tier: report.tier,
      goldTotalScore: report.goldTotalScore,
      aiTotalScore,
      delta: aiTotalScore === null ? null : round2(aiTotalScore - report.goldTotalScore),
      status: state.status,
    };
  });

  const goldLevels: GoldLevelEntry[] = reports.map((report) => ({
    reportId: report.id,
    levels: toLevelMap(report.expectedItemScores),
  }));

  const aiLevels: AiLevelEntry[] = reports.flatMap((report) => {
    const state = getResultState(report.id);
    if (state.status !== 'ok') return [];
    return [{ reportId: report.id, levels: toLevelMap(state.data.scores) }];
  });

  const mae = computeMae(rows);
  const itemHits = computeItemHits(
    rubric.items.map((item) => ({ id: item.id, name: item.name, weight: item.weight })),
    goldLevels,
    aiLevels,
  );

  const goldScores = reports.map((report) => report.goldTotalScore);
  const goldAverage = round2(goldScores.reduce((sum, score) => sum + score, 0) / goldScores.length);
  const tierBuckets = countByTier(reports, TIER_ORDER);
  const bandBuckets = countScoreBands(goldScores);
  const goldLevelBuckets = countLevels(reports.flatMap((report) => report.expectedItemScores.map((item) => item.level)));
  const generatedCount = generatedIds.size;

  const hitTotal = itemHits.reduce((sum, item) => sum + item.hits, 0);
  const hitComparable = itemHits.reduce((sum, item) => sum + item.comparable, 0);
  const overallHitRate = hitComparable === 0 ? null : round2(hitTotal / hitComparable);

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <>
      <SiteHeader active="/eval" />

      <main className="container pb-4">
        {/* ============================ 头部 ============================ */}
        <section className="border-b border-border py-10">
          <Badge variant="outline" className="gap-1.5">
            <Scale className="h-3 w-3" />
            AI 评分 vs 教师金标准分
          </Badge>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">一致性评测</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            以教师逐项标注的金标准分为参照，衡量 AI 评分的准确性与稳定性：
            总分层面的平均绝对误差（MAE）、单项层面的档位命中率，以及难度档位与分数区间分布。
            本页是「AI 评得准不准」的直接答案，也是评阅结果信任度的量化依据。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="已生成评阅结果"
              value={`${generatedCount} / ${reports.length}`}
              valueClassName={generatedCount === 0 ? 'text-muted-foreground' : 'text-emerald-600'}
              hint="按 result-{reportId}.json 约定构建期扫描"
              icon={<CircleCheckBig className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="总分 MAE"
              value={mae.mae === null ? '待填充' : formatScore(mae.mae)}
              valueClassName={mae.mae === null ? 'text-muted-foreground text-lg' : undefined}
              hint={mae.mae === null ? 'N = 0，暂无可比样本' : `N = ${mae.count} 份 · 越低越好`}
              icon={<Sigma className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="逐项档位命中率"
              value={overallHitRate === null ? '待填充' : `${(overallHitRate * 100).toFixed(0)}%`}
              valueClassName={overallHitRate === null ? 'text-muted-foreground text-lg' : undefined}
              hint={hitComparable === 0 ? '可比评分点 0 项' : `${hitTotal} / ${hitComparable} 项档位一致`}
              icon={<Target className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="最大单份偏差"
              value={mae.maxAbsDelta === null ? '待填充' : formatScore(mae.maxAbsDelta)}
              valueClassName={mae.maxAbsDelta === null ? 'text-muted-foreground text-lg' : undefined}
              hint={
                mae.maxAbsDelta === null
                  ? '无样本时不做任何推断'
                  : `出自 ${mae.maxAbsDeltaReportId}`
              }
              icon={<TrendingUp className="h-3.5 w-3.5" />}
            />
          </div>
        </section>

        {/* ========================== 口径说明 ========================== */}
        <section className="py-8">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">评分口径标注</CardTitle>
            </div>
            <dl className="mt-3 grid gap-3 text-xs leading-relaxed md:grid-cols-2">
              <div className="rounded-md bg-secondary/40 p-3">
                <dt className="font-medium text-foreground">总分 MAE（平均绝对误差）</dt>
                <dd className="mt-1 text-muted-foreground">{MAE_DEFINITION}</dd>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <dt className="font-medium text-foreground">逐项命中率</dt>
                <dd className="mt-1 text-muted-foreground">{HIT_RATE_DEFINITION}</dd>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <dt className="font-medium text-foreground">偏差</dt>
                <dd className="mt-1 text-muted-foreground">{DELTA_DEFINITION}</dd>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <dt className="font-medium text-foreground">教师金标准分</dt>
                <dd className="mt-1 text-muted-foreground">{GOLD_SCORE_DEFINITION}</dd>
              </div>
            </dl>
          </Card>
        </section>

        {/* ======================= 无结果时的空态说明 ======================= */}
        {generatedCount === 0 ? (
          <section className="pb-8">
            <Card className="border-amber-300 bg-amber-50/60 p-5">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-amber-900">
                    已生成 0 / {reports.length}，评测将在评阅结果产出后自动填充
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-amber-900/90">
                    构建期扫描 <code className="font-mono">public/results/</code> 未发现任何{' '}
                    <code className="font-mono">result-{'{reportId}'}.json</code>（目录内以{' '}
                    <code className="font-mono">_</code> 开头的文件为契约格式示例，不计入统计）。
                    因此总分 MAE、逐项命中率与最大偏差均暂无可比样本——本页不显示任何估算值或占位数字，
                    以免产生无出处的指标。下方表格中的「AI 评分」列在结果产出前保持「待生成」。
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-900/90">
                    <span>先看已有的确定性数据：</span>
                    <Link
                      href="/grade"
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <LayoutGrid className="h-3 w-3" />
                      前往评阅工作台
                    </Link>
                    <span className="text-amber-900/60">·</span>
                    <span>
                      教师金标准分 {goldScores.length} 份齐全，区间 {formatScore(Math.min(...goldScores))}–
                      {formatScore(Math.max(...goldScores))}，均值 {formatScore(goldAverage)}
                    </span>
                  </p>
                </div>
              </div>
            </Card>
          </section>
        ) : null}

        {/* ========================== 对比与分布 ========================== */}
        <section className="pb-8">
          <Tabs
            defaultValue="compare"
            items={[
              {
                value: 'compare',
                label: '逐份对比表',
                count: rows.length,
                content: (
                  <Card className="overflow-hidden">
                    <CardHeader className="border-b border-border bg-secondary/30">
                      <div className="flex flex-wrap items-center gap-2">
                        <Scale className="h-4 w-4 text-primary" />
                        <CardTitle>教师金标准分 vs AI 评分</CardTitle>
                        <Badge variant="muted" className="ml-auto">
                          已生成 {generatedCount} / {rows.length}
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
                            {rows.map((row) => {
                              const status = STATUS_META[row.status];
                              return (
                                <TableRow key={row.reportId}>
                                  <TableCell>
                                    <Link href={`/report/${row.reportId}`} className="group block max-w-[22rem]">
                                      <span className="font-mono text-[11px] text-muted-foreground">
                                        {row.reportId}
                                      </span>
                                      <span className="block truncate text-[13px] font-medium group-hover:text-primary">
                                        {row.title}
                                      </span>
                                    </Link>
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      className={
                                        TIER_META[row.tier]?.chip ?? 'border-border bg-muted text-muted-foreground'
                                      }
                                    >
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
                                      <span
                                        className={cn(
                                          'font-semibold',
                                          Math.abs(row.delta) <= 2
                                            ? 'text-emerald-600'
                                            : Math.abs(row.delta) <= 5
                                              ? 'text-amber-600'
                                              : 'text-rose-600',
                                        )}
                                      >
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
                          </TableCaption>
                        </Table>
                      </TableWrapper>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
                        <span>
                          金标准均值 <span className="font-medium tabular-nums text-foreground">{formatScore(goldAverage)}</span>
                        </span>
                        <span>
                          AI 均值{' '}
                          <span className="font-medium tabular-nums text-foreground">
                            {mae.count === 0
                              ? '待填充'
                              : formatScore(
                                  round2(
                                    rows.reduce((sum, row) => sum + (row.aiTotalScore ?? 0), 0) / mae.count,
                                  ),
                                )}
                          </span>
                        </span>
                        <span>
                          总分 MAE{' '}
                          <span className="font-medium tabular-nums text-foreground">
                            {mae.mae === null ? '待填充（N = 0）' : formatScore(mae.mae)}
                          </span>
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ),
              },
              {
                value: 'gold-distribution',
                label: '教师金标准分布',
                content: (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="border-b border-border bg-secondary/30">
                        <div className="flex items-center gap-2">
                          <Gauge className="h-4 w-4 text-primary" />
                          <CardTitle>难度档位分布</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-5">
                        {tierBuckets.map((bucket) => (
                          <div key={bucket.tier} className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs">
                              <Badge
                                className={
                                  TIER_META[bucket.tier]?.chip ?? 'border-border bg-muted text-muted-foreground'
                                }
                              >
                                {bucket.tier}
                              </Badge>
                              <span className="text-muted-foreground">
                                {TIER_META[bucket.tier]?.desc ?? '—'}
                              </span>
                              <span className="ml-auto font-medium tabular-nums">{bucket.count} 份</span>
                            </div>
                            <Progress
                              value={bucket.count}
                              max={reports.length}
                              label={`难度 ${bucket.tier} 的报告数`}
                            />
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
                        {bandBuckets.map((bucket) => (
                          <div key={bucket.label} className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium">{bucket.label}</span>
                              <span className="ml-auto font-medium tabular-nums">{bucket.count} 份</span>
                            </div>
                            <Progress
                              value={bucket.count}
                              max={reports.length}
                              barClassName="bg-foreground/60"
                              label={`${bucket.label} 的报告数`}
                            />
                          </div>
                        ))}
                        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                          区间为左闭右开，最后一档为「60 分以下」。分布基于教师金标准分，共{' '}
                          {formatNumber(goldScores.length)} 份。
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="lg:col-span-2">
                      <CardHeader className="border-b border-border bg-secondary/30">
                        <div className="flex items-center gap-2">
                          <Sigma className="h-4 w-4 text-primary" />
                          <CardTitle>逐份教师金标准分</CardTitle>
                          <span className="ml-auto text-xs text-muted-foreground">
                            均值 {formatScore(goldAverage)} · 满分 100
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 pt-5">
                        {[...reports]
                          .sort((a, b) => b.goldTotalScore - a.goldTotalScore)
                          .map((report) => (
                            <div key={report.id} className="flex items-center gap-3">
                              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                                {report.id}
                              </span>
                              <Badge
                                className={cn(
                                  'w-14 justify-center',
                                  TIER_META[report.tier]?.chip ?? 'border-border bg-muted text-muted-foreground',
                                )}
                              >
                                {report.tier}
                              </Badge>
                              <Progress
                                value={report.goldTotalScore}
                                max={100}
                                className="h-2.5 flex-1"
                                barClassName="bg-primary/70"
                                label={`${report.id} 金标准分`}
                              />
                              <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                                {formatScore(report.goldTotalScore)}
                              </span>
                            </div>
                          ))}
                      </CardContent>
                    </Card>

                    <Card className="lg:col-span-2">
                      <CardHeader className="border-b border-border bg-secondary/30">
                        <div className="flex items-center gap-2">
                          <LayoutGrid className="h-4 w-4 text-primary" />
                          <CardTitle>金标准逐项档位分布</CardTitle>
                          <span className="ml-auto text-xs text-muted-foreground">
                            共 {reports.length * rubric.items.length} 个评分点标注
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-3 pt-5 sm:grid-cols-4">
                        {goldLevelBuckets.map((bucket) => (
                          <div key={bucket.level} className="rounded-md border border-border p-3">
                            <Badge className={LEVEL_META[bucket.level].chip}>{LEVEL_META[bucket.level].label}</Badge>
                            <div className="mt-2 text-xl font-semibold tabular-nums">{bucket.count}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {((bucket.count / (reports.length * rubric.items.length)) * 100).toFixed(0)}% 的评分点
                            </div>
                            <Progress
                              value={bucket.count}
                              max={reports.length * rubric.items.length}
                              className="mt-2"
                              barClassName={LEVEL_META[bucket.level].bar}
                              label={`${LEVEL_META[bucket.level].label} 占比`}
                            />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                ),
              },
              {
                value: 'item-hit',
                label: '逐项命中率',
                count: itemHits.length,
                content: (
                  <Card className="overflow-hidden">
                    <CardHeader className="border-b border-border bg-secondary/30">
                      <div className="flex flex-wrap items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        <CardTitle>逐项档位命中率</CardTitle>
                        <Badge variant="muted" className="ml-auto">
                          可比评分点 {hitComparable} 项
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{HIT_RATE_DEFINITION}</p>
                    </CardHeader>
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
                            {itemHits.map((item) => (
                              <TableRow key={item.rubricItemId}>
                                <TableCell>
                                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                                    {item.rubricItemId}
                                  </span>
                                  <span className="text-[13px] font-medium">{item.itemName}</span>
                                </TableCell>
                                <TableCell className="text-right text-sm tabular-nums">
                                  {formatScore(item.weight)}%
                                </TableCell>
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
                                        barClassName={
                                          item.rate >= 0.9
                                            ? 'bg-emerald-500'
                                            : item.rate >= 0.7
                                              ? 'bg-amber-500'
                                              : 'bg-rose-500'
                                        }
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
                            命中即 AI 判定档位与教师金标准档位完全一致（优秀 / 达标 / 部分达标 / 未达标 四档之一）。
                            权重列与 rubric v{rubric.version} 一致，权重合计 100。
                          </TableCaption>
                        </Table>
                      </TableWrapper>
                    </CardContent>
                  </Card>
                ),
              },
            ]}
          />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
