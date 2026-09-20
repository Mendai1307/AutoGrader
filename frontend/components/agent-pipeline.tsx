/**
 * AutoGrader · 五 Agent 流水线展示（Server Component）
 * ---------------------------------------------------------------------------
 * 横向流程：Parser → Evidence → Grader → Reviewer → Feedback。
 * 同一份定义被首页与 /trace 溯源页复用，保证「流水线顺序」在界面中只有一处来源。
 */

import { Fragment } from 'react';
import { ArrowRight, Gauge, ListTree, MessageSquareText, SearchCheck, ShieldCheck } from 'lucide-react';
import type { ComponentType } from 'react';

import { Badge } from '@/components/ui/badge';
import { AGENTS, type AgentMeta } from '@/lib/constants';
import type { AgentName } from '@/lib/schema';
import { cn } from '@/lib/utils';

const AGENT_ICONS: Readonly<Record<AgentName, ComponentType<{ className?: string }>>> = {
  parser: ListTree,
  evidence: SearchCheck,
  grader: Gauge,
  reviewer: ShieldCheck,
  feedback: MessageSquareText,
};

/** 单个 Agent 的图标 */
export function AgentIcon({ agent, className }: { agent: AgentName; className?: string }) {
  const Icon = AGENT_ICONS[agent];
  return <Icon className={cn('h-4 w-4', className)} />;
}

export interface AgentPipelineProps {
  /** 紧凑模式：仅展示序号 + 名称 + 职责，用于嵌入卡片 */
  compact?: boolean;
  className?: string;
}

function isReviewAgent(agent: AgentMeta): boolean {
  return agent.key === 'reviewer';
}

export function AgentPipeline({ compact = false, className }: AgentPipelineProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5',
        compact ? 'lg:flex-row lg:items-center' : 'lg:flex-row lg:items-stretch',
        className,
      )}
    >
      {AGENTS.map((agent, index) => (
        <Fragment key={agent.key}>
          <div
            className={cn(
              'group relative min-w-0 flex-1 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40',
              isReviewAgent(agent) && 'border-dashed',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold tabular-nums text-secondary-foreground">
                {index + 1}
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                <AgentIcon agent={agent.key} className="h-3.5 w-3.5 text-primary" />
                {agent.name}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{agent.role}</span>
            </div>

            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{agent.responsibility}</p>

            {compact ? null : (
              <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs leading-relaxed">
                <div className="flex gap-2">
                  <dt className="w-8 shrink-0 text-muted-foreground">输入</dt>
                  <dd className="min-w-0 flex-1 text-foreground/80">{agent.inputHint}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-8 shrink-0 text-muted-foreground">产出</dt>
                  <dd className="min-w-0 flex-1 text-foreground/80">{agent.outputHint}</dd>
                </div>
              </dl>
            )}

            {isReviewAgent(agent) && !compact ? (
              <Badge variant="warning" className="mt-3">
                置信度 &lt; 0.80 时自动触发
              </Badge>
            ) : null}
          </div>

          {index < AGENTS.length - 1 ? (
            <div className="flex items-center justify-center text-muted-foreground lg:w-6">
              <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
