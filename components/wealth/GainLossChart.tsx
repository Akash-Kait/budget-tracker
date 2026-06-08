'use client';
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { usePrefersReducedMotion } from '@/components/wealth/usePrefersReducedMotion';
import { formatINR } from '@/lib/format';

export interface GainLossRow {
  name: string;
  value: number;
  status: 'gain' | 'loss' | 'none';
  glAbsolute: number | null;
  glPct: number | null;
}

// Reads the real token values from the CSS custom properties (presentation-attribute `fill` can't
// use var()), so gain/loss bars use --positive/--negative/--muted — never the brand accent. Defaults
// match the committed tokens for SSR / first paint.
const FALLBACK = { gain: '#4ade80', loss: '#f87171', none: '#9aa4b2' };

export function GainLossChart({ data }: { data: GainLossRow[] }) {
  const reduced = usePrefersReducedMotion();
  const [c, setC] = useState(FALLBACK);
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    setC({
      gain: s.getPropertyValue('--positive').trim() || FALLBACK.gain,
      loss: s.getPropertyValue('--negative').trim() || FALLBACK.loss,
      none: s.getPropertyValue('--muted').trim() || FALLBACK.none,
    });
  }, []);

  if (data.length === 0) {
    return <div className="flex h-44 items-center justify-center text-sm text-faint">No holdings.</div>;
  }
  const height = Math.max(160, data.length * 44);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted)', fontSize: 12 }}
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
          formatter={(value, _name, item) => {
            const r = (item?.payload ?? {}) as GainLossRow;
            const gl =
              r.glAbsolute === null || r.glAbsolute === undefined
                ? 'cost basis not set'
                : `${r.glAbsolute >= 0 ? '+' : '−'}${formatINR(Math.abs(r.glAbsolute))}${
                    r.glPct === null ? '' : ` (${r.glPct}%)`
                  }`;
            return [`${formatINR(Number(value))} · ${gl}`, 'Value'];
          }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={!reduced} animationDuration={700}>
          {data.map((r, i) => (
            <Cell key={i} fill={c[r.status]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
