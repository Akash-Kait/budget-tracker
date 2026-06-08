import { Money } from '@/components/Money';

function color(pct: number): string {
  if (pct >= 90) return '#10b981';
  if (pct >= 70) return '#f59e0b';
  return '#ef4444';
}

export function ReserveGauge({
  current,
  target,
  recoveryMonths,
}: {
  current: number;
  target: number;
  recoveryMonths: number | null;
}) {
  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 70;
  const circ = 2 * Math.PI * r;
  const dash = (clamped / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle
          cx="90"
          cy="90"
          r={r}
          fill="none"
          stroke={color(pct)}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 90 90)"
        />
        <text x="90" y="84" textAnchor="middle" className="fill-gray-900" fontSize="28" fontWeight="700">
          {pct}%
        </text>
        <text x="90" y="106" textAnchor="middle" className="fill-gray-500" fontSize="11">
          healthy ≥ 90%
        </text>
      </svg>
      <p className="mt-2 text-sm text-gray-600">
        <Money amount={current} /> / <Money amount={target} />
      </p>
      <p className="text-xs text-gray-500">
        Recovery: {recoveryMonths === null ? '—' : `${recoveryMonths.toFixed(1)} months`}
      </p>
    </div>
  );
}
