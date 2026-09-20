/**
 * AutoGrader · 单项评分明细卡（Server Component）
 * ---------------------------------------------------------------------------
 * 渲染一个 ScoreItem 的完整判定过程：档位、得分、扣分理由、证据引用原文、
 * 置信度与复核结论。右栏逐项明细与 /eval 的逐项命中率共用同一套展示语义。
 */

import { CircleAlert, CircleHelp, Quote, SearchCheck, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { EVIDENCE_KIND_META, LEVEL_META } from '@/lib/constants';
import {
  gradeConfidence,
  type Evidence,
  type EvidenceLocation,
  type ReviewAdjustment,
  type RubricItem,
  type ScoreItem,
} from '@/lib/schema';
import { cn, formatConfidence, formatRatio, formatScore } from '@/lib/utils';

const CONFIDENCE_CHIP = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-rose-200 bg-rose-50 text-rose-700',
} as const;

/** 把 Evidence.location 渲染成可读定位串 */
export function formatEvidenceLocation(location: EvidenceLocation): string {
  const parts: string[] = [];
  if (location.section !== undefined) parts.push(location.section);
  if (location.figureNo !== undefined) parts.push(location.figureNo);
  if (location.tableNo !== undefined) parts.push(location.tableNo);
  if (location.lineStart !== undefined) {
    parts.push(
      location.lineEnd !== undefined && location.lineEnd !== location.lineStart
        ? `原文 L${location.lineStart}–L${location.lineEnd}`
        : `原文 L${location.lineStart}`,
    );
  }
  return parts.length === 0 ? '未标注位置' : parts.join(' · ');
}

function EvidenceItem({ evidence }: { evidence: Evidence }) {
  const grade = gradeConfidence(evidence.confidence);
  return (
    <li className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">{EVIDENCE_KIND_META[evidence.kind]}</Badge>
        <span className="font-mono">{evidence.id}</span>
        <span>{formatEvidenceLocation(evidence.location)}</span>
        <Badge className={cn('ml-auto', CONFIDENCE_CHIP[grade])}>证据置信度 {formatRatio(evidence.confidence)}</Badge>
      </div>
      <blockquote className="mt-2 flex gap-2 border-l-2 border-primary/40 pl-3 text-[13px] leading-relaxed text-foreground/90">
        <Quote className="mt-1 h-3.5 w-3.5 shrink-0 text-primary/50" />
        <span>{evidence.quote}</span>
      </blockquote>
      {evidence.note === undefined ? null : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">备注：{evidence.note}</p>
      )}
    </li>
  );
}

export interface ScoreItemCardProps {
  item: ScoreItem;
  /** rubric 中的评分点定义（用于展示证据要求与档位标准），结果未内嵌 rubric 时可为 undefined */
  rubricItem?: RubricItem;
  /** 该项对应的复核记录 */
  adjustment?: ReviewAdjustment;
}

