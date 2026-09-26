/**
 * AutoGrader · 智能体构成（五件套）/agents
 * ===========================================================================
 * 对应规划书路径二 2.3：「智能体五件套展示页 —— 五层结构可视觉化呈现，
 * 直接支撑『AI 能力说明』」。
 *
 * 这一页回答的是评委最会追问的一个问题：**AI 到底在哪里、由什么构成？**
 * 因此页面上的数字全部来自**构建期机械抽取**（scripts/sync-assets.mjs 扫
 * backend/autograder-expert/agents/ 生成 lib/agent-kit.generated.json），
 * 不手写、不润色 —— 文件数与条目数永远与磁盘一致。
 *
 * 评测指标取自 Evaluation 层的实测基线（evaluations/baselines/*.json），
 * 同样是机械读入而非转述。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Bot,
  ClipboardList,
  Gauge,
  ListTree,
  Route,
  SquareTerminal,
  Sparkles,
} from 'lucide-react';

import { FivePieceDiagram, type PieceRow } from '@/components/five-piece-diagram';
import { InlineMarkdown } from '@/components/markdown-view';
import { Note } from '@/components/note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import agentKitJson from '@/lib/agent-kit.generated.json';
import { LEVEL_META } from '@/lib/constants';
import { getEvalBaseline } from '@/lib/data';
import { cn, formatNumber } from '@/lib/utils';

export const metadata: Metadata = {
  title: '智能体构成 · 五件套',
  description:
    'AutoGrader 专家智能体的五层构成：Prompt / Skills / Tools / Workflow / Evaluation，各自的落点、数量与职责',
};

/* ==========================================================================
 * 生成物类型（与 scripts/sync-assets.mjs 的抽取结果一一对应）
 * ========================================================================== */

interface DocDigest {
  file: string;
  title: string;
  summary: string;
  sections: string[];
  lineCount: number;
}

interface KitEntry extends DocDigest {
  id: string | null;
}

interface AgentKit {
  generatedBy: string;
  sourceRoot: string;
  pieces: {
    prompt: DocDigest | null;
    skills: KitEntry[];
    skillsIndex: DocDigest | null;
    tools: KitEntry[];
    toolsIndex: DocDigest | null;
    workflow: DocDigest[];
    evaluations: DocDigest[];
  };
  evaluationScripts: { file: string; lineCount: number }[];
  counts: { skills: number; tools: number; workflowDocs: number; rules: number; samples: number };
}

interface EvalBaseline {
  tool: string;
  contractSchemaVersion: string;
  mae: { count: number; mae: number; maxAbsDelta: number; maxAbsDeltaReportId: string };
  levelAgreement: { comparable: number; hits: number; rate: number; note: string };
  confidenceCalibration: {
    ece: number;
    buckets: { bucket: string; n: number; meanConfidence: number; accuracy: number }[];
  };
  goldMeta: { reportCount: number; rubricId: string; totalScoreFormula: string };
}

const agentKit = agentKitJson as unknown as AgentKit;

/* ==========================================================================
 * 页面
 * ========================================================================== */

