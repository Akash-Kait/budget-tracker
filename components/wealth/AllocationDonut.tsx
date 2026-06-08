import { formatINR } from '@/lib/format';
import { wealthTypeColor } from '@/lib/colors';
import type { WealthAllocation } from '@/lib/wealth';

export function AllocationDonut({ data, total }: { data: WealthAllocation[]; total: number }) {
  if (data.length === 0 || total <= 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-faint">
        No assets to allocate.
      </div>
    );
  }
  const r = 80;
  const circ = 2 * Math.PI * r;
  const gap = data.length > 1 ? 6 : 0; // px gap between segments for a crisp look
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-10">
      <svg width="200" height="200" viewBox="0 0 200 200" className="shrink-0">
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--hairline)" strokeWidth="20" />
        {data.map((a) => {
          const len = Math.max(0, (a.pct / 100) * circ - gap);
          const seg = (
            <circle
              key={a.type}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={wealthTypeColor(a.type)}
              strokeWidth="20"
              strokeLinecap="round"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            />
          );
          offset += (a.pct / 100) * circ;
          return seg;
        })}
        <text x="100" y="94" textAnchor="middle" fill="var(--faint)" fontSize="11" letterSpacing="1">
          TOTAL
        </text>
        <text
          x="100"
          y="116"
          textAnchor="middle"
          fill="var(--text)"
          fontSize="17"
          fontWeight="600"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatINR(total)}
        </text>
      </svg>

      <ul className="w-full max-w-xs space-y-3">
        {data.map((a) => (
          <li key={a.type} className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: wealthTypeColor(a.type) }}
            />
            <span className="flex-1 text-sm text-muted">{a.label}</span>
            <span className="font-mono text-sm tabular-nums text-text">{formatINR(a.value)}</span>
            <span className="w-10 text-right font-mono text-xs tabular-nums text-faint">
              {a.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
