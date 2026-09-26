/**
 * AutoGrader · 逐项档位命中率图（零依赖 SVG）
 * ---------------------------------------------------------------------------
 * 回答的问题：**哪些评分点上 AI 与教师最容易分歧？**
 *
 * 形态：横向条形 + 两条**阈值参考线**（70% / 90%）。参考线是关键 ——
 * 条形长度本身只表示比例，读者需要一个"到什么位置就该警惕"的锚点；
 * 用参考线而不是给条形染色，正是本项目"靠形不靠色"的做法。
 *
 * 纯函数组件，Server / Client 两侧都能渲染。
 */

import { cn } from '@/lib/utils';

export interface HitRateRow {
  rubricItemId: string;
  itemName: string;
  /** 命中率 0–1；无可比样本时为 null */
  rate: number | null;
  hits: number;
  comparable: number;
}

export interface HitRateChartProps {
  rows: readonly HitRateRow[];
  /** 参考线阈值（比例） */
  thresholds?: readonly number[];
  className?: string;
}

const W = 680;
const ROW_H = 28;
const PAD_TOP = 45;
const PAD_BOTTOM = 12;
const ID_RIGHT = 62;
const NAME_X = 74;
const TRACK_X = 268;
const TRACK_W = 318;
const VALUE_X = TRACK_X + TRACK_W + 56;
const NAME_MAX = 13;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function HitRateChart({ rows, thresholds = [0.7, 0.9], className }: HitRateChartProps) {
  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
  // noUncheckedIndexedAccess 下解构要给默认值：低阈值=需留意，高阈值=达标
  const [noticeMin = 0.7, okMin = 0.9] = thresholds;

  return (
    <div className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full text-foreground"
        role="img"
        aria-label="逐项档位命中率"
      >
        <title>逐项档位命中率：AI 判定档位与教师金标准一致的评分点比例</title>

        {/* 参考线：先铺底，条形压在上面 */}
        {thresholds.map((ratio) => (
          <g key={ratio}>
            <line
              x1={TRACK_X + ratio * TRACK_W}
              y1={PAD_TOP - 10}
              x2={TRACK_X + ratio * TRACK_W}
              y2={PAD_TOP + rows.length * ROW_H}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
            />
            <text
              x={TRACK_X + ratio * TRACK_W}
              y={PAD_TOP - 16}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
            >
              {(ratio * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* 列名与量程端点 */}
        <text x={ID_RIGHT} y={PAD_TOP - 16} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="end">
          评分点
        </text>
        {[0, 1].map((ratio) => (
          <text
            key={ratio}
            x={TRACK_X + ratio * TRACK_W}
            y={PAD_TOP + rows.length * ROW_H + 14}
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.45}
            textAnchor="middle"
          >
            {(ratio * 100).toFixed(0)}%
          </text>
        ))}
        <text x={VALUE_X} y={PAD_TOP - 16} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="end">
          命中 / 可比
        </text>

        {rows.map((row, index) => {
          const y = PAD_TOP + index * ROW_H + ROW_H / 2;
          const barH = 12;

          return (
            <g key={row.rubricItemId}>
              <text
                x={ID_RIGHT}
                y={y + 3.5}
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.55}
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {row.rubricItemId}
              </text>
              <text x={NAME_X} y={y + 3.5} fontSize={11} fill="currentColor" fillOpacity={0.8}>
                {clip(row.itemName, NAME_MAX)}
              </text>

              {/* 轨道：始终画满，让"没达到"这件事可见 */}
              <rect x={TRACK_X} y={y - barH / 2} width={TRACK_W} height={barH} fill="currentColor" opacity={0.06} />

              {row.rate === null ? (
                <text
                  x={TRACK_X + 8}
                  y={y + 3.5}
                  fontSize={10}
                  fill="currentColor"
                  fillOpacity={0.45}
                  fontStyle="italic"
                >
                  无可比样本
                </text>
              ) : (
                <>
                  <rect
                    x={TRACK_X}
                    y={y - barH / 2}
                    width={Math.max(1.5, row.rate * TRACK_W)}
                    height={barH}
                    fill="currentColor"
                    // 达标的用实心深阶，未达低阈值的降一档 —— 深浅阶即程度
                    opacity={row.rate >= okMin ? 0.85 : row.rate >= noticeMin ? 0.6 : 0.35}
                  />
                  <text
                    x={VALUE_X}
                    y={y + 3.5}
                    fontSize={11}
                    fill="currentColor"
                    fillOpacity={0.75}
                    textAnchor="end"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {row.hits}/{row.comparable}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
