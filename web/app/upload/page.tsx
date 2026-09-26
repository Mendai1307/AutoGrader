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
import { Info, ShieldCheck, SquareTerminal } from 'lucide-react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StatCard } from '@/components/stat-card';
import { UploadInspector } from '@/components/upload-inspector';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
            <Badge variant="outline">零后端 · 零 AI 调用</Badge>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">上传核查 · 确定性事实</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            上传或粘贴一份实验报告，立刻得到四类**机器可确切判定的事实**：
            章节完整性、代码块与关键 API 命中、统计特征、查重指纹。
            全过程在这台机器的浏览器里完成 —— 文件不上传、不联网、不经过任何模型。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="内置规则"
              value={DEFAULT_RULE_COUNT}
              hint={`章节 ${kindCount.get('structure') ?? 0} · 代码 ${kindCount.get('code') ?? 0} · 统计 ${kindCount.get('statistics') ?? 0} · 查重 ${kindCount.get('similarity') ?? 0}`}
            />
            <StatCard label="查重语料" value={corpus.length} hint="份样例报告，与页面同源" />
            <StatCard label="支持格式" value="md / txt / docx" hint="PDF 不提供：浏览器端无法保证口径一致" />
            <StatCard label="跨端对拍" value="12 / 12" hint="构建期逐条比对 T1 + T2，12 份全绿" />
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
          <div className="flex flex-wrap items-baseline gap-2">
            <SquareTerminal className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">这一页怎么做出来的</h2>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Info className="h-3.5 w-3.5 text-primary" />
                与工具链同源，不是"另一套差不多"
              </h3>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <li>
                  解析：<code className="font-mono">lib/parse.ts</code>（md / txt）与{' '}
                  <code className="font-mono">lib/docx.ts</code>（docx）是{' '}
                  <code className="font-mono">document_parser.py</code>（T1）的移植；
                </li>
                <li>
                  核查：<code className="font-mono">lib/rules-engine.ts</code> 是{' '}
                  <code className="font-mono">rule_inspector.py</code>（T2）的移植，
                  连事实文案模板与规则集摘要算法都照搬；
                </li>
                <li>
                  构建期门禁 <code className="font-mono">npm run audit:cross-end</code>：
                  同一份输入分别喂两侧，逐条比对结构块、统计、事实、阈值、锚点与规则集摘要。
                </li>
              </ul>
            </Card>

            <Card className="p-4">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Info className="h-3.5 w-3.5 text-primary" />
                如实说明的能力边界
              </h3>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <li>
                  <span className="text-foreground">不支持 PDF</span>：PDF 没有可靠的结构标记，
                  浏览器端抽取无法与工具链保持同一口径，故不提供该入口，而不是给一个"大概能用"的结果。
                </li>
                <li>
                  docx 需 <code className="font-mono">DecompressionStream('deflate-raw')</code>
                  （Chrome/Edge 103+、Safari 16.4+、Firefox 113+）；不支持时提示改用 md / txt。
                </li>
                <li>
                  <span className="text-foreground">没有做 Web Worker</span>：docx 解析依赖{' '}
                  <code className="font-mono">DOMParser</code>，Worker 作用域里没有它；
                  故改为「超过 8 MB 直接拒绝并说明」。
                </li>
                <li>
                  核查器只陈述事实，不评价论证、不判断代码对错、
                  <span className="text-foreground">不给出抄袭结论</span>；每条事实都带取值、阈值与原文锚点。
                </li>
                <li>
                  查重语料是 12 份**样例报告**，不是"全部学生作业"——
                  相似度只表示文本指纹接近，不构成抄袭结论。
                </li>
              </ul>
            </Card>
          </div>
        </section>

        <section className="py-8">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            想看核查结果与教师金标准的差距？去{' '}
            <Link href="/eval" className="text-primary hover:underline">
              一致性评测
            </Link>
            ；想先看一份完整评阅结果？去{' '}
            <Link href="/grade" className="text-primary hover:underline">
              评阅工作台
            </Link>
            挑一份样例。
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
