/**
 * AutoGrader · 金标准 vs AI 对比图（零依赖 SVG）
 * ---------------------------------------------------------------------------
 * 回答的问题：**每一份报告上，AI 与教师的差距有多大、是偏高还是偏低？**
 *
 * 形态选「哑铃图」而不是分组柱：柱状图要看两条柱的高矮差，哑铃图直接**把差距画成一段线**，
 * 12 份报告竖排后，线段的长度差异一眼可比 —— 差距本身就是图形元素，不需要读者做减法。
 *
 * 视觉纪律：两个点靠**实心 / 空心**区分（形），不靠颜色；连线用强调细线。
 *
 * 纯函数组件，Server / Client 两侧都能渲染。
 */

import { cn } from '@/lib/utils';

export interface ComparisonRow {
  reportId: string;
  /** 教师金标准分 */
  gold: number;
  /** AI 加权总分；未产出结果为 null */
  ai: number | null;
}

export interface ScoreComparisonChartProps {
  rows: readonly ComparisonRow[];
  /** 分量程上界（默认 100） */
  max?: number;
  className?: string;
}

const W = 680;
const ROW_H = 26;
const PAD_TOP = 40;
const PAD_BOTTOM = 34;
const PLOT_X = 108;
const PLOT_W = 388;
const ID_X = 96;
const GOLD_X = PLOT_X + PLOT_W + 34;
const AI_X = PLOT_X + PLOT_W + 92;

export function ScoreComparisonChart({ rows, max = 100, className }: ScoreComparisonChartProps) {
  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
  const scale = (value: number) => PLOT_X + (Math.max(0, Math.min(max, value)) / max) * PLOT_W;

  const ticks = [0, 25, 50, 75, 100].filter((tick) => tick <= max);

  return (
    <div className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full text-foreground"
        role="img"
        aria-label="逐份教师金标准分与 AI 加权总分对比"
      >
        <title>逐份教师金标准分与 AI 加权总分的对比（哑铃图）</title>

        {/* 刻度竖线 + 顶端刻度数字：给整张图一个可读的量尺 */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={scale(tick)}
              y1={PAD_TOP - 12}
              x2={scale(tick)}
              y2={PAD_TOP + rows.length * ROW_H}
              stroke="currentColor"
              strokeOpacity={tick === 0 || tick === max ? 0.35 : 0.12}
              strokeDasharray={tick === 0 || tick === max ? undefined : '2 3'}
            />
            <text
              x={scale(tick)}
              y={PAD_TOP - 18}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* 列名 */}
        <text x={ID_X} y={PAD_TOP - 18} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="end">
          报告
        </text>
        <text x={GOLD_X} y={PAD_TOP - 18} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="end">
          金标准
        </text>
        <text x={AI_X} y={PAD_TOP - 18} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="end">
          AI
        </text>

        {rows.map((row, index) => {
          const y = PAD_TOP + index * ROW_H + ROW_H / 2;
          const goldX = scale(row.gold);
          const aiX = row.ai === null ? null : scale(row.ai);

          return (
            <g key={row.reportId}>
              <text
                x={ID_X}
                y={y + 3.5}
                fontSize={11}
                fill="currentColor"
                fillOpacity={0.75}
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {row.reportId}
              </text>

              {/* 连线 = 差距本身。两端点之间的一段，就是需要解释的那段距离 */}
              {aiX === null ? null : (
                <line
                  x1={Math.min(goldX, aiX)}
                  y1={y}
                  x2={Math.max(goldX, aiX)}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.55}
                  strokeWidth={2}
                />
              )}

              {/* 金标准：空心圆（基准） */}
              <circle cx={goldX} cy={y} r={4.5} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.8} />

              {/* AI：实心圆；未产出结果时只在轨道上留一个极浅的记号，不画点 */}
              {aiX === null ? (
                <g>
                  <line x1={PLOT_X} y1={y} x2={PLOT_X + PLOT_W} y2={y} stroke="currentColor" strokeOpacity={0.07} />
                  <text x={AI_X} y={y + 3.5} fontSize={10} fill="currentColor" fillOpacity={0.45} textAnchor="end">
                    待生成
                  </text>
                </g>
              ) : (
                <circle cx={aiX} cy={y} r={4.5} fill="currentColor" fillOpacity={0.85} />
              )}

              <text
                x={GOLD_X}
                y={y + 3.5}
                fontSize={11}
                fill="currentColor"
                fillOpacity={0.7}
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {row.gold.toFixed(0)}
              </text>
              {aiX === null ? null : (
                <text
                  x={AI_X}
                  y={y + 3.5}
                  fontSize={11}
                  fontWeight={600}
                  fill="currentColor"
                  fillOpacity={0.9}
                  textAnchor="end"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {row.ai?.toFixed(0)}
                </text>
              )}
            </g>
          );
        })}

        {/* 图例：说明"空心 / 实心"这两个形状的含义 */}
        <g transform={`translate(${PLOT_X}, ${height - 14})`}>
          <circle cx={5} cy={-3} r={4.5} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.8} />
          <text x={16} y={0} fontSize={10} fill="currentColor" fillOpacity={0.6}>
            教师金标准分
          </text>
          <circle cx={128} cy={-3} r={4.5} fill="currentColor" fillOpacity={0.85} />
          <text x={139} y={0} fontSize={10} fill="currentColor" fillOpacity={0.6}>
            AI 加权总分
          </text>
          <line x1={252} y1={-3} x2={276} y2={-3} stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
          <text x={282} y={0} fontSize={10} fill="currentColor" fillOpacity={0.6}>
            两者差距（线段越长差距越大）
          </text>
        </g>
      </svg>
    </div>
  );
}
