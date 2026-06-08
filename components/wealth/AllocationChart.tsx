'use client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePrefersReducedMotion } from '@/components/hooks/usePrefersReducedMotion';
import { formatINR } from '@/lib/format';

interface Slice {
  label: string;
  value: number;
  pct: number;
  color: string;
}

export function AllocationChart({ data, total }: { data: Slice[]; total: number }) {
  const reduced = usePrefersReducedMotion();
  if (data.length === 0 || total <= 0) {
    return (
      <div className="flex h-52 items-center justify-center text-sm text-faint">
        No assets to allocate.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="relative h-52 w-full max-w-[13rem] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {data.map((d, i) => (
                <linearGradient key={i} id={`alloc-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={d.color} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={d.color} stopOpacity={0.5} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={3}
              stroke="none"
              isAnimationActive={!reduced}
              animationDuration={700}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={`url(#alloc-grad-${i})`} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
                borderRadius: 10,
              }}
              itemStyle={{ color: 'var(--text)' }}
              labelStyle={{ color: 'var(--muted)' }}
              formatter={(value, name) => [formatINR(Number(value)), name as string]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-faint">Total</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-text">
            {formatINR(total)}
          </span>
        </div>
      </div>
      <ul className="w-full space-y-3">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="flex-1 text-sm text-muted">{d.label}</span>
            <span className="font-mono text-sm tabular-nums text-text">{formatINR(d.value)}</span>
            <span className="w-10 text-right font-mono text-xs tabular-nums text-faint">
              {d.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
