/**
 * AutoGrader · 评阅工作台 /grade
 * ---------------------------------------------------------------------------
 * 12 份样例报告的评阅入口。每张卡片给出主题、难度档位、教师金标准分与
 * 字数 / 代码块 / 截图数，并用状态徽章区分「已有评阅结果」与「待生成」。
 *
 * 现状：public/results/ 下尚无任何真实结果（只有以 `_` 开头的契约示例文件，
 * 按约定不计入），因此 12 张卡片均显示「待生成」——这是预期状态，不是错误。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, ImageOff, LayoutGrid, ScrollText, Sigma, SquareCode } from 'lucide-react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  AI_SOURCE_STATEMENT,
  RESULT_FILE_CONVENTION,
  STATUS_META,
  TIER_META,
  TONE,
} from '@/lib/constants';
import { getGeneratedReportIds, getManifest, getResultState, getSampleReports } from '@/lib/data';
import { cn, formatNumber, formatScore, truncate } from '@/lib/utils';

export const metadata: Metadata = {
  title: '评阅工作台',
  description: '12 份样例实验报告的评阅入口、状态与教师金标准分总览',
};

export default function GradePage() {
  const reports = getSampleReports();
  const manifest = getManifest();
  const generatedIds = new Set(getGeneratedReportIds());

  const goldScores = reports.map((report) => report.goldTotalScore);
  const minGold = Math.min(...goldScores);
  const maxGold = Math.max(...goldScores);
  const totalWords = reports.reduce((sum, report) => sum + report.wordCount, 0);
  const totalFigures = reports.reduce((sum, report) => sum + report.figureCount, 0);
  const totalCodeBlocks = reports.reduce((sum, report) => sum + report.codeBlockCount, 0);

  return (
    <>
      <SiteHeader active="/grade" />

      <main className="container pb-4">
        <section className="border-b border-border py-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <LayoutGrid className="h-3 w-3" />
              Rubric v{manifest.rubricVersion}
            </Badge>
            <Badge variant="muted">合成脱敏数据</Badge>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">评阅工作台</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            12 份样例实验报告覆盖进程 / 线程同步、Socket 网络编程、排序算法性能对比三个实验主题，
            每份都配有教师逐项标注的金标准分。点击任意一份进入详情页，可查看报告原文、
            逐项评分明细（档位 / 得分 / 扣分理由 / 证据引用原文）与溯源信息。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="样例报告"
              value={reports.length}
              hint={`3 门课程 · 3 个实验主题 · 难度档位各 3 份`}
              icon={<FileText className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="已有评阅结果"
              value={`${generatedIds.size} / ${reports.length}`}
              valueClassName={generatedIds.size === 0 ? TONE.notice.text : TONE.ok.text}
              hint={`按约定读取 public/results/${RESULT_FILE_CONVENTION}`}
              icon={<ScrollText className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="待生成"
              value={reports.length - generatedIds.size}
              hint="结果 JSON 提交进仓库后自动转为「已有评阅结果」"
            />
            <StatCard
              label="教师金标准分区间"
              value={`${formatScore(minGold)}–${formatScore(maxGold)}`}
              hint={`均值 ${formatScore(
                Math.round((goldScores.reduce((sum, score) => sum + score, 0) / goldScores.length) * 100) / 100,
              )} 分 · 满分 100`}
              icon={<Sigma className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              正文合计 <span className="font-medium tabular-nums text-foreground">{formatNumber(totalWords)}</span> 字
            </span>
            <span>
              代码块合计 <span className="font-medium tabular-nums text-foreground">{totalCodeBlocks}</span> 个
            </span>
            <span>
              截图合计 <span className="font-medium tabular-nums text-foreground">{totalFigures}</span> 张
            </span>
            <span className="text-muted-foreground/80">{manifest.wordCountBasis}</span>
          </div>
        </section>

        <section className="py-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">样例报告清单</h2>
            <p className="text-xs text-muted-foreground">{AI_SOURCE_STATEMENT}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => {
              const state = getResultState(report.id);
              const status = STATUS_META[state.status];
              const tier = TIER_META[report.tier];
              const goldItems = report.expectedItemScores;

              return (
                <Link key={report.id} href={`/report/${report.id}`} className="group">
                  <Card className="flex h-full flex-col transition-colors group-hover:border-primary/40">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/30 px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">{report.id}</span>
                      <Badge className={tier?.chip ?? 'border-border bg-muted text-muted-foreground'}>
                        难度 {report.tier}
                      </Badge>
                      <Badge className={cn('ml-auto', status.chip)}>{status.label}</Badge>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="text-sm font-semibold leading-snug tracking-tight">{report.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {report.course} · {report.topic}
                      </p>

                      <div className="mt-3.5 flex items-end justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
                        <div>
                          <div className="text-[11px] text-muted-foreground">教师金标准分</div>
                          <div className="text-2xl font-semibold tabular-nums leading-tight text-foreground">
                            {formatScore(report.goldTotalScore)}
                            <span className="text-xs font-normal text-muted-foreground"> / 100</span>
                          </div>
                        </div>
                        <div className="text-right text-[11px] leading-relaxed text-muted-foreground">
                          <div>{goldItems.length} 个评分点已逐项标注</div>
                          <div>
                            满分合计 {formatScore(goldItems.reduce((sum, item) => sum + item.maxScore, 0))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md bg-secondary/50 px-2 py-1.5">
                          <FileText className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                          <div className="mt-1 text-sm font-medium tabular-nums">{formatNumber(report.wordCount)}</div>
                          <div className="text-[11px] text-muted-foreground">字数</div>
                        </div>
                        <div className="rounded-md bg-secondary/50 px-2 py-1.5">
                          <SquareCode className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                          <div className="mt-1 text-sm font-medium tabular-nums">{report.codeBlockCount}</div>
                          <div className="text-[11px] text-muted-foreground">代码块</div>
                        </div>
                        <div className="rounded-md bg-secondary/50 px-2 py-1.5">
                          <ImageOff className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                          <div className="mt-1 text-sm font-medium tabular-nums">{report.figureCount}</div>
                          <div className="text-[11px] text-muted-foreground">截图</div>
                        </div>
                      </div>

                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        {truncate(report.summary, 62)}
                      </p>

                      <div className="mt-auto flex items-center justify-between gap-2 pt-3.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          result-{report.id}.json
                        </code>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          查看详情
                          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            状态判定规则：构建期扫描 <code className="font-mono">public/results/</code> 目录，按约定文件名{' '}
            <code className="font-mono">{RESULT_FILE_CONVENTION}</code> 查找；以 <code className="font-mono">_</code>{' '}
            开头的文件（如 <code className="font-mono">_example.json</code>）是契约格式示例，不作为任何报告的真实结果参与统计。
            结果文件缺失或未通过契约校验时，详情页会以「评阅结果待生成」空态降级展示，不会报错或白屏。
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
