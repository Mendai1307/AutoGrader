/**
 * AutoGrader · 偏差图（零依赖 SVG）
 * ---------------------------------------------------------------------------
 * 回答的问题：**AI 是系统性偏松还是偏严，还是只是散点误差？**
 * 逐份看「AI − 金标准」的正负与大小：向右为偏松（给分高），向左为偏严。
 *
 * 视觉纪律：不用红绿。语义靠**方向 + 深浅阶 + 中间那道 ±2 容差带**表达 ——
 * 落在带内是「同档」，带外才是「有偏差」，颜色深浅只区分程度。
 *
 * 纯函数组件（无 hook、无客户端依赖），故 Server / Client 两侧都能直接渲染。
 */

import { cn } from '@/lib/utils';

export interface DeviationRow {
  reportId: string;
  /** AI 加权总分 − 教师金标准分 */
  delta: number;
}

export interface DeviationChartProps {
  rows: readonly DeviationRow[];
  /** 容差带半径（分）；落在此带内视作同档 */
  tolerance?: number;
  className?: string;
}

/* 画布几何：左侧留给报告 id，右侧留给数值 */
const W = 680;
const ROW_H = 26;
const PAD_TOP = 34;
const PAD_BOTTOM = 26;
const AXIS_X = 360;
const PLOT_HALF = 250;
const ID_X = 92;
const VALUE_X = AXIS_X + PLOT_HALF + 66;

export function DeviationChart({ rows, tolerance = 2, className }: DeviationChartProps) {
  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;

  // 对称域：取最大绝对值向上取整到 2 的倍数，保证 0 轴居中且刻度好看
  const maxAbs = Math.max(tolerance * 2, ...rows.map((row) => Math.abs(row.delta)));
  const domain = Math.ceil(maxAbs / 2) * 2;
  const scale = (value: number) => (value / domain) * PLOT_HALF;

  const bandHalf = scale(tolerance);

  return (
    <div className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full text-foreground"
        role="img"
        aria-label="逐份评分偏差图"
      >
        <title>逐份评分偏差：AI 加权总分与教师金标准分之差</title>

        {/* ±容差带：先铺底，后续所有元素都压在它上面 */}
        <rect
          x={AXIS_X - bandHalf}
          y={PAD_TOP - 12}
          width={bandHalf * 2}
          height={rows.length * ROW_H + 12}
          fill="currentColor"
          opacity={0.05}
        />

        {/* 刻度竖线（每 domain/2 一格） */}
        {[-1, -0.5, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={AXIS_X + PLOT_HALF * ratio}
            y1={PAD_TOP - 10}
            x2={AXIS_X + PLOT_HALF * ratio}
            y2={PAD_TOP + rows.length * ROW_H}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeDasharray="2 3"
          />
        ))}

        {/* 0 轴：用强调细线，它是这张图的骨架 */}
        <line
          x1={AXIS_X}
          y1={PAD_TOP - 14}
          x2={AXIS_X}
          y2={PAD_TOP + rows.length * ROW_H}
          stroke="currentColor"
          strokeOpacity={0.45}
        />

        {/* 轴标注 */}
        <text x={AXIS_X - PLOT_HALF} y={PAD_TOP - 20} fontSize={10} fill="currentColor" fillOpacity={0.55}>
          偏严 −{domain}
        </text>
        <text x={AXIS_X} y={PAD_TOP - 20} fontSize={10} fill="currentColor" fillOpacity={0.55} textAnchor="middle">
          0
        </text>
        <text x={AXIS_X + PLOT_HALF} y={PAD_TOP - 20} fontSize={10} fill="currentColor" fillOpacity={0.55} textAnchor="end">
          偏松 +{domain}
        </text>
        <text x={ID_X} y={PAD_TOP - 20} fontSize={10} fill="currentColor" fillOpacity={0.55}>
          报告
        </text>

        {/* 逐份：报告 id + 从 0 轴伸出的条 + 数值 */}
        {rows.map((row, index) => {
          const y = PAD_TOP + index * ROW_H + ROW_H / 2;
          const endX = AXIS_X + scale(row.delta);
          const barX = Math.min(AXIS_X, endX);
          const barW = Math.max(Math.abs(endX - AXIS_X), 1.5);
          const inBand = Math.abs(row.delta) <= tolerance;

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

              <rect
                x={barX}
                y={y - 5}
                width={barW}
                height={10}
                fill="currentColor"
                // 带内 = 浅（同档）；带外 = 深（真偏差）。深浅阶即语义，不用第二个色相
                opacity={inBand ? 0.28 : 0.62}
              />

              <text
                x={VALUE_X}
                y={y + 3.5}
                fontSize={11}
                fill="currentColor"
                fillOpacity={inBand ? 0.55 : 0.9}
                fontWeight={inBand ? 400 : 600}
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {row.delta > 0 ? '+' : ''}
                {row.delta.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* 图例：把"深浅"这件事说清楚，否则读者会以为只是配色 */}
        <g transform={`translate(${ID_X - 88}, ${height - 12})`}>
          <rect x={0} y={-6} width={18} height={8} fill="currentColor" opacity={0.28} />
          <text x={24} y={1} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            带内（|偏差| ≤ {tolerance}，同档）
          </text>
          <rect x={196} y={-6} width={18} height={8} fill="currentColor" opacity={0.62} />
          <text x={220} y={1} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            带外（需人工核对）
          </text>
        </g>
      </svg>
    </div>
  );
}