export function ScoreItemCard({ item, rubricItem, adjustment }: ScoreItemCardProps) {
  const level = LEVEL_META[item.level];
  const grade = gradeConfidence(item.confidence);
  const scored = item.score >= item.maxScore;

  // 复核后仍低于 0.60：按契约必须显著标注「待教师人工确认」
  const confidenceAfterReview = adjustment?.confidenceAfter ?? item.confidence;
  const needsManualConfirm = confidenceAfterReview < 0.6;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-2 border-b border-border bg-secondary/30 px-4 py-3">
        <span className="flex h-6 items-center rounded bg-background px-1.5 font-mono text-xs font-semibold text-foreground">
          {item.rubricItemId}
        </span>
        <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug tracking-tight">{item.itemName}</h4>
        <Badge className={level.chip}>{level.label}</Badge>
        {item.needsReview ? <Badge variant="warning">已触发复核</Badge> : null}
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">得分 / 满分</div>
            <div className={cn('text-lg font-semibold tabular-nums', level.text)}>
              {formatScore(item.score)}
              <span className="text-sm font-normal text-muted-foreground"> / {formatScore(item.maxScore)}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">权重</div>
            <div className="text-sm font-medium tabular-nums">{formatScore(item.weight)}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">档位系数</div>
            <div className="text-sm font-medium tabular-nums">×{formatRatio(item.levelScoreRatio)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">本项贡献</div>
            <div className="text-sm font-medium tabular-nums">
              {formatScore(Math.round((item.score / item.maxScore) * item.weight * 100) / 100)}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">判定置信度</div>
            <Badge className={CONFIDENCE_CHIP[grade]}>
              {formatRatio(item.confidence)} · {formatConfidence(item.confidence)}
            </Badge>
          </div>
        </div>

        <Progress value={item.score} max={item.maxScore} barClassName={level.bar} label={`${item.itemName} 得分率`} />

        {item.deductionReason === null ? (
          <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[13px] leading-relaxed text-emerald-800">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {scored ? '本项满分，无扣分。' : '本项未填写扣分理由（契约要求非满分时必须说明理由）。'}
          </p>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
              <CircleAlert className="h-3.5 w-3.5" />
              扣分理由
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900">{item.deductionReason}</p>
          </div>
        )}

        {rubricItem === undefined ? null : (
          <details className="rounded-md border border-border bg-secondary/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              查看该评分点的证据要求与档位标准
            </summary>
            <div className="mt-2 space-y-2 text-[12px] leading-relaxed">
              <p>
                <span className="font-medium text-foreground">证据要求：</span>
                <span className="text-muted-foreground">{rubricItem.evidenceRequirement}</span>
              </p>
              <ul className="space-y-1">
                {rubricItem.levels.map((rubricLevel) => (
                  <li
                    key={rubricLevel.level}
                    className={cn(
                      'flex gap-2 rounded border px-2 py-1',
                      rubricLevel.level === item.level ? LEVEL_META[rubricLevel.level].chip : 'border-transparent',
                    )}
                  >
                    <span className="w-14 shrink-0 font-medium">{rubricLevel.label}</span>
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">×{rubricLevel.scoreRatio}</span>
                    <span className="min-w-0 flex-1 text-muted-foreground">{rubricLevel.criterion}</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">扣分梯度：</span>
                {rubricItem.deductionNotes}
              </p>
            </div>
          </details>
        )}

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SearchCheck className="h-3.5 w-3.5" />
            证据引用（{item.evidence.length} 条）
          </div>
          {item.evidence.length === 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-[12px] leading-relaxed text-muted-foreground">
              <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              未找到有效证据。按契约红线，此时不得编造证据，应置未达标档并说明。
            </p>
          ) : (
            <ul className="space-y-2">
              {item.evidence.map((evidence) => (
                <EvidenceItem key={evidence.id} evidence={evidence} />
              ))}
            </ul>
          )}
        </div>

        {adjustment === undefined ? null : (
          <div
            className={cn(
              'rounded-md border p-3 text-[12px] leading-relaxed',
              adjustment.changed ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-border bg-secondary/40',
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span>Reviewer 复核</span>
              <span className="font-mono tabular-nums">
                {formatRatio(adjustment.confidenceBefore)} → {formatRatio(adjustment.confidenceAfter)}
              </span>
              <Badge variant={adjustment.changed ? 'warning' : 'muted'}>
                {adjustment.changed ? '已改判' : '维持原档位'}
              </Badge>
              {adjustment.scoreBefore === null ? null : (
                <span className="font-mono tabular-nums">
                  得分 {formatScore(adjustment.scoreBefore)} → {adjustment.scoreAfter === null ? '—' : formatScore(adjustment.scoreAfter)}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-muted-foreground">{adjustment.opinion}</p>
          </div>
        )}

        {needsManualConfirm ? (
          <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-[12px] font-medium leading-relaxed text-rose-800">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            复核后置信度仍低于 0.60（{formatRatio(confidenceAfterReview)}），须在界面显著标注并建议教师人工确认。
          </p>
        ) : null}
      </div>
    </Card>
  );
}
