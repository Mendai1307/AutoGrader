/**
 * AutoGrader · 报告详情 /report/[id]
 * ---------------------------------------------------------------------------
 * 构建期静态生成 12 个页面（sample-01 … sample-12）。
 *
 * 左栏：报告原文（轻量 Markdown 渲染，代码块带原文行号，截图以占位块呈现）
 * 右栏：逐项评分明细（档位 / 得分 / 扣分理由 / 证据引用原文 / 置信度 / 复核结论）
 * 中段：客观核查区块（章节完整性 / 代码与关键 API / 统计量 / 图表引用 / findings / SimHash 查重）
 * 底部：溯源信息块（生成智能体、生成时间、来源对话标识、结果指纹）
 *
 * 客观核查区块的数据来自 lib/inspectors/ 的确定性核查器，在构建期对该份报告原文
 * 计算一次并随静态产物固化（相似度由 lib/data.ts 统一算一次后按份取最高配对）。
 *
 * 降级（当前默认路径）：public/results/ 下尚无 result-{id}.json，
 * 此时不渲染虚构分数，而是展示「评阅结果待生成」空态 + 该报告的客观统计
 * （字数 / 代码块 / 截图数，来自 manifest）与教师金标准分及其逐项基线。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  CircleAlert,
  CircleCheckBig,
  FileText,
  Gauge,
  ImageOff,
  ListTree,
  MessageSquareQuote,
  Scale,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Sigma,
  SquareCode,
  TriangleAlert,
} from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { InspectionPanel } from '@/components/inspection-panel';
import { MarkdownView } from '@/components/markdown-view';
import { ProvenanceBlock } from '@/components/provenance-block';
import { ScoreItemCard } from '@/components/score-item-card';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  AI_SOURCE_STATEMENT,
  LEVEL_META,
  RESULT_FILE_CONVENTION,
  STATUS_META,
  TIER_META,
  TONE_META,
} from '@/lib/constants';
import {
  getInspection,
  getReportMarkdown,
  getResultState,
  getRubric,
  getSampleReport,
  getSampleReports,
  getTopSimilarity,
} from '@/lib/data';
import { verifyItemScore, verifyTotalScore } from '@/lib/schema';
import { cn, formatDelta, formatNumber, formatRatio, formatScore, truncate } from '@/lib/utils';

/* ==========================================================================
 * 静态生成
 * ========================================================================== */

