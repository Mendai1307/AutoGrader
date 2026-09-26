/**
 * AutoGrader · 客观核查面板（Server Component）
 * ---------------------------------------------------------------------------
 * 把 web/lib/inspectors/ 的确定性核查结果渲染成可核验的事实清单：
 *   ① 章节完整性   ② 代码块与语言分布 + 关键 API 命中
 *   ③ 统计量（字数 / 行数 / 图片数）   ④ 图表引用核查
 *   ⑤ findings 结论列表（错误 / 注意 / 通过，以符号与灰阶分级，不用红绿）
 *   ⑥ 该报告与其余报告中最相似的一对（SimHash，构建期统一算一次）
 *
 * 全部数值均由构建期纯函数计算后随静态产物固化，运行时不做任何计算、不发任何请求。
 * 措辞刻意保持「只陈述机器可确切判定的事实」：不判断代码是否正确、不评价论证是否充分、
 * 不给出抄袭结论。
 */

import Link from 'next/link';
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheckBig,
  ImageOff,
  Info,
  ListTree,
  SearchCheck,
  SquareCode,
  TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Note } from '@/components/note';
import { Progress } from '@/components/ui/progress';
import {
  countFindingsByLevel,
  languageLabel,
  referenceModeLabel,
  type InspectionLevel,
  type InspectionReport,
  type SimilarityGrade,
  type SimilarityPair,
} from '@/lib/inspectors';
import { cn, formatNumber, formatScore, truncate } from '@/lib/utils';

/* ==========================================================================
 * 展示用配色（仅视觉，不影响核查口径）
 * ---------------------------------------------------------------------------
 * 色彩纪律：**单强调色 + 灰阶**，不引入红/绿/蓝第二色系。
 * 「错误 / 注意 / 通过」的强弱由三条正交手段表达：
 *   ① 符号：× / ※ / ●   ② 线性：实线深边 / 虚线 / 浅强调边   ③ 灰阶深浅
 * 这样在黑白打印、色觉障碍、低质量投屏下都仍然可辨。
 * ========================================================================== */

const LEVEL_META: Readonly<
  Record<InspectionLevel, { label: string; symbol: string; chip: string; icon: typeof Info }>
> = {
  error: {
    label: '错误',
    symbol: '×',
    chip: 'border-foreground/70 bg-secondary text-foreground',
    icon: CircleAlert,
  },
  warn: {
    label: '注意',
    symbol: '※',
    chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
    icon: TriangleAlert,
  },
  info: {
    label: '通过',
    symbol: '●',
    chip: 'border-primary/45 bg-primary/5 text-foreground',
    icon: CircleCheckBig,
  },
};

const GRADE_META: Readonly<
  Record<SimilarityGrade, { label: string; symbol: string; chip: string; bar: string }>
> = {
  duplicate: {
    label: '高度疑似重复',
    symbol: '×',
    chip: 'border-foreground/70 bg-secondary text-foreground',
    bar: 'bg-foreground',
  },
  suspicious: {
    label: '需人工复核',
    symbol: '※',
    chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
    bar: 'bg-foreground/40',
  },
  distinct: {
    label: '正常区分',
    symbol: '●',
    chip: 'border-primary/45 bg-primary/5 text-foreground',
    bar: 'bg-foreground/25',
  },
};

/** 人工复核阈值：与 lib/inspectors/similarity.ts 的 SIMILARITY_SUSPICIOUS_THRESHOLD 一致 */
const REVIEW_THRESHOLD = 0.8;

export interface InspectionPanelProps {
  /** 该报告的构建期核查结果 */
  inspection: InspectionReport;
  /** 该报告与其余报告中最相似的一对；样本不足时为 null */
  topSimilarity: SimilarityPair | null;
  /** 参与相似度比对的其余报告数（用于文案「与其余 N 份」） */
  peerCount: number;
  className?: string;
}

