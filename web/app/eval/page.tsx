/**
 * AutoGrader · 一致性评测 /eval
 * ===========================================================================
 * 本文件是**薄服务端页**：只做一件事 —— 把原始数据读出来，交给浏览器端现算。
 *
 * 为什么要这样切
 * ---------------------------------------------------------------------------
 * 判据 2.7 要求「页面可复算：展示公式与中间量，人工可用计算器核对」。
 * 如果指标在构建期算好、页面上只是一个固化的字面量，读者只能选择"相信"。
 * 因此这里**不计算任何指标**，只把三样原始输入传下去：
 *   ① 每份报告的金标准逐项档位；
 *   ② 每份结果的 AI 逐项档位与置信度；
 *   ③ rubric 的条目与权重。
 * 真正的 MAE / 命中率 / 档位一致率 / ECE 由 `components/eval-metrics.tsx`
 * 在**浏览器运行时**现算（纯函数在 `lib/analysis.ts`，与工具链 `evaluate.py` 逐条对齐）。
 *
 * 于是页面上的每个数字都能被追到一行可查看的 JS，而不是一个字面量。
 */

import type { Metadata } from 'next';

import { EvalDashboard, type EvalMetricsInput } from '@/components/eval-metrics';
import { Note } from '@/components/note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { getResultState, getRubric, getSampleReports } from '@/lib/data';
import { Scale } from 'lucide-react';

export const metadata: Metadata = {
  title: '一致性评测',
  description: '教师金标准分与 AI 评分的逐份对比、MAE、档位一致率、置信度校准 ECE 与分布',
};

function buildInput(): EvalMetricsInput {
  const rubric = getRubric();
  const reports = getSampleReports();

  return {
    rubricVersion: rubric.version,
    rubric: rubric.items.map((item) => ({ id: item.id, name: item.name, weight: item.weight })),
    reports: reports.map((report) => {
      const state = getResultState(report.id);

      /** 金标准逐项档位（rubricItemId → level），教师标注的基准 */
      const goldLevels: EvalMetricsInput['reports'][number]['goldLevels'] = {};
      for (const item of report.expectedItemScores) {
        goldLevels[item.rubricItemId] = item.level;
      }

      /** AI 逐项档位与置信度；结果不可用时为空对象（不伪造任何档位） */
      const aiItems: EvalMetricsInput['reports'][number]['aiItems'] = {};
      let aiTotalScore: number | null = null;
      if (state.status === 'ok') {
        aiTotalScore = state.data.totalScore;
        for (const score of state.data.scores) {
          aiItems[score.rubricItemId] = { level: score.level, confidence: score.confidence };
        }
      }

      return {
        reportId: report.id,
        title: report.title,
        tier: report.tier,
        goldTotalScore: report.goldTotalScore,
        aiTotalScore,
        resultStatus: state.status,
        goldLevels,
        aiItems,
      };
    }),
  };
}

export default function EvalPage() {
  const input = buildInput();

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
            总分 MAE、逐项档位命中率、档位一致率、置信度校准（ECE），以及难度档位与分数区间分布。
            本页是「AI 评得准不准」的直接答案，也是评阅结果信任度的量化依据。
          </p>
          <Note summary="这些数字是在浏览器里现算的" className="mt-2">
            页面上所有指标均由<strong className="font-semibold text-foreground">浏览器在运行时</strong>
            从原始数据现算 —— 原始输入（金标准档位、AI 档位与置信度、rubric 权重）随页面一同下发，
            计算只依赖可查看的纯函数，故任何人可在控制台复算或自行核对。
          </Note>
        </section>

        <EvalDashboard input={input} />
      </main>

      <SiteFooter />
    </>
  );
}
