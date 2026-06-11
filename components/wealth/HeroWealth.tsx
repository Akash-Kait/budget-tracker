'use client';
import { RefreshPricesButton } from '@/components/wealth/RefreshPricesButton';
import { useCountUp } from '@/components/hooks/useCountUp';
import { formatINR } from '@/lib/format';

interface Alloc {
  label: string;
  value: number;
  pct: number;
  color: string;
}

// Value-only hero: the headline is Total Wealth — a figure true for ALL holdings. Gain/loss is NOT
// shown anywhere in the wealth UI (value-framed dashboard): cost basis exists for only a subset, so a
// portfolio % would misrepresent partial-coverage data. The cost-basis DATA + lib/wealth gain/loss
// math are kept (dormant) — hidden, not deleted, so a future toggle can re-show it without re-import.
export function HeroWealth({
  total,
  allocation,
}: {
  total: number;
  allocation: Alloc[];
}) {
  const totalShown = useCountUp(total);

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
