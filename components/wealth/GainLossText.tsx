import { formatINR } from '@/lib/format';
import type { GainLoss } from '@/lib/wealth';

// Renders a gain/loss value with the reserved semantic tokens:
//   null        → "— not set" (faint)  — unknown cost basis, NOT a flat zero
//   absolute >0 → --positive (green)
//   absolute <0 → --negative (red)
//   absolute==0 → --muted (neutral flat)
//   pct null    → "(—)"  — zero cost basis, percentage undefined
export function GainLossText({ gl, className = '' }: { gl: GainLoss | null; className?: string }) {
  if (gl === null) {
    return <span className={`text-faint ${className}`}>— not set</span>;
  }
  const color = gl.absolute > 0 ? 'text-positive' : gl.absolute < 0 ? 'text-negative' : 'text-muted';
  const sign = gl.absolute > 0 ? '+' : gl.absolute < 0 ? '−' : '';
  const pct =
    gl.pct === null
      ? '—'
      : `${gl.pct > 0 ? '+' : gl.pct < 0 ? '−' : ''}${Math.abs(gl.pct)}%`;
  return (
    <span className={`font-mono tabular-nums ${color} ${className}`}>
      {sign}
      {formatINR(Math.abs(gl.absolute))} ({pct})
    </span>
  );
}
