/**
 * AutoGrader · 溯源信息块（Server Component）
 * ---------------------------------------------------------------------------
 * 固定展示 ReviewProvenance 的五项审计信息，回答「谁、何时、基于哪次对话、
 * 用哪版契约产出，以及结果是否被改动过」。报告详情页与 /trace 溯源页复用。
 *
 * 数据缺失（尚未产出评阅结果）时不隐藏区块，而是显示占位，明确告知教师
 * 这些字段将在结果产出后被填充。
 */

import { Bot, Clock, Fingerprint, GitBranch, ScrollText, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewProvenance } from '@/lib/schema';
import { cn, formatDateTime } from '@/lib/utils';

export interface ProvenanceBlockProps {
  provenance: ReviewProvenance | null;
  /** 来源文件名，便于教师定位仓库中的资产 */
  fileName?: string;
  /** 顶部补充说明 */
  hint?: string;
  className?: string;
}

interface FieldRowProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  mono?: boolean;
}

function FieldRow({ icon, label, value, mono = false }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex w-40 shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn('min-w-0 flex-1 text-sm break-all', mono && 'font-mono text-[13px]')}>{value}</div>
    </div>
  );
}

export function ProvenanceBlock({ provenance, fileName, hint, className }: ProvenanceBlockProps) {
  const hasData = provenance !== null;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b border-border bg-secondary/40">
        <div className="flex flex-wrap items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <CardTitle>溯源信息 · ReviewProvenance</CardTitle>
          {hasData ? (
            <Badge variant="success">已固化</Badge>
          ) : (
            <Badge variant="muted">待生成</Badge>
          )}
          {fileName === undefined ? null : (
            <code className="ml-auto rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {fileName}
            </code>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          本结果可回溯至具体对话轮次：评审可据此翻到 LearnBuddy 中对应的那次对话，
          查看报告原文、五 Agent 的中间推理与最终 JSON 的完整生成过程。
        </p>
        {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>

      <CardContent className="pt-1">
        <FieldRow
          icon={<Bot className="h-3.5 w-3.5" />}
          label="生成智能体"
          mono
          value={hasData ? provenance.generatorAgent : <span className="text-muted-foreground">待生成</span>}
        />
        <FieldRow
          icon={<Clock className="h-3.5 w-3.5" />}
          label="生成时间"
          value={
            hasData ? (
              <span className="tabular-nums">{formatDateTime(provenance.generatedAt)}</span>
            ) : (
              <span className="text-muted-foreground">待生成</span>
            )
          }
        />
        <FieldRow
          icon={<GitBranch className="h-3.5 w-3.5" />}
          label="来源对话标识"
          mono
          value={
            hasData ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>{provenance.sourceConversationId}</span>
                {provenance.sourceTurnId === undefined ? (
                  <Badge variant="warning">未提供轮次 id</Badge>
                ) : (
                  <Badge variant="info">轮次 {provenance.sourceTurnId}</Badge>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">待生成</span>
            )
          }
        />
        <FieldRow
          icon={<Fingerprint className="h-3.5 w-3.5" />}
          label="结果指纹"
          mono
          value={
            hasData ? (
              provenance.resultFingerprint
            ) : (
              <span className="text-muted-foreground">待生成</span>
            )
          }
        />
        <FieldRow
          icon={<TriangleAlert className="h-3.5 w-3.5" />}
          label="契约版本"
          value={
            hasData ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px]">schema {provenance.schemaVersion}</span>
                <span className="text-xs text-muted-foreground">
                  指纹由「字典序递归排序键 → 无空格 JSON → SHA-256」计算，任一处改动都会导致复算不一致
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                结果产出后此块将显示 schema 版本与结果指纹，用于判断资产是否被改动
              </span>
            )
          }
        />
      </CardContent>
    </Card>
  );
}