export default function AgentsPage() {
  const baseline = getEvalBaseline() as unknown as EvalBaseline;
  const { prompt, skills, tools, workflow, evaluations } = agentKit.pieces;
  const { counts } = agentKit;

  const rows: PieceRow[] = [
    {
      key: 'Prompt',
      label: '角色与纪律',
      location: 'agents/agent/SYSTEM_PROMPT.md',
      count: prompt === null ? undefined : `${prompt.sections.length} 节 · ${formatNumber(prompt.lineCount)} 行`,
      responsibility:
        '角色、边界、契约、评分口径、证据纪律、输出骨架。自由度刻意压到最低：固定输出结构，禁止自由发挥与本条无关的叙述。',
      note:
        prompt === null
          ? null
          : `章节：${prompt.sections.slice(0, 6).join(' · ')}${prompt.sections.length > 6 ? ' …' : ''}`,
    },
    {
      key: 'Skills',
      label: '可复用方法论',
      location: 'agents/skills/',
      count: `${counts.skills} 个技能`,
      responsibility:
        'S0 任务路由 → S1 Rubric 构建 → S2 报告解析 → S3 证据取证与逐点判定 → S4 总分计算 → S5 装配与自检 → S6 评语生成 → S7 复核与解释。技能之间以固定链路协作，不重叠、不跳步。',
      note: 'S5 横向贯穿整条评阅链（对内对应 Reviewer 环，不向教师暴露）；S7 有两个入口，分别服务教师复核与只读回放。',
    },
    {
      key: 'Tools',
      label: '确定性能力',
      location: 'agents/tools/',
      count: `${counts.tools} 个工具 · ${counts.rules} 条内置规则`,
      responsibility:
        'T1 文档解析 / T2 客观核查 / T3 引用解析 / T4 确定性计算 / T5 契约校验 / T6 资产库。全部是纯函数命令行脚本：仅 Python 标准库、无网络、无 AI 调用，同一输入必得同一输出。',
      note: (
        <>
          工具与技能的分界是三条全中：<span className="text-foreground">同输入必得同输出</span>、
          <span className="text-foreground">可被第三方复算</span>、
          <span className="text-foreground">输出里没有判断只有事实</span>。任一条不满足就写进技能而不是工具。
        </>
      ),
    },
    {
      key: 'Workflow',
      label: '五环编排',
      location: 'agents/workflow/',
      count: `${counts.workflowDocs} 份规格`,
      responsibility:
        'Parser → Evidence → Grader → Reviewer → Feedback。每环都写明「输入 / 输出 / 置信度 / 证据引用」四栏，并给出环间交接物与各环硬闸门。',
      note: '编排形态支持单会话分步与多会话分环两种；两者对同一份报告必须给出等价结果。',
    },
    {
      key: 'Evaluation',
      label: '质量与稳定性',
      location: 'agents/evaluations/',
      count: `${agentKit.evaluationScripts.length} 个脚本 · ${evaluations.length} 份口径文档`,
      responsibility:
        '总分 MAE / 逐项命中率 / 档位一致率 / 置信度校准四项指标，加上一个回归门禁：新版本指标劣化即判定不通过。',
      note: (
        <>
          实测（{baseline.goldMeta.reportCount} 份样例 × 教师金标准）：总分 MAE{' '}
          <span className="tnum text-foreground">{baseline.mae.mae}</span>、档位一致率{' '}
          <span className="tnum text-foreground">{baseline.levelAgreement.rate}</span>、置信度校准 ECE{' '}
          <span className="tnum text-foreground">{baseline.confidenceCalibration.ece}</span>。
        </>
      ),
    },
  ];

  return (
    <>
      <SiteHeader active="/agents" />

      <main className="container pb-4">
        {/* ==================== 页头 ==================== */}
        <section className="border-b border-border py-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent" className="gap-1.5">
              <Sparkles className="h-3 w-3" />
              AI 能力在这里
            </Badge>
            <Badge variant="outline">五件套 · 机械抽取自仓库</Badge>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">智能体构成 · 五件套</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            AutoGrader 的智能评阅能力不是页面上的一个按钮，而是 LearnBuddy 上的一个**专家智能体**：
            它由 Prompt + Skills + Tools + Workflow + Evaluation 五层构成，全部落在本仓库里、可被逐份检查。
            网页只负责把评阅结果完整呈现出来。
          </p>
          <Note summary="本页数字怎么来的" className="mt-2">
            所有数字都在构建期由脚本扫描仓库生成（
            <code className="font-mono">{agentKit.generatedBy}</code>
            ），不手写、不润色：文件数与条目数永远与磁盘一致。抽取源：
            <code className="font-mono">{agentKit.sourceRoot}</code>。
          </Note>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="技能（Skills）" value={counts.skills} hint="S0 – S7，固定链路协作" />
            <StatCard label="工具（Tools）" value={counts.tools} hint="T1 – T6，纯函数 CLI" />
            <StatCard label="内置核查规则" value={counts.rules} hint="默认层只读，教师层可覆盖" />
            <StatCard
              label="总分 MAE"
              value={baseline.mae.mae}
              hint={`${baseline.mae.count} 份样例 vs 教师金标准`}
            />
          </div>
        </section>

        {/* ==================== 五件套轨道图 ==================== */}
        <section className="border-b border-border py-8">
          <div className="flex flex-wrap items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">五层的落点与职责</h2>
            <span className="text-[11.5px] text-muted-foreground">
              刻度长短表示层级：入口层（Prompt）定边界，其余四层在边界内工作
            </span>
          </div>
          <FivePieceDiagram rows={rows} className="mt-3" />
        </section>

        {/* ==================== Skills 明细 ==================== */}
        <section className="border-b border-border py-8">
          <SectionTitle
            icon={<ListTree className="h-4 w-4" />}
            title={`Skills · ${skills.length} 个技能`}
            hint="每个技能是一份可复用方法论，含定位 / 输入 / 输出 / 完成判据 / 依赖工具"
          />
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {skills.map((skill) => (
              <Card key={skill.file} className="p-4">
                <div className="flex items-baseline gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                    {skill.id ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug tracking-tight">
                    {skill.title.replace(/^S\d+\s*·\s*/, '')}
                  </span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                    {skill.sections.length} 节
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  <InlineMarkdown text={skill.summary} />
                </p>
                <code className="mt-2 block truncate font-mono text-[11px] text-muted-foreground">
                  {skill.file}
                </code>
              </Card>
            ))}
          </div>
        </section>

        {/* ==================== Tools 明细 ==================== */}
        <section className="border-b border-border py-8">
          <SectionTitle
            icon={<SquareTerminal className="h-4 w-4" />}
            title={`Tools · ${tools.length} 个工具`}
            hint="纯函数命令行脚本：仅 Python 标准库、无网络、无 AI 调用，JSON 出参"
          />
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {tools.map((tool) => (
              <Card key={tool.file} className="p-4">
                <div className="flex items-baseline gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                    {tool.id ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug tracking-tight">
                    {tool.title.replace(/^T\d+\s*·\s*/, '')}
                  </span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                    {formatNumber(tool.lineCount)} 行
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  <InlineMarkdown text={tool.summary} />
                </p>
                <code className="mt-2 block truncate font-mono text-[11px] text-muted-foreground">
                  {tool.file}
                </code>
              </Card>
            ))}
          </div>
        </section>

        {/* ==================== Workflow 明细 ==================== */}
        <section className="border-b border-border py-8">
          <SectionTitle
            icon={<ClipboardList className="h-4 w-4" />}
            title="Workflow · 五环编排"
            hint="逐环写明输入 / 输出 / 置信度 / 证据引用四栏，并给出环间交接物与硬闸门"
          />
          <ol className="mt-3 space-y-2">
            {workflow.map((doc) => (
              <li key={doc.file} className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-semibold tracking-tight">
                    {doc.title}
                  </span>
                  <code className="font-mono text-[11px] text-muted-foreground">{doc.file}</code>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <InlineMarkdown text={doc.summary} />
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ==================== Evaluation 明细 ==================== */}
        <section className="border-b border-border py-8">
          <SectionTitle
            icon={<Gauge className="h-4 w-4" />}
            title="Evaluation · 指标与门禁"
            hint="指标口径只在 metrics.md 定义一次；页面上的数值直接读实测基线，不转述"
          />

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="总分 MAE"
              value={baseline.mae.mae}
              hint={`单份最大偏差 ${baseline.mae.maxAbsDelta}（${baseline.mae.maxAbsDeltaReportId}）`}
            />
            <StatCard
              label="档位一致率"
              value={baseline.levelAgreement.rate}
              hint={`${baseline.levelAgreement.hits} / ${baseline.levelAgreement.comparable} 项档位相符`}
            />
            <StatCard
              label="置信度校准 ECE"
              value={baseline.confidenceCalibration.ece}
              hint={`${baseline.confidenceCalibration.buckets.length} 个分桶`}
            />
            <StatCard
              label="参与评测的报告"
              value={baseline.mae.count}
              hint={`金标准 rubric ${baseline.goldMeta.rubricId}`}
            />
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {agentKit.evaluationScripts.map((script) => (
              <Card key={script.file} className="flex items-baseline gap-3 p-4">
                <Gauge className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-primary" />
                <span className="min-w-0 flex-1 font-mono text-[12.5px]">{script.file}</span>
                <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                  {formatNumber(script.lineCount)} 行
                </span>
              </Card>
            ))}
          </div>

          <Note summary="指标口径怎么保证一致" className="mt-3">
            <p>
              口径写死为：<code className="font-mono">{baseline.goldMeta.totalScoreFormula}</code>；
              每个指标都可由原始数据复算。
            </p>
            <p>
              评测页 <Link href="/eval" className="text-primary hover:underline">/eval</Link>{' '}
              会把这些数字**在浏览器里现算一遍**，而不是把结果抄在页面上。
            </p>
          </Note>
        </section>

        {/* ==================== 档位图例（顺带说明色彩纪律） ==================== */}
        <section className="border-b border-border py-8">
          <SectionTitle
            icon={<Bot className="h-4 w-4" />}
            title="两个容易混的标记 · 与色彩纪律"
            hint="needsReview（需人过目，不影响总分）与 pending（无终值，不计入求和）语义正交，必须能一眼分开"
          />

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">※ 待过目</Badge>
                <Badge className="border-rule bg-secondary/60 text-foreground">□ 无终值</Badge>
              </div>
              <ul className="mt-2.5 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-mono text-foreground">needsReview</span> —— 需要教师看一眼；
                  <span className="text-foreground">不影响总分</span>。
                </li>
                <li>
                  <span className="font-mono text-foreground">pending</span> —— 尚无终值；
                  <span className="text-foreground">不计入求和</span>，其权重计入「已排除」。
                </li>
                <li>两者合并会让 12 份历史资产的总分全部改变，故契约强制并存且符号不同。</li>
              </ul>
            </Card>

            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                {(['excellent', 'meeting', 'partial', 'notMet'] as const).map((level) => (
                  <Badge key={level} className={cn(LEVEL_META[level].chip)}>
                    <span aria-hidden className="font-mono tracking-tighter">
                      {LEVEL_META[level].symbol}
                    </span>
                    {LEVEL_META[level].label}
                  </Badge>
                ))}
              </div>
              <Note summary="为什么不用红绿" className="mt-2.5">
                档位、置信度、难度这些**数据语义一律不用红绿**：序数由
                <span className="font-mono text-foreground"> ●●○○</span> 这类刻度符号承担，
                程度由字重与灰阶承担。理由是红绿在色觉障碍下不可辨、在黑白打印与低质量投屏上同样失效；
                低饱和赭石仅保留给「真的出错」（构建失败、契约校验不通过）。
              </Note>
            </Card>
          </div>
        </section>

        <section className="py-8">
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/* ==========================================================================
 * 局部小件
 * ========================================================================== */

function SectionTitle({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-primary">{icon}</span>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint === undefined ? null : (
        <span className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
