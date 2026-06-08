'use client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { usePrefersReducedMotion } from '@/components/hooks/usePrefersReducedMotion';
import { colorFor, RESERVE_COLOR } from '@/lib/colors';
import { formatINR } from '@/lib/format';
import type { MonthlyAllocation } from '@/lib/finance';

// Recharts rebuild of the hand-built stacked-div projection: real tooltips (per-month breakdown),
// axes, responsive scaling, and a reduced-motion-gated entrance — matching the Wealth chart treatment.
export function SurplusProjectionChart({
  data,
  surplus,
}: {
  data: MonthlyAllocation[];
  surplus: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (surplus <= 0) return <p className="text-sm text-muted">No surplus to allocate.</p>;

  const titles = Array.from(new Set(data.flatMap((m) => m.items.map((i) => i.title))));
  const series = ['Reserve', ...titles];
  const colors = series.map((s, idx) => (idx === 0 ? RESERVE_COLOR : colorFor(idx - 1)));

  const rows = data.map((m) => {
    const row: Record<string, number | string> = { month: m.month.split(' ')[0], Reserve: m.reserve };
    m.items.forEach((i) => {
      row[i.title] = ((row[i.title] as number) ?? 0) + i.amount;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          {series.map((s, idx) => (
            <linearGradient key={s} id={`proj-${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[idx]} stopOpacity={0.95} />
              <stop offset="100%" stopColor={colors[idx]} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="month" tick={{ fill: 'var(--faint)', fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fill: 'var(--faint)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={46}
          tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`}
        />
        <Tooltip
          cursor={{ fill: 'var(--hairline)' }}
          contentStyle={{
            background: 'var(--surface-2)',
            border: '1px solid var(--hairline)',
            borderRadius: 10,
          }}
          itemStyle={{ color: 'var(--text)' }}
          labelStyle={{ color: 'var(--muted)' }}
          formatter={(value, name) => [formatINR(Number(value)), name as string]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} iconType="circle" />
        {series.map((s, idx) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="a"
            fill={`url(#proj-${idx})`}
            isAnimationActive={!reduced}
            animationDuration={700}
            radius={idx === series.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