export function generateStaticParams(): { id: string }[] {
  return getSampleReports().map((report) => ({ id: report.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = getSampleReport(id);
  if (report === null) return { title: '报告详情' };
  return {
    title: `${report.id} · ${report.title}`,
    description: `${report.course} · ${report.topic} · 教师金标准分 ${formatScore(report.goldTotalScore)}`,
  };
}

/* ==========================================================================
 * 页面
 * ========================================================================== */

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = getSampleReport(id);
  if (report === null) notFound();

  const markdown = getReportMarkdown(report.id);
  const state = getResultState(report.id);
  const rubric = getRubric();
  const status = STATUS_META[state.status];
  const tier = TIER_META[report.tier];

  /** 构建期确定性核查：该份报告的客观事实 + 与其余报告最相似的一对 */
  const inspection = getInspection(report.id);
  const topSimilarity = getTopSimilarity(report.id);
  const peerCount = Math.max(getSampleReports().length - 1, 0);

  const goldItems = report.expectedItemScores;
  const goldMax = goldItems.reduce((sum, item) => sum + item.maxScore, 0);

  /** 结果可用时的口径复算与摘要 */
  const summary =
    state.status === 'ok'
      ? (() => {
          const check = verifyTotalScore(state.data);
          const levels = state.data.scores.map((item) => item.level);
          /** 逐项自证：核验「得分 = 满分 × 档位系数」，返回不一致项的 rubricItemId */
          const itemFailures = state.data.scores
            .filter((item) => !verifyItemScore(item))
            .map((item) => item.rubricItemId);
          return {
            check,
            itemFailures,
            delta: state.data.totalScore - report.goldTotalScore,
            levelCounts: {
              excellent: levels.filter((level) => level === 'excellent').length,
              meeting: levels.filter((level) => level === 'meeting').length,
              partial: levels.filter((level) => level === 'partial').length,
              notMet: levels.filter((level) => level === 'notMet').length,
            },
            reviewCount: state.data.scores.filter((item) => item.needsReview).length,
          };
        })()
      : null;

  return (
    <>
      <SiteHeader active="/grade" />

      <main className="container pb-4">
        {/* ============================ 面包屑 ============================ */}
        <nav className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Link href="/grade" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            评阅工作台
          </Link>
          <span>/</span>
          <span className="font-mono text-foreground">{report.id}</span>
        </nav>

        {/* =========================== 报告头部 =========================== */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={tier?.chip ?? 'border-border bg-muted text-muted-foreground'}>
                难度 {report.tier}
              </Badge>
              <Badge className={status.chip}>{status.label}</Badge>
              <Badge variant="outline">{report.course}</Badge>
              <Badge variant="outline">{report.topic}</Badge>
            </div>

            <h1 className="mt-4 text-2xl font-bold leading-snug tracking-tight">{report.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{report.summary}</p>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-border px-3 py-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="mt-1 text-base font-semibold tabular-nums">{formatNumber(report.wordCount)}</div>
                <div className="text-[11px] text-muted-foreground">正文字数</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <SquareCode className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="mt-1 text-base font-semibold tabular-nums">{report.codeBlockCount}</div>
                <div className="text-[11px] text-muted-foreground">代码块</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="mt-1 text-base font-semibold tabular-nums">{report.figureCount}</div>
                <div className="text-[11px] text-muted-foreground">截图</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="mt-1 text-base font-semibold tabular-nums">{goldItems.length}</div>
                <div className="text-[11px] text-muted-foreground">评分点</div>
              </div>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/90">
              样例数据为合成脱敏内容：学生一律使用泛指代号，学校统一写作「某某大学计算机学院」，
              不含任何真实姓名、学号或学校名。
            </p>
          </Card>

          {/* 分数面板 */}
          <Card className="p-6">
            {state.status === 'ok' && summary !== null ? (
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">AI 加权总分</div>
                    <div className="text-4xl font-bold tabular-nums leading-none text-primary">
                      {formatScore(state.data.totalScore)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">教师金标准分</div>
                    <div className="text-2xl font-semibold tabular-nums leading-tight">
                      {formatScore(report.goldTotalScore)}
                    </div>
                  </div>
                </div>

                <Progress value={state.data.totalScore} max={100} label="AI 加权总分" />

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-secondary/50 px-3 py-2">
                    <div className="text-muted-foreground">偏差（AI − 金标准）</div>
                    <div
                      className={cn(
                        'mt-0.5 text-sm font-semibold tabular-nums',
                        Math.abs(summary.delta) <= 2
                          ? 'text-emerald-600'
                          : Math.abs(summary.delta) <= 5
                            ? 'text-amber-600'
                            : 'text-rose-600',
                      )}
                    >
                      {formatDelta(summary.delta)}
                    </div>
                  </div>
                  <div className="rounded-md bg-secondary/50 px-3 py-2">
                    <div className="text-muted-foreground">口径复算</div>
                    <div className="mt-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums">
                      {summary.check.ok ? (
                        <>
                          <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-emerald-600">{formatScore(summary.check.expected)}</span>
                        </>
                      ) : (
                        <>
                          <TriangleAlert className="h-3.5 w-3.5 text-rose-600" />
                          <span className="text-rose-600">不一致</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md bg-secondary/50 px-3 py-2">
                    <div className="text-muted-foreground">单项档位自证</div>
                    <div className="mt-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums">
                      {summary.itemFailures.length === 0 ? (
                        <>
                          <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-emerald-600">
                            {state.data.scores.length} / {state.data.scores.length}
                          </span>
                        </>
                      ) : (
                        <>
                          <TriangleAlert className="h-3.5 w-3.5 text-rose-600" />
                          <span className="text-rose-600">{summary.itemFailures.length} 项不一致</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md bg-secondary/50 px-3 py-2">
                    <div className="text-muted-foreground">复核前 → 后置信度</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums">
                      {formatRatio(state.data.review.overallConfidenceBefore)} →{' '}
                      {formatRatio(state.data.review.overallConfidenceAfter)}
                    </div>
                  </div>
                  <div className="rounded-md bg-secondary/50 px-3 py-2">
                    <div className="text-muted-foreground">触发复核的项</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums">
                      {summary.reviewCount} / {state.data.scores.length}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(['excellent', 'meeting', 'partial', 'notMet'] as const).map((level) => (
                    <Badge key={level} className={LEVEL_META[level].chip}>
                      {LEVEL_META[level].label} {summary.levelCounts[level]}
                    </Badge>
                  ))}
                </div>

                {summary.check.ok ? null : (
                  <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-[12px] leading-relaxed text-rose-800">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    结果声明的 totalScore（{formatScore(summary.check.actual)}）与按契约口径复算的加权总分（
                    {formatScore(summary.check.expected)}）相差 {formatScore(summary.check.delta)}，已超出 0.01 容差，
                    建议核对结果文件后再采信。
                  </p>
                )}

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">分数自证（构建期复算）：</span>
                  先逐项核验「得分 = 满分 × 档位系数」
                  {summary.itemFailures.length === 0
                    ? `，全部 ${state.data.scores.length} 项在 0.01 容差内一致；`
                    : `，其中 ${summary.itemFailures.length} 项（${summary.itemFailures.join(' / ')}）不一致；`}
                  再按加权口径复算总分并与结果文件中声明的 totalScore 比对。两项自证同时成立，
                  即说明本页显示的每一个分数都由档位系数机械推出，而非事后手工填写。
                  该复算由 <code className="font-mono">lib/schema.ts</code> 的{' '}
                  <code className="font-mono">verifyItemScore()</code> /{' '}
                  <code className="font-mono">verifyTotalScore()</code> 在构建期完成并固化进静态 HTML，
                  运行时不做任何计算、不发任何请求；浏览器端 Web Crypto 复算指纹仍未实现（见 README 第十一节）。
                </p>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  rubric v{state.data.rubricVersion} · schema {state.data.schemaVersion} · {AI_SOURCE_STATEMENT}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">教师金标准分</div>
                    <div className="text-4xl font-bold tabular-nums leading-none">
                      {formatScore(report.goldTotalScore)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">AI 加权总分</div>
                    <div className="text-2xl font-semibold tabular-nums leading-tight text-muted-foreground">待生成</div>
                  </div>
                </div>

                <Progress value={report.goldTotalScore} max={100} barClassName="bg-foreground/30" label="教师金标准分" />

                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">逐项满分合计</dt>
                    <dd className="font-medium tabular-nums">{formatScore(goldMax)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">权重合计</dt>
                    <dd className="font-medium tabular-nums">
                      {formatScore(goldItems.reduce((sum, item) => sum + item.weight, 0))}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">期望结果文件</dt>
                    <dd className="font-mono">result-{report.id}.json</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">结果状态</dt>
                    <dd className={cn('font-medium', state.status === 'invalid' && 'text-rose-600')}>{status.label}</dd>
                  </div>
                </dl>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  金标准分由教师按同一 rubric 档位标准逐项人工标注后，用与 AI 完全相同的加权口径核算，
                  因此可直接作为一致性评测的参照。
                </p>
              </div>
            )}
          </Card>
        </section>

        {/* ====================== 结果契约校验失败面板 ====================== */}
        {state.status === 'invalid' ? (
          <Card className="mt-4 border-rose-200 bg-rose-50/60 p-5">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-rose-900">
                  {state.file} 存在，但未通过 ReviewResult 契约校验，因此不予渲染
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-rose-800">
                  按契约约定，结构校验与口径校验都不通过时不得渲染结果，避免把不合规的分数展示给教师。
                  以下为校验器给出的问题清单：
                </p>
                <ul className="mt-2 space-y-1">
                  {state.issues.map((issue, index) => (
                    <li key={`${issue.path}-${index}`} className="font-mono text-[11px] leading-relaxed text-rose-900">
                      <span className="font-semibold">{issue.path === '' ? '(root)' : issue.path}</span>：{issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        ) : null}

        {/* ==================== 无结果时的降级空态 + 客观统计 ==================== */}
        {state.status !== 'ok' ? (
          <section className="mt-6 space-y-4">
            <EmptyState
              tone="warning"
              icon={<Gauge className="h-4 w-4" />}
              title="评阅结果待生成"
              description={
                <>
                  本份报告的评阅结果尚未产出：构建期在 <code className="font-mono">public/results/</code> 下未找到{' '}
                  <code className="font-mono">result-{report.id}.json</code>
                  （目录内以 <code className="font-mono">_</code> 开头的文件是契约示例，不计为真实结果）。
                  因此本页不展示任何 AI 分数，避免出现无出处的数字。待五 Agent 流水线产出结果 JSON 并提交进仓库后，
                  本页会自动渲染逐项评分明细、评语与溯源信息。
                </>
              }
            >
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="正文字数"
                  value={formatNumber(report.wordCount)}
                  hint="汉字数 + 英文单词数，不计代码块"
                  icon={<FileText className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="代码块"
                  value={report.codeBlockCount}
                  hint="Markdown 围栏代码块数量"
                  icon={<SquareCode className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="截图"
                  value={report.figureCount}
                  hint="报告内引用的插图数量"
                  icon={<ImageOff className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="教师金标准分"
                  value={formatScore(report.goldTotalScore)}
                  hint="教师逐项人工标注后按同一加权口径核算"
                  icon={<Sigma className="h-3.5 w-3.5" />}
                />
              </div>
            </EmptyState>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <SearchCheck className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">结果产出后本页将展示什么</h2>
              </div>
              <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
                <li className="rounded-md bg-secondary/40 p-3">
                  <span className="font-medium text-foreground">逐项评分明细</span>
                  ：每个评分点的档位、得分 / 满分、扣分理由、判定置信度与是否触发复核。
                </li>
                <li className="rounded-md bg-secondary/40 p-3">
                  <span className="font-medium text-foreground">证据引用原文</span>
                  ：每条证据的类型、章节 / 行号 / 图号定位与逐字摘录，可直接回到报告原文核对。
                </li>
                <li className="rounded-md bg-secondary/40 p-3">
                  <span className="font-medium text-foreground">复核记录</span>
                  ：Reviewer 对低置信度项的复核意见与置信度变化（before → after）。
                </li>
                <li className="rounded-md bg-secondary/40 p-3">
                  <span className="font-medium text-foreground">面向学生的评语</span>
                  ：总体评价、亮点与可执行的改进建议，并标注语气风格。
                </li>
              </ul>
            </Card>
          </section>
        ) : null}

        {/* ====================== 左：原文 / 右：评分明细 ====================== */}
        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          {/* 左栏：报告原文 */}
          <Card className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            <CardHeader className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <CardTitle>报告原文</CardTitle>
                <Badge variant="outline" className="font-mono">
                  {report.fileName}
                </Badge>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  Markdown 轻量渲染 · 代码块左侧为该行在原文中的行号
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {markdown === '' ? (
                <p className="text-sm text-muted-foreground">
                  未读取到报告原文文件（{report.fileName}），请检查 demo/sample-reports/ 目录。
                </p>
              ) : (
                <MarkdownView source={markdown} />
              )}
            </CardContent>
          </Card>

          {/* 右栏：评分明细 / 金标准基线 */}
          <div className="space-y-4">
            {state.status === 'ok' && summary !== null ? (
              <>
                {/* 复核记录 */}
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">Reviewer 复核记录</h2>
                    <Badge variant={state.data.review.triggered ? 'warning' : 'success'}>
                      {state.data.review.triggered ? '已触发复核' : '未触发复核'}
                    </Badge>
                    <Badge variant="outline" className="ml-auto">
                      {state.data.review.adjustments.length} 项调整
                    </Badge>
                  </div>
                  {state.data.review.triggerReason === null ? null : (
                    <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                      触发原因：{state.data.review.triggerReason}
                    </p>
                  )}
                  <p className="mt-2.5 text-[13px] leading-relaxed">{state.data.review.opinion}</p>
                </Card>

                {/* 逐项评分明细 */}
                <div className="flex items-center gap-2 pt-1">
                  <Scale className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">逐项评分明细</h2>
                  <span className="text-xs text-muted-foreground">
                    {state.data.scores.length} 个评分点 · 权重合计{' '}
                    {formatScore(state.data.scores.reduce((sum, item) => sum + item.weight, 0))}
                  </span>
                </div>

                {state.data.scores.map((item) => (
                  <ScoreItemCard
                    key={item.rubricItemId}
                    item={item}
                    rubricItem={state.data.rubric?.items.find((rubricItem) => rubricItem.id === item.rubricItemId)}
                    adjustment={state.data.review.adjustments.find(
                      (adjustment) => adjustment.rubricItemId === item.rubricItemId,
                    )}
                  />
                ))}

                {/* 评语 */}
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageSquareQuote className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">面向学生的评语</h2>
                    <Badge variant="info">{TONE_META[state.data.feedback.tone] ?? state.data.feedback.tone}</Badge>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed">{state.data.feedback.overall}</p>

                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="text-xs font-medium text-emerald-700">亮点</div>
                      <ul className="mt-1.5 space-y-1.5">
                        {state.data.feedback.strengths.map((text, index) => (
                          <li key={`strength-${index}`} className="flex gap-2 text-[13px] leading-relaxed">
                            <CircleCheckBig className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>{text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-amber-700">改进建议</div>
                      <ul className="mt-1.5 space-y-1.5">
                        {state.data.feedback.improvements.map((text, index) => (
                          <li key={`improvement-${index}`} className="flex gap-2 text-[13px] leading-relaxed">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                            <span>{text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </>
            ) : (
              <>
                <Card className="p-5">
                  <div className="flex items-center gap-2">
                    <Scale className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">教师金标准基线（逐项）</h2>
                    <Badge variant="muted" className="ml-auto">
                      人工标注 · 非 AI 输出
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    这是教师按 rubric 档位标准逐项标注的应有得分，也是 AI 结果产出后一致性评测的参照。
                    它不代表 AI 判定，本页不会将其当作评阅结果展示。
                  </p>

                  <ul className="mt-4 space-y-2">
                    {goldItems.map((item) => {
                      const rubricItem = rubric.items.find((rubric) => rubric.id === item.rubricItemId);
                      const level = LEVEL_META[item.level];
                      return (
                        <li key={item.rubricItemId} className="rounded-md border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-secondary px-1.5 font-mono text-[11px] font-semibold">
                              {item.rubricItemId}
                            </span>
                            <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
                              {rubricItem?.name ?? item.itemName}
                            </span>
                            <Badge className={level.chip}>{level.label}</Badge>
                            <span className="text-[13px] font-semibold tabular-nums">
                              {formatScore(item.score)}
                              <span className="text-xs font-normal text-muted-foreground">
                                /{formatScore(item.maxScore)}
                              </span>
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                              权重 {formatScore(item.weight)}%
                            </span>
                            <Progress
                              value={item.score}
                              max={item.maxScore}
                              barClassName={level.bar}
                              label={`${item.itemName} 金标准得分率`}
                            />
                            <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
                              AI：待生成
                            </span>
                          </div>
                          {rubricItem === undefined ? null : (
                            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                              <span className="font-medium">证据要求：</span>
                              {truncate(rubricItem.evidenceRequirement, 96)}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>

                <Card className="p-5">
                  <div className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">当前可用的确定性信息</h2>
                  </div>
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <li>
                      · 报告原文与客观统计已就绪：<span className="tabular-nums">{formatNumber(report.wordCount)}</span>{' '}
                      字、{report.codeBlockCount} 个代码块、{report.figureCount} 张截图。
                    </li>
                    <li>
                      · Rubric v{rubric.version} 共 {rubric.items.length} 个评分点，权重合计{' '}
                      {rubric.items.reduce((sum, item) => sum + item.weight, 0)}，与 manifest 一致。
                    </li>
                    <li>
                      · 教师金标准分 {formatScore(report.goldTotalScore)} 分可先行用于一致性评测的分布展示；MAE 与逐项命中率
                      在结果产出后自动填充。
                    </li>
                    <li>· 结果文件命名约定：{RESULT_FILE_CONVENTION}，提交后重新构建即自动渲染。</li>
                  </ul>
                </Card>
              </>
            )}
          </div>
        </section>

        {/* =========================== 客观核查区块 =========================== */}
        <section className="mt-8">
          <InspectionPanel inspection={inspection} topSimilarity={topSimilarity} peerCount={peerCount} />
        </section>

        {/* =========================== 溯源信息块 =========================== */}
        <section className="mt-8">
          <ProvenanceBlock
            provenance={state.status === 'ok' ? state.data.provenance : null}
            fileName={state.file}
            hint={
              state.status === 'ok'
                ? '以下信息随结果文件一同固化；任何人可对结果指纹做一次 SHA-256 复算，不一致即说明文件被改动过。'
                : '本份报告尚无评阅结果，以下字段待结果产出后填充。'
            }
          />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
