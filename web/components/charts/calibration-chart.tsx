/**
 * AutoGrader · 置信度校准曲线（零依赖 SVG，可靠性图 reliability diagram）
 * ---------------------------------------------------------------------------
 * 回答的问题：**AI 说"我有 90% 把握"的时候，它真的有 90% 是对的吗？**
 *
 * 读法：对角线 = 「说到做到」；点在对角线**下方**表示 AI 偏自信（置信度虚高），
 * 点在对角线**上方**表示偏保守。点离对角线的垂直距离，就是该桶的校准差；
 * 点的大小按该桶样本数，避免拿 2 个样本的桶与 116 个样本的桶等量齐观。
 *
 * 视觉纪律：偏自信 / 偏保守 用**实线 / 虚线**区分（形），不用红绿。
 *
 * 纯函数组件，Server / Client 两侧都能渲染。
 */

import { cn } from '@/lib/utils';

export interface CalibrationPoint {
  bucket: string;
  n: number;
  meanConfidence: number | null;
  accuracy: number | null;
  calibrationGap: number | null;
}

export interface CalibrationChartProps {
  buckets: readonly CalibrationPoint[];
  /** 桶的中文名（缺省用 bucket 名） */
  labels?: Readonly<Record<string, string>>;
  className?: string;
}

const W = 680;
const PLOT = { x: 104, y: 46, size: 318 };
const RIGHT_X = PLOT.x + PLOT.size + 44;
const OUTER = PLOT.y + PLOT.size + 58;
const TOLERANCE = 0.1;

export function CalibrationChart({ buckets, labels, className }: CalibrationChartProps) {
  const px = (value: number) => PLOT.x + value * PLOT.size;
  const py = (value: number) => PLOT.y + (1 - value) * PLOT.size;

  const points = buckets.filter(
    (bucket) => bucket.meanConfidence !== null && bucket.accuracy !== null && bucket.n > 0,
  );
  const totalN = points.reduce((sum, bucket) => sum + bucket.n, 0);
  const maxN = Math.max(1, ...points.map((bucket) => bucket.n));

  const radius = (n: number) => 3.5 + 7 * Math.sqrt(n / maxN);

  return (
    <div className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${OUTER}`}
        className="h-auto w-full text-foreground"
        role="img"
        aria-label="置信度校准曲线"
      >
        <title>置信度校准曲线：各置信度桶的平均置信度与实际命中率</title>

        {/* 绘图区底 */}
        <rect
          x={PLOT.x}
          y={PLOT.y}
          width={PLOT.size}
          height={PLOT.size}
          fill="currentColor"
          opacity={0.03}
        />

        {/* ±宽容差带：落在这两条线之间，可认为分母本上"说到做到" */}
        {[TOLERANCE, -TOLERANCE].map((offset) => (
          <line
            key={offset}
            x1={px(0)}
            y1={py(offset)}
            x2={px(1 - offset)}
            y2={py(1)}
            stroke="currentColor"
            strokeOpacity={0.16}
            strokeDasharray="3 4"
          />
        ))}

        {/* 主对角线：完美校准 */}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="currentColor" strokeOpacity={0.4} />

        {/* 网格与刻度 */}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={px(tick)} y1={py(0)} x2={px(tick)} y2={py(1)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={px(tick)} y={py(0) + 16} fontSize={10} fill="currentColor" fillOpacity={0.5} textAnchor="middle">
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={px(0)} y1={py(tick)} x2={px(1)} y2={py(tick)} stroke="currentColor" strokeOpacity={0.08} />
            <text
              x={px(0) - 10}
              y={py(tick) + 3.5}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="end"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}

        <text
          x={px(0.5)}
          y={py(0) + 34}
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.6}
          textAnchor="middle"
        >
          平均置信度（AI 自评）→
        </text>
        <text
          x={PLOT.x - 40}
          y={py(0.5)}
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.6}
          textAnchor="middle"
          transform={`rotate(-90 ${PLOT.x - 40} ${py(0.5)})`}
        >
          实际命中率 →
        </text>

        {/* 对角线标注 */}
        <text x={px(0.72)} y={py(0.72) - 8} fontSize={10} fill="currentColor" fillOpacity={0.55}>
          完美校准
        </text>

        {/* 各桶：先画校准差线段，再画点，最后写字 */}
        {points.map((bucket) => {
          const mean = bucket.meanConfidence ?? 0;
          const acc = bucket.accuracy ?? 0;
          const overconfident = acc < mean;

          return (
            <g key={bucket.bucket}>
              <line
                x1={px(mean)}
                y1={py(mean)}
                x2={px(mean)}
                y2={py(acc)}
                stroke="currentColor"
                strokeOpacity={0.75}
                strokeWidth={2}
                // 实线 = 偏自信（危险的那种）；虚线 = 偏保守
                strokeDasharray={overconfident ? undefined : '4 3'}
              />
              <circle cx={px(mean)} cy={py(mean)} r={2} fill="currentColor" fillOpacity={0.35} />
              <circle cx={px(mean)} cy={py(acc)} r={radius(bucket.n)} fill="currentColor" fillOpacity={0.85} />
              <text
                x={px(mean) + radius(bucket.n) + 6}
                y={py(acc) + 3.5}
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.75}
              >
                {(labels?.[bucket.bucket] ?? bucket.bucket) + ` n=${bucket.n}`}
              </text>
            </g>
          );
        })}

        {/* 右侧图例与口径 */}
        <g transform={`translate(${RIGHT_X}, ${PLOT.y + 6})`}>
          <text x={0} y={0} fontSize={11} fontWeight={600} fill="currentColor">
            怎么读
          </text>
          <text x={0} y={18} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            对角线：说到做到
          </text>
          <line x1={0} y1={34} x2={26} y2={34} stroke="currentColor" strokeOpacity={0.75} strokeWidth={2} />
          <text x={32} y={37} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            实线：偏自信
          </text>
          <text x={32} y={50} fontSize={10} fill="currentColor" fillOpacity={0.45}>
            （置信度虚高）
          </text>
          <line
            x1={0}
            y1={68}
            x2={26}
            y2={68}
            stroke="currentColor"
            strokeOpacity={0.75}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
          <text x={32} y={71} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            虚线：偏保守
          </text>
          <text x={32} y={84} fontSize={10} fill="currentColor" fillOpacity={0.45}>
            （低估了自己）
          </text>
          <circle cx={13} cy={104} r={7} fill="currentColor" fillOpacity={0.85} />
          <text x={32} y={107} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            点大小 = 样本数
          </text>
          <text x={0} y={132} fontSize={10} fill="currentColor" fillOpacity={0.45}>
            虚线框内为 ±{TOLERANCE.toFixed(2)}
          </text>
          <text x={0} y={145} fontSize={10} fill="currentColor" fillOpacity={0.45}>
            内的容忍区间
          </text>
          <text x={0} y={170} fontSize={10} fill="currentColor" fillOpacity={0.65}>
            参与分桶 {totalN} 个评分点
          </text>
        </g>
      </svg>
    </div>
  );
}
