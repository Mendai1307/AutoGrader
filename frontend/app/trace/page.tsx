/**
 * AutoGrader · 工作流溯源 /trace
 * ---------------------------------------------------------------------------
 * 回答「AI 是不是黑箱」：把五 Agent 流水线每一步的中间产物摊开给评审看。
 *
 * 示例数据来源：public/results/_example.json —— 它是契约格式示例，
 * **不是任何真实报告的评阅结果**，本页据此渲染一条完整的溯源链样例，
 * 并在页面上明确标注这一事实，避免被误读为真实评分。
 *
 * 同时展示「低置信度（< 0.80）自动触发 Reviewer 复核」的规则与阈值表。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ClipboardCheck,
  Fingerprint,
  GitBranch,
  Info,
  Network,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import { AgentIcon } from '@/components/agent-pipeline';
import { EmptyState } from '@/components/empty-state';
import { ProvenanceBlock } from '@/components/provenance-block';
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
import { AGENTS, RESULT_FILE_CONVENTION, STATUS_META } from '@/lib/constants';
import { getContractExample, getResultState, getSampleReports } from '@/lib/data';
import {
  CONFIDENCE_SEMANTICS,
  CONFIDENCE_THRESHOLD,
  gradeConfidence,
  type ConfidenceGrade,
} from '@/lib/schema';
import { cn, formatRatio, formatScore } from '@/lib/utils';

export const metadata: Metadata = {
  title: '工作流溯源',
  description: '五 Agent 流水线中间产物、复核触发规则与结果溯源审计信息',
};

const GRADE_CHIP: Readonly<Record<ConfidenceGrade, string>> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-rose-200 bg-rose-50 text-rose-700',
};

const GRADE_BAR: Readonly<Record<ConfidenceGrade, string>> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-rose-500',
};

/** 置信度区间展示串 */
function bandLabel(grade: ConfidenceGrade): string {
  if (grade === 'high') return `${CONFIDENCE_THRESHOLD.HIGH.toFixed(2)} – 1.00`;
  if (grade === 'medium') return `${CONFIDENCE_THRESHOLD.MEDIUM.toFixed(2)} – < ${CONFIDENCE_THRESHOLD.HIGH.toFixed(2)}`;
  return `0.00 – < ${CONFIDENCE_THRESHOLD.MEDIUM.toFixed(2)}`;
}

