import { ReactNode } from "react";

interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
}

function pointsForSeries(values: number[], max: number, width: number, height: number, padding: number): string {
  const step = (width - padding * 2) / Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - (value / max) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

export function LineChart({ labels, series }: LineChartProps) {
  const width = 760;
  const height = 280;
  const padding = 28;
  const max = Math.max(...series.flatMap((item) => item.values), 1);
  const step = (width - padding * 2) / Math.max(labels.length - 1, 1);

  return (
    <div className="space-y-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full rounded-xl bg-[#15181f]">
        {[0, 1, 2, 3, 4].map((line) => {
          const y = padding + (line * (height - padding * 2)) / 4;
          return <line key={line} x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
        })}

        {series.map((item, index) => (
          <polyline
            key={`${item.name}-${index}`}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            points={pointsForSeries(item.values, max, width, height, padding)}
          />
        ))}

        {labels.map((label, index) => (
          <text key={`${label}-${index}`} x={padding + index * step} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
            {label}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-4">
        {series.map((item, index) => (
          <div key={`${item.name}-${index}`} className="flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunnelChart({ stages }: { stages: { label: string; value: number }[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.value, 0);
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((stage, index) => {
        const width = (stage.value / max) * 100;
        const percentage = total > 0 ? (stage.value / total) * 100 : 0;
        const isZero = stage.value === 0;
        const barWidth = isZero ? 0 : Math.max(width, 12);
        return (
          <div key={`${stage.label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-medium text-slate-200">{stage.label}</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white">
                {stage.value} ({percentage.toFixed(stage.value > 0 && percentage < 10 ? 1 : 0)}%)
              </span>
            </div>
            <div className="h-8 rounded-lg bg-white/[0.06] p-1">
              <div
                className={isZero ? "h-full rounded-md border border-dashed border-white/10 bg-transparent" : "h-full rounded-md bg-[#C42429]/90"}
                style={{ width: isZero ? "100%" : `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UtilizationBars({
  rows,
}: {
  rows: { name: string; sessions: number; ptRevenue: string; programSessions: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.sessions), 1);

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={`${row.name}-${index}`} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="font-semibold text-white">{row.name}</span>
            <span>
              Sessions: {row.sessions} | PT: {row.ptRevenue} | Program: {row.programSessions}
            </span>
          </div>
          <div className="h-3 rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[#C42429]"
              style={{ width: `${Math.max((row.sessions / max) * 100, 12)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutLegendChart({
  title,
  slices,
}: {
  title: string;
  slices: { label: string; value: number; color: string }[];
}) {
  const rawTotal = slices.reduce((sum, item) => sum + item.value, 0);
  const total = rawTotal || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offsets = slices.map((_, index) => {
    const previousStroke = slices
      .slice(0, index)
      .reduce((sum, item) => sum + (item.value / total) * circumference, 0);
    return circumference - previousStroke;
  });

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-white/8 bg-[#131925] p-5 shadow-[0_18px_45px_rgba(0,0,0,0.24)]">
      <p className="text-sm font-semibold text-white">{title}</p>
      <div className="mt-5 flex flex-1 flex-col justify-between gap-6 lg:flex-row lg:items-center">
        <div className="flex items-center justify-center lg:min-w-[176px]">
          <svg viewBox="0 0 120 120" className="h-40 w-40 max-w-full">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
          {slices.map((slice, index) => {
            const stroke = (slice.value / total) * circumference;
            return (
              <circle
                key={`${slice.label}-${index}`}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="14"
                strokeDasharray={`${stroke} ${circumference - stroke}`}
                strokeDashoffset={offsets[index]}
                transform="rotate(-90 60 60)"
                strokeLinecap="round"
              />
            );
          })}
          <text x="60" y="63" textAnchor="middle" className="fill-white text-[12px] font-semibold">
            {rawTotal}
          </text>
        </svg>
        </div>

        <div className="grid flex-1 content-start gap-3 sm:grid-cols-2">
          {slices.map((slice, index) => (
            <div
              key={`${slice.label}-${index}`}
              className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-slate-300"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{slice.label}</p>
                  <p className="mt-1 text-slate-400">{slice.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeatMap({ title, values }: { title: string; values: number[][] }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#131925] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.24)]">
      <p className="text-sm font-semibold text-white">{title}</p>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {values.flatMap((row, rowIndex) =>
          row.map((value, colIndex) => {
            const color = value > 8 ? "#C42429" : value > 6 ? "#ef4444" : value > 4 ? "#f97316" : "#e2e8f0";
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="h-8 rounded"
                style={{ backgroundColor: color, opacity: value > 0 ? 0.95 : 0.3 }}
                title={`Value: ${value}`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

export function StatTile({ title, value, icon }: { title: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {icon ? <span className="text-[#C42429]">{icon}</span> : null}
      </div>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}
