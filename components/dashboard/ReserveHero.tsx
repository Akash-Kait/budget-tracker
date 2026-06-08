'use client';
import { Money } from '@/components/Money';
import { useCountUp } from '@/components/hooks/useCountUp';

// Generic status (not gain/loss): healthy = brand accent, mid = warning, low = negative.
function statusColor(pct: number): string {
  if (pct >= 90) return 'var(--accent)';
  if (pct >= 70) return 'var(--warning)';
  return 'var(--negative)';
}

export function ReserveHero({
  pct,
  current,
  target,
  recovery,
}: {
  pct: number;
  current: number;
  target: number;
  recovery: number | null;
}) {
  const shown = useCountUp(pct); // ring sweep + number count up together
  const clamped = Math.max(0, Math.min(100, shown));
  const r = 80;
  const circ = 2 * Math.PI * r;
  const dash = (clamped / 100) * circ;
  const color = statusColor(pct); // status from the final value (stable colour, no flicker)
  const deficit = Math.max(0, target - current);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-hairline bg-surface p-8">
      {/* static radial glow behind the gauge — decoration only */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full opacity-90 blur-2xl"
        style={{ background: 'radial-gradient(circle, var(--accent-weak), transparent 70%)' }}
      />
      <div className="relative flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-12">
        <svg width="200" height="200" viewBox="0 0 200 200" className="shrink-0">
          <circle cx="100" cy="100" r={r} fill="none" stroke="var(--hairline)" strokeWidth="16" />
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform="rotate(-90 100 100)"
          />
          <text
            x="100"
            y="108"
            textAnchor="middle"
            fill="var(--text)"
            fontSize="46"
            fontWeight="700"
            style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(shown)}%
          </text>
        </svg>

        <div className="w-full">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Reserve Health
          </p>
          <p className="mt-2 font-mono text-lg tabular-nums text-text">
            <Money amount={current} /> <span className="text-faint">/ </span>
            <span className="text-muted">
              <Money amount={target} />
            </span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Deficit</dt>
              <dd className={`font-mono tabular-nums ${deficit > 0 ? 'text-warning' : 'text-muted'}`}>
                <Money amount={deficit} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Recovery</dt>
              <dd className="font-mono tabular-nums text-muted">
                {recovery === null ? '—' : `${recovery.toFixed(1)} mo`}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-faint">healthy ≥ 90% of target</p>
        </div>
      </div>
    </section>
  );
}