export default function TracePage() {
  const example = getContractExample();
  const reports = getSampleReports();
  const steps = example === null ? [] : [...example.steps].sort((a, b) => a.step - b.step);
  const adjustments = example === null ? [] : example.review.adjustments;

  const reportStatuses = reports.map((report) => ({
    report,
    state: getResultState(report.id),
  }));
  const generatedCount = reportStatuses.filter((entry) => entry.state.status === 'ok').length;

  return (
    <>
      <SiteHeader active="/trace" />

      <main className="container pb-4">
        {/* ============================ 头部 ============================ */}
        <section className="border-b border-border py-10">
          <Badge variant="outline" className="gap-1.5">
            <GitBranch className="h-3 w-3" />
            五 Agent 中间产物 · 全链路可核查
          </Badge>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">工作流溯源</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            智能评阅由 Parser → Evidence → Grader → Reviewer → Feedback 五个 Agent 依次完成，
            每一步都留下结构化的输入 / 输出摘要与置信度。本页把这条链路完整摊开，
            让评审可以回答：这个分数是
            <span className="font-semibold text-foreground">基于哪几条证据、经哪一步判定、有没有被复核改过</span>
            得出的。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="流水线环节"
              value={AGENTS.length}
              hint="Parser → Evidence → Grader → Reviewer → Feedback"
              icon={<Network className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="复核触发阈值"
              value={CONFIDENCE_THRESHOLD.REVIEW.toFixed(2)}
              hint="置信度低于该值即自动进入 Reviewer 复核"
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="溯源链示例步骤"
              value={steps.length}
              hint="来自契约示例 _example.json（非真实评阅结果）"
              icon={<ScrollText className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="已固化溯源的结果"
              value={`${generatedCount} / ${reports.length}`}
              valueClassName={generatedCount === 0 ? 'text-muted-foreground' : undefined}
              hint={`按 ${RESULT_FILE_CONVENTION} 约定扫描`}
              icon={<Fingerprint className="h-3.5 w-3.5" />}
            />
          </div>
        </section>

        {/* ========================= 复核触发规则 ========================= */}
        <section className="py-8">
          <Card>
            <CardHeader className="border-b border-border bg-secondary/30">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <CardTitle>复核触发规则：低置信度（&lt; 0.80）自动触发 Reviewer 复核</CardTitle>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Grader 给出的每一项判定都带一个 0–1 的置信度。只要某项置信度低于 0.80，
                该项就会被置为「需复核」并整体转交 Reviewer 环节二次比对证据原文；
                复核不会凭空补证据，只能维持、上调置信度或改判档位。
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>分级</TableHead>
                      <TableHead>置信度区间</TableHead>
                      <TableHead>语义</TableHead>
                      <TableHead className="text-right">是否触发复核</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(['high', 'medium', 'low'] as const).map((grade) => (
                      <TableRow key={grade}>
                        <TableCell>
                          <Badge className={GRADE_CHIP[grade]}>
                            {grade === 'high' ? 'HIGH 高' : grade === 'medium' ? 'MEDIUM 中' : 'LOW 低'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{bandLabel(grade)}</TableCell>
                        <TableCell className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                          {CONFIDENCE_SEMANTICS[grade]}
                        </TableCell>
                        <TableCell className="text-right">
                          {grade === 'high' ? (
                            <Badge variant="success">否</Badge>
                          ) : (
                            <Badge variant="warning">是</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableCaption>
                    除置信度外，以下情形同样置「需复核」：该项证据数组为空；该项档位存在跨两级争议。
                    复核后置信度仍低于 0.60 的项，界面必须显著标注并建议教师人工确认。
                  </TableCaption>
                </Table>
              </TableWrapper>
            </CardContent>
          </Card>
        </section>

        {/* ========================== 溯源链示例 ========================== */}
        <section className="pb-8">
          {example === null ? (
            <EmptyState
              tone="warning"
              title="契约示例不可用"
              description={
                <>
                  未能从 <code className="font-mono">public/results/_example.json</code>{' '}
                  读取到合法的 ReviewResult 示例（文件缺失或未通过契约校验），因此无法渲染溯源链示例。
                  这不影响真实评阅结果的读取与展示。
                </>
              }
            />
          ) : (
            <>
              <Card className="mb-4 border-amber-300 bg-amber-50/60 p-4">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs leading-relaxed text-amber-900">
                    <span className="font-semibold">数据来源说明：</span>
                    以下溯源链来自 <code className="font-mono">public/results/_example.json</code>，
                    它是本系统的<span className="font-semibold">契约格式示例</span>（报告《{example.report.title}》），
                    不是任何一份样例报告的评阅结果，也不参与 <Link href="/eval" className="underline">一致性评测</Link>。
                    它的作用是展示一条完整的、字段齐全的溯源链长什么样。
                  </p>
                </div>
              </Card>

              <Tabs
                defaultValue="steps"
                items={[
                  {
                    value: 'steps',
                    label: '流水线步骤',
                    count: steps.length,
                    content: (
                      <ol className="relative space-y-4 border-l border-border pl-6">
                        {steps.map((step) => {
                          const agent = AGENTS.find((item) => item.key === step.agent);
                          const grade = gradeConfidence(step.confidence);
                          return (
                            <li key={`${step.step}-${step.agent}`} className="relative">
                              <span className="absolute -left-[1.95rem] top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold tabular-nums">
                                {step.step}
                              </span>

                              <Card className="p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                                    <AgentIcon agent={step.agent} className="h-3.5 w-3.5 text-primary" />
                                    {agent?.name ?? step.agent}
                                  </span>
                                  <Badge variant="outline">{agent?.role ?? '—'}</Badge>
                                  <Badge className={cn('ml-auto', GRADE_CHIP[grade])}>
                                    步骤置信度 {formatRatio(step.confidence)}
                                  </Badge>
                                </div>

                                <div className="mt-3 flex items-center gap-2">
                                  <Progress
                                    value={step.confidence * 100}
                                    max={100}
                                    className="h-1.5"
                                    barClassName={GRADE_BAR[grade]}
                                    label={`步骤 ${step.step} 置信度`}
                                  />
                                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                                    {(step.confidence * 100).toFixed(0)}%
                                  </span>
                                </div>

                                <dl className="mt-3 grid gap-2 md:grid-cols-2">
                                  <div className="rounded-md bg-secondary/40 p-3">
                                    <dt className="text-[11px] font-medium text-muted-foreground">输入摘要</dt>
                                    <dd className="mt-1 text-[13px] leading-relaxed">{step.inputSummary}</dd>
                                  </div>
                                  <div className="rounded-md bg-secondary/40 p-3">
                                    <dt className="text-[11px] font-medium text-muted-foreground">输出摘要</dt>
                                    <dd className="mt-1 text-[13px] leading-relaxed">{step.outputSummary}</dd>
                                  </div>
                                </dl>

                                {step.note === undefined ? null : (
                                  <p className="mt-2.5 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                                    {step.note}
                                  </p>
                                )}

                                {step.confidence < CONFIDENCE_THRESHOLD.REVIEW ? (
                                  <p className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] font-medium leading-relaxed text-amber-800">
                                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                                    该步骤置信度低于 {CONFIDENCE_THRESHOLD.REVIEW.toFixed(2)}，
                                    其产出的低置信度判定会自动转交 Reviewer 复核。
                                  </p>
                                ) : null}
                              </Card>
                            </li>
                          );
                        })}
                      </ol>
                    ),
                  },
                  {
                    value: 'review',
                    label: '复核调整记录',
                    count: adjustments.length,
                    content: (
                      <div className="space-y-3">
                        <Card className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <ClipboardCheck className="h-4 w-4 text-primary" />
                            <span className="text-sm font-semibold">复核总体结论</span>
                            <Badge variant={example.review.triggered ? 'warning' : 'success'}>
                              {example.review.triggered ? '已触发复核' : '未触发复核'}
                            </Badge>
                            <span className="ml-auto font-mono text-xs tabular-nums">
                              整体置信度 {formatRatio(example.review.overallConfidenceBefore)} →{' '}
                              {formatRatio(example.review.overallConfidenceAfter)}
                            </span>
                          </div>
                          {example.review.triggerReason === null ? null : (
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              触发原因：{example.review.triggerReason}
                            </p>
                          )}
                          <p className="mt-2 text-[13px] leading-relaxed">{example.review.opinion}</p>
                        </Card>

                        {adjustments.length === 0 ? (
                          <EmptyState
                            title="本次复核未产生逐项调整"
                            description="复核记录为空数组是合法状态：表示没有评分点被改判或调整置信度。"
                          />
                        ) : (
                          adjustments.map((adjustment) => (
                            <Card key={adjustment.rubricItemId} className="p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-secondary px-1.5 font-mono text-[11px] font-semibold">
                                  {adjustment.rubricItemId}
                                </span>
                                <Badge variant={adjustment.changed ? 'warning' : 'muted'}>
                                  {adjustment.changed ? '已改判' : '维持原档位'}
                                </Badge>
                                <span className="ml-auto font-mono text-xs tabular-nums">
                                  置信度 {formatRatio(adjustment.confidenceBefore)} →{' '}
                                  {formatRatio(adjustment.confidenceAfter)}
                                </span>
                                {adjustment.scoreBefore === null ? (
                                  <Badge variant="outline">分数未调整</Badge>
                                ) : (
                                  <Badge variant="info">
                                    得分 {formatScore(adjustment.scoreBefore)} →{' '}
                                    {adjustment.scoreAfter === null ? '—' : formatScore(adjustment.scoreAfter)}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-2.5 text-[13px] leading-relaxed">{adjustment.opinion}</p>
                              {adjustment.confidenceAfter < CONFIDENCE_THRESHOLD.MEDIUM ? (
                                <p className="mt-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-[11px] font-medium leading-relaxed text-rose-800">
                                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                                  复核后置信度仍低于 {CONFIDENCE_THRESHOLD.MEDIUM.toFixed(2)}，须标注为「待教师人工确认」。
                                </p>
                              ) : null}
                            </Card>
                          ))
                        )}
                      </div>
                    ),
                  },
                  {
                    value: 'provenance',
                    label: '溯源与指纹',
                    count: reports.length,
                    content: (
                      <div className="space-y-4">
                        <ProvenanceBlock
                          provenance={example.provenance}
                          hint="该块的字段与真实结果文件完全同构；真实结果产出后，每份报告详情页底部都会展示同一结构。"
                        />

                        <Card className="overflow-hidden">
                          <CardHeader className="border-b border-border bg-secondary/30">
                            <div className="flex flex-wrap items-center gap-2">
                              <Network className="h-4 w-4 text-primary" />
                              <CardTitle>12 份样例报告的溯源状态</CardTitle>
                              <Badge variant="muted" className="ml-auto">
                                已固化 {generatedCount} / {reports.length}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="p-0">
                            <TableWrapper>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>报告</TableHead>
                                    <TableHead>预期结果文件</TableHead>
                                    <TableHead className="text-right">教师金标准分</TableHead>
                                    <TableHead className="text-right">流水线溯源</TableHead>
                                    <TableHead>状态</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {reportStatuses.map(({ report, state }) => (
                                    <TableRow key={report.id}>
                                      <TableCell>
                                        <Link href={`/report/${report.id}`} className="group block max-w-[22rem]">
                                          <span className="font-mono text-[11px] text-muted-foreground">
                                            {report.id}
                                          </span>
                                          <span className="block truncate text-[13px] font-medium group-hover:text-primary">
                                            {report.title}
                                          </span>
                                        </Link>
                                      </TableCell>
                                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                                        {state.file}
                                      </TableCell>
                                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                                        {formatScore(report.goldTotalScore)}
                                      </TableCell>
                                      <TableCell className="text-right text-xs text-muted-foreground">
                                        {state.status === 'ok' ? `${state.data.steps.length} 步已固化` : '待生成'}
                                      </TableCell>
                                      <TableCell>
                                        <Badge className={STATUS_META[state.status].chip}>
                                          {STATUS_META[state.status].label}
                                        </Badge>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                                <TableCaption>
                                  报告原始 Markdown 与 manifest 元信息为构建期读取的静态资产，不参与任何运行时推理。
                                </TableCaption>
                              </Table>
                            </TableWrapper>
                          </CardContent>
                        </Card>
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