/** 小节标题 */
function SectionTitle({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint === undefined ? null : <span className="text-[11px] text-muted-foreground">{hint}</span>}
      {children === undefined ? null : <span className="ml-auto flex flex-wrap items-center gap-1.5">{children}</span>}
    </div>
  );
}

export function InspectionPanel({ inspection, topSimilarity, peerCount, className }: InspectionPanelProps) {
  const { chapters, codes, stats, figures, findings } = inspection;
  const levelCounts = countFindingsByLevel(findings);

  const counterpartId =
    topSimilarity === null ? null : topSimilarity.a === inspection.reportId ? topSimilarity.b : topSimilarity.a;
  const unreferenced = figures.figures.filter((figure) => !figure.referenced);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b border-border bg-secondary/40">
        <div className="flex flex-wrap items-center gap-2">
          <SearchCheck className="h-4 w-4 text-primary" />
          <CardTitle>客观核查 · Deterministic Inspection</CardTitle>
          <Badge variant="outline">非 AI · 构建期计算</Badge>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Badge className={LEVEL_META.error.chip}>
              <span aria-hidden>{LEVEL_META.error.symbol}</span>错误 {levelCounts.error}
            </Badge>
            <Badge className={LEVEL_META.warn.chip}>
              <span aria-hidden>{LEVEL_META.warn.symbol}</span>注意 {levelCounts.warn}
            </Badge>
            <Badge className={LEVEL_META.info.chip}>
              <span aria-hidden>{LEVEL_META.info.symbol}</span>通过 {levelCounts.info}
            </Badge>
          </span>
        </div>
        <Note summary="核查数据的来源与边界" className="mt-2">
          <p>
            由 <code className="font-mono">web/lib/inspectors/</code> 的纯函数核查器在
            <span className="font-medium text-foreground">构建期</span>对报告 Markdown 原文计算得出，随静态产物固化；
            运行时零 AI 调用、零网络请求、零后端。
          </p>
          <p>
            核查器只陈述机器可确切判定的事实——章节、代码、统计量、图表引用、查重指纹，
            <span className="font-medium text-foreground">
              不判断代码是否正确、不评价论证是否充分、不给出抄袭结论
            </span>
            。
          </p>
        </Note>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {/* ==================== ① 统计量速览 ==================== */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-base font-semibold tabular-nums">{formatNumber(stats.wordCount)}</div>
            <div className="text-[11px] text-muted-foreground">
              正文字数（汉字 {formatNumber(stats.cjkChars)} + 英文 {formatNumber(stats.englishWords)}）
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-base font-semibold tabular-nums">
              {formatNumber(stats.totalLines)}
              <span className="text-xs font-normal text-muted-foreground"> / 非空 {formatNumber(stats.nonEmptyLines)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">全文行数</div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-base font-semibold tabular-nums">
              {codes.blockCount}
              <span className="text-xs font-normal text-muted-foreground"> / {formatNumber(codes.codeLines)} 行</span>
            </div>
            <div className="text-[11px] text-muted-foreground">代码块 / 代码正文行数</div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-base font-semibold tabular-nums">
              {stats.imageRefs}
              <span className="text-xs font-normal text-muted-foreground">
                {' '}
                / 未引用 {figures.unreferencedCount}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">图片引用 / 未被正文引用</div>
          </div>
        </div>

        {/* ==================== ② 章节完整性 ==================== */}
        <div className="space-y-2.5 border-t border-border pt-4">
          <SectionTitle
            icon={<ListTree className="h-4 w-4" />}
            title="章节完整性"
            hint="按七个必备章节的别名表匹配标题行，未命中时对疑似伪标题的短行做关键词回退"
          >
            <Badge className={chapters.missingCount === 0 ? LEVEL_META.info.chip : LEVEL_META.warn.chip}>
              命中 {chapters.found} / {chapters.required}
            </Badge>
          </SectionTitle>

          <Progress
            value={chapters.found}
            max={chapters.required}
            barClassName={chapters.missingCount === 0 ? 'bg-foreground' : 'bg-rule'}
            label={`必备章节命中 ${chapters.found} / ${chapters.required}`}
          />

          <ul className="grid gap-1.5 sm:grid-cols-2">
            {chapters.items.map((item) => (
              <li
                key={item.key}
                className={cn(
                  'flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-[12px]',
                  item.present ? 'border-border' : 'border-dashed border-rule bg-transparent',
                )}
              >
                {item.present ? (
                  <CircleCheckBig className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-foreground" />
                ) : (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                )}
                <span className="shrink-0 font-medium">{item.label}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {item.present
                    ? `第 ${item.line ?? 0} 行「${item.source ?? ''}」· ${item.matchedBy === 'heading' ? '标题匹配' : '关键词回退'}`
                    : '未检出'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ==================== ③ 代码与关键 API ==================== */}
        <div className="space-y-2.5 border-t border-border pt-4">
          <SectionTitle
            icon={<SquareCode className="h-4 w-4" />}
            title="代码块与关键 API 命中"
            hint="关键词仅在围栏代码块内做词边界匹配，代码以截图给出时无法命中"
          >
            <Badge variant="outline">
              {codes.blockCount} 块 · {formatNumber(codes.codeLines)} 行
            </Badge>
            <Badge className={codes.hitCount === 0 ? LEVEL_META.warn.chip : LEVEL_META.info.chip}>
              命中 {codes.hitCount} 类 / {codes.hitOccurrences} 次
            </Badge>
          </SectionTitle>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">语言分布：</span>
            {codes.languages.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">无代码块</span>
            ) : (
              codes.languages.map((language) => (
                <Badge key={language.languageKey} variant="secondary" className="font-mono text-[11px]">
                  {languageLabel(language.languageKey)} · {language.blocks} 块 / {language.lines} 行
                </Badge>
              ))
            )}
            {codes.untaggedBlockCount === 0 ? null : (
              <Badge className={LEVEL_META.warn.chip}>
                <span aria-hidden>{LEVEL_META.warn.symbol}</span>
                {codes.untaggedBlockCount} 块未标注语言
              </Badge>
            )}
            {codes.unclosedBlockCount === 0 ? null : (
              <Badge className={LEVEL_META.warn.chip}>
                <span aria-hidden>{LEVEL_META.warn.symbol}</span>
                {codes.unclosedBlockCount} 块围栏未闭合
              </Badge>
            )}
          </div>

          {codes.hits.length === 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-dashed border-rule p-2.5 text-[12px] leading-relaxed text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              代码块内未命中任何关键 API / 算法关键词（词表覆盖进程线程同步、Socket 网络编程、排序算法三个主题）。
              正文中出现相关接口名并不计入命中——核查口径只看代码块内是否真的调用了。
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {codes.hits.map((hit) => (
                <li
                  key={`${hit.topic}-${hit.keyword}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] leading-relaxed"
                >
                  <span className="font-mono font-medium">{hit.keyword}</span>
                  <span className="text-muted-foreground"> ×{hit.occurrences}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {hit.label} · 块 {hit.blocks.join(',')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ==================== ④ 图表引用核查 ==================== */}
        <div className="space-y-2.5 border-t border-border pt-4">
          <SectionTitle
            icon={<ImageOff className="h-4 w-4" />}
            title="图表引用核查"
            hint="正文出现该图图号或「如图」「见下图」等泛指措辞即视为已引用"
          >
            <Badge variant="outline">
              共 {figures.count} 张 · 已引用 {figures.referencedCount} · 未引用 {figures.unreferencedCount}
            </Badge>
            {figures.unnumberedCount === 0 ? null : (
              <Badge className={LEVEL_META.warn.chip}>
                <span aria-hidden>{LEVEL_META.warn.symbol}</span>
                {figures.unnumberedCount} 张缺图号
              </Badge>
            )}
            {figures.uncaptionedCount === 0 ? null : (
              <Badge className={LEVEL_META.warn.chip}>
                <span aria-hidden>{LEVEL_META.warn.symbol}</span>
                {figures.uncaptionedCount} 张缺题注
              </Badge>
            )}
          </SectionTitle>

          {unreferenced.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              {figures.count === 0 ? '全文未出现 Markdown 图片引用。' : '全部图片均已被正文引用。'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {unreferenced.map((figure) => (
                <li
                  key={`${figure.index}-${figure.line}`}
                  className="flex flex-wrap items-baseline gap-2 rounded-md border border-dashed border-rule px-2.5 py-1.5 text-[12px]"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">第 {figure.line} 行</span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {figure.alt === '' ? '（无题注）' : truncate(figure.alt, 60)}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {figure.numberLabel ?? '无图号'}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{referenceModeLabel(figure.referenceMode)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ==================== ⑤ findings 列表 ==================== */}
        <div className="space-y-2.5 border-t border-border pt-4">
          <SectionTitle
            icon={<CircleAlert className="h-4 w-4" />}
            title={`核查结论（${findings.length} 条）`}
            hint="按「核查类别 → 结论 id」确定性排序"
          >
            <Badge variant="outline">错误 {levelCounts.error}</Badge>
            <Badge variant="outline">注意 {levelCounts.warn}</Badge>
            <Badge variant="outline">通过 {levelCounts.info}</Badge>
          </SectionTitle>

          <ul className="space-y-2">
            {findings.map((finding) => {
              const meta = LEVEL_META[finding.level];
              const Icon = meta.icon;
              return (
                <li key={finding.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={meta.chip}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{finding.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{finding.id}</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{finding.detail}</p>
                  {finding.evidence === undefined || finding.evidence === '' ? null : (
                    <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                      证据：{truncate(finding.evidence, 240)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ==================== ⑥ 相似度（该份 vs 其余） ==================== */}
        <div className="space-y-2.5 border-t border-border pt-4">
          <SectionTitle
            icon={<SearchCheck className="h-4 w-4" />}
            title="查重指纹（SimHash）"
            hint={`自实现 64 位 SimHash（两路 FNV-1a + 中文 2-gram），与其余 ${peerCount} 份两两比对`}
          />

          {topSimilarity === null || counterpartId === null ? (
            <p className="text-[12px] text-muted-foreground">
              暂无可比对的报告（需要至少两份能读到原文的报告）。
            </p>
          ) : (
            <div className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]">{inspection.reportId}</span>
                <span className="text-muted-foreground">与</span>
                <Link
                  href={`/report/${counterpartId}`}
                  className="inline-flex items-center gap-1 font-mono text-[12px] font-medium text-primary hover:underline"
                >
                  {counterpartId}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
                <Badge className={GRADE_META[topSimilarity.grade].chip}>{GRADE_META[topSimilarity.grade].label}</Badge>
                <span className="ml-auto text-[13px] font-semibold tabular-nums">
                  {formatScore(topSimilarity.similarity * 100)}%
                </span>
              </div>

              <Progress
                className="mt-2.5"
                value={topSimilarity.similarity * 100}
                max={100}
                barClassName={GRADE_META[topSimilarity.grade].bar}
                label={`与 ${counterpartId} 的相似度`}
              />

              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                相似度 = 1 − 汉明距离 / 64，本对汉明距离 {topSimilarity.distance} 位，即
                <span className="font-mono font-medium text-foreground"> {topSimilarity.similarity}</span>。
                这是该份报告与其余 {peerCount} 份中最高的一对。
              </p>
            </div>
          )}

          <p className="flex items-start gap-2 rounded-md border border-dashed border-rule p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold">相似度高于 {REVIEW_THRESHOLD.toFixed(2)} 需人工复核。</span>
              该阈值仅表示「文本指纹接近、值得人工核对」，同主题同实验的报告天然会落在这一区间，
              <span className="font-semibold">不构成任何抄袭结论</span>，最终判断须由教师结合原创性评分点完成。
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
