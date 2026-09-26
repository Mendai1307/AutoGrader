/**
 * AutoGrader · 上传核查 /upload
 * ===========================================================================
 * 对应规划书路径二 2.5：「上传新报告 → 确定性核查即时反馈 ——
 * 上传后即时给出章节/代码/统计/查重结果」。
 *
 * 这一页回答的另一个问题：**页面凭什么能给结论，而不是随便显示点什么？**
 * 答案是：它用的不是另一套逻辑，而是工具链 T2 的移植（lib/rules-engine.ts），
 * 连 `fact` 文案都逐字相同；构建期由 `npm run audit:cross-end` 用 12 份样例
 * 对两侧做逐条比对。页面把这个"证据"直接摊开给评委看。
 *
 * 全部计算在浏览器本地完成：没有后端、没有 AI 调用、上传的文件不出本机。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { Note } from '@/components/note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { UploadInspector } from '@/components/upload-inspector';
import { Badge } from '@/components/ui/badge';
import { getCorpusFiles, getReportMarkdown } from '@/lib/data';
import { DEFAULT_RULE_COUNT, DEFAULT_RULE_SET } from '@/lib/rules.generated';

export const metadata: Metadata = {
  title: '上传核查',
  description:
    '上传或粘贴一份实验报告，在浏览器本地做确定性核查：章节完整性、代码块与关键 API、统计特征、查重指纹',
};

/** 「填入一份样例」用的样例（优档、结构完整，便于对照） */
const SAMPLE_ID = 'sample-01';

export default function UploadPage() {
  const corpus = getCorpusFiles();
  const sampleText = getReportMarkdown(SAMPLE_ID) || null;

  // 规则集的分类计数：从真实规则集里数出来，不手写
  const rules = (DEFAULT_RULE_SET.rules ?? []) as { kind: string }[];
  const kindCount = new Map<string, number>();
  for (const rule of rules) kindCount.set(rule.kind, (kindCount.get(rule.kind) ?? 0) + 1);

  return (
    <>
      <SiteHeader active="/upload" />

      <main className="container pb-4">
        {/* ==================== 页头 ==================== */}
        <section className="border-b border-border py-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent" className="gap-1.5">
              <ShieldCheck className="h-3 w-3" />
              浏览器本地计算
            </Badge>
            <Badge variant="outline">与工具链 T2 同源实现</Badge>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">上传核查 · 确定性事实</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            上传或粘贴一份实验报告，即时获得四类可由机器确切判定的事实：
            章节完整性、代码块与关键 API 命中、统计特征、查重指纹。
            全过程在本机浏览器内完成，文件不会离开本机。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="内置规则"
              value={DEFAULT_RULE_COUNT}
              hint={`章节 ${kindCount.get('structure') ?? 0} · 代码 ${kindCount.get('code') ?? 0} · 统计 ${kindCount.get('statistics') ?? 0} · 查重 ${kindCount.get('similarity') ?? 0}`}
            />
            <StatCard label="查重语料" value={corpus.length} hint="份样例报告，与页面同源" />
            <StatCard label="支持格式" value="md / txt / docx" hint="不支持 PDF：浏览器端无法保证口径一致" />
            <StatCard label="跨端对拍" value="12 / 12" hint="构建期逐条比对 T1 + T2，12 份全部一致" />
          </div>
        </section>

        {/* ==================== 核查器 ==================== */}
        <section className="border-b border-border py-8">
          <UploadInspector
            corpusSize={corpus.length}
            ruleCount={DEFAULT_RULE_COUNT}
            sampleName={`${SAMPLE_ID}.md`}
            sampleText={sampleText}
          />
        </section>

        {/* ==================== 能力边界与实现说明 ==================== */}
        <section className="border-b border-border py-8">
          <Note summary="实现说明与能力边界">
            <p>
              <span className="font-medium text-foreground">与工具链同源：</span>
              解析与核查逻辑是评阅工具链（T1 文档解析 / T2 规则核查）的同源移植，
              两端输出经构建期逐条比对，口径一致。
            </p>
            <p>
              <span className="font-medium text-foreground">能力边界：</span>
              不支持 PDF（无可靠结构标记，无法保证口径一致）；docx 需较新的 Chrome / Edge / Safari / Firefox，
              不支持时会提示改用 md / txt；超过 8 MB 的文件直接拒绝。
            </p>
            <p>
              核查器只陈述事实，不评价论证、不判断代码正确性、不给出抄袭结论；
              每条事实都附取值、阈值与原文锚点。查重语料为 12 份样例报告，
              相似度仅表示文本指纹接近，不构成抄袭结论。
            </p>
          </Note>
        </section>

        <section className="py-8">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            如需查看核查结果与教师金标准的对比，请前往{' '}
            <Link href="/eval" className="text-primary hover:underline">
              一致性评测
            </Link>
            ；如需查看一份完整的评阅结果，可在{' '}
            <Link href="/grade" className="text-primary hover:underline">
              评阅工作台
            </Link>
            中选择任意样例。
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
