/**
 * AutoGrader · 首页
 * ---------------------------------------------------------------------------
 * 回答三个问题：这是什么产品 / AI 能力从哪来 / 从哪里开始看。
 * 纯 Server Component，构建期读取仓库内静态资产，运行时零 AI 调用。
 */

import Link from 'next/link';
import {
  ArrowRight,
  Blocks,
  CircleCheckBig,
  FileText,
  Fingerprint,
  GitBranch,
  LayoutGrid,
  Scale,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react';

import { AgentPipeline } from '@/components/agent-pipeline';
import { Note } from '@/components/note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRubric, getSampleReports, getManifest } from '@/lib/data';
import {
  AGENTS,
  AI_SOURCE_STATEMENT,
  SITE_NAME,
  SITE_POSITIONING,
  SITE_TAGLINE,
  TONE,
} from '@/lib/constants';
import { cn, formatNumber } from '@/lib/utils';

const ENTRIES = [
  {
    href: '/grade',
    label: '评阅工作台',
    icon: LayoutGrid,
    description: '12 份样例报告的评阅入口：主题、难度档位、教师金标准分与字数 / 代码块 / 截图统计一屏可见。',
    cta: '进入工作台',
  },
  {
    href: '/eval',
    label: '一致性评测',
    icon: Scale,
    description: '教师金标准分与 AI 评分逐份对比：总分 MAE、逐项档位命中率、难度档位与分数分布。',
    cta: '查看评测',
  },
  {
    href: '/trace',
    label: '工作流溯源',
    icon: GitBranch,
    description: '五 Agent 每一步的输入 / 输出摘要与置信度，以及结果指纹、来源对话轮次等审计信息。',
    cta: '查看溯源',
  },
] as const;

/** AI 能力边界：三条支撑申报口径的事实 */
const AI_FACTS = [
  {
    icon: Blocks,
    title: '推理全部发生在对话侧',
    body: 'Parser → Evidence → Grader → Reviewer → Feedback 五 Agent 在 LearnBuddy 对话中完成推理，产出严格符合 ReviewResult 契约的 JSON 后提交进仓库。',
  },
  {
    icon: CircleCheckBig,
    title: 'Web 端只做确定性渲染',
    body: '运行时零 AI 调用、零后端、零数据库：工程依赖中不存在任何第三方大模型 SDK，页面是 output: \'export\' 的静态产物。',
  },
  {
    icon: Fingerprint,
    title: '每个结论都可回溯',
    body: '评分点、证据原文、档位系数、复核置信度变化、结果指纹与来源对话轮次全部固化为 JSON 资产，评审可逐条复核，AI 不是黑箱。',
  },
] as const;

export default function HomePage() {
  const reports = getSampleReports();
  const rubric = getRubric();
  const manifest = getManifest();

  const totalWords = reports.reduce((sum, report) => sum + report.wordCount, 0);

  return (
    <>
      <SiteHeader active="/" />

      <main className="container pb-4">
        {/* ============================ Hero ============================ */}
        <section className="border-b border-border py-12">
          <Badge variant="outline" className="gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            AI 离线评阅 · 结果可溯源
          </Badge>

          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{SITE_NAME}</h1>

          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            {SITE_TAGLINE} —— {SITE_POSITIONING}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/grade" className={cn(buttonVariants({ size: 'lg' }))}>
              进入评阅工作台
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/trace" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              查看工作流溯源
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="样例实验报告"
              value={reports.length}
              hint={`覆盖 ${new Set(reports.map((report) => report.course)).size} 门课程 · 3 个实验主题`}
              icon={<FileText className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="Rubric 评分点"
              value={rubric.items.length}
              hint={`权重合计 ${rubric.items.reduce((sum, item) => sum + item.weight, 0)} · v${rubric.version}`}
              icon={<SearchCheck className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="流水线 Agent"
              value={AGENTS.length}
              hint="Parser → Evidence → Grader → Reviewer → Feedback"
              icon={<Blocks className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="运行时 AI 调用"
              value={0}
              valueClassName={TONE.ok.text}
              hint={`正文合计 ${formatNumber(totalWords)} 字，全部为合成脱敏数据`}
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
            />
          </div>
        </section>

        {/* ===================== AI 能力来源声明 ===================== */}
        <section className="border-b border-border py-12">
          <Card className="border-primary/30 bg-primary/[0.04]">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <CardTitle className="text-lg">AI 能力来源声明</CardTitle>
              </div>
              <p className="text-base font-medium leading-relaxed text-foreground">{AI_SOURCE_STATEMENT}</p>
              <Note summary="Compile-time AI 范式是什么">
                AI 推理在开发期的 LearnBuddy 对话侧完成并固化为仓库内的静态 JSON 资产；
                Web 端不复用任何模型、不发起任何网络推理请求，只按契约做确定性渲染。
                这样做的直接好处是评分口径可复现、可审计、可离线演示，也不会出现「同一份报告两次评阅得到不同分数」。
              </Note>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                {AI_FACTS.map((fact) => (
                  <div key={fact.title} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <fact.icon className="h-4 w-4 text-primary" />
                      {fact.title}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{fact.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="muted">无第三方 AI 依赖</Badge>
                <Badge variant="muted">output: &apos;export&apos; 静态导出</Badge>
                <Badge variant="muted">契约版本 schema {manifest.schemaVersion}</Badge>
                <Badge variant="muted">总分口径 {manifest.totalScoreFormula}</Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ======================== 五 Agent 流水线 ======================== */}
        <section className="border-b border-border py-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">五 Agent 评阅流水线</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                每一步都产出结构化的中间结果并记录置信度，供教师逐环节核查；
                置信度低于 0.80 的判定会自动进入 Reviewer 复核环节，而不是直接落到分数上。
              </p>
            </div>
            <Link
              href="/trace"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              查看完整溯源链
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <AgentPipeline className="mt-6" />

          <Note summary="虚线框的含义" className="mt-4">
            虚线框标注的 Reviewer 为条件触发环节——仅当存在置信度 &lt; 0.80 的评分点、
            证据数组为空或档位存在跨两级争议时才会实际执行复核。
          </Note>
        </section>

        {/* ========================== 页面入口 ========================== */}
        <section className="py-12">
          <h2 className="text-xl font-semibold tracking-tight">从哪里开始看</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            三个入口对应「单份报告怎么评」「评得准不准」「凭什么相信它」三个问题。
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {ENTRIES.map((entry) => (
              <Link key={entry.href} href={entry.href} className="group">
                <Card className="flex h-full flex-col transition-colors group-hover:border-primary/40">
                  <CardHeader>
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                      <entry.icon className="h-4 w-4" />
                    </span>
                    <CardTitle className="mt-1">{entry.label}</CardTitle>
                    <p className="text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
                  </CardHeader>
                  <CardContent className="mt-auto pt-0">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      {entry.cta}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
