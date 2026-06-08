'use client';
import { RefreshPricesButton } from '@/components/wealth/RefreshPricesButton';
import { useCountUp } from '@/components/wealth/useCountUp';
import { formatINR } from '@/lib/format';

interface Alloc {
  label: string;
  value: number;
  pct: number;
  color: string;
}

export function HeroWealth({
  total,
  gl,
  covered,
  count,
  allocation,
}: {
  total: number;
  gl: { absolute: number; pct: number | null } | null;
  covered: number;
  count: number;
  allocation: Alloc[];
}) {
  const totalShown = useCountUp(total);
  const glShown = useCountUp(gl?.absolute ?? 0);
  const partial = covered > 0 && covered < count;

  const glColor =
    gl === null
      ? 'text-faint'
      : gl.absolute > 0
        ? 'text-positive'
        : gl.absolute < 0
          ? 'text-negative'
          : 'text-muted';
  const sign = gl === null || gl.absolute === 0 ? '' : gl.absolute > 0 ? '+' : '−';
  const pctText =
    gl === null
      ? ''
      : gl.pct === null
        ? ' (—)'
        : ` (${gl.pct > 0 ? '+' : gl.pct < 0 ? '−' : ''}${Math.abs(gl.pct)}%)`;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-hairline bg-surface p-8">
      {/* static radial glow — decoration only; sits behind/beneath the hero figure */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-2 top-16 h-56 w-[28rem] max-w-[110%] rounded-full opacity-90 blur-2xl sm:top-20"
        style={{ background: 'radial-gradient(60% 100% at 22% 50%, var(--accent-weak), transparent 70%)' }}
      />
      <div className="relative flex items-start justify-between gap-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
          Total Wealth
        </p>
        <RefreshPricesButton />
      </div>
      <p className="relative mt-3 font-sans text-5xl font-bold tabular-nums tracking-tight text-text sm:text-6xl">
        {formatINR(totalShown)}
      </p>
      <p className={`relative mt-2 font-sans text-lg font-semibold tabular-nums ${glColor}`}>
        {gl === null ? '— cost basis not set' : `${sign}${formatINR(Math.abs(glShown))}${pctText}`}
        {partial && gl !== null && (
          <span className="ml-2 font-sans text-xs text-faint">
            based on {covered} of {count} holdings
          </span>
        )}
      </p>
      {allocation.length > 0 && (
        <div className="relative mt-6 flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
          {allocation.map((a) => (
            <div
              key={a.label}
              style={{ width: `${a.pct}%`, backgroundColor: a.color }}
              title={`${a.label} · ${a.pct}%`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
